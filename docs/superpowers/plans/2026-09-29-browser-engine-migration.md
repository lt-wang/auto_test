# Browser Engine Migration Implementation Plan

**Goal:** Move production generation and replay from raw Playwright page objects to `BrowserSession` while preserving CLI behavior, assertions, retries, evidence, and workbook compatibility.

**Architecture:** Extend `BrowserSession` with the missing high-level capabilities used by the engines: readiness, page state, pending-write tracking, hover/scroll support, and normalized events. Migrate helper modules first, then the generic engine, then workflow and runner. A temporary compatibility bridge may exist only inside `lib/browser/` and must be removed before completion.

**Spec:** `docs/superpowers/specs/2026-09-28-browser-driver-design.md`

## Global Constraints

- Existing `generate`, `execute`, and `--excel` CLI behavior remains compatible.
- Generated Excel schema version remains `1`.
- No engine may import Playwright or receive a raw Playwright page/context/browser at completion.
- Write protection and GenerationPolicy gates remain in force.
- Assertions still inspect page state; model output never determines pass/fail.
- Temporary compatibility code must be isolated and deleted by the final task.

## Task 1: Session readiness and page-state ports

**Files:** `lib/browser/contract.mjs`, `lib/browser/playwright-driver.mjs`, `lib/readiness.mjs`, `tests/browser-readiness-port.test.mjs`

- [ ] Add failing tests for `BrowserSession.waitForReady()` and normalized readiness state.
- [ ] Implement `waitForReady` in the Playwright driver by moving the current readiness algorithm behind the driver.
- [ ] Keep `waitForReady(page)` as a compatibility wrapper until engines migrate.
- [ ] Run focused, readiness, and full tests; commit.

## Task 2: Pending-write tracking over BrowserEvent

**Files:** `lib/browser/playwright-events.mjs`, `lib/pending-writes.mjs`, `tests/browser-pending-writes.test.mjs`, `tests/retries.test.mjs`

- [ ] Add failing tests for request start, success, failure, cancellation, and wait timeout through normalized events.
- [ ] Extend browser events to include request lifecycle IDs.
- [ ] Implement a session-based pending-write tracker.
- [ ] Keep the page-based constructor only as a temporary compatibility wrapper.
- [ ] Run focused, retry, and full tests; commit.

## Task 3: DOM and form logic consume snapshots

**Files:** `lib/dom.mjs`, `lib/form.mjs`, `lib/browser/playwright-snapshot.mjs`, `tests/dom-snapshot.test.mjs`, `tests/form-snapshot.test.mjs`

- [ ] Add failing tests for row lookup, modal scope, form fields, required state, errors, and options using snapshots only.
- [ ] Move all backend-specific evaluation into the Playwright snapshot adapter.
- [ ] Convert `dom.mjs` and `form.mjs` to pure snapshot/query helpers.
- [ ] Preserve existing exported behavior through snapshot-capable signatures.
- [ ] Run focused and full tests; commit.

## Task 4: Migrate generic Excel Engine

**Files:** `lib/engine.mjs`, `runner.mjs`, `tests/guards.test.mjs`, `tests/planner.test.mjs`, `tests/readiness.test.mjs`

- [ ] Add failing tests with a fake `BrowserSession`.
- [ ] Replace direct page navigation, snapshots, actions, waits, screenshots, and events.
- [ ] Retain retries, write guards, diagnostics, and report fields.
- [ ] Run focused, planner, readiness, and full tests; commit.

## Task 5: Migrate generated Workflow

**Files:** `lib/workflow.mjs`, `tests/retries.test.mjs`, `tests/selected-pr1.test.mjs`, `tests/workflow.test.mjs`

- [ ] Add failing tests using a fake `BrowserSession`.
- [ ] Replace locator/evaluate/page-event usage with snapshot queries, semantic commands, condition waits, and session events.
- [ ] Preserve generated step schemas, replay validation, evidence, and dependency blocking.
- [ ] Run focused and full tests; commit.

## Task 6: Migrate runner and remove raw page path

**Files:** `runner.mjs`, `lib/browser-provider.mjs`, `lib/workflow.mjs`, `docs/architecture.md`, tests as needed

- [ ] Open both generic and workflow modes through `openBrowserSession()`.
- [ ] Remove compatibility wrappers and raw page returns.
- [ ] Run public-demo generate and replay using Playwright through `BrowserSession`.
- [ ] Run Node, Python, and formatting checks.
- [ ] Commit and push.

## Completion Gate

The migration is complete only when `rg` finds no production use of `page.locator`, `page.evaluate`, `page.frames`, `context.tracing`, or raw Playwright objects outside `lib/browser/playwright-*`, and the public demo passes both generation and replay.
