import { safeText, safeUrl } from '../diagnostics.mjs';

const COMMAND_FIELDS = {
    click: new Set(['kind', 'ref', 'button', 'modifiers']),
    fill: new Set(['kind', 'ref', 'value', 'clear']),
    clear: new Set(['kind', 'ref']),
    select: new Set(['kind', 'ref', 'values']),
    check: new Set(['kind', 'ref']),
    uncheck: new Set(['kind', 'ref']),
    hover: new Set(['kind', 'ref']),
    press: new Set(['kind', 'key', 'ref']),
    scroll: new Set(['kind', 'ref', 'direction', 'amount']),
    upload: new Set(['kind', 'ref', 'files']),
    drag: new Set(['kind', 'ref', 'toRef', 'steps', 'delay']),
};
const CONDITION_FIELDS = {
    urlContains: new Set(['kind', 'value']),
    textVisible: new Set(['kind', 'value', 'scope']),
    textAbsent: new Set(['kind', 'value', 'scope']),
    controlVisible: new Set(['kind', 'query']),
    controlState: new Set(['kind', 'query', 'state', 'value']),
    tableHeaders: new Set(['kind', 'values']),
    rowCount: new Set(['kind', 'value', 'scope']),
    formError: new Set(['kind', 'labels']),
};
const CONTROL_FIELDS = new Set([
    'ref',
    'ref',
    'frameRef',
    'tag',
    'role',
    'name',
    'htmlName',
    'id',
    'autocomplete',
    'label',
    'placeholder',
    'value',
    'disabled',
    'readonly',
    'checked',
    'selected',
    'multiple',
    'options',
    'rowKey',
    'context',
    'inPanel',
    'visible',
    'href',
    'required',
    'invalid',
    'validationMessage',
    'component',
    'adapter',
    'testId',
    'expanded',
    'layer',
    'iconFingerprint',
    'selector',
]);
const SNAPSHOT_FIELDS = new Set(['url', 'title', 'controls', 'tables', 'modal', 'observedAt']);
const CAPABILITIES = new Set([
    'trace',
    'pageErrors',
    'consoleErrors',
    'networkEvents',
    'frames',
    'shadowDom',
    'downloads',
    'runtimeInstrumentation',
]);
const REF_COMMANDS = new Set([
    'click',
    'fill',
    'clear',
    'select',
    'check',
    'uncheck',
    'hover',
    'scroll',
    'upload',
    'drag',
]);
const BUTTONS = new Set(['left', 'right', 'middle']);
const MODIFIERS = new Set(['Alt', 'Control', 'ControlOrMeta', 'Meta', 'Shift']);
const CONTROL_STATES = new Set([
    'disabled',
    'enabled',
    'checked',
    'selected',
    'empty',
    'value',
    'expanded',
    'collapsed',
]);

export class BrowserContractError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'BrowserContractError';
        this.code = code;
    }
}

const fail = (code, message) => {
    throw new BrowserContractError(code, message);
};
const requireString = (value, field) => {
    if (typeof value !== 'string' || !value.trim())
        fail('invalid-contract', `${field} is required`);
    return value;
};
const rejectUnknownFields = (value, allowed, label) => {
    for (const key of Object.keys(value))
        if (!allowed.has(key)) fail('invalid-contract', `${label} contains unknown field: ${key}`);
};

export function validateCommand(command) {
    if (!command || typeof command !== 'object' || !COMMAND_FIELDS[command.kind])
        fail('invalid-command', 'Unsupported browser command');
    for (const forbidden of ['selector', 'xpath', 'script'])
        if (Object.hasOwn(command, forbidden))
            fail('invalid-command', `Raw ${forbidden} is not allowed`);
    rejectUnknownFields(command, COMMAND_FIELDS[command.kind], 'command');
    if (REF_COMMANDS.has(command.kind)) requireString(command.ref, 'command.ref');
    if (command.kind === 'press') {
        requireString(command.key, 'command.key');
        if (command.ref !== undefined) requireString(command.ref, 'command.ref');
    }
    if (command.kind === 'fill') {
        requireString(command.value, 'command.value');
        if (command.clear !== undefined && typeof command.clear !== 'boolean')
            fail('invalid-command', 'command.clear must be boolean');
    }
    if (command.kind === 'click') {
        if (command.button !== undefined && !BUTTONS.has(command.button))
            fail('invalid-command', 'command.button is invalid');
        if (
            command.modifiers !== undefined &&
            (!Array.isArray(command.modifiers) ||
                command.modifiers.some((modifier) => !MODIFIERS.has(modifier)))
        )
            fail('invalid-command', 'command.modifiers is invalid');
    }
    if (command.kind === 'select') {
        if (!Array.isArray(command.values) || !command.values.length)
            fail('invalid-command', 'select.values must be non-empty');
        command.values.forEach((value) => requireString(value, 'select.values[]'));
    }
    if (command.kind === 'upload') {
        if (!Array.isArray(command.files) || !command.files.length)
            fail('invalid-command', 'command.files must be non-empty');
        command.files.forEach((file) => requireString(file, 'command.files[]'));
    }
    if (command.kind === 'scroll') {
        if (!['up', 'down'].includes(command.direction))
            fail('invalid-command', 'scroll.direction is invalid');
        if (
            command.amount !== undefined &&
            (!Number.isFinite(command.amount) || command.amount <= 0)
        )
            fail('invalid-command', 'scroll.amount must be positive');
    }
    if (command.kind === 'drag') {
        requireString(command.toRef, 'command.toRef');
        if (
            command.steps !== undefined &&
            (!Number.isInteger(command.steps) || command.steps < 2 || command.steps > 100)
        )
            fail('invalid-command', 'command.steps must be an integer between 2 and 100');
        if (
            command.delay !== undefined &&
            (!Number.isFinite(command.delay) || command.delay < 0 || command.delay > 1000)
        )
            fail('invalid-command', 'command.delay must be between 0 and 1000');
    }
    return structuredClone(command);
}

export function validateCondition(condition) {
    if (!condition || typeof condition !== 'object' || !CONDITION_FIELDS[condition.kind])
        fail('invalid-condition', 'Unsupported browser condition');
    rejectUnknownFields(condition, CONDITION_FIELDS[condition.kind], 'condition');
    if (['urlContains', 'textVisible', 'textAbsent'].includes(condition.kind))
        requireString(condition.value, 'condition.value');
    if (['controlVisible', 'controlState'].includes(condition.kind)) {
        if (!condition.query || typeof condition.query !== 'object')
            fail('invalid-condition', 'condition.query is required');
        rejectUnknownFields(
            condition.query,
            new Set(['name', 'role', 'scope', 'rowKey', 'index']),
            'condition.query',
        );
        requireString(condition.query.name, 'condition.query.name');
        if (!['page', 'modal', 'owned-row', undefined].includes(condition.query.scope))
            fail('invalid-condition', 'Unsupported query scope');
        if (
            condition.query.index !== undefined &&
            (!Number.isInteger(condition.query.index) || condition.query.index < 0)
        )
            fail('invalid-condition', 'condition.query.index must be a non-negative integer');
    }
    if (condition.kind === 'controlState') {
        if (!CONTROL_STATES.has(condition.state))
            fail('invalid-condition', 'Unsupported control state');
        if (condition.state === 'value') requireString(condition.value, 'condition.value');
    }
    if (
        condition.kind === 'tableHeaders' &&
        (!Array.isArray(condition.values) || !condition.values.length)
    )
        fail('invalid-condition', 'tableHeaders.values must be non-empty');
    if (
        condition.kind === 'rowCount' &&
        (!Number.isInteger(condition.value) || condition.value < 0)
    )
        fail('invalid-condition', 'rowCount.value must be a non-negative integer');
    if (
        condition.kind === 'formError' &&
        (!Array.isArray(condition.labels) || !condition.labels.length)
    )
        fail('invalid-condition', 'formError.labels must be non-empty');
    if (['textVisible', 'textAbsent', 'rowCount'].includes(condition.kind)) {
        if (condition.scope !== undefined && !['page', 'modal'].includes(condition.scope))
            fail('invalid-condition', 'Unsupported condition scope');
    }
    return structuredClone(condition);
}

export function validateSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object')
        fail('invalid-snapshot', 'Snapshot must be an object');
    rejectUnknownFields(snapshot, SNAPSHOT_FIELDS, 'snapshot');
    requireString(snapshot.url, 'snapshot.url');
    requireString(snapshot.observedAt, 'snapshot.observedAt');
    if (typeof snapshot.title !== 'string')
        fail('invalid-snapshot', 'snapshot.title must be a string');
    if (!Array.isArray(snapshot.controls))
        fail('invalid-snapshot', 'snapshot.controls must be an array');
    if (!Array.isArray(snapshot.tables))
        fail('invalid-snapshot', 'snapshot.tables must be an array');
    if (snapshot.modal !== null && typeof snapshot.modal !== 'object')
        fail('invalid-snapshot', 'snapshot.modal must be null or an object');
    const refs = new Set();
    for (const control of snapshot.controls) {
        rejectUnknownFields(control, CONTROL_FIELDS, 'control');
        control.htmlName = control.htmlName || '';
        control.id = control.id || '';
        control.autocomplete = control.autocomplete || '';
        control.validationMessage = control.validationMessage || '';
        requireString(control.ref, 'control.ref');
        requireString(control.role, 'control.role');
        if (refs.has(control.ref))
            fail('invalid-snapshot', `Duplicate control ref: ${control.ref}`);
        refs.add(control.ref);
        for (const field of [
            'frameRef',
            'tag',
            'name',
            'label',
            'placeholder',
            'value',
            'rowKey',
            'context',
            'htmlName',
            'id',
            'autocomplete',
            'validationMessage',
        ])
            if (typeof control[field] !== 'string')
                fail('invalid-snapshot', `control.${field} must be a string`);
        control.required = Boolean(control.required);
        control.invalid = Boolean(control.invalid);
        if (typeof control.visible !== 'boolean')
            fail('invalid-snapshot', 'control.visible must be boolean');
        if (control.role === 'password') control.value = '[REDACTED]';
    }
    return snapshot;
}

export function toPublicSnapshot(raw) {
    return validateSnapshot({
        url: safeUrl(raw.url),
        title: safeText(raw.title || '', 300),
        controls: raw.controls.map((control) => ({
            ref: control.ref,
            frameRef: control.frameRef,
            tag: control.tag,
            role: control.role,
            name: safeText(control.name, 160),
            htmlName: safeText(control.htmlName || '', 160),
            id: safeText(control.id || '', 160),
            autocomplete: safeText(control.autocomplete || '', 160),
            label: safeText(control.label, 160),
            placeholder: safeText(control.placeholder, 160),
            value: control.sensitive ? '[REDACTED]' : safeText(control.value, 300),
            disabled: Boolean(control.disabled),
            readonly: Boolean(control.readonly),
            checked: Boolean(control.checked),
            selected: Boolean(control.selected),
            multiple: Boolean(control.multiple),
            options: Array.isArray(control.options)
                ? control.options.map((option) => safeText(option, 160))
                : [],
            rowKey: safeText(control.rowKey, 160),
            context: safeText(control.context, 500),
            inPanel: Boolean(control.inPanel),
            visible: Boolean(control.visible),
            required: Boolean(control.required),
            invalid: Boolean(control.invalid),
            validationMessage: safeText(control.validationMessage || '', 300),
            component: safeText(control.component || '', 80),
            adapter: safeText(control.adapter || '', 80),
            testId: safeText(control.testId || '', 160),
            expanded: Boolean(control.expanded),
            layer: safeText(control.layer || '', 80),
            iconFingerprint: safeText(control.iconFingerprint || '', 160),
            selector: safeText(control.selector || '', 40),
            href: control.href ? safeUrl(control.href) : null,
        })),
        tables: raw.tables || [],
        modal: raw.modal || null,
        observedAt: raw.observedAt || new Date().toISOString(),
    });
}

export function assertCapability(capabilities, name) {
    if (!CAPABILITIES.has(name)) fail('invalid-capability', `Unknown capability: ${name}`);
    if (!capabilities?.[name])
        fail('unsupported-capability', `Browser backend does not support ${name}`);
}
