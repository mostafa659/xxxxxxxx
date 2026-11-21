# ClinixStudy — Public Evidence Audit of Medical LLM Failure Modes (2026-11-20)

## 1. Scope and limits

This is a structured scoping audit of publicly available peer-reviewed studies, systematic reviews, benchmark papers, and official evidence-appraisal guidance. It is **not** an exhaustive audit of every medical answer generated worldwide. No public repository contains every private model conversation, API output, proprietary benchmark, or institution-specific deployment. Some systems cannot be queried reproducibly without paid accounts, API access, or permission. Model versions and search/tool settings also change over time.

The audit therefore uses the strongest accessible evidence classes:

1. Independent comparative clinical evaluations that include frontier models and real physician queries.
2. Multi-source benchmarks built from systematic reviews and clinical guidelines.
3. Reviews of published medical LLM evaluation studies and hallucination-mitigation research.
4. Official evidence-appraisal guidance used to convert recurring failures into defensible knowledge constraints.
5. Previously observed ClinixStudy error cases, used as regression examples rather than as the sole basis for the library.

The research snapshot is dated 20 November 2026. Findings are task- and version-specific; they are not a permanent league table of models.

## 2. What the public evidence shows

### 2.1 High exam performance does not establish clinical reliability

A June 2026 *Nature Medicine* independent comparison tested GPT-5.2, Gemini 3.1 Pro Preview, and Claude Opus 4.6 against 500 MedQA questions, 500 HealthBench items, and 100 de-identified real clinical queries previously submitted by physicians. Twelve clinicians conducted blinded ratings of the real-query outputs.

Gemini 3.1 Pro scored 97.4% on the 500 MedQA questions (95% CI 95.6–98.5%). That exam score did not replace the separate real-query evaluation: the latter measured clinical correctness, completeness, safety/harm avoidance, and clarity. In that 100-query sample, Gemini's aggregate clinician rating was 3.62/4. The study also documented incomplete clinical content and safety-critical omissions in some systems, while finding no statistically significant between-model differences in its binary harm or hallucination flags. The authors caution that benchmark leakage, limited samples, hidden prompts/tools, and the fast-moving model landscape constrain interpretation.

**Design consequence:** ClinixStudy must not use board-style accuracy as a proxy for clinical completeness, source fidelity, safe uncertainty handling, or omission risk.

### 2.2 Evidence synthesis is a distinct and difficult task

A March 2026 *Patterns* benchmark assembled more than 20,000 clinical question–answer pairs derived from more than 8,000 systematic reviews and clinical guidelines. Its abstract reports accuracy of about 90% on structured guidelines, about 70% on narrative sources, and 50–60% on systematic reviews. The reported detailed comparison of GPT-4o-mini and GPT-5 on systematic-review tasks showed:

- Overall answer accuracy: 60.3% and 67.8%.
- Discrepancy detection: 57.0% and 59.1%.
- Evidence-quality classification: 32.1% and 38.8%.
- The “No evidence” answer class had F1 scores of 0.18 and 0.33, respectively.

Reviewers also identified recurring failures: anchoring on one sentence instead of the abstract as a whole, under-communicating low or very-low certainty, and missing statistical significance when an odds-ratio confidence interval excluded 1.0 but a p-value was not printed.

**Design consequence:** Evidence appraisal requires separate treatment from ordinary medical fact retrieval. The fifth expansion adds both evidence-appraisal knowledge and a query-triggered prompt policy.

### 2.3 Published medical-LLM studies do not equal real-world clinical validation

A March 2026 LLM-assisted systematic review screened 4,609 peer-reviewed clinical-medicine studies published from January 2022 through September 2025. It estimated 1,048 studies used real-world patient data, and only 19 were prospective randomized trials. It estimated 1,857 simulated/synthetic scenarios and 1,704 exam-style tasks. ChatGPT/OpenAI models made up 65.7% of evaluated systems; Gemini/Bard was a distant second at 13.1%.

This review is itself LLM-assisted and has its own screening, tiering, and classification limitations. It is evidence about the composition of the published research landscape, not proof that every included result is error-free or that every model version was evaluated equally.

**Design consequence:** The project must distinguish exam evidence, synthetic simulation, retrospective real-patient evaluation, and prospective deployment. It must not say that a model is clinically validated merely because it passed an exam benchmark.

### 2.4 Hallucination mitigation is layered, not a single RAG switch

A 2026 systematic review of healthcare-AI hallucination mitigation included 44 studies from 427 initially retrieved records. It described seven non-mutually-exclusive strategy families: retrieval-augmented generation, knowledge graphs, self-reflection/verification, specialized benchmarks, human-in-the-loop review, specialized training, and red teaming. The authors did not pool a meta-analysis because study methods and outcomes were heterogeneous; methodological quality also varied, and some preprints/conference abstracts were included.

The review supports a layered architecture but does not establish that any single method eliminates hallucinations. Retrieval may be unhelpful when irrelevant evidence is retrieved or poorly integrated; human review can disagree and has scaling costs.

**Design consequence:** ClinixStudy should combine carefully scoped retrieval, explicit source/claim grounding, regression benchmarks, selective human approval, and adversarial tests. More content alone is not a mitigation strategy.

## 3. Consolidated AI medical error taxonomy

| Failure family | Observable pattern | ClinixStudy response |
|---|---|---|
| Exam-to-clinic transfer | High multiple-choice scores mistaken for clinical readiness | Keep exam, real-case correctness, completeness, safety, and clarity metrics separate |
| Evidence-state collapse | “No evidence” turned into “evidence of no effect” | Preserve uncertainty; distinguish absence of evidence from evidence that rules out a clinically important effect |
| Single-fragment anchoring | One sentence/result outweighs methods, other outcomes, limitations, or conclusion | Require whole-source synthesis for evidence-review queries |
| Certainty inflation | Low/very-low evidence described as established | Preserve outcome-specific certainty and the source's limitations |
| Statistical interpretation errors | Ratio null values misunderstood; confidence intervals ignored when p is absent; p alone used as clinical meaning | Use measure-specific null values; interpret the correct CI and separate effect size, precision, statistical evidence, and clinical importance |
| Fabricated patient facts | Unstated labs, symptoms, imaging, history, or diagnoses are silently added | Keep source literature separate from patient observations; calculate only from stated inputs |
| Population/species/jurisdiction leakage | Human thresholds applied to animals, or local recommendations generalized globally | Require matching species, population, age, geography, assay, or jurisdiction |
| Incomplete care-context answer | Correct isolated fact but missing a safety-critical condition or next decision boundary | Test completeness and omissions, not just factual correctness |
| Retrieval contamination | Irrelevant retrieved material changes or distracts the answer | Strict applicability and relevance gates; exclude drafts and mismatched scopes |

## 4. Fifth expansion — 34 new focused entries

The fifth batch adds 34 distinct entries, all draft-only:

- **10 neonatal early-onset sepsis (EOS) entries:** a Swiss national guideline pathway, serial examination, asymptomatic-risk boundaries, immediate post-elective-caesarean respiratory distress, unexplained prematurity, pre-antibiotic culture volume, negative-culture reassessment, single-biomarker limits, non-zero residual risk at birth, and lumbar-puncture indications. These entries require an explicit Switzerland jurisdiction and neonatal context. They must not be transferred to another country's protocol without checking that country's current guidance.
- **11 diabetic-foot infection/osteomyelitis entries:** geographic and resistance heterogeneity, avoiding universal empirical Pseudomonas coverage, combined clinical/biochemical/imaging diagnosis, bone-biopsy limitation, deep-culture/imaging context, source control, culture-directed therapy, off-loading, histology/culture discordance, and different roles of histopathology and microbiology. Quantitative concordance/sensitivity figures remain tied to the small review population and must not be treated as universal diagnostic performance.
- **6 evidence-appraisal entries:** “no evidence” vs. negative evidence classification, odds-ratio CI interpretation, whole-abstract synthesis, preservation of low certainty, statistical vs. clinical significance, and distinction between effect estimate, effect size, confidence interval, and p-value.
- **7 GRADE entries:** outcome-specific certainty; five downgrading domains; defined upgrading criteria for non-randomized evidence; no routine RCT upgrading under those observational criteria; the conditional ROBINS-I starting-level exception; critical-outcome based overall certainty; and the lowest-certainty critical-outcome rule in the ACIP GRADE handbook.

Sources used for bundled entries are the 2024 Swiss EOS guideline, two open-access diabetic-foot reviews (2024 and 2026), the 2026 *Patterns* evidence-QA benchmark, the 2026 biomedical-statistics framework, and the CDC ACIP GRADE handbook chapters 7 and 10. The exact cited passages and declared licences are stored in the manifest. The builder verifies exact quotations and licence metadata mechanically; it cannot prove the medical claim is clinically correct. Human approval remains mandatory.

## 5. Material deliberately not bundled

The earlier toluene/hippurate/urine-osmolal-gap case remains a regression-only target in this release. Some of the detailed sources reviewed for that narrow topic are under non-commercial/no-derivatives terms that the project's bundling policy rejects. This avoids silently redistributing restricted text or turning a partial summary into an unsafe clinical rule. The related regression tests should check that the model does not invent missing urine/serum values, mislabel an osmolal gap as a direct ammonium measurement, or infer a diagnosis from incomplete inputs.

The no-evidence/no-effect distinction is included as a model-error guard. A related BMJ explanatory article was reviewed but is not bundled because its CC BY-NC licence is not approved for this project's bundle. The app's manifest contains only sources whose declared licence passes the current bundling policy.

## 6. Release and validation status

- New candidates: 34.
- Strict build: 34 accepted, 0 rejected.
- New records shipped: 34, all `Draft`.
- Total loaded specialist entries: 80 (46 previous + 34 fifth expansion).
- Student retrieval: unapproved draft records are excluded by the existing retrieval gate.
- The prompt adds evidence-appraisal rules only for queries recognized as review/guideline/statistics/evidence-synthesis tasks.
- Regression coverage tests Swiss jurisdiction and neonatal context, adult-only DFO population context, draft exclusion, GRADE retrieval, and preservation of the no-fabrication rules.

Automated tests establish schema, source-quotation provenance, routing, scope gates, and regression behavior. They do **not** replace expert medical review, an external production build, or a live benchmark against Gemini/other models. No live API benchmark was run in this release; a newly created key controlled by the project owner is required for that, and the previously exposed key must never be reused.

## 7. Primary public sources

1. Vishwanath K, et al. *General-purpose large language models outperform specialized clinical AI tools on medical benchmarks.* Nature Medicine. Published 12 June 2026. https://www.nature.com/articles/s41591-026-04431-5
2. Wang C, Chen Y. *Evaluating large language models for evidence-based clinical question answering.* Patterns. Published 30 March 2026. https://pmc.ncbi.nlm.nih.gov/articles/PMC13161685/
3. Chen SF, et al. *LLM-assisted systematic review of large language models in clinical medicine.* Nature Medicine. Published 3 March 2026. https://pmc.ncbi.nlm.nih.gov/articles/PMC13004689/
4. *Mitigating hallucinations in healthcare AI: a systematic review of evidence-based strategies.* BMC Health Services Research. 2026. https://link.springer.com/article/10.1186/s12913-026-14851-1
5. Stocker M, et al. *Management of neonates at risk of early onset sepsis: a probability-based approach and recent literature appraisal.* European Journal of Pediatrics. 2024. https://link.springer.com/article/10.1007/s00431-024-05811-0
6. Maity S, et al. *A systematic review of diabetic foot infections: pathogenesis, diagnosis, and management strategies.* Frontiers in Microbiology. 2024. https://pmc.ncbi.nlm.nih.gov/articles/PMC11333436/
7. Kadiri L, et al. *Concordance of Microbiological and Histopathological Examination of Bone Biopsies in Diagnosing Diabetic Foot Osteomyelitis.* Journal of Foot and Ankle Research. 2026. https://pmc.ncbi.nlm.nih.gov/articles/PMC13632924/
8. Mondal H, et al. *Effect Estimates, Effect Sizes, Confidence Intervals, and P-values: A Framework for Reporting and Interpreting Biomedical Research.* Cureus. 2026. https://pmc.ncbi.nlm.nih.gov/articles/PMC13676293/
9. U.S. CDC. *ACIP GRADE Handbook*, Chapters 7 and 10. 2024. https://www.cdc.gov/acip-grade-handbook/hcp/chapter-7-grade-criteria-determining-certainty-of-evidence/index.html and https://www.cdc.gov/acip-grade-handbook/hcp/chapter-10-overall-certainty-of-evidence/index.html
