# ClinixStudy v3.66.0 — Test and Build Record

Date: 2026-11-21

## Automated tests

Command: `npm test`

Result: **536 tests passed; 0 failed; 0 skipped.**

Focused clinical calculation suite:

Command: `node --import ./tests/register.mjs --test --test-concurrency=1 tests/clinical-calculations.test.mjs`

Result: **59 tests passed; 0 failed; 0 skipped.**

New regression checks specifically cover the exact `BP_systolic` / `BP_diastolic` key spelling and duplicate localized warning summaries.

## Production build

Command: `npm run build`

Result: not completed. The environment reports `vite: not found` (exit 127). No production bundle or deployment is claimed.

## Live/model validation

No direct Gemini run against v3.66.0 was performed. The reported Anion Gap = 129 vs deterministic 21 remains a model error and continues to trigger the clinical-synthesis gate. Source-side PaCO2 is still required for Winter corroboration; the app does not trust solver-only PaCO2.
