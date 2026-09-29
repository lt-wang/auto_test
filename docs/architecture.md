# Architecture / 架构

The public runner has three paths: `generate` and `execute` in `lib/workflow.mjs`, and natural-language workbook execution in `lib/engine.mjs`. `worker.py` imports spreadsheets through `openpyxl` and performs local Laya decisions when requested. API decisions use `lib/model.mjs`; the API key remains in the environment or a hidden prompt. Browser initialization is centralized in `lib/browser-provider.mjs`.

Production generation, replay, and generic Excel execution now use `BrowserSession`. Raw Playwright page objects are isolated under `lib/browser/playwright-*`. A future browser backend must implement the same normalized snapshot, action, condition, trace, and diagnostic contract. The runner rejects browser-use until that adapter and integration tests exist.

The decision boundary is `choose(state, criteria, meta)`, returning a choice among the supplied candidates and calibrated probabilities or an explicit failure. Local Laya, the compatible HTTP API, and TypeSafe Jev implement this behavior. Jev uses the official SDK and `/v1/systemone`; malformed probabilities and provider errors fail closed.

The workbook contract is in `lib/workflow_excel.py`. The visible 17 columns are human readable; `__laya_steps__` contains a structured, validated replay plan. The digest binds the visible case ID, title, preconditions, steps and expected result to the plan. The generated Excel is a test artifact, not arbitrary executable code.

Current UI coverage is strongest for semantic HTML plus Ant Design, Element and TNTD conventions. A new component family should extend observation and form rules, then add a browser fixture test. Keep company-specific selectors, URLs, credentials and data preparation in a separate private adapter repository rather than this public core.

The browser contract foundation lives in `lib/browser/`. It provides normalized snapshots, opaque refs, semantic commands and conditions, capability reporting, and normalized events. `openBrowserSession()` is the production browser entry point. The public demo has passed generation and replay through the contract.

Jev decisions use `lib/decision/jev-provider.mjs` and the official `@typesafe-ai/sdk`. The provider boundary validates choice/probability responses before the engine sees them.

browser-use is integrated through `browser_use_worker.py` and `lib/browser/browser-use-driver.mjs`. browser-use owns the BrowserSession and exposes CDP; the Node adapter connects that browser to the shared BrowserSession contract. The browser-use Agent is not used for planning or assertions.
