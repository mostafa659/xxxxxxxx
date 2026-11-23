# ClinixStudy v3.68.0 — Audit of a 10-task consultant case, root causes, remediation

Input: the adversarial multidisciplinary case (SLE, kidney transplant, APS, TMA) + the answer produced by v3.67.0 + the grading rubric.
The case is a **probe**, not the target: nothing below is coded for this patient.

## 1. Grading of the v3.67.0 answer (rubric supplied)
| Axis | Max | Score | Why |
|---|---:|---:|---|
| Unified diagnosis + CAPS analysis | 20 | 3 | Says "likely CAPS"; no criterion-by-criterion test (organs, <1 week, histology, 12-week aPL), no alternatives |
| TTP vs TMA differential | 15 | 2 | Four causes named in one sentence; no for/against/missing/discriminator for any |
| ADAMTS13 after FFP | 10 | 5 | Calls it "indeterminate" (right) but then invents a counterfactual "> 64 %", no pre-FFP sample, no ISTH sampling/treat-first logic |
| Anticoagulation interference | 15 | 2 | States as fact that POC INR is "falsely elevated" and venous INR "reflects true status"; ignores the fluconazole potentiation the case highlights; no chromogenic X, no anti-Xa |
| Transplant pharmacology | 10 | 4 | Interaction mentioned; "cease tacrolimus" unqualified; no transplant-team framing |
| Urgent plan / safety | 15 | 3 | One line; no BP, biopsy timing, transfusion, RRT, infection plan |
| Investigations + biopsy (Banff) | 10 | 0 | Absent |
| Error detection + citations | 5 | 1 | Four "traps" restated the case; a made-up mnemonic; zero citations |
| **Total** | **100** | **≈ 20** | 634 output tokens for a 10-task request |

Factual defects in the text: "ADAMTS13 > 64 % excludes TTP" (invented cut-off), "normal platelets + no hemolysis → isolated AMR rather than TMA" (nonsense counterfactual), "T-A-M-S" mnemonic (invented), empty "Mnemonic:" label, POC INR error stated as certain.

## 2. Verified root causes (each reproduced in code)
| # | Root cause | Evidence |
|---|---|---|
| RC-A | **The output guard never ran on the main explanation.** `PROSE_TASK` matched `lesson:chat/topic` only; the pipeline names its writers `lessonA/B/Bm/Bx/M/T/S/H`. The leak stripper, spelling repair and self-correction rewrite were dead code for the answer itself. This is why `One bullet: …` reached the screen. The old test pinned only names that already matched. | `PROSE_TASK.test("lessonA:balanced") === false` in v3.67.0 |
| RC-B | **No notion of a source-prescribed deliverable.** Every path treats the source as one exam item and fills the lesson template (decode English → basics → options → "if the question changed" → mnemonic). Numbered tasks, per-task items and limits were never read. | `SOLVE` output capped at "max 20 words" PREMISE; no task parser anywhere |
| RC-C | **Capacity mismatch.** Balanced mode = fast writer, thinking 0, ≈ 1,660 words for the whole answer, Flash-Lite as last fallback, after 57 s of 429/503 retries; nothing told the user the answer was thin. | `MODES.balanced`, run header |
| RC-D | **Template forces fabrication.** "If the question changed" and "memory tip" are mandatory sections; a weak writer fills them with invented facts. | `HEADINGS.vary`, 5 × mnemonic line |
| RC-E | **No verified reference layer for expert-level facts** (criteria, thresholds, interference direction); the model recalls them. | no anchor registry; `kb` has no TMA/APS/transplant entries |
| RC-F | **No audit of reasoning shape** (confounded negative → "excludes", artifact asserted as fact, single cause). Existing advisories are keyword-level (`dose`, `monitor`). | `auditClinicalQuality` |

## 3. What changed (all shared mechanisms)
| Change | Files |
|---|---|
| Guard covers the whole `lesson[A-Z]…` family; test extracts the names from source so drift cannot recur | `guard.js`, `tests/v368…` |
| **Task contract**: deterministic parser (Task/Part/المهمة N headings or a numbered "Required tasks" list), per-task items, word limits, global rules, complexity score; contiguous task grouping; lexical completeness audit; section merge for repairs; honest gap notice | **new** `taskcontract.js` |
| **Contract path** in `createAnalysis`: ONE strong silent ledger (facts, discordances, confounded tests, leading model, do-not-delay, unknowns, calculations) → one strong writer per ≤ 3 tasks, parallel (sequential on a small key) → audit → ONE repair → notice for anything still missing; weaker-model disclosure; goes through the same `trustPass` | `analysis.js`, `config.js` (`CONTRACT`), `prompts.js` (`buildContractLedgerPrompt`, `buildContractWriterPrompt`) |
| Writer prompt is not a lesson; carries the evidence-discipline rules (indeterminate-under-confounder, discordant data never resolved by assumption, classification ≠ mechanism, no reflex products, no invented numbers/citations, fact/inference/hypothesis labels) | `prompts.js` |
| **Verified anchors**: 9 entries (ISTH TTP guideline + GPS, PLASMIC, CAPS criteria, POC-INR in LA/APS, UFH monitoring with prolonged baseline aPTT, azole interactions, CNI-TMA, Banff AMR, complement TMA). Each says evidence type, source, check date, `verify` flag; physiology/inference lines are separated from source statements. Retrieved by trigger words only. | **new** `clinical-anchors.js` |
| **Reasoning-trap advisories** for every clinical answer (not only contracts) | **new** `reasoning-traps.js`, `analysis.js` |
| Lesson template: counterfactual section only for items with real options; mnemonic only if standard, never invented, never an empty label (net-zero tokens, budget test passes) | `prompts.js` |
| Medical-search grounding also attached to the contract ledger | `analysis.js` |

## 4. Evidence
`npm test`: **593 / 593** (580 + 13 new), 0 failed; `npm run build` OK.
New tests: guard family (names read from source), leaked-line stripping on a main writer, contract parsing (10-task case, order, 100-word limit, constraints, expert level), negative controls (MCQ, step lists, long single instruction are not contracts), Arabic-labelled contract, coverage audit, repair merge, anchors (type/source/no dosing; retrieval only when relevant), writer prompt shape, trap detectors (positive and negative), and three end-to-end runs of the real pipeline with a mocked model: all 10 tasks present with 1 ledger + 4 writers; one repair closes a gap without duplicate headings; a task that stays missing is reported.

## 5. Sources opened for this audit (2026-11-22)
ISTH TTP treatment guideline and GPS (J Thromb Haemost 2020;18:2496, 2503); Asherson 2003 and Cervera 2005 CAPS criteria/validation; POC-INR in aPL (Perry, Thromb Haemost 2005;94:1196; TH Open 2025 case reports; PMC9986099); UFH aPTT/anti-Xa case report (PMC13682851); Banff 2019/2022 AMR (Transpl Int 2022;35:10140; Banff 2022 report). Anchors marked `verify` were only partly confirmed (exact journal/year/volume) and tell the writer to label them so.

## 6. Limitations — read before trusting
1. **No live-model run.** Quality of the real Gemini output on this case was not measured; tests use a mocked model. The expected gain (coverage, structure, no template fabrication) comes from architecture, not from a measured score. Run the case again and re-grade with the rubric.
2. The coverage audit is **lexical**: it detects missing/thin/over-limit tasks, not wrong content. Reasoning-trap checks are narrow patterns, not clinical review.
3. Anchors are a small hand-written set; they cover this area, not medicine. Rule: every future audit finding becomes an anchor + a test.
4. The contract path costs more requests (1 + up to 4 + 1 repair, strong tier) and takes minutes; on a small free key writers run sequentially. Disable with `localStorage clinix.contract = "0"`.
5. Clinical safety/calculation gates can still withhold a contract answer; that behaviour is unchanged by design.
6. Not changed: Gemini 429/503 retry time (57 s in the run) — the app now discloses when a lighter model wrote a task, but cannot make Google available.
7. No UI run; no clinician review. Anchor statements about CAPS treatment and azole interactions are consensus/label-level and flagged as such.
