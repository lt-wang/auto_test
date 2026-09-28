import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { chromium } from 'playwright';
import { waitForPlaywrightCondition } from '../lib/browser/playwright-conditions.mjs';

test('control state resolves a semantic query at wait time', async () => {
    const server = http.createServer((request, response) => {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(
            '<button disabled>保存</button><script>setTimeout(() => document.querySelector("button").disabled = false, 20)</script>',
        );
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
        const { port } = server.address();
        await page.goto(`http://127.0.0.1:${port}/`);
        const result = await waitForPlaywrightCondition(
            page,
            { kind: 'controlState', query: { name: '保存', role: 'button' }, state: 'enabled' },
            { timeout: 1000, interval: 10 },
        );
        assert.equal(result.matched, true);
    } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
    }
});
