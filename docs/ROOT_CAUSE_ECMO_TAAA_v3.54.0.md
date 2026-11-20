# ClinixStudy v3.54.0 — ECMO/TAAA root-cause regression release

**Release:** 3.54.0  
**Test case:** 49-year-old patient, 18 hours after extent-II thoracoabdominal aortic aneurysm repair, femoro-femoral VA-ECMO, differential hypoxaemia, severe LV distension, suspected spinal-cord injury, high intra-abdominal pressure, active bleeding/coagulopathy, drainage-line chatter and severe muscle injury/hyperkalaemia.  
**Purpose:** fix general failure modes discovered by this case rather than add a one-question answer key.

## Executive result

The most defensible exam choice is **B as the closest available option**, but the latest AI output's statement that B is fully correct is too confident. Its wording needs refinement: the lumbar-drain instruction must not imply blind/forceful flushing or aspiration in blood-tinged CSF during bivalirudin exposure and severe coagulopathy; a specialist-directed spinal rescue bundle must be explicit; and Impella and atrial septostomy must not be described as physiologically identical.

The current-model answer exposed two software defects, both corrected in this release:

1. **Sampling identity was discarded.** Right-radial MAP 65 mmHg and distal femoral/pedal MAP 82 mmHg, and patient right-radial pH 7.16 versus post-oxygenator pH 7.42, were represented as repeated generic labels. The parser now preserves the anatomical / circuit sampling qualifier as part of the measurement key. Different sites/samples no longer become false duplicates; repeated measurements from the same scoped site still generate a conflict.
2. **Calculation domains leaked across distractors.** The question's option E mentions continuous renal replacement therapy (CRRT), and option D mentions 5% albumin. A naive conjunction activated a drug-protein-binding/CRRT infusion-rate formula even though the case contains no drug infusion-rate calculation. The PK/CRRT numerical audit now activates only when both domains are present and the text actually describes protein binding/free fraction or related PK inputs; a standalone albumin fluid bolus in a distractor is not enough.

## What the new safety audit checks

### 1. Femoral VA-ECMO differential hypoxaemia

The right-radial ABG (PaO2 39 mmHg, pH 7.16) and right-sided saturation (69%) are evidence of severe upper-body hypoxaemia. A post-oxygenator PaO2 of 460 mmHg demonstrates oxygen transfer across the oxygenator, but it is not a systemic arterial sample. The left toe saturation of 99% is also qualified by the stated non-pulsatile continuous flow; without a valid plethysmographic waveform it should not be treated as definitive distal arterial saturation. Confirm distal perfusion/oxygenation with an appropriate arterial sample and/or regional NIRS. The right radial artery remains the monitoring site most representative of coronary and upper-body oxygenation in peripheral VA-ECMO.

A femoral VA-ECMO differential-hypoxaemia pattern must trigger consideration of a tailored V-AV or other upper-body oxygenation strategy, rather than automatic pump-speed escalation or ventilator FiO2 increase alone.

### 2. LV distension / stasis

The markedly dilated, hypocontractile LV, spontaneous echo contrast, rare aortic-valve opening, high PCWP and pulmonary venous congestion are high-risk signs of LV distension/stasis on peripheral VA-ECMO. The plan must explicitly address LV unloading/venting and reassess aortic-valve opening, LV/aortic-root stasis and pulmonary congestion.

The 2026 ESC/EAPCI/ACVC consensus (published 14 October 2026) separates **passive venting** (e.g., atrial septostomy or surgical/percutaneous LA/LV vent; lowers atrial/ventricular pressure but does not substantially reduce myocardial wall stress/O2 consumption) from **active unloading** (e.g., Impella or IABP; reduces LV pressure/volume, wall stress and myocardial oxygen demand). These approaches are not interchangeable, and selection remains individualized. The automated rule flags answer wording that presents Impella and atrial septostomy as equivalent. A second advisory requires the answer to assess device-specific access feasibility and contraindications in the context of existing ECMO cannulae, reconstructed aortic/iliofemoral anatomy, and the severe bleeding/thrombosis balance before naming an insertion strategy.

### 3. Abdominal compartment syndrome

If IAP is measured correctly by the standardized method, 29 mmHg together with new oliguria and respiratory dysfunction is consistent with overt abdominal compartment syndrome. The answer must include urgent surgical decompression assessment; it must not reflexively give large fluid boluses for chattering in a patient with high IAP and pulmonary venous congestion.

### 4. Spinal-cord rescue and bloody lumbar-drain safety

New progressive bilateral paralysis after extensive TAAA repair is a spinal-cord emergency, but it must not be presumed to be pure ischemia. Blood-tinged CSF, dampened pressure waveform, aPTT 74 seconds on bivalirudin, platelets 38 × 10^9/L, INR 1.9 and fibrinogen 110 mg/dL also raise concern for catheter obstruction or a neuraxial/compressive haemorrhage. A pressure value of 34 mmHg with a damped waveform needs technical validation (transducer zero/level, stopcock and waveform) before it is treated as a fully reliable number.

The audit blocks an answer that proposes flushing/aspirating/replacing/manipulating the bloody neuraxial drain as a routine step while bivalirudin and severe coagulopathy are present, unless the answer explicitly avoids blind/forceful manipulation and escalates to specialist assessment. This is a conservative high-harm rule: the ASRA fifth-edition guidance suggests against neuraxial techniques during parenteral direct thrombin inhibitor exposure (including bivalirudin) and states there is no specific antidote. It is not a substitute for a local lumbar-drain protocol or specialist bedside judgement.

The plan should include a coordinated spinal rescue bundle: verify the pressure/arterial reference levels; optimize spinal-cord perfusion pressure with protocol-directed MAP augmentation (published aortic rescue protocols commonly target MAP ≥90–95 mmHg and CSF pressure ≤10–12 mmHg); optimize oxygen delivery and anaemia; and urgently evaluate for compressive spinal/neuraxial haematoma with imaging when feasible. These pressure and haemoglobin targets are based mainly on expert consensus/observational protocols and must be individualized, especially with ECMO, bleeding and cardiac failure.

### 5. ECMO drainage chatter

Chattering is a drainage-insufficiency/suction signal, not a command to increase RPM. Stabilize flow (often temporarily reducing RPM) and assess venous return, drainage-cannula position/obstruction, bleeding, tamponade, tension pneumothorax and raised IAP. Avoid reflexive large-volume albumin when the case already shows severe LV/pulmonary congestion and IAP 29 mmHg.

### 6. Bleeding, bivalirudin, limb injury and potassium

The combination of maroon nasogastric output, blood-tinged CSF, platelets 38, fibrinogen 110, INR 1.9 and ongoing bivalirudin requires urgent bleeding-source/hemostasis assessment and individualized interruption/reassessment of anticoagulation. Bivalirudin has no specific pharmacologic reversal antidote; protamine is not a bivalirudin reversal agent. Holding anticoagulation may be necessary during major bleeding but creates ECMO-circuit, LV and oxygenator thrombosis risk, particularly with spontaneous echo contrast; it needs close multidisciplinary reassessment rather than a blanket prolonged stop.

CK 18,400 U/L, potassium 6.3 mEq/L, dark urine and bilateral motor loss require urgent hyperkalaemia treatment/monitoring and bilateral limb perfusion/compartment assessment. Fasciotomy should not be performed solely because of paralysis or high CK without a clinical compartment-syndrome indication.

## Answer comparison

### Current AI

- Correctly identifies the broad topics (differential hypoxaemia, LV distension, ACS and spinal-cord risk).
- Incorrectly treats distinct MAP/pH sampling sites as unresolved duplicate values.
- Incorrectly asks for unrelated `fu`, `CLint`, `Qeff`, `Cssu` and `SC` because CRRT and albumin appear in separate distractors.
- Consequently withholds a useful answer for a false calculation conflict.

### Latest AI

- Correctly selects B as the closest option and identifies V-AV ECMO, LV unloading and decompressive laparotomy as core interventions.
- Overstates B as wholly safe while repeating an ambiguous instruction to troubleshoot/flush a bloody lumbar drain in a patient on bivalirudin with severe coagulopathy.
- Does not explicitly prioritize MAP augmentation/oxygen-delivery rescue for spinal-cord ischaemia or urgent evaluation of a compressive neuraxial haematoma.
- Treats Impella and atrial septostomy as equivalent, rather than distinguishing active unloading from passive venting.
- Omits assessment of ECMO chattering, the non-pulsatile toe-oximeter limitation, marked CK/hyperkalaemia/limb risk, and the need to balance temporary bivalirudin interruption against circuit/LV thrombosis.

## Software changes

- `src/lib/clinical-calculations.js`: measurement identity now includes sample/site qualifiers; distinct readings do not count as same-field conflicts. Calculation-domain activation no longer lets unrelated CRRT and albumin distractors demand drug-PK constants.
- `src/lib/clinical-safety.js`: added patient-specific rules/advisories for differential hypoxaemia, LV distension/venting terminology, overt ACS, bloody CSF on bivalirudin/coagulopathy, spinal rescue MAP/imaging/haemoglobin, damped CSF waveform validation, ECMO chatter, non-pulsatile toe SpO2, rhabdomyolysis/limb perfusion, hyperkalaemia and bivalirudin/protamine.
- `tests/clinical-calculations.test.mjs`: regression tests for site-/sample-qualified measurements, real same-site duplicates, and distractor-driven PK false positives.
- `tests/clinical-safety.test.mjs`: regression tests for the supplied VA-ECMO/TAAA pattern, unsafe option A, and a refined safer plan, including access-feasibility review before LV unloading device placement.

## Evidence references

1. **2026 ESC/EAPCI/ACVC consensus statement on temporary mechanical circulatory support in cardiogenic shock.** It distinguishes passive venting from active LV unloading and identifies right radial artery as the most representative site for coronary/upper-body oxygenation in VA-ECMO. https://academic.oup.com/eurheartj/advance-article/doi/10.1093/eurheartj/ehag708/8914824
2. **ISHLT/ HFSA 2023 acute mechanical circulatory support guideline.** It describes peripheral VA-ECMO-related LV afterload/distension, stasis, pulmonary congestion, and recommends right-upper-extremity ABG assessment for differential hypoxaemia with femoral cannulation. https://www.ishlt.org/docs/default-source/standards-guidelines/2023_guideline_jointstatement_ishlt_hfsa_mcsguideline.pdf
3. **Frontiers 2025 review: spinal cord protection in open/endovascular aortic surgery.** Rescue pathways discuss MAP ≥90 mmHg, CSFP ≤10 mmHg, SCPP targets, haemoglobin/oxygen delivery, and the limited evidence base; it also notes extrapolated neuraxial coagulopathy thresholds. https://www.frontiersin.org/journals/cardiovascular-medicine/articles/10.3389/fcvm.2025.1671350/full
4. **ASRA fifth edition (2025): antithrombotic therapy and neuraxial procedures.** Recommends against neuraxial techniques during parenteral direct thrombin inhibitor therapy including bivalirudin; no specific antidote is available. https://rapm.bmj.com/content/early/2025/10/16/rapm-2024-105766
5. **World Society of the Abdominal Compartment Syndrome consensus guideline.** Defines overt ACS and recommends decompressive laparotomy in critically ill adults with overt ACS. https://pmc.ncbi.nlm.nih.gov/articles/PMC3680657/
6. **2025 Annals of Intensive Care review on fluid therapy during VA-ECMO.** Explains drainage-cannula chattering/suction, and recommends integrated assessment for cannula malposition/obstruction, tamponade, tension pneumothorax and raised IAP rather than reflex fluid administration. https://pmc.ncbi.nlm.nih.gov/articles/PMC11923310/

## Limits and validation status

- Automated tests validate only the implemented patterns and do not establish clinical accuracy or clinical outcome benefit.
- The new parsers/rules remain finite regex-based guards; they may miss novel wording or flag a safe plan when it omits context. Clinician review remains mandatory.
- No clinician has signed off these rules, and no direct Gemini before/after API run or blinded external clinical assessment was performed.
- Vite production build status is recorded separately in `docs/TEST_RESULTS_v3.54.0.md`; a passing Node test suite does not establish a successful production build.
- This test is a synthetic educational scenario, not a treatment protocol for a real patient.
