# ClinixStudy v3.56.0 — General Healthcare Answer-Quality Foundation

## Purpose

This release changes the centre of development from case-specific regression patches to a reusable, cross-specialty answer-quality layer. It is intended to apply to health questions across medicine, nursing, pharmacy, dentistry, surgery, diagnostics, laboratory medicine, mental health, maternal/child health, public health, rehabilitation and veterinary health. It is not a diagnostic engine, prescription authority, clinical device clearance, or guarantee of correctness.

## Research basis (reviewed 21 November 2026)

1. **Basu & Huynh, BMC Health Services Research (6 June 2026), systematic review of healthcare hallucination mitigation.** The review screened 427 records and included 44 empirical studies. It groups mitigation into retrieval-augmented generation (RAG), knowledge-graph integration, self-reflection/verification, specialized evaluation metrics, human-in-the-loop review, specialized training, and red teaming. It emphasizes combinations rather than one single control. Reported effect sizes vary across designs and outcomes; they must not be taken as a guaranteed performance improvement for ClinixStudy. DOI: https://doi.org/10.1186/s12913-026-14851-1
2. **WHO, Ethics and governance of artificial intelligence for health: guidance on large multi-modal models (25 March 2025).** Used as a governance reference for oversight, stakeholder responsibility, risk management and ongoing evaluation. https://www.who.int/publications/i/item/9789240084759
3. **FDA, Clinical Decision Support Software final guidance (29 January 2026).** Relevant to US regulatory context. The FDA describes the importance of intended use/population, required medical inputs and data quality, the method and validation basis, and patient-specific knowns/unknowns so a healthcare professional can independently review the basis of a recommendation. This release does not claim FDA clearance or that ClinixStudy qualifies as non-device CDS. https://www.fda.gov/regulatory-information/search-fda-guidance-documents/clinical-decision-support-software
4. **DECIDE-AI reporting guideline (BMJ 2022).** The 27-item guideline covers early live clinical evaluation, clinical utility, safety/error reporting, human factors, and preparation for larger evaluation. It informs the future evaluation plan, not a claim that ClinixStudy has completed that evaluation. https://www.bmj.com/content/377/bmj-2022-070904.long

## General failure classes targeted

- Anchoring and confirmation bias: a prompt rule previously told the model to decide first and make every sentence agree with that answer. That instruction has been removed. The replacement requires comparing plausible alternatives and actively searching for disconfirming facts before committing.
- Missing or misclassified healthcare intent: routing used limited domain signals. Detection and intent classification have been broadened across clinical, diagnostic, pharmacological, mental-health, dental, public-health, maternal/child and veterinary terminology, including Arabic terms.
- Unsupported currentness: health answer-writing stages now receive one live Google Search grounding attempt per analysis when the platform supports it. Search fallback is explicit: the model is told not to imply that it searched if the search tool is unavailable. Returned source links/queries are surfaced; absence of usable links is disclosed.
- Source over-trust: a returned search link is not treated as proof that it supports every proposition. The prompt requires claim-specific support, dates, jurisdiction, population and evidence quality; the UI note says retrieved links need checking against the actual text.
- Context loss: the general protocol requires preserving current versus historical/target/reference values, specimen/site/device/time, units, age/life stage, pregnancy/lactation, species, comorbidities, allergies, medications, renal/hepatic function, jurisdiction and goals/preferences where relevant.
- Diagnostic overclaim: the protocol requires criteria actually met, unknown criteria, credible alternatives, pre-test probability and false-positive/false-negative limitations; a biomarker, scan, mutation or mechanism is not automatically a diagnosis or causal proof.
- Unsafe medication instructions: the protocol calls for indication and medication reconciliation, allergies, interactions, contraindications, special populations, organ function, dose units/route/frequency/duration, monitoring and restart/withdrawal risks.
- Calculation errors: formula, substitutions, units, conversions, rounding and plausibility checks are required; missing inputs are not fabricated.
- Unsafe sequencing: actions must be ordered by urgency, contraindications, bleeding/thrombosis, access/anatomy, reversibility, time-to-benefit, harms of delay, monitoring and stop/escalation criteria.
- False confidence: the system must distinguish the best option among exam choices from a complete real-world plan, and it must not claim 100% certainty or “only safe option” without evidence that warrants it.

## Implemented in code

### A. Reusable protocol

`src/lib/clinical-quality.js` exports `CLINICAL_QUALITY_INSTRUCTION`, an 11-part cross-specialty protocol injected into health answer-writing / solve stages. It is not limited to any named disease or case.

### B. Healthcare routing and intent

`isHealthDomainContext()` and `classifyHealthIntent()` are now shared by the general quality layer and the existing clinical safety router. They identify broad health questions and distinguish educational/exam tasks, patient-care/urgent tasks, medication/dose tasks, evidence reviews, calculations/test interpretation and image/test interpretation. This is heuristic routing, not a complete ontology; false negatives remain possible.

### C. Grounded evidence attempt

`analysis.js` now requests Google Search grounding for one main health answer stage per analysis (deep solve stage where present; otherwise the main answer-writing stage). It collects the actual `groundingMetadata` returned by Gemini, records whether search was used, and lists the resulting links and queries. If search is unavailable or returns no usable source links, the output says so rather than pretending to have verified current evidence.

This is a **single search-grounding pass**, not a full medical RAG pipeline. It does not automatically retrieve and reconcile every relevant guideline, drug monograph or primary paper, nor does it provide a verified claim-to-source entailment proof for each sentence.

### D. General answer-quality audit

`auditClinicalQuality()` adds conservative advisories for:
- absolute/guarantee language;
- current guideline/approval claims without usable source links;
- diagnostic certainty inferred from a single test/marker;
- dose instructions missing route or frequency/duration;
- absent visible medication-safety screening;
- potential polypharmacy interaction omissions;
- special-population applicability;
- absent visible risk/benefit/monitoring/reassessment trade-offs;
- possible loss of baseline/current/target/reference/sample identity.

These are **advisories**, not hard blocks. The audit is a finite pattern detector: no advisory does not prove correctness. Case-specific hard checks remain separate and should not grow into an ever-expanding patch-list as the main strategy.

### E. Removed anti-verification wording

`FACT_RULE` no longer tells the model to decide first, never change its mind, or force every sentence to support an early choice. It now requires disconfirmation, revision when warranted, and separation of fact, assumption, inference and recommendation.

## Test and build status

- Full automated suite: **495/495 passed** on 21 November 2026.
- New generic tests: healthcare-domain coverage, intent classification, anti-anchoring instructions, diagnostic overclaim advisories, currentness/source checks, incomplete dose instructions, special-population checks, source transparency, and an end-to-end integration test showing that a health answer stage carries one Google Search grounding request and exposes returned source metadata.
- These tests include mocked Gemini/Search responses. They prove code-path behavior and regression properties, **not** real-world medical accuracy or live-source quality.
- `npm run build` was attempted and did not start: `vite: not found`. `node_modules` is absent. An offline dependency install was attempted and failed because an npm package tarball (`zip-stream@4.1.1`) is not present in the local cache. No production build is claimed.
- No live Gemini A/B comparison, clinician adjudication, prospective study, or patient-outcome evaluation was performed. No 100% accuracy claim is made.

## What must happen before any clinical deployment claim

1. Install dependencies and complete reproducible production build on the intended CI environment.
2. Build a cross-specialty, externally curated evaluation set with separate strata for general information, diagnosis, medication, urgent triage, calculations, imaging/lab interpretation, pregnancy, paediatrics, older adults, renal/hepatic impairment and veterinary use.
3. Use independent clinician adjudication and report error severity, omissions, unsupported claims, medication harm, demographic subgroup performance, calibration, refusal quality, and inter-rater disagreement.
4. Perform blinded A/B tests against v3.55.0 with identical prompts, models, temperature/settings and search availability; preserve raw responses and source snapshots.
5. Run red-team tests for missing data, misleading images, conflicting time points, unit errors, fake citations, prompt injection in source documents, rare diseases, guideline conflicts and adversarial phrasing.
6. Conduct prospective workflow/human-factors evaluation before any patient-facing or clinician decision-support deployment, following appropriate governance and regulatory requirements.

## Release statement

v3.56.0 is a **general healthcare answer-quality foundation and engineering regression release**, not a clinically validated product. It adds reusable cross-specialty safeguards and evidence-grounding behavior, but does not eliminate model hallucinations or replace professional judgement.
