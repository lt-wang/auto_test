# Roadmap

[中文](ROADMAP.md)

These items are **planned**, not shipped. No release dates are promised. The README's installation and commands describe current functionality only.

| Priority | Planned work                                   | Completion criteria                                                                                                                    |
| -------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| P0       | Browser driver contract                        | Move page operations, event capture, screenshots and tracing behind an interface used by both generation and replay                    |
| P0       | browser-use adapter                            | Selectable through config; generate, replay and diagnose failures on the public demo with the same assertion semantics as Playwright   |
| P0       | Decision provider contract and Jev API adapter | Selectable through config; validate candidate mapping, probabilities, timeouts, authentication and errors without requiring local Laya |
| P1       | More frontend components                       | Cover native forms, custom selects, virtual lists and dialog patterns with a public fixture and browser regression test for each       |
| P1       | Configurable generation policy                 | Let users define allowed CRUD scope, test-data rules and cleanup; do not infer permission for business writes                          |
| P1       | Multiple roles and approval flows              | Support explicit test-account configuration and role switching, recording the actor and assertion evidence for each step               |
| P2       | Case editing and migration                     | Provide a reviewable way to rebind edited Excel steps instead of silently replaying an old hidden plan                                 |

## Implementation Status

Status date: 2026-09-29.

| Planned work                                   | Status                                                                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Browser driver contract                        | Foundation and Playwright adapter implemented; production engine migration incomplete                         |
| browser-use adapter                            | Not implemented                                                                                               |
| Decision provider contract and Jev API adapter | Jev provider, CLI configuration, and contract tests implemented; live API-key end-to-end verification pending |
| More frontend components                       | Partial; public fixture and full regression matrix incomplete                                                 |
| Configurable generation policy                 | Scattered write guards exist; unified GenerationPolicy not implemented                                        |
| Multiple roles and approval flows              | Not implemented                                                                                               |
| Case editing and migration                     | Not implemented                                                                                               |

`--browser-provider` still accepts only `playwright`; decision `--provider` accepts `local`, `api`, or `jev`. Unsupported values fail explicitly.
