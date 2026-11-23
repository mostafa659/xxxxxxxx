# ClinixStudy v3.62.0 — Root-Cause Review: Pre-generation Calculation Authority

## Triggering evidence

The v3.61.0 retest shows that the application extracted Na=129 mmol/L, Cl=94 mmol/L, HCO3=14 mmol/L and albumin=2.6 g/dL, independently calculated AG=21 mmol/L and albumin-corrected AG=24.5 mmol/L, and successfully withheld the model-generated clinical explanation when it reported AG=129 mmol/L. The containment gate therefore worked in this run. The model's numeric error remained.

## Root cause addressed

The final calculation audit is necessarily post-generation: it compares the model's generated explanation with source-derived inputs. However, the app's fast/split pipeline can launch parallel lesson writers before the solve brief arrives, and the early Part A writer did not receive a calculation audit. A model could therefore generate an incorrect derived quantity before seeing the application's deterministic arithmetic. Some fallback paths also start a writer without a verified brief.

This does not prove that the missing handoff caused the exact 129 error in the submitted run, especially where a later solve brief may have been available. It is an architectural gap that can be removed generally.

## v3.62.0 changes

1. Added `buildPreGenerationCalculationHandoff(sourceText)`, which extracts labelled source values and computes supported calculations in application code before lesson generation. It explicitly does not claim independent validation of transcription.
2. Passed the preflight calculation handoff to Part A, Part B/main, Part B/tricks, and single-request lesson writers across fast, split, and single flows.
3. When a solve brief already contains an `APPLICATION CALCULATION AUDIT`, avoid duplicating the same handoff.
4. Added a non-negotiable prompt rule: use the application's computed values and substitutions as the canonical arithmetic for extracted inputs; do not recalculate independently or substitute a raw input for a derived output. If the source or result appears inconsistent, disclose uncertainty without asserting a competing number.
5. Kept the v3.61.0 post-generation, source-backed conflict gate unchanged. The handoff is not a bypass, source verification, diagnostic approval, or substitute for human review.
6. Added regression tests for source-to-handoff arithmetic and for all three lesson prompt builders receiving and obeying the authority block.

## Deterministic calculations for the submitted case

- Uncorrected AG: `129 − (94 + 14)` = **21 mmol/L**.
- Albumin-corrected AG: `21 + 2.5 × (4 − 2.6)` = **24.5 mmol/L**.
- Delta gap using conventional references: `(24.5 − 12) − (24 − 14)` = **2.5 mmol/L**.
- Winter expected PaCO2: `1.5 × 14 + 8` = **29 mmHg**, expected range **27–31 mmHg**; measured PaCO2=30 mmHg is within that range.

These values are arithmetic from extracted inputs, not confirmation that the source transcription is correct or a full clinical interpretation.

## Verification and limitations

- `npm test`: **524 passed, 0 failed, 0 skipped**.
- `npm run build`: **not completed**; `vite` is not installed (`sh: 1: vite: not found`, exit 127).
- No direct Gemini run on v3.62.0 was performed.
- No controlled A/B model benchmark, deployment verification, or independent clinician review was performed.
- The prompt handoff may reduce arithmetic drift but cannot guarantee that a generative model will obey it. The final deterministic gate remains essential.

## Acceptance criterion for the next live retest

Use the same case once, with the exact deployed v3.62.0 build and model/mode metadata recorded. The model should repeat AG=21 and corrected AG=24.5 from the supplied audit. If it still reports 129 or another conflicting value, the app must continue to suppress the generated clinical synthesis and show only the deterministic audit/conflict. A single successful run is not a medical-accuracy benchmark.
