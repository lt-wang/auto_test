import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { chromium } from 'playwright';
import { validateSnapshot } from '../lib/browser/contract.mjs';
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

test('Playwright snapshot redacts URLs, sensitive values and disables value capture', async () => {
    const server = http.createServer((request, response) => {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(`
            <label for="token">API Key</label>
            <input id="token" name="api_key" value="secret-token">
            <label for="password">密码</label>
            <input id="password" type="PASSWORD" value="password-value">
            <a href="/next?token=secret#frag">下一步</a>
        `);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
        const { port } = server.address();
        const base = `http://127.0.0.1:${port}`;
        await page.goto(`${base}/?token=query-secret#fragment`);
        const snapshot = await snapshotPlaywrightPage(page);
        assert.equal(snapshot.url, `${base}/`);
        const key = snapshot.controls.find((control) => control.name === 'API Key');
        assert.equal(key.value, '[REDACTED]');
        const password = snapshot.controls.find((control) => control.role === 'password');
        assert.equal(password.value, '[REDACTED]');
        const link = snapshot.controls.find((control) => control.name === '下一步');
        assert.equal(link.href, `${base}/next`);
        const withoutValues = await snapshotPlaywrightPage(page, { includeValues: false });
        assert.ok(
            withoutValues.controls.every(
                (control) => control.value === '' || control.value === '[REDACTED]',
            ),
        );
    } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
    }
});

test('explicit modal scope fails closed when no modal exists', async () => {
    const server = http.createServer((request, response) => {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end('<button>背景按钮</button>');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
        const { port } = server.address();
        await page.goto(`http://127.0.0.1:${port}/`);
        const snapshot = await snapshotPlaywrightPage(page, { scope: 'modal' });
        assert.deepEqual(snapshot.controls, []);
        assert.equal(snapshot.modal, null);
    } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
    }
});

test('public snapshot exposes the normalized shape without internal objects', async () => {
    const server = http.createServer((request, response) => {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end('<button>保存</button>');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
        const { port } = server.address();
        await page.goto(`http://127.0.0.1:${port}/`);
        const raw = await snapshotPlaywrightPage(page);
        const publicSnapshot = validateSnapshot({
            url: raw.url,
            title: raw.title,
            controls: raw.controls.map(
                ({
                    ref,
                    frameRef,
                    tag,
                    role,
                    name,
                    label,
                    placeholder,
                    value,
                    disabled,
                    readonly,
                    checked,
                    selected,
                    multiple,
                    options,
                    rowKey,
                    context,
                    inPanel,
                    visible,
                    href,
                }) => ({
                    ref,
                    frameRef,
                    tag,
                    role,
                    name,
                    label,
                    placeholder,
                    value,
                    disabled,
                    readonly,
                    checked,
                    selected,
                    multiple,
                    options,
                    rowKey,
                    context,
                    inPanel,
                    visible,
                    href,
                }),
            ),
            tables: raw.tables,
            modal: raw.modal,
            observedAt: raw.observedAt,
        });
        assert.equal(Object.hasOwn(publicSnapshot, 'frames'), false);
        assert.equal(Object.hasOwn(publicSnapshot.controls[0], 'frameIndex'), false);
        assert.equal(Object.hasOwn(publicSnapshot.controls[0], 'snapshotNonce'), false);
    } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
    }
});

test('Playwright snapshot exposes form validation metadata', async () => {
    const server = http.createServer((request, response) => {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(`
            <label for="email">邮箱</label>
            <input id="email" name="email" required autocomplete="email">
            <script>
                const input = document.getElementById('email');
                input.setCustomValidity('请输入邮箱');
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
        const email = snapshot.controls.find((control) => control.name === '邮箱');
        assert.equal(email.required, true);
        assert.equal(email.invalid, true);
        assert.equal(email.validationMessage, '请输入邮箱');
        assert.equal(email.id, 'email');
        assert.equal(email.htmlName, 'email');
        assert.equal(email.autocomplete, 'email');
    } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
    }
});

test('snapshot synthesizes row keys for native tables without data-row-key', async () => {
    const server = http.createServer((request, response) => {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(`
            <table>
                <tbody>
                    <tr><td>张三</td><td><button>查看</button></td></tr>
                    <tr><td>张三</td><td><button>查看</button></td></tr>
                </tbody>
            </table>
        `);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
        const { port } = server.address();
        await page.goto(`http://127.0.0.1:${port}/`);
        const snapshot = await snapshotPlaywrightPage(page);
        const buttons = snapshot.controls.filter((control) => control.name === '查看');
        assert.equal(buttons.length, 2);
        assert.equal(new Set(buttons.map((control) => control.rowKey)).size, 2);
        assert.ok(buttons.every((control) => control.rowKey.startsWith('table-0:row-')));
    } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
    }
});

test('snapshot keeps controls outside tables unbound from row keys', async () => {
    const server = http.createServer((request, response) => {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end('<button>保存</button>');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
        const { port } = server.address();
        await page.goto(`http://127.0.0.1:${port}/`);
        const snapshot = await snapshotPlaywrightPage(page);
        const button = snapshot.controls.find((control) => control.name === '保存');
        assert.equal(button.rowKey, '');
    } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
    }
});

test('snapshot preserves explicit row keys on non-tbody rows', async () => {
    const server = http.createServer((request, response) => {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(`
            <table>
                <thead>
                    <tr data-row-key="head"><th><button>Sort</button></th></tr>
                </thead>
            </table>
        `);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
        const { port } = server.address();
        await page.goto(`http://127.0.0.1:${port}/`);
        const snapshot = await snapshotPlaywrightPage(page);
        const button = snapshot.controls.find((control) => control.name === 'Sort');
        assert.equal(button.rowKey, 'head');
    } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
    }
});
