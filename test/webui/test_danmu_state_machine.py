from __future__ import annotations

import argparse
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Smoke-test the bili-live-music danmu state-machine page.")
    parser.add_argument("--browser-path", required=True)
    parser.add_argument("--user-data-dir", required=True)
    parser.add_argument("--login-url", required=True)
    parser.add_argument("--target-url", required=True)
    parser.add_argument("--screenshot", required=True)
    parser.add_argument("--expect-enabled", action="store_true")
    parser.add_argument("--headless", action="store_true")
    parser.add_argument("--timeout-ms", type=int, default=30_000)
    parser.add_argument("--viewport-width", type=int, default=1440)
    parser.add_argument("--viewport-height", type=int, default=900)
    return parser.parse_args()


def require_http_url(value: str, name: str) -> str:
    parsed = urlsplit(value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError(f"{name} must be an absolute HTTP(S) URL")
    return value


def main() -> int:
    args = parse_args()
    browser_path = Path(args.browser_path).expanduser().resolve(strict=True)
    user_data_dir = Path(args.user_data_dir).expanduser().resolve()
    screenshot_path = Path(args.screenshot).expanduser().resolve()
    screenshot_path.parent.mkdir(parents=True, exist_ok=True)
    user_data_dir.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as playwright:
        context = playwright.chromium.launch_persistent_context(
            str(user_data_dir),
            executable_path=str(browser_path),
            headless=args.headless,
            viewport={"width": args.viewport_width, "height": args.viewport_height},
        )
        try:
            page = context.pages[0] if context.pages else context.new_page()
            page.set_default_timeout(args.timeout_ms)
            page.goto(require_http_url(args.login_url, "--login-url"), wait_until="domcontentloaded")
            page.wait_for_timeout(1_000)
            response = page.goto(require_http_url(args.target_url, "--target-url"), wait_until="domcontentloaded")
            if response and response.status >= 400:
                raise RuntimeError(f"state-machine page returned HTTP {response.status}")
            page.get_by_role("heading", name="弹幕状态机", exact=True).first.wait_for(state="visible")
            page.get_by_role("link", name="‹ 返回直播点歌", exact=True).wait_for(state="visible")

            if args.expect_enabled:
                page.locator(".state-graph").wait_for(state="visible")
                node_count = page.locator(".state-node").count()
                if node_count != 6:
                    raise RuntimeError(f"expected 6 state nodes, got {node_count}")
                active_count = page.locator(".state-node.active").count()
                if active_count != 1:
                    raise RuntimeError(f"expected 1 active state node, got {active_count}")
                edge_count = page.locator(".state-graph .edge").count()
                if edge_count != 8:
                    raise RuntimeError(f"expected 8 state edges, got {edge_count}")
                detached_edges = page.locator(".state-graph .edge").evaluate_all("""edges => edges.filter(edge => {
                    const svg = edge.ownerSVGElement
                    const matrix = svg?.getScreenCTM()
                    const from = document.querySelector(`.state-node.${edge.dataset.from}`)?.getBoundingClientRect()
                    const to = document.querySelector(`.state-node.${edge.dataset.to}`)?.getBoundingClientRect()
                    if (!matrix || !from || !to) return true
                    const point = value => new DOMPoint(value.x, value.y).matrixTransform(matrix)
                    const start = point(edge.getPointAtLength(0))
                    const end = point(edge.getPointAtLength(edge.getTotalLength()))
                    const distance = (p, rect) => Math.hypot(
                        Math.max(rect.left - p.x, 0, p.x - rect.right),
                        Math.max(rect.top - p.y, 0, p.y - rect.bottom),
                    )
                    return distance(start, from) > 2 || distance(end, to) > 2
                }).map(edge => `${edge.dataset.from}->${edge.dataset.to}`)""")
                if detached_edges:
                    raise RuntimeError(f"state edges detached from nodes: {detached_edges}")
                page.get_by_role("button", name="立即重连", exact=True).wait_for(state="visible")
                page.wait_for_timeout(600)
                print(f"PASS: state graph nodes={node_count}, edges={edge_count}, active={active_count}")
            else:
                disabled = page.locator(".disabled-page")
                disabled.wait_for(state="visible")
                if "enableDanmuStateMachinePage" not in disabled.inner_text():
                    raise RuntimeError("disabled page does not name enableDanmuStateMachinePage")
                print("PASS: disabled state-machine page names its config switch")

            bounds = page.locator("main.state-page").bounding_box()
            viewport = page.viewport_size
            if not bounds or not viewport or bounds["x"] < 0 or bounds["x"] + bounds["width"] > viewport["width"] + 1:
                raise RuntimeError(f"state-machine page exceeds viewport: {bounds}")
            page.screenshot(path=str(screenshot_path), full_page=True)
            page.get_by_role("link", name="‹ 返回直播点歌", exact=True).click()
            page.wait_for_timeout(500)
            if urlsplit(page.url).path.rstrip("/") != "/bili-live-music":
                raise RuntimeError(f"state-machine return navigation failed: {page.url}")
            print(f"PASS: state-machine navigation and layout bounds={bounds}")
            print(f"Screenshot: {screenshot_path}")
        finally:
            context.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
