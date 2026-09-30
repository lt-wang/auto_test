import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { waitForPlaywrightCondition } from '../lib/browser/playwright-conditions.mjs';
import { snapshotPlaywrightPage } from '../lib/browser/playwright-snapshot.mjs';
import { PNG } from 'pngjs';

test('visualDiff matches identical baseline and reports changed pixels', async () => {
    const server = await import('node:http').then(({ default: http }) => {
        const instance = http.createServer((request, response) => {
            response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            response.end('<body style="margin:0;background:white"></body>');
        });
        return new Promise((resolve) => instance.listen(0, '127.0.0.1', () => resolve(instance)));
    });
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'laya-visual-'));
    const baseline = path.join(dir, 'baseline.png');
    const visualDir = path.join(dir, 'visual');
    const png = new PNG({ width: 20, height: 20 });
    png.data.fill(255);
    await fs.writeFile(baseline, PNG.sync.write(png));
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 20, height: 20 } });
    try {
        const { port } = server.address();
        await page.goto(`http://127.0.0.1:${port}/`);
        const result = await waitForPlaywrightCondition(
            page,
            { kind: 'visualDiff', baseline, threshold: 0.1 },
            { timeout: 1000, interval: 10, visualDir },
        );
        assert.equal(result.matched, true);
        assert.equal(result.changed, 0);
        assert.equal(result.changedRatio, 0);
        assert.equal(result.score, 0);
        await Promise.all(Object.values(result.artifacts).map((file) => fs.access(file)));
    } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
        await fs.rm(dir, { recursive: true, force: true });
    }
});

test('visualDiff resolves a plain canvas through an opaque snapshot ref', async () => {
    const server = await import('node:http').then(({ default: http }) => {
        const instance = http.createServer((request, response) => {
            response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            response.end(
                '<canvas id="target" data-testid="canvas-target" width="24" height="16" style="display:block;background:rgb(12,34,56)"></canvas>',
            );
        });
        return new Promise((resolve) => instance.listen(0, '127.0.0.1', () => resolve(instance)));
    });
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'laya-canvas-visual-'));
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 100, height: 100 } });
    try {
        const { port } = server.address();
        await page.goto(`http://127.0.0.1:${port}/`);
        const snapshot = await snapshotPlaywrightPage(page);
        const canvas = snapshot.controls.find((control) => control.tag === 'canvas');
        assert.ok(canvas);
        assert.equal(canvas.component, 'canvas');
        assert.equal(canvas.name, 'canvas-target');
        const baseline = path.join(dir, 'canvas.png');
        await page
            .locator(`[data-laya-live-ref="${canvas.ref}"]`)
            .screenshot({ path: baseline, animations: 'disabled' });
        const result = await waitForPlaywrightCondition(
            page,
            { kind: 'visualDiff', ref: canvas.ref, baseline },
            {
                timeout: 1000,
                interval: 10,
                refs: new Map([[canvas.ref, canvas]]),
            },
        );
        assert.equal(result.matched, true);
    } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
        await fs.rm(dir, { recursive: true, force: true });
    }
});

test('visualDiff fails at the maximum accepted threshold when pixels change', async () => {
    const server = await import('node:http').then(({ default: http }) => {
        const instance = http.createServer((request, response) => {
            response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            response.end('<body style="margin:0;background:white"></body>');
        });
        return new Promise((resolve) => instance.listen(0, '127.0.0.1', () => resolve(instance)));
    });
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'laya-visual-mismatch-'));
    const baseline = path.join(dir, 'baseline.png');
    const visualDir = path.join(dir, 'visual');
    const png = new PNG({ width: 20, height: 20 });
    png.data.fill(0);
    await fs.writeFile(baseline, PNG.sync.write(png));
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 20, height: 20 } });
    try {
        const { port } = server.address();
        await page.goto(`http://127.0.0.1:${port}/`);
        let failure;
        try {
            await waitForPlaywrightCondition(
                page,
                { kind: 'visualDiff', baseline, threshold: 0.9 },
                { timeout: 50, interval: 10, visualDir },
            );
            assert.fail('expected visualDiff to time out');
        } catch (error) {
            failure = error;
        }
        assert.equal(failure.code, 'wait-timeout');
        assert.equal(failure.changed, 400);
        assert.equal(failure.changedRatio, 1);
        assert.equal(failure.score, 1);
        await Promise.all(Object.values(failure.artifacts).map((file) => fs.access(file)));
    } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
        await fs.rm(dir, { recursive: true, force: true });
    }
});
