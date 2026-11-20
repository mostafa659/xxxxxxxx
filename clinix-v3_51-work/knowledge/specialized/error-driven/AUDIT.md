# ClinixStudy v3.49.0 — AI-error-driven specialist batch

This batch is deliberately small. Each retrievable candidate maps to a previously observed AI failure family rather than adding general textbook coverage.

## New records (all shipped as `draft`)

1. `error.warfarin.stereoselective-cyp-pathways` — corrects the collapse of S- and R-warfarin into one metabolic pathway. It maps dominant enantiomer-specific routes and explicitly prevents an interaction-specific dose being inferred from pathway mapping alone.
2. `error.assay.ic50-ki-kd-not-interchangeable` — separates assay-dependent IC50, inhibition constant Ki, and equilibrium dissociation constant Kd; limits Cheng–Prusoff conversion to competitive inhibition assumptions.
3. `error.veterinary.feline-aldosterone-assay-scope` — gives one feline LC–MS/MS healthy-reference interval with its exact assay/population limits; it is not a validated disease cutoff and an adrenal mass alone does not prove functional aldosterone secretion.
4. `error.veterinary.abcb1-ivermectin-cats-not-dog-only` — documents that ABCB1-associated ivermectin sensitivity has been reported in cats, while preventing a two-cat case report from being misused as prevalence or dosing evidence.
5. `error.anatomy.knot-of-henry-tendon-vs-nerve` — distinguishes the FHL/FDL tendon decussation from the separate nearby medial plantar nerve.

## Deliberately not added as student KB facts

- Toluene/UAG/UOG: the error is recorded in `ai-error-regression-matrix.json`, including the missing-factor-of-two calculation failure and limits of urine-gap interpretation. The primary full-text sources checked for the detailed rule did not carry a redistribution license accepted by the builder, so this material is not embedded in the retrievable library.
- HLRCC/FH fabricated histology and missing feline laboratory values: these are source-grounding failures, not knowledge gaps. Existing lesson prompts already require verification against the original question and prohibit invented case data. The regression matrix preserves these failure families without adding unsupported clinical facts.

## Provenance and approval

The five entries use CC BY 4.0 sources. The builder checks that the license is allowed, source evidence is typed, and each stored quote exists verbatim in its cited passage. This is provenance validation, **not** proof that the clinical interpretation has been independently confirmed. All five records remain `draft`; no medical reviewer is asserted and none can be retrieved for student answers before a named clinician approves claim support, clinical accuracy, scope, and exceptions.

## Known evidence boundaries

- The feline aldosterone interval comes from 49 healthy cats measured with one LC–MS/MS method; it must not be substituted for a lab's RIA interval or treated as a diagnostic threshold for primary hyperaldosteronism.
- The feline ABCB1 item rests on a small report of two suspected ivermectin-sensitive cats. It supports “not dog-exclusive,” not prevalence, a breed-wide claim, a dosing protocol, or universal screening.
- The warfarin item maps dominant human enantiomer pathways. It does not resolve the entire amiodarone interaction, does not claim CYP2D6 is absent from every possible interaction, and does not determine a dose change.
- The Knot of Henry source supports the tendon crossing and standard medial plantar nerve course, not individual anatomic variants.
