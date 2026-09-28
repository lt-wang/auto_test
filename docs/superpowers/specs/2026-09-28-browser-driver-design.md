# Browser Driver Contract Design

**Status:** Draft for human review

**Goal:** Replace direct Playwright usage in the engines with a backend-neutral browser contract, then implement that contract with Playwright without changing existing CLI behavior or assertion semantics.

**Architecture:** Engines consume normalized snapshots and issue semantic actions against opaque control refs. The Playwright adapter owns frame traversal, Shadow DOM traversal, locators, CDP-independent page operations, tracing, screenshots, and browser events.

**Spec:** `docs/superpowers/specs/2026-09-28-roadmap-program-design.md`

## 1. Current Problem

Playwright types and objects currently cross module boundaries:

- `runner.mjs` opens Playwright browser, context, and page objects.
- `lib/workflow.mjs` calls `page.locator`, `page.goto`, `page.reload`, `page.keyboard`, `page.waitForTimeout`, and context tracing.
- `lib/engine.mjs` calls locators, role queries, keyboard, mouse, URL, page events, and screenshot APIs.
- `lib/dom.mjs` uses `page.frames()` and frame evaluation.
- `lib/form.mjs` and `lib/readiness.mjs` call `page.evaluate`, locators, visibility queries, and setTimeout.

A browser-use adapter cannot implement Playwright Locator semantics. A thin adapter that exposes `page` would be misleading and would make browser-use fail in hidden ways.

## 2. Goals

1. Remove Playwright imports and Playwright objects from `workflow.mjs` and `engine.mjs`.
2. Keep `dom.mjs`, `form.mjs`, and `readiness.mjs` as backend-neutral consumers of snapshots or move backend-specific logic into adapters.
3. Preserve current generated step schemas and assertion meaning.
4. Support capability discovery so a backend can report unsupported trace or event features explicitly.
5. Run the same browser conformance suite against Playwright and later browser-use.

## 3. Non-Goals

- Reproducing the entire Playwright API.
- Allowing model-generated selectors or JavaScript.
- Replacing the existing readiness algorithm in the first migration.
- Implementing browser-use in this subproject.
- Changing workbook schema version 1.
- Adding multi-role sessions in this subproject.

## 4. Core Types

```ts
type BrowserBackendName = 'playwright' | 'browser-use';

interface BrowserDriverFactory {
    create(config: BrowserRuntimeConfig, signal?: AbortSignal): Promise<BrowserSession>;
}

interface BrowserSession {
    readonly backend: BrowserBackendName;
    readonly capabilities: BrowserCapabilities;

    start(): Promise<void>;
    close(): Promise<void>;

    navigate(url: string, options?: NavigateOptions): Promise<void>;
    reload(): Promise<void>;
    currentUrl(): Promise<string>;

    snapshot(options?: SnapshotOptions): Promise<PageSnapshot>;
    act(command: BrowserCommand): Promise<ActionResult>;
    waitFor(condition: BrowserCondition, options?: WaitOptions): Promise<WaitResult>;

    screenshot(path: string, options?: ScreenshotOptions): Promise<void>;
    startTrace(path: string): Promise<void>;
    stopTrace(): Promise<void>;

    onEvent(listener: (event: BrowserEvent) => void): () => void;
}
```

`BrowserCapabilities` contains booleans for `trace`, `pageErrors`, `consoleErrors`, `networkEvents`, `frames`, `shadowDom`, and `downloads`. A caller must inspect capabilities before relying on optional behavior.

`SnapshotOptions` may include `scope: 'page' | 'modal'` and `includeValues: boolean`. The default returns visible controls and values, with password values replaced by `[REDACTED]`.

## 5. Page Snapshot

```ts
interface PageSnapshot {
    url: string;
    title: string;
    controls: ControlSnapshot[];
    tables: TableSnapshot[];
    modal: ModalSnapshot | null;
    observedAt: string;
}

interface ControlSnapshot {
    ref: string;
    frameRef: string;
    tag: string;
    role: string;
    name: string;
    label: string;
    placeholder: string;
    value: string;
    disabled: boolean;
    readonly: boolean;
    checked: boolean;
    selected: boolean;
    multiple: boolean;
    options: string[];
    rowKey: string;
    context: string;
    inPanel: boolean;
    visible: boolean;
    href: string | null;
}
```

Rules:

- `ref` is opaque, unique within one snapshot, and invalid after a new snapshot for backends that use temporary DOM markers.
- `name` uses the existing precedence: tooltip, aria-label, label, parent label, sibling label, placeholder, title, own text, select hint, then name.
- `context` contains concise row or group context.
- `rowKey` is stable only for the lifetime of the current page state.
- Snapshot traversal includes same-origin and cross-origin frames when the backend supports them.
- Snapshot traversal includes open Shadow DOM when the backend supports it.
- Closed Shadow DOM is unsupported in v1 and must be reported as a capability limitation.

## 6. Commands

```ts
type BrowserCommand =
    | { kind: 'click'; ref: string; button?: 'left' | 'right' | 'middle'; modifiers?: string[] }
    | { kind: 'fill'; ref: string; value: string; clear?: boolean }
    | { kind: 'clear'; ref: string }
    | { kind: 'select'; ref: string; values: string[] }
    | { kind: 'check'; ref: string }
    | { kind: 'uncheck'; ref: string }
    | { kind: 'hover'; ref: string }
    | { kind: 'press'; key: string; ref?: string }
    | { kind: 'scroll'; ref: string; direction: 'up' | 'down'; amount?: number };
```

Action rules:

- The adapter validates that `ref` belongs to the latest permitted snapshot.
- A stale ref returns `BrowserContractError('stale-ref')`.
- A missing ref returns `BrowserContractError('missing-ref')`.
- A disabled target returns `BrowserContractError('disabled-ref')` unless the command explicitly permits it.
- `fill` replaces or appends according to `clear`; default is replace.
- `select` works for native selects and custom select controls already represented in the snapshot.
- `press` with `Enter` may submit a form and must be gated by generation or write policy outside the adapter.
- No command accepts a CSS selector, XPath, or arbitrary JavaScript expression.

## 7. Conditions

```ts
interface ControlQuery {
    name: string;
    role?: string;
    scope?: 'page' | 'modal' | 'owned-row';
    rowKey?: string;
    index?: number;
}

type BrowserCondition =
    | { kind: 'urlContains'; value: string }
    | { kind: 'textVisible'; value: string; scope?: 'page' | 'modal' }
    | { kind: 'textAbsent'; value: string; scope?: 'page' | 'modal' }
    | { kind: 'controlVisible'; query: ControlQuery }
    | {
          kind: 'controlState';
          query: ControlQuery;
          state: 'disabled' | 'enabled' | 'checked' | 'selected' | 'empty' | 'value';
          value?: string;
      }
    | { kind: 'tableHeaders'; values: string[] }
    | { kind: 'rowCount'; value: number; scope?: 'single-table' }
    | { kind: 'formError'; labels: string[] };
```

Conditions resolve controls by semantic query at evaluation time. They do not capture a temporary snapshot ref because an assertion may run after a re-render. `query.index` disambiguates same-name controls only when the source case explicitly identifies an index.

`waitFor` returns `{ matched: true, elapsed_ms }` or throws a categorized wait error. A timeout is not a pass.

## 8. Events and Diagnostics

```ts
interface BrowserEvent {
    time: string;
    kind: 'console' | 'pageerror' | 'crash' | 'requestfailed' | 'requestcancelled' | 'http';
    method?: string;
    url?: string;
    status?: number;
    detail: string;
    step?: {
        number: number;
        action: string;
        target: string;
    } | null;
}
```

Rules:

- URLs are emitted as origin plus path without query or fragment.
- Bearer tokens, API keys, passwords, and secret-like assignments are redacted.
- HTTP events include status and response summary only for JSON bodies.
- A backend without network or page-error support reports that capability as false.
- Browser events are attributed only to the active case and step.

## 9. Playwright Adapter

The Playwright adapter preserves current behavior:

- Chromium launch and optional channel selection
- Viewport `1500x980`
- Locale `zh-CN`
- Downloads accepted
- Default timeout `9000ms`
- Context tracing with screenshots and snapshots
- Existing frame and open Shadow DOM traversal
- Existing modal filtering and control naming
- Existing diagnostic hooks for console, page errors, crashes, requests, and responses
- Existing screenshot and trace output paths

The adapter may internally use Playwright Locators and `page.evaluate`. Those types never leave the adapter.

The first migration keeps the existing DOM extraction code as helper functions inside the Playwright adapter. Component extraction is separated into a later subproject so behavior does not change during this migration.

## 10. Engine Migration

`workflow.mjs` and `engine.mjs` receive a `BrowserSession` instead of a Playwright `page`.

Migration rules:

- Replace direct navigation calls with `navigate`, `reload`, and `currentUrl`.
- Replace locators and direct DOM queries with snapshot queries and semantic commands.
- Replace assertion-specific locator calls with `waitFor`.
- Replace context tracing with `startTrace` and `stopTrace`.
- Replace page event listeners with `onEvent`.
- Replace Playwright screenshot calls with `screenshot`.
- Keep the retry budget and write-protection rules outside the adapter.

The generic Excel runner and generated workflow share the same driver instance per case sequence.

## 11. Configuration

Existing options remain valid:

- `--browser-provider playwright`
- `--browser-channel chromium|chrome`
- `--headless`

Unsupported values continue to fail before browser launch.

New provider selection uses a registry. The runner may not call `openBrowser()` directly after migration. It calls the registry and receives `BrowserSession`.

Secrets remain outside browser config. Browser profile or storage state paths must not contain credentials.

## 12. Error Taxonomy

Browser errors use the existing `Halt` categories where possible.

Adapter-specific contract errors include:

- `browser-startup`
- `unsupported-capability`
- `stale-ref`
- `missing-ref`
- `disabled-ref`
- `navigation-failed`
- `wait-timeout`
- `trace-failed`
- `backend-disconnected`

The engine decides whether an error is a product failure, environment failure, or capability limitation. The adapter does not invent pass or fail results.

## 13. File Responsibilities

Create during implementation planning:

- `lib/browser/contract.mjs`: shared types, validation, capability names, and error classes
- `lib/browser/registry.mjs`: provider selection and capability check
- `lib/browser/playwright-driver.mjs`: Playwright implementation
- `lib/browser/playwright-observer.mjs`: extraction and normalized snapshot creation
- `lib/browser/playwright-actions.mjs`: command execution
- `lib/browser/playwright-events.mjs`: diagnostics and trace integration
- `tests/browser-contract.test.mjs`: backend-neutral conformance suite
- `tests/browser-playwright.test.mjs`: Playwright-specific fixtures

Modify during implementation:

- `runner.mjs`
- `lib/workflow.mjs`
- `lib/engine.mjs`
- `lib/dom.mjs`
- `lib/form.mjs`
- `lib/readiness.mjs`
- `lib/diagnostics.mjs`
- `lib/pending-writes.mjs`
- `lib/project-config.mjs`

Existing `lib/browser-provider.mjs` becomes a compatibility wrapper or is removed after all callers migrate.

## 14. Migration Strategy

1. Add contract types and a fake in-memory driver.
2. Add the Playwright adapter while preserving current functions.
3. Run the existing tests against the adapter directly.
4. Migrate the generic Excel engine first.
5. Migrate the generated workflow.
6. Remove direct Playwright imports from engines.
7. Run generated and replay flows on the public demo.
8. Keep the old path behind a temporary compatibility wrapper while tests compare both.
9. Delete the wrapper only after the conformance suite and public demo pass.

## 15. Testing

The backend-neutral suite must verify:

- Startup, close, and backend capability reporting
- Navigation and current URL
- Snapshot shape and opaque refs
- Visible-only filtering
- Modal filtering
- Frame and open Shadow DOM traversal
- Control naming and row context
- Click, fill, clear, select, check, uncheck, hover, and press
- Stale, missing, and disabled refs
- Visibility, text, state, table-header, row-count, URL, and form-error conditions
- Console, page error, request failure, HTTP error, and crash events
- Screenshot and trace output
- Redaction of passwords, URLs, tokens, and API keys
- Unsupported capability behavior

Playwright-specific tests must compare old and new snapshots on the public demo before the old path is removed.

## 16. Acceptance Criteria

Subproject A is complete when:

- No engine imports or receives a Playwright `page`, `context`, or `browser`.
- The generic Excel runner and generated workflow use `BrowserSession`.
- Playwright is selected through the browser registry.
- Existing CLI behavior and workbook schema remain unchanged.
- Existing Node and Python tests pass.
- The public demo generates and replays with equivalent results.
- The browser contract suite runs against the fake driver and Playwright adapter.
- Trace, screenshot, console, page-error, request-failure, and HTTP-error behavior is preserved.
- Unsupported hidden capabilities fail explicitly instead of silently degrading.
