import test from 'node:test';
import assert from 'node:assert/strict';
import {
    DecisionContractError,
    assertProvider,
    validateDecision,
} from '../lib/decision/contract.mjs';

test('decision records require a valid candidate and probability distribution', () => {
    const decision = validateDecision(
        {
            provider: 'jev',
            model: 'jev-1.13.0',
            choice: '动作1',
            probabilities: { 动作1: 0.9, 停止: 0.1 },
            confidence: 0.8,
            inference_ms: 12,
        },
        { 动作1: '点击', 停止: '停止' },
    );
    assert.equal(decision.choice, '动作1');
    assert.equal(decision.margin, 0.8);
    assert.throws(
        () =>
            validateDecision(
                {
                    provider: 'jev',
                    model: 'jev-1.13.0',
                    choice: '动作1',
                    probabilities: { 动作1: 0.4, 停止: 0.4 },
                },
                { 动作1: '点击', 停止: '停止' },
            ),
        (error) => error instanceof DecisionContractError && error.code === 'invalid-probabilities',
    );
});

test('provider facade requires warmup, choose and close', () => {
    assert.doesNotThrow(() =>
        assertProvider({
            name: 'test',
            warmup: async () => {},
            choose: async () => {},
            close: () => {},
        }),
    );
    assert.throws(
        () => assertProvider({ name: 'broken' }),
        (error) => error instanceof DecisionContractError && error.code === 'invalid-provider',
    );
});
