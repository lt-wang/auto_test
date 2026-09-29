import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { chromium } from 'playwright';
import { snapshotPlaywrightPage } from '../lib/browser/playwright-snapshot.mjs';
import { createPlaywrightBrowserSession } from '../lib/browser/playwright-driver.mjs';

const tooltipPage = () =>
    http.createServer((request, response) => {
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

test('unnamed icon buttons retain a synthetic name', async () => {
    const server = tooltipPage();
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

test('session.discoverLabels replaces synthetic names with visible Tooltip text', async () => {
    const server = tooltipPage();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const session = createPlaywrightBrowserSession({ headless: true });
    await session.start();
    try {
        const { port } = server.address();
        await session.navigate(`http://127.0.0.1:${port}/`);
        const before = await session.snapshot();
        const icon = before.controls.find((control) => control.role === 'button');
        assert.equal(icon.name, '图标:1');
        const after = await session.discoverLabels();
        const discovered = after.controls.find((control) => control.role === 'button');
        assert.equal(discovered.name, '删除');
    } finally {
        await session.close();
        await new Promise((resolve) => server.close(resolve));
    }
});
