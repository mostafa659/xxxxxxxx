# ClinixStudy v3.66.0 — BP Alias and Localized Warning Deduplication

Date: 2026-11-21

## What the v3.65.0 real run showed

The latest user-provided output included:

- Solver DATA visibly used `BP_systolic=82 mmHg` and `BP_diastolic=48 mmHg`.
- The provenance gate still reported both solver and source MAP inputs missing.
- Solver DATA visibly included `PaCO2=30 mmHg`, but the separate source-reading pass did not confirm `paco2`.
- The warning `Anion gap: the answer reports 129 ... 21` remained, correctly identifying an unresolved model arithmetic error.
- The same localized Arabic warning was printed twice.

## Confirmed root cause fixed: BP key alias mismatch

The v3.65 parser recognized `systolic_bp` and `diastolic_bp`, but not the reversed aliases that appeared in the actual output: `BP_systolic` and `BP_diastolic`.

After canonicalization, these keys become `bpsystolic` and `bpdiastolic`; without explicit aliases, neither solver parsing nor source-side extraction maps them to canonical `sbp`/`dbp`. That exactly explains the paired MAP omissions for this key spelling.

v3.66.0 adds `bp_systolic`, `bp systolic`, `bp_diastolic`, and `bp diastolic` aliases. Regression tests use the exact key names from the user's output and verify both source corroboration and MAP calculation.

## Confirmed root cause fixed: duplicate localized warnings

The previous helper removed existing warnings that matched incoming ones, but did not deduplicate duplicates inside the incoming batch itself. Each distinct English calculation conflict could therefore carry the same Arabic summary and appear twice.

v3.66.0 now deduplicates incoming items using the supplied display key. The Arabic concern path uses the localized Arabic message as that key, so the same generic Arabic warning is emitted once while distinct English conflict flags remain available for diagnostics.

## PaCO2 limitation — deliberately not bypassed

The latest output shows PaCO2 in the solver's extracted data, but the authority/source pass did not confirm it. v3.65 already accepts ASCII `PaCO2` and Unicode-subscript `PaCO₂` forms when they are present in the source-pass text.

The raw source-reading transcript from this run was not supplied, so it is not possible to prove whether the second pass omitted PaCO2, used an unsupported representation, or lost it upstream. v3.66.0 does NOT copy PaCO2 from solver DATA into the independent source channel. Winter's result must remain withheld until the source pass actually confirms PaCO2. A regression test verifies that a source pass containing `PaCO2=30 mmHg` succeeds; missing source PaCO2 continues to withhold only Winter.

## Anion-gap model error — remains unresolved

The model still reports Anion Gap = 129 while deterministic arithmetic from Na=129, Cl=94 and HCO3=14 gives 21 mmol/L. The application correctly flags this mismatch and withholds clinical synthesis. This patch does not claim to improve Gemini's arithmetic or suppress the gate.

## Regression tests

Added/updated tests verify:

- Exact `BP_systolic` / `BP_diastolic` key spelling parses to canonical SBP/DBP.
- Source corroboration for BP aliases and `PaCO2` computes MAP and Winter only when source fields are present.
- Duplicate localized warning messages are collapsed within the incoming batch.
- The existing guard still catches the model's AG=129 mismatch against computed AG=21.

Results: **536 passed, 0 failed, 0 skipped**.

Focused clinical calculation suite: **59 passed, 0 failed, 0 skipped**.

## Limitations

- The raw source-reading transcript for the exact user run is not available. The cause of source-side PaCO2 omission remains unproven.
- The separate source-reading pass is model-generated, not orthogonal OCR or human review.
- No live Gemini run against v3.66.0 has been performed.
- `npm run build` remains blocked because Vite is absent in this environment (`vite: not found`, exit 127). No production bundle or deployment is claimed.
- Passing software tests does not establish clinical accuracy or medical authorization.
