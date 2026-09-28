const COMMAND_KINDS = new Set([
    'click',
    'fill',
    'clear',
    'select',
    'check',
    'uncheck',
    'hover',
    'press',
    'scroll',
]);
const CONDITION_KINDS = new Set([
    'urlContains',
    'textVisible',
    'textAbsent',
    'controlVisible',
    'controlState',
    'tableHeaders',
    'rowCount',
    'formError',
]);
const CAPABILITIES = new Set([
    'trace',
    'pageErrors',
    'consoleErrors',
    'networkEvents',
    'frames',
    'shadowDom',
    'downloads',
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
]);

export class BrowserContractError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'BrowserContractError';
        this.code = code;
    }
}

const requireString = (value, field) => {
    if (typeof value !== 'string' || !value.trim())
        throw new BrowserContractError('invalid-contract', `${field} must be a non-empty string`);
    return value;
};

export function validateCommand(command) {
    if (!command || !COMMAND_KINDS.has(command.kind))
        throw new BrowserContractError('invalid-command', 'Unsupported browser command');
    for (const forbidden of ['selector', 'xpath', 'script'])
        if (Object.hasOwn(command, forbidden))
            throw new BrowserContractError('invalid-command', `Raw ${forbidden} is not allowed`);
    if (REF_COMMANDS.has(command.kind)) requireString(command.ref, 'command.ref');
    if (command.kind === 'press') {
        requireString(command.key, 'command.key');
        if (command.ref !== undefined) requireString(command.ref, 'command.ref');
    }
    if (command.kind === 'fill') requireString(command.value, 'command.value');
    if (command.kind === 'select') {
        if (!Array.isArray(command.values) || !command.values.length)
            throw new BrowserContractError('invalid-command', 'select.values must be non-empty');
        command.values.forEach((value) => requireString(value, 'select.values[]'));
    }
    if (command.kind === 'scroll' && !['up', 'down'].includes(command.direction))
        throw new BrowserContractError('invalid-command', 'scroll.direction must be up or down');
    return structuredClone(command);
}

export function validateCondition(condition) {
    if (!condition || !CONDITION_KINDS.has(condition.kind))
        throw new BrowserContractError('invalid-condition', 'Unsupported browser condition');
    if (['controlVisible', 'controlState'].includes(condition.kind)) {
        if (!condition.query || typeof condition.query.name !== 'string' || !condition.query.name)
            throw new BrowserContractError('invalid-condition', 'condition.query.name is required');
        if (!['page', 'modal', 'owned-row', undefined].includes(condition.query.scope))
            throw new BrowserContractError('invalid-condition', 'Unsupported query scope');
    }
    if (
        condition.kind === 'controlState' &&
        !['disabled', 'enabled', 'checked', 'selected', 'empty', 'value'].includes(condition.state)
    )
        throw new BrowserContractError('invalid-condition', 'Unsupported control state');
    return structuredClone(condition);
}

export function validateSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object')
        throw new BrowserContractError('invalid-snapshot', 'Snapshot must be an object');
    requireString(snapshot.url, 'snapshot.url');
    if (!Array.isArray(snapshot.controls))
        throw new BrowserContractError('invalid-snapshot', 'snapshot.controls must be an array');
    for (const control of snapshot.controls) {
        requireString(control.ref, 'control.ref');
        requireString(control.role, 'control.role');
        if (typeof control.visible !== 'boolean')
            throw new BrowserContractError('invalid-snapshot', 'control.visible must be boolean');
        if (control.role === 'password') control.value = '[REDACTED]';
    }
    return snapshot;
}

export function assertCapability(capabilities, name) {
    if (!CAPABILITIES.has(name))
        throw new BrowserContractError('invalid-capability', `Unknown capability: ${name}`);
    if (!capabilities?.[name])
        throw new BrowserContractError(
            'unsupported-capability',
            `Browser backend does not support ${name}`,
        );
}
