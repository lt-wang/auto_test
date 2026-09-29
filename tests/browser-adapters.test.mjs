import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdapterRegistry } from '../lib/browser/adapters/registry.mjs';
import { toPublicSnapshot } from '../lib/browser/contract.mjs';

test('adapter registry returns first matching descriptor', () => {
    const registry = createAdapterRegistry([
        {
            id: 'mantine-select',
            match: (element) => element.dataset.mantine === 'select',
            describe: () => ({ component: 'select', expanded: true }),
        },
    ]);
    const result = registry.describe({ dataset: { mantine: 'select' } }, {});
    assert.deepEqual(result, {
        adapter: 'mantine-select',
        component: 'select',
        expanded: true,
    });
});

test('public snapshot preserves adapter metadata', () => {
    const snapshot = toPublicSnapshot({
        url: 'http://127.0.0.1/',
        title: 'fixture',
        controls: [
            {
                ref: 'r1',
                frameRef: 'f0',
                tag: 'button',
                role: 'combobox',
                name: '状态',
                component: 'select',
                adapter: 'mantine-select',
                testId: 'status',
                expanded: true,
                layer: 'modal',
                iconFingerprint: '',
                visible: true,
            },
        ],
        tables: [],
        modal: null,
        observedAt: new Date().toISOString(),
    });
    assert.equal(snapshot.controls[0].component, 'select');
    assert.equal(snapshot.controls[0].adapter, 'mantine-select');
    assert.equal(snapshot.controls[0].testId, 'status');
    assert.equal(snapshot.controls[0].expanded, true);
});
