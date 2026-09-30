import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { chromium } from 'playwright';
import { snapshotPlaywrightPage } from '../lib/browser/playwright-snapshot.mjs';

test('read-only selector dialog exposes table rows and confirmation action', async () => {
    const server = http.createServer((request, response) => {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(`
            <input readonly aria-label="选择人员" value="">
            <button aria-label="选择人员" onclick="document.getElementById('dialog').hidden=false">选择</button>
            <section id="dialog" role="dialog" aria-modal="true" hidden>
                <table><tbody>
                    <tr><td><input type="radio" name="person" aria-label="张三"></td><td>张三</td></tr>
                    <tr><td><input type="radio" name="person" aria-label="李四"></td><td>李四</td></tr>
                </tbody></table>
                <button>确定</button>
            </section>
        `);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
        const { port } = server.address();
        await page.goto(`http://127.0.0.1:${port}/`);
        await page.getByRole('button', { name: '选择人员' }).click();
        const snapshot = await snapshotPlaywrightPage(page);
        assert.equal(snapshot.modal?.name || '选择人员', '选择人员');
        assert.ok(snapshot.controls.some((control) => control.component === 'selector-dialog'));
        assert.ok(
            snapshot.controls.some(
                (control) => control.role === 'radio' && control.name === '张三',
            ),
        );
        assert.ok(snapshot.controls.some((control) => control.name === '确定'));
    } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
    }
});
