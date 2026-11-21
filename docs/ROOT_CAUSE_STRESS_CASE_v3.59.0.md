# ClinixStudy v3.59.0 — Root-cause fixes from the open clinical stress case

## Scope and evidence limits

This release addresses defects exposed by the submitted ClinixStudy output. The output was visibly blocked before the generated clinical synthesis was displayed, so the underlying model's full clinical plan was not available for a medical correctness review. This report therefore distinguishes deterministic application defects demonstrated by the output/code from any clinical claims that cannot be evaluated because the model answer was hidden.

## What the submitted output revealed

1. **False polarity alarm.** The app reported that the stem contained a negative keyword even though the case was an open-ended task and contained general safety instructions such as “Do NOT invent missing data”. The old solver contract required a multiple-choice answer and the polarity scanner searched the entire stem.
2. **False haemoglobin conflict.** Hb 11.2 g/dL was explicitly a two-month-old baseline; Hb 7.6 g/dL was the current result. They are different time points, not inconsistent readings of the same sample.
3. **Failed independent source extraction.** The transcription prompt itself asks the vision stage to separate table cells using `|`, but the labelled-value parser did not accept `|` between a label and its value. This explains why Na, chloride and HCO3 could be present in one extraction while missing from the independent pass.
4. **Unrelated PJP wording in the safety guard.** The TMP-SMX warning contained a PJP-specific phrase even though this case described TMP-SMX as treatment for a presumed urinary infection. The underlying guard triggered on any TMP-SMX mention in the proposed answer, including medication-history mentions or recommendations to hold it.
5. **Over-broad answer withholding risk.** A real, specific high-risk medication conflict should still stop an unsafe recommendation. But a broad detector that fires on simple mention/withholding can unnecessarily hide unrelated safe emergency reasoning. The fix narrows the TMP-SMX trigger rather than disabling the fail-closed safeguard.

## Changes implemented

### 1. Open-question task fidelity

- The solve prompt now classifies the task before solving it: structured exam item, open-ended clinical case/question, real patient-care/emergency request, or calculation/source-only task.
- It evaluates only options that actually exist. When there are no options, it asks for a direct clinical synthesis and explicitly prohibits invented letters or distractors.
- The deterministic format detector now supports an `open` format and does not apply exam-only option-shape/polarity checks to it.
- Negative-polarity detection is limited to the actual final question directive for structured exam items, rather than every “NOT/Do NOT” in the complete case.
- The student-facing warning now says “clinical conclusion or plan” for open cases rather than “no option can be confirmed”.

### 2. Temporal and tabular data integrity

- Labelled lab extraction now accepts pipe-separated Markdown/OCR table rows, matching the format requested by the transcription prompt.
- Baseline/historical identity can be inherited from the nearest section heading and nearby time context, not only from the same line as the numeric result.
- Current and baseline haemoglobin values are retained under separate keys and are not compared as duplicate same-time readings.
- Combined blood-pressure cells such as `Blood pressure | 82/48 mmHg` are split into SBP and DBP. When valid, the deterministic calculator can estimate MAP as `(SBP + 2×DBP) / 3` and label it as an estimate.
- The existing anion-gap calculator can now receive Na, Cl and HCO3 from those pipe-separated table cells.

For the supplied case values, the deterministic results are: estimated MAP **59.33 mmHg** and uncorrected anion gap **17 mmol/L**. Albumin was not supplied, so an albumin-corrected anion gap is not available.

### 3. Medication safety guard precision

- TMP-SMX safety checking now requires an affirmative proposed start/continuation/restart, not a mention in the medication history.
- Explicit recommendations to hold/stop TMP-SMX do not trigger a dose-adjustment warning.
- When initiation/continuation is proposed in the presence of hyperkalaemia/renal risk, the guard checks for kidney-function-based dosing plus explicit potassium and renal-function monitoring.
- The generic PJP phrase was removed; the safety message is indication-neutral and says to verify whether the medicine remains indicated.

### 4. High-risk omission advisory

A cross-case advisory now identifies severe hyperkalaemia (K ≥6.5 mmol/L) together with ECG/conduction toxicity when the answer does not describe an urgent emergency response and continuous ECG monitoring. It is an advisory rather than a treatment order; it does not invent a dose or replace local protocols.

## Case-level deterministic checks

- Hb baseline 11.2 and current Hb 7.6 are treated as separate time points.
- Na 128, Cl 96 and HCO3 15 are independently extracted from pipe-separated table rows.
- Anion gap: `128 − (96 + 15) = 17 mmol/L` (uncorrected; albumin absent).
- MAP: `(82 + 2×48) / 3 = 59.33 mmHg` (estimated from cuff BP, not directly measured).
- The hemolyzed initial potassium is not allowed to outrank a repeat non-hemolyzed measurement in the TMP-SMX safety check.

## Regression coverage added

- Open-ended long clinical task containing repeated `Do NOT` instructions does not trip MCQ polarity/shape checks.
- Existing true negative-polarity MCQ check remains active.
- Markdown table rows and heading-scoped baseline/current Hb are parsed without false duplicate conflicts.
- BP `82/48`, electrolytes and resulting MAP/anion gap are recalculated in code.
- TMP-SMX history-only and hold recommendations do not trigger a false conflict; unsafe continuation still triggers unless renal adjustment and both monitoring requirements are stated.
- Severe hyperkalaemia with ECG toxicity generates an omission advisory when urgent response is absent.

## Boundaries

These changes reduce specific classes of application error; they do not establish clinical validity or 100% accuracy. The hidden clinical synthesis in the submitted output cannot be graded because the safety gate withheld it. The release still needs a full automated regression run, a production build, and independent clinical review before claims about clinical outcome improvement are warranted.
