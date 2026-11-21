# ClinixStudy v3.58.0 — Audit of the supplied baseline/candidate responses

## Executive finding

The uploaded `responses.json` contains 26 baseline and 26 candidate strings, but it is **not a valid controlled clinical A/B dataset**. It has no benchmark version, per-prompt hashes, model/version identifiers, matched generation/search settings, completion states, or independent reviewer ratings. Four candidate responses are mapped to the wrong benchmark cases. Four candidate strings are visibly partial: they contain only the opening/teaching portion and omit the reasoning and final-answer sections present in the baseline. Therefore a weighted clinical-quality score or a defensible claim of improvement cannot be calculated from this file.

## Objective comparison of the supplied text

| Measure | Baseline | Candidate | Interpretation |
|---|---:|---:|---|
| Responses supplied | 26/26 | 26/26 | All IDs are present, but presence alone did not guarantee correct mapping or completion |
| Total characters | 140,906 | 133,963 | Candidate is 4.9% shorter; length is not quality |
| Mean characters/response | 5,419.5 | 5,152.4 | Descriptive only |
| Median characters/response | 5,046.5 | 5,011.5 | Similar central length |
| Responses with a reasoning/steps section | 26/26 | 22/26 | Candidate has 4 visibly incomplete responses |
| Responses with a final-answer section | 26/26 | 22/26 | Candidate has 4 visibly incomplete responses |
| Cross-question memory links | 0 | 9 | Candidate was not context-isolated |

The four visibly incomplete candidate entries are HQA-021, HQA-022, HQA-025 and HQA-026. Each is under 3,000 characters and lacks the final answer and step-by-step sections. After mapping the candidate content to its actual prompt, the same four incomplete outputs remain.

## Case-to-response integrity failures

The candidate text is keyed to the wrong case IDs in two adjacent pairs:

- Candidate HQA-023 contains the shared-decision-making answer; candidate HQA-024 contains the prompt-injection answer.
- Candidate HQA-025 contains the young-infant fever answer; candidate HQA-026 contains the postoperative deterioration answer.

The content-anchor audit found 4 candidate alignment failures before manual reassignment and 0 such failures after diagnostic reassignment. This reassignment is not a substitute for prompt hashes or original run metadata. The supplied data still fails official A/B eligibility checks.

## Observed answer-quality problems that remain

These are first-pass textual findings, not clinician-adjudicated scores:

1. **Wrong task format / invented MCQ structure:** open-ended requests (including medication-identification and other safety prompts) are answered with fabricated A/B/C choices and exam sections. This is a task-classification and prompt-template defect, not a missing medical fact.
2. **Antimicrobial susceptibility overreach (HQA-022):** the answer describes a susceptible isolate as if it makes Drug B the preferred/final treatment, while the clinical infection site, infection-vs-colonization status, drug exposure, patient-specific contraindications and other decision inputs still matter. It lists some caveats but still overstates the conclusion.
3. **Evidence-scope classification (HQA-006):** populations excluded from a trial are described as “contradicted” rather than being classified as outside the study's evidence scope, where that is the correct relation. “Not studied,” “contradicted,” and “not reported” must remain distinct.
4. **Statistical overclaim (HQA-017):** the candidate says a hypothetical interaction p-value of 0.01 “proves” a true subgroup difference. Statistical significance is evidence against a null model under assumptions, not proof; interpretation also needs effect size, confidence intervals, pre-specification and multiplicity.
5. **Outdated pregnancy-labeling framework (HQA-013):** the response refers to FDA pregnancy letter categories as a current reference approach. FDA removed A/B/C/D/X categories under the Pregnancy and Lactation Labeling Rule (PLLR); current prescription labels use narrative risk summaries, clinical considerations and data. See FDA sources below.
6. **Unsupported extra patient-like value (HQA-014):** the answer introduces a creatinine value of 3 mg/dL that is not in the supplied case and does not consistently label it as a hypothetical example.
7. **Simplified biomarker explanation (HQA-001):** D-dimer is described in a way that can imply it directly demonstrates a recent clot. It is nonspecific and must be interpreted with pre-test probability and the appropriate diagnostic pathway.
8. **Incomplete outputs:** the four candidate partial responses omit the final decision/action. In a clinical or emergency case, an explanatory opening without the action can be a major omission. The app's previous failure path could surface partial text without an unmistakable in-answer incomplete marker.
9. **Cross-case context leakage:** 9 candidate cross-question references appear in the answer strings. This contaminates a self-contained benchmark and can anchor the response to an earlier case.

## Root causes

- A single exam-oriented prompt template was applied to open clinical questions, source-only tasks and direct patient-care prompts.
- Fixed instructions demanded option-by-option analysis, answer letters, “if the question changed” hypotheticals and memory tricks even when those structures were not present or requested.
- Saved-question history was appended automatically, allowing previous cases to influence nominally independent tasks.
- The multi-part generation pipeline could fail in a later section and expose the completed first section as partial content. The response dataset did not preserve an explicit final-completion state.
- The evaluation harness matched strings by case ID only. It did not bind responses to exact prompt hashes, benchmark version, model/configuration metadata or completion status, and it did not check semantic case alignment.
- The benchmark has only 26 synthetic challenge cases; even a clean result would not estimate performance across all healthcare tasks or patient populations.

## Changes implemented in v3.58.0

1. **Task-adaptive output rules:** prompts now instruct the model to identify exam vs open question vs real patient-care vs source-only vs calculation tasks. No options means no fabricated options or answer letters. Real care/emergency requests must lead with action and urgency.
2. **History links are opt-in:** prior saved-question references are omitted unless the user explicitly requests links/comparisons to earlier items.
3. **Partial-output warning:** when the multi-part generation path fails, any surfaced partial answer now carries an explicit “answer incomplete; do not rely on it as final” marker.
4. **More general evidence safeguards:** added explicit interpretation of p-values/subgroup interactions, distinction between effect size and proof, checking eligibility/exclusions and retired frameworks, and a warning not to choose an antimicrobial from “susceptible” alone.
5. **Evaluation integrity:** benchmark version 1.1.0; prompt SHA-256 hashes; content-alignment anchors for known swapped pairs; required controlled-run metadata; explicit per-case completion status; and a pre-blinding audit. The harness now refuses to score missing, mismatched, unverified or incomplete response sets.
6. **Human review remains mandatory:** two independent reviewers are required; critical errors and major omissions remain separate safety gates. An automated judge or a long answer cannot replace clinician adjudication.

## Why no clinical A/B score is reported

The scoring pipeline correctly requires two independent blinded reviewers. No reviewer ratings were supplied. Also, the response file lacks matched model and generation metadata and has incomplete/misaligned records. Assigning numeric clinical scores from an unblinded LLM self-review would create false precision and violate the evaluation design. The valid numeric result from the current upload is therefore **not available**. The objective structural metrics above are reported separately and must not be interpreted as clinical accuracy.

## FDA pregnancy-labeling source

- FDA, *Questions and Answers on the Pregnancy and Lactation Labeling Rule*: explains why letter categories were removed and why they were considered overly simplistic: https://www.fda.gov/drugs/labeling-information-drug-products/questions-and-answers-pregnancy-and-lactation-labeling-rule
- FDA, *Pregnancy and Lactation Labeling Resources*: confirms the PLLR removes categories A, B, C, D and X: https://www.fda.gov/drugs/labeling-information-drug-products/pregnancy-and-lactation-labeling-resources

## Verification and limitations

- `npm test`: **509 passed, 0 failed**.
- `npm run eval:healthcare:prepare`: successful; generated benchmark v1.1.0 prompt pack, response template, reviewer reference and ratings template.
- `npm run build`: **not completed** because `vite` is not installed in the current environment (`sh: 1: vite: not found`).
- No live Gemini A/B run was performed in this turn, and no clinicians rated the supplied answers. This release is source/test verified, not clinically validated or production-built.
