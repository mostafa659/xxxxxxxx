# ClinixStudy v3.64.0 — Test and Build Record

Date: 2026-11-21

## Automated tests

Command: `npm test`

Result: **530 tests passed; 0 failed; 0 skipped.**

Focused clinical calculation suite:

Command: `node --import ./tests/register.mjs --test --test-concurrency=1 tests/clinical-calculations.test.mjs`

Result: **53 tests passed; 0 failed.**

New regression tests cover structured underscore aliases, baseline/current haemoglobin identity, formula-specific source corroboration, the case's MAP/AG/corrected-AG/Winter values, numeric SVR input requirements, and Fick-specific input requirements.

## Production build

Command: `npm run build`

Result: **not completed**. The environment reports `sh: 1: vite: not found` (exit 127). No production bundle is claimed.

## Interpretation and limitations

The tests establish the software behaviour covered by the regression suite. They do not prove Gemini arithmetic accuracy, source transcription accuracy, clinical correctness, or production deployment. The user's reported AG=129 and Winter=1.5 remain model-output errors; v3.64.0's deterministic audit is designed to detect them and avoid unrelated input requirements suppressing valid calculations. A fresh run on the rebuilt/deployed app is still needed.
