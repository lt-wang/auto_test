import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveRowKey, stableHash } from '../lib/browser/identity-resolver.mjs';

test('prefers explicit row attributes', () => {
    assert.equal(resolveRowKey({ dataRowKey: 'customer-7' }), 'customer-7');
    assert.equal(resolveRowKey({ testId: 'row-8' }), 'row-8');
    assert.equal(resolveRowKey({ id: 'row-9' }), 'row-9');
});

test('synthetic row keys include table and row position', () => {
    const first = resolveRowKey({ rowText: '张三 13800000000', tableIndex: 0, rowIndex: 1 });
    const second = resolveRowKey({ rowText: '张三 13800000000', tableIndex: 0, rowIndex: 2 });
    assert.notEqual(first, second);
    assert.match(first, /^table-0:row-1:/);
    assert.equal(stableHash('abc'), stableHash('abc'));
});

test('returns an empty key when the control is not in a table row', () => {
    assert.equal(resolveRowKey({}), '');
    assert.equal(resolveRowKey({ rowText: 'alert', tableIndex: -1, rowIndex: 0 }), '');
    assert.equal(resolveRowKey({ rowText: 'alert', tableIndex: 0, rowIndex: -1 }), '');
});

test('does not use explicit row identity when an explicit sentinel says there is no row', () => {
    assert.equal(resolveRowKey({ dataRowKey: 'customer-7', tableIndex: -1, rowIndex: 0 }), '');
    assert.equal(resolveRowKey({ testId: 'row-8', tableIndex: 0, rowIndex: -1 }), '');
});
