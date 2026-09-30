import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { chromium } from 'playwright';
import { snapshotPlaywrightPage } from '../lib/browser/playwright-snapshot.mjs';
import { executePlaywrightCommand } from '../lib/browser/playwright-actions.mjs';

test('drag moves a draggable element to another element', async () => {
    const server = http.createServer((request, response) => {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(`
            <div id="source" draggable="true" style="width:80px;height:40px">卡片</div>
            <div id="target" role="button" tabindex="0" style="width:200px;height:80px;margin-top:40px">目标区域</div>
            <script>
                const source = document.getElementById('source');
                const target = document.getElementById('target');
                target.addEventListener('dragover', (event) => {
                    event.preventDefault();
                    target.dataset.dragover = 'true';
                });
                target.addEventListener('drop', (event) => {
                    event.preventDefault();
                    target.dataset.drop = 'true';
                    target.textContent = '已放置';
                });
                source.addEventListener('dragend', () => {
                    target.dataset.dragEndSawDrop = target.dataset.drop === 'true' ? 'true' : 'false';
                    target.textContent = target.dataset.dragEndSawDrop === 'true' ? '已移动' : '未收到放置';
                });
            </script>
        `);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
        const { port } = server.address();
        await page.goto(`http://127.0.0.1:${port}/`);
        const snapshot = await snapshotPlaywrightPage(page);
        const source = snapshot.controls.find((control) => control.name === '卡片');
        const target = snapshot.tables.length
            ? null
            : snapshot.controls.find((control) => control.name === '目标区域');
        const refs = new Map(snapshot.controls.map((control) => [control.ref, control]));
        assert.ok(source, 'source should be observable as a pointer control');
        assert.ok(target, 'target should be observable as a pointer control');
        await executePlaywrightCommand(page, refs, {
            kind: 'drag',
            ref: source.ref,
            toRef: target.ref,
        });
        assert.equal(await page.locator('#target').getAttribute('data-dragover'), 'true');
        assert.equal(await page.locator('#target').getAttribute('data-drop'), 'true');
        assert.equal(await page.locator('#target').getAttribute('data-drag-end-saw-drop'), 'true');
        assert.equal(await page.locator('#target').textContent(), '已移动');
    } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
    }
});
