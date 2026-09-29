import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createPlaywrightBrowserSession } from '../lib/browser/playwright-driver.mjs';
import { snapshotVisibleOptions } from '../lib/form.mjs';

async function waitForServer(url) {
    for (let attempt = 0; attempt < 30; attempt++) {
        try {
            if ((await fetch(url)).ok) return;
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('component fixture did not start');
}

test('public component fixtures cover native, custom select, virtual list and dialog', async (t) => {
    const port = 19000 + Math.floor(Math.random() * 1000);
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
    await waitForServer(`${base}/components`);
    await session.start();
    await session.navigate(`${base}/components`);

    let snapshot = await session.snapshot();
    const native = snapshot.controls.find((control) => control.name === '客户名称');
    const enabled = snapshot.controls.find((control) => control.name === '启用');
    assert.equal(native.required, true);
    assert.ok(enabled);
    await session.act({ kind: 'fill', ref: native.ref, value: '组件测试' });
    await session.act({ kind: 'check', ref: enabled.ref });
    snapshot = await session.snapshot();
    assert.equal(snapshot.controls.find((control) => control.name === '保存').disabled, false);

    const combo = snapshot.controls.find((control) => control.name === '状态');
    await session.act({ kind: 'click', ref: combo.ref });
    const options = snapshotVisibleOptions(await session.snapshot());
    assert.ok(options.some((option) => option.name === '待处理'));
    assert.ok(options.some((option) => option.name === '已完成'));
    await session.act({
        kind: 'click',
        ref: options.find((option) => option.name === '已完成').ref,
    });

    const virtualSnapshot = await session.snapshot();
    assert.ok(
        virtualSnapshot.controls.some(
            (control) => control.role === 'option' && control.name === '虚拟选项 1',
        ),
    );

    const open = virtualSnapshot.controls.find((control) => control.name === '打开标准弹窗');
    await session.act({ kind: 'click', ref: open.ref });
    await session.waitFor({ kind: 'textVisible', value: '弹窗正文', scope: 'modal' });
});
