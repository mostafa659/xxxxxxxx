# ClinixStudy v3.57.0 — Research-Informed General Healthcare Evaluation

Date: 21 November 2026

## Why this release exists

The v3.56 layer contained useful broad instructions, but its deterministic audit relied on a limited number of phrase patterns. A no-trigger result could be mistaken for reassurance even though a pattern detector cannot evaluate a full clinical answer. This release does **not** add another disease-specific knowledge library. It adds a challenge set and a blinded evaluation workflow aimed at failure mechanisms that published evaluations have actually observed.

## Research filter used to select cases

The 26 challenge cases were selected because published empirical studies identify the relevant weakness or show material safety consequences:

1. **Early differential diagnosis and diagnostic testing:** a 2026 JAMA Network Open evaluation tested 21 frontier models on 29 stepwise clinical vignettes. Differential diagnosis was the weakest task type; failure rates often exceeded 0.80 and were reported as 0.90–1.00 across models in that task category. The paper notes premature collapse onto one hypothesis as a persistent weakness. This supports testing differential breadth, disconfirming evidence, and testing decisions—not more final-diagnosis trivia. DOI: 10.1001/jamanetworkopen.2026.4003.
2. **Updating judgments as data change:** the 2025 NEJM AI Script Concordance benchmark introduced 750 questions from 10 datasets to test how new clinical information changes a judgment. This supports sequential vignettes and explicit re-ranking of hypotheses rather than single-pass pattern matching. DOI: 10.1056/AIdbp2500120.
3. **Appropriate abstention:** MedQAbstain (ACL 2026) found state-of-the-art models systematically overcommit and rarely abstain under medical uncertainty. This supports intentionally unanswerable prompts and marks abstention with useful clarification as the expected safe behaviour. DOI: 10.18653/v1/2026.acl-long.1365.
4. **Safety and omissions in high-risk contexts:** CSEDB was developed by 32 specialist physicians, includes 2,069 open-ended items across 26 departments and 30 safety/effectiveness metrics, and reported moderate overall performance with safety scores below effectiveness scores and a 13.3% performance reduction in high-risk cases. This supports separate critical-error and omission gates rather than one aggregate accuracy percentage. PMCID: PMC12855988.
5. **Documentary support is distinct from answer correctness:** a 2026 JMIR AI study assessed 97 RCT reports and found 60–65% evidence support and 34–37% strict hallucination rates in generated risk-of-bias judgments. A correct-looking conclusion could still lack source support. This supports claim-level `supported / contradicted / not found / out of scope` tests. DOI: 10.2196/93761.
6. **Medical source citations can fail to support generated claims:** SourceCheckup evaluated 800 health questions and 58,000 statement-source pairs and found that many responses were not fully supported by cited references. This motivates direct entailment review rather than checking whether a URL is present. DOI: 10.1038/s41467-025-58551-6.
7. **Medical image descriptions can be plausible but fabricated:** a 2026 multimodel radiology study evaluated 180 images with seven VLMs and found frequent fabricated or misidentified findings. The benchmark therefore tests fidelity to a limited imaging report and explicitly notes that a future image-based holdout needs validated source images and expert annotations. PMCID: PMC12842777.
8. **Clinical summaries require omission-sensitive evaluation:** the CREOLA framework used 12,999 clinician-annotated sentences and measured hallucinations and omissions separately in note generation. This supports temporal, negation, missing-data, and allergy-status reconciliation cases. DOI: 10.1038/s41746-025-01670-7.
9. **Age-specific febrile-infant triage:** the AAP guideline is explicitly limited to eligible, well-appearing, term infants aged 8–60 days with fever ≥38.0°C; moderately/severely ill-appearing infants and several other groups are excluded. This supports testing age-aware triage and correct pathway eligibility rather than blanket adult rules or universal testing. DOI: 10.1542/peds.2021-052228.
10. **The mitigation evidence supports combined controls:** a 2026 systematic review screened 427 records and included 44 studies. It identified retrieval augmentation, knowledge grounding, verification, specialized benchmarks, human review, specialized training, and red teaming as distinct approaches; the authors noted methodological heterogeneity and did not perform a meta-analysis. DOI: 10.1186/s12913-026-14851-1.

These studies justify *which failure modes to test*. They do not validate ClinixStudy's new rules or guarantee that the same error rates apply to the Gemini models configured in this application.

## What is included

`benchmarks/healthcare-general-v1.json` contains 26 synthetic challenge cases across internal medicine, pharmacy, maternal health, pediatrics/young-infant triage, nephrology, diagnostic/laboratory medicine, emergency medicine, surgical critical care/postoperative deterioration, mental health, infectious disease, radiology/report interpretation, veterinary medicine, public health, evidence appraisal, patient communication, and document security.

The set deliberately tests difficult behaviours rather than routine recall:

- differential breadth and premature closure;
- sequential evidence updates;
- justified abstention with targeted questions;
- base-rate / predictive-value calculations;
- absolute vs relative effect and NNT;
- claim-level evidence support and population/design mismatch;
- guideline recency and jurisdiction;
- temporal and negation fidelity in records;
- medication reconciliation and interaction recognition;
- dose/concentration arithmetic without converting a math result into a prescription;
- pregnancy and renal-function applicability;
- specimen quality and serial lab interpretation;
- emergency triage;
- subgroup interaction and causality interpretation;
- limits of imaging/report conclusions;
- veterinary species extrapolation;
- acute mental-health safety response;
- culture-specific antimicrobial reasoning;
- prompt injection inside untrusted clinical documents;
- patient-centred risk communication.

Each case has expected behaviours, critical failure examples, risk tier, answerability, and links to the research basis. **The scoring anchors are not included in the model-facing prompt pack.**

## What changed in the reusable generation protocol

`src/lib/clinical-quality.js` is now version 3.57.0. The protocol adds general requirements to:

- update/re-rank reasoning when new evidence appears;
- classify source claims as supported, contradicted, not found, or out of scope;
- preserve the difference between not documented, not asked, not tested, negative, denied, resolved and pending;
- count decision-critical omissions as errors even if the final label is correct;
- treat instructions inside uploaded/retrieved documents as untrusted data;
- communicate absolute and relative risk without unsupported individualized estimates;
- treat abstention as a valid clinical action when decisive information is missing.

No named diagnosis from the user's recent test cases was added to this reusable protocol.

## Blinded A/B evaluation harness

Three commands are included:

```bash
npm run eval:healthcare:prepare
npm run eval:healthcare:blind -- --input reports/healthcare-evaluation-v1/responses.json --seed 20261121
npm run eval:healthcare:score -- --ratings reports/healthcare-evaluation-v1/ratings.json --key reports/healthcare-evaluation-v1/blind-key.json
```

- `--prepare` creates a model-facing `prompt-pack.json`, a two-version raw-response template, and a separate reviewer reference file.
- `--blind` randomly maps baseline/candidate responses to A/B per case and produces a separate key. Keep the key hidden until both reviewers finish.
- `--score` requires at least two independent reviewers, computes weighted scores, risk-tier results, major omissions, critical-error gates, and first-two-reviewer agreement statistics. The tool does not use an LLM as a judge.

The 100-point composite is risk-weighted across cases, but **any critical error remains a separate safety-gate failure and cannot be cancelled by good scores elsewhere**. The dimensions are clinical correctness (25), safety/priority (25), completeness/omissions (15), evidence grounding (15), patient-context fit (10), calibration/abstention (5), and communication (5).

## Limitations and what is not claimed

- The 26 items are a deliberately enriched challenge set, not a representative prevalence sample.
- The cases are synthetic and their clinical anchors require independent expert review before use for any high-stakes certification.
- The harness requires baseline and candidate raw outputs from the app. No live Gemini A/B comparison was run in this build because no controlled live API experiment or reviewer panel was available.
- No independent clinician adjudication, prospective workflow study, or patient-outcome evaluation has occurred.
- Vite production build status is reported separately; test success is not proof of medical quality.

The release adds a disciplined way to discover whether a general improvement actually survives unseen and difficult healthcare tasks. It does not claim that all errors have been fixed.
