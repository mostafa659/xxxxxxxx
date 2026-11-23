# ClinixStudy v3.67.0 — Test and Build Record

Environment: Node v22.23.5, npm 10.9.9, `npm ci --ignore-scripts` from the lockfile. All numbers below were produced in this environment; raw logs are in `docs/npm-test-v3.67.0.tap.log` and `docs/npm-build-v3.67.0.log`.

## Automated tests (`npm test`)
| | v3.66.0 (original tree, same method) | v3.67.0 |
|---|---:|---:|
| Test files | 41 | 42 |
| Tests | 536 | **580** |
| Passed | 536 | **580** |
| Failed | 0 | **0** |
| Skipped / todo / cancelled | 0 | **0** |
| Identical results in 3 consecutive runs | yes | yes |

The 44 added tests are in `tests/v367-root-causes.test.mjs` (plus `tests/helpers-e2e.mjs`, the shared end-to-end harness). Two pre-existing assertions were changed deliberately and are the only edits to prior tests:
1. `facts.hb_baseline` → `facts.hbbaseline` (one canonical baseline identity; see report RC2).
2. "missing source PaCO₂ withholds only Winter …" → Winter's expected value is retained (needs HCO₃ only) and only the comparison with the unconfirmed measured PaCO₂ is withheld (see report RC3).

### New tests by purpose
| Group | Count | What it pins |
|---|---:|---|
| RC1 claim extraction | 10 | worked formulas not read as operands; evaluated chains; wrong values still caught; internal arithmetic errors; AG vs corrected AG; MAP/Hb/creatinine verified; reference ranges ignored; every occurrence; evaluator; negative sign |
| RC2 measurement extraction | 6 | baseline leak, unit/notation variants, pair/`from…to`/parenthetical/header cues, hemolyzed vs repeat K, ambiguity not guessed, single key identity |
| RC3 corroboration & gating | 6 | source grounding (and rejection of invented values), formula-scoped inputs, tiering, any-input mismatch blocks, deterministic reference values |
| RC4 warnings | 2 | one finding shown once; withheld formula never a flag |
| RC5 shared approval | 2 | blocked state leaks nothing; chat shares the state |
| End-to-end (real `createAnalysis`, mocked model) | 7 | correct arithmetic not blocked; wrong AG blocked once with empty supplementary surface; solve-phase banner; no pre-final streaming; unrelated-formula isolation; invented input blocked; no invented AG when chloride is absent |
| Cross-specialty | 6 | Fick/SVR, osmolal gap, nephrology/critical-care extraction, PK R₀, Arabic, claim verification as a pure function |
| Generated | 1 | 826 correct statements (0 false positives), 708 perturbed (708 flagged) |
| Formatting | 2 | markdown bold / table cells / inline code / LaTeX cannot hide a wrong number; source markdown |
| Handoff | 2 | data-driven trigger; no over-trigger on normal labs |

## Production build
`npm run build` (vite) → **exit 0**, built in ~3.6 s; entry chunk 892.85 kB (335.28 kB gzip). The original v3.66.0 tree also builds (exit 0) in this environment; earlier "vite not found" notes were environmental.

## Comparative runs
See report §3 and `scripts/repro-v3.66-failures.mjs`. Performance: extraction on a 2.3 MB synthetic document 38.5 s (v3.66.0) → 0.44 s.

## What these results do and do not show
They show that the verifier, extractor, gates and warning/approval plumbing behave as specified on synthetic and mocked inputs, and that the v3.66.0 defects no longer reproduce. They do **not** measure medical accuracy, live-model behaviour or UI rendering.
