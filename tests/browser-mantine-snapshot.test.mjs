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

test('Mantine modals, portals, options, menus and errors are observable', async (t) => {
    const port = 19100 + Math.floor(Math.random() * 500);
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
    await waitForServer(`${base}/mantine-components`);
    await session.start();
    await session.navigate(`${base}/mantine-components`);

    let snapshot = await session.snapshot();
    const open = snapshot.controls.find((control) => control.name === '打开编辑弹窗');
    await session.act({ kind: 'click', ref: open.ref });

    snapshot = await session.snapshot();
    assert.equal(snapshot.modal.name, '编辑客户');
    assert.equal(snapshot.modal.role, 'dialog');
    assert.equal(snapshot.modal.ariaModal, true);
    const status = snapshot.controls.find((control) => control.name === '状态');
    assert.equal(status.component, 'select');
    assert.equal(status.expanded, false);
    const save = snapshot.controls.find((control) => control.name === '保存');
    assert.equal(save.adapter, 'mantine');
    assert.equal(save.component, 'button');

    const menu = snapshot.controls.find((control) => control.name === '更多');
    await session.act({ kind: 'click', ref: menu.ref });
    snapshot = await session.snapshot();
    assert.ok(
        snapshot.controls.some((control) => control.role === 'menuitem' && control.name === '删除'),
    );

    const currentStatus = snapshot.controls.find((control) => control.name === '状态');
    await session.act({ kind: 'click', ref: currentStatus.ref });
    snapshot = await session.snapshot();
    assert.ok(
        snapshot.controls.some((control) => control.role === 'option' && control.name === '已完成'),
    );

    const deadline = snapshot.controls.find((control) => control.name === '截止日期');
    assert.equal(deadline.invalid, true);
    assert.equal(deadline.validationMessage, '日期无效');
});
