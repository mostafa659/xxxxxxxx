# ClinixStudy v3.57.0 — Test and Build Record

Date: 21 November 2026

## Baseline before changes

The extracted v3.56.0 project was tested before modification:

- Command: `npm test`
- Result: 495 passed, 0 failed.

## New tests

Added `tests/healthcare-benchmark.test.mjs` with eleven tests covering:

- benchmark integrity and evidence references;
- diversity of high-value failure modes;
- prompt-level protocol requirements;
- weighted scoring validation;
- quadratic weighted kappa and binary agreement calculations;
- blinded paired-response generation;
- two-reviewer scoring and non-averagable critical-error gates;
- A/B key integrity (exact case coverage, no duplicate mappings, and one baseline plus one candidate per pair);
- reviewer-file benchmark identity;
- explicit surgical deterioration and young-infant fever test coverage.

The 26-case evaluation dataset and reviewer tooling are separate from the app's case-specific clinical safety patches.

## Full automated suite

Command: `npm test`

Actual result: **506 passed, 0 failed, 0 skipped** (495 baseline + 11 new). Full log: `docs/npm-test-v3.57.0.log`.

## Evaluation harness

Command: `npm run eval:healthcare:prepare`

- 26 prompts prepared.
- Model-facing prompt pack omits expected behaviours and critical failure anchors.
- Separate reviewer reference file contains scoring anchors.
- Baseline/candidate response template generated.

No raw model response comparison or clinician ratings were available in this execution; therefore no model performance change is claimed.

## Production build

Command: `npm run build`

Result: not completed. `sh: 1: vite: not found`; `node_modules` is absent. This release is source/test verified only, not production-built. Full output: `docs/npm-build-v3.57.0.log`.

## Clinical validation status

Not performed: live Gemini A/B, independent clinician scoring, adjudication panel, prospective workflow testing, or patient-outcome validation. The benchmark is research-informed and synthetic; it is not itself clinical validation.


## CLI workflow smoke test

- `npm run eval:healthcare:prepare`: passed; prepared all 26 prompts and the separate reviewer reference.
- `npm run eval:healthcare:blind`: passed with temporary synthetic placeholder responses to verify A/B masking and key generation.
- `npm run eval:healthcare:score`: passed with temporary synthetic reviewer ratings to verify scoring arithmetic and report generation.
- Temporary smoke-test responses, blind key, and score outputs were removed. These smoke tests are **not** a real model comparison or reviewer evaluation.
