# Browser Component Adapters

LayaPilot drives browser pages through the normalized `BrowserSession` contract. Browser
component adapters enrich snapshots with optional metadata such as `component`, `adapter`,
`testId`, `expanded`, `layer`, and `iconFingerprint`; they do not require raw selectors,
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
- Mantine inputs, Select, MultiSelect, DateInput, DateTimePicker
- Mantine Modal, Drawer, Menu, Tooltip
- mantine-datatable and similar native tables
- FileUpload/FileButton
- GridSelector, TableSelector, OrgTreeSelector
- DndList
- Canvas, ECharts, Mapbox, QRCode
- Video/HLS/MPEGTS

Coverage assumes the page exposes the component's normal DOM conventions, ARIA semantics, or
a supported runtime bridge. For Mantine 8, the adapter recognizes Mantine input classes,
portaled overlays, menus, tooltips, validation errors, and data-table structures. Canvas
instrumentation observes Canvas, ECharts, and Mapbox instances and provides runtime actions
and screenshot assertions where a bridge is available.

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
- Unlabeled custom widgets without enough semantic structure or a runtime bridge require a
  dedicated adapter.
