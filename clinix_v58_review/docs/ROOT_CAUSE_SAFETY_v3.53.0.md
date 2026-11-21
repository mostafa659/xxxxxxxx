# ClinixStudy v3.53.0 — Root-cause safety and validation report

**Release:** 3.53.0  
**Baseline examined:** `clinixstudy-v3_52_0-clinical-calculation-guard.zip`  
**Date:** 20 November 2026  
**Scope:** code-level audit and changes in the attached project; not a clinical certification.

## Executive summary

The v3.52.0 baseline had a useful deterministic calculation layer, but review found several systemic weaknesses behind recurring errors. v3.53.0 addresses those pathways rather than only adding more prompt instructions or more knowledge records.

The release adds fail-closed clinical validation, suppresses unvalidated streamed exam answers, runs a separate model-based transcription pass before solving image/scanned-PDF questions, detects contradictory repeated values and missing/unsupported units, adds patient-specific safety checks for the documented transplant case, and tightens claim-to-source mapping.

**Important:** the transcription is a second vision-model reading pass, not a separate OCR engine, a truly independent model, or human verification. Passing tests demonstrates software behavior only; it does not prove clinical accuracy, model accuracy, or safe real-world use.

## Root causes found in the v3.52.0 code

1. **Fail-open validator exception path.** If the final trust/calculation pass threw on a question, the pipeline could return the generated explanation after stripping private data. A validator failure could therefore allow unchecked clinical prose to appear.
2. **Unvalidated streaming.** Partial generated answer text could reach the UI before the final trust pass. A correct final check did not prevent a student from seeing an unsafe intermediate answer.
3. **No source transcription on exam screenshots.** The generic question task list omitted the transcript stage; `ocrText` could be empty. The claimed source-value comparison therefore did not operate for many image questions.
4. **Misleading independence label.** The so-called OCR step was a separate model/VLM prompt, not an orthogonal OCR engine. Agreement between two prompts/models may still share visual or model bias.
5. **Repeated-value overwrite.** Parsing could silently keep the last repeated lab value; baseline/current readings could replace each other without a conflict.
6. **First-match-only extraction.** Labelled-source extraction did not preserve every repeated measurement, so it could hide source ambiguity.
7. **Overbroad citation attribution.** A reputable source link elsewhere in the verification response could be attached to several unrelated claims. Reputation of a domain is not evidence that a specific source supports a specific sentence.
8. **Case/normalization mismatch.** Some domain detection lower-cased input before looking for uppercase-only short tokens such as `OG` and `AG`, making parts of the calculation guard miss their trigger.
9. **Missing patient-level interaction/procedure checks.** The calculation guard did not sufficiently interrogate the transplant case’s interacting risks: high tacrolimus trough with AKI; hyperkalaemia with TMP-SMX, severe hypoxaemia/coagulopathy with invasive biopsy, and an unsupported stress-dose steroid rationale.

## Changes in v3.53.0

### 1. Fail closed and prevent premature answer display

- For exam questions, exceptions in the final clinical validation path now suppress the generated clinical answer and set the assessment to LOW / not cleared.
- Partial streamed `reason` chunks no longer expose the answer explanation or option verdicts before the final validation pass.
- If a visual clinical source cannot be transcribed, a triggered clinical-safety audit blocks answer clearance rather than pretending the missing values were checked.

### 2. Source reading is accurately described

- A separate visual-model transcription now runs before solving image/scanned-PDF questions.
- Prompt wording requires literal transcription, prohibits filling unreadable values from clinical plausibility, and marks uncertain text `[unclear]`.
- UI/report strings now state that this is a second model reading pass, not independent OCR or human confirmation.
- High-risk values still require checking against the original image/document by a person.

### 3. Input integrity and calculation integrity

- Repeated labelled numeric values are preserved. Non-equivalent duplicates create hard conflicts rather than silently selecting one.
- Labelled extraction loops through all occurrences, preserving current/baseline readings for conflict review.
- Arabic-Indic/Persian numerals and Arabic decimal separators are normalized for deterministic parsing.
- Calculation-critical fields require supported units and source/model agreement; missing inputs are not guessed.
- Short domain tokens are recognized case-insensitively after normalization.
- The existing Fick/SVR, osmolality/OG, acid-base and CVVH PK checks remain in place; this release does not certify those formulae for every population, analyser, local reference range, or model assumption.

### 4. More precise claim-to-source mapping

- A verdict can attach a URL only when the verification response explicitly maps that claim to a source index.
- A claim with no mapped allowlisted source remains unverified; a reputable URL elsewhere cannot turn it green.
- This is a source-index mapping safeguard, not a semantic proof that the linked document truly supports the sentence. Source content still needs review.

### 5. Patient-specific high-risk clinical checks

For the transplant case documented in the supplied review, the safety audit now checks:

- **HScore partial calculation:** with explicitly supplied values, the known subtotal is 196 (immunosuppression 18 + three cytopenias 34 + ferritin 50 + triglycerides 64 + fibrinogen 30 + temperature 0). AST, organomegaly status and bone-marrow hemophagocytosis status are missing, so 196 is displayed only as a partial subtotal/lower bound—not as a complete HScore or a diagnosis. Explicitly negative organomegaly and negative marrow findings are not scored as positive; mere mention in a differential does not count as marrow evidence.
- **HLH signal:** an incomplete known subtotal already above 169 generates a high-priority review advisory, not a diagnosis. The threshold is a screening/decision aid with imperfect sensitivity and specificity; later multicohort validation shows variable performance across populations.
- **β-D-glucan / galactomannan:** a positive β-D-glucan cannot by itself confirm PJP or Aspergillus; a negative serum galactomannan cannot be used to rule out invasive aspergillosis in a solid-organ-transplant recipient.
- **Tacrolimus / voriconazole:** a plan that combines these drugs must explicitly manage tacrolimus dose/hold and therapeutic-drug monitoring. The official product information reports substantial tacrolimus exposure increases and recommends major dose reduction plus level monitoring when voriconazole is initiated.
- **Tacrolimus toxicity context:** a trough substantially above its stated target plus acute creatinine rise requires explicit drug review/action and repeat trough monitoring; an answer that ignores this is blocked.
- **TMP-SMX with renal/electrolyte risk:** in the setting of marked hyperkalaemia or acute renal dysfunction, the plan must mention kidney-function-based dosing and explicit potassium/renal monitoring.
- **Transbronchial biopsy:** with severe hypoxaemia and/or coagulopathy markers in the case, an immediate lung/transbronchial biopsy cannot be presented as routine without stabilisation and specialist procedural-risk assessment. The programmed values are screening triggers, not universal procedural cut-offs.
- **Stress-dose hydrocortisone:** the system does not silently treat infection or an isolated low blood-pressure reading as sufficient indication. The case must document septic shock or an adrenal crisis/insufficiency; this reflects the adult SCCM 2024 focused update, which suggests corticosteroids for septic shock, not uncomplicated sepsis alone.

These are narrow high-risk contradiction checks, not a full differential-diagnosis engine, drug database, ICU protocol, or prescribing authority.

## Tests and build status

- **Baseline, before changes:** 453/453 existing project tests passed.
- **New clinical-safety tests:** 18/18 passed.
- **Full regression suite after the final code change:** 471/471 passed (0 failed).
- **JavaScript syntax checks:** performed for changed core modules.
- **Vite production build:** not completed. `npm ci --no-audit --no-fund` timed out in this environment; the Vite executable remained unavailable. Do not treat the unit-test pass as a successful production build.
- **Live Gemini A/B:** not run. No claim is made that answer accuracy improved by a measured percentage.
- **Clinical sign-off:** none of the new checks makes the bundled specialist draft records medically approved. Human specialist approval remains separate and mandatory before deploying medical content to learners.

## Known limitations and remaining work

1. A second prompt/model read is correlated with the solver and is not a truly independent perception channel. The long-term fix is a genuinely independent OCR engine plus original-image review or a human-confirmed transcription for high-risk inputs.
2. Numeric parsing and safety rules are deliberately conservative, but natural-language diversity can evade regex-based rules. The ruleset is not exhaustive and cannot establish that an unflagged answer is correct.
3. The HScore parser currently handles a finite set of explicit labels and common units. It is not a validated scoring service; missing or ambiguous values remain unknown.
4. Claim-specific `sourceIndex` reduces blanket citation attachment but does not guarantee that a cited source supports the claim. A future stronger design should ingest source passages/snippets and verify entailment plus scope, publication date, population, and guideline version.
5. The system's probability/tier is not a clinical-calibration score. Confidence in a multiple-choice prediction must not be interpreted as patient-specific certainty.
6. A/B benchmarking requires a fixed, curated, expert-adjudicated case set, blinded scoring rubric, repeat runs, and measured error categories (wrong answer, omitted red flag, invented patient fact, unsafe plan, evidence misweighting, transcription error). No such outcome benchmark was run in this release.
7. Vite production build, browser/device smoke tests, model-provider live tests, and external API integration tests remain to be run in an environment with installed dependencies and authorized credentials.

## Medical references used to shape the specific guardrails

- IDSA aspergillosis guideline: serum galactomannan is not recommended for screening in SOT recipients; serum β-D-glucan is not Aspergillus-specific; severe hypoxaemia/bleeding/thrombocytopenia may preclude BAL; BAL yield may be low for peripheral nodules. https://www.idsociety.org/practice-guideline/aspergillosis/
- EMA voriconazole product information: tacrolimus Cmax increased by 117% and AUC by 221% in the referenced interaction study; when starting voriconazole in a patient already receiving tacrolimus, the product information recommends reducing tacrolimus to one third of the original dose and closely monitoring levels. This must be individualized by the transplant team. https://www.ema.europa.eu/en/documents/product-information/voriconazole-hikma-epar-product-information_en.pdf
- Original HScore development/validation: Fardet et al., 2014, Arthritis & Rheumatology. https://doi.org/10.1002/art.38690
- Multicenter validation of secondary-HLH diagnostic criteria, 2025: HScore cutoff 169 had mean sensitivity 82.4% and specificity 87.6% across the included validation cohorts; diagnostic performance varies with case-mix. https://pmc.ncbi.nlm.nih.gov/articles/PMC11846073/
- SCCM 2024 focused update: suggests corticosteroids for adults with septic shock; it does not endorse routine stress-dose hydrocortisone for infection or uncomplicated sepsis without shock. https://www.sccm.org/clinical-resources/guidelines/guidelines/use-of-corticosteroids-in-sepsis-ards-cap
- Current DailyMed sulfamethoxazole/trimethoprim label: dosage reduction is advised with renal impairment (CrCl 15–30 mL/min: half usual regimen; below 15: use not recommended); trimethoprim can cause hyperkalaemia, including in renal insufficiency, requiring potassium monitoring. Individual PJP treatment must use an indication-specific renal dosing protocol. https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=08500fcb-dbec-4ac2-91c3-189d27907ec0

## Release interpretation

**What is established:** source-code changes are present and automated tests cover the named failure patterns; the regression suite passed after the final rerun recorded below.  
**What is not established:** near-100% clinical accuracy, improved Gemini accuracy in live use, independent optical character recognition, or readiness for unsupervised clinical decision-making.


## Credential-safety note

The supplied PDF visibly contains a Gemini API key on page 1 (in the earlier conversation excerpt). Treat that credential as compromised: revoke it in Google AI Studio, create a replacement, and provide it only through a local environment variable or approved secret manager. The release archive does not need the exposed key and must not contain it. Do not reuse or paste the exposed value again.
