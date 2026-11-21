# ClinixStudy v3.59.0 — Test and Build Record

## Automated tests

- Command: `npm test`
- Result: **514 passed, 0 failed, 0 skipped**.
- Duration: approximately 21.7 seconds.
- New regression coverage includes open-ended task/polarity handling, table-pipe extraction, historical/current haemoglobin separation, BP-derived MAP, anion gap, TMP-SMX action specificity, and severe hyperkalaemia/ECG omission detection.

## Deterministic case replay

Using the relevant data structure from the supplied case:

- Extracted independently: SBP 82 mmHg, DBP 48 mmHg, baseline Hb 11.2 g/dL, current Hb 7.6 g/dL, Na 128 mmol/L, Cl 96 mmol/L, and HCO3 15 mmol/L.
- Estimated MAP: 59.33 mmHg from `(82 + 2×48) / 3`.
- Uncorrected anion gap: 17 mmol/L from `128 − (96 + 15)`.
- No same-source duplicate conflict was raised for current/baseline haemoglobin.
- No missing independent input was raised for Na, Cl or HCO3 in this replay.
- Albumin was not supplied, so albumin correction is unavailable.

## Syntax checks

`node --check` passed for the changed JavaScript modules and the changed test file.

## Production build

- Command: `npm run build`
- Result: **not completed**.
- Environment error: `sh: 1: vite: not found`.
- No production bundle is claimed. Install project dependencies (including Vite) and rerun the build in the target environment.

## Clinical validation boundary

The submitted ClinixStudy output withheld the generated clinical synthesis, so its hidden clinical reasoning could not be independently graded. Passing software tests demonstrates that these regression paths behave as specified; it does not demonstrate clinical accuracy, replace clinician review, or establish 100% correctness.
