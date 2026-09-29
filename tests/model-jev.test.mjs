import test from 'node:test';
import assert from 'node:assert/strict';
import { Laya } from '../lib/model.mjs';

const criteria = { 搜索: '点击搜索', 停止: '不执行' };

test('Jev mode never sends load or decide to the Python model worker', async () => {
    const client = Object.create(Laya.prototype);
    let warmed = 0;
    let decisions = 0;
    client.provider = 'jev';
    client.jev = {
        model: 'jev-latest',
        warmup: async () => {
            warmed++;
            return { provider: 'jev', models: 2 };
        },
        choose: async () => {
            decisions++;
            return {
                provider: 'jev',
                model: 'jev-1.13.0',
                choice: '搜索',
                probabilities: { 搜索: 0.9, 停止: 0.1 },
                confidence: 0.8,
                inference_ms: 5,
            };
        },
    };
    client.proc = {
        stdin: {
            write() {
                throw Error('local model must not be used in Jev mode');
            },
        },
    };
    await client.request({ action: 'load' });
    await client.request({ action: 'decide', state: 'test', criteria });
    assert.equal(warmed, 1);
    assert.equal(decisions, 1);
});

test('Jev mode rejects unsupported provider values', () => {
    assert.throws(
        () => new Laya('python', 'worker.py', 'model', 'decisions.log', { provider: 'unknown' }),
        /provider/,
    );
});
