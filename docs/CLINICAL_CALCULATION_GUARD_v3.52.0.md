# v3.52.0 — Independent Clinical Calculation Guard

## Purpose

Prevent model-generated clinical arithmetic and mechanistic claims from being accepted solely because they are confidently explained. The guard is deterministic JavaScript executed locally in the existing answer pipeline; it does not make another model call.

## Data flow

1. OCR extracts labelled values and units from the question when that stage is available.
2. The solver emits its compact `DATA` fields.
3. A private `===CLINICAL_DATA===` block is accepted only if a lesson model emits one; the prompt does not request it and the core guard does not depend on it.
4. The guard compares every pair of available extractions for each shared field. Consistent values are merged, including fields omitted by one extractor. Any differing value or unit for the same field creates a hard conflict. In production, every input required for a clinical calculation must independently match between solver DATA and OCR; if either channel is unavailable or misses a required input, the calculation is not confirmed. Method assumptions such as `SC=fu` and an ethanol divisor must be independently visible in OCR, not merely asserted by the model.
5. The application recomputes supported calculations. Numerical claims are compared only in the selected answer/calculation, not in intentionally incorrect distractor explanations.
6. On a hard conflict, the answer is downgraded, the selected answer is removed, option-level green checks are masked, and the correct-answer section is replaced by a no-confirmed-answer explanation. Optional private data blocks are removed from both partial streams and final student text.

## Supported calculation paths

### Fick cardiac output and systemic vascular resistance

- If oxygen contents are supplied, `CO = VO2 / [10 × (CaO2 − CvO2)]`, with VO2 in mL/min and contents in mL/dL.
- If contents are absent, the application may derive each content only from explicit Hb (g/dL), saturation (%) and corresponding PO2 (mmHg): `content = 1.34 × Hb × saturation_fraction + 0.003 × PO2`.
- `SVR = [(MAP − CVP) / CO] × 80`, with MAP/CVP in mmHg and CO in L/min.
- If MAP is not directly supplied but SBP and DBP are, the application labels its estimate `(SBP + 2 × DBP) / 3`.
- No value is supplied from a missing or unit-incompatible input.

### Osmolality and osmolal gap

- Conventional calculated osmolality: `2 × Na + glucose/18 + BUN/2.8` for Na in mmol/L, glucose and BUN in mg/dL.
- Urea in mg/dL uses its own divisor rather than the BUN divisor; SI inputs use their matching SI conversion.
- Measured osmolality (mOsm/kg) is kept distinct from osmolarity (mOsm/L).
- Ethanol is incorporated only when an ethanol result and the exact locally validated divisor are both explicitly supplied. The guard does not assume a universal ethanol coefficient.

### Acid–base support

- Anion gap is computed only with Na, Cl and HCO3 in compatible units.
- Albumin correction is displayed only when albumin is supplied and the conventional correction is labelled as such.
- Winter compensation is assessed only when the clinical context supports metabolic acidosis and actual HCO3/PaCO2 values with units are present.
- A claim of a triple acid–base disorder without the required pH, Na, Cl, HCO3 and PaCO2 fields is flagged; OG/AG alone do not establish it.

### Low-extraction hepatic clearance plus CVVH model

The only supported model is the explicitly stated one:

`R0 = Css,u × [(fu × CLint + Qeff,delivered × SC) / fu]`

It requires explicit `fu`, `CLint`, effective delivered `Qeff`, `SC` (unless `SC=fu` is explicitly established), and target unbound concentration `Css,u`, with compatible units and an explicitly stated low-extraction/restrictive assumption. `SC` is not silently substituted with `fu`. `fu` cancels only in this model when `SC=fu` is explicitly established. The output is marked as a model calculation, not a dose recommendation, and the model states that other clearance pathways, downtime, predilution, adsorption and changing physiology can alter exposure.

## Claim guardrails

- D-lactate detection is analyser/method-dependent. Blanket statements that point-of-care lactate devices universally detect only L-lactate or universally miss D-lactate are flagged.
- Persistent bleeding after a Pringle maneuver raises suspicion for hepatic-vein/retrohepatic-IVC injury; it does not prove that source. Aberrant hepatic arterial inflow and other sources remain possible.
- Hypoalbuminemia alone does not imply a universal infusion-rate increase or decrease.

## Student-facing behavior

- Internal extraction details and private structured data are not shown to students.
- If calculations disagree or a required input lacks independent OCR confirmation, no option is presented as confirmed. Green correctness marks in the option section are replaced by warning marks, and the final-answer section states that no answer choice can yet be confirmed.
- If the guard cannot calculate because required inputs are missing, it does not invent them. Where a model nevertheless presents an unsupported numeric SVR, OG or CVVH infusion rate, the result is flagged rather than accepted.
- If independent calculations agree, the application can insert a clearly labelled calculation-check section. This verifies arithmetic from extracted values; it does not independently prove OCR transcription, source truth, diagnosis or prescribing safety.

## Test coverage

`tests/clinical-calculations.test.mjs` covers parsing, OCR extraction, Fick/SVR, MAP formula, 2×Na, BUN/urea conversion, ethanol divisor requirements, anion gap, Winter compensation, delta-gap interpretation, Arabic/English triple-disorder claims, missing inputs, CVVH `fu`/`SC` assumptions, unsupported R0, assay-specific lactate claims, Pringle overclaim, all-pairs extraction mismatches, source merging, private-block removal, option masking, selected-answer-only numeric checking, mandatory OCR corroboration in production, and solver/lesson reconciliation. The focused suite passes 40/40; full project suite passes 453/453.

`tests/solveorder.test.mjs` covers the bounded prompt handoff, unchanged solve request budget, numerical data transfer and refusal to trust a solver read that disagrees with OCR.

## Limitations

This guard is not a universal clinical calculator and does not replace an independently validated clinical decision-support engine. Formulas and reference conventions can vary by laboratory and setting. The exact critical-care case discussed in the user conversation cannot be recalculated without the original question image and full numeric inputs. The current production guard deliberately requires OCR confirmation for every critical value used by its supported calculations; a solver-only reading cannot be treated as a confirmed numerical result. The release has not been benchmarked live against Gemini, and the Vite production build must be run in an environment with dependencies installed. Production calculation confirmation requires independent matching OCR and solver DATA values; when either stage is skipped or a required field is not recognized, the answer is held as unconfirmed rather than silently trusted.
