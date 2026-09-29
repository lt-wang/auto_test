import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionRegistry } from '../lib/session-registry.mjs';
import { Workflow } from '../lib/workflow.mjs';

test('SessionRegistry lazily creates and reuses role sessions', async () => {
    let created = 0;
    const registry = new SessionRegistry({
        base: { id: 'base', close: async () => {} },
        createSession: async (name) => ({
            id: name,
            close: async () => {},
        }),
    });
    const adminA = await registry.get('admin');
    const adminB = await registry.get('admin');
    assert.equal(adminA, adminB);
    assert.equal(created, 0);
    assert.equal((await registry.get('default')).id, 'base');
});

test('SessionRegistry closes each unique session once', async () => {
    const closed = [];
    const base = { close: async () => closed.push('base') };
    const registry = new SessionRegistry({
        base,
        createSession: async (name) => ({ close: async () => closed.push(name) }),
    });
    await registry.get('admin');
    await registry.close();
    assert.deepEqual(closed.sort(), ['admin', 'base']);
});

test('Workflow switches role sessions and records the actor', async () => {
    const sessions = new Map([
        [
            'default',
            {
                id: 'default',
                onEvent: () => () => {},
                currentUrl: async () => 'https://app.test',
                close: async () => {},
            },
        ],
        [
            'viewer',
            {
                id: 'viewer',
                onEvent: () => () => {},
                currentUrl: async () => 'https://app.test',
                close: async () => {},
            },
        ],
    ]);
    const registry = new SessionRegistry({
        base: sessions.get('default'),
        createSession: async (name) => sessions.get(name),
    });
    const page = sessions.get('default');
    const workflow = new Workflow(
        page,
        {},
        { out: '/tmp', sessionRegistry: registry, caseRoles: { '001': 'viewer' } },
        'execute',
        { begin() {}, end: async () => [], setStep() {} },
    );
    await workflow.useRole('viewer');
    assert.equal(workflow.actor, 'viewer');
    workflow.case = { steps: [] };
    workflow.record({ kind: 'reload' });
    assert.equal(workflow.log.at(-1).actor, 'viewer');
});
