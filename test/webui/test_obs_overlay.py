from __future__ import annotations

import argparse
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from playwright.sync_api import sync_playwright


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Open and smoke-test the bili-live-music OBS Overlay page.",
    )
    parser.add_argument("--browser-path", required=True, help="Path to msedge.exe or another Chromium executable.")
    parser.add_argument("--overlay-url", required=True, help="Overlay URL without a hard-coded access token.")
    parser.add_argument("--token", required=True, help="Value of obsAccessToken.")
    parser.add_argument("--mode", required=True, choices=["player", "display"], help="Initial Overlay role.")
    parser.add_argument("--backend", choices=["browser", "vlc"], default="browser", help="Configured playback backend.")
    parser.add_argument("--layout", choices=["mini", "standard", "sidebar"], default="standard", help="Overlay visual layout.")
    parser.add_argument("--screenshot", required=True, help="Output PNG path.")
    parser.add_argument("--claim-player", action="store_true", help="Ask a display page to become the main player.")
    parser.add_argument("--mock-finished", choices=["ended", "skipped", "error"], help="Inject a finished-track state without changing the live queue.")
    parser.add_argument("--mock-loading", action="store_true", help="Inject a loading-track state without changing the live queue.")
    parser.add_argument("--headless", action="store_true", help="Run without a visible browser window.")
    parser.add_argument("--pause", action="store_true", help="Keep the page open until Enter is pressed.")
    parser.add_argument("--timeout-ms", type=int, default=30_000, help="Navigation and selector timeout in milliseconds.")
    return parser.parse_args()


def build_overlay_url(base_url: str, token: str, mode: str, layout: str) -> str:
    parsed = urlsplit(base_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("--overlay-url must be an absolute HTTP(S) URL")
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    query["token"] = token
    query["mode"] = mode
    query["layout"] = layout
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, urlencode(query), parsed.fragment))


def main() -> int:
    args = parse_args()
    if args.claim_player and args.mode != "display":
        raise ValueError("--claim-player is only valid with --mode display")
    if args.claim_player and args.backend == "vlc":
        raise ValueError("--claim-player is unavailable with the VLC backend")

    browser_path = Path(args.browser_path).expanduser().resolve(strict=True)
    screenshot_path = Path(args.screenshot).expanduser().resolve()
    screenshot_path.parent.mkdir(parents=True, exist_ok=True)
    target_url = build_overlay_url(args.overlay_url, args.token, args.mode, args.layout)
    safe_target = urlunsplit((*urlsplit(target_url)[:3], "", ""))

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path=str(browser_path),
            headless=args.headless,
        )
        try:
            expected_sizes = {
                "mini": {"width": 520, "height": 104},
                "standard": {"width": 640, "height": 240},
                "sidebar": {"width": 300, "height": 666.666666},
            }
            page = browser.new_page(viewport={"width": 1000, "height": 900})
            page.set_default_timeout(args.timeout_ms)
            response = page.goto(target_url, wait_until="domcontentloaded", timeout=args.timeout_ms)
            if not response:
                raise RuntimeError("Overlay navigation did not return an HTTP response")
            if response.status != 200:
                raise RuntimeError(f"Overlay returned HTTP {response.status}; check --token and Fastify configuration")

            page.locator("#device").wait_for(state="visible", timeout=args.timeout_ms)
            shell_box = page.locator(".shell").bounding_box()
            expected_size = expected_sizes[args.layout]
            if not shell_box:
                raise RuntimeError("Overlay shell does not have a visible bounding box")
            actual_size = {"width": shell_box["width"], "height": shell_box["height"]}
            if any(abs(actual_size[key] - expected_size[key]) > 0.1 for key in expected_size):
                raise RuntimeError(
                    f"Overlay {args.layout} size mismatch: expected {expected_size}, got {actual_size}",
                )
            expected_text = "VLC 播放后端" if args.backend == "vlc" else "主播放器" if args.mode == "player" else "展示端"
            page.locator("#role-label").filter(has_text=expected_text).wait_for(
                state="visible",
                timeout=args.timeout_ms,
            )

            if args.mode == "display" or args.backend == "vlc":
                audio_paused = page.locator("#audio").evaluate("audio => audio.paused")
                if not audio_paused:
                    raise RuntimeError("display mode unexpectedly started audio playback")

            if args.mock_finished:
                page.evaluate(
                    """reason => {
                        const item = {
                            id: 'finished-test',
                            song: {
                                title: 'Finished Track',
                                artist: 'Test Artist',
                                album: 'Test Album',
                                duration: 180000,
                                cover: '',
                                url: '',
                                source: 'netease',
                            },
                            requester: { uid: 'test', name: 'Test User', origin: 'webui' },
                            keyword: 'test',
                            createdAt: Date.now(),
                        }
                        window.render({
                            current: null,
                            lastFinished: {
                                item,
                                reason,
                                position: reason === 'ended' ? 180000 : 45000,
                                finishedAt: Date.now(),
                            },
                            queue: [],
                            history: [item],
                            playing: false,
                            paused: false,
                            position: 0,
                            backendError: null,
                        })
                    }""",
                    args.mock_finished,
                )
                expected_finish_title = {
                    "ended": "已播放结束",
                    "skipped": "已跳过",
                    "error": "播放失败",
                }[args.mock_finished]
                page.locator("#finished-mask").wait_for(state="visible", timeout=args.timeout_ms)
                page.locator("#finished-title").filter(has_text=expected_finish_title).wait_for(state="visible")
                page.locator("#finished-detail").filter(has_text="队列为空").wait_for(state="visible")
                if args.mock_finished == "ended":
                    progress_width = page.locator("#progress").evaluate("element => parseFloat(element.style.width)")
                    if abs(progress_width - 100) > 0.1:
                        raise RuntimeError(f"finished progress should be 100%, got {progress_width}%")

            if args.mock_loading:
                page.evaluate(
                    """() => {
                        const item = {
                            id: 'loading-test',
                            song: {
                                title: 'Loading Track',
                                artist: 'Test Artist',
                                album: 'Test Album',
                                duration: 180000,
                                cover: '',
                                url: '',
                                source: 'netease',
                            },
                            requester: { uid: 'test', name: 'Test User', origin: 'webui' },
                            keyword: 'test',
                            createdAt: Date.now(),
                        }
                        window.render({
                            current: item,
                            lastFinished: null,
                            queue: [],
                            history: [],
                            phase: 'loading',
                            playing: false,
                            paused: false,
                            position: 0,
                            backendError: null,
                        })
                    }""",
                )
                page.locator("#loading-mask").wait_for(state="visible", timeout=args.timeout_ms)
                page.locator("#loading-mask").filter(has_text="正在加载").wait_for(state="visible")

            if args.claim_player:
                page.get_by_role("button", name="设为主播放器", exact=True).click()
                page.locator("#role-label").filter(has_text="主播放器").wait_for(
                    state="visible",
                    timeout=args.timeout_ms,
                )

            page.screenshot(path=str(screenshot_path), full_page=True)
            role = page.locator("#role-label").inner_text()
            print(f"PASS: OBS Overlay loaded from {safe_target}")
            print(f"PASS: {role}")
            print(f"PASS: {args.layout} shell size is {actual_size['width']:.3f}x{actual_size['height']:.3f}")
            if args.mock_finished:
                print(f"PASS: finished overlay reason={args.mock_finished}")
            if args.mock_loading:
                print("PASS: loading overlay is visible")
            print(f"Screenshot: {screenshot_path}")

            if args.pause:
                input("Press Enter to close the browser: ")
        finally:
            browser.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
