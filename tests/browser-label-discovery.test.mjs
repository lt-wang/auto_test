import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { chromium } from 'playwright';
import { snapshotPlaywrightPage } from '../lib/browser/playwright-snapshot.mjs';

test('unnamed icon buttons retain a synthetic name and discover Tooltip text', async () => {
    const server = http.createServer((request, response) => {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(`
            <button id="delete" aria-describedby="tip-delete">
                <svg viewBox="0 0 24 24"><path d="M1 1h22v22H1z"></path></svg>
            </button>
            <div id="tip-delete" role="tooltip" style="display:none">删除</div>
            <script>
                const button = document.getElementById('delete');
                const tip = document.getElementById('tip-delete');
                button.addEventListener('mouseenter', () => tip.style.display = 'block');
                button.addEventListener('mouseleave', () => tip.style.display = 'none');
            </script>
        `);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
        const { port } = server.address();
        await page.goto(`http://127.0.0.1:${port}/`);
        const before = await snapshotPlaywrightPage(page);
        const icon = before.controls.find((control) => control.role === 'button');
        assert.equal(icon.name, '图标:1');
        assert.equal(icon.nameSource, 'synthetic');
    } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
    }
});
