## v3.58.0 — General Healthcare Reliability and Evaluation Integrity

This release uses the supplied 26-case baseline/candidate response file to find real failure modes and repair the causes in the prompt, generation and evaluation pipeline.

- **Observed A/B defects:** the candidate file has four case-ID swaps (HQA-023/024 and HQA-025/026), four incomplete outputs (HQA-021/022/025/026), nine cross-question memory links, and no controlled-run metadata or independent ratings. No clinical quality score is fabricated.
- **Task-adaptive output:** no invented options or answer letters when the input is open-ended; direct clinical/emergency requests are action-first rather than forced into an exam lesson.
- **Memory isolation:** saved-question links are opt-in rather than automatically injected into self-contained clinical cases.
- **Partial-output integrity:** generation failures now mark surfaced partial text as incomplete and not a final answer.
- **Evidence safeguards:** added general checks for subgroup statistics/p-values, trial eligibility and exclusions, retired classification frameworks, and antimicrobial susceptibility context.
- **Evaluation integrity:** benchmark v1.1.0 binds each response to a prompt hash and benchmark version, checks content alignment, requires exact model/settings/search metadata and explicit completion status, and refuses to blind-score invalid or incomplete files.

**Verification:** `npm test` → **509/509 passed**. `npm run eval:healthcare:prepare` succeeded. `npm run build` could not complete because `vite` is not installed. No clinician-adjudicated clinical score, live Gemini A/B or production build is claimed. See [the response audit and root-cause report](docs/AB_COMPARISON_AND_ROOT_CAUSE_v3.58.0.md) and [test/build record](docs/TEST_RESULTS_v3.58.0.md).

---

## v3.57.0 — Research-Informed General Healthcare Evaluation (not a case-specific expansion)
---

## v3.56.0 — General Healthcare Answer-Quality Foundation

This release changes the development target from one-case-at-a-time patches to a reusable quality layer for healthcare answers across specialties and task types.

- **Cross-specialty routing:** broad healthcare detection and intent classification now cover clinical care, exams, medication/dose questions, calculations, diagnostics, laboratory and imaging interpretation, mental health, maternal/child health, dental care, public health, rehabilitation and veterinary medicine.
- **Anti-anchoring correction:** removed the old instruction to decide the answer first and make every sentence agree with it. The new rule requires alternatives, active disconfirmation and revision when evidence warrants it.
- **Universal healthcare protocol:** answer generation must distinguish observed facts, assumptions, inferences, differentials and actions; preserve units/time/specimen/population; check test limitations and pre-test probability; reconcile medicines; show calculations; sequence management by urgency and risk; calibrate certainty.
- **Live evidence grounding:** health answer-writing now attempts one Google Search grounding pass per analysis when supported. Returned source links and queries are surfaced. Search fallback or no usable links are disclosed rather than represented as verified research.
- **General quality audit:** advisory checks cover absolute certainty, unsupported currentness, single-test diagnostic overclaim, incomplete dose instructions, medication-interaction screening, special-population applicability, management trade-offs and loss of measurement context. These are finite advisories, not proof of safety or a substitute for clinician judgement.
- **General regression coverage:** includes multiple health domains, evidence/source checks, anti-anchoring, medication and diagnostic patterns, and an end-to-end mocked search-grounding path.

**Verification:** `npm test` → **495/495 passed**. `npm run build` was attempted but did not start because `vite` is absent; offline dependency installation failed because `zip-stream@4.1.1` is not cached. No production build, live Gemini A/B, clinician adjudication or prospective clinical study is claimed.

This is a general healthcare answer-quality engineering foundation, not a clinically validated product and not a guarantee of 100% accuracy. See [the general quality architecture and research report](docs/GENERAL_HEALTHCARE_QUALITY_v3.56.0.md) and [the test/build record](docs/TEST_RESULTS_v3.56.0.md).

---

## Previous release history

## v3.55.0 — Ameloblastic Fibrosarcoma / APS / Mandibular Reconstruction

This release adds a multidisciplinary root-cause regression for the new mandibular odontogenic-sarcoma case and fixes a temporal INR parsing defect found while testing it:

- **Compartment-aware pathology:** bland ameloblastic epithelium with overtly malignant spindle-cell ectomesenchymal stroma supports ameloblastic fibrosarcoma (AFS). The safety layer blocks an affirmative carcinoma/carcinosarcoma/benign-fibroma label when these findings are present, and prevents BRAF V600E alone from being treated as pathognomonic.
- **BRAF evidence and radiotherapy:** bulk NGS does not prove which histologic compartment carries a variant unless separately localised. BRAF/MEK targeted therapy is not treated as a routine adjuvant AFS standard. Unmodified concurrent targeted therapy with high-dose head-and-neck RT is blocked; current 2026 ESMO–ESTRO consensus calls for scenario-specific major adaptation, not a universal single hold rule. A BRAF inhibitor is not assumed to be prescribed merely because a mutation is present.
- **Jewer LC classification:** the source phrase “Jewel L-C” is recognised as a likely spelling variant of the Jewer LC mandibular-defect classification (lateral plus central). The check now requests condyle, soft-tissue and muscle-attachment details rather than incorrectly calling LC an undefined term.
- **Peronea arteria magna:** bilateral sole/dominant peroneal supply blocks routine fibula harvest unless vascular testing (e.g. balloon-occlusion testing plus duplex/collateral assessment) demonstrates independent adequate foot perfusion and a vascular team clears it. DCIA is a reasonable alternative, not the only one; scapular options are also considered.
- **Triple-positive thrombotic APS:** routine transition from warfarin to apixaban/another DOAC is blocked in a patient with prior arterial thrombosis. Unbridged warfarin interruption is also blocked as an unqualified plan. High-risk bridging is flagged unless timing is linked to the INR falling below target, the pre-op last dose, renal function, haemostasis, and staged post-op escalation.
- **Fluconazole–warfarin:** INR parsing now prefers an explicitly measured/admission INR or the last scalar INR rather than mistaking the target range (2.5–3.5) for the measured admission INR (4.8). The plan is flagged for stopping/reviewing the interaction and repeating INR; reversal depends on bleeding and surgical urgency.
- **AFS treatment limits:** segmental resection with negative margins remains the mainstay; adjuvant RT, the 60–66 Gy dose and the V3/foramen-ovale volume remain individualized by final margins, mapped perineural extent, skull-base imaging and a rare-tumour/head-and-neck MDT. Chest staging is flagged when absent.

The selected exam option C is the closest among the supplied choices, but the system deliberately does not label it a complete, uniquely established clinical protocol: LMWH timing is underspecified, RT dose/indication are not universal, and the medication history does not state that the patient is already taking BRAF/MEK inhibitors to be “held.”

See [the full case audit](docs/ROOT_CAUSE_MAXILLOFACIAL_APS_v3.55.0.md) and [test/build record](docs/TEST_RESULTS_v3.55.0.md). Automated tests are not medical validation; no live Gemini A/B or clinician sign-off is claimed.

---

## v3.54.0 — VA-ECMO / TAAA Root-Cause Regression

This release fixes two general validation defects surfaced by the latest ECMO case:

- **Measurement identity:** values from the right radial artery, lower-extremity arterial territory, and post-oxygenator blood gas retain their site/sample qualifiers. A MAP or pH difference between distinct sites/samples is not automatically reported as a duplicate conflict; repeated values from the same site remain reviewable.
- **Domain leakage across answer choices:** the mention of CRRT in one distractor and 5% albumin in another no longer activates the drug-binding/CRRT infusion-rate calculator. Explicit protein-binding/PK language is still required.
- **ECMO and aortic-surgery safety checks:** differential hypoxaemia, LV distension, ACS, bloody lumbar CSF on bivalirudin/coagulopathy, spinal rescue MAP/oxygen delivery, dampened pressure-waveform validation, drainage-line chatter, non-pulsatile toe pulse-oximetry limitations, hyperkalaemia/rhabdomyolysis, limb perfusion, and bivalirudin/protamine are covered by targeted regression rules.
- **Answer assessment:** option B is flagged as the closest exam option, but a version of B that recommends unqualified flushing of the bloody lumbar drain is not cleared as fully safe.

See [the complete case and evidence audit](docs/ROOT_CAUSE_ECMO_TAAA_v3.54.0.md) and [the test/build record](docs/TEST_RESULTS_v3.54.0.md). Automated tests are not medical validation; no live Gemini A/B or clinical sign-off is claimed.

---

## v3.53.0 — Root-Cause Clinical Safety Layer

This release addresses cross-cutting failure paths found in the v3.52.0 code review, rather than simply adding more medical knowledge or prompt warnings.

- **Fail-closed clinical validation:** validator exceptions do not release unchecked exam answers; question explanations/options are withheld while streaming and evaluated only after final checks.
- **Visual source-reading first:** image/scanned-PDF questions receive a separate model transcription before solving; unclear values must remain `[unclear]`. This is not a separate OCR engine or human verification.
- **Data-integrity controls:** repeated measurements are preserved, conflicting values block calculations, labelled extraction captures repeated values, and Arabic/Persian numerals are normalized.
- **Claim-specific source mapping:** a trusted URL cannot be attached to unrelated claims merely because it appears elsewhere in the response.
- **Patient-specific high-risk checks:** partial HScore handling; non-specific fungal biomarkers; negative serum galactomannan in SOT; tacrolimus level/AKI and voriconazole interaction; TMP-SMX in hyperkalaemia/renal dysfunction; biopsy risk under hypoxaemia/coagulopathy; stress-dose hydrocortisone indication (documented septic shock/adrenal indication).

See [the full v3.53.0 root-cause report](docs/ROOT_CAUSE_SAFETY_v3.53.0.md). Passing unit tests is not clinical validation. No live Gemini A/B comparison or successful Vite production build was claimed in that release.

---

