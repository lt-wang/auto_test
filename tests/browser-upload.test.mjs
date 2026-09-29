import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { snapshotPlaywrightPage } from '../lib/browser/playwright-snapshot.mjs';
import { executePlaywrightCommand } from '../lib/browser/playwright-actions.mjs';

test('upload sets a hidden FileButton input and dispatches a browser change event', async () => {
    const server = http.createServer((request, response) => {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(`
            <button id="dropzone" onclick="document.getElementById('file').click()">上传附件</button>
            <input id="file" type="file" style="display:none">
            <output id="name"></output>
            <script>
                document.getElementById('file').addEventListener('change', (event) => {
                    document.getElementById('name').textContent = event.target.files[0]?.name || '';
                });
            </script>
        `);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'laya-upload-'));
    const file = path.join(dir, 'evidence.txt');
    await fs.writeFile(file, 'evidence');
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
        const { port } = server.address();
        await page.goto(`http://127.0.0.1:${port}/`);
        const snapshot = await snapshotPlaywrightPage(page);
        const target = snapshot.controls.find((control) => control.name === '上传附件');
        const refs = new Map(snapshot.controls.map((control) => [control.ref, control]));
        await executePlaywrightCommand(page, refs, {
            kind: 'upload',
            ref: target.ref,
            files: [file],
        });
        assert.equal(await page.locator('#name').textContent(), 'evidence.txt');
    } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
        await fs.rm(dir, { recursive: true, force: true });
    }
});
