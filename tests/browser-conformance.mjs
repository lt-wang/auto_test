import test from 'node:test';
import assert from 'node:assert/strict';

export function registerBrowserConformanceTests(name, createSession) {
    test(`${name}: lifecycle and navigation`, async (t) => {
        const session = await createSession();
        t.after(() => session.close());
        await session.start();
        await session.navigate('https://app.test/next');
        assert.equal(await session.currentUrl(), 'https://app.test/next');
    });

    test(`${name}: snapshot returns stable control refs`, async (t) => {
        const session = await createSession();
        t.after(() => session.close());
        await session.start();
        const snapshot = await session.snapshot();
        assert.ok(snapshot.controls.length > 0);
        assert.ok(snapshot.controls.every((control) => typeof control.ref === 'string'));
    });

    test(`${name}: fill changes only the addressed control`, async (t) => {
        const session = await createSession();
        t.after(() => session.close());
        await session.start();
        const snapshot = await session.snapshot();
        const target =
            snapshot.controls.find((control) => control.role === 'textbox') || snapshot.controls[0];
        await session.act({ kind: 'fill', ref: target.ref, value: 'changed' });
        const after = await session.snapshot();
        assert.equal(after.controls.find((control) => control.ref === target.ref).value, 'changed');
    });

    test(`${name}: conditions resolve semantic state`, async (t) => {
        const session = await createSession();
        t.after(() => session.close());
        await session.start();
        await session.waitFor({ kind: 'urlContains', value: 'http' });
    });
}
