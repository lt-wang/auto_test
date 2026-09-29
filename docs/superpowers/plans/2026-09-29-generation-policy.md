# Generation Policy Implementation Plan

**Goal:** Add a validated generation policy that controls allowed operations, record naming, cleanup mode, record limits, allowed fixture keys, and write authorization.

**Architecture:** `GenerationPolicy` is parsed at the CLI boundary and passed to `Workflow` and `Engine`. Existing `--allow-write` remains a hard gate. Policy denial fails closed before any UI operation.

## Global Constraints

- Existing behavior remains unchanged when no `generation` config is supplied.
- Policy contains no credentials or test data values.
- Unknown policy keys fail validation.
- `recordPrefix` must be a safe non-empty token.
- `maxRecords` must be a positive integer.
- `allowedOperations` may only contain supported workflow operations.
- `cleanup` accepts `delete-case` or `never`.

## Task 1: Policy contract

**Files:** `lib/generation-policy.mjs`, `tests/generation-policy.test.mjs`

- [ ] Test defaults, validation, operation denial, safe record names, record limits, fixture keys, and cleanup.
- [ ] Run the focused test and confirm the module is missing.
- [ ] Implement `createGenerationPolicy(input, options)` and `GenerationPolicy`.
- [ ] Run focused and full tests; commit.

## Task 2: Workflow enforcement

**Files:** `lib/workflow.mjs`, `tests/generation-policy-workflow.test.mjs`

- [ ] Test denied operations generate coverage entries without executing browser actions.
- [ ] Test record prefix and max-record enforcement.
- [ ] Test cleanup mode `never` skips delete generation.
- [ ] Test fixture keys outside `allowedDataKeys` fail closed.
- [ ] Integrate policy into `Workflow.generate()` and `Workflow.resolve()`.
- [ ] Run focused, retry, workflow tests and full suite; commit.

## Task 3: Engine write guard

**Files:** `lib/engine.mjs`, `tests/guards.test.mjs`

- [ ] Test that `GenerationPolicy` can deny writes even when `allowWrite` is true.
- [ ] Keep read-only behavior and action/step mismatch checks.
- [ ] Integrate policy through `Engine.guard()`.
- [ ] Run focused and full tests; commit.

## Task 4: CLI, config, and docs

**Files:** `runner.mjs`, `lib/workflow.mjs`, `lib/project-config.mjs`, `config.example.json`, `README.md`, `README.en.md`, `ROADMAP.md`, `ROADMAP.en.md`, `tests/config.test.mjs`

- [ ] Test `generation` config is accepted and invalid keys fail.
- [ ] Parse policy after CLI/config precedence and pass it to workflow and engine.
- [ ] Document the supported policy fields.
- [ ] Run all Node/Python tests and formatting checks.
- [ ] Commit and push.
