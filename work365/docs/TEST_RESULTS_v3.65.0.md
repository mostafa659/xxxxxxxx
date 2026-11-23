# ClinixStudy v3.65.0 — Test and Build Record

Date: 2026-11-21

## Automated tests

Command: `npm test`

Result: **534 tests passed; 0 failed; 0 skipped.**

Focused clinical calculation suite:

Command: `node --import ./tests/register.mjs --test --test-concurrency=1 tests/clinical-calculations.test.mjs`

Result: **57 tests passed; 0 failed; 0 skipped.**

Four new regression tests verify structured underscore source keys, Unicode PaCO₂/HCO₃ labels, authority corroboration, and formula-specific suppression when source fields are truly absent.

## Production build

Command: `npm run build`

Result: **not completed**. The environment reports `sh: 1: vite: not found` (exit 127). No production bundle is claimed.

## Interpretation and limitations

The v3.64.0 warning showed source-side omissions for MAP/SBP+DBP and PaCO₂ while solver fields were complete. v3.65.0 fixes two concrete extraction asymmetries reproduced synthetically: source extraction dropped structured underscore key/value fields, and it did not recognize Unicode-subscript PaCO₂/HCO₃ spellings. The raw payload from the user's exact run was not available, so the exact source spelling remains unconfirmed.

The reported Anion Gap = 129 versus independently computed 21 remains a model-output error. The application should continue to flag the mismatch and withhold clinical synthesis. This patch does not establish that Gemini arithmetic has improved.

No direct Gemini call, live deployment, device/browser validation, clinician adjudication, or production build was performed.
