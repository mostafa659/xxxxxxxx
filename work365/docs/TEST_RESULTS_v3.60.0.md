# ClinixStudy v3.60.0 — Test and Build Record

Date: 2026-11-21

## Automated tests

Command: `npm test`

Result: **520 tests passed; 0 failed; 0 skipped.**

New regression cases cover unwrapped pipe-separated temporal lab tables, independent input corroboration, open-case task classification, irrelevant invented-option calculation comparisons, correct use of the non-hemolyzed repeat potassium, the K 6.0–6.4 plus ECG safety advisory, and indication-specific TMP-SMX warning behaviour.

## Production build

Command: `npm run build`

Result: **not completed**. The environment reports `sh: 1: vite: not found` (exit 127). No production bundle is claimed.

## Interpretation

Passing tests show that the covered deterministic software behaviours pass their regression tests. They do not prove complete clinical correctness, validate Gemini output, demonstrate improved real-world answer accuracy, or substitute for qualified clinical review. The submitted output's clinical synthesis was withheld, so it could not be independently clinically graded.

The exact build output is recorded in [`BUILD_ATTEMPT_v3.60.0.log`](BUILD_ATTEMPT_v3.60.0.log).
