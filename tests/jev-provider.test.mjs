import test from 'node:test';
import assert from 'node:assert/strict';
import { JevDecisionProvider } from '../lib/decision/jev-provider.mjs';

const response = (body, status = 200) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });

const provider = (fetchImpl) =>
    new JevDecisionProvider({
        apiKey: 'typesafe-test-key',
        baseURL: 'https://api.typesafe.ai',
        model: 'jev-latest',
        fetchImpl,
    });

test('Jev provider maps a choice response into a normalized decision', async () => {
    const instance = provider(async () =>
        response({
            model: 'jev-1.13.0',
            answers: {
                scenario: {
                    type: 'choice',
                    choice: '动作1',
                    confidence: 0.81,
                    probabilities: { 动作1: 0.9, 停止: 0.1 },
                },
            },
            usage: { input_tokens: 20, output_tokens: 2 },
        }),
    );
    const decision = await instance.choose('用户要求点击动作一', {
        动作1: '点击动作一',
        停止: '停止',
    });
    assert.equal(decision.provider, 'jev');
    assert.equal(decision.model, 'jev-1.13.0');
    assert.equal(decision.choice, '动作1');
    assert.equal(decision.confidence, 0.81);
    assert.equal(decision.usage.input_tokens, 20);
});

test('Jev provider rejects invalid probability distributions', async () => {
    const instance = provider(async () =>
        response({
            model: 'jev-1.13.0',
            answers: {
                scenario: {
                    type: 'choice',
                    choice: '动作1',
                    confidence: 0.5,
                    probabilities: { 动作1: 0.4, 停止: 0.4 },
                },
            },
        }),
    );
    await assert.rejects(
        instance.choose('状态', { 动作1: '点击', 停止: '停止' }),
        (error) => error.code === 'invalid-probabilities',
    );
});

test('Jev provider fails closed on HTTP errors', async () => {
    const instance = provider(async () => response({ error: 'unauthorized' }, 401));
    await assert.rejects(instance.choose('状态', { 动作1: '点击', 停止: '停止' }), /401/);
});
