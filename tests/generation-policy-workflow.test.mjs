import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Workflow } from '../lib/workflow.mjs';
import { createGenerationPolicy } from '../lib/generation-policy.mjs';

function setup(policyInput, options = {}) {
    const page = new EventEmitter();
    Object.assign(page, {
        url: () => 'https://app.test/records',
        screenshot: async () => {},
        waitForTimeout: async () => {},
        locator: () => ({ last: () => ({ isVisible: async () => false }) }),
    });
    const diagnostics = { begin: () => {}, end: async () => [], setStep: () => {} };
    const policy = createGenerationPolicy(policyInput, { allowWrite: options.allowWrite ?? true });
    const workflow = new Workflow(
        page,
        {},
        { out: '/tmp', pageTimeout: 50, generationPolicy: policy },
        'generate',
        diagnostics,
    );
    workflow.modalPresent = async () => false;
    return workflow;
}

test('workflow denies operations before executing browser actions', async () => {
    const workflow = setup({ allowedOperations: ['create'] });
    const result = await workflow.runCase('delete', '删除记录', 'delete', async () => {
        throw Error('browser action must not run');
    });
    assert.equal(result.status, '未生成');
    assert.match(result.reason, /operation-denied|does not allow/);
});

test('workflow uses the policy record prefix', () => {
    const workflow = setup({ recordPrefix: 'PolicyTest' });
    assert.match(workflow.variables.recordName, /^PolicyTest_/);
});

test('workflow rejects fixture keys outside allowedDataKeys', () => {
    const workflow = setup({ allowedDataKeys: ['recordName'] });
    workflow.config.data = { recordName: workflow.variables.recordName };
    assert.throws(() => workflow.resolve({ fixture: 'secret' }), /allowedDataKeys/);
    assert.equal(workflow.resolve({ fixture: 'recordName' }), workflow.variables.recordName);
});
