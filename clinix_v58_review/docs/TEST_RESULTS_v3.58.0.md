# ClinixStudy v3.58.0 — Test and Build Record

## Scope

General healthcare task fidelity, memory isolation, incomplete-output handling, statistical interpretation, antimicrobial susceptibility safeguards, and A/B benchmark integrity. No disease-specific diagnosis or single-case answer was hard-coded.

## Automated tests

Command: `npm test`

Result: **509 passed, 0 failed, 0 skipped**.

The suite includes existing project regressions plus new checks for:
- task-adaptive prompt requirements;
- opt-in cross-question history links;
- benchmark content-to-case alignment;
- benchmark version and prompt-hash validation;
- explicit completion state and controlled-run metadata;
- blinded reviewer scoring and independent reviewer requirements.

Full log: `docs/npm-test-v3.58.0.log`.

## Evaluation preparation

Command: `npm run eval:healthcare:prepare`

Result: successful. Prepared 26 cases under benchmark version 1.1.0 with prompt hashes, response completion status, controlled-run metadata, reviewer reference and ratings template.

## Supplied A/B response file audit

The uploaded response file is not eligible for clinical A/B scoring. It contains 26 baseline and 26 candidate strings but no benchmark version, prompt hashes, run metadata, completion flags or clinician ratings. Four candidate responses are mapped to different cases; four candidate responses are visibly partial. The diagnostic realignment file is included but is not a scoreable dataset.

## Production build

Command: `npm run build`

Result: not completed. `sh: 1: vite: not found`. No production build is claimed.

## Clinical validation boundary

Automated tests establish software behavior only. They do not prove medical correctness, safety, generalization or patient benefit. A valid A/B score still requires the same model/version/settings/search state, fresh isolated runs, complete outputs, exact prompt hashes and at least two independent reviewers with appropriate clinical expertise.
