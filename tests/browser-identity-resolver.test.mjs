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
