# LayaPilot Roadmap Program Design

**Status:** Draft for human review

**Goal:** Turn the public LayaPilot core into a set of independently testable subsystems that can add browser backends, decision backends, broader component coverage, safer generation policies, multi-role execution, and reviewable workbook rebinding without weakening the current model-vs-assertion boundary.

**Architecture:** Keep browser control behind a high-level semantic browser contract. Keep decision making behind a provider contract. Keep generation safety in a separate policy object. Treat each Roadmap entry as its own spec and implementation plan, with shared contracts frozen before adapter work begins.

**Research date:** 2026-09-28

## 1. Scope

This document is the program-level design for the entire Roadmap. It defines subsystem boundaries, sequencing, cross-cutting contracts, compatibility rules, and completion gates.

It does not contain the detailed task-by-task implementation steps. Each subsystem gets its own implementation plan, starting with `2026-09-28-browser-driver-design.md`.

## 2. Goals

1. Move all browser usage in `runner.mjs`, `lib/workflow.mjs`, `lib/engine.mjs`, `lib/dom.mjs`, `lib/form.mjs`, and `lib/readiness.mjs` behind a backend-neutral contract.
2. Preserve current Playwright behavior and CLI compatibility during migration.
3. Add a decision-provider contract that supports local Laya, current HTTP API, and TypeSafe Jev without silent provider fallback.
4. Add a deterministic browser-use adapter based on its CDP actor API, not its autonomous Agent loop.
5. Expand frontend observation and action coverage through component-oriented adapters and browser fixtures.
6. Make generation writes opt-in through explicit scope, data, and cleanup policy.
7. Support multiple test accounts and approval flows with actor-aware evidence.
8. Allow reviewed workbook rebinding without weakening the hidden-plan digest.

## 3. Non-Goals

- Replacing the test oracle with a model. Assertions remain deterministic and inspect browser state.
- Executing arbitrary model-generated selectors, scripts, routes, or test data.
- Making the public repository contain enterprise selectors, internal URLs, credentials, or data adapters.
- Treating browser-use Agent’s reported success as a test pass.
- Running a browser-use cloud Agent as the v1 browser backend.
- Supporting Jev images, audio, or video. Jev v1 accepts text and structured text state only.
- Providing a graphical test-case editor in this program.

## 4. External Research Findings

### 4.1 TypeSafe Jev

Sources:

- https://docs.typesafe.ai/api
- https://docs.typesafe.ai/sdk/javascript
- https://docs.typesafe.ai/models
- https://docs.typesafe.ai/concepts/how-to-build-with-system-one

Confirmed public contract:

- Endpoint: `POST https://api.typesafe.ai/v1/systemone`
- Authentication: `Authorization: Bearer <API_KEY>`
- API key environment variable: `TYPESAFE_API_KEY`
- Base URL environment variable: `TYPESAFE_BASE_URL`
- Default model alias: `jev-latest`
- Current official stable model on 2026-09-28: `jev-1.13.0`
- Request fields: `state`, `model`, `questions`
- Choice question: `{ "type": "choice", "instructions": string | object | array, "criteria": map<string, string | object | array | null> }`
- Choice answer: `type`, `choice`, `confidence`, `probabilities`
- Documented errors: `401`, `422`, `429`, `529`
- SDK retry policy handles `429` and `529` backoff and honors `retry-after`
- JavaScript SDK package: `@typesafe-ai/sdk@0.6.0`
- JavaScript SDK requires Node.js 20 or newer
- SDK constructor options include `apiKey`, `baseURL`, `defaultModel`, `fetch`, `retry`, and `timeout`
- `systemOne()` returns typed `answers`, `model`, and `usage`
- The model response reports the concrete versioned model ID, so LayaPilot must log that ID rather than only the alias

Jev is not an OpenAI Chat Completions service. It must not reuse the current Chat Completions request encoder.

### 4.2 browser-use

Sources:

- https://docs.browser-use.com/open-source/introduction
- https://docs.browser-use.com/open-source/legacy/actor/basics
- https://github.com/browser-use/browser-use
- https://github.com/browser-use/browser-use/tree/main/browser_use/actor

Confirmed public contract:

- Open-source package: `browser-use`
- Current PyPI version on 2026-09-28: `0.13.10`
- Python requirement: `>=3.11,<4.0`
- Cloud API, CLI, and open-source Python library are separate products and have different APIs
- The open-source library exposes `BrowserSession` (alias `Browser`), `Page`, `Element`, and `Mouse`
- The actor API is built on CDP, not Playwright
- Actor is a Playwright-like subset, not a drop-in Playwright replacement
- `Page` supports navigation, reload, CDP/JavaScript evaluation, screenshot, CSS element lookup, keyboard actions, and DOM service access
- `Element` supports click, fill, hover, check, select, scroll, screenshot, evaluation, and attribute inspection
- The current official documentation places Actor under a `legacy/actor` path
- The official guidance says `is_successful` from the Agent loop is agent-reported and must be independently verified

The Roadmap adapter therefore uses the deterministic actor API. It does not use browser-use Agent planning and does not treat its success flag as an assertion.

## 5. Program Decomposition

| Subproject                     | Deliverable                                                   | Depends on                      |
| ------------------------------ | ------------------------------------------------------------- | ------------------------------- |
| A. Browser driver contract     | Backend-neutral browser session plus Playwright adapter       | None                            |
| B. Decision provider contract  | Provider facade plus local and HTTP adapters, followed by Jev | None; shares config work with A |
| C. browser-use adapter         | Deterministic browser-use sidecar implementing contract A     | A and B                         |
| D. Component adapter expansion | More controls, forms, lists, dialogs, and fixtures            | A                               |
| E. Generation policy           | Explicit operation, data, write, and cleanup policy           | A and B                         |
| F. Multi-role and approval     | Multiple sessions, role switching, actor evidence             | A and E                         |
| G. Workbook rebinding          | Reviewed visible-to-structured step migration                 | Existing workbook contract      |

Subprojects D through G receive their own design specs before implementation. They must not be bundled into A.

## 6. Target Runtime Architecture

```text
runner.mjs / workflow.mjs / engine.mjs
             |
             +--> DecisionProvider facade
             |      +--> LocalLayaProvider
             |      +--> OpenAiCompatibleProvider
             |      +--> JevProvider
             |
             +--> BrowserDriver factory
                    +--> PlaywrightDriver
                    +--> BrowserUseDriver -> Python sidecar -> browser-use actor
             |
             +--> GenerationPolicy
             +--> BrowserDiagnostics / trace / evidence
             +--> Workbook contract
```

The engines own test semantics. Workers own backend mechanics. No engine imports Playwright types after subproject A is complete.

## 7. Browser Driver Contract

The detailed design is in `2026-09-28-browser-driver-design.md`.

Summary:

- `BrowserDriverFactory.create(config)` returns `BrowserSession`.
- `BrowserSession` exposes navigation, snapshot, action, condition wait, screenshot, trace, and event APIs.
- Snapshots contain normalized controls with stable opaque refs.
- Actions address controls by opaque refs, never by Playwright locator objects.
- Backend-specific selectors, CDP commands, frame traversal, and shadow-DOM traversal stay inside the adapter.
- Diagnostics expose console, page error, crash, request failure, and HTTP errors in one event shape.
- Trace support is required for the Playwright adapter and best-effort for browser-use, with an explicit capability record when unavailable.

## 8. Decision Provider Contract

Summary interface:

```ts
interface DecisionProvider {
    readonly name: 'local' | 'api' | 'jev';
    warmup(signal?: AbortSignal): Promise<ProviderStatus>;
    choose(
        state: DecisionState,
        criteria: Record<string, string>,
        meta?: DecisionMeta,
    ): Promise<DecisionRecord>;
    close(): Promise<void>;
}
```

`DecisionRecord` contains `choice`, `probabilities`, `confidence`, `provider`, `model`, `inference_ms`, `cache_hit`, and optional token usage.

Rules:

- `criteria` contains all valid choices plus explicit stop or insufficient-evidence choices.
- The provider may not invent a choice outside `criteria`.
- Every candidate must have a finite probability in `[0, 1]`.
- Probabilities must sum to 1 within a 0.02 tolerance.
- The chosen candidate must have the highest probability.
- Local and API behavior keeps its current thresholds and errors.
- Jev failures never fall back silently to local Laya.
- Every Jev record logs the concrete response model ID.
- API keys are read from environment or hidden prompt and never written to JSON config or reports.

## 9. Browser-Use Adapter Design

Browser-use is Python and CDP-based. Calling it directly from Node would create a second control stack and expose Python objects to JavaScript.

The adapter therefore uses a Python sidecar:

```text
Node BrowserUseDriver
  JSONL command/event pipe
Python browser_use_worker.py
  BrowserSession
  Page
  Element
```

Sidecar responsibilities:

- Start, connect, or stop a browser-use `BrowserSession`
- Create and track pages
- Execute navigate, reload, action, wait, screenshot, and trace commands
- Return normalized snapshots using the same schema as Playwright
- Forward browser diagnostics as events

Node responsibilities:

- Validate commands and results
- Keep backend-neutral control refs stable per observation
- Apply LayaPilot timeouts and retry policy
- Store traces and evidence through the normal run directory

Prohibited behavior:

- Using browser-use `Agent` for generation or replay
- Using `must_get_element_by_prompt` for normal control selection
- Treating browser-use `is_successful` as an assertion
- Letting browser-use choose test data or write scope

Because the documented Actor API is under a legacy path, the adapter must pin `browser-use==0.13.10`, run contract tests, and contain compatibility logic behind the sidecar boundary.

## 10. Generation Policy Design

`GenerationPolicy` owns:

- Allowed operations
- Whether writes are permitted
- Test-data source
- Record prefix and fixture namespace
- Cleanup mode
- Maximum generated records
- Approval-operation behavior
- Cross-account behavior

The generator and generic Excel engine must both ask the policy before executing a write. The model cannot authorize a write. A model decision that conflicts with policy fails closed.

## 11. Multi-Role and Approval Design

Each account gets an independent browser session and storage state. Step records gain an actor identity. Evidence and reports include the actor for each step.

Approval operations remain explicit. A policy may allow, deny, or require manual intervention. Automatic approval is not part of the first implementation.

## 12. Workbook Rebinding Design

The existing visible-field digest remains mandatory for normal replay.

A separate rebind workflow may:

1. Read the visible case and hidden structured plan.
2. Report differences without executing them.
3. Accept a reviewed mapping from modified visible steps to structured actions.
4. Validate every mapped action against the existing step whitelist.
5. Recompute the digest into a new output workbook.
6. Preserve the original workbook unchanged.

The rebind workflow must never execute an unreviewed hidden plan after a digest mismatch.

## 13. Cross-Cutting Requirements

- Node.js version remains `>=20`.
- Existing CLI flags and defaults remain backward compatible.
- Generated workbook schema version remains `1` until a separately reviewed migration exists.
- Browser and decision adapters must pass contract tests before being selectable.
- No secret is written to config, reports, traces, or decision logs.
- Failure categories remain explicit and never convert into pass results.
- Public code contains no enterprise selectors, domains, credentials, or data preparation.
- New dependencies are pinned at their reviewed versions.

## 14. Testing Strategy

### Contract tests

- The same browser contract suite runs against Playwright and browser-use.
- The same decision contract suite runs against local, HTTP API, and Jev adapters using recorded fixtures.
- Jev fixtures cover valid choice, malformed probabilities, `401`, `422`, `429`, `529`, timeout, and cancellation.
- Browser-use fixtures cover navigation, action, snapshot, diagnostics, and unsupported capability reporting.

### Integration tests

- Public demo generation and replay under each browser backend.
- Public demo generation and replay under each decision provider.
- Failure attribution remains equivalent across backends.
- Existing workbook execute remains compatible.

### Regression tests

- Existing Node tests remain green.
- Python workbook and worker tests remain green.
- Windows, Linux, and macOS path and encoding tests remain green.
- No adapter is selectable until its conformance suite passes.

## 15. Delivery Sequence

1. Subproject A: browser driver contract and Playwright adapter.
2. Subproject B: decision provider contract, local/API refactor, then Jev adapter.
3. Subproject C: browser-use sidecar adapter.
4. Subproject D and E: component expansion and generation policy.
5. Subproject F: multi-role and approval.
6. Subproject G: workbook rebinding.

B may proceed in parallel with A after the shared run/config interfaces are frozen. C depends on A and B. D through G remain separate plans.

## 16. Risks and Mitigations

| Risk                                                 | Mitigation                                                                                 |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Browser abstraction is too low-level for browser-use | Use semantic snapshots and opaque refs, not Playwright Locator compatibility               |
| Actor API moves out of legacy                        | Pin browser-use version and run conformance tests behind the sidecar                       |
| Jev SDK types evolve                                 | Pin `@typesafe-ai/sdk@0.6.0` and keep request mapping behind `JevProvider`                 |
| Jev alias changes model behavior                     | Default to `jev-latest` but log the returned concrete model ID; allow pinned models        |
| Browser-use has different timing semantics           | Keep readiness and assertion waits in the contract and test both backends on the same demo |
| Generation damages test data                         | Require explicit policy, unique records, and cleanup rules                                 |
| Rebinding weakens digest safety                      | Separate reviewed rebind flow and never execute unreviewed hidden steps                    |

## 17. Program Completion Criteria

The Roadmap is complete only when:

- Every selectable browser backend passes the browser contract suite.
- Every selectable decision provider passes the decision contract suite.
- Generation and replay pass on the public demo under supported backend combinations.
- Component coverage claims have public fixtures and regression tests.
- Write scope, data, cleanup, roles, and approvals are explicit.
- Workbook edits can be reviewed and rebound without silent execution of stale hidden steps.
- The current Playwright-only path remains compatible or has an approved migration.

## 18. Decision Provider Status

As of 2026-09-29, the Jev decision provider is implemented with `@typesafe-ai/sdk@0.6.0` and the `/v1/systemone` endpoint. The provider validates choice/probability responses, records the concrete response model ID, and fails closed on SDK or HTTP errors. Mocked contract tests cover success, malformed probabilities, and authentication failure. A live API-key integration run remains required before production use.

The browser driver foundation is implemented, but production engines still use the legacy Playwright path. browser-use and the remaining P1/P2 Roadmap items remain pending.

## 19. browser-use Status

As of 2026-09-29, browser-use 0.13.10 is integrated through a Python sidecar that owns a BrowserSession and exposes CDP. The Node driver connects that browser to the shared contract. Public demo generation produced 8 verified cases and replay passed 8/8. The browser-use Agent is not used for planning or assertions.
