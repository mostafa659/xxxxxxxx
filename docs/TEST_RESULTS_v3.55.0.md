# ClinixStudy v3.55.0 — Test and Build Record

**Date:** 21 November 2026

## Automated tests

- Full project suite: **485 / 485 passed**, 0 failed.
- Focused clinical safety suite: **30 / 30 passed**, 0 failed.
- The new mandibular AFS / APS / Jewer-LC regression is included in `tests/clinical-safety.test.mjs`.
- Prior ECMO/TAAA and HLH safety regressions also passed as part of the complete suite.

## Build

`npm run build` was attempted and did **not** complete:

```text
> clinixstudy@3.55.0 build
> vite build

sh: 1: vite: not found
```

The active workspace does not contain the Vite executable / installed `node_modules`. Therefore this is a source-and-test-verified ZIP, **not a successfully produced Vite production build**.

## Runtime AFS-case audit

Using the supplied modern AI answer and selected option C:

- Clinical safety audit triggered: **yes**.
- Hard conflicts: **0**.
- Advisories: **11**.
- Overall audit state: `review`.

The advisories cover BRAF compartment localisation, BRAF-targeted evidence, final pathology/RT decision, non-universal RT dose, absent chest staging, flap selection, Jewer-LC operative detail, INR 4.8 with fluconazole-warfarin, APS bridging timing, the fact that BRAF/MEK inhibitors are not listed as current medication, and the unsupported universal Ki-67 threshold.

A `review` state is not a clinical sign-off. It means the programmed high-impact contradiction checks did not identify a matching hard-block rule, while material items remain for qualified review.

## Not performed

- No live Gemini invocation or A/B comparison.
- No clinician sign-off.
- No completed Vite production build, desktop executable or mobile package build.
