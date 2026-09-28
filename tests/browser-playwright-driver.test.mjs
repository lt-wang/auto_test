import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createPlaywrightBrowserSession } from '../lib/browser/playwright-driver.mjs';

test('Playwright driver implements start, navigate, snapshot, action and close', async () => {
    const server = http.createServer((request, response) => {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end('<label for="name">客户名称</label><input id="name"><button>保存</button>');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    const session = createPlaywrightBrowserSession({ headless: true });
    try {
        await session.start();
        await session.navigate(`http://127.0.0.1:${port}/`);
        const snapshot = await session.snapshot();
        const input = snapshot.controls.find((control) => control.name === '客户名称');
        await session.act({ kind: 'fill', ref: input.ref, value: 'LayaAuto_1' });
        const updated = await session.snapshot();
        assert.equal(
            updated.controls.find((control) => control.name === '客户名称').value,
            'LayaAuto_1',
        );
    } finally {
        await session.close();
        await new Promise((resolve) => server.close(resolve));
    }
});
