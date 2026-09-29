import test from 'node:test';
import assert from 'node:assert/strict';
import {
    snapshotFindLooseInput,
    snapshotFormErrors,
    snapshotInspectForm,
    snapshotInspectLooseRequired,
    snapshotVisibleOptions,
} from '../lib/form.mjs';

const control = (overrides) => ({
    ref: 'r1',
    frameRef: 'f0',
    tag: 'input',
    role: 'textbox',
    name: '邮箱',
    htmlName: 'email',
    id: 'email',
    autocomplete: 'email',
    label: '邮箱',
    placeholder: '请输入邮箱',
    value: '',
    disabled: false,
    readonly: false,
    checked: false,
    selected: false,
    multiple: false,
    options: [],
    rowKey: '',
    context: '联系信息',
    inPanel: false,
    visible: true,
    required: true,
    invalid: false,
    validationMessage: '',
    href: null,
    ...overrides,
});

test('snapshot form inspection exposes fields and required inputs', () => {
    const snapshot = { controls: [control({})] };
    const items = snapshotInspectForm(snapshot);
    assert.equal(items.length, 1);
    assert.equal(items[0].label, '邮箱');
    assert.equal(items[0].inputs[0].required, true);
    const required = snapshotInspectLooseRequired({
        controls: [control({ label: '', context: '' })],
    });
    assert.equal(required.length, 1);
    assert.equal(required[0].placeholder, '请输入邮箱');
    assert.equal(snapshotFindLooseInput(snapshot, required[0]).ref, 'r1');
});

test('snapshot form errors and options use normalized controls', () => {
    const invalid = control({
        invalid: true,
        validationMessage: '请输入邮箱',
    });
    const option = control({
        ref: 'r2',
        tag: 'div',
        role: 'option',
        name: '已完成',
        label: '',
        required: false,
        invalid: false,
    });
    const errors = snapshotFormErrors({ controls: [invalid, option] });
    assert.deepEqual(errors.labels, ['邮箱']);
    assert.deepEqual(errors.messages, ['请输入邮箱']);
    const options = snapshotVisibleOptions({ controls: [invalid, option] });
    assert.deepEqual(
        options.map((item) => item.name),
        ['已完成'],
    );
});
