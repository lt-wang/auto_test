import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createBrowserUseBrowserSession } from '../lib/browser/browser-use-driver.mjs';

test(
    'browser-use adapter implements the BrowserSession contract',
    { skip: process.env.BROWSER_USE_E2E !== '1' },
    async () => {
        const server = http.createServer((request, response) => {
            response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            response.end(
                '<label for="name">客户名称</label><input id="name"><button>保存</button>',
            );
        });
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        const { port } = server.address();
        const session = await createBrowserUseBrowserSession({
            python: process.env.BROWSER_USE_PYTHON || 'python',
            headless: true,
        });
        try {
            await session.navigate(`http://127.0.0.1:${port}/`);
            const snapshot = await session.snapshot();
            assert.equal(session.backend, 'browser-use');
            assert.ok(snapshot.controls.some((control) => control.name === '客户名称'));
            assert.ok(snapshot.controls.some((control) => control.name === '保存'));
        } finally {
            await session.close();
            await new Promise((resolve) => server.close(resolve));
        }
    },
);
