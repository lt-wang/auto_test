import {
    BrowserContractError,
    validateCommand,
    validateCondition,
    validateSnapshot,
} from '../../lib/browser/contract.mjs';

const defaultControls = () => [
    {
        ref: 'name',
        frameRef: 'f0',
        frameIndex: 0,
        tag: 'input',
        role: 'textbox',
        name: '客户名称',
        label: '客户名称',
        placeholder: '',
        value: '',
        disabled: false,
        readonly: false,
        checked: false,
        selected: false,
        multiple: false,
        options: [],
        rowKey: '',
        context: '',
        inPanel: false,
        visible: true,
        href: null,
    },
    {
        ref: 'save',
        frameRef: 'f0',
        frameIndex: 0,
        tag: 'button',
        role: 'button',
        name: '保存',
        label: '',
        placeholder: '',
        value: '',
        disabled: false,
        readonly: false,
        checked: false,
        selected: false,
        multiple: false,
        options: [],
        rowKey: '',
        context: '',
        inPanel: false,
        visible: true,
        href: null,
    },
];

export function createFakeBrowserSession(initialState = {}) {
    let url = initialState.url || 'https://app.test/records';
    let controls = structuredClone(initialState.controls || defaultControls());
    let started = false;
    const events = [];
    const listeners = new Set();

    const emit = (event) => {
        const saved = { time: new Date().toISOString(), ...event };
        events.push(saved);
        for (const listener of listeners) listener(saved);
        return saved;
    };

    return {
        backend: 'fake',
        conformanceBaseUrl: url,
        capabilities: {
            trace: true,
            pageErrors: true,
            consoleErrors: true,
            networkEvents: true,
            frames: true,
            shadowDom: true,
            downloads: false,
        },
        async start() {
            started = true;
        },
        async close() {
            started = false;
        },
        async navigate(next) {
            if (!started) throw new BrowserContractError('backend-disconnected', 'Not started');
            url = next;
            emit({ kind: 'navigation', url });
        },
        async reload() {},
        async currentUrl() {
            return url;
        },
        async snapshot() {
            return validateSnapshot({
                url,
                title: 'Fake',
                controls: structuredClone(controls),
                tables: [],
                modal: null,
                observedAt: new Date().toISOString(),
            });
        },
        async act(rawCommand) {
            const command = validateCommand(rawCommand);
            const control = controls.find((item) => item.ref === command.ref);
            if (command.ref && !control) throw new BrowserContractError('missing-ref', command.ref);
            if (control?.disabled) throw new BrowserContractError('disabled-ref', command.ref);
            if (command.kind === 'fill') control.value = command.value;
            if (command.kind === 'click') emit({ kind: 'action', detail: command.kind });
            if (command.kind === 'check') control.checked = true;
            if (command.kind === 'uncheck') control.checked = false;
            return { ok: true, ref: command.ref || null };
        },
        async waitFor(rawCondition) {
            const condition = validateCondition(rawCondition);
            if (condition.kind === 'urlContains' && !url.includes(condition.value))
                throw new BrowserContractError('wait-timeout', 'url did not match');
            return { matched: true, elapsed_ms: 0 };
        },
        async screenshot() {},
        async startTrace() {},
        async stopTrace() {},
        onEvent(listener) {
            listeners.add(listener);
            for (const event of events) listener(event);
            return () => listeners.delete(listener);
        },
    };
}
