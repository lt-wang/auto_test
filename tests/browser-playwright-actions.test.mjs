import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { chromium } from 'playwright';
import { snapshotPlaywrightPage } from '../lib/browser/playwright-snapshot.mjs';
import { executePlaywrightCommand } from '../lib/browser/playwright-actions.mjs';

async function fixture() {
    const server = http.createServer((request, response) => {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(`
            <label for="name">客户名称</label>
            <input id="name">
            <button id="save" disabled>保存</button>
            <script>
                document.getElementById('name').addEventListener('input', (event) => {
                    document.getElementById('save').disabled = !event.target.value;
                });
            </script>
        `);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const { port } = server.address();
    await page.goto(`http://127.0.0.1:${port}/`);
    return {
        page,
        async close() {
            await browser.close();
            await new Promise((resolve) => server.close(resolve));
        },
    };
}

test('fill and click use opaque refs', async () => {
    const item = await fixture();
    try {
        let snapshot = await snapshotPlaywrightPage(item.page);
        const input = snapshot.controls.find((control) => control.name === '客户名称');
        const refs = new Map(snapshot.controls.map((control) => [control.ref, control]));
        await executePlaywrightCommand(item.page, refs, {
            kind: 'fill',
            ref: input.ref,
            value: 'LayaAuto_1',
        });
        snapshot = await snapshotPlaywrightPage(item.page);
        const save = snapshot.controls.find((control) => control.name === '保存');
        assert.equal(save.disabled, false);
        const currentRefs = new Map(snapshot.controls.map((control) => [control.ref, control]));
        await executePlaywrightCommand(item.page, currentRefs, {
            kind: 'click',
            ref: save.ref,
        });
    } finally {
        await item.close();
    }
});

test('stale refs fail explicitly', async () => {
    const item = await fixture();
    try {
        const snapshot = await snapshotPlaywrightPage(item.page);
        const input = snapshot.controls.find((control) => control.name === '客户名称');
        await item.page.reload();
        const refs = new Map(snapshot.controls.map((control) => [control.ref, control]));
        await assert.rejects(
            executePlaywrightCommand(item.page, refs, {
                kind: 'fill',
                ref: input.ref,
                value: 'later',
            }),
            (error) => error.code === 'stale-ref',
        );
    } finally {
        await item.close();
    }
});
