# ClinixStudy v3.64.0 — Formula-Scoped Clinical Input Verification

Date: 2026-11-21

## Scope and evidence

This change responds to the user's v3.63.0 run. The visible audit reported:

- Anion gap generated as 129 mmol/L, versus deterministic arithmetic of 21 mmol/L from Na 129, Cl 94 and HCO3 14.
- Winter expected PaCO2 generated as 1.5 mmHg, versus deterministic arithmetic of 29 mmHg from HCO3 14: `1.5 × 14 + 8 = 29` (expected range 27–31 mmHg).
- A source-confirmation warning listing MAP/SBP+DBP, CVP, VO2, Hb, SaO2, PaO2, SvO2 and PvO2 even though the reported computations were MAP and acid-base calculations.
- Structured labels such as `systolic_bp`, `diastolic_bp`, `current_hb` and `historical_hb` in the displayed source reading.

The calculations above are arithmetic checks against the extracted values. They do not establish that a model-generated source-reading pass is independent OCR or human verification.

## Root causes found in v3.63.0

### 1. Formula provenance was inferred from a broad hemodynamic domain

`authorityFieldsRequired` treated the presence of the Fick/SVR domain as a reason to require MAP, CVP, VO2 and arterial/venous oxygen-content inputs as one large group. This coupled unrelated formula checks. A missing CVP or Fick input could therefore produce an aggregate input-conflict warning during a case whose relevant computations were MAP, anion gap and Winter compensation.

### 2. Structured underscore labels were not canonicalized

The data parser normalized punctuation out of keys, but the alias list did not cover `systolic_bp` or `diastolic_bp`. It also did not distinguish `current_hb` from `historical_hb`. Consequently, values visible in the structured reading could fail to populate canonical `sbp`, `dbp` and `hb` facts, or current and baseline haemoglobin could not be safely represented as separate fields.

### 3. One input warning could erase every computed result

The previous audit called `computeFromFacts({})` whenever any input conflict existed. This was an all-or-nothing response: one missing or uncorroborated field in a Fick/SVR/other formula could suppress otherwise independent and valid acid-base calculations.

### 4. Winter verification needed its own input set

The expected PaCO2 result uses HCO3 in Winter's equation. Interpreting the adequacy of respiratory compensation also requires the measured PaCO2. The source corroboration must check those specific inputs, rather than borrowing unrelated hemodynamic requirements.

## Changes in v3.64.0

1. Added normalized aliases for `systolic_bp` and `diastolic_bp`.
2. Added distinct canonical identities for `current_hb` (`hb`) and historical/baseline haemoglobin (`hb_baseline`), avoiding false same-field collisions.
3. Replaced broad domain-level input lists with formula-scoped requirements tied to calculations actually computed or numerical results actually claimed:
   - MAP: measured MAP or SBP+DBP.
   - Anion gap: Na, chloride and HCO3.
   - Albumin-corrected AG: Na, chloride, HCO3 and albumin.
   - Winter: HCO3 and PaCO2.
   - SVR: MAP, CVP and measured CO; Fick inputs are only required when the result actually uses Fick-derived CO.
   - Fick CO: VO2 plus CaO2/CvO2, or Hb and the corresponding arterial/venous saturation and PO2 measurements.
   - Osmolal gap and CRRT/protein-binding calculations retain their own formula-specific input sets.
4. Deterministic computations no longer disappear because an unrelated formula has a missing input. Conflicted fields are excluded from calculations that depend on them; unrelated calculations can still be computed.
5. Results whose own required inputs failed source corroboration are individually withheld. Independently corroborated results remain eligible to appear in the deterministic audit panel.
6. Numeric model claims remain compared against deterministic calculations. This catches AG=129 versus 21 and Winter=1.5 versus 29, while leaving the generated clinical synthesis blocked by the high-impact conflicts.
7. The service-worker shell cache was advanced to `clinix-shell-v3-64` to avoid reusing the earlier shell after deployment.

## Regression coverage added

- Canonical parsing of underscore BP labels.
- Separate current and historical haemoglobin identities.
- Exact stress-case repro: MAP from `systolic_bp=82` and `diastolic_bp=48`; AG 21; corrected AG 24.5; Winter 29.
- Correct capture of model-reported AG 129 and Winter 1.5 as mismatches.
- No unrelated CVP/VO2/SaO2/PaO2/SvO2/PvO2 requirement when those formula results are not claimed or computed.
- Specific CVP and CO requirements when an SVR number is reported.
- Fick oxygen-input requirements only when Fick-derived cardiac output is actually claimed/computed.
- Verified acid-base calculations remain visible while an unrelated SVR number is withheld for missing inputs.

## Verification and limitations

- `npm test`: **530 passed, 0 failed, 0 skipped**.
- `tests/clinical-calculations.test.mjs`: **53 passed, 0 failed**.
- `npm run build`: **not completed**; the environment does not have the `vite` executable (`sh: 1: vite: not found`, exit 127).
- No direct Gemini call against v3.64.0 was performed.
- No live deployment or device/browser validation was performed.
- No clinician-adjudicated assessment was performed.

This version improves formula-specific provenance and containment. It does not demonstrate that Gemini's arithmetic has improved, and it does not establish clinical accuracy or authorization.
