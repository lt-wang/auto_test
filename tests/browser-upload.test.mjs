import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { snapshotPlaywrightPage } from '../lib/browser/playwright-snapshot.mjs';
import { BrowserContractError } from '../lib/browser/contract.mjs';
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

test('upload fails closed when the target scope contains multiple file inputs', async () => {
    const server = http.createServer((request, response) => {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(`
            <button id="dropzone">上传附件</button>
            <input id="first" type="file" style="display:none">
            <input id="second" type="file" style="display:none">
        `);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'laya-upload-ambiguous-'));
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
        await assert.rejects(
            executePlaywrightCommand(page, refs, {
                kind: 'upload',
                ref: target.ref,
                files: [file],
            }),
            (error) => error instanceof BrowserContractError && error.code === 'ambiguous-query',
        );
    } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
        await fs.rm(dir, { recursive: true, force: true });
    }
});

test('upload chooser fallback preserves click errors and settles chooser rejection', async () => {
    const clickError = new Error('click failed');
    const chooserError = new Error('chooser failed');
    let chooserSettled = false;
    const chooserPromise = new Promise((_, reject) => {
        setTimeout(() => {
            chooserSettled = true;
            reject(chooserError);
        }, 20);
    });
    const emptyLocator = {
        async count() {
            return 0;
        },
    };
    const targetLocator = {
        first() {
            return this;
        },
        async count() {
            return 1;
        },
        locator() {
            return emptyLocator;
        },
        async click() {
            throw clickError;
        },
    };
    const page = {
        frames() {
            return [{ locator: () => targetLocator }];
        },
        waitForEvent() {
            return chooserPromise;
        },
    };
    const refs = new Map([['r1', { ref: 'r1', frameIndex: 0, tag: 'button', disabled: false }]]);

    await assert.rejects(
        executePlaywrightCommand(page, refs, {
            kind: 'upload',
            ref: 'r1',
            files: ['evidence.txt'],
        }),
        (error) => error === clickError,
    );
    assert.equal(chooserSettled, true);
});
