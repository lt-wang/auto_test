import test from 'node:test';
import assert from 'node:assert/strict';
import {
    BrowserContractError,
    assertCapability,
    validateCommand,
    validateCondition,
    validateSnapshot,
} from '../lib/browser/contract.mjs';

test('commands reject raw selectors and require opaque refs', () => {
    assert.throws(
        () => validateCommand({ kind: 'click', selector: '#save' }),
        (error) => error instanceof BrowserContractError && error.code === 'invalid-command',
    );
    assert.deepEqual(validateCommand({ kind: 'click', ref: 'r1' }), {
        kind: 'click',
        ref: 'r1',
    });
});

test('runtime commands validate target ids and finite map arguments', () => {
    assert.deepEqual(
        validateCommand({
            kind: 'runtime',
            action: 'map.center',
            args: { id: 'map-1', lng: 116.397, lat: 39.908 },
        }),
        {
            kind: 'runtime',
            action: 'map.center',
            args: { id: 'map-1', lng: 116.397, lat: 39.908 },
        },
    );
    assert.doesNotThrow(() =>
        validateCommand({ kind: 'runtime', action: 'map.zoom', args: { zoom: 11 } }),
    );
    for (const args of [
        undefined,
        {},
        { lng: 1 },
        { lng: '1', lat: 2 },
        { lng: Number.NaN, lat: 2 },
        { lng: 1, lat: Number.POSITIVE_INFINITY },
        { lng: 180.1, lat: 0 },
        { lng: -180.1, lat: 0 },
        { lng: 0, lat: 90.1 },
        { lng: 0, lat: -90.1 },
    ]) {
        assert.throws(
            () => validateCommand({ kind: 'runtime', action: 'map.center', args }),
            (error) => error instanceof BrowserContractError && error.code === 'invalid-command',
        );
    }
    assert.doesNotThrow(() =>
        validateCommand({
            kind: 'runtime',
            action: 'map.center',
            args: { lng: 180, lat: 90 },
        }),
    );
    assert.doesNotThrow(() =>
        validateCommand({
            kind: 'runtime',
            action: 'map.center',
            args: { lng: -180, lat: -90 },
        }),
    );
    for (const args of [undefined, {}, { zoom: '11' }, { zoom: Number.NaN }]) {
        assert.throws(
            () => validateCommand({ kind: 'runtime', action: 'map.zoom', args }),
            (error) => error instanceof BrowserContractError && error.code === 'invalid-command',
        );
    }
});

test('visualDiff threshold must be a finite number in [0, 1)', () => {
    assert.equal(
        validateCondition({ kind: 'visualDiff', baseline: 'baseline.png', threshold: 0 }).threshold,
        0,
    );
    assert.equal(
        validateCondition({ kind: 'visualDiff', baseline: 'baseline.png', threshold: 0.9 })
            .threshold,
        0.9,
    );
    for (const threshold of [-0.01, 1, 1.01, Number.NaN, Number.POSITIVE_INFINITY, '0.1']) {
        assert.throws(
            () =>
                validateCondition({
                    kind: 'visualDiff',
                    baseline: 'baseline.png',
                    threshold,
                }),
            (error) => error instanceof BrowserContractError && error.code === 'invalid-condition',
        );
    }
});

test('conditions require semantic queries and valid states', () => {
    assert.deepEqual(
        validateCondition({
            kind: 'controlState',
            query: { name: '保存', role: 'button' },
            state: 'disabled',
        }),
        {
            kind: 'controlState',
            query: { name: '保存', role: 'button' },
            state: 'disabled',
        },
    );
    assert.throws(
        () => validateCondition({ kind: 'controlState', ref: 'r1', state: 'disabled' }),
        (error) => error instanceof BrowserContractError && error.code === 'invalid-contract',
    );
});

test('snapshots remove password values and require opaque refs', () => {
    const snapshot = validateSnapshot({
        url: 'https://app.test/records',
        title: 'Records',
        controls: [
            {
                ref: 'r1',
                frameRef: 'f0',
                tag: 'input',
                role: 'password',
                name: 'Password',
                label: '',
                placeholder: '',
                value: 'secret',
                disabled: false,
                readonly: false,
                checked: false,
                selected: false,
                multiple: false,
                options: [],
                rowKey: '',
                context: '',
                inPanel: false,
                visible: true,
                href: null,
            },
        ],
        tables: [],
        modal: null,
        observedAt: '2026-09-28T00:00:00.000Z',
    });
    assert.equal(snapshot.controls[0].value, '[REDACTED]');
});

test('capability assertions fail closed', () => {
    assert.doesNotThrow(() => assertCapability({ trace: true }, 'trace'));
    assert.throws(
        () => assertCapability({ trace: false }, 'trace'),
        (error) => error instanceof BrowserContractError && error.code === 'unsupported-capability',
    );
});
