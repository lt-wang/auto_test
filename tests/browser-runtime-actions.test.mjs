import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
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
