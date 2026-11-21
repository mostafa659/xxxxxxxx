# ClinixStudy v3.62.0 — Test and Build Record

Date: 2026-11-21

## Automated tests

Command: `npm test`

Result: **524 tests passed; 0 failed; 0 skipped.**

The two new regressions verify that:
- Source-derived sodium, chloride, bicarbonate and albumin values produce an explicit deterministic calculation handoff before lesson generation.
- Part A, Part B and single-request lesson prompts all receive the handoff and a non-negotiable calculation-authority rule.

Existing tests continue to cover the v3.61.0 mismatch gate, which blocks generated clinical synthesis on the reported AG=129 versus computed AG=21 conflict.

## Production build

Command: `npm run build`

Result: **not completed**. The environment reports `sh: 1: vite: not found` (exit 127). No production bundle is claimed.

## Interpretation and limitations

Passing tests show that the covered source and prompt behaviours pass their regression tests. They do not prove Gemini will obey the calculation handoff, validate generated clinical content, demonstrate improved real-world medical accuracy, or substitute for qualified clinical review. The final calculation conflict gate remains active independently of the new pre-generation handoff.
