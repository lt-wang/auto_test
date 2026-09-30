import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { createPlaywrightBrowserSession } from '../lib/browser/playwright-driver.mjs';
import { installRuntimeInstrumentation } from '../lib/browser/runtime-instrumentation.mjs';

async function waitForServer(url) {
    for (let attempt = 0; attempt < 30; attempt++) {
        try {
            if ((await fetch(url)).ok) return;
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('fixture did not start');
}

test('runtime instrumentation observes canvas echarts and mapbox instances', async (t) => {
    const port = 19700 + Math.floor(Math.random() * 400);
    const base = `http://127.0.0.1:${port}`;
    const server = spawn(process.execPath, ['examples/demo-server.mjs'], {
        cwd: process.cwd(),
        env: { ...process.env, PORT: String(port) },
        stdio: 'ignore',
    });
    const session = createPlaywrightBrowserSession({ headless: true });
    t.after(async () => {
        await session.close();
        server.kill();
    });
    await waitForServer(`${base}/canvas-components`);
    await session.start();
    await session.navigate(`${base}/canvas-components`);
    const runtime = await session.runtimeSnapshot();
    assert.equal(runtime.canvases.length, 2);
    // The fixture mirrors the real ECharts UMD sequence: the empty namespace is
    // assigned first and init is populated afterwards. A single observed
    // instance proves the later-assigned init was intercepted and wrapped.
    assert.equal(runtime.echarts.length, 1);
    assert.equal(runtime.echarts[0].series, 1);
    assert.equal(runtime.maps.length, 1);
    assert.deepEqual(runtime.maps[0].center, { lng: 116.397, lat: 39.908 });
});

test('runtime instrumentation wraps a lazily-populated echarts init', async (t) => {
    const browser = await chromium.launch({ headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.addInitScript(installRuntimeInstrumentation);
    await page.goto('data:text/html,<canvas id="chart"></canvas>');
    const result = await page.evaluate(() => {
        window.echarts = {};
        const rawInit = () => ({ getOption: () => ({ series: [{ type: 'line' }] }) });
        window.echarts.init = rawInit;
        const assignedInit = window.echarts.init;
        assignedInit(document.getElementById('chart'));
        return {
            intercepted: assignedInit !== rawInit,
            wrapped: assignedInit.__layaWrapped === true,
            snapshot: window.__layaRuntime.snapshot(),
        };
    });
    assert.equal(result.intercepted, true);
    assert.equal(result.wrapped, true);
    assert.equal(result.snapshot.echarts.length, 1);
    assert.equal(result.snapshot.echarts[0].series, 1);
});
