# Browser Component Adapters

LayaPilot drives browser pages through the normalized `BrowserSession` contract. Component
metadata is detected directly in `lib/browser/playwright-snapshot.mjs`; there is no adapter
registry or runtime registration step. Snapshots are enriched with optional metadata such as
`component`, `adapter`,
`testId`, `expanded`, and `layer`; they do not require raw selectors,
XPath, scripts, or changes to the target frontend repository.

## Web-only workflow

The supported workflow is the Web build of an application: run the page at an HTTP(S) URL,
then use LayaPilot's `generate` and `execute` modes as usual.

```bash
./run.sh --mode generate --url http://127.0.0.1:3001
./run.sh --mode execute --case-file generated-cases/example.xlsx \
  --url http://127.0.0.1:3001
```

Runtime instrumentation is injected by the browser adapter before application scripts run.
It does not modify application source files. Workbook replay commands remain opaque-ref
based; raw `selector`, `xpath`, and `script` fields are rejected. New snapshot fields are
optional and backward-compatible with existing workbooks and consumers.

Tauri native windows, WebView2, OS file dialogs, SQLite repositories, offline sync, and Rust
code are out of scope. Only the Web build is automated.

## Supported component families

- Native HTML
- Mantine inputs, Select, MultiSelect, DateInput, DateTimePicker, Button, ActionIcon
- Mantine Modal, Drawer, Menu, Tooltip
- mantine-datatable and similar native tables
- FileUpload/FileButton
- GridSelector, TableSelector, OrgTreeSelector
- DndList
- Canvas, ECharts, Mapbox
- QR codes rendered to a canvas only through generic canvas screenshot assertions; LayaPilot
  does not decode QR payloads or provide a QR-specific action model.
- Video/HLS/MPEGTS only as generic visible screenshots; there is no media-specific adapter or
  event/control support.

Coverage assumes the page exposes the component's normal DOM conventions, ARIA semantics, or
a supported runtime bridge. For Mantine 8, direct detection recognizes Mantine input and
button classes, portaled overlays, menus, tooltips, validation errors, and data-table
structures. Canvas instrumentation observes Canvas, ECharts, and Mapbox instances and provides
runtime actions and screenshot assertions where a bridge is available.

To verify a real Mantine page, start the target Vite server, set `MANTINE_E2E_URL` to the
harness URL, and run `npm run smoke:mantine`.

## Failure policy

Ambiguous controls fail closed. Canvas controls without an available runtime bridge are
unsupported.

More specifically:

- Ambiguous or stale targets return an explicit error such as `ambiguous-query`; adapters do
  not click the first match.
- Unsupported runtime actions and Canvas components without a usable bridge return
  `unsupported-capability` instead of producing a guessed replay step.
- Label discovery may hover an unknown control to read a Tooltip, but must never click it.
- Closed Shadow DOM and Tauri-native dialogs remain out of scope.
- Unlabeled custom widgets without enough semantic structure or a runtime bridge fail closed;
  extend the direct snapshot detection with a browser fixture when a new component family is
  required.
