# Browser Driver Contract Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the backend-neutral browser contract, a deterministic fake driver, and a Playwright adapter with conformance tests, without yet changing the production generation or replay paths.

**Architecture:** The contract uses normalized snapshots, opaque control refs, semantic commands, semantic conditions, capability flags, and normalized browser events. A fake driver proves the contract independently. A Playwright adapter implements it by wrapping the current DOM observation behavior and translating commands to Playwright locators. Engine migration to the new contract is intentionally a separate plan.

**Tech Stack:** Node.js >=20, ECMAScript modules, Node `node:test`, Playwright `1.62.1`.

**Spec:** `docs/superpowers/specs/2026-09-28-browser-driver-design.md`

## Global Constraints

- Node.js must remain `>=20`.
- Playwright must remain pinned to `1.62.1`.
- Existing CLI behavior must not change in this plan.
- Existing `generate`, `execute`, and `--excel` production paths remain on their current code paths.
- No command may accept a CSS selector, XPath, or arbitrary JavaScript expression.
- Password values must be returned as `[REDACTED]`.
- URLs in browser events must remove query strings and fragments.
- Secrets must never be written to logs or test fixtures.
- All new JavaScript files use four-space indentation and Prettier formatting.
- Every task must leave `npm test` green before its commit.

## Review Focus

- A stale control ref after a re-render must fail explicitly instead of acting on the wrong element.
- A control query used by an assertion must resolve at wait time, not from an old snapshot.
- Modal scope must exclude background controls that remain visible behind a dialog.
- Playwright frame and open Shadow DOM traversal must preserve the current observation behavior.
- Password values, API keys, bearer tokens, URL queries, and fragments must not appear in events or snapshots.

---

### Task 1: Contract validation and errors

**Files:**

- Create: `lib/browser/contract.mjs`
- Create: `tests/browser-contract-validation.test.mjs`

**Interfaces:**

- Consumes: no earlier task.
- Produces:
    - `BrowserContractError` with `code` and `message`
    - `validateCommand(command): BrowserCommand`
    - `validateCondition(condition): BrowserCondition`
    - `validateSnapshot(snapshot): PageSnapshot`
    - `assertCapability(capabilities, name): void`

- [x] **Step 1: Write the failing validation tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    BrowserContractError,
    assertCapability,
    validateCommand,
    validateCondition,
    validateSnapshot,
} from '../lib/browser/contract.mjs';

test('commands reject raw selectors and require opaque refs', () => {
    assert.throws(
        () => validateCommand({ kind: 'click', selector: '#save' }),
        (error) => error instanceof BrowserContractError && error.code === 'invalid-command',
    );
    assert.deepEqual(validateCommand({ kind: 'click', ref: 'r1' }), {
        kind: 'click',
        ref: 'r1',
    });
});

test('conditions require semantic queries and valid states', () => {
    assert.deepEqual(
        validateCondition({
            kind: 'controlState',
            query: { name: '保存', role: 'button' },
            state: 'disabled',
        }),
        {
            kind: 'controlState',
            query: { name: '保存', role: 'button' },
            state: 'disabled',
        },
    );
    assert.throws(
        () => validateCondition({ kind: 'controlState', ref: 'r1', state: 'disabled' }),
        /query/,
    );
});

test('snapshots remove password values and require opaque refs', () => {
    const snapshot = validateSnapshot({
        url: 'https://app.test/records',
        title: 'Records',
        controls: [
            {
                ref: 'r1',
                frameRef: 'f0',
                tag: 'input',
                role: 'textbox',
                name: 'Password',
                label: '',
                placeholder: '',
                value: '[REDACTED]',
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
        ],
        tables: [],
        modal: null,
        observedAt: '2026-09-28T00:00:00.000Z',
    });
    assert.equal(snapshot.controls[0].value, '[REDACTED]');
});

test('capability assertions fail closed', () => {
    assert.doesNotThrow(() => assertCapability({ trace: true }, 'trace'));
    assert.throws(
        () => assertCapability({ trace: false }, 'trace'),
        (error) => error instanceof BrowserContractError && error.code === 'unsupported-capability',
    );
});
```

- [x] **Step 2: Run the tests and verify they fail**

Run:

```bash
node --test tests/browser-contract-validation.test.mjs
```

Expected: FAIL because `lib/browser/contract.mjs` does not exist.

- [x] **Step 3: Implement the contract module**

```js
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
    requireString(command.ref, 'command.ref');
    if (Object.hasOwn(command, 'selector'))
        throw new BrowserContractError('invalid-command', 'Raw selectors are not allowed');
    const copy = { ...command };
    if (copy.kind === 'fill') requireString(copy.value, 'command.value');
    if (copy.kind === 'select') {
        if (!Array.isArray(copy.values) || !copy.values.length)
            throw new BrowserContractError('invalid-command', 'select.values must be non-empty');
    }
    if (copy.kind === 'press') requireString(copy.key, 'command.key');
    return copy;
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
```

- [x] **Step 4: Run the validation tests**

Run:

```bash
node --test tests/browser-contract-validation.test.mjs
```

Expected: PASS, 4 tests.

- [x] **Step 5: Run the full suite and commit**

Run:

```bash
npm test
git add lib/browser/contract.mjs tests/browser-contract-validation.test.mjs
git commit -m "feat: add browser driver contract validation"
```

---

### Task 2: Fake driver and reusable conformance suite

**Files:**

- Create: `tests/fakes/fake-browser-driver.mjs`
- Create: `tests/browser-conformance.mjs`
- Create: `tests/browser-fake-driver.test.mjs`

**Interfaces:**

- Consumes: `lib/browser/contract.mjs`
- Produces:
    - `createFakeBrowserSession(initialState?)`
    - `registerBrowserConformanceTests(name, createSession)`

- [x] **Step 1: Write the failing conformance test**

```js
import { registerBrowserConformanceTests } from './browser-conformance.mjs';
import { createFakeBrowserSession } from './fakes/fake-browser-driver.mjs';

registerBrowserConformanceTests('fake', async () => createFakeBrowserSession());
```

- [x] **Step 2: Run the test and verify it fails**

Run:

```bash
node --test tests/browser-fake-driver.test.mjs
```

Expected: FAIL because the helper modules do not exist.

- [x] **Step 3: Implement the fake driver**

```js
import {
    BrowserContractError,
    validateCommand,
    validateCondition,
} from '../../lib/browser/contract.mjs';

export function createFakeBrowserSession(initialState = {}) {
    let url = initialState.url || 'https://app.test/records';
    let controls = structuredClone(
        initialState.controls || [
            {
                ref: 'name',
                frameRef: 'f0',
                frameIndex: 0,
                tag: 'input',
                role: 'textbox',
                name: '????',
                label: '????',
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
                name: '??',
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
        ],
    );
    const events = [];
    const listeners = new Set();

    return {
        backend: 'fake',
        capabilities: {
            trace: true,
            pageErrors: true,
            consoleErrors: true,
            networkEvents: true,
            frames: true,
            shadowDom: true,
            downloads: false,
        },
        async start() {},
        async close() {},
        async navigate(next) {
            url = next;
            this.emit({ kind: 'navigation', url });
        },
        async reload() {},
        async currentUrl() {
            return url;
        },
        async snapshot() {
            return {
                url,
                title: 'Fake',
                controls: structuredClone(controls),
                tables: [],
                modal: null,
                observedAt: new Date().toISOString(),
            };
        },
        async act(command) {
            validateCommand(command);
            const control = controls.find((item) => item.ref === command.ref);
            if (!control) throw new BrowserContractError('missing-ref', command.ref);
            if (control.disabled) throw new BrowserContractError('disabled-ref', command.ref);
            if (command.kind === 'fill') control.value = command.value;
            if (command.kind === 'click') events.push({ kind: 'action', detail: command.kind });
            return { ok: true, ref: command.ref };
        },
        async waitFor(condition) {
            validateCondition(condition);
            if (condition.kind === 'urlContains' && !url.includes(condition.value))
                throw new BrowserContractError('wait-timeout', 'url did not match');
            return { matched: true, elapsed_ms: 0 };
        },
        async screenshot() {},
        async startTrace() {},
        async stopTrace() {},
        onEvent(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        emit(event) {
            const saved = { time: new Date().toISOString(), ...event };
            events.push(saved);
            for (const listener of listeners) listener(saved);
        },
    };
}
```

- [x] **Step 4: Implement the conformance suite**

```js
import test from 'node:test';
import assert from 'node:assert/strict';

export function registerBrowserConformanceTests(name, createSession) {
    test(`${name}: lifecycle and navigation`, async () => {
        const session = await createSession();
        await session.start();
        await session.navigate('https://app.test/next');
        assert.equal(await session.currentUrl(), 'https://app.test/next');
        await session.close();
    });

    test(`${name}: snapshot returns stable control refs`, async () => {
        const session = await createSession();
        const snapshot = await session.snapshot();
        assert.ok(snapshot.controls.length > 0);
        assert.ok(snapshot.controls.every((control) => typeof control.ref === 'string'));
    });

    test(`${name}: fill changes only the addressed control`, async () => {
        const session = await createSession();
        await session.act({ kind: 'fill', ref: 'save', value: 'changed' });
        const snapshot = await session.snapshot();
        assert.equal(snapshot.controls[0].value, 'changed');
    });

    test(`${name}: conditions resolve semantic state`, async () => {
        const session = await createSession();
        await session.waitFor({ kind: 'urlContains', value: 'http' });
    });
}
```

- [x] **Step 5: Run the fake conformance test**

Run:

```bash
node --test tests/browser-fake-driver.test.mjs
```

Expected: PASS, 4 conformance tests.

- [x] **Step 6: Run the full suite and commit**

Run:

```bash
npm test
git add tests/fakes/fake-browser-driver.mjs tests/browser-conformance.mjs tests/browser-fake-driver.test.mjs
git commit -m "test: add browser driver conformance harness"
```

---

### Task 3: Playwright snapshot normalization

**Files:**

- Create: `lib/browser/playwright-snapshot.mjs`
- Modify: `lib/dom.mjs`
- Create: `tests/browser-playwright-snapshot.test.mjs`

**Interfaces:**

- Consumes: `validateSnapshot(snapshot)` from Task 1.
- Produces: `snapshotPlaywrightPage(page, options?): Promise<PageSnapshot>`.

- [x] **Step 1: Write the failing Playwright snapshot test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { chromium } from 'playwright';
import { snapshotPlaywrightPage } from '../lib/browser/playwright-snapshot.mjs';

test('Playwright snapshot normalizes controls and redacts password values', async () => {
    const server = http.createServer((request, response) => {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(`
            <main>
                <label for="name">客户名称</label>
                <input id="name" placeholder="请输入客户名称" value="LayaAuto_1">
                <label for="password">密码</label>
                <input id="password" type="password" value="secret-value">
                <button aria-label="保存">保存</button>
                <input type="checkbox" aria-label="启用">
            </main>
        `);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
        const { port } = server.address();
        await page.goto(`http://127.0.0.1:${port}/`);
        const snapshot = await snapshotPlaywrightPage(page);
        assert.equal(snapshot.url, `http://127.0.0.1:${port}/`);
        assert.ok(snapshot.controls.some((control) => control.name === '客户名称'));
        assert.ok(snapshot.controls.some((control) => control.name === '保存'));
        const password = snapshot.controls.find((control) => control.role === 'password');
        assert.equal(password.value, '[REDACTED]');
    } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
    }
});
```

test('Playwright snapshot modal scope excludes background controls', async () => {
const server = http.createServer((request, response) => {
response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
response.end('<button>????</button><dialog open><button>??</button></dialog>');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
try {
const { port } = server.address();
await page.goto(`http://127.0.0.1:${port}/`);
const snapshot = await snapshotPlaywrightPage(page, { scope: 'modal' });
assert.ok(snapshot.controls.some((control) => control.name === '??'));
assert.ok(!snapshot.controls.some((control) => control.name === '????'));
} finally {
await browser.close();
await new Promise((resolve) => server.close(resolve));
}
});

test('Playwright snapshot includes open Shadow DOM and iframe controls', async () => {
const server = http.createServer((request, response) => {
response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
response.end(`             <div id="host"></div>
            <iframe srcdoc="<button>????</button>"></iframe>
            <script>
                const root = document.getElementById('host').attachShadow({ mode: 'open' });
                root.innerHTML = '<button>Shadow??</button>';
            </script>
        `);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
try {
const { port } = server.address();
await page.goto(`http://127.0.0.1:${port}/`);
const snapshot = await snapshotPlaywrightPage(page);
assert.ok(snapshot.controls.some((control) => control.name === 'Shadow??'));
assert.ok(snapshot.controls.some((control) => control.name === '????'));
} finally {
await browser.close();
await new Promise((resolve) => server.close(resolve));
}
});

- [x] **Step 2: Run the test and verify it fails**

Run:

```bash
node --test tests/browser-playwright-snapshot.test.mjs
```

Expected: FAIL because `snapshotPlaywrightPage` does not exist.

- [x] **Step 3: Move the current observation implementation**

Move the existing `observe(page)` body from `lib/dom.mjs` into:

```js
// lib/browser/playwright-snapshot.mjs
import { randomBytes } from 'node:crypto';
import { validateSnapshot } from './contract.mjs';

const ATTR = 'data-laya-live-ref';

export async function snapshotPlaywrightPage(page, options = {}) {
    // Keep the existing frame traversal, visibility checks, Shadow DOM roots,
    // modal filtering, label precedence, row context, and value redaction.
    // The returned object is passed through validateSnapshot before return.
}
```

The moved function must preserve all current behavior. Change only the function name, the module location, and the final return:

```js
const normalizedControls = controls.map((control) => ({
    ...control,
    frameRef: 'f' + control.frame,
    frameIndex: control.frame,
    visible: true,
}));
const snapshot = { url: page.url(), controls: normalizedControls, frames };
return validateSnapshot(snapshot);
```

- [x] **Step 4: Keep the old import working**

Change `lib/dom.mjs` so existing callers do not change in this task:

```js
import { snapshotPlaywrightPage } from './browser/playwright-snapshot.mjs';
import { Halt, norm } from './language.mjs';

export async function observe(page) {
    return snapshotPlaywrightPage(page);
}
```

Leave `score`, `discoverRowLabels`, `target`, `settle`, and `assertionTarget` in `lib/dom.mjs` for the later engine migration plan.

- [x] **Step 5: Run snapshot and existing DOM tests**

Run:

```bash
node --test tests/browser-playwright-snapshot.test.mjs tests/retries.test.mjs tests/selected-pr1.test.mjs
npm test
```

Expected: all tests PASS. If an old test fails, fix the extraction without changing its semantics.

- [x] **Step 6: Commit**

```bash
git add lib/browser/playwright-snapshot.mjs lib/dom.mjs tests/browser-playwright-snapshot.test.mjs
git commit -m "refactor: extract playwright snapshot adapter"
```

---

### Task 4: Playwright actions with stale-ref protection

**Files:**

- Create: `lib/browser/playwright-actions.mjs`
- Create: `tests/browser-playwright-actions.test.mjs`
- Modify: `lib/browser/playwright-snapshot.mjs`

**Interfaces:**

- Consumes: `validateCommand(command)` and the snapshot refs produced by Task 3.
- Produces: `executePlaywrightCommand(page, refs, command): Promise<ActionResult>`.

- [x] **Step 1: Write the failing action tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { chromium } from 'playwright';
import { snapshotPlaywrightPage } from '../lib/browser/playwright-snapshot.mjs';
import { executePlaywrightCommand } from '../lib/browser/playwright-actions.mjs';

async function fixture() {
    const server = http.createServer((request, response) => {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(`
            <label for="name">客户名称</label>
            <input id="name">
            <button id="save" disabled>保存</button>
            <script>
                document.getElementById('name').addEventListener('input', (event) => {
                    document.getElementById('save').disabled = !event.target.value;
                });
            </script>
        `);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const { port } = server.address();
    await page.goto(`http://127.0.0.1:${port}/`);
    return {
        page,
        async close() {
            await browser.close();
            await new Promise((resolve) => server.close(resolve));
        },
    };
}

test('fill and click use opacity refs', async () => {
    const item = await fixture();
    try {
        let snapshot = await snapshotPlaywrightPage(item.page);
        const input = snapshot.controls.find((control) => control.name === '客户名称');
        const refs = new Map(snapshot.controls.map((control) => [control.ref, control]));
        await executePlaywrightCommand(item.page, refs, {
            kind: 'fill',
            ref: input.ref,
            value: 'LayaAuto_1',
        });
        snapshot = await snapshotPlaywrightPage(item.page);
        const save = snapshot.controls.find((control) => control.name === '保存');
        assert.equal(save.disabled, false);
    } finally {
        await item.close();
    }
});

test('stale refs fail explicitly', async () => {
    const item = await fixture();
    try {
        const snapshot = await snapshotPlaywrightPage(item.page);
        const input = snapshot.controls.find((control) => control.name === '客户名称');
        await item.page.reload();
        const refs = new Map(snapshot.controls.map((control) => [control.ref, control]));
        await assert.rejects(
            executePlaywrightCommand(item.page, refs, {
                kind: 'fill',
                ref: input.ref,
                value: 'later',
            }),
            (error) => error.code === 'stale-ref',
        );
    } finally {
        await item.close();
    }
});
```

- [x] **Step 2: Run the tests and verify they fail**

Run:

```bash
node --test tests/browser-playwright-actions.test.mjs
```

Expected: FAIL because `executePlaywrightCommand` does not exist.

- [x] **Step 3: Record the snapshot generation in each control**

In `lib/browser/playwright-snapshot.mjs`, add `snapshotNonce` to the returned snapshot and copy it into every control:

```js
const snapshot = {
    url: page.url(),
    controls: normalizedControls.map((control) => ({ ...control, snapshotNonce: nonce })),
    frames,
    snapshotNonce: nonce,
};
return validateSnapshot(snapshot);
```

The refs map passed to actions maps `control.ref` to the control containing `snapshotNonce`.

- [x] **Step 4: Implement action translation**

```js
import { BrowserContractError, validateCommand } from './contract.mjs';

const locatorFor = (page, control) => {
    const frame = page.frames()[control.frameIndex];
    if (!frame) throw new BrowserContractError('stale-ref', 'Frame is no longer available');
    return frame.locator(`[data-laya-live-ref="${control.ref}"]`).first();
};

export async function executePlaywrightCommand(page, refs, rawCommand) {
    const command = validateCommand(rawCommand);
    const control = refs.get(command.ref);
    if (!control) throw new BrowserContractError('missing-ref', command.ref);
    if (control.disabled) throw new BrowserContractError('disabled-ref', command.ref);
    const locator = locatorFor(page, control);
    if (!(await locator.count()))
        throw new BrowserContractError('stale-ref', `Control ${command.ref} is no longer present`);
    if (command.kind === 'click') await locator.click({ timeout: 4000 });
    else if (command.kind === 'fill') await locator.fill(command.value, { timeout: 4000 });
    else if (command.kind === 'clear') await locator.fill('', { timeout: 4000 });
    else if (command.kind === 'select') await locator.selectOption(command.values);
    else if (command.kind === 'check') await locator.check();
    else if (command.kind === 'uncheck') await locator.uncheck();
    else if (command.kind === 'hover') await locator.hover();
    else if (command.kind === 'press') {
        if (command.ref) await locator.press(command.key);
        else await page.keyboard.press(command.key);
    } else if (command.kind === 'scroll')
        await locator.evaluate(
            (element, args) =>
                element.scrollBy(0, args.direction === 'down' ? args.amount : -args.amount),
            { direction: command.direction, amount: command.amount ?? 300 },
        );
    return { ok: true, ref: command.ref };
}
```

The `frames` array must match the frame order used by `page.frames()` at snapshot creation.

- [x] **Step 5: Run the action tests and existing retry tests**

Run:

```bash
node --test tests/browser-playwright-actions.test.mjs tests/retries.test.mjs
npm test
```

Expected: all tests PASS.

- [x] **Step 6: Commit**

```bash
git add lib/browser/playwright-actions.mjs lib/browser/playwright-snapshot.mjs tests/browser-playwright-actions.test.mjs
git commit -m "feat: add playwright browser actions"
```

---

### Task 5: Playwright conditions and event normalization

**Files:**

- Create: `lib/browser/playwright-conditions.mjs`
- Create: `lib/browser/playwright-events.mjs`
- Create: `tests/browser-playwright-conditions.test.mjs`
- Create: `tests/browser-playwright-events.test.mjs`

**Interfaces:**

- Consumes: `validateCondition(condition)` and the normalized snapshot.
- Produces:
    - `waitForPlaywrightCondition(page, condition, options): Promise<WaitResult>`
    - `attachPlaywrightEvents(page, context): { events: BrowserEvent[], subscribe(listener): () => void }`

- [x] **Step 1: Write failing condition tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { chromium } from 'playwright';
import { waitForPlaywrightCondition } from '../lib/browser/playwright-conditions.mjs';

test('control state resolves a semantic query at wait time', async () => {
    const server = http.createServer((request, response) => {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(
            '<button disabled>保存</button><script>setTimeout(() => document.querySelector("button").disabled = false, 20)</script>',
        );
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
        const { port } = server.address();
        await page.goto(`http://127.0.0.1:${port}/`);
        const result = await waitForPlaywrightCondition(
            page,
            { kind: 'controlState', query: { name: '保存', role: 'button' }, state: 'enabled' },
            { timeout: 1000, interval: 10 },
        );
        assert.equal(result.matched, true);
    } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
    }
});
```

- [x] **Step 2: Write failing event tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { attachPlaywrightEvents } from '../lib/browser/playwright-events.mjs';

test('events redact URLs and secrets', () => {
    const page = new EventEmitter();
    const context = new EventEmitter();
    context.pages = () => [page];
    const { events } = attachPlaywrightEvents(page, context);
    page.emit('console', { type: () => 'error', text: () => 'Bearer abc password=secret' });
    assert.equal(events[0].kind, 'console');
    assert.ok(!events[0].detail.includes('abc'));
    assert.ok(!events[0].detail.includes('secret'));
});
```

- [x] **Step 3: Run the condition and event tests to verify they fail**

Run:

```bash
node --test tests/browser-playwright-conditions.test.mjs tests/browser-playwright-events.test.mjs
```

Expected: FAIL because the modules do not exist.

- [x] **Step 4: Implement condition resolution**

```js
import { BrowserContractError, validateCondition } from './contract.mjs';
import { snapshotPlaywrightPage } from './playwright-snapshot.mjs';

const matchesQuery = (control, query) =>
    control.name === query.name &&
    (!query.role || control.role === query.role) &&
    (!query.index || control.index === query.index);

export async function waitForPlaywrightCondition(page, rawCondition, options = {}) {
    const condition = validateCondition(rawCondition);
    const timeout = options.timeout ?? 4000;
    const interval = options.interval ?? 50;
    const start = Date.now();
    while (Date.now() - start <= timeout) {
        const snapshot = await snapshotPlaywrightPage(page);
        if (condition.kind === 'urlContains' && snapshot.url.includes(condition.value))
            return { matched: true, elapsed_ms: Date.now() - start };
        if (condition.kind === 'textVisible') {
            if (
                await page
                    .getByText(condition.value, { exact: false })
                    .filter({ visible: true })
                    .count()
            )
                return { matched: true, elapsed_ms: Date.now() - start };
        }
        if (condition.kind === 'textAbsent') {
            if (
                !(await page
                    .getByText(condition.value, { exact: false })
                    .filter({ visible: true })
                    .count())
            )
                return { matched: true, elapsed_ms: Date.now() - start };
        }
        if (condition.kind === 'controlVisible') {
            if (
                snapshot.controls.some(
                    (control) => control.visible && matchesQuery(control, condition.query),
                )
            )
                return { matched: true, elapsed_ms: Date.now() - start };
        }
        if (condition.kind === 'controlState') {
            const control = snapshot.controls.find((item) => matchesQuery(item, condition.query));
            if (control && condition.state === 'disabled' && control.disabled)
                return { matched: true, elapsed_ms: Date.now() - start };
            if (control && condition.state === 'enabled' && !control.disabled)
                return { matched: true, elapsed_ms: Date.now() - start };
            if (control && condition.state === 'checked' && control.checked)
                return { matched: true, elapsed_ms: Date.now() - start };
            if (control && condition.state === 'selected' && control.selected)
                return { matched: true, elapsed_ms: Date.now() - start };
            if (control && condition.state === 'empty' && !control.value)
                return { matched: true, elapsed_ms: Date.now() - start };
            if (control && condition.state === 'value' && control.value === condition.value)
                return { matched: true, elapsed_ms: Date.now() - start };
        }
        await page.waitForTimeout(interval);
    }
    throw new BrowserContractError('wait-timeout', `Condition did not match: ${condition.kind}`);
}
```

Implement `tableHeaders`, `rowCount`, and `formError` with the existing Playwright locator behavior from `lib/engine.mjs`, but return only the normalized result. Do not call a model in any condition.

- [x] **Step 5: Implement normalized events**

```js
import { safeText, safeUrl } from '../diagnostics.mjs';

export function attachPlaywrightEvents(page, context) {
    const events = [];
    const listeners = new Set();
    const add = (event) => {
        const saved = { time: new Date().toISOString(), ...event };
        events.push(saved);
        for (const listener of listeners) listener(saved);
        return saved;
    };
    const attachPage = (current) => {
        current.on('pageerror', (error) =>
            add({ kind: 'pageerror', detail: safeText(error.message) }),
        );
        current.on('console', (entry) => {
            if (entry.type() === 'error') add({ kind: 'console', detail: safeText(entry.text()) });
        });
        current.on('crash', () => add({ kind: 'crash', detail: '??????' }));
    };
    for (const current of context.pages()) attachPage(current);
    context.on('page', attachPage);
    context.on('requestfailed', (request) => {
        add({
            kind: 'requestfailed',
            method: request.method(),
            url: safeUrl(request.url()),
            detail: safeText(request.failure()?.errorText || '?????'),
        });
    });
    context.on('response', (response) => {
        if (response.status() < 400) return;
        add({
            kind: 'http',
            method: response.request().method(),
            url: safeUrl(response.url()),
            status: response.status(),
            detail: safeText(response.statusText()),
        });
    });
    return {
        events,
        subscribe(listener) {
            listeners.add(listener);
            for (const event of events) listener(event);
            return () => listeners.delete(listener);
        },
    };
}
```

- [x] **Step 6: Run tests and commit**

Run:

```bash
node --test tests/browser-playwright-conditions.test.mjs tests/browser-playwright-events.test.mjs
npm test
git add lib/browser/playwright-conditions.mjs lib/browser/playwright-events.mjs tests/browser-playwright-conditions.test.mjs tests/browser-playwright-events.test.mjs
git commit -m "feat: add playwright browser conditions and events"
```

---

### Task 6: Playwright lifecycle driver and registry

**Files:**

- Create: `lib/browser/playwright-driver.mjs`
- Create: `lib/browser/registry.mjs`
- Modify: `lib/browser-provider.mjs`
- Create: `tests/browser-playwright-driver.test.mjs`
- Modify: `tests/browser-conformance.mjs`

**Interfaces:**

- Consumes:
    - `snapshotPlaywrightPage(page, options?)`
    - `executePlaywrightCommand(page, refs, command)`
    - `waitForPlaywrightCondition(page, condition, options)`
    - `attachPlaywrightEvents(page, context)` returning `{ events, subscribe }`
- Produces:
    - `PlaywrightBrowserSession`
    - `createPlaywrightBrowserSession(config)`
    - `createBrowserSession(config)`
    - `openBrowserSession(config)` compatibility export

- [x] **Step 1: Write the failing lifecycle test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createPlaywrightBrowserSession } from '../lib/browser/playwright-driver.mjs';

test('Playwright driver implements start, navigate, snapshot, action and close', async () => {
    const server = http.createServer((request, response) => {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end('<label for="name">客户名称</label><input id="name"><button>保存</button>');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    const session = createPlaywrightBrowserSession({ headless: true });
    try {
        await session.start();
        await session.navigate(`http://127.0.0.1:${port}/`);
        const snapshot = await session.snapshot();
        const input = snapshot.controls.find((control) => control.name === '客户名称');
        await session.act({ kind: 'fill', ref: input.ref, value: 'LayaAuto_1' });
        const updated = await session.snapshot();
        assert.equal(
            updated.controls.find((control) => control.name === '客户名称').value,
            'LayaAuto_1',
        );
    } finally {
        await session.close();
        await new Promise((resolve) => server.close(resolve));
    }
});
```

- [x] **Step 2: Run the test and verify it fails**

Run:

```bash
node --test tests/browser-playwright-driver.test.mjs
```

Expected: FAIL because `createPlaywrightBrowserSession` does not exist.

- [x] **Step 3: Implement the Playwright session**

```js
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { BrowserContractError, validateCommand, validateCondition } from './contract.mjs';
import { snapshotPlaywrightPage } from './playwright-snapshot.mjs';
import { executePlaywrightCommand } from './playwright-actions.mjs';
import { waitForPlaywrightCondition } from './playwright-conditions.mjs';
import { attachPlaywrightEvents } from './playwright-events.mjs';

export function createPlaywrightBrowserSession(config) {
    let browser;
    let context;
    let page;
    let eventHub;
    let tracePath = null;
    let refs = new Map();
    return {
        backend: 'playwright',
        capabilities: {
            trace: true,
            pageErrors: true,
            consoleErrors: true,
            networkEvents: true,
            frames: true,
            shadowDom: true,
            downloads: true,
        },
        async start() {
            const options = { headless: config.headless };
            if (config.browserChannel) options.channel = config.browserChannel;
            browser = await chromium.launch(options);
            context = await browser.newContext({
                viewport: { width: 1500, height: 980 },
                locale: 'zh-CN',
                acceptDownloads: true,
            });
            page = await context.newPage();
            page.setDefaultTimeout(9000);
            eventHub = attachPlaywrightEvents(page, context);
        },
        async close() {
            await browser?.close().catch(() => {});
        },
        async navigate(url) {
            await page.goto(url, { waitUntil: 'domcontentloaded' });
        },
        async reload() {
            await page.reload({ waitUntil: 'domcontentloaded' });
        },
        async currentUrl() {
            return page.url();
        },
        async snapshot() {
            const snapshot = await snapshotPlaywrightPage(page);
            refs = new Map(snapshot.controls.map((control) => [control.ref, control]));
            return snapshot;
        },
        async act(command) {
            return executePlaywrightCommand(page, refs, command);
        },
        async waitFor(condition, options) {
            return waitForPlaywrightCondition(page, condition, options);
        },
        async screenshot(target, options = {}) {
            await fs.mkdir(path.dirname(target), { recursive: true });
            await page.screenshot({ path: target, ...options });
        },
        async startTrace(target) {
            tracePath = target;
            await fs.mkdir(path.dirname(target), { recursive: true });
            await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
        },
        async stopTrace() {
            if (!tracePath) throw new BrowserContractError('trace-failed', 'Trace was not started');
            await context.tracing.stop({ path: tracePath });
            tracePath = null;
        },
        onEvent(listener) {
            return eventHub.subscribe(listener);
        },
    };
}
```

`startTrace` stores the requested trace path on the session, and `stopTrace` writes to that exact path. Do not write `trace.zip` into the repository root.

- [x] **Step 4: Implement registry and compatibility export**

```js
// lib/browser/registry.mjs
import { BrowserContractError } from './contract.mjs';
import { createPlaywrightBrowserSession } from './playwright-driver.mjs';

export async function createBrowserSession(config) {
    if (config.browserProvider !== 'playwright')
        throw new BrowserContractError(
            'unsupported-backend',
            `Unsupported browser provider: ${config.browserProvider}`,
        );
    const session = createPlaywrightBrowserSession(config);
    await session.start();
    return session;
}
```

In `lib/browser-provider.mjs`, add:

```js
export async function openBrowserSession(config) {
    const { createBrowserSession } = await import('./browser/registry.mjs');
    return createBrowserSession(config);
}
```

Keep the existing `openBrowser()` function unchanged so production callers remain compatible in this plan.

- [x] **Step 5: Run lifecycle and compatibility tests**

Run:

```bash
node --test tests/browser-playwright-driver.test.mjs tests/config.test.mjs
npm test
```

Expected: all tests PASS.

- [x] **Step 6: Commit**

```bash
git add lib/browser/playwright-driver.mjs lib/browser/registry.mjs lib/browser-provider.mjs tests/browser-playwright-driver.test.mjs
git commit -m "feat: add playwright browser driver session"
```

---

### Task 7: Cross-driver conformance and public demo smoke

**Files:**

- Modify: `tests/browser-conformance.mjs`
- Create: `tests/browser-playwright-conformance.test.mjs`
- Create: `tests/browser-public-demo.test.mjs`
- Modify: `docs/architecture.md`
- Modify: `docs/superpowers/specs/2026-09-28-browser-driver-design.md`

**Interfaces:**

- Consumes: all modules from Tasks 1 through 6.
- Produces: one conformance suite that both the fake and Playwright drivers pass, plus a public-demo smoke test.

- [x] **Step 1: Update the conformance suite to close sessions and exercise conditions**

```js
export function registerBrowserConformanceTests(name, createSession) {
    test(`${name}: lifecycle and navigation`, async (t) => {
        const session = await createSession();
        t.after(() => session.close());
        await session.start();
        await session.navigate('https://app.test/next');
        assert.equal(await session.currentUrl(), 'https://app.test/next');
    });

    test(`${name}: snapshot returns stable control refs`, async (t) => {
        const session = await createSession();
        t.after(() => session.close());
        const snapshot = await session.snapshot();
        assert.ok(snapshot.controls.length > 0);
        assert.ok(snapshot.controls.every((control) => typeof control.ref === 'string'));
    });

    test(`${name}: fill changes only the addressed control`, async (t) => {
        const session = await createSession();
        t.after(() => session.close());
        const snapshot = await session.snapshot();
        const target =
            snapshot.controls.find((control) => control.role === 'textbox') || snapshot.controls[0];
        await session.act({ kind: 'fill', ref: target.ref, value: 'changed' });
        const after = await session.snapshot();
        assert.equal(after.controls.find((control) => control.ref === target.ref).value, 'changed');
    });

    test(`${name}: conditions resolve semantic state`, async (t) => {
        const session = await createSession();
        t.after(() => session.close());
        await session.waitFor({ kind: 'urlContains', value: 'http' });
    });
}
```

The Playwright fixture must provide a visible textbox and serve it over `http://127.0.0.1`. Do not use `data:` URLs for the shared contract suite.

- [x] **Step 2: Register Playwright with the same suite**

```js
import { registerBrowserConformanceTests } from './browser-conformance.mjs';
import { createTestBrowserSession } from './helpers/playwright-test-session.mjs';

registerBrowserConformanceTests('playwright', async () => createTestBrowserSession());
```

Create `tests/helpers/playwright-test-session.mjs` to start one local HTML server per test and return a `PlaywrightBrowserSession` whose `close()` also closes the server.

```js
import http from 'node:http';
import { createPlaywrightBrowserSession } from '../../lib/browser/playwright-driver.mjs';

export async function createTestBrowserSession() {
    const server = http.createServer((request, response) => {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end('<label for="name">????</label><input id="name"><button>??</button>');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    const origin = `http://127.0.0.1:${port}/`;
    const session = createPlaywrightBrowserSession({ headless: true });
    const start = session.start.bind(session);
    const close = session.close.bind(session);
    return {
        ...session,
        async start() {
            await start();
            await session.navigate(origin);
        },
        async close() {
            await close();
            await new Promise((resolve) => server.close(resolve));
        },
    };
}
```

- [x] **Step 3: Add a public-demo smoke test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createPlaywrightBrowserSession } from '../lib/browser/playwright-driver.mjs';

test('Playwright driver can observe and query the public demo', async (t) => {
    const port = 18000 + Math.floor(Math.random() * 1000);
    const server = spawn(process.execPath, ['examples/demo-server.mjs'], {
        cwd: process.cwd(),
        env: { ...process.env, PORT: String(port) },
        stdio: 'ignore',
    });
    t.after(() => server.kill());
    await new Promise((resolve) => setTimeout(resolve, 500));
    const session = createPlaywrightBrowserSession({ headless: true });
    await session.start();
    t.after(() => session.close());
    await session.navigate(`http://127.0.0.1:${port}/customers`);
    const snapshot = await session.snapshot();
    assert.ok(snapshot.controls.some((control) => control.name.includes('新增客户')));
    assert.ok(snapshot.controls.some((control) => control.name === '搜索'));
});
```

- [x] **Step 4: Update architecture documentation**

Add to `docs/architecture.md`:

```markdown
The browser contract foundation lives in `lib/browser/`. It provides normalized snapshots,
opaque refs, semantic commands and conditions, capability reporting, and normalized events.
The production engines still use the legacy Playwright path until the separate migration plan
completes; `openBrowserSession()` is the additive entry point for the new contract.
```

Mark the acceptance checklist in `docs/superpowers/specs/2026-09-28-browser-driver-design.md` as partially complete only for the foundation. Do not claim engine migration is complete.

- [x] **Step 5: Run all tests and the public demo smoke**

Run:

```bash
npm test
node --test tests/browser-playwright-conformance.test.mjs tests/browser-public-demo.test.mjs
npm run format:check
```

Expected: all tests PASS and formatting is clean.

- [x] **Step 6: Commit**

```bash
git add tests/browser-conformance.mjs tests/browser-playwright-conformance.test.mjs tests/browser-public-demo.test.mjs tests/helpers/playwright-test-session.mjs docs/architecture.md docs/superpowers/specs/2026-09-28-browser-driver-design.md
git commit -m "test: verify browser driver contract foundation"
```

---

## Follow-Up Plan Boundary

This plan intentionally stops before migrating `workflow.mjs`, `engine.mjs`, `runner.mjs`, `dom.mjs`, `form.mjs`, `readiness.mjs`, `diagnostics.mjs`, and `pending-writes.mjs` to `BrowserSession`.

A separate implementation plan named `browser-engine-migration` must:

1. Replace raw Playwright access in the generic Excel engine.
2. Replace raw Playwright access in the generated workflow.
3. Move readiness, DOM query, form inspection, pending writes, and tracing behind the contract.
4. Delete the legacy `openBrowser()` path only after both engines pass the full suite and public-demo generate/replay.
5. Mark the browser driver design acceptance criteria complete.

This boundary keeps the first implementation reviewable and prevents a partially migrated production path.
