import test from 'node:test';
import assert from 'node:assert/strict';
import { GenerationPolicyError, createGenerationPolicy } from '../lib/generation-policy.mjs';

test('defaults preserve the existing supported operation set', () => {
    const policy = createGenerationPolicy(null, { allowWrite: false });
    assert.equal(policy.allowsOperation('create'), true);
    assert.equal(policy.allowsOperation('delete'), true);
    assert.equal(policy.canWrite(), false);
    assert.throws(
        () => policy.assertWriteAllowed('保存'),
        (error) => error instanceof GenerationPolicyError && error.code === 'write-denied',
    );
});

test('policy validates operation, cleanup, prefix and record limits', () => {
    assert.throws(
        () => createGenerationPolicy({ allowedOperations: ['script'] }),
        /allowedOperations/,
    );
    assert.throws(() => createGenerationPolicy({ cleanup: 'unknown' }), /cleanup/);
    assert.throws(() => createGenerationPolicy({ recordPrefix: 'bad prefix' }), /recordPrefix/);
    assert.throws(() => createGenerationPolicy({ maxRecords: 0 }), /maxRecords/);
});

test('policy denies operations and fixture keys outside the allowlist', () => {
    const policy = createGenerationPolicy(
        {
            allowedOperations: ['create', 'search'],
            allowedDataKeys: ['recordName'],
            cleanup: 'never',
            recordPrefix: 'PolicyTest',
            maxRecords: 2,
        },
        { allowWrite: true },
    );
    assert.equal(policy.allowsOperation('create'), true);
    assert.throws(
        () => policy.assertOperation('delete'),
        (error) => error.code === 'operation-denied',
    );
    assert.equal(policy.shouldCleanup(), false);
    assert.equal(policy.recordName(123, 'ab'), 'PolicyTest_123_ab');
    assert.throws(() => policy.assertFixtureKey('secret'), /allowedDataKeys/);
    assert.throws(() => policy.assertRecordLimit(2), /maxRecords/);
});
