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
  assert.equal((sodium.match(/na=/g) || []).length, 2);
  assert.equal(facts.na.value, 126);
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
