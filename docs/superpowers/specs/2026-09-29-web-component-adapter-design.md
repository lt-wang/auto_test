# Web Component Adapter Design

**Status:** Approved direction for implementation planning
**Date:** 2026-09-29
**Target application:** `E:\szxa-next-harness\szxa-next-desktop`
**Target mode:** Browser/Web only; the frontend repository will not be modified.

## Goal

Extend LayaPilot so it can observe, operate, and assert against a Mantine 8 web SPA without requiring application-side test attributes, markup changes, selectors, or test hooks.

The target application may be a Tauri hybrid desktop application, but this design covers only the Vite/Web build running at `http://127.0.0.1:3001`. Tauri native windows, WebView2, OS file dialogs, SQLite repositories, offline sync, and Rust code are out of scope.

## Non-goals

- No source changes in `szxa-next-desktop`.
- No dependency on Chinese labels or translation text.
- No raw CSS selectors or arbitrary scripts in workbook replay steps.
- No claim that arbitrary Canvas pixels can be replayed as stable semantic controls.
- No Tauri-native automation in this plan.

## Constraints

- Existing `generate`, `execute`, `--excel`, workbook schema, evidence, retry, and policy behavior must remain compatible.
- Every new snapshot field must be optional and backward-compatible.
- Browser commands remain opaque-ref based. Raw `selector`, `xpath`, and `script` remain forbidden in commands.
- New fallback behavior must fail closed when it cannot identify an unambiguous target.
- Label discovery may hover controls but must never click unknown controls.
- Runtime instrumentation may inject browser-side observers via `page.addInitScript()` and `page.evaluate()` inside the browser adapter; it must not modify application source files.
- File upload file paths are supplied explicitly by the caller; no filesystem scanning is allowed.
- Visual assertions must write evidence to the existing run output directory and report a deterministic diff score.
- The existing Playwright and browser-use sessions must continue to share the same public contract.

## Architecture

The implementation adds five layers beneath `BrowserSession`:

1. **Direct Component Detection**
   Enriches normalized controls with component-specific metadata such as `component`, `adapter`, `testId`, `expanded`, or `layer`.

2. **Identity Resolver**
   Produces stable row and control identities from existing DOM attributes, row text, table position, and normalized structural fingerprints.

3. **Label Resolver**
   Retains unnamed interactive elements in snapshots, discovers Tooltip text by safe hover, and caches discovered labels in `data-laya-tooltip-label` during the browser session.

4. **Overlay and Runtime Instrumentation**
   Distinguishes real modals from Mantine popovers, tracks the active overlay stack, and exposes Canvas/ECharts/Mapbox state through an injected browser bridge.

5. **Interaction Driver**
   Maps normalized actions to DOM actions, Playwright file inputs, pointer drags, library-specific actions, and visual assertions.

The generator and workflow continue to consume normalized snapshots. They do not learn Mantine selectors or application-specific page structure.

## Component Coverage Model

| Component family                                        | Primary observation                                            | Primary action                               |
| ------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------- |
| Mantine TextInput, PasswordInput, NumberInput, Textarea | Label, role, `aria-describedby`, Mantine input classes         | `fill`, `clear`, `press`                     |
| Mantine Select, MultiSelect, Autocomplete               | `role=combobox`, `role=listbox`, `role=option`, active overlay | open, option click, repeated selection       |
| Mantine DateInput, DateTimePicker                       | Input value, popover dialog, calendar cells                    | text fill first, calendar/date-cell fallback |
| Mantine Modal, Drawer                                   | `aria-modal=true`, `dialog[open]`, `data-modal-content`        | scoped controls, close, focus                |
| Mantine Menu, Tooltip                                   | `role=menu`, `role=menuitem`, `role=tooltip`, active overlay   | hover, menu-item click                       |
| Mantine DataTable                                       | Native table roles, pagination controls, row text              | sort, page, row-scoped action                |
| Custom selectors                                        | Structural dialog + table/tree + confirm pattern               | open, search, select, confirm                |
| FileUpload                                              | Hidden `input[type=file]` or file chooser                      | `upload`                                     |
| Dnd list                                                | Draggable handles, row order, pointer events                   | `drag`                                       |
| Canvas, ECharts, Mapbox                                 | Runtime bridge and screenshots                                 | pointer actions and visual assertions        |
| QR rendered to canvas                                   | Generic screenshot only; no QR decoding                        | visual assertion                             |
| Video/HLS/MPEGTS                                        | Generic visible screenshot only                                | no dedicated media controls or events        |

## Failure Policy

When multiple candidate interpretations exist, the adapter must return an explicit ambiguity error instead of clicking the first match. When a component has no semantic DOM and no runtime bridge, the generator must mark it unsupported rather than inventing a semantic replay step.

## Acceptance Criteria

- The target web application can be tested without modifying its repository.
- Mantine controls, menus, selects, dialogs, data tables, and validation errors are observable through normalized snapshots.
- Unnamed icon buttons can be associated with Tooltip labels using safe hover discovery.
- A web file upload can be executed through the provided `upload` command.
- DataGrid rows without `data-row-key` receive stable synthetic row identities.
- Canvas-backed components have a documented instrumentation and visual assertion path.
- Existing Node and Python test suites remain green.
