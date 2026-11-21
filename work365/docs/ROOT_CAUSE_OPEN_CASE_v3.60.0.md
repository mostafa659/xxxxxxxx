# ClinixStudy v3.60.0 — Root-Cause Review of the Open-Case Stress Test

## Scope and evidence boundary

This review is based on the user's actual output from the v3.59.0 test and a direct inspection of the uploaded v3.59.0 source archive. The app withheld the generated clinical synthesis, so the underlying model's clinical reasoning cannot be graded. Findings below concern the application's parsing, task classification, cross-checks and safety-gate behaviour. This is an engineering audit, not medical validation.

## Failure modes established by the output and source

### 1. Table parser did not match the OCR prompt's own output contract

The source-transcription prompt asks for table rows written as cells separated by ` | `. The v3.59 parser accepted a table row only when it began **and** ended with `|`. A transcription such as:

`Sodium | 137 mmol/L | 129 mmol/L`

was therefore not treated as a temporal table. The separate source-reading pass could miss Na, chloride and bicarbonate even when the solver had extracted those values. This explains the specific missing-source-fields warning more directly than a medical knowledge failure.

**Fix:** accept pipe-separated rows with optional leading/trailing pipes, identify historical/baseline versus current columns from the header, and preserve distinct keys (for example `na_baseline` and `na`). Added regression coverage for the same no-outer-pipe format requested by the OCR prompt.

### 2. Partial OCR could hide a more complete source text layer

The final audit selected `ocrData || localSourceData`. Any non-empty but incomplete OCR extraction prevented use of additional fields extracted from the document text layer.

**Fix:** merge all available original-source extractions. Each channel is still compared and disagreements remain conflicts; the change does not allow model DATA to act as its own source verification. The solve assessment also combines all available source representations instead of choosing the first non-empty string.

### 3. Open-ended case was vulnerable to MCQ/polarity leakage

The output reported a negative-keyword/polarity problem even though the case was explicitly open-ended and used `NOT` in an instruction such as “NOT a multiple-choice examination”. A generic `priority` task label could also be confused with a structured exam item, and invented options in the solver brief could contaminate downstream checks.

**Fix:** explicit open-case language in the source takes precedence when the source has no actual option list. Open cases exit exam-only polarity/shape checks. A model-generated A/B list is not treated as original source options. The solve prompt's allowed `TYPE` labels no longer list `priority` as a task format; priority is a decision attribute, not proof of an MCQ.

### 4. CALC-versus-✅ comparison could compare unrelated numbers

The v3.59 assessment compared a calculation result against the text of a selected ✅ option without first proving that the original source contained answer choices. In an open-ended case, a model-invented option could therefore make a correct calculation appear inconsistent (for example a haemoglobin change of 3.6 versus an unrelated K value of 6.4).

**Fix:** compare the final CALC value with an answer option only when the original source itself contains real answer choices. The arithmetic within the CALC line is still checked independently.

### 5. The K=6.4 safety omission threshold was too narrow

The older high-risk omission advisory focused on K ≥6.5. The current case's repeat non-hemolyzed K was 6.4 mmol/L, but the patient was acutely unwell and had bradycardia, peaked T waves and QRS prolongation. Those ECG findings must not be lost just because the repeat value is below 6.5.

**Fix:** also raise the advisory when K is 6.0–6.4 and ECG/conduction toxicity is described. The detector selects the valid repeat non-hemolyzed sample rather than the earlier sample explicitly marked hemolyzed. This is consistent with the UK Kidney Association July 2026 guidance recommending continuous ECG monitoring for patients with ECG features of hyperkalaemia and for clinically unwell patients with K 6.0–6.4 mmol/L. This rule only raises an omission advisory; it does not prescribe a treatment or dose.

### 6. The same calculation warning could be emitted twice by separate audit stages

The initial solve assessment and the later final-answer trust pass both run the calculation audit. When the same conflict survives both passes, the final pass previously appended another flag/concern with identical wording instead of replacing the preliminary entry.

**Fix:** the final source-backed audit now replaces preliminary flags and concerns with matching messages, retaining the final, more specific conflict code exactly once. A regression test covers this merge behaviour.

### 7. PJP wording in the user's TMP-SMX warning is not reproducible from this ZIP's TMP-SMX rule

The uploaded v3.59 source's TMP-SMX warning message is indication-neutral and does not contain the quoted PJP wording. The only `PJP` references found in the executable safety module relate to fungal-biomarker specificity, not TMP-SMX prescribing. Existing and new regression tests verify that the TMP-SMX warning itself does not mention PJP.

Therefore the exact phrase in the submitted output cannot honestly be attributed to the TMP-SMX rule in this archive. Plausible explanations include a previously cached/deployed JavaScript bundle or text generated by the language model rather than by the deterministic safety audit. The source archive alone cannot distinguish those possibilities.

**Mitigation:** the PWA service-worker cache key is advanced in v3.60.0 so activation deletes the previous shell cache. The source is updated, but a successful deployment/build is still required before an installed or hosted app can be confirmed to run it.

## Reproduction of the supplied numeric inputs

Using only values transcribed in the stress case:

- MAP estimate from 82/48 mmHg: **59.33 mmHg**.
- Anion gap: `129 − (94 + 14)` = **21 mmol/L**.
- Albumin-corrected anion gap using albumin 2.6 g/dL: `21 + 2.5 × (4 − 2.6)` = **24.5 mmol/L**.
- Historical Hb 11.2 g/dL and current Hb 7.6 g/dL remain distinct time points, not duplicate same-time measurements.
- K 7.1 mmol/L from the explicitly hemolyzed sample is excluded from the selected valid measurement; the repeat non-hemolyzed value is **6.4 mmol/L**.

These are software extraction/calculation checks only. They do not establish a diagnosis or a treatment plan.

## Regression coverage added in v3.60.0

- Pipe-separated rows with and without outer Markdown pipes.
- Historical/current lab columns preserve separate keys and units.
- Source verification succeeds when solver DATA and original-source extraction both contain Na, Cl and HCO3.
- Open-ended wording overrides a broad `priority` type label and ignores fabricated A/B options.
- CALC-to-option comparison is not applied to an open task.
- Hemolyzed 7.1 is not selected over the non-hemolyzed repeat 6.4.
- K 6.4 with ECG toxicity raises the emergency-response omission advisory.
- TMP-SMX hold/history mentions do not trigger an unsafe-continuation conflict; an unqualified continuation does. The TMP-SMX alert text contains no PJP reference.
- Identical preliminary and final calculation warnings are merged instead of duplicated.

## Verification and remaining limitations

- `npm test`: **520 passed, 0 failed, 0 skipped**.
- `npm run build`: **not completed**; the environment has no installed `vite` executable (`vite: not found`).
- No direct Gemini execution or A/B experiment was performed.
- No live deployment was available to confirm that the user's active app has loaded v3.60.0.
- No clinician-adjudicated review was performed.

The fixes address the reproduced code paths; they do not establish 100% medical accuracy or clinical authorization.
