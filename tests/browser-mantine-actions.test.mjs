import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { chromium } from 'playwright';
import { snapshotPlaywrightPage } from '../lib/browser/playwright-snapshot.mjs';
import { executePlaywrightCommand } from '../lib/browser/playwright-actions.mjs';

test('select chooses a Mantine listbox option by exact text', async () => {
    const server = http.createServer((request, response) => {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(`
            <button id="status" role="combobox" aria-haspopup="listbox" aria-label="状态" aria-expanded="false">未选择</button>
            <div id="options" role="listbox" hidden>
                <div role="option">待处理</div>
                <div role="option">已完成</div>
            </div>
            <script>
                const status = document.getElementById('status');
                const options = document.getElementById('options');
                status.addEventListener('click', () => {
                    options.hidden = false;
                    status.setAttribute('aria-expanded', 'true');
                });
                for (const option of options.querySelectorAll('[role="option"]')) {
                    option.addEventListener('click', () => {
                        status.textContent = option.textContent;
                        status.setAttribute('aria-expanded', 'false');
                        options.hidden = true;
                    });
                }
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
        const status = snapshot.controls.find((control) => control.name === '状态');
        const refs = new Map(snapshot.controls.map((control) => [control.ref, control]));
        await executePlaywrightCommand(page, refs, {
            kind: 'select',
            ref: status.ref,
            values: ['已完成'],
        });
        assert.equal(await page.locator('#status').textContent(), '已完成');
    } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
    }
});

test('DatePicker accepts a typed value and DataTable pagination remains observable', async () => {
    const server = http.createServer((request, response) => {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(`
            <label for="deadline">截止日期</label>
            <input id="deadline" class="mantine-DateInput-input" valueFormat="YYYY-MM-DD">
            <table class="mantine-datatable-table"><thead><tr><th>名称</th></tr></thead><tbody><tr><td>A</td></tr></tbody></table>
            <div class="mantine-datatable-pagination">
                <button aria-label="Previous page">Previous</button>
                <button aria-label="Next page">Next</button>
            </div>
        `);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
        const { port } = server.address();
        await page.goto(`http://127.0.0.1:${port}/`);
        const snapshot = await snapshotPlaywrightPage(page);
        const deadline = snapshot.controls.find((control) => control.name === '截止日期');
        const refs = new Map(snapshot.controls.map((control) => [control.ref, control]));
        await executePlaywrightCommand(page, refs, {
            kind: 'fill',
            ref: deadline.ref,
            value: '2026-09-30',
        });
        assert.equal(await page.locator('#deadline').inputValue(), '2026-09-30');
        assert.ok(snapshot.controls.some((control) => control.component === 'table-pagination'));
    } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
    }
});
