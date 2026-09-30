import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { waitForPlaywrightCondition } from '../lib/browser/playwright-conditions.mjs';
import { PNG } from 'pngjs';

test('visualDiff matches identical baseline and reports changed pixels', async () => {
    const server = await import('node:http').then(({ default: http }) => {
        const instance = http.createServer((request, response) => {
            response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            response.end('<body style="margin:0;background:white"></body>');
        });
        return new Promise((resolve) => instance.listen(0, '127.0.0.1', () => resolve(instance)));
    });
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'laya-visual-'));
    const baseline = path.join(dir, 'baseline.png');
    const png = new PNG({ width: 20, height: 20 });
    png.data.fill(255);
    await fs.writeFile(baseline, PNG.sync.write(png));
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 20, height: 20 } });
    try {
        const { port } = server.address();
        await page.goto(`http://127.0.0.1:${port}/`);
        const result = await waitForPlaywrightCondition(
            page,
            { kind: 'visualDiff', baseline, threshold: 0.1 },
            { timeout: 1000, interval: 10 },
        );
        assert.equal(result.matched, true);
    } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
        await fs.rm(dir, { recursive: true, force: true });
    }
});
