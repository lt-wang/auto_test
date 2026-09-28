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
        /query/,
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
