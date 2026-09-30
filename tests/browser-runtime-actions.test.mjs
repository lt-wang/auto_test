import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { chromium } from 'playwright';
import { executePlaywrightCommand } from '../lib/browser/playwright-actions.mjs';
import { createPlaywrightBrowserSession } from '../lib/browser/playwright-driver.mjs';

async function waitForServer(url) {
    for (let attempt = 0; attempt < 30; attempt++) {
        try {
            if ((await fetch(url)).ok) return;
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('fixture did not start');
}

async function listen(server) {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${server.address().port}`;
}

test('runtime action reads ECharts option through the injected bridge', async (t) => {
    const port = 19800 + Math.floor(Math.random() * 300);
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
    const chart = await session.runtimeSnapshot();
    const result = await session.act({
        kind: 'runtime',
        action: 'echarts.option',
        args: { id: chart.echarts[0].id },
    });
    assert.equal(result.value.series.length, 1);
});

test('runtime actions use plain canvas refs from the snapshot', async (t) => {
    const port = 19900 + Math.floor(Math.random() * 300);
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
    const snapshot = await session.snapshot();
    const canvases = snapshot.controls.filter((control) => control.component === 'canvas');
    assert.equal(canvases.length, 2);
    assert.ok(canvases.every((control) => control.tag === 'canvas'));
    assert.ok(canvases.every((control) => control.role === 'canvas'));
    assert.ok(canvases.some((control) => control.name === 'chart'));
    assert.ok(canvases.some((control) => control.name === 'map'));

    const chart = canvases.find((control) => control.name === 'chart');
    const hovered = await session.act({
        kind: 'runtime',
        action: 'canvas.hover',
        ref: chart.ref,
    });
    assert.equal(hovered.ok, true);
    const clicked = await session.act({
        kind: 'runtime',
        action: 'canvas.click',
        ref: chart.ref,
    });
    assert.equal(clicked.ok, true);
});

test('runtime actions resolve requested instances and reject ambiguity', async (t) => {
    const server = http.createServer((request, response) => {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(`
            <canvas id="a" width="40" height="30"></canvas>
            <canvas id="b" width="40" height="30"></canvas>
            <script>
                window.echarts = {
                    init: (element) => ({
                        getOption: () => ({ series: [{ type: element.id }] }),
                    }),
                };
                window.mapboxgl = {
                    Map: class {
                        constructor(options) {
                            this.targetId = options.id;
                            this.center = { lng: 1, lat: 2 };
                            this.zoom = 3;
                        }
                        setCenter(center) {
                            this.center = { lng: center[0], lat: center[1] };
                        }
                        getCenter() {
                            return this.center;
                        }
                        setZoom(zoom) {
                            this.zoom = zoom;
                        }
                        getZoom() {
                            return this.zoom;
                        }
                    },
                };
                window.echarts.init(document.getElementById('a'));
                window.echarts.init(document.getElementById('b'));
                new window.mapboxgl.Map({ id: 'a' });
                new window.mapboxgl.Map({ id: 'b' });
            </script>
        `);
    });
    const base = await listen(server);
    const session = createPlaywrightBrowserSession({ headless: true });
    t.after(async () => {
        await session.close();
        await new Promise((resolve) => server.close(resolve));
    });
    await session.start();
    await session.navigate(base);

    const runtime = await session.runtimeSnapshot();
    assert.equal(runtime.echarts.length, 2);
    assert.equal(runtime.maps.length, 2);

    const option = await session.act({
        kind: 'runtime',
        action: 'echarts.option',
        args: { id: runtime.echarts[1].id },
    });
    assert.deepEqual(option.value.series, [{ type: 'b' }]);

    const centered = await session.act({
        kind: 'runtime',
        action: 'map.center',
        args: { id: runtime.maps[1].id, lng: 10, lat: 20 },
    });
    assert.deepEqual(centered.value.center, { lng: 10, lat: 20 });

    await assert.rejects(
        () =>
            session.act({
                kind: 'runtime',
                action: 'map.zoom',
                args: { zoom: 5 },
            }),
        (error) => error.code === 'ambiguous-query',
    );
    await assert.rejects(
        () => session.act({ kind: 'runtime', action: 'echarts.option' }),
        (error) => error.code === 'ambiguous-query',
    );

    const updated = await session.runtimeSnapshot();
    assert.deepEqual(updated.maps[0].center, { lng: 1, lat: 2 });
    assert.deepEqual(updated.maps[1].center, { lng: 10, lat: 20 });
});

test('duplicate live refs fail closed before runtime or shared actions run', async (t) => {
    const browser = await chromium.launch({ headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.setContent(`
        <canvas data-laya-live-ref="dup" width="30" height="20"></canvas>
        <canvas data-laya-live-ref="dup" width="30" height="20"></canvas>
    `);
    const refs = new Map([['dup', { ref: 'dup', frameIndex: 0, disabled: false }]]);
    await assert.rejects(
        () =>
            executePlaywrightCommand(page, refs, {
                kind: 'runtime',
                action: 'canvas.click',
                ref: 'dup',
            }),
        (error) => error.code === 'ambiguous-query',
    );
    await assert.rejects(
        () => executePlaywrightCommand(page, refs, { kind: 'click', ref: 'dup' }),
        (error) => error.code === 'ambiguous-query',
    );
});
