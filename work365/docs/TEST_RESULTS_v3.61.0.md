# ClinixStudy v3.61.0 — Test and Build Record

Date: 2026-11-21

## Automated tests

Command: `npm test`

Result: **522 tests passed; 0 failed; 0 skipped.**

New regression tests reproduce the submitted anion-gap mismatch (model reports 129 while extracted Na=129, Cl=94, HCO3=14 produce AG=21; with albumin 2.6 g/dL, corrected AG=24.5), check the clinical synthesis withholding gate, verify explicit numeric substitutions in the model handoff, and flag an unsupported AG number when required inputs are absent.

## Production build

Command: `npm run build`

Result: **not completed**. The environment reports `sh: 1: vite: not found` (exit 127). No production bundle is claimed.

## Interpretation and limitations

Passing tests show that the covered deterministic software behaviours pass their regression tests. They do not prove Gemini's internal calculation is correct, validate generated clinical content, demonstrate improved real-world medical accuracy, or substitute for qualified clinical review.

The user's latest test also reports free-quota exhaustion and a fallback model. Because the exact model used by each generation stage is not fully isolated in the copied output, this run should not be treated as a controlled single-model benchmark.
