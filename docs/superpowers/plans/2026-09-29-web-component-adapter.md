# Web Component Adapter Implementation Plan

> **Review correction (2026-09-30):** Component metadata is detected directly in
> `lib/browser/playwright-snapshot.mjs`. An earlier adapter-registry proposal was removed;
> Task 1 below records the direct snapshot/Mantine fixture coverage instead.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend LayaPilot’s browser driver so Mantine 8 and Canvas-based Web components can be observed, operated, and asserted without changing the target frontend repository.

**Architecture:** Keep `BrowserSession` as the public boundary. Add direct component detection metadata, synthetic identity resolution, safe Tooltip label discovery, Mantine overlay handling, file/pointer/runtime commands, and visual assertions behind that boundary. Existing workbook generation and replay continue to consume normalized snapshots rather than raw selectors.

**Tech Stack:** Node.js 20+, Playwright 1.62, browser-use through CDP, Mantine 8 target DOM conventions, Node built-in `crypto`, `pixelmatch`, `pngjs`.

**Spec:** `docs/superpowers/specs/2026-09-29-web-component-adapter-design.md`

## Global Constraints

- Target mode is Web only: `http://127.0.0.1:3001` or another browser URL.
- Do not modify `E:\szxa-next-harness\szxa-next-desktop`.
- Existing CLI, workbook schema, retries, evidence, and generation policy behavior remain compatible.
- No raw `selector`, `xpath`, or `script` may be accepted in workbook replay commands.
- Every new snapshot field is optional and backward-compatible.
- Label discovery may hover controls but must never click unknown controls.
- Runtime instrumentation is injected only by the browser adapter and must not modify application source files.
- Ambiguous targets fail closed with `ambiguous-query`; unsupported canvas behavior fails closed with `unsupported-capability`.
- Existing Node and Python tests must remain green.

## Review Focus

- An unnamed icon button with a Mantine Tooltip must become discoverable without adding application ARIA.
- A visible Mantine Menu or Select dropdown must remain observable while a Modal is open.
- Two rows with identical visible text must not share a synthetic row identity.
- A hidden `input[type=file]` behind a `FileButton` or dropzone must accept files without opening an OS dialog.
- A Canvas element without a semantic DOM or library bridge must be marked unsupported instead of receiving a guessed click.

---

### Task 1: Direct adapter metadata

**Final implementation:** `lib/browser/playwright-snapshot.mjs` detects component metadata directly while normalizing controls. There is no adapter registry or registration API.

Direct detection currently assigns `component`/`adapter` for Mantine Select, MultiSelect, DateInput, Button/ActionIcon, option, and menu items; `component='canvas'` for canvas controls; and `component='selector-dialog'` for native/ARIA modal table/tree selection dialogs. Public snapshot fields `component`, `adapter`, `testId`, `expanded`, and `layer` are covered by `tests/browser-playwright-snapshot.test.mjs`, `tests/browser-mantine-snapshot.test.mjs`, and `tests/browser-custom-selectors.test.mjs`.

---

### Task 2: Synthetic identities and stable row keys

**Files:**

- Create: `lib/browser/identity-resolver.mjs`
- Modify: `lib/browser/playwright-snapshot.mjs`
- Test: `tests/browser-identity-resolver.test.mjs`
- Test: `tests/browser-playwright-snapshot.test.mjs`

**Interfaces:**

- Consumes: `{ dataRowKey, testId, id, rowText, tableIndex, rowIndex }`.
- Produces: `stableHash(value)` and `resolveRowKey(identity)`.
- Snapshot controls retain `rowKey`, but it may now be synthetic.

- [ ] **Step 1: Write the failing identity test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveRowKey, stableHash } from '../lib/browser/identity-resolver.mjs';

test('prefers explicit row attributes', () => {
    assert.equal(resolveRowKey({ dataRowKey: 'customer-7' }), 'customer-7');
    assert.equal(resolveRowKey({ testId: 'row-8' }), 'row-8');
    assert.equal(resolveRowKey({ id: 'row-9' }), 'row-9');
});

test('synthetic row keys include table and row position', () => {
    const first = resolveRowKey({ rowText: '张三 13800000000', tableIndex: 0, rowIndex: 1 });
    const second = resolveRowKey({ rowText: '张三 13800000000', tableIndex: 0, rowIndex: 2 });
    assert.notEqual(first, second);
    assert.match(first, /^table-0:row-1:/);
    assert.equal(stableHash('abc'), stableHash('abc'));
});
```

- [ ] **Step 2: Write the failing snapshot test**

Add to `tests/browser-playwright-snapshot.test.mjs`:

```js
test('snapshot synthesizes row keys for native tables without data-row-key', async () => {
    const server = http.createServer((request, response) => {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(`
            <table>
                <tbody>
                    <tr><td>张三</td><td><button>查看</button></td></tr>
                    <tr><td>张三</td><td><button>查看</button></td></tr>
                </tbody>
            </table>
        `);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
        const { port } = server.address();
        await page.goto(`http://127.0.0.1:${port}/`);
        const snapshot = await snapshotPlaywrightPage(page);
        const buttons = snapshot.controls.filter((control) => control.name === '查看');
        assert.equal(buttons.length, 2);
        assert.equal(new Set(buttons.map((control) => control.rowKey)).size, 2);
        assert.ok(buttons.every((control) => control.rowKey.startsWith('table-0:row-')));
    } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
    }
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
node --test tests/browser-identity-resolver.test.mjs tests/browser-playwright-snapshot.test.mjs
```

Expected: missing identity module and failing snapshot row-key assertions.

- [ ] **Step 4: Implement the identity resolver**

Create `lib/browser/identity-resolver.mjs`:

```js
import { createHash } from 'node:crypto';

export function stableHash(value) {
    return createHash('sha1').update(String(value)).digest('hex').slice(0, 12);
}

export function resolveRowKey(identity = {}) {
    const explicit = identity.dataRowKey || identity.testId || identity.id;
    if (explicit) return String(explicit);
    const tableIndex = Number.isInteger(identity.tableIndex) ? identity.tableIndex : 0;
    const rowIndex = Number.isInteger(identity.rowIndex) ? identity.rowIndex : 0;
    const text = String(identity.rowText || '')
        .replace(/\s+/g, ' ')
        .trim();
    if (!text) return `table-${tableIndex}:row-${rowIndex}`;
    return `table-${tableIndex}:row-${rowIndex}:${stableHash(text)}`;
}
```

- [ ] **Step 5: Integrate identity resolution into the snapshot**

Inside the page evaluation in `lib/browser/playwright-snapshot.mjs`, calculate:

```js
const table = e.closest('table,[role="table"]');
const allRows = table ? [...table.querySelectorAll('tbody tr,[role="row"]')] : [];
const rowIndex = row ? allRows.indexOf(row) : -1;
const allTables = [...document.querySelectorAll('table,[role="table"]')];
const tableIndex = table ? allTables.indexOf(table) : -1;
const rowIdentity = {
    dataRowKey: row?.getAttribute('data-row-key') || '',
    testId: row?.getAttribute('data-testid') || '',
    id: row?.id || '',
    rowText,
    tableIndex: tableIndex < 0 ? -1 : tableIndex,
    rowIndex: rowIndex < 0 ? 0 : rowIndex,
};
```

Return `rowIdentity` from the page evaluation. After `controls.push(...items)` in Node:

```js
const normalizedControls = controls.map((control) => {
    const { rowIdentity, ...rest } = control;
    return {
        ...rest,
        rowKey: resolveRowKey(rowIdentity),
        frameRef: 'f' + control.frame,
        frameIndex: control.frame,
        visible: true,
        href: control.href ? safeUrl(control.href) : '',
        snapshotNonce: nonce,
    };
});
```

Import the resolver at the top of `playwright-snapshot.mjs`:

```js
import { resolveRowKey } from './identity-resolver.mjs';
```

- [ ] **Step 6: Run focused and full tests**

Run:

```bash
node --test tests/browser-identity-resolver.test.mjs tests/browser-playwright-snapshot.test.mjs tests/form-snapshot.test.mjs
npm test
```

Expected: all tests pass and existing `data-row-key` behavior remains unchanged.

- [ ] **Step 7: Commit**

```bash
git add lib/browser/identity-resolver.mjs lib/browser/playwright-snapshot.mjs tests/browser-identity-resolver.test.mjs tests/browser-playwright-snapshot.test.mjs
git commit -m "feat: synthesize stable row identities"
```

---

### Task 3: Unnamed controls and Tooltip label discovery

**Files:**

- Modify: `lib/browser/playwright-snapshot.mjs`
- Modify: `lib/browser/playwright-driver.mjs`
- Modify: `lib/dom.mjs`
- Modify: `lib/engine.mjs`
- Modify: `lib/workflow.mjs`
- Test: `tests/browser-label-discovery.test.mjs`

**Interfaces:**

- Produces: `session.discoverLabels(options)` returning a fresh public snapshot.
- Produces: `discoverLabels(source, options)` in `lib/dom.mjs`.
- Snapshot raw controls include internal `nameSource: 'dom' | 'synthetic'`.
- Public controls keep synthetic names such as `图标:1` until Tooltip discovery replaces them.

- [ ] **Step 1: Write the failing Tooltip discovery test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { chromium } from 'playwright';
import { snapshotPlaywrightPage } from '../lib/browser/playwright-snapshot.mjs';

test('unnamed icon buttons retain a synthetic name and discover Tooltip text', async () => {
    const server = http.createServer((request, response) => {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(`
            <button id="delete" aria-describedby="tip-delete">
                <svg viewBox="0 0 24 24"><path d="M1 1h22v22H1z"></path></svg>
            </button>
            <div id="tip-delete" role="tooltip" style="display:none">删除</div>
            <script>
                const button = document.getElementById('delete');
                const tip = document.getElementById('tip-delete');
                button.addEventListener('mouseenter', () => tip.style.display = 'block');
                button.addEventListener('mouseleave', () => tip.style.display = 'none');
            </script>
        `);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
        const { port } = server.address();
        await page.goto(`http://127.0.0.1:${port}/`);
        const before = await snapshotPlaywrightPage(page);
        const icon = before.controls.find((control) => control.role === 'button');
        assert.equal(icon.name, '图标:1');
        assert.equal(icon.nameSource, 'synthetic');
    } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
    }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node --test tests/browser-label-discovery.test.mjs
```

Expected: the unnamed button is currently filtered out or has no synthetic name.

- [ ] **Step 3: Retain unnamed controls in the snapshot**

In `lib/browser/playwright-snapshot.mjs`, track whether a DOM-derived name existed:

```js
const domName = (
    tooltipAction ||
    tooltip ||
    e.getAttribute('aria-label') ||
    labelled ||
    labels ||
    parentLabel ||
    sibLabel ||
    e.getAttribute('placeholder') ||
    e.getAttribute('title') ||
    ownText ||
    selectHint ||
    e.getAttribute('name') ||
    ''
)
    .replace(/^\*\s*/, '')
    .slice(0, 130);
const nameSource = domName ? 'dom' : 'synthetic';
const name = domName || `图标:${i + 1}`;
```

Return `nameSource` in each raw control. Replace the final filter with:

```js
.filter((x) => x.name || x.role === 'password');
```

Because unnamed controls now receive `图标:N`, they remain observable.

- [ ] **Step 4: Implement `discoverLabels` in the Playwright driver**

Add to the object returned by `createPlaywrightBrowserSession()` in `lib/browser/playwright-driver.mjs`:

```js
async discoverLabels(options = {}) {
    const current = requirePage();
    const raw = await snapshotPlaywrightPage(current);
    const max = Math.min(Number(options.limit || 40), 100);
    const targets = raw.controls
        .filter((control) => !options.rowKey || control.rowKey === options.rowKey)
        .filter((control) => control.nameSource === 'synthetic')
        .filter((control) => ['button', 'link', 'menuitem', 'tab'].includes(control.role))
        .slice(0, max);

    for (const control of targets) {
        const frame = current.frames()[control.frameIndex];
        if (!frame) continue;
        const locator = frame.locator(`[data-laya-live-ref="${control.ref}"]`).first();
        try {
            await locator.hover({ timeout: 1500 });
            await current.waitForTimeout(120);
            const tips = frame.locator(
                '[role="tooltip"]:visible,.mantine-Tooltip-tooltip:visible'
            );
            const labels = [
                ...new Set((await tips.allTextContents()).map((text) => text.trim()).filter(Boolean)),
            ];
            if (labels.length === 1 && labels[0].length <= 100) {
                await locator.evaluate(
                    (element, label) => element.setAttribute('data-laya-tooltip-label', label),
                    labels[0]
                );
            }
        } catch {}
        await current.mouse.move(0, 0);
    }
    return this.snapshot();
}
```

- [ ] **Step 5: Expose the discovery helper from `lib/dom.mjs`**

Add:

```js
export async function discoverLabels(source, options = {}) {
    if (source?.discoverLabels) return source.discoverLabels(options);
    return (await legacy()).discoverRowLabels(source, options.rowKey || '');
}
```

Change `discoverRowLabels()` to call `discoverLabels()` first:

```js
export async function discoverRowLabels(source, rowKey) {
    if (source?.discoverLabels) return source.discoverLabels({ rowKey });
    return (await legacy()).discoverRowLabels(source, rowKey);
}
```

- [ ] **Step 6: Invoke discovery before generated actions**

In `lib/engine.mjs` after each successful `ready()` call, add:

```js
if (typeof this.browser.discoverLabels === 'function') await this.browser.discoverLabels();
```

In `lib/workflow.mjs` after a workflow snapshot is ready and before generating operations, add:

```js
if (typeof this.browser.discoverLabels === 'function') await this.browser.discoverLabels();
```

Do not click any control during discovery.

- [ ] **Step 7: Run focused and full tests**

Run:

```bash
node --test tests/browser-label-discovery.test.mjs tests/planner.test.mjs tests/workflow.test.mjs tests/guards.test.mjs
npm test
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add lib/browser/playwright-snapshot.mjs lib/browser/playwright-driver.mjs lib/dom.mjs lib/engine.mjs lib/workflow.mjs tests/browser-label-discovery.test.mjs
git commit -m "feat: discover labels for unnamed icon controls"
```

---

### Task 4: Mantine observation, overlays, validation errors, and loading

**Files:**

- Modify: `lib/browser/playwright-snapshot.mjs`
- Modify: `lib/browser/playwright-conditions.mjs`
- Modify: `lib/browser/playwright-driver.mjs`
- Modify: `lib/browser/playwright-readiness.mjs`
- Create: `examples/mantine-components.html`
- Modify: `examples/demo-server.mjs`
- Test: `tests/browser-mantine-snapshot.test.mjs`

**Interfaces:**

- Consumes: normalized controls and overlays.
- Produces: `component`, `expanded`, `layer`, Mantine error state, and active-overlay filtering.
- Real modals are detected only from `dialog[open]`, `[role="dialog"][aria-modal="true"]`, or `[data-modal-content]`.
- Portaled `role="menu"`, `role="listbox"`, and Mantine dropdown elements remain observable while a modal is open.

- [ ] **Step 1: Create the failing Mantine fixture**

Create `examples/mantine-components.html`:

```html
<!doctype html>
<html lang="zh-CN">
    <head>
        <meta charset="utf-8" />
        <title>Mantine Adapter Fixture</title>
    </head>
    <body>
        <button id="open-modal">打开编辑弹窗</button>
        <div id="portal-root"></div>
        <script>
            const portal = document.getElementById('portal-root');
            document.getElementById('open-modal').addEventListener('click', () => {
                const modal = document.createElement('section');
                modal.id = 'edit-modal';
                modal.className = 'mantine-Modal-content';
                modal.setAttribute('role', 'dialog');
                modal.setAttribute('aria-modal', 'true');
                modal.setAttribute('aria-label', '编辑客户');
                modal.innerHTML = `
                    <button id="select-status" role="combobox" aria-haspopup="listbox" aria-label="状态" aria-expanded="false">未选择</button>
                    <button id="open-menu" aria-haspopup="menu">更多</button>
                    <label for="deadline">截止日期</label>
                    <input id="deadline" aria-describedby="deadline-error">
                    <div id="deadline-error" class="mantine-InputWrapper-error">日期无效</div>
                `;
                portal.append(modal);

                const status = modal.querySelector('#select-status');
                const options = document.createElement('div');
                options.id = 'status-options';
                options.className = 'mantine-Select-dropdown';
                options.setAttribute('role', 'listbox');
                options.innerHTML =
                    '<div role="option">待处理</div><div role="option">已完成</div>';
                options.hidden = true;
                portal.append(options);
                status.addEventListener('click', () => {
                    const willOpen = options.hidden === true;
                    options.hidden = !willOpen;
                    status.setAttribute('aria-expanded', String(willOpen));
                });

                const menuButton = modal.querySelector('#open-menu');
                const menu = document.createElement('div');
                menu.id = 'row-menu';
                menu.className = 'mantine-Menu-dropdown';
                menu.setAttribute('role', 'menu');
                menu.innerHTML =
                    '<button role="menuitem">编辑</button><button role="menuitem">删除</button>';
                portal.append(menu);
                menuButton.addEventListener('click', () => {
                    menu.hidden = !menu.hidden;
                });
            });
        </script>
    </body>
</html>
```

Add the fixture route to `examples/demo-server.mjs`:

```js
const mantineComponents = await fs.readFile(
    new URL('./mantine-components.html', import.meta.url),
    'utf8',
);
```

and:

```js
if (req.url === '/mantine-components') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(mantineComponents);
    return;
}
```

- [ ] **Step 2: Write the failing snapshot test**

Create `tests/browser-mantine-snapshot.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createPlaywrightBrowserSession } from '../lib/browser/playwright-driver.mjs';

async function waitForServer(url) {
    for (let attempt = 0; attempt < 30; attempt++) {
        try {
            if ((await fetch(url)).ok) return;
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('fixture did not start');
}

test('Mantine modals, portals, options, menus and errors are observable', async (t) => {
    const port = 19100 + Math.floor(Math.random() * 500);
    const base = `http://127.0.0.1:${port}`;
    const server = spawn(process.execPath, ['examples/demo-server.mjs'], {
        cwd: process.cwd(),
        env: { ...process.env, PORT: String(port) },
        stdio: 'ignore',
    });
    const session = createPlaywrightBrowserSession({ headless: true });
    t.after(async () => {
        await session.close();
        server.kill();
    });
    await waitForServer(`${base}/mantine-components`);
    await session.start();
    await session.navigate(`${base}/mantine-components`);

    let snapshot = await session.snapshot();
    const open = snapshot.controls.find((control) => control.name === '打开编辑弹窗');
    await session.act({ kind: 'click', ref: open.ref });

    snapshot = await session.snapshot();
    assert.equal(snapshot.modal.name, '编辑客户');
    const status = snapshot.controls.find((control) => control.name === '状态');
    assert.equal(status.component, 'select');
    assert.equal(status.expanded, false);

    const menu = snapshot.controls.find((control) => control.name === '更多');
    await session.act({ kind: 'click', ref: menu.ref });
    snapshot = await session.snapshot();
    assert.ok(
        snapshot.controls.some((control) => control.role === 'menuitem' && control.name === '删除'),
    );

    await session.act({ kind: 'click', ref: status.ref });
    snapshot = await session.snapshot();
    assert.ok(
        snapshot.controls.some((control) => control.role === 'option' && control.name === '已完成'),
    );

    const deadline = snapshot.controls.find((control) => control.name === '截止日期');
    assert.equal(deadline.invalid, true);
    assert.equal(deadline.validationMessage, '日期无效');
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run:

```bash
node --test tests/browser-mantine-snapshot.test.mjs
```

Expected: menu/options are filtered out, modal detection is wrong, or Mantine error metadata is missing.

- [ ] **Step 4: Implement Mantine overlay and modal detection**

In `lib/browser/playwright-snapshot.mjs`, replace generic modal detection with:

```js
const modalSelector =
    'dialog[open],[role="dialog"][aria-modal="true"],[data-modal-content],.ant-modal-wrap,.el-dialog';
const modal = roots
    .flatMap((root) => [...root.querySelectorAll(modalSelector)])
    .filter(visible)
    .at(-1);
const overlaySelector = [
    '[role="menu"]',
    '[role="listbox"]',
    '[role="dialog"]',
    '[role="tooltip"]',
    '[data-menu-dropdown]',
    '.mantine-Select-dropdown',
    '.mantine-MultiSelect-dropdown',
    '.mantine-DatePicker-dropdown',
    '.mantine-Tooltip-tooltip',
].join(',');
const overlays = roots
    .flatMap((root) => [...root.querySelectorAll(overlaySelector)])
    .filter(visible)
    .filter((element) => !modal || element !== modal);
```

When a modal exists and scope is not `page` or `owned-row`, retain controls that are inside the modal or inside one of the active overlays:

```js
if (modal && scope !== 'page' && scope !== 'owned-row')
    elements = elements.filter(
        (element) =>
            modal.contains(element) || overlays.some((overlay) => overlay.contains(element)),
    );
```

Add `layer` to each returned control:

```js
layer: modal?.contains(e) ? 'modal' : overlays.some((overlay) => overlay.contains(e)) ? 'overlay' : 'page',
```

- [ ] **Step 5: Add Mantine component metadata**

Inside the element mapping in `playwright-snapshot.mjs`, add:

```js
const classList = [...e.classList];
const isMultiSelect =
    role === 'combobox' &&
    (classList.some((name) => name.includes('MultiSelect')) ||
        e.getAttribute('aria-multiselectable') === 'true');
const isSelect =
    role === 'combobox' &&
    !isMultiSelect &&
    (e.getAttribute('aria-haspopup') === 'listbox' ||
        classList.some((name) => name.includes('Select')));
const isDate =
    tag === 'input' &&
    (classList.some((name) => name.includes('DateInput') || name.includes('DateTimePicker')) ||
        e.getAttribute('data-mantine-date') === 'true');
const mantineComponent = isSelect
    ? 'select'
    : isMultiSelect
      ? 'multi-select'
      : isDate
        ? 'date'
        : role === 'option'
          ? 'option'
          : role === 'menuitem'
            ? 'menuitem'
            : '';
const descriptor = mantineComponent ? { adapter: 'mantine', component: mantineComponent } : {};
const expanded = e.getAttribute('aria-expanded') === 'true';
```

Return:

```js
...descriptor,
expanded,
testId: e.getAttribute('data-testid') || '',
```

- [ ] **Step 6: Detect Mantine validation errors**

Add inside the page evaluation:

```js
const describedBy = (e.getAttribute('aria-describedby') || '')
    .split(/\s+/)
    .map((id) => document.getElementById(id))
    .filter(Boolean);
const mantineError = describedBy
    .filter((element) => element.classList.contains('mantine-InputWrapper-error'))
    .map(text)
    .join(' ');
```

Change `invalid` and `validationMessage`:

```js
invalid:
    (typeof e.checkValidity === 'function' && !e.checkValidity()) ||
    !!mantineError ||
    !!e.closest('.ant-form-item-has-error,.has-error,.el-form-item.is-error,.is-error'),
validationMessage: mantineError || e.validationMessage || '',
```

- [ ] **Step 7: Recognize Mantine errors and loading overlays in conditions/readiness**

In `lib/browser/playwright-conditions.mjs`, change `formErrorTexts` selector to:

```js
'[role="alert"]:visible,.ant-form-item-explain-error:visible,.el-form-item__error:visible,.mantine-InputWrapper-error:visible';
```

In `lib/browser/playwright-driver.mjs`, change `settle()` loading selector to:

```js
'[aria-busy="true"]:visible,.ant-spin-spinning:visible,.el-loading-mask:visible,.mantine-LoadingOverlay-root:visible';
```

In `lib/browser/playwright-readiness.mjs`, add `.mantine-LoadingOverlay-root` to the busy selector.

- [ ] **Step 8: Run focused and full tests**

Run:

```bash
node --test tests/browser-mantine-snapshot.test.mjs tests/browser-playwright-conditions.test.mjs tests/browser-components.test.mjs
npm test
```

Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add lib/browser/playwright-snapshot.mjs lib/browser/playwright-conditions.mjs lib/browser/playwright-driver.mjs lib/browser/playwright-readiness.mjs examples/mantine-components.html examples/demo-server.mjs tests/browser-mantine-snapshot.test.mjs
git commit -m "feat: adapt Mantine overlays errors and loading"
```

---

### Task 5: File upload command

**Files:**

- Modify: `lib/browser/contract.mjs`
- Modify: `lib/browser/playwright-actions.mjs`
- Modify: `lib/browser/playwright-driver.mjs`
- Test: `tests/browser-upload.test.mjs`

**Interfaces:**

- Produces command `{ kind: 'upload', ref, files: string[] }`.
- Uses hidden `input[type=file]` first, then Playwright file chooser interception.
- Never accepts arbitrary selectors or scripts from workbook commands.

- [ ] **Step 1: Write the failing upload test**

Create `tests/browser-upload.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { snapshotPlaywrightPage } from '../lib/browser/playwright-snapshot.mjs';
import { executePlaywrightCommand } from '../lib/browser/playwright-actions.mjs';

test('upload sets a hidden FileButton input and dispatches a browser change event', async () => {
    const server = http.createServer((request, response) => {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(`
            <button id="dropzone" onclick="document.getElementById('file').click()">上传附件</button>
            <input id="file" type="file" style="display:none">
            <output id="name"></output>
            <script>
                document.getElementById('file').addEventListener('change', (event) => {
                    document.getElementById('name').textContent = event.target.files[0]?.name || '';
                });
            </script>
        `);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'laya-upload-'));
    const file = path.join(dir, 'evidence.txt');
    await fs.writeFile(file, 'evidence');
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
        const { port } = server.address();
        await page.goto(`http://127.0.0.1:${port}/`);
        const snapshot = await snapshotPlaywrightPage(page);
        const target = snapshot.controls.find((control) => control.name === '上传附件');
        const refs = new Map(snapshot.controls.map((control) => [control.ref, control]));
        await executePlaywrightCommand(page, refs, {
            kind: 'upload',
            ref: target.ref,
            files: [file],
        });
        assert.equal(await page.locator('#name').textContent(), 'evidence.txt');
    } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
        await fs.rm(dir, { recursive: true, force: true });
    }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node --test tests/browser-upload.test.mjs
```

Expected: unsupported command `upload`.

- [ ] **Step 3: Extend the command contract**

In `lib/browser/contract.mjs` add:

```js
upload: new Set(['kind', 'ref', 'files']),
```

Add `'upload'` to `REF_COMMANDS`. Add validation:

```js
if (command.kind === 'upload') {
    if (!Array.isArray(command.files) || !command.files.length)
        fail('invalid-command', 'command.files must be non-empty');
    command.files.forEach((file) => requireString(file, 'command.files[]'));
}
```

- [ ] **Step 4: Implement upload execution**

In `lib/browser/playwright-actions.mjs` add:

```js
const resolveFileInput = async (control, locator) => {
    if (control.tag === 'input') {
        const type = await locator.getAttribute('type').catch(() => '');
        if (type === 'file') return locator;
    }
    const nested = locator.locator('input[type="file"]').last();
    if (await nested.count()) return nested;
    const owner = locator
        .locator('xpath=ancestor::*[.//input[@type="file"]][1]//input[@type="file"]')
        .last();
    if (await owner.count()) return owner;
    return null;
};
```

Dispatch inside `executePlaywrightCommand()`:

```js
else if (command.kind === 'upload') {
    const fileInput = await resolveFileInput(control, locator);
    if (fileInput) {
        await fileInput.setInputFiles(command.files, { timeout: 4000 });
    } else {
        const chooserPromise = page.waitForEvent('filechooser', { timeout: 4000 });
        await locator.click({ timeout: 4000 });
        const chooser = await chooserPromise;
        await chooser.setFiles(command.files);
    }
}
```

- [ ] **Step 5: Expose the command through the session**

No driver method change is required because `playwright-driver.mjs` forwards `act()` to `executePlaywrightCommand()`. Confirm browser-use still works because it is a Playwright session connected over CDP.

- [ ] **Step 6: Run focused and full tests**

Run:

```bash
node --test tests/browser-upload.test.mjs tests/browser-contract-validation.test.mjs tests/browser-playwright-actions.test.mjs
npm test
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add lib/browser/contract.mjs lib/browser/playwright-actions.mjs tests/browser-upload.test.mjs
git commit -m "feat: add web file upload command"
```

---

### Task 6: Mantine Select, MultiSelect, DatePicker and DataTable interactions

**Files:**

- Create: `lib/browser/adapters/mantine-actions.mjs`
- Modify: `lib/browser/playwright-actions.mjs`
- Modify: `lib/browser/playwright-conditions.mjs`
- Modify: `lib/browser/playwright-snapshot.mjs`
- Test: `tests/browser-mantine-actions.test.mjs`

**Interfaces:**

- Consumes: `control.component` values `select`, `multi-select`, `date`, `table`.
- Produces: `selectVisibleOption(page, value)`, `fillMantineDate(locator, value)`, and table-state assertions.
- Mantine option lookup is exact text and fails on zero or multiple matches.

- [ ] **Step 1: Write the failing Mantine action test**

Create `tests/browser-mantine-actions.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { chromium } from 'playwright';
import { snapshotPlaywrightPage } from '../lib/browser/playwright-snapshot.mjs';
import { executePlaywrightCommand } from '../lib/browser/playwright-actions.mjs';

test('select chooses a Mantine listbox option by exact text', async () => {
    const server = http.createServer((request, response) => {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(`
            <button id="status" role="combobox" aria-haspopup="listbox" aria-label="状态" aria-expanded="false">未选择</button>
            <div id="options" role="listbox" hidden>
                <div role="option">待处理</div>
                <div role="option">已完成</div>
            </div>
            <script>
                const status = document.getElementById('status');
                const options = document.getElementById('options');
                status.addEventListener('click', () => {
                    options.hidden = false;
                    status.setAttribute('aria-expanded', 'true');
                });
                for (const option of options.querySelectorAll('[role="option"]')) {
                    option.addEventListener('click', () => {
                        status.textContent = option.textContent;
                        status.setAttribute('aria-expanded', 'false');
                        options.hidden = true;
                    });
                }
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
        const status = snapshot.controls.find((control) => control.name === '状态');
        const refs = new Map(snapshot.controls.map((control) => [control.ref, control]));
        await executePlaywrightCommand(page, refs, {
            kind: 'select',
            ref: status.ref,
            values: ['已完成'],
        });
        assert.equal(await page.locator('#status').textContent(), '已完成');
    } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
    }
});

test('DatePicker accepts a typed value and DataTable pagination remains observable', async () => {
    const server = http.createServer((request, response) => {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(`
            <label for="deadline">截止日期</label>
            <input id="deadline" class="mantine-DateInput-input" valueFormat="YYYY-MM-DD">
            <table class="mantine-datatable-table"><thead><tr><th>名称</th></tr></thead><tbody><tr><td>A</td></tr></tbody></table>
            <div class="mantine-datatable-pagination">
                <button aria-label="Previous page">Previous</button>
                <button aria-label="Next page">Next</button>
            </div>
        `);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
        const { port } = server.address();
        await page.goto(`http://127.0.0.1:${port}/`);
        const snapshot = await snapshotPlaywrightPage(page);
        const deadline = snapshot.controls.find((control) => control.name === '截止日期');
        const refs = new Map(snapshot.controls.map((control) => [control.ref, control]));
        await executePlaywrightCommand(page, refs, {
            kind: 'fill',
            ref: deadline.ref,
            value: '2026-09-30',
        });
        assert.equal(await page.locator('#deadline').inputValue(), '2026-09-30');
        assert.ok(snapshot.controls.some((control) => control.component === 'table-pagination'));
    } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
    }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
node --test tests/browser-mantine-actions.test.mjs
```

Expected: component metadata and exact option selection are missing.

- [ ] **Step 3: Implement Mantine option selection**

Create `lib/browser/adapters/mantine-actions.mjs`:

```js
import { BrowserContractError } from '../contract.mjs';

export async function selectVisibleOption(page, value) {
    const options = page.locator('[role="option"]:visible');
    const count = await options.count();
    const matches = [];
    for (let index = 0; index < count; index += 1) {
        const option = options.nth(index);
        if ((await option.innerText()).trim() === value) matches.push(option);
    }
    if (matches.length !== 1)
        throw new BrowserContractError(
            'ambiguous-query',
            `Mantine option matched ${matches.length} controls: ${value}`,
        );
    await matches[0].click({ timeout: 4000 });
}

export async function fillMantineDate(locator, value) {
    await locator.click({ timeout: 4000 });
    await locator.fill(value, { timeout: 4000 });
    await locator.press('Enter').catch(() => {});
    const actual = await locator.inputValue().catch(() => '');
    if (actual !== value)
        throw new BrowserContractError(
            'unsupported-capability',
            `Mantine date value was not accepted: expected ${value}, got ${actual || '<empty>'}`,
        );
}
```

- [ ] **Step 4: Dispatch Mantine-specific actions**

In `lib/browser/playwright-actions.mjs` import:

```js
import { fillMantineDate, selectVisibleOption } from './adapters/mantine-actions.mjs';
```

Extend the `select` branch:

```js
else if (command.kind === 'select') {
    if (control.tag === 'select') await locator.selectOption(command.values);
    else if (control.component === 'select' || control.component === 'multi-select') {
        for (const value of command.values) {
            await locator.click({ timeout: 4000 });
            await selectVisibleOption(page, value);
        }
    } else await selectCustomControl(page, locator, command.values);
}
```

Extend the `fill` branch:

```js
else if (command.kind === 'fill') {
    const value =
        command.clear === false
            ? String(await locator.inputValue()) + command.value
            : command.value;
    if (control.component === 'date') await fillMantineDate(locator, value);
    else await locator.fill(value, { timeout: 4000 });
}
```

- [ ] **Step 5: Add table pagination metadata**

In `playwright-snapshot.mjs`, detect pagination containers:

```js
const tablePagination = e.closest('.mantine-datatable-pagination');
const component = tablePagination ? 'table-pagination' : mantineComponent;
```

Return `component` in the descriptor. Keep `role` and `name` as the normal accessible control fields.

- [ ] **Step 6: Add DataTable state conditions**

In `lib/browser/playwright-conditions.mjs`, extend `controlState` with:

```js
(condition.state === 'expanded' && control.expanded) ||
(condition.state === 'collapsed' && control.expanded === false) ||
```

This lets replay assert Mantine select and menu state.

- [ ] **Step 7: Run focused and full tests**

Run:

```bash
node --test tests/browser-mantine-actions.test.mjs tests/browser-playwright-actions.test.mjs tests/browser-playwright-conditions.test.mjs
npm test
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add lib/browser/adapters/mantine-actions.mjs lib/browser/playwright-actions.mjs lib/browser/playwright-conditions.mjs lib/browser/playwright-snapshot.mjs tests/browser-mantine-actions.test.mjs
git commit -m "feat: operate Mantine selects dates and tables"
```

---

### Task 7: Pointer drag and structural custom-selector coverage

**Files:**

- Modify: `lib/browser/contract.mjs`
- Modify: `lib/browser/playwright-actions.mjs`
- Modify: `lib/browser/playwright-snapshot.mjs`
- Test: `tests/browser-pointer-drag.test.mjs`
- Test: `tests/browser-custom-selectors.test.mjs`

**Interfaces:**

- Produces command `{ kind: 'drag', ref, toRef, steps?: number, delay?: number }`.
- Snapshot marks controls inside a dialog containing a table/tree and a confirmation action as `component: 'selector-dialog'`.
- Custom selector workflows use existing `click`, `check`, and row-scoped actions; no raw selector/script is added.

- [ ] **Step 1: Write the failing drag test**

Create `tests/browser-pointer-drag.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { chromium } from 'playwright';
import { snapshotPlaywrightPage } from '../lib/browser/playwright-snapshot.mjs';
import { executePlaywrightCommand } from '../lib/browser/playwright-actions.mjs';

test('drag moves a draggable element to another element', async () => {
    const server = http.createServer((request, response) => {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(`
            <div id="source" draggable="true" style="width:80px;height:40px">卡片</div>
            <div id="target" role="button" tabindex="0" style="width:200px;height:80px;margin-top:40px">目标区域</div>
            <script>
                const source = document.getElementById('source');
                const target = document.getElementById('target');
                source.addEventListener('dragend', () => {
                    target.textContent = '已移动';
                });
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
        const source = snapshot.controls.find((control) => control.name === '卡片');
        const target = snapshot.tables.length
            ? null
            : snapshot.controls.find((control) => control.name === '目标区域');
        const refs = new Map(snapshot.controls.map((control) => [control.ref, control]));
        assert.ok(source, 'source should be observable as a pointer control');
        assert.ok(target, 'target should be observable as a pointer control');
        await executePlaywrightCommand(page, refs, {
            kind: 'drag',
            ref: source.ref,
            toRef: target.ref,
        });
        assert.equal(await page.locator('#target').textContent(), '已移动');
    } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
    }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node --test tests/browser-pointer-drag.test.mjs
```

Expected: unsupported command `drag` or unobservable target.

- [ ] **Step 3: Extend the drag contract**

In `lib/browser/contract.mjs` add:

```js
drag: new Set(['kind', 'ref', 'toRef', 'steps', 'delay']),
```

Add `'drag'` to `REF_COMMANDS`. Add validation:

```js
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
```

- [ ] **Step 4: Implement pointer drag**

In `lib/browser/playwright-actions.mjs` add:

```js
const dragBetween = async (page, from, to, steps = 12, delay = 20) => {
    const sourceBox = await from.boundingBox();
    const targetBox = await to.boundingBox();
    if (!sourceBox || !targetBox)
        throw new BrowserContractError('stale-ref', 'Drag source or target is not visible');
    const start = { x: sourceBox.x + sourceBox.width / 2, y: sourceBox.y + sourceBox.height / 2 };
    const end = { x: targetBox.x + targetBox.width / 2, y: targetBox.y + targetBox.height / 2 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    for (let index = 1; index <= steps; index += 1) {
        await page.mouse.move(
            start.x + ((end.x - start.x) * index) / steps,
            start.y + ((end.y - start.y) * index) / steps,
        );
        if (delay) await page.waitForTimeout(delay);
    }
    await page.mouse.up();
};
```

Dispatch:

```js
else if (command.kind === 'drag') {
    const targetControl = refs.get(command.toRef);
    if (!targetControl) throw new BrowserContractError('missing-ref', command.toRef);
    await dragBetween(
        page,
        locator,
        locatorFor(page, targetControl),
        command.steps || 12,
        command.delay ?? 20
    );
}
```

Also include `drag` in `REF_COMMANDS`, and keep `HALT` behavior unchanged.

- [ ] **Step 5: Mark structural selector dialogs**

First add `[draggable="true"]` to the interactive selector in `playwright-snapshot.mjs`:

```js
const selector =
    'button,a[href],input:not([type="hidden"]),textarea,select,[role="button"],[role="link"],[role="tab"],[role="menuitem"],[role="option"],[role="combobox"],[role="checkbox"],[role="radio"],[role="switch"],[role="alert"],[tabindex],[contenteditable="true"],summary,[draggable="true"]';
```

Then, inside the page evaluation:

```js
const selectorDialog = e.closest(
    '[role="dialog"]:has([role="table"],table):has(button[aria-label*="确定"],button)',
);
const selectorRow = selectorDialog?.querySelector('tbody tr,[role="row"]');
const component = selectorDialog && selectorRow ? 'selector-dialog' : mantineComponent;
```

Return `component` and, when present, `selector: 'table' | 'tree'`:

```js
selector: selectorDialog
    ? selectorDialog.querySelector('[role="tree"],.mantine-Tree-root')
        ? 'tree'
        : 'table'
    : '',
```

- [ ] **Step 6: Write the structural selector test**

Create `tests/browser-custom-selectors.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { chromium } from 'playwright';
import { snapshotPlaywrightPage } from '../lib/browser/playwright-snapshot.mjs';

test('read-only selector dialog exposes table rows and confirmation action', async () => {
    const server = http.createServer((request, response) => {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(`
            <input readonly aria-label="选择人员" value="">
            <button aria-label="选择人员" onclick="document.getElementById('dialog').hidden=false">选择</button>
            <section id="dialog" role="dialog" aria-modal="true" hidden>
                <table><tbody>
                    <tr><td><input type="radio" name="person" aria-label="张三"></td><td>张三</td></tr>
                    <tr><td><input type="radio" name="person" aria-label="李四"></td><td>李四</td></tr>
                </tbody></table>
                <button>确定</button>
            </section>
        `);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
        const { port } = server.address();
        await page.goto(`http://127.0.0.1:${port}/`);
        await page.getByRole('button', { name: '选择人员' }).click();
        const snapshot = await snapshotPlaywrightPage(page);
        assert.equal(snapshot.modal?.name || '选择人员', '选择人员');
        assert.ok(snapshot.controls.some((control) => control.component === 'selector-dialog'));
        assert.ok(
            snapshot.controls.some(
                (control) => control.role === 'radio' && control.name === '张三',
            ),
        );
        assert.ok(snapshot.controls.some((control) => control.name === '确定'));
    } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
    }
});
```

- [ ] **Step 7: Run focused and full tests**

Run:

```bash
node --test tests/browser-pointer-drag.test.mjs tests/browser-custom-selectors.test.mjs tests/browser-playwright-actions.test.mjs
npm test
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add lib/browser/contract.mjs lib/browser/playwright-actions.mjs lib/browser/playwright-snapshot.mjs tests/browser-pointer-drag.test.mjs tests/browser-custom-selectors.test.mjs
git commit -m "feat: add pointer drag and selector dialog coverage"
```

---

### Task 8: Runtime instrumentation for Canvas, ECharts and Mapbox

**Files:**

- Create: `lib/browser/runtime-instrumentation.mjs`
- Modify: `lib/browser/contract.mjs`
- Modify: `lib/browser/playwright-driver.mjs`
- Create: `examples/canvas-components.html`
- Modify: `examples/demo-server.mjs`
- Test: `tests/browser-runtime-instrumentation.test.mjs`

**Interfaces:**

- Produces `installRuntimeInstrumentation()` for `page.addInitScript()`.
- Produces `window.__layaRuntime.snapshot()` returning serializable Canvas/ECharts/Mapbox state.
- Produces `session.runtimeSnapshot()` on the Playwright session.
- Adds capability `runtimeInstrumentation` to browser capabilities.

- [ ] **Step 1: Create the instrumented Canvas fixture**

Create `examples/canvas-components.html`:

```html
<!doctype html>
<html lang="zh-CN">
    <head>
        <meta charset="utf-8" />
        <title>Canvas Adapter Fixture</title>
    </head>
    <body>
        <canvas id="chart" width="320" height="180"></canvas>
        <canvas id="map" width="320" height="180"></canvas>
        <script>
            window.echarts = {
                init: () => ({
                    getOption: () => ({ series: [{ type: 'line' }] }),
                }),
            };
            window.mapboxgl = {
                Map: class {
                    constructor() {
                        this.center = { lng: 116.397, lat: 39.908 };
                        this.zoom = 11;
                    }
                },
            };
        </script>
    </body>
</html>
```

Add `/canvas-components` to `examples/demo-server.mjs` in the same way as the Mantine fixture.

- [ ] **Step 2: Write the failing instrumentation test**

Create `tests/browser-runtime-instrumentation.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createPlaywrightBrowserSession } from '../lib/browser/playwright-driver.mjs';

async function waitForServer(url) {
    for (let attempt = 0; attempt < 30; attempt++) {
        try {
            if ((await fetch(url)).ok) return;
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('fixture did not start');
}

test('runtime instrumentation observes canvas echarts and mapbox instances', async (t) => {
    const port = 19700 + Math.floor(Math.random() * 400);
    const base = `http://127.0.0.1:${port}`;
    const server = spawn(process.execPath, ['examples/demo-server.mjs'], {
        cwd: process.cwd(),
        env: { ...process.env, PORT: String(port) },
        stdio: 'ignore',
    });
    const session = createPlaywrightBrowserSession({ headless: true });
    t.after(async () => {
        await session.close();
        server.kill();
    });
    await waitForServer(`${base}/canvas-components`);
    await session.start();
    await session.navigate(`${base}/canvas-components`);
    const runtime = await session.runtimeSnapshot();
    assert.equal(runtime.canvases.length, 2);
    assert.equal(runtime.echarts.length, 1);
    assert.equal(runtime.maps.length, 1);
    assert.deepEqual(runtime.maps[0].center, { lng: 116.397, lat: 39.908 });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run:

```bash
node --test tests/browser-runtime-instrumentation.test.mjs
```

Expected: `runtimeSnapshot` is missing.

- [ ] **Step 4: Implement the injected runtime instrumentation**

Create `lib/browser/runtime-instrumentation.mjs`:

```js
export function installRuntimeInstrumentation() {
    if (globalThis.__layaRuntime) return;

    let sequence = 0;
    const state = { canvases: [], echarts: [], maps: [] };

    const nextId = (prefix) => `${prefix}-${++sequence}`;

    const registerCanvas = (canvas) => {
        if (canvas.dataset.layaCanvasId) return;
        canvas.dataset.layaCanvasId = nextId('canvas');
        state.canvases.push(canvas);
    };

    const wrapECharts = (echarts) => {
        if (!echarts?.init || echarts.init.__layaWrapped) return echarts;
        const originalInit = echarts.init;
        const wrappedInit = function (...args) {
            const instance = originalInit.apply(this, args);
            if (instance) state.echarts.push(instance);
            return instance;
        };
        wrappedInit.__layaWrapped = true;
        echarts.init = wrappedInit;
        return echarts;
    };

    const wrapMapbox = (mapbox) => {
        if (!mapbox?.Map || mapbox.Map.__layaWrapped) return mapbox;
        const OriginalMap = mapbox.Map;
        class LayaMap extends OriginalMap {
            constructor(...args) {
                super(...args);
                state.maps.push(this);
            }
        }
        LayaMap.__layaWrapped = true;
        Object.defineProperty(mapbox, 'Map', {
            configurable: true,
            writable: true,
            value: LayaMap,
        });
        return mapbox;
    };

    const defineWrappedGlobal = (name, wrap) => {
        let value;
        Object.defineProperty(window, name, {
            configurable: true,
            enumerable: true,
            get: () => value,
            set: (next) => {
                value = wrap(next);
            },
        });
    };

    defineWrappedGlobal('echarts', wrapECharts);
    defineWrappedGlobal('mapboxgl', wrapMapbox);

    const observeDocument = () => {
        for (const canvas of document.querySelectorAll('canvas')) registerCanvas(canvas);
        const observer = new MutationObserver(() => {
            for (const canvas of document.querySelectorAll('canvas')) registerCanvas(canvas);
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
    };
    if (document.documentElement) observeDocument();
    else window.addEventListener('DOMContentLoaded', observeDocument, { once: true });

    window.__layaRuntime = {
        snapshot() {
            return {
                canvases: state.canvases.map((canvas) => ({
                    id: canvas.dataset.layaCanvasId,
                    width: canvas.width,
                    height: canvas.height,
                })),
                echarts: state.echarts.map((instance, index) => ({
                    id: `echarts-${index + 1}`,
                    series: instance.getOption?.()?.series?.length || 0,
                })),
                maps: state.maps.map((map, index) => ({
                    id: `map-${index + 1}`,
                    center: map.getCenter?.()
                        ? {
                              lng: map.getCenter().lng,
                              lat: map.getCenter().lat,
                          }
                        : map.center || null,
                    zoom: map.getZoom?.() ?? map.zoom ?? null,
                })),
            };
        },
    };
}
```

- [ ] **Step 5: Install instrumentation before page scripts**

In `lib/browser/playwright-driver.mjs`, import:

```js
import { installRuntimeInstrumentation } from './runtime-instrumentation.mjs';
```

After creating or attaching the page in `start()`, before navigation:

```js
await page.addInitScript(installRuntimeInstrumentation);
```

Add capability:

```js
runtimeInstrumentation: true,
```

Add method:

```js
async runtimeSnapshot() {
    return requirePage().evaluate(() => globalThis.__layaRuntime?.snapshot() || null);
}
```

- [ ] **Step 6: Add the capability contract**

In `lib/browser/contract.mjs`, add `runtimeInstrumentation` to `CAPABILITIES`.

- [ ] **Step 7: Run focused and full tests**

Run:

```bash
node --test tests/browser-runtime-instrumentation.test.mjs tests/browser-conformance.test.mjs
npm test
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add lib/browser/runtime-instrumentation.mjs lib/browser/contract.mjs lib/browser/playwright-driver.mjs examples/canvas-components.html examples/demo-server.mjs tests/browser-runtime-instrumentation.test.mjs
git commit -m "feat: instrument canvas echarts and mapbox runtimes"
```

---

### Task 9: Runtime actions and visual assertions

**Files:**

- Modify: `package.json`
- Modify: `lib/browser/contract.mjs`
- Modify: `lib/browser/playwright-actions.mjs`
- Modify: `lib/browser/playwright-conditions.mjs`
- Test: `tests/browser-runtime-actions.test.mjs`
- Test: `tests/browser-visual-diff.test.mjs`

**Interfaces:**

- Produces command `{ kind: 'runtime', ref?, action, args? }`.
- Supported actions: `canvas.click`, `canvas.hover`, `map.center`, `map.zoom`, `echarts.option`.
- Produces condition `{ kind: 'visualDiff', ref?, baseline, threshold? }`.
- `pixelmatch` and `pngjs` are pinned dev dependencies.

- [ ] **Step 1: Add dependencies**

Run:

```bash
npm install --save-dev pixelmatch@7.1.0 pngjs@7.0.0
```

Expected: `package.json` and `package-lock.json` contain both dependencies.

- [ ] **Step 2: Write the failing runtime action test**

Create `tests/browser-runtime-actions.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createPlaywrightBrowserSession } from '../lib/browser/playwright-driver.mjs';

async function waitForServer(url) {
    for (let attempt = 0; attempt < 30; attempt++) {
        try {
            if ((await fetch(url)).ok) return;
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('fixture did not start');
}

test('runtime action reads ECharts option through the injected bridge', async (t) => {
    const port = 19800 + Math.floor(Math.random() * 300);
    const base = `http://127.0.0.1:${port}`;
    const server = spawn(process.execPath, ['examples/demo-server.mjs'], {
        cwd: process.cwd(),
        env: { ...process.env, PORT: String(port) },
        stdio: 'ignore',
    });
    const session = createPlaywrightBrowserSession({ headless: true });
    t.after(async () => {
        await session.close();
        server.kill();
    });
    await waitForServer(`${base}/canvas-components`);
    await session.start();
    await session.navigate(`${base}/canvas-components`);
    const chart = await session.runtimeSnapshot();
    const result = await session.act({
        kind: 'runtime',
        action: 'echarts.option',
        args: { id: chart.echarts[0].id },
    });
    assert.equal(result.value.series.length, 1);
});
```

- [ ] **Step 3: Write the failing visual diff test**

Create `tests/browser-visual-diff.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { waitForPlaywrightCondition } from '../lib/browser/playwright-conditions.mjs';
import { PNG } from 'pngjs';

test('visualDiff matches identical baseline and reports changed pixels', async () => {
    const server = await import('node:http').then(({ default: http }) => {
        const instance = http.createServer((request, response) => {
            response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            response.end('<body style="margin:0;background:white"></body>');
        });
        return new Promise((resolve) => instance.listen(0, '127.0.0.1', () => resolve(instance)));
    });
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'laya-visual-'));
    const baseline = path.join(dir, 'baseline.png');
    const png = new PNG({ width: 20, height: 20 });
    png.data.fill(255);
    await fs.writeFile(baseline, PNG.sync.write(png));
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 20, height: 20 } });
    try {
        const { port } = server.address();
        await page.goto(`http://127.0.0.1:${port}/`);
        const result = await waitForPlaywrightCondition(
            page,
            { kind: 'visualDiff', baseline, threshold: 0.1 },
            { timeout: 1000, interval: 10 },
        );
        assert.equal(result.matched, true);
    } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
        await fs.rm(dir, { recursive: true, force: true });
    }
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run:

```bash
node --test tests/browser-runtime-actions.test.mjs tests/browser-visual-diff.test.mjs
```

Expected: unsupported `runtime` command and unsupported `visualDiff` condition.

- [ ] **Step 5: Extend the contract**

In `lib/browser/contract.mjs` add:

```js
runtime: new Set(['kind', 'ref', 'action', 'args']),
visualDiff: new Set(['kind', 'ref', 'baseline', 'threshold']),
```

Do not add `runtime` to `REF_COMMANDS`, because page-level runtime actions may omit `ref`. Validate an optional ref explicitly:

```js
if (command.kind === 'runtime') {
    requireString(command.action, 'command.action');
    if (command.ref !== undefined) requireString(command.ref, 'command.ref');
    if (command.action === 'map.center') {
        if (!command.args || typeof command.args !== 'object')
            fail('invalid-command', 'map.center requires args');
    }
}
if (
    condition.kind === 'visualDiff' &&
    (!condition.baseline || typeof condition.baseline !== 'string')
)
    fail('invalid-condition', 'visualDiff.baseline is required');
```

- [ ] **Step 6: Implement runtime actions**

In `lib/browser/playwright-actions.mjs` add:

```js
else if (command.kind === 'runtime') {
    if (command.ref && (command.action === 'canvas.click' || command.action === 'canvas.hover')) {
        const box = await locator.boundingBox();
        if (!box) throw new BrowserContractError('stale-ref', command.ref);
        const x = box.x + box.width / 2;
        const y = box.y + box.height / 2;
        if (command.action === 'canvas.click') await page.mouse.click(x, y);
        else await page.mouse.move(x, y);
    } else {
        const value = await page.evaluate(
            ({ action, args }) => globalThis.__layaRuntime?.invoke?.(action, args ?? {}),
            { action: command.action, args: command.args ?? {} }
        );
        if (value === undefined)
            throw new BrowserContractError(
                'unsupported-capability',
                `Runtime action is not supported: ${command.action}`
            );
        return { ok: true, ref: command.ref || null, value };
    }
}
```

Add `invoke()` to `window.__layaRuntime` in `runtime-instrumentation.mjs`:

```js
invoke(action, args) {
    if (action === 'map.center') {
        const map = state.maps[0];
        if (!map) return undefined;
        map.setCenter([args.lng, args.lat]);
        return { center: map.getCenter?.() || { lng: args.lng, lat: args.lat } };
    }
    if (action === 'map.zoom') {
        const map = state.maps[0];
        if (!map) return undefined;
        map.setZoom(args.zoom);
        return { zoom: map.getZoom?.() ?? args.zoom };
    }
    if (action === 'echarts.option') {
        const instance = state.echarts[0];
        return instance?.getOption?.() || undefined;
    }
    return undefined;
}
```

- [ ] **Step 7: Implement visual diff condition**

In `lib/browser/playwright-conditions.mjs` import:

```js
import fs from 'node:fs/promises';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
```

Add branch:

```js
if (condition.kind === 'visualDiff') {
    const refControl = condition.ref ? options.refs?.get(condition.ref) : null;
    if (condition.ref && !refControl) throw new BrowserContractError('missing-ref', condition.ref);
    const frame = refControl ? page.frames()[refControl.frameIndex] : null;
    const locator = refControl ? frame.locator(`[data-laya-live-ref="${refControl.ref}"]`) : page;
    const actual = await locator.screenshot({ animations: 'disabled' });
    const expected = await fs.readFile(condition.baseline);
    const actualPng = PNG.sync.read(actual);
    const expectedPng = PNG.sync.read(expected);
    if (actualPng.width !== expectedPng.width || actualPng.height !== expectedPng.height)
        throw new BrowserContractError('wait-timeout', 'Visual dimensions differ');
    const diff = new PNG({ width: actualPng.width, height: actualPng.height });
    const changed = pixelmatch(
        expectedPng.data,
        actualPng.data,
        diff.data,
        actualPng.width,
        actualPng.height,
        { threshold: condition.threshold ?? 0.1 },
    );
    if (changed / (actualPng.width * actualPng.height) <= (condition.threshold ?? 0.1))
        return { matched: true, elapsed_ms: Date.now() - start, changed };
}
```

Call this branch before state conditions. The driver must pass its refs map into `waitForPlaywrightCondition()`:

```js
async waitFor(condition, options = {}) {
    return waitForPlaywrightCondition(requirePage(), condition, { ...options, refs });
}
```

Page-level visual assertions omit `ref`. Element visual assertions resolve only opaque refs; workbook conditions never contain a CSS selector.

- [ ] **Step 8: Run focused and full tests**

Run:

```bash
node --test tests/browser-runtime-actions.test.mjs tests/browser-visual-diff.test.mjs tests/browser-contract-validation.test.mjs
npm test
```

Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json lib/browser/contract.mjs lib/browser/playwright-actions.mjs lib/browser/playwright-conditions.mjs lib/browser/runtime-instrumentation.mjs tests/browser-runtime-actions.test.mjs tests/browser-visual-diff.test.mjs
git commit -m "feat: add runtime actions and visual diff assertions"
```

---

### Task 10: Documentation and end-to-end verification

**Files:**

- Modify: `README.md`
- Modify: `README.en.md`
- Modify: `docs/architecture.md`
- Create: `docs/browser-component-adapters.md`

**Interfaces:**

- Documentation only; no runtime interface changes.

- [ ] **Step 1: Add documentation**

Create `docs/browser-component-adapters.md` with sections:

```markdown
# Browser Component Adapters

## Supported component families

- Native HTML
- Mantine inputs, Select, MultiSelect, DateInput, DateTimePicker
- Mantine Modal, Drawer, Menu, Tooltip
- mantine-datatable and similar native tables
- FileUpload/FileButton
- GridSelector, TableSelector, OrgTreeSelector
- DndList
- Canvas, ECharts, Mapbox
- QR codes rendered to a canvas only through generic screenshots; no QR decoding
- Video/HLS/MPEGTS through generic visible screenshots only; no media-specific support

## Failure policy

Ambiguous controls fail closed. Canvas controls without an available runtime bridge are unsupported.
```

Document the Web-only workflow and the fact that Tauri native windows are out of scope.

Update README limitations to mention that Mantine 8 and Canvas instrumentation are now adapter-supported, while closed Shadow DOM and Tauri-native dialogs remain out of scope.

- [ ] **Step 2: Run the full verification suite**

Run:

```bash
npm test
python tests/test_workflow_excel.py
python tests/worker_test.py
npm run format:check
git diff --check
```

Expected: all commands pass.

- [ ] **Step 3: Run public fixture end-to-end checks**

Run:

```bash
npm run demo
```

In a second terminal:

```bash
node runner.mjs --mode generate --url http://127.0.0.1:8765/components --case-file generated-cases/components-adapters.xlsx
node runner.mjs --mode execute --url http://127.0.0.1:8765/components --case-file generated-cases/components-adapters.xlsx
node runner.mjs --mode generate --url http://127.0.0.1:8765/mantine-components --case-file generated-cases/mantine-adapters.xlsx
node runner.mjs --mode execute --url http://127.0.0.1:8765/mantine-components --case-file generated-cases/mantine-adapters.xlsx
```

Expected:

- Existing `/components` generation/replay still passes.
- `/mantine-components` generation does not crash and records only evidence-backed cases; if no complete business workflow exists, it reports zero generated cases instead of fabricating one.
- Canvas-backed controls without a runtime bridge are reported as unsupported rather than clicked by guess.

- [ ] **Step 4: Commit and push**

```bash
git add README.md README.en.md docs/architecture.md docs/browser-component-adapters.md
git commit -m "docs: document browser component adapters"
git push origin HEAD
```

## Completion Gate

The implementation is complete only when:

- `npm test` and Python tests pass.
- The existing public `/components` generation and replay still pass.
- The new Mantine fixture exposes modal, select, menu, and error semantics without guessing; the focused upload and loading fixtures cover those two capabilities.
- Unnamed icon controls are discoverable through Tooltip label discovery.
- Mantine menus/options remain observable while a modal is open.
- Upload works against a hidden `input[type=file]`.
- Canvas/ECharts/Mapbox runtime snapshots are available.
- No task modifies `E:\szxa-next-harness\szxa-next-desktop`.

## Verification Evidence

Record exact command output for:

- `npm test`
- Python workflow and worker tests
- `npm run format:check`
- Web-mode public fixture generation/replay
- Mantine fixture observation/generation checks
- Canvas runtime snapshot test
