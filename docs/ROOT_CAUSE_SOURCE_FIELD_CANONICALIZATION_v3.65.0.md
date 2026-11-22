# ClinixStudy v3.65.0 — Source-Field Canonicalization Fix

Date: 2026-11-21

## What the v3.64.0 run showed

The user-provided output reported:

- The solver side had the inputs needed for MAP and Winter.
- The separate source-reading side did not confirm `MAP or SBP+DBP` and `PaCO2`.
- The app therefore withheld MAP and Winter results, while still showing independently corroborated anion-gap calculations.
- The generated answer continued to report Anion Gap = 129, compared with deterministic Anion Gap = 21. This remains a model arithmetic mismatch and is correctly flagged.

The latest user output did not include the raw source-reading payload. Therefore, the precise string emitted in that particular pass cannot be proven from the output alone.

## Reproduced implementation defect

In v3.64.0, `extractLabelledClinicalData()` converted source text into the authority/source field set using prose-label regular expressions. It did not pass through already-structured `key=value` readings such as:

- `systolic_bp=82 mmHg`
- `diastolic_bp=48 mmHg`

The solver's `parseClinicalData()` accepted these underscore aliases, but the authority extractor could drop them before independent corroboration. That asymmetry can produce the exact diagnostic pattern where solver fields are complete but source SBP/DBP are missing.

The source extractor also recognized ASCII `PaCO2` but not the common Unicode-subscript spelling `PaCO₂`. The key/value parser's key grammar likewise did not accept Unicode subscript digits. Consequently, source PaCO₂ could be dropped even when present in the transcription.

Synthetic reproductions using these formats reproduced the extraction failures. This identifies a concrete code defect consistent with the reported warning, while not proving which exact input spelling occurred in the user's hidden source-reading payload.

## Changes in v3.65.0

1. `extractLabelledClinicalData()` now preserves recognized structured `key=value` fields from the source-reading payload, canonicalizing aliases before sending them to authority verification.
2. The key parser accepts Unicode subscript digits and normalizes them to ASCII canonical identities.
3. The labelled-value extractor recognizes `PaCO₂` and `HCO₃` as well as ASCII `PaCO2` and `HCO3` spellings.
4. Existing formula-scoped verification remains unchanged: MAP requires MAP or SBP+DBP; Winter requires HCO₃ and PaCO₂; unrelated fields do not become prerequisites.
5. Missing source PaCO₂ withholds only Winter. Missing source SBP/DBP withholds only MAP. Independently verified AG calculations remain available.
6. The AG=129 vs AG=21 mismatch continues to trigger the hard clinical-synthesis gate; this patch does not pretend to fix Gemini arithmetic.
7. Service-worker cache advanced to `clinix-shell-v3-65`.

## Regression tests

New targeted tests cover:

- Structured underscore source keys.
- Unicode `PaCO₂` and `HCO₃` labels.
- Authority/source corroboration for SBP+DBP and PaCO₂.
- Missing source PaCO₂ suppressing Winter only.
- Missing source BP suppressing MAP only.

Results:

- Full suite: **534 passed, 0 failed, 0 skipped**.
- Focused clinical calculation suite: **57 passed, 0 failed, 0 skipped**.

## Limitations

- The raw source-reading payload from the user's v3.64.0 run was not supplied, so the exact emitted spelling/format cannot be verified.
- The separate source-reading pass may be model-generated; it is not guaranteed to be orthogonal OCR or human verification.
- No live Gemini run against v3.65.0 has been performed.
- `npm run build` did not complete: `vite` is not installed in the build environment (`sh: 1: vite: not found`, exit 127). No production bundle or deployment is claimed.
- These software tests do not establish clinical accuracy or medical authorization.
