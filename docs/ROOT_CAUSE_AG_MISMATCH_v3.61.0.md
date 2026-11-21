# ClinixStudy v3.61.0 — Root-Cause Review: Anion-Gap Mismatch

## Scope and evidence

This review uses the user's latest ClinixStudy output and direct inspection of the supplied v3.60.0 source archive. It evaluates application engineering controls, not a clinical diagnosis or a clinician-adjudicated answer.

The output shows that several v3.60.0 regression targets did not recur in this run: the false open-case polarity warning is absent; the irrelevant `CALC ends at 3.6 but the ✅ option says 6.4` warning is absent; Na, chloride and bicarbonate appear in the source-reading summary; the valid repeat K=6.4 mmol/L is used rather than the hemolyzed initial K=7.1; and the prior irrelevant TMP-SMX/PJP wording is absent. One run does not prove these behaviours are fixed for every input or model.

## New failure observed

The generated explanation reported an anion gap of **129 mmol/L**, while the application's independent calculation from the extracted values was **21 mmol/L**. The value 129 is exactly the extracted sodium value; copying the sodium into the anion-gap field is a plausible explanation, but the text alone cannot prove the model's internal cause.

The correct arithmetic from the stated extracted inputs is:

- Uncorrected AG = `129 − (94 + 14)` = **21 mmol/L**.
- Albumin-corrected AG = `21 + 2.5 × (4 − 2.6)` = **24.5 mmol/L**.
- Estimated MAP from 82/48 mmHg = **59.33 mmHg**.

These are arithmetic recomputations from extracted values, not independent confirmation that the transcription matches the original image/document.

## Root cause in v3.60.0

The deterministic calculation audit already detected `reported-ag-mismatch` and lowered eligibility. The defect was in the final presentation gate: `reconcileLesson` replaced only a dedicated “correct answer” section. Other generated explanation sections and memory/trick text remained visible even though the integrated clinical explanation contained a material arithmetic contradiction. The control therefore blocked the final-answer label but did not withhold the full generated clinical synthesis.

A second gap was that the model handoff stated the generic anion-gap formula but did not always include the explicit numeric substitution. That left the generation model to repeat arithmetic from memory. A third gap was the absence of a parallel hard conflict when a numeric AG was asserted but the necessary verified Na/Cl/HCO3 inputs were unavailable.

## Changes in v3.61.0

1. Added a clinical synthesis gate for high-severity acid-base calculation conflicts (reported AG/corrected-AG mismatch; unsupported AG number; source disagreement in Na, chloride, bicarbonate or albumin; and missing independent corroboration of critical acid-base inputs).
2. When that gate fires, suppress the entire model-generated clinical explanation and tricks—not merely the “correct answer” section.
3. Show deterministic arithmetic only when the input-reading channels agree. If the source inputs themselves conflict or are not independently corroborated, do not show derived values as reliable.
4. Include explicit substitutions in the solver handoff, e.g. `129 − (94 + 14)`, and in the albumin correction, e.g. `21 + 2.5 × (4 − 2.6)`.
5. Add a hard finding `ag-without-inputs` if the model reports an anion-gap number without verified sodium, chloride and bicarbonate inputs.
6. Increment the service-worker cache name so the next deployed shell does not reuse the previous cache.

## Test coverage

New regression tests reproduce:

- Model-reported AG `129` against extracted Na `129`, Cl `94`, HCO3 `14`.
- Independent uncorrected AG of `21` and albumin-corrected AG of `24.5`.
- Blocking the generated clinical synthesis for that high-impact mismatch in a clinical context.
- Rendering the deterministic calculations and explicit conflict while avoiding claims of source-verification certainty.
- Blocking a numeric AG claim when required inputs are absent.

## Test and deployment status

- `npm test`: **522 passed, 0 failed, 0 skipped**.
- `npm run build`: **not completed**; the environment has no installed `vite` executable (`sh: 1: vite: not found`).
- No direct Gemini execution with v3.61.0 was performed.
- No controlled A/B test was performed. The user's latest run reports quota exhaustion and fallback to another model, so it is not a clean single-model benchmark.
- No live deployment or browser session was available to confirm that the user's active app is running this source version.
- No independent clinician review was performed.

The v3.61.0 change is a containment and reliability fix: it prevents displaying generated clinical prose when a high-impact acid-base calculation conflict remains. It does not prove the underlying model will calculate correctly, and it does not establish 100% medical accuracy.
