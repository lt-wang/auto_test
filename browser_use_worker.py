"""Browser-use sidecar: launches a deterministic BrowserSession and exposes CDP."""

import asyncio
import json
import os
import sys

for stream in (sys.stdin, sys.stdout, sys.stderr):
    if hasattr(stream, 'reconfigure'):
        stream.reconfigure(encoding='utf-8')


async def main():
    from browser_use import Browser

    headless = os.environ.get('BROWSER_USE_HEADLESS', 'false').lower() in ('1', 'true', 'yes')
    channel = os.environ.get('BROWSER_USE_CHANNEL') or None
    browser = Browser(headless=headless, channel=channel, cross_origin_iframes=True)
    try:
        await browser.start()
        page = await browser.get_current_page() or await browser.new_page('about:blank')
        print(
            json.dumps(
                {'ready': True, 'cdp_url': browser.cdp_url, 'url': await page.get_url()},
                ensure_ascii=True,
            ),
            flush=True,
        )
        for line in sys.stdin:
            try:
                command = json.loads(line)
            except Exception:
                continue
            if command.get('action') == 'close':
                break
    finally:
        try:
            await browser.close()
        except Exception:
            pass


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except Exception as exc:
        print(f'{type(exc).__name__}: {exc}', file=sys.stderr)
        sys.exit(1)