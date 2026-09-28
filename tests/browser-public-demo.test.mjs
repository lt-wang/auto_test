import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createPlaywrightBrowserSession } from '../lib/browser/playwright-driver.mjs';

async function waitForServer(url) {
    for (let attempt = 0; attempt < 30; attempt++) {
        try {
            const response = await fetch(url);
            if (response.ok) return;
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('Demo server did not become ready');
}

test('Playwright driver can observe and query the public demo', async (t) => {
    const port = 18000 + Math.floor(Math.random() * 1000);
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
    await waitForServer(`${base}/customers`);
    await session.start();
    await session.navigate(`${base}/customers`);
    const snapshot = await session.snapshot();
    assert.ok(snapshot.controls.some((control) => control.name.includes('新增客户')));
    assert.ok(snapshot.controls.some((control) => control.name === '搜索'));
});
