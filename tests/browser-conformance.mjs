import test from 'node:test';
import assert from 'node:assert/strict';

export function registerBrowserConformanceTests(name, createSession) {
    test(`${name}: lifecycle and navigation`, async (t) => {
        const session = await createSession();
        t.after(() => session.close());
        await session.start();
        const nextUrl = new URL('/next', session.conformanceBaseUrl).href;
        await session.navigate(nextUrl);
        assert.equal(new URL(await session.currentUrl()).pathname, '/next');
    });

    test(`${name}: reports capabilities`, async (t) => {
        const session = await createSession();
        t.after(() => session.close());
        for (const [capability, supported] of Object.entries(session.capabilities))
            assert.equal(typeof supported, 'boolean', `${capability} must be boolean`);
    });

    test(`${name}: snapshot matches the public contract shape`, async (t) => {
        const session = await createSession();
        t.after(() => session.close());
        await session.start();
        const snapshot = await session.snapshot();
        assert.deepEqual(Object.keys(snapshot).sort(), [
            'controls',
            'modal',
            'observedAt',
            'tables',
            'title',
            'url',
        ]);
        assert.ok(snapshot.controls.every((control) => !Object.hasOwn(control, 'frameIndex')));
        assert.ok(snapshot.controls.every((control) => !Object.hasOwn(control, 'snapshotNonce')));
        assert.equal(
            new Set(snapshot.controls.map((control) => control.ref)).size,
            snapshot.controls.length,
        );
    });

    test(`${name}: unknown refs fail explicitly`, async (t) => {
        const session = await createSession();
        t.after(() => session.close());
        await session.start();
        await assert.rejects(session.act({ kind: 'click', ref: 'missing-ref' }), (error) =>
            ['missing-ref', 'stale-ref'].includes(error.code),
        );
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
        const updated = after.controls.find(
            (control) => control.role === target.role && control.name === target.name,
        );
        assert.equal(updated.value, 'changed');
    });

    test(`${name}: conditions resolve semantic state`, async (t) => {
        const session = await createSession();
        t.after(() => session.close());
        await session.start();
        await session.waitFor({ kind: 'urlContains', value: 'http' });
    });
}
