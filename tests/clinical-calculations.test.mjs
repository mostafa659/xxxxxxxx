import test from "node:test";
import assert from "node:assert/strict";
import {
  auditClinicalCalculations,
  parseClinicalData,
  parseClinicalDataDiagnostics,
  extractLabelledClinicalData,
  mergeOriginalSourceText,
  mergeExtractedClinicalData,
  replaceAuditItemsByMessage,
  extractClinicalDataBlock,
  stripPartialClinicalDataBlock,
  maskOptionsWhenCalculationConflicts,
  stripOptionReviewSection,
  extractCorrectAnswerSection,
  blocksClinicalSynthesisForCalculationConflict,
  renderClinicalCalculationConflictForStudent,
  formatClinicalCalculationAudit,
} from "../src/lib/clinical-calculations.js";
import { reconcileLesson, assessSolve } from "../src/lib/solvecheck.js";

const eq = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

test("structured numeric data is parsed with exact units", () => {
  const facts = parseClinicalData("Na=140 mmol/L; Glucose=90 mg/dL; BUN=14 mg/dL; MAP=70 mmHg");
  assert.equal(facts.na.value, 140);
  assert.equal(facts.glucose.unit, "mg/dL");
  assert.equal(facts.map.unit, "mmHg");
});

test("OCR extractor independently reads labelled lab/vital values when units are explicit", () => {
  const extracted = extractLabelledClinicalData("Sodium 140 mmol/L, glucose 90 mg/dL, BUN 14 mg/dL, measured serum osmolality 300 mOsm/kg, MAP 70 mmHg and CVP 10 mmHg.");
  const facts = parseClinicalData(extracted);
  assert.equal(facts.na.value, 140);
  assert.equal(facts.glucose.value, 90);
  assert.equal(facts.measuredosm.value, 300);
  assert.equal(facts.cvp.value, 10);
});

test("Fick CO and SVR are independently recomputed with explicit unit conversion", () => {
  const audit = auditClinicalCalculations({
    dataText: "VO2=250 mL/min; CaO2=20 mL/dL; CvO2=15 mL/dL; MAP=70 mmHg; CVP=10 mmHg",
    contextText: "Fick principle and systemic vascular resistance (SVR)",
  });
  eq(audit.results.find((x) => x.id === "co").value, 5);
  eq(audit.results.find((x) => x.id === "svr").value, 960);
  assert.equal(audit.conflicts.length, 0);
});

test("reported SVR that differs from deterministic calculation becomes a hard conflict", () => {
  const audit = auditClinicalCalculations({
    dataText: "VO2=250 mL/min; CaO2=20 mL/dL; CvO2=15 mL/dL; MAP=70 mmHg; CVP=10 mmHg",
    contextText: "Fick principle and SVR",
    narrative: "The calculated SVR = 560 dyn·s/cm⁵.",
  });
  assert.ok(audit.conflicts.some((x) => x.code === "reported-svr-mismatch"));
});

test("MAP approximation that omits the doubled diastolic pressure is rejected", () => {
  const audit = auditClinicalCalculations({
    narrative: "MAP = (SBP + DBP) / 3",
    contextText: "Systemic vascular resistance calculation",
  });
  assert.ok(audit.conflicts.some((x) => x.code === "map-formula-missing-diastolic-weight"));
});

test("osmolality uses 2 times sodium, not sodium once", () => {
  const audit = auditClinicalCalculations({
    dataText: "Na=140 mmol/L; Glucose=90 mg/dL; BUN=14 mg/dL; MeasuredOsm=300 mOsm/kg",
    contextText: "Osmolal gap calculation",
  });
  eq(audit.results.find((x) => x.id === "calculated-osmolality").value, 290);
  eq(audit.results.find((x) => x.id === "og").value, 10);
});

test("a displayed osmolality formula missing the sodium coefficient is rejected", () => {
  const audit = auditClinicalCalculations({
    dataText: "Na=140 mmol/L; Glucose=90 mg/dL; BUN=14 mg/dL; MeasuredOsm=300 mOsm/kg",
    contextText: "Osmolal gap",
    calcText: "Calculated osmolality = Na + Glucose/18 + BUN/2.8",
  });
  assert.ok(audit.conflicts.some((x) => x.code === "osmolality-missing-sodium-counterion"));
});

test("urea and BUN mg/dL use different conversion divisors", () => {
  const bun = auditClinicalCalculations({ dataText: "Na=140 mmol/L; Glucose=90 mg/dL; BUN=14 mg/dL; MeasuredOsm=300 mOsm/kg", contextText: "osmolal gap" });
  const urea = auditClinicalCalculations({ dataText: "Na=140 mmol/L; Glucose=90 mg/dL; Urea=30 mg/dL; MeasuredOsm=300 mOsm/kg", contextText: "osmolal gap" });
  eq(bun.results.find((x) => x.id === "calculated-osmolality").value, 290);
  eq(urea.results.find((x) => x.id === "calculated-osmolality").value, 290);
});

test("ethanol prevents an unadjusted residual osmolal gap unless its validated divisor is explicit", () => {
  const incomplete = auditClinicalCalculations({
    dataText: "Na=140 mmol/L; Glucose=90 mg/dL; BUN=14 mg/dL; MeasuredOsm=300 mOsm/kg; Ethanol=46 mg/dL",
    contextText: "osmolal gap",
    narrative: "OG = 10 mOsm/kg",
  });
  assert.ok(!incomplete.results.some((x) => x.id === "og"));
  assert.ok(incomplete.conflicts.some((x) => x.code === "og-without-inputs"));
  const complete = auditClinicalCalculations({
    dataText: "Na=140 mmol/L; Glucose=90 mg/dL; BUN=14 mg/dL; MeasuredOsm=300 mOsm/kg; Ethanol=46 mg/dL; EthanolDivisor=4.6",
    authorityDataText: "EthanolDivisor=4.6 coefficient",
    contextText: "osmolal gap",
  });
  assert.ok(complete.results.some((x) => x.id === "og"));
});

test("anion gap correction and Winter assessment are conditional on actual values", () => {
  const audit = auditClinicalCalculations({
    dataText: "Na=140 mmol/L; Chloride=100 mmol/L; HCO3=12 mmol/L; Albumin=2 g/dL; PaCO2=20 mmHg",
    contextText: "acid-base metabolic acidosis with Winter formula",
  });
  eq(audit.results.find((x) => x.id === "ag").value, 28);
  eq(audit.results.find((x) => x.id === "corrected-ag").value, 33);
  eq(audit.results.find((x) => x.id === "winter").value, 26);
  assert.ok(audit.notes.some((x) => x.includes("additional respiratory alkalosis")));
});

test("triple acid-base diagnosis is rejected when required patient measurements are absent", () => {
  const audit = auditClinicalCalculations({
    narrative: "The case demonstrates triple high-anion-gap metabolic acidosis, metabolic alkalosis, and primary respiratory alkalosis.",
    contextText: "acid-base disorder and osmolal gap",
  });
  assert.ok(audit.conflicts.some((x) => x.code === "triple-acid-base-without-inputs"));
});

test("CVVH model keeps fu and sieving coefficient separate; it never silently substitutes SC=fu", () => {
  const independent = auditClinicalCalculations({
    dataText: "fu=0.2; CLint=10 L/h; Qeff=2 L/h; SC=0.1; Cssu=1 mg/L",
    contextText: "low-extraction restrictive drug with hypoalbuminemia during CVVH, protein binding",
  });
  eq(independent.results.find((x) => x.id === "r0").value, 11);
  const relation = auditClinicalCalculations({
    dataText: "fu=0.2; CLint=10 L/h; Qeff=2 L/h; SC_equals_fu=1; Cssu=1 mg/L",
    authorityDataText: "scequalsfu=1 relationship",
    contextText: "low-extraction restrictive drug with hypoalbuminemia during CVVH, protein binding",
  });
  eq(relation.results.find((x) => x.id === "r0").value, 12);
  assert.match(relation.results.find((x) => x.id === "r0").formula, /SC=fu explicitly established/);
});

test("SC=fu counterfactual cannot change R0 solely because albumin normalises", () => {
  const audit = auditClinicalCalculations({
    dataText: "fu=0.2; CLint=10 L/h; Qeff=2 L/h; SC_equals_fu=1; Cssu=1 mg/L",
    authorityDataText: "scequalsfu=1 relationship",
    contextText: "low-extraction restrictive drug CVVH hypoalbuminemia protein binding",
    narrative: "SC = fu. fu cancels when targeting the same unbound concentration. R0 = 45 mg/hr. If albumin returns to normal, R0 = 90 mg/hr.",
  });
  assert.ok(audit.conflicts.some((x) => x.code === "fu-cancellation-counterfactual-conflict"));
});

test("fu cancellation is rejected as overgeneralized when SC is independent", () => {
  const audit = auditClinicalCalculations({
    dataText: "fu=0.2; CLint=10 L/h; Qeff=2 L/h; SC=0.1; Cssu=1 mg/L",
    contextText: "low-extraction restrictive drug CVVH hypoalbuminemia protein binding",
    narrative: "fu cancels from R0 in this CVVH model.",
  });
  assert.ok(audit.conflicts.some((x) => x.code === "fu-cancellation-assumption"));
});

test("no infusion rate is accepted without complete drug-specific PK/CRRT values", () => {
  const audit = auditClinicalCalculations({
    narrative: "The maintenance infusion rate R0 = 45 mg/hr.",
    contextText: "restrictive low-extraction drug, CVVH, hypoalbuminemia and protein binding",
  });
  assert.ok(audit.conflicts.some((x) => x.code === "r0-without-inputs"));
});

test("assay-specific D-lactate language is required", () => {
  const bad = auditClinicalCalculations({ narrative: "All point-of-care lactate devices detect only L-lactate and miss D-lactate.", contextText: "D-lactate propylene glycol" });
  assert.ok(bad.conflicts.some((x) => x.code === "lactate-assay-overgeneralization"));
  const qualified = auditClinicalCalculations({ narrative: "This L-lactate oxidase method does not quantify D-lactate; check the specific analyser.", contextText: "D-lactate propylene glycol" });
  assert.equal(qualified.conflicts.length, 0);
});

test("persistent bleeding after Pringle is a suspicion, not proof", () => {
  const bad = auditClinicalCalculations({ narrative: "Persistent bleeding after Pringle proves the source is the retrohepatic IVC.", contextText: "Pringle maneuver and persistent bleeding" });
  assert.ok(bad.conflicts.some((x) => x.code === "pringle-overclaim"));
  const qualified = auditClinicalCalculations({ narrative: "Persistent bleeding after Pringle raises suspicion for hepatic-vein or retrohepatic IVC injury; consider aberrant arterial inflow.", contextText: "Pringle maneuver" });
  assert.equal(qualified.conflicts.length, 0);
});

test("independent OCR, solver, and lesson data extractions must not disagree", () => {
  const audit = auditClinicalCalculations({
    dataText: "Na=140 mmol/L; Glucose=90 mg/dL; BUN=14 mg/dL; MeasuredOsm=300 mOsm/kg",
    secondaryDataText: ["Na=140 mmol/L; Glucose=90 mg/dL; BUN=14 mg/dL; MeasuredOsm=300 mOsm/kg", "Na=140 mmol/L; Glucose=90 mg/dL; BUN=14 mg/dL; MeasuredOsm=336 mOsm/kg"],
    contextText: "osmolal gap",
  });
  assert.ok(audit.conflicts.some((x) => x.code === "extraction-measuredosm-mismatch"));
});

test("private clinical data blocks are extracted and never exposed, including partial streams", () => {
  const raw = "Lesson text\n===CLINICAL_DATA===\nNa=140 mmol/L\n===END_CLINICAL_DATA===\nMore";
  const block = extractClinicalDataBlock(raw);
  assert.equal(block.found, true);
  assert.equal(block.dataText, "Na=140 mmol/L");
  assert.equal(block.text, "Lesson text\n\nMore");
  assert.equal(stripPartialClinicalDataBlock("Safe text\n===CLINICAL_DATA===\nNa=140"), "Safe text");
});

test("option correctness marks are masked when an independent calculation conflicts", () => {
  const out = maskOptionsWhenCalculationConflicts("## 🔍 Every option\nA) **answer** ✅ — chosen\nB) **other** ❌ — other");
  assert.match(out, /A\) \*\*answer\*\* ⚠️/);
  assert.match(out, /B\) \*\*other\*\* ❌/);
});

test("solver assessment catches a numerical option that conflicts with independently computed SVR", () => {
  const raw = [
    "PREMISE: Low resistance after calculating cardiac output.",
    "ANSWER: A", "TYPE: calculation", "KEYWORD: calculate", "CONCEPTS: Fick; SVR",
    "DATA: VO2=250 mL/min; CaO2=20 mL/dL; CvO2=15 mL/dL; MAP=70 mmHg; CVP=10 mmHg",
    "OPTIONS:", "A) ✅ SVR = 560 dyn·s/cm⁵", "B) ❌ SVR = 960 dyn·s/cm⁵", "CALC: SVR = 560", "CONFIDENCE: high",
  ].join("\n");
  const a = assessSolve({ raw, stem: "Use Fick principle to calculate SVR.", sourceDataText: "VO2=250 mL/min; CaO2=20 mL/dL; CvO2=15 mL/dL; MAP=70 mmHg; CVP=10 mmHg", profile: { discipline: "general", exam: "", region: "" } });
  assert.equal(a.tier, "LOW");
  assert.ok(a.clinicalCalculationAudit.conflicts.some((x) => x.code === "reported-svr-mismatch"));
});

test("lesson reconciliation blocks a selected answer even when no solve answer is available", () => {
  const conflict = { code: "r0-without-inputs", message: "R0 cannot be independently calculated from supplied inputs." };
  const text = "## 🔍 Every option\nA) **A** ✅ — picked\nB) **B** ❌ — no\n## ✅ The correct answer\n- **A)** correct";
  const out = reconcileLesson(text, { answer: "", clinicalCalculationAudit: { conflicts: [conflict] } }, "en");
  assert.equal(out.calculationConflict, true);
  assert.match(out.text, /No answer choice is confirmed/);
  assert.match(out.text, /A\) \*\*A\*\* ⚠️/);
});

test("consistent values are merged across independent extractors when one source omits a labelled input", () => {
  const audit = auditClinicalCalculations({
    dataText: "Na=140 mmol/L; Glucose=90 mg/dL",
    secondaryDataText: ["Na=140 mmol/L; Glucose=90 mg/dL; BUN=14 mg/dL", "MeasuredOsm=300 mOsm/kg; BUN=14 mg/dL"],
    contextText: "osmolal gap",
  });
  assert.equal(audit.conflicts.length, 0);
  assert.equal(audit.results.find((x) => x.id === "og")?.value, 10);
});

test("disagreements between two secondary extractors are detected even when the primary omitted that field", () => {
  const audit = auditClinicalCalculations({
    dataText: "Na=140 mmol/L; Glucose=90 mg/dL",
    secondaryDataText: ["MeasuredOsm=300 mOsm/kg", "MeasuredOsm=336 mOsm/kg", "BUN=14 mg/dL"],
    contextText: "osmolal gap",
    narrative: "OG = 36 mOsm/kg",
  });
  assert.ok(audit.conflicts.some((x) => x.code === "extraction-measuredosm-mismatch"));
  assert.ok(!audit.results.some((x) => x.id === "og"));
});

test("full Fick oxygen contents are calculated only from supplied Hb, saturations and PO2 values", () => {
  const audit = auditClinicalCalculations({
    dataText: "VO2=250 mL/min; Hb=15 g/dL; SaO2=98 %; PaO2=100 mmHg; SvO2=75 %; PvO2=40 mmHg; MAP=70 mmHg; CVP=10 mmHg",
    contextText: "Fick principle and systemic vascular resistance",
  });
  assert.ok(audit.results.some((x) => x.id === "cao2"));
  assert.ok(audit.results.some((x) => x.id === "cvo2"));
  assert.ok(audit.results.some((x) => x.id === "co"));
  assert.ok(audit.results.some((x) => x.id === "svr"));
});

test("point-of-care lactate statements that imply an L-only assay universally are flagged even without all/every wording", () => {
  const audit = auditClinicalCalculations({
    narrative: "Point-of-care lactate meters use L-lactate oxidase and detect only L-lactate, missing D-lactate.",
    contextText: "propylene glycol toxicity D-lactate point-of-care lactate",
  });
  assert.ok(audit.conflicts.some((x) => x.code === "lactate-assay-overgeneralization"));
});

test("measured osmolarity is not silently treated as measured osmolality", () => {
  const audit = auditClinicalCalculations({
    dataText: "Na=140 mmol/L; Glucose=90 mg/dL; BUN=14 mg/dL; MeasuredOsmolarity=300 mOsm/L",
    contextText: "osmolal gap",
    narrative: "OG = 10 mOsm/kg",
  });
  assert.ok(!audit.results.some((x) => x.id === "og"));
  assert.ok(audit.conflicts.some((x) => x.code === "og-without-inputs"));
});

test("SC=fu cannot be smuggled into the solver DATA line without independent OCR confirmation", () => {
  const audit = auditClinicalCalculations({
    dataText: "fu=0.2; CLint=10 L/h; Qeff=2 L/h; SC_equals_fu=1; Cssu=1 mg/L",
    contextText: "low-extraction restrictive drug CVVH protein binding",
  });
  assert.ok(audit.conflicts.some((x) => x.code === "sc-fu-relation-unverified"));
  assert.ok(!audit.results.some((x) => x.id === "r0"));
});

test("the OCR source parser captures explicit PK constants and SC=fu relation for independent confirmation", () => {
  const extracted = extractLabelledClinicalData("fu 0.2, SC equals fu, intrinsic clearance 10 L/h, delivered Qeff 2 L/h, unbound Css 1 mg/L and ethanol divisor 4.6");
  const facts = parseClinicalData(extracted);
  assert.equal(facts.fu.value, 0.2);
  assert.equal(facts.scequalsfu.value, 1);
  assert.equal(facts.clint.value, 10);
  assert.equal(facts.qeff.value, 2);
  assert.equal(facts.cssu.value, 1);
  assert.equal(facts.ethanoldivisor.value, 4.6);
});

test("a model-invented ethanol divisor is rejected even when a numeric divisor is present in DATA", () => {
  const audit = auditClinicalCalculations({
    dataText: "Na=140 mmol/L; Glucose=90 mg/dL; BUN=14 mg/dL; MeasuredOsm=300 mOsm/kg; Ethanol=46 mg/dL; EthanolDivisor=4.6",
    contextText: "osmolal gap",
  });
  assert.ok(audit.conflicts.some((x) => x.code === "ethanol-divisor-unverified"));
  assert.ok(!audit.results.some((x) => x.id === "og"));
});


test("numeric answer audit ignores intentionally incorrect distractors and checks the selected answer", () => {
  const audit = auditClinicalCalculations({
    dataText: "VO2=250 mL/min; CaO2=20 mL/dL; CvO2=15 mL/dL; MAP=70 mmHg; CVP=10 mmHg",
    contextText: "Fick principle and systemic vascular resistance",
    answerText: "A) SVR = 960 dyn·s/cm⁵",
    optionText: "A) selected correct option",
  });
  assert.equal(audit.conflicts.length, 0);
});

test("option review text is excluded from claim audit while the correct answer section is retained", () => {
  const text = "## شرح الحساب\nSVR = 960\n## 🔍 كل اختيار لوحده\nA) SVR = 960\nB) SVR = 577\n## ✅ الإجابة الصح\nA) SVR = 960\n## التريكات\nPringle does not prove one source.";
  const stripped = stripOptionReviewSection(text);
  assert.ok(!stripped.includes("B) SVR = 577"));
  assert.ok(stripped.includes("A) SVR = 960"));
  assert.match(extractCorrectAnswerSection(text), /A\) SVR = 960/);
});

test("a hard calculation conflict triggers the audit even when no domain result can be computed", () => {
  const audit = auditClinicalCalculations({
    dataText: "SC_equals_fu=1",
    authorityDataText: "",
    narrative: "The CVVH protein-binding model states fu cancels in the infusion equation.",
  });
  assert.ok(audit.conflicts.some((x) => x.code === "sc-fu-relation-unverified"));
  assert.equal(audit.triggered, true);
});


test("CVVH fu cancellation guard catches a hypothetical R0 change phrased as 'would become'", () => {
  const audit = auditClinicalCalculations({
    dataText: "fu=0.2; CLint=10 L/h; Qeff=2 L/h; SC_equals_fu=1; Cssu=1 mg/L",
    authorityDataText: "scequalsfu=1 relationship",
    contextText: "low-extraction restrictive drug CVVH hypoalbuminemia protein binding",
    answerText: "A) R₀ = 45 mg/hr",
    narrative: "SC = fu, so fu cancels for the same unbound target. If albumin returns to normal, R₀ would become 90 mg/hr.",
  });
  assert.ok(audit.conflicts.some((x) => x.code === "fu-cancellation-counterfactual-conflict"));
});


test("production mode requires OCR corroboration for every critical calculation input", () => {
  const data = "VO2=250 mL/min; CaO2=20 mL/dL; CvO2=15 mL/dL; MAP=70 mmHg; CVP=10 mmHg";
  const uncorroborated = auditClinicalCalculations({
    dataText: data,
    modelDataText: data,
    contextText: "Fick principle and systemic vascular resistance",
    narrative: "SVR = 960 dyn.s/cm5",
    requireAuthorityInputs: true,
  });
  assert.ok(uncorroborated.conflicts.some((x) => x.code === "clinical-inputs-not-independently-confirmed"));
  assert.ok(!uncorroborated.results.some((x) => x.id === "svr"));
  const corroborated = auditClinicalCalculations({
    dataText: data,
    modelDataText: data,
    authorityDataText: data,
    contextText: "Fick principle and systemic vascular resistance",
    answerText: "A) SVR = 960 dyn.s/cm5",
    requireAuthorityInputs: true,
  });
  assert.ok(corroborated.results.some((x) => x.id === "svr"));
  assert.equal(corroborated.conflicts.length, 0);
});

test("OCR corroboration must include every input, not only some values in a calculation", () => {
  const audit = auditClinicalCalculations({
    dataText: "Na=140 mmol/L; Glucose=90 mg/dL; BUN=14 mg/dL; MeasuredOsm=300 mOsm/kg",
    modelDataText: "Na=140 mmol/L; Glucose=90 mg/dL; BUN=14 mg/dL; MeasuredOsm=300 mOsm/kg",
    authorityDataText: "Na=140 mmol/L; Glucose=90 mg/dL; BUN=14 mg/dL",
    contextText: "osmolal gap",
    answerText: "OG = 10 mOsm/kg",
    requireAuthorityInputs: true,
  });
  assert.ok(audit.conflicts.some((x) => x.code === "clinical-inputs-not-independently-confirmed"));
  assert.ok(!audit.results.some((x) => x.id === "og"));
});


test("OCR value labels accept natural-language 'is' phrasing without losing units", () => {
  const facts = parseClinicalData(extractLabelledClinicalData("Sodium is 140 mmol/L, glucose is 90 mg/dL, BUN is 14 mg/dL, measured serum osmolality is 300 mOsm/kg, MAP is 70 mmHg and CVP is 10 mmHg."));
  assert.equal(facts.na.value, 140);
  assert.equal(facts.glucose.value, 90);
  assert.equal(facts.measuredosm.value, 300);
  assert.equal(facts.map.value, 70);
  assert.equal(facts.cvp.value, 10);
});

test("the supplied critical-care failure pattern is caught across formulas, unsupported numbers and overclaims", () => {
  const audit = auditClinicalCalculations({
    contextText: "Fick principle SVR osmolal gap acid-base CVVH hypoalbuminemia propylene glycol D-lactate point-of-care lactate Pringle bleeding",
    answerText: "A) SVR = 560 dyn.s/cm5; OG = 36 mOsm/kg; R₀ = 45 mg/hr",
    narrative: [
      "Calculated Osmolality = Na + Glucose/18 + BUN/2.8.",
      "A triple acid-base disorder is confirmed.",
      "The point-of-care lactate assay detects only L-lactate and misses D-lactate.",
      "Persistent bleeding after Pringle proves the only source is the retrohepatic IVC.",
      "SC = fu, so fu cancels. If albumin returns to normal, R₀ would become 90 mg/hr.",
    ].join("\n"),
    requireAuthorityInputs: true,
  });
  const codes = new Set(audit.conflicts.map((x) => x.code));
  for (const code of [
    "clinical-inputs-not-independently-confirmed",
    "osmolality-missing-sodium-counterion",
    "triple-acid-base-without-inputs",
    "lactate-assay-overgeneralization",
    "pringle-overclaim",
    "fu-cancellation-counterfactual-conflict",
    "svr-without-inputs",
    "og-without-inputs",
    "r0-without-inputs",
  ]) assert.ok(codes.has(code), `missing expected guard: ${code}`);
  assert.equal(audit.status, "conflict");
  assert.equal(audit.results.length, 0);
});


test("Arabic triple acid-base wording activates the complete mixed-disorder guard", () => {
  const audit = auditClinicalCalculations({
    dataText: "Na=140 mmol/L; Chloride=90 mmol/L; HCO3=18 mmol/L; pH=7.50; PaCO2=35 mmHg",
    contextText: "اضطراب ثلاثي في الأحماض والقواعد",
    narrative: "الحالة فيها اضطراب ثلاثي في الأحماض والقواعد.",
  });
  assert.ok(audit.conflicts.some((x) => x.code === "triple-acid-base-not-supported"));
});

test("a triple acid-base claim is supported only when delta gap and Winter independently support both added disorders", () => {
  const supported = auditClinicalCalculations({
    dataText: "Na=140 mmol/L; Chloride=90 mmol/L; HCO3=18 mmol/L; Albumin=2 g/dL; pH=7.50; PaCO2=20 mmHg",
    contextText: "triple acid-base disorder: high anion gap metabolic acidosis, metabolic alkalosis and Winter compensation",
    narrative: "A triple disorder is present.",
  });
  assert.ok(supported.results.some((x) => x.id === "delta-gap" && x.value > 6));
  assert.ok(supported.results.some((x) => x.id === "winter"));
  assert.ok(!supported.conflicts.some((x) => x.code === "triple-acid-base-not-supported"));

  const unsupported = auditClinicalCalculations({
    dataText: "Na=140 mmol/L; Chloride=110 mmol/L; HCO3=10 mmol/L; Albumin=4 g/dL; pH=7.30; PaCO2=35 mmHg",
    contextText: "triple acid-base disorder: high anion gap metabolic acidosis, metabolic alkalosis and Winter compensation",
    narrative: "A triple disorder is present.",
  });
  assert.ok(unsupported.conflicts.some((x) => x.code === "triple-acid-base-not-supported"));
});

test("ECMO arterial-site and blood-sample qualifiers prevent false numeric-conflict alarms", () => {
  const stem = [
    "Right Radial Arterial Line: BP 104/46 mmHg (MAP 65 mmHg), SpO2 (Right Ear/Finger): 69%.",
    "Left Femoral/Pedal Doppler & Left Toe Pulse Oximetry: non-pulsatile flow, MAP 82 mmHg, SpO2 (Left Great Toe): 99%.",
    "Right Radial ABG: pH 7.16, PaCO2 54 mmHg, PaO2 39 mmHg, HCO3 19 mEq/L, Lactate 11.2 mmol/L.",
    "ECMO Post-Oxygenator ABG: pH 7.42, PaCO2 34 mmHg, PaO2 460 mmHg.",
  ].join("\n");
  const extracted = extractLabelledClinicalData(stem);
  const parsed = parseClinicalDataDiagnostics(extracted);
  assert.equal(parsed.duplicates.length, 0, "different sites/samples must not be collapsed into one duplicate field");
  assert.equal(parsed.facts.maprightradial.value, 65);
  assert.equal(parsed.facts.mapleftfemoralpedal.value, 82);
  assert.equal(parsed.facts.phrightradial.value, 7.16);
  assert.equal(parsed.facts.phecmopostoxygenator.value, 7.42);
  assert.equal(parsed.facts.pao2rightradial.value, 39);
  assert.equal(parsed.facts.pao2ecmopostoxygenator.value, 460);

  const audit = auditClinicalCalculations({
    dataText: extracted,
    modelDataText: extracted,
    authorityDataText: extracted,
    contextText: `${stem} Distractor E mentions continuous renal replacement therapy (CRRT); distractor D mentions 2 L of 5% albumin.`,
    answerText: "B) Address differential hypoxemia with a tailored V-AV ECMO configuration.",
    requireAuthorityInputs: true,
  });
  assert.deepEqual(audit.conflicts, []);
  assert.equal(audit.domains.crRT, true, "CRRT distractor is seen as text");
  assert.equal(audit.domains.proteinPK, false, "plain albumin in a distractor is not drug protein-binding pharmacokinetics");
  assert.equal(audit.triggered, false, "unrelated distractor terms must not start a drug infusion calculation");
});

test("same-site repeated readings remain a real conflict after site scoping", () => {
  const extracted = extractLabelledClinicalData("Right Radial Arterial Line MAP 65 mmHg; right radial repeat MAP 58 mmHg.");
  const report = parseClinicalDataDiagnostics(extracted);
  assert.equal(report.duplicates.length, 1);
  assert.equal(report.duplicates[0].key, "maprightradial");
});

test("unwrapped pipe-separated temporal lab tables preserve current and historical columns", () => {
  const source = `Open-ended clinical case (not a multiple-choice examination).\nParameter | Historical baseline (2 months ago) | Current sample\nHemoglobin | 11.2 g/dL | 7.6 g/dL\nCreatinine | 1.3 mg/dL | 3.1 mg/dL\nSodium | 137 mmol/L | 129 mmol/L\nChloride | 101 mmol/L | 94 mmol/L\nBicarbonate | 24 mmol/L | 14 mmol/L\nBlood pressure: 82/48 mmHg\nAlbumin: 2.6 g/dL`;
  const extracted = extractLabelledClinicalData(source);
  const facts = parseClinicalData(extracted);
  assert.equal(facts.na.value, 129);
  assert.equal(facts.nabaseline.value, 137);
  assert.equal(facts.chloride.value, 94);
  assert.equal(facts.chloridebaseline.value, 101);
  assert.equal(facts.hco3.value, 14);
  assert.equal(facts.hco3baseline.value, 24);
  assert.equal(facts.hb.value, 7.6);
  assert.equal(facts.hbbaseline.value, 11.2);
  assert.equal(facts.creatinine.value, 3.1);
  assert.equal(facts.creatininebaseline.value, 1.3);
  assert.equal(facts.sbp.value, 82);
  assert.equal(facts.dbp.value, 48);

  const modelData = "SBP=82 mmHg; DBP=48 mmHg; Hb=7.6 g/dL; Na=129 mmol/L; Chloride=94 mmol/L; HCO3=14 mmol/L; Albumin=2.6 g/dL";
  const audit = auditClinicalCalculations({
    dataText: modelData,
    secondaryDataText: extracted,
    authorityDataText: extracted,
    modelDataText: modelData,
    requireAuthorityInputs: true,
    contextText: `${source} Calculate the anion gap and assess metabolic acidosis.`,
  });
  assert.equal(audit.conflicts.length, 0);
  assert.equal(audit.sourceVerification.missingSourceFields.length, 0);
  assert.equal(audit.results.find((x) => x.id === "ag").value, 21);
  assert.equal(audit.results.find((x) => x.id === "corrected-ag").value, 24.5);
});


test("merging partial source readings keeps complementary fields and preserves disagreements", () => {
  const visionText = "Sodium 129 mmol/L; Chloride 94 mmol/L";
  const documentText = "Bicarbonate 14 mmol/L; Sodium 129 mmol/L";
  const mergedSource = mergeOriginalSourceText(visionText, documentText);
  assert.match(mergedSource, /Sodium 129/);
  assert.match(mergedSource, /Bicarbonate 14/);
  const readings = mergeExtractedClinicalData(
    extractLabelledClinicalData(visionText),
    extractLabelledClinicalData(documentText),
  );
  const audit = auditClinicalCalculations({
    dataText: "Na=129 mmol/L; Chloride=94 mmol/L; HCO3=14 mmol/L",
    secondaryDataText: [extractLabelledClinicalData(visionText), extractLabelledClinicalData(documentText)],
    authorityDataText: readings,
    modelDataText: "Na=129 mmol/L; Chloride=94 mmol/L; HCO3=14 mmol/L",
    requireAuthorityInputs: true,
    contextText: "anion gap metabolic acidosis",
  });
  assert.equal(audit.conflicts.length, 0);

  const disagree = mergeExtractedClinicalData(
    extractLabelledClinicalData("Sodium 129 mmol/L"),
    extractLabelledClinicalData("Sodium 137 mmol/L"),
  );
  const blocked = auditClinicalCalculations({
    dataText: "Na=129 mmol/L; Chloride=94 mmol/L; HCO3=14 mmol/L",
    authorityDataText: disagree,
    modelDataText: "Na=129 mmol/L; Chloride=94 mmol/L; HCO3=14 mmol/L",
    requireAuthorityInputs: true,
    contextText: "anion gap metabolic acidosis",
  });
  assert.ok(blocked.conflicts.some((x) => x.code === "within-source-na-ambiguous"));
});


test("final audit replaces an identical preliminary warning instead of duplicating it", () => {
  const first = [{ code: "clinical-calculation", msg: "same warning" }, { code: "other", msg: "keep me" }];
  const final = [{ code: "specific-conflict", msg: "same warning" }];
  assert.deepEqual(replaceAuditItemsByMessage(first, final, (item) => item.msg), [
    { code: "other", msg: "keep me" },
    { code: "specific-conflict", msg: "same warning" },
  ]);
});


test("model-reported anion gap 129 is caught against the independent 21 / corrected 24.5 calculation and blocks clinical synthesis", () => {
  const modelData = "Na=129 mmol/L; Chloride=94 mmol/L; HCO3=14 mmol/L; Albumin=2.6 g/dL";
  const audit = auditClinicalCalculations({
    dataText: modelData,
    secondaryDataText: modelData,
    authorityDataText: modelData,
    modelDataText: modelData,
    requireAuthorityInputs: true,
    narrative: "Anion gap: 129 mmol/L.",
    answerText: "The anion gap is 129 mmol/L.",
    contextText: "Open-ended critical care clinical case with metabolic acidosis and anion gap calculation.",
  });
  assert.equal(audit.results.find((x) => x.id === "ag").value, 21);
  assert.equal(audit.results.find((x) => x.id === "corrected-ag").value, 24.5);
  assert.ok(audit.conflicts.some((x) => x.code === "reported-ag-mismatch"));
  assert.equal(blocksClinicalSynthesisForCalculationConflict(audit, true), true);
  assert.equal(blocksClinicalSynthesisForCalculationConflict(audit, false), false);
  assert.match(audit.results.find((x) => x.id === "ag").formula, /129 − \(94 \+ 14\)/);
  assert.match(formatClinicalCalculationAudit(audit), /129 − \(94 \+ 14\)/);
  const rendered = renderClinicalCalculationConflictForStudent(audit, "en");
  assert.match(rendered, /Anion gap: 21 mmol\/L/);
  assert.match(rendered, /Albumin-corrected anion gap: 24.5 mmol\/L/);
  assert.match(rendered, /reports 129 mmol\/L/);
});

test("an unsupported anion-gap number without Na, chloride and bicarbonate is flagged and blocks a clinical open case", () => {
  const audit = auditClinicalCalculations({
    dataText: "Albumin=2.6 g/dL",
    modelDataText: "Albumin=2.6 g/dL",
    contextText: "Open-ended clinical case: anion gap and metabolic acidosis",
    narrative: "The anion gap is 129 mmol/L.",
  });
  assert.ok(audit.conflicts.some((x) => x.code === "ag-without-inputs"));
  assert.equal(blocksClinicalSynthesisForCalculationConflict(audit, true), true);
});
