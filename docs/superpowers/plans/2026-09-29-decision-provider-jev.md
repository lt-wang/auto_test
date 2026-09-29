# Decision Provider and Jev Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Add a decision-provider boundary and a TypeSafe Jev adapter while preserving local Laya and existing compatible HTTP API behavior.

**Architecture:** Keep `Laya` as the compatibility facade used by engines. Extract provider behavior behind `warmup`, `choose`, and `close`. Add `JevDecisionProvider` using `@typesafe-ai/sdk@0.6.0` and `/v1/systemone`. The Python worker remains responsible for Excel import and local Laya only.

**Tech Stack:** Node.js >=20, `@typesafe-ai/sdk@0.6.0`, existing local Python worker, Node `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-28-roadmap-program-design.md`

## Global Constraints

- Existing `provider=local` and `provider=api` behavior remains compatible.
- Jev uses `TYPESAFE_API_KEY`, `TYPESAFE_BASE_URL`, and `TYPESAFE_DEFAULT_MODEL`.
- Jev never falls back silently to local Laya.
- Every Jev record logs the concrete `response.model`, not only the alias.
- Probability validation remains fail-closed.
- Secrets are never written to JSON config, reports, or decision logs.

## Task 1: Decision provider contract

**Files:**

- Create: `lib/decision/contract.mjs`
- Create: `tests/decision-contract.test.mjs`

- [x] Write tests for `DecisionProvider` validation helpers and normalized decision records.
- [x] Run `node --test tests/decision-contract.test.mjs` and confirm the module is missing.
- [x] Implement `validateDecision`, `assertProvider`, and provider capability helpers.
- [x] Run the focused test and full suite.
- [x] Commit `feat: add decision provider contract`.

## Task 2: Jev provider

**Files:**

- Create: `lib/decision/jev-provider.mjs`
- Create: `tests/jev-provider.test.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`

- [x] Add failing tests using a mocked SDK fetch for valid choice, malformed probabilities, and typed model metadata.
- [x] Install `@typesafe-ai/sdk@0.6.0`.
- [x] Implement `JevDecisionProvider` with `warmup`, `choose`, and `close`.
- [x] Verify no fallback occurs on HTTP or SDK errors.
- [x] Run focused and full tests.
- [x] Commit `feat: add jev decision provider`.

## Task 3: Integrate Jev into the Laya facade

**Files:**

- Modify: `lib/model.mjs`
- Modify: `tests/api.test.mjs`
- Create: `tests/model-jev.test.mjs`

- [x] Add failing tests that `provider=jev` routes `choose` and `load` to Jev without loading Python Laya.
- [x] Add Jev options to `Laya` and keep Python worker for `read_excel`.
- [x] Validate provider values `local|api|jev`.
- [x] Run focused and full tests.
- [x] Commit `feat: route decision facade to jev`.

## Task 4: CLI and environment configuration

**Files:**

- Modify: `runner.mjs`
- Modify: `lib/workflow.mjs`
- Modify: `lib/project-config.mjs`
- Modify: `.env.example`
- Modify: `tests/config.test.mjs`
- Modify: `README.md`
- Modify: `README.en.md`

- [x] Add failing configuration tests for Jev provider selection and secret handling.
- [x] Allow `--provider jev` and validate required Jev settings.
- [x] Read `TYPESAFE_API_KEY` through hidden input or environment only.
- [x] Document Jev setup and make clear it is not Chat Completions.
- [x] Run focused and full tests.
- [x] Commit `feat: configure jev decision provider`.

## Task 5: End-to-end contract verification and roadmap update

**Files:**

- Modify: `docs/architecture.md`
- Modify: `ROADMAP.md`
- Modify: `ROADMAP.en.md`
- Modify: `docs/superpowers/specs/2026-09-28-roadmap-program-design.md`

- [x] Add a mocked end-to-end decision test proving candidate mapping and model logging.
- [x] Run Node and Python suites plus formatting checks.
- [x] Mark only the Jev portion complete in documentation; keep browser-use and engine migration pending.
- [x] Commit `docs: record jev provider completion`.

## Follow-Up Boundary

Browser engine migration, browser-use sidecar integration, and live Jev credentials are separate workstreams. This plan uses mocked SDK transport for deterministic tests and does not require a real TypeSafe key.
