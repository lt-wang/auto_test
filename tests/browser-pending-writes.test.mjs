import test from 'node:test';
import assert from 'node:assert/strict';
import { PendingWrites } from '../lib/pending-writes.mjs';

function fakeSession() {
    const listeners = new Set();
    return {
        onEvent(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        emit(event) {
            for (const listener of listeners) listener(event);
        },
    };
}

test('session pending writes wait for request completion', async () => {
    const session = fakeSession();
    const pending = new PendingWrites(session);
    session.emit({ kind: 'request', id: 'r1', method: 'POST', url: 'http://app.test/save' });
    setTimeout(
        () =>
            session.emit({
                kind: 'requestfinished',
                id: 'r1',
                status: 200,
                failed: false,
            }),
        10,
    );
    await pending.wait(100);
    assert.deepEqual(pending.completed, [{ sequence: 1, status: 200, failed: false }]);
});

test('session pending writes reject unresolved requests on timeout', async () => {
    const session = fakeSession();
    const pending = new PendingWrites(session);
    session.emit({ kind: 'request', id: 'r2', method: 'DELETE', url: 'http://app.test/delete' });
    await assert.rejects(pending.wait(10), /写请求尚未完成/);
});
