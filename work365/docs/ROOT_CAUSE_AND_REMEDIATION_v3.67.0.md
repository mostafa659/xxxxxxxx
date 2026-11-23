# ClinixStudy v3.67.0 — Independent Audit, Root Causes and Remediation

Baseline: uploaded `ClinixStudy_v3_66_0_bp_alias_warning_dedup.zip` (left unmodified).
Method: every finding below was reproduced from the v3.66.0 source (`scripts/repro-v3.66-failures.mjs`, plus a real `createAnalysis` pipeline run with a mocked model). Earlier reports were not trusted without checking.

## 0. What is verified and what is not

| Status | Statement |
|---|---|
| **Verified** | The verifier read the *first operand* of a worked formula as the model's reported result. |
| **Verified** | The source-side extractor decided time scope per *line*, required units glued to numbers, and so lost current Na/Cl/HCO₃/PaCO₂ for natural-prose cases. |
| **Verified** | With every model calculation *correct*, v3.66.0 still blocked the whole clinical synthesis for the audited case (§3). |
| **Strongly supported, not provable from the code** | The "model errors" `Anion gap 129` and `Winter 1.5` that were reported across v3.59–v3.66 are exactly the first operands of the *correct* formulas (`129 − (94+14) = 21`, `1.5 × 14 + 8 = 29`). They are consistent with verifier misreads. Raw model transcripts from those runs were not supplied, so it cannot be proven that the model never produced a wrong number. The verifier now detects both situations correctly (§4, tests RC1). |
| **Not done** | No live Gemini run, no clinician review, no measurement of medical accuracy. No claim of improved clinical accuracy is made; the evidence below concerns *verifier and pipeline behaviour on synthetic inputs*. |

Corrections to claims made earlier (including during this audit): the v3.66.0 "vite not found" build failure was an environment issue (`npm ci` + `npm run build` succeed on the original tree). The v3.66.0 report's 536 tests is accurate; a lower count seen when piping `npm test` was output truncation (§5.1).

## 1. Shared root causes

The nine listed symptoms trace back to **five** architectural defects.

### RC1 — Result extraction took the first number after a label
`labelledNumber()` / `compareLabeled()` (`clinical-calculations.js`) returned the first number after a label. Reproduced:

| Text (correct) | v3.66.0 |
|---|---|
| `Anion gap: 129 − (94 + 14) = 21` | "answer reports 129" |
| `Winter expected PaCO2 = 1.5×[HCO3] + 8 → 29` | "answer reports 1.5" |
| `AG … 21. The albumin-corrected anion gap is 24.5` | corrected value compared with the *uncorrected* AG → mismatch |

Consequences: symptoms 6/8 (false conflicts), plus **missed detections**: MAP, corrected AG, Hb decline were never compared at all (`MAP = 71` passed silently). The alias list put "corrected anion gap" before "anion gap", conflating the two quantities.

### RC2 — Source extraction scoped time per line and demanded glued units
`qualifierForMeasurement()` tagged *every later value on a line* as baseline if "baseline" appeared earlier on that line. For `Baseline/current creatinine 1.3/3.1 … Sodium 129 … PaCO2 30` v3.66.0 produced `na_baseline, chloride_baseline, hco3_baseline, paco2_baseline` — no current readings. Separately every regex needed `129 mmol/L` literally; `Na 129,` and `sodium 129 (mmol/L)` extracted nothing. This is the cause of symptoms 1, 2, 3 and 4 ("shown in the UI, missing in verification"): the UI shows the solver's data, the verifier compared against an extractor that could not read the source.
A related schema split: `historical_hb` became `hb_baseline`, while `hb_baseline`/table columns became `hbbaseline` — one concept, two keys.

### RC3 — Corroboration required *our regex* to re-derive a value; formulas demanded inputs they do not use; one failure blocked everything
`requireAuthorityInputs` treated "the extractor did not re-read it" as "the source does not contain it". Winter's *expected* PaCO₂ (`1.5×HCO₃+8`) was required to have PaCO₂ confirmed although it never uses it. Any unconfirmed input of any formula emitted a high-severity conflict that cleared the answer, forced the LOW tier and blocked synthesis for the whole case (symptom 8, overblocking).

### RC4 — One finding, several channels, several phrasings
The same conflict was pushed as an English flag, a localized concern (a *different* Arabic sentence at solve time and at final time), listed again in the banner `why`, and again in the withheld body. `replaceAuditItemsByMessage` de-duplicated only identical strings (symptom 5). Observed in v3.66.0: two different Arabic generic lines plus two English lines in one banner.

### RC5 — The approval state was not shared by every component
- The solve-phase banner (`emitTrust` phase `solve`) ran *before* the safety/quality gates and displayed `likely` = the model's preliminary conclusion on clinical content.
- The follow-up chat received the withheld explanation as "LESSON ALREADY SHOWN" and could re-create a blocked answer (symptom 7).
- The pre-generation calculation handoff depended on keywords in the question ("anion gap"), so a case that merely lists pH/Na/Cl/HCO₃ got **no** verified numbers before the lesson writers started (confirmed empty in v3.66.0).

## 2. What changed and why

| Change | Files |
|---|---|
| **Claim extraction by arithmetic chain.** A claim is the *result* of the chain after a label; chains are evaluated with a shared evaluator; steps that disagree with their own result are reported; specific labels beat general ones (`uncorrected` handled); every occurrence is checked; reference ranges/comparators/hypotheticals are ignored; markdown, table cells, LaTeX, Arabic labels/digits and negative results are handled. Registry-based verification now covers AG, corrected AG, Winter (point or range), MAP, Hb decline, creatinine rise/fold, OG, SVR, CO, R₀. | **new** `src/lib/calc-claims.js`, **new** `src/lib/arith.js` (evaluator moved out of `solvecheck.js`, same API re-exported) |
| **Per-measurement extraction.** Time scope decided from the cues adjacent to each measurement (pre-label pairs `baseline/current`, post-value cues, `from X to Y`, `(baseline 11.2)`, list headers, headings). Sample identity (hemolyzed vs repeat) preserved. Units may be missing/parenthesised/shared; a missing unit is assumed **only** where one physiological unit is possible (Na/Cl/HCO₃/K mmol/L, pH, PaCO₂ ≥10 mmHg, Hb 2–25 g/dL, creatinine ≤15 mg/dL, albumin ≤6.5 g/dL, BP pair); never for glucose, BUN, lactate. Time-cue-less slash pairs yield no values and are reported as ambiguities. | **new** `src/lib/clinical-measurements.js`; `clinical-calculations.js` |
| **One identity scheme** `<analyte>[baseline][hemolyzed]` for every key spelling, incl. qualifiers after the unit (`potassium=7.1 mmol/L (hemolyzed)`), multi-word keys. | `clinical-calculations.js` (`canonicalKey`, `knownKey`, `parseClinicalDataDiagnostics`) |
| **Source grounding.** A value is source-confirmed if the extractor re-derived it **or** the same number is printed within a short window after an alias of its analyte in the original source text. Time-scoped identities are never grounded this way. An invented value remains unconfirmed. | `groundedInSource()`; `sourceText` passed from `analysis.js` and `solvecheck.js` |
| **Formula-scoped inputs and tiered gating.** Winter's expected value needs HCO₃ only; the PaCO₂ comparison note appears only when PaCO₂ is source-confirmed. Unconfirmed inputs of the anion-gap family (Na/Cl/HCO₃/albumin) stay **blocking**; unconfirmed inputs of other formulas withhold *that formula only* (`impact: "formula-withheld"`): no flag, no LOW tier, answer not cleared. Any independent-reading disagreement on a clinical input in an acid-base case now blocks synthesis (previously only Na/Cl/HCO₃/albumin). New auxiliary results (Hb decline, creatinine rise/ratio) demand corroboration only when the answer states them. | `clinical-calculations.js`, `analysis.js`, `solvecheck.js` |
| **Warning de-duplication.** One shared Arabic string for each warning class; banner lines de-duplicated on normalised text; the banner no longer repeats findings that the blocking body already lists; identical conflicts are collapsed in the audit. | `solvecheck.js`, `analysis.js`, `clinical-calculations.js` |
| **Shared approval state.** Solve-phase banner never shows a preliminary conclusion on clinical content (`clinicalPending`). Chat receives `clinicalBlocked` and a standing instruction not to supply a diagnosis/plan/dose/final value for a withheld case; the withheld text is not placed in its context. | `analysis.js`, `chat.js`, `ChatPanel.jsx`, `Editor.jsx` |
| **Data-driven pre-generation handoff.** Triggered when Na/Cl/HCO₃ are all present with pH <7.35 or HCO₃ <22, not only by keywords. | `buildPreGenerationCalculationHandoff` |
| **Performance.** Heading index built once; linear overlap resolution. Extraction of a 2.3 MB document: v3.66.0 38.5 s → v3.67.0 0.44 s. | `clinical-measurements.js`, `calc-claims.js` |
| **Test runner reliability.** `--test-force-exit` removed from `npm test` (§5.1). | `package.json` |
| **Dead code removed:** `labelledNumber`, `compareLabeled`. Version `3.67.0` (package.json, lock, service-worker cache). | — |

No clinical value is hard-coded for the audited patient; the generated/seeded tests (§3) exercise hundreds of other values.

## 3. Comparative evidence (same input, both versions)

`node --import ./tests/register.mjs scripts/repro-v3.66-failures.mjs`

| Check | v3.66.0 | v3.67.0 |
|---|---|---|
| 5 correct worked/prose formulas (AG, corrected AG, Winter) | **5 / 5 false positives** | 0 / 5 |
| Wrong MAP (71), wrong Hb decline | **missed** | detected |
| Wrong corrected AG | detected (wrong code) | detected (`reported-corrected-ag-mismatch`) |
| Wrong AG = 129 | detected | detected |
| Natural paragraph: current Na/HCO₃/PaCO₂ extracted | **no** (all tagged baseline) | yes, plus K hemolyzed/repeat, HR, Cr, Hb pairs |
| `Na 129,` / `sodium 129 (mmol/L)` | not read | read |

End-to-end (real `createAnalysis`, mocked model, audited case written as prose):

| Scenario | v3.66.0 | v3.67.0 |
|---|---|---|
| Model arithmetic **correct** | **Entire synthesis blocked**: conflicts `clinical-inputs-not-independently-confirmed` + `ag-without-inputs`; banner printed 4 lines incl. two different Arabic generics | Not blocked; no conflicts; MAP 59.33, AG 21, corrected AG 24.5, Winter 29, Hb decline 3.6 produced; no banner |
| Model reports AG = 129 | blocked | blocked once; analogies/memo/cards/items/patches/tricks all empty; banner lines empty; finding appears once in body |
| Source lacks PaCO₂ | AG/Winter withheld, whole case blocked | AG and Winter retained; not blocked |
| Model invents PaCO₂ = 55 vs source 30 | duplicate conflicts, `; ` artefacts, explanation still shown | single conflict, synthesis blocked |

Pre-generation handoff for the audited case: **empty in v3.66.0**; in v3.67.0 it carries all five reference values with worked formulas.

Generated test: 60 seeded random patients × 14 phrasing templates → 826 correct statements, 0 false positives; 708 deliberately perturbed results, 708 flagged (100 %). (It found one defect during development, a minus sign eaten as a separator, now fixed and pinned.)

## 4. Why this is not a case patch
All fixes are in shared contracts: claim grammar, measurement grammar, key identity, grounding, gating tier, warning identity, approval state. Cross-specialty tests (cardiology Fick/SVR, toxicology osmolal gap, PK/CRRT R₀, nephrology/critical-care extraction, Arabic) exercise the same code with unrelated data.

## 5. Other verified findings
1. **`npm test` under-reported.** `--test-force-exit` terminates the process before piped reporter output flushes; counts varied 508–529 on an unchanged tree. With the flag removed and a file reporter the count is deterministic (536 before, 580 after; 3/3 identical runs).
2. The previous reports' statement that the build "did not complete because vite is not installed" is environmental; `npm ci --ignore-scripts && npm run build` succeeds.

## 6. Remaining limitations (not fixed, or only partly)
1. **No live-model evaluation.** Pipeline tests use a mocked model. Behaviour with real Gemini output, other languages' phrasing, or truncated output is untested.
2. **Verification covers a fixed registry** (AG, corrected AG, Winter, MAP, Hb decline, creatinine rise/ratio, OG, SVR, CO, R₀). Other computed numbers (delta gap, CrCl, dosing, BMI…) in generated text are not independently checked.
3. **Unit assumption policy** (§2) is a judgement: Na/Cl/HCO₃/K without a unit are read as mmol/L (equal to mEq/L). Documented and tested, but a reviewer should confirm it is acceptable.
4. **Policy change needing clinical-safety review:** unconfirmed inputs of non-anion-gap formulas now withhold only that formula (with a visible notice) rather than blocking the case. The anion-gap family, ungrounded values and any independent-reading mismatch still block.
5. **Image sources:** the first lesson part starts in parallel with OCR, so for photographed cases its pre-generation handoff can still be empty; the final gate still verifies. Not changed (would alter task ordering).
6. **Chat gating is prompt-level**, not output-verified: it instructs the model and removes the withheld text from context, but chat replies are not run through the calculation audit.
7. **Source-grounding is a provenance check** (number near its label), not a transcription guarantee; time-scoped values are excluded from it.
8. **No UI rendering tests:** TrustPanel/Editor changes are one-line prop changes verified by the build and by data-level tests; no browser run was performed.
9. Extraction remains super-linear on pathological inputs elsewhere in the pipeline (not in the modules changed here).
10. Numeric tolerances in `calc-claims.js` (e.g. AG ±0.5, MAP ±1, Winter ±1) are engineering choices that accept display rounding.
