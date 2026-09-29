import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRebindFile } from '../lib/rebind.mjs';

const caseFile = () => ({
    schemaVersion: 1,
    generatedAt: 'old',
    moduleUrl: 'https://app.test/records',
    coverage: [],
    rows: [
        {
            id: '001',
            changed: false,
            case: {
                id: '001',
                operation: 'table',
                steps: [{ kind: 'assert-headers', value: ['名称'] }],
            },
        },
    ],
});

test('rebind reuses hidden cases when visible fields are unchanged', () => {
    const result = buildRebindFile(caseFile(), { cases: [] });
    assert.deepEqual(result.changed, []);
    assert.equal(result.file.cases.length, 1);
});

test('rebind requires explicit structured cases after visible edits', () => {
    const editable = caseFile();
    editable.rows[0].changed = true;
    assert.throws(() => buildRebindFile(editable, { cases: [] }), /没有提供重新绑定/);
    const result = buildRebindFile(editable, {
        cases: [
            {
                id: '001',
                operation: 'table',
                steps: [{ kind: 'assert-headers', value: ['名称', '状态'] }],
            },
        ],
    });
    assert.deepEqual(result.changed, ['001']);
    assert.deepEqual(result.file.cases[0].steps[0].value, ['名称', '状态']);
});
