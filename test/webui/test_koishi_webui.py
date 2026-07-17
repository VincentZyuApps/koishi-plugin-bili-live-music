from __future__ import annotations

import argparse
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Open and smoke-test the bili-live-music Koishi Console page.",
    )
    parser.add_argument("--browser-path", required=True, help="Path to msedge.exe or another Chromium executable.")
    parser.add_argument("--user-data-dir", required=True, help="Dedicated persistent browser user-data directory.")
    parser.add_argument("--profile-directory", help="Optional profile name inside user-data-dir, for example Default.")
    parser.add_argument("--login-url", required=True, help="Koishi Console URL used for interactive sign-in.")
    parser.add_argument("--target-url", required=True, help="Full bili-live-music Console page URL.")
    parser.add_argument("--screenshot", required=True, help="Output PNG path.")
    parser.add_argument("--search-keyword", help="Optionally search for a song and require at least one result.")
    parser.add_argument("--add-result-index", type=int, help="Add the 1-based search result index to the queue.")
    parser.add_argument("--interactive-login", action="store_true", help="Wait for manual sign-in before testing target-url.")
    parser.add_argument("--headless", action="store_true", help="Run without a visible browser window.")
    parser.add_argument("--pause", action="store_true", help="Keep the page open until Enter is pressed.")
    parser.add_argument("--timeout-ms", type=int, default=30_000, help="Navigation and selector timeout in milliseconds.")
    return parser.parse_args()


def require_http_url(value: str, name: str) -> str:
    parsed = urlsplit(value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError(f"{name} must be an absolute HTTP(S) URL")
    return value


def main() -> int:
    args = parse_args()
    if args.add_result_index is not None and not args.search_keyword:
        raise ValueError("--add-result-index requires --search-keyword")
    if args.add_result_index is not None and args.add_result_index < 1:
        raise ValueError("--add-result-index must be at least 1")
    browser_path = Path(args.browser_path).expanduser().resolve(strict=True)
    user_data_dir = Path(args.user_data_dir).expanduser().resolve()
    screenshot_path = Path(args.screenshot).expanduser().resolve()
    login_url = require_http_url(args.login_url, "--login-url")
    target_url = require_http_url(args.target_url, "--target-url")

    user_data_dir.mkdir(parents=True, exist_ok=True)
    screenshot_path.parent.mkdir(parents=True, exist_ok=True)
    browser_args = [f"--profile-directory={args.profile_directory}"] if args.profile_directory else []

    with sync_playwright() as playwright:
        context = playwright.chromium.launch_persistent_context(
            str(user_data_dir),
            executable_path=str(browser_path),
            headless=args.headless,
            args=browser_args,
            viewport={"width": 1440, "height": 900},
        )
        try:
            page = context.pages[0] if context.pages else context.new_page()
            page.set_default_timeout(args.timeout_ms)
            diagnostics: list[str] = []
            page.on("console", lambda message: diagnostics.append(f"console[{message.type}]: {message.text}"))
            page.on("pageerror", lambda error: diagnostics.append(f"pageerror: {error}"))
            page.on(
                "requestfailed",
                lambda request: diagnostics.append(
                    f"requestfailed: {request.method} {request.url} {request.failure or ''}"
                ),
            )

            page.goto(login_url, wait_until="domcontentloaded", timeout=args.timeout_ms)

            if args.interactive_login:
                print("Complete Koishi sign-in in the browser, then return here.")
                input("Press Enter after sign-in is complete: ")
            else:
                page.wait_for_timeout(1_500)

            response = page.goto(target_url, wait_until="domcontentloaded", timeout=args.timeout_ms)
            if response and response.status >= 400:
                raise RuntimeError(f"target page returned HTTP {response.status}")

            try:
                page.locator("main.music-page").wait_for(state="visible", timeout=args.timeout_ms)
                page.get_by_role("heading", name="直播点歌", exact=True).first.wait_for(
                    state="visible",
                    timeout=args.timeout_ms,
                )
            except PlaywrightTimeoutError as error:
                failure_path = screenshot_path.with_name(f"{screenshot_path.stem}-failure{screenshot_path.suffix}")
                page.screenshot(path=str(failure_path), full_page=True)
                details = "\n".join(diagnostics[-20:]) or "No browser diagnostics were captured"
                raise RuntimeError(
                    "bili-live-music Console UI was not found; rerun with --interactive-login if Koishi redirected to sign-in. "
                    f"Current URL: {page.url}\nFailure screenshot: {failure_path}\n{details}"
                ) from error

            try:
                page.wait_for_function(
                    """() => {
                        const provider = document.querySelector('.provider')
                        return provider && provider.textContent.trim() !== '正在连接音乐服务'
                    }""",
                    timeout=args.timeout_ms,
                )
            except PlaywrightTimeoutError as error:
                details = "\n".join(diagnostics[-20:]) or "No browser diagnostics were captured"
                raise RuntimeError(
                    "Console UI loaded, but the bili-live-music DataService did not provide state before timeout\n"
                    f"{details}"
                ) from error

            bounds = page.locator("main.music-page").bounding_box()
            viewport = page.viewport_size
            if not bounds or not viewport:
                raise RuntimeError("unable to measure the Console page layout")
            if bounds["x"] < 0 or bounds["x"] + bounds["width"] > viewport["width"] + 1:
                raise RuntimeError(f"Console page exceeds viewport bounds: {bounds}")

            result_count = 0
            if args.search_keyword:
                page.get_by_placeholder("歌名、歌手或关键词", exact=True).fill(args.search_keyword)
                page.get_by_role("button", name="搜索", exact=True).click()
                page.wait_for_function(
                    """() => {
                        return document.querySelectorAll('.search-results tbody tr').length > 0
                            || Boolean(document.querySelector('.notice.error'))
                    }""",
                    timeout=args.timeout_ms,
                )
                error_notice = page.locator(".notice.error")
                if error_notice.count():
                    raise RuntimeError(f"song search failed: {error_notice.inner_text()}")
                result_count = page.locator(".search-results tbody tr").count()
                if result_count < 1:
                    raise RuntimeError("song search returned no visible result rows")
                if args.add_result_index is not None:
                    if args.add_result_index > result_count:
                        raise RuntimeError(
                            f"--add-result-index {args.add_result_index} exceeds visible result count {result_count}"
                        )
                    row = page.locator(".search-results tbody tr").nth(args.add_result_index - 1)
                    row.get_by_role("button", name="加入队列").click()
                    page.wait_for_function(
                        """() => Boolean(document.querySelector('.notice.success, .notice.error'))""",
                        timeout=args.timeout_ms,
                    )
                    error_notice = page.locator(".notice.error")
                    if error_notice.count():
                        raise RuntimeError(f"adding search result failed: {error_notice.inner_text()}")

            page.screenshot(path=str(screenshot_path), full_page=True)
            provider = page.locator(".provider").inner_text()
            print(f"PASS: Koishi Console UI loaded at {page.url}")
            print(f"PASS: Console DataService provider={provider}")
            print(f"PASS: layout bounds={bounds}")
            if args.search_keyword:
                print(f"PASS: search keyword={args.search_keyword!r} results={result_count}")
            if args.add_result_index is not None:
                print(f"PASS: added search result index={args.add_result_index}")
            print(f"Screenshot: {screenshot_path}")

            if args.pause:
                input("Press Enter to close the browser: ")
        finally:
            context.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
