import test from "node:test";
import assert from "node:assert/strict";
import { auditClinicalSafety, isPotentialClinicalContext } from "../src/lib/clinical-safety.js";
import { auditClinicalCalculations, parseClinicalDataDiagnostics, extractLabelledClinicalData, parseClinicalData } from "../src/lib/clinical-calculations.js";

const transplantCase = `A 58-year-old woman, kidney transplant recipient taking tacrolimus, mycophenolate and prednisone.
Temperature 38.2°C. Hemoglobin: 7.8 g/dL. White Blood Cell Count: 2.1 × 10^9/L. Platelets: 64 × 10^9/L.
Ferritin: 14,500 ng/mL. Triglycerides: 410 mg/dL. Fibrinogen: 115 mg/dL.
Tacrolimus trough level: 19.4 ng/mL. Serum (1→3)-β-D-glucan: >500 pg/mL. Serum galactomannan: 0.3 (negative).`;

test("duplicate numeric labels within one source are preserved and block calculations", () => {
  const report = parseClinicalDataDiagnostics("Na=140 mmol/L; Glucose=90 mg/dL; Na=126 mmol/L; BUN=14 mg/dL; MeasuredOsm=300 mOsm/kg");
  assert.equal(report.facts.na.value, 140, "the parser no longer silently overwrites the first reading");
  assert.equal(report.duplicates.length, 1);
  assert.equal(report.duplicates[0].key, "na");
  const audit = auditClinicalCalculations({
    dataText: "Na=140 mmol/L; Glucose=90 mg/dL; Na=126 mmol/L; BUN=14 mg/dL; MeasuredOsm=300 mOsm/kg",
    contextText: "Osmolal gap calculation",
  });
  assert.ok(audit.conflicts.some((x) => x.code === "within-source-na-ambiguous"));
  assert.ok(!audit.results.some((x) => x.id === "og"), "a calculation must not use an arbitrary duplicate");
});

test("labelled extractor keeps current and baseline lab readings rather than taking the first silently", () => {
  const sodium = extractLabelledClinicalData("Sodium 126 mmol/L at presentation; baseline sodium 139 mmol/L.");
  const facts = parseClinicalData(sodium);
  assert.equal((sodium.match(/na=/g) || []).length, 1);
  assert.equal(facts.na.value, 126);
  assert.equal(facts.nabaseline.value, 139, "baseline values are retained under a distinct temporal identity");
});

test("Arabic numerals are parsed deterministically", () => {
  const facts = parseClinicalData("Na=١٢٦ mmol/L; Glucose=٩٠ mg/dL; BUN=١٤ mg/dL; MeasuredOsm=٣٠٠ mOsm/kg");
  assert.equal(facts.na.value, 126);
  assert.equal(facts.glucose.value, 90);
  assert.equal(facts.measuredosm.value, 300);
});

test("the patient example yields a partial HScore subtotal, never a fabricated complete score", () => {
  const audit = auditClinicalSafety({ caseText: transplantCase, answerText: "HLH is a strong concern but not confirmed; obtain the missing criteria." });
  assert.ok(audit.hscorePartial);
  assert.equal(audit.hscorePartial.score, 196);
  assert.equal(audit.hscorePartial.complete, false);
  assert.ok(audit.advisories.some((x) => x.code === "partial-hscore-lower-bound-high"));
  assert.deepEqual(audit.hscorePartial.missing.sort(), ["AST with verified units", "bone-marrow hemophagocytosis status", "liver/spleen size or organomegaly status"].sort());
  assert.equal(audit.conflicts.length, 0, "qualified concern is not turned into a false diagnostic claim");
});

test("a partial HScore cannot be advertised as a full score or a confirmed HLH diagnosis", () => {
  const audit = auditClinicalSafety({ caseText: transplantCase, answerText: "The HScore is 196, confirming HLH." });
  assert.ok(audit.conflicts.some((x) => x.code === "partial-hscore-presented-as-final"));
});

test("β-D-glucan is not accepted as a disease-specific confirmation", () => {
  const audit = auditClinicalSafety({ caseText: transplantCase, answerText: "The beta-D-glucan confirms Pneumocystis pneumonia." });
  assert.ok(audit.conflicts.some((x) => x.code === "bdg-nonspecific-overclaim"));
});

test("negative serum galactomannan does not rule out invasive aspergillosis in SOT", () => {
  const audit = auditClinicalSafety({ caseText: transplantCase, answerText: "A negative serum galactomannan rules out aspergillosis." });
  assert.ok(audit.conflicts.some((x) => x.code === "negative-serum-gm-does-not-exclude-sot-ia"));
});

test("voriconazole with tacrolimus needs both a dose action and level monitoring", () => {
  const option = "Start voriconazole and hold tacrolimus.";
  const unsafe = auditClinicalSafety({ caseText: transplantCase, selectedOptionText: option, answerText: "Choose this option." });
  assert.ok(unsafe.conflicts.some((x) => x.code === "voriconazole-tacrolimus-unmanaged"));
  const safePlan = auditClinicalSafety({ caseText: transplantCase, selectedOptionText: option, answerText: "Hold tacrolimus now and monitor tacrolimus trough levels before a specialist-guided reduced restart." });
  assert.equal(safePlan.conflicts.some((x) => x.code === "voriconazole-tacrolimus-unmanaged"), false);
  assert.ok(safePlan.advisories.some((x) => x.code === "voriconazole-tacrolimus-plan-present"));
});

test("stress-dose hydrocortisone is not treated as routine without a documented indication", () => {
  const audit = auditClinicalSafety({ caseText: transplantCase, selectedOptionText: "Administer stress-dose hydrocortisone.", answerText: "This is required for all infections." });
  assert.ok(audit.conflicts.some((x) => x.code === "hydrocortisone-indication-not-documented"));
});

test("stress-dose hydrocortisone is not falsely blocked when septic shock is explicitly documented", () => {
  const audit = auditClinicalSafety({ caseText: `${transplantCase} The patient has documented septic shock.`, selectedOptionText: "Administer stress-dose hydrocortisone.", answerText: "This is considered as part of septic shock management." });
  assert.equal(audit.conflicts.some((x) => x.code === "hydrocortisone-indication-not-documented"), false);
});

test("clinical-context detection is a routing hint, not a correctness verdict", () => {
  assert.equal(isPotentialClinicalContext("A patient with creatinine 2.9 mg/dL"), true);
  assert.equal(isPotentialClinicalContext("A short English vocabulary lesson"), false);
  const audit = auditClinicalSafety({ caseText: "A patient has fever." });
  assert.equal(audit.status, "no-specific-rule-triggered");
  assert.match(audit.disclaimer, /finite/);
});

test("HScore does not score absent organomegaly or negative marrow as positive", () => {
  const audit = auditClinicalSafety({
    caseText: `${transplantCase}\nNo hepatomegaly or splenomegaly. Bone marrow shows no hemophagocytosis.`,
    answerText: "HLH remains in the differential, but these findings do not confirm it."
  });
  const components = audit.hscorePartial.components;
  assert.equal(components.find((x) => x.name === "organomegaly")?.points, 0);
  assert.equal(components.find((x) => x.name === "bone_marrow")?.points, 0);
  assert.equal(audit.hscorePartial.score, 196);
  assert.equal(audit.hscorePartial.complete, false);
});

test("HScore refuses unsupported or ambiguous lab units and conflicting current values", () => {
  const noUnits = auditClinicalSafety({ caseText: "Currently taking tacrolimus. Hb 7.8; WBC 2.1; platelets 64; ferritin 14500; TG 410; fibrinogen 115; temperature 38.2." , answerText: "Evaluate possible HLH." });
  assert.equal(noUnits.hscorePartial.score, 18, "only the evidenced immunosuppression criterion is scored");
  assert.ok(noUnits.hscorePartial.missing.some((x) => /cytopenia/.test(x)));
  assert.ok(noUnits.hscorePartial.missing.some((x) => /ferritin/.test(x)));
  const conflicting = auditClinicalSafety({
    caseText: `${transplantCase}\nCurrent ferritin 14500 ng/mL; prior ferritin 800 ng/mL.`,
    answerText: "Evaluate possible HLH."
  });
  assert.ok(conflicting.hscorePartial.missing.some((x) => /ferritin \(conflicting values\)/.test(x)));
  assert.equal(conflicting.hscorePartial.components.some((x) => x.name === "ferritin"), false);
});

test("HScore requires bone-marrow evidence rather than a differential mention", () => {
  const audit = auditClinicalSafety({
    caseText: `${transplantCase}\nThe differential includes hemophagocytosis.`,
    answerText: "Consider HLH."
  });
  assert.equal(audit.hscorePartial.components.some((x) => x.name === "bone_marrow"), false);
  assert.ok(audit.hscorePartial.missing.some((x) => /bone-marrow/.test(x)));
});


test("an explicitly qualified partial HScore is not mistaken for a full-score overclaim", () => {
  const audit = auditClinicalSafety({ caseText: transplantCase, answerText: "The partial HScore subtotal is 196; AST, organomegaly and marrow status are missing." });
  assert.equal(audit.conflicts.some((x) => x.code === "partial-hscore-presented-as-final"), false);
  assert.ok(audit.advisories.some((x) => x.code === "partial-hscore-lower-bound-high"));
});

test("transbronchial biopsy is blocked when severe hypoxemia and coagulopathy are present", () => {
  const highRiskCase = `${transplantCase} Oxygen saturation is 86%. INR 4.8. Baseline creatinine 1.3 mg/dL; creatinine 2.9 mg/dL.`;
  const audit = auditClinicalSafety({
    caseText: highRiskCase,
    selectedOptionText: "Perform immediate bronchoscopy with BAL and transbronchial biopsy.",
    answerText: "Choose immediate transbronchial biopsy."
  });
  assert.ok(audit.conflicts.some((x) => x.code === "transbronchial-biopsy-procedure-risk"));
});

test("TMP-SMX in hyperkalaemia requires kidney-adjusted dosing and potassium monitoring", () => {
  const highRiskCase = `${transplantCase} Potassium 5.6 mEq/L; creatinine 2.9 mg/dL.`;
  const unsafe = auditClinicalSafety({ caseText: highRiskCase, selectedOptionText: "Initiate high-dose intravenous TMP-SMX.", answerText: "Start high-dose TMP-SMX now." });
  assert.ok(unsafe.conflicts.some((x) => x.code === "tmp-smx-renal-hyperkalemia-safety"));
  const safe = auditClinicalSafety({ caseText: highRiskCase, selectedOptionText: "Initiate TMP-SMX.", answerText: "Use renal-adjusted dosing based on kidney function; monitor potassium and creatinine serially." });
  assert.equal(safe.conflicts.some((x) => x.code === "tmp-smx-renal-hyperkalemia-safety"), false);
});


test("supratherapeutic tacrolimus with acute kidney injury cannot be ignored", () => {
  const highRiskCase = `${transplantCase} Tacrolimus trough level: 19.4 ng/mL (target 5–8 ng/mL). Creatinine: 2.9 mg/dL (baseline 1.3 mg/dL).`;
  const ignored = auditClinicalSafety({ caseText: highRiskCase, selectedOptionText: "Start broad-spectrum antibiotics.", answerText: "Treat the infection; continue the usual immunosuppression." });
  assert.ok(ignored.conflicts.some((x) => x.code === "supratherapeutic-tacrolimus-with-aki"));
  const managed = auditClinicalSafety({ caseText: highRiskCase, selectedOptionText: "Hold tacrolimus.", answerText: "Hold/review tacrolimus with the transplant team and repeat the trough level; monitor kidney function." });
  assert.equal(managed.conflicts.some((x) => x.code === "supratherapeutic-tacrolimus-with-aki"), false);
});

const ecmoTaaaCase = `A 49-year-old man 18 hours after emergent Extent II thoracoabdominal aortic aneurysm (TAAA) repair. Peripheral femoro-femoral VA-ECMO. Progressive bilateral lower extremity motor loss (0/5 strength bilaterally). Right radial MAP 65 mmHg and SpO2 69%; left femoral/pedal MAP 82 mmHg with non-pulsatile continuous flow and toe SpO2 99%. Right radial ABG pH 7.16, PaO2 39 mmHg. Hemoglobin 7.9 g/dL. ECMO post-oxygenator ABG pH 7.42, PaO2 460 mmHg. Drainage-line chattering. PCWP 29 mmHg. TEE LVEF 10–15% with spontaneous echo contrast (smoke), aortic valve opens every 4th beat. Bladder pressure (IAP) 29 mmHg; urine output 5 mL/hr. Lumbar CSF drain: intrathecal CSF pressure 34 mmHg, waveform dampened and blood-tinged. Bivalirudin infusion; current aPTT 74 sec. Platelets 38 × 10^9/L; fibrinogen 110 mg/dL; INR 1.9. CK 18,400 U/L; potassium 6.3 mEq/L; dark tea-coloured urine. Dark maroon nasogastric tube output.`;
const ecmoOptionB = `Hold bivalirudin and correct coagulopathy with platelets and cryoprecipitate (avoiding PCC); convert peripheral VA-ECMO to hybrid Veno-Arterial-Venous (V-AV) ECMO by adding a right internal jugular venous return cannula while placing a percutaneous left ventricular vent (e.g. Impella or atrial septostomy); perform an immediate decompressive laparotomy; troubleshoot/flush the lumbar drain without rapid high-volume CSF aspiration (maintaining CSF pressure target 10–12 mmHg only after hemostatic optimization).`;

test("VA-ECMO TAAA case recognises real site-specific gradients and blocks unsafe bloody-drain flushing on bivalirudin", () => {
  const audit = auditClinicalSafety({ caseText: ecmoTaaaCase, selectedOptionText: ecmoOptionB, answerText: "B is fully correct; troubleshoot and flush the lumbar drain." });
  const codes = new Set(audit.conflicts.map((x) => x.code));
  assert.ok(codes.has("bloody-csf-drain-manipulation-on-bivalirudin"));
  assert.ok(!codes.has("va-ecmo-differential-hypoxemia-not-addressed"), "V-AV strategy addresses upper-body hypoxaemia");
  assert.ok(!codes.has("va-ecmo-lv-distension-not-addressed"), "an LV unloading method is named");
  assert.ok(!codes.has("overt-acs-not-decompressed"), "decompressive laparotomy is named");
  assert.ok(audit.advisories.some((x) => x.code === "taa-sci-rescue-map-not-explicit"));
  assert.ok(audit.advisories.some((x) => x.code === "bloody-csf-neuraxial-imaging-not-mentioned"));
  assert.ok(audit.advisories.some((x) => x.code === "lv-unloading-modalities-not-equivalent"));
  assert.ok(audit.advisories.some((x) => x.code === "lv-unloading-access-feasibility-not-addressed"));
  assert.ok(audit.advisories.some((x) => x.code === "ecmo-chatter-workup-omitted"));
  assert.ok(audit.advisories.some((x) => x.code === "rhabdo-limb-ischemia-assessment-omitted"));
  assert.ok(audit.advisories.some((x) => x.code === "severe-hyperkalemia-response-omitted"));
  assert.ok(audit.advisories.some((x) => x.code === "nonpulsatile-toe-spo2-needs-confirmation"));
  assert.ok(audit.advisories.some((x) => x.code === "dampened-csf-pressure-trace-needs-validation"));
  assert.ok(audit.advisories.some((x) => x.code === "taa-sci-oxygen-delivery-hb-not-addressed"));
  assert.ok(audit.advisories.some((x) => x.code === "bivalirudin-hold-requires-circuit-balance"));
});

test("an explicit no-flush, spinal-rescue and imaging plan resolves the neuraxial manipulation conflict", () => {
  const audit = auditClinicalSafety({
    caseText: ecmoTaaaCase,
    selectedOptionText: ecmoOptionB,
    answerText: "Do not flush, force aspirate, replace or blindly manipulate the bloody lumbar drain. Hold/reassess bivalirudin with the ECMO team; urgently involve neurosurgery and anesthesia and obtain urgent MRI spine when feasible to exclude epidural/compressive hematoma. Verify the CSF transducer zero, level and waveform validity. Augment MAP to 90–95 mmHg per the spinal rescue protocol; verify the arterial-line reference and optimise oxygen delivery with a transfusion assessment for Hb 7.9 g/dL. Treat the decompressed abdominal compartment, stabilise ECMO chatter by temporarily reducing RPM and assessing cannula position/preload/tamponade/pneumothorax. Assess both limb Dopplers and compartments, treat hyperkalaemia urgently, confirm distal oxygenation using arterial sampling or NIRS instead of relying on a toe oximeter during non-pulsatile flow, and select active Impella unloading rather than describing it as equivalent to passive atrial septostomy; review vascular/transseptal access feasibility, reconstructed aortic and iliofemoral anatomy, contraindications and bleeding/thrombosis risk before device insertion.",
  });
  assert.equal(audit.conflicts.some((x) => x.code === "bloody-csf-drain-manipulation-on-bivalirudin"), false);
  assert.equal(audit.conflicts.some((x) => x.code === "taa-sci-rescue-not-addressed"), false);
});

test("unsafe ECMO option A is flagged for RPM escalation during chatter, CSF aspiration, and protamine-for-bivalirudin", () => {
  const audit = auditClinicalSafety({
    caseText: ecmoTaaaCase,
    selectedOptionText: "Increase VA-ECMO pump speed to 5,200 RPM; manually aspirate 30 mL CSF; administer protamine sulfate with PCC.",
    answerText: "Choose A and use protamine to reverse bivalirudin.",
  });
  const codes = new Set(audit.conflicts.map((x) => x.code));
  assert.ok(codes.has("ecmo-chatter-rpm-escalation"));
  assert.ok(codes.has("protamine-does-not-reverse-bivalirudin"));
  assert.ok(codes.has("bloody-csf-drain-manipulation-on-bivalirudin"));
  assert.ok(codes.has("va-ecmo-differential-hypoxemia-not-addressed"));
});


const ameloblasticFibrosarcomaCase = `A 39-year-old male with a 4-month rapidly enlarging painful left mandibular mass, progressive trismus and profound left lower lip/chin anaesthesia. Triple-positive Antiphospholipid Syndrome (APS), positive lupus anticoagulant, anticardiolipin IgG, and anti-$\\beta_2$-glycoprotein I IgG; prior unprovoked pulmonary embolism and ischemic stroke; on Warfarin target INR 2.5–3.5. Started Fluconazole 200 mg/day 10 days ago; admission INR 4.8. CBCT: aggressive multilocular radiolucency with bicortical perforation. MRI: perineural tumor spread along left mandibular nerve V3 to foramen ovale with denervation edema of masseter, temporalis and pterygoids. CTA: bilateral Peronea Arteria Magna, congenital aplasia of posterior tibial arteries and severe hypoplasia of anterior tibial arteries; peroneal artery is the sole dominant blood supply to the pedal arch. H&E: biphasic odontogenic neoplasm of cords and follicles of cytologically bland odontogenic epithelium with peripheral palisading and reverse nuclear polarization, embedded in hypercellular, markedly pleomorphic, hyperchromatic spindle-cell ectomesenchymal stroma; 14 mitoses per 10 HPF and atypical mitoses. Ki-67 38% in stromal spindle cells versus <2% in epithelial islands. NGS BRAF p.V600E, negative EWSR1, MAML2 and CTNNB1. The radiographic defect is described as a Jewel L-C defect.`;
const mandibleOptionA = `A) Ameloblastic Carcinoma; reverse INR with PCC, permanently transition Warfarin to Apixaban 5 mg BID, perform segmental mandibulectomy with a vascularized free fibula osteocutaneous flap, and administer adjuvant IMRT.`;
const mandibleOptionB = `B) Ameloblastic Fibrosarcoma (AFS); bridge Warfarin with therapeutic LMWH, perform segmental mandibulectomy reconstructed with a DCIA osteocutaneous free flap plus genioglossus/geniohyoid resuspension, and administer concurrent Dabrafenib/Trametinib during adjuvant 66 Gy IMRT targeting the skull base.`;
const mandibleOptionC = `C) Ameloblastic Fibrosarcoma (AFS); hold Fluconazole and Warfarin, bridge perioperatively with therapeutic LMWH (resuming Warfarin post-op), perform radical segmental mandibulectomy reconstructed with a DCIA osteocutaneous free flap and suprahyoid/genioglossus resuspension, and deliver adjuvant IMRT (60–66 Gy) to the V3 pathway/foramen ovale while holding BRAF/MEK inhibitors throughout radiotherapy.`;
const mandibleOptionD = `D) Odontogenic Carcinosarcoma; discontinue Warfarin 5 days preoperatively without heparin bridging, reconstruct the defect using a double-barrel free fibula osteocutaneous flap, and initiate immediate post-op implant loading.`;
const mandibleOptionE = `E) Ameloblastic Fibroma with reactive stromal atypia; manage via marginal mandibulectomy and Carnoy's solution.`;

test("AFS mandibular case activates clinical safety checks even when the prompt is oncology-specific", () => {
  assert.equal(isPotentialClinicalContext("Ameloblastic fibrosarcoma, mandibular resection, warfarin and APS"), true);
  const audit = auditClinicalSafety({ caseText: ameloblasticFibrosarcomaCase, selectedOptionText: mandibleOptionC, answerText: "Option C is the closest exam answer." });
  assert.equal(audit.triggered, true);
  assert.equal(audit.conflicts.length, 0, audit.conflicts.map((x) => x.code).join(", "));
  const codes = new Set(audit.advisories.map((x) => x.code));
  assert.ok(codes.has("afs-adjuvant-rt-needs-final-pathology"));
  assert.ok(codes.has("afs-radiation-dose-not-universal"));
  assert.ok(codes.has("afs-systemic-staging-not-mentioned"));
  assert.ok(codes.has("mandibular-donor-flap-selection-needs-anatomy-review"));
  assert.ok(codes.has("warfarin-fluconazole-high-inr-not-managed"));
  assert.ok(codes.has("aps-bridge-needs-bleed-risk-timing"));
  assert.ok(codes.has("braf-mek-hold-assumes-unprescribed-drug"));
  assert.ok(codes.has("jewer-lc-defect-anatomy-confirmation"));
  assert.ok(audit.advisories.some((x) => x.code === "warfarin-fluconazole-high-inr-not-managed" && x.message.includes("INR 4.8")), "the measured INR must be parsed, not the 2.5–3.5 target interval");
});

test("AFS malignant stromal morphology blocks incorrect carcinoma/carcinosarcoma/fibroma labels", () => {
  for (const [option, code] of [
    [mandibleOptionA, "afs-compartment-diagnosis-mismatch"],
    [mandibleOptionD, "afs-compartment-diagnosis-mismatch"],
    [mandibleOptionE, "afs-compartment-diagnosis-mismatch"],
  ]) {
    const audit = auditClinicalSafety({ caseText: ameloblasticFibrosarcomaCase, selectedOptionText: option, answerText: "Choose the selected option." });
    assert.ok(audit.conflicts.some((x) => x.code === code), `${option.slice(0, 20)} should be blocked`);
  }
});

test("triple-positive APS with prior arterial thrombosis blocks routine Apixaban transition", () => {
  const audit = auditClinicalSafety({ caseText: ameloblasticFibrosarcomaCase, selectedOptionText: mandibleOptionA, answerText: "Choose A." });
  const codes = new Set(audit.conflicts.map((x) => x.code));
  assert.ok(codes.has("triple-positive-aps-doac-switch-unsafe"));
});

test("bilateral peronea arteria magna blocks fibula harvest absent documented collateral clearance", () => {
  const audit = auditClinicalSafety({ caseText: ameloblasticFibrosarcomaCase, selectedOptionText: mandibleOptionA, answerText: "Choose A." });
  assert.ok(audit.conflicts.some((x) => x.code === "peronea-magna-fibula-harvest-contraindicated"));
  const exception = auditClinicalSafety({
    caseText: ameloblasticFibrosarcomaCase,
    selectedOptionText: mandibleOptionA,
    answerText: "Only if formal peroneal artery balloon-occlusion testing and duplex demonstrate adequate independent collateral perfusion and the vascular team explicitly clears fibula harvest; otherwise use another donor site."
  });
  assert.equal(exception.conflicts.some((x) => x.code === "peronea-magna-fibula-harvest-contraindicated"), false);
});

test("unmodified concurrent dabrafenib/trametinib with high-dose head-and-neck RT is blocked", () => {
  const audit = auditClinicalSafety({ caseText: ameloblasticFibrosarcomaCase, selectedOptionText: mandibleOptionB, answerText: "Choose B." });
  const codes = new Set(audit.conflicts.map((x) => x.code));
  assert.ok(codes.has("braf-mek-concurrent-high-dose-head-neck-rt-unadapted"));
  assert.ok(codes.has("afs-braf-targeted-therapy-not-established-standard"));
});

test("unbridged warfarin interruption is blocked in triple-positive APS with prior stroke", () => {
  const audit = auditClinicalSafety({ caseText: ameloblasticFibrosarcomaCase, selectedOptionText: mandibleOptionD, answerText: "Choose D." });
  assert.ok(audit.conflicts.some((x) => x.code === "triple-positive-aps-unbridged-warfarin-interruption"));
});

test("BRAF V600E alone cannot be called pathognomonic or the sole proof of AFS", () => {
  const audit = auditClinicalSafety({
    caseText: ameloblasticFibrosarcomaCase,
    selectedOptionText: mandibleOptionC,
    answerText: "BRAF p.V600E confirms and is pathognomonic for ameloblastic fibrosarcoma and proves the stromal clone is BRAF-driven."
  });
  assert.ok(audit.conflicts.some((x) => x.code === "afs-braf-not-diagnostic-alone"));
  assert.ok(audit.advisories.some((x) => x.code === "afs-braf-compartment-not-localised"));
});

test("AFS treatment text must not claim 60–66 Gy or adjuvant RT as universal protocol", () => {
  const audit = auditClinicalSafety({ caseText: ameloblasticFibrosarcomaCase, selectedOptionText: mandibleOptionC, answerText: "C is the only safe and universally evidence-based plan." });
  assert.ok(audit.advisories.some((x) => x.code === "afs-adjuvant-rt-needs-final-pathology"));
  assert.ok(audit.advisories.some((x) => x.code === "afs-radiation-dose-not-universal"));
});


test("AFS Ki-67 supports proliferation but no universal 30-percent diagnostic threshold is asserted", () => {
  const audit = auditClinicalSafety({
    caseText: ameloblasticFibrosarcomaCase,
    selectedOptionText: mandibleOptionC,
    answerText: "Stromal Ki-67 proliferation index: markedly elevated (> 30%) is a diagnostic cut-off for AFS."
  });
  assert.ok(audit.advisories.some((x) => x.code === "afs-ki67-not-universal-diagnostic-threshold"));
});
