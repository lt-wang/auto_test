import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { chromium } from 'playwright';
import { snapshotPlaywrightPage } from '../lib/browser/playwright-snapshot.mjs';

test('Playwright snapshot normalizes controls and redacts password values', async () => {
    const server = http.createServer((request, response) => {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(`
            <main>
                <label for="name">客户名称</label>
                <input id="name" placeholder="请输入客户名称" value="LayaAuto_1">
                <label for="password">密码</label>
                <input id="password" type="password" value="secret-value">
                <button aria-label="保存">保存</button>
                <input type="checkbox" aria-label="启用">
            </main>
        `);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
        const { port } = server.address();
        await page.goto(`http://127.0.0.1:${port}/`);
        const snapshot = await snapshotPlaywrightPage(page);
        assert.equal(snapshot.url, `http://127.0.0.1:${port}/`);
        assert.ok(snapshot.controls.some((control) => control.name === '客户名称'));
        assert.ok(snapshot.controls.some((control) => control.name === '保存'));
        const password = snapshot.controls.find((control) => control.role === 'password');
        assert.equal(password.value, '[REDACTED]');
    } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
    }
});

test('Playwright snapshot modal scope excludes background controls', async () => {
    const server = http.createServer((request, response) => {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end('<button>背景按钮</button><dialog open><button>保存</button></dialog>');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
        const { port } = server.address();
        await page.goto(`http://127.0.0.1:${port}/`);
        const snapshot = await snapshotPlaywrightPage(page, { scope: 'modal' });
        assert.ok(snapshot.controls.some((control) => control.name === '保存'));
        assert.ok(!snapshot.controls.some((control) => control.name === '背景按钮'));
    } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
    }
});

test('Playwright snapshot includes open Shadow DOM and iframe controls', async () => {
    const server = http.createServer((request, response) => {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(`
            <div id="host"></div>
            <iframe srcdoc="<button>帧内按钮</button>"></iframe>
            <script>
                const root = document.getElementById('host').attachShadow({ mode: 'open' });
                root.innerHTML = '<button>Shadow按钮</button>';
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
        assert.ok(snapshot.controls.some((control) => control.name === 'Shadow按钮'));
        assert.ok(snapshot.controls.some((control) => control.name === '帧内按钮'));
    } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
    }
});
