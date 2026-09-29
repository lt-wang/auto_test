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

test('text conditions honor modal scope', async () => {
    const server = http.createServer((request, response) => {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end('<p>背景文本</p><dialog open><p>弹窗文本</p></dialog>');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
        const { port } = server.address();
        await page.goto(`http://127.0.0.1:${port}/`);
        await waitForPlaywrightCondition(
            page,
            { kind: 'textVisible', value: '弹窗文本', scope: 'modal' },
            { timeout: 1000, interval: 10 },
        );
        await assert.rejects(
            waitForPlaywrightCondition(
                page,
                { kind: 'textVisible', value: '背景文本', scope: 'modal' },
                { timeout: 100, interval: 10 },
            ),
            (error) => error.code === 'wait-timeout',
        );
    } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
    }
});

test('ambiguous semantic queries fail instead of matching the first control', async () => {
    const server = http.createServer((request, response) => {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end('<button disabled>保存</button><button>保存</button>');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
        const { port } = server.address();
        await page.goto(`http://127.0.0.1:${port}/`);
        await assert.rejects(
            waitForPlaywrightCondition(
                page,
                {
                    kind: 'controlState',
                    query: { name: '保存', role: 'button' },
                    state: 'enabled',
                },
                { timeout: 1000, interval: 10 },
            ),
            (error) => error.code === 'ambiguous-query',
        );
    } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
    }
});
