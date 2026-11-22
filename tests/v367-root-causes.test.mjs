/* ClinixStudy v3.67.0 · regression tests for every reproduced failure + cross-specialty generalisation.
   Each test names the v3.66.0 behaviour it pins down. Numbers below are checked against the deterministic engine, never hard-coded into it. */
import test from "node:test";
import assert from "node:assert/strict";
import { extractClaims, verifyClaims } from "../src/lib/calc-claims.js";
import { extractMeasurements } from "../src/lib/clinical-measurements.js";
import { evalExpr } from "../src/lib/arith.js";
import {
  auditClinicalCalculations, extractLabelledClinicalData, parseClinicalData, parseClinicalDataDiagnostics, groundedInSource,
  blocksClinicalSynthesisForCalculationConflict, isBlockingConflict, replaceAuditItemsByMessage, buildPreGenerationCalculationHandoff,
} from "../src/lib/clinical-calculations.js";
import { assessSolve, banner } from "../src/lib/solvecheck.js";
import { lessonView, filterTrustForBlockedClinicalSynthesis } from "../src/lib/studentview.js";
import { buildSystem, CLINICAL_WITHHELD_NOTE } from "../src/lib/chat.js";
import { runCase, briefWith, FULL_DATA, GOOD_CALC, lessonText, CASE_TEXT } from "./helpers-e2e.mjs";

const DATA = "na=129 mmol/L; chloride=94 mmol/L; hco3=14 mmol/L; albumin=2.6 g/dL; paco2=30 mmHg; sbp=82 mmHg; dbp=48 mmHg; hb=7.6 g/dL; hbbaseline=11.2 g/dL; creatinine=3.1 mg/dL; creatininebaseline=1.3 mg/dL";
const audit = (text, extra = {}) => auditClinicalCalculations({ dataText: DATA, authorityDataText: DATA, modelDataText: DATA, requireAuthorityInputs: true, answerText: text, narrative: text, contextText: "metabolic acidosis anion gap Winter MAP", ...extra });
const codes = (a) => a.conflicts.map((c) => c.code);

/* ───────── ROOT CAUSE 1 · the verifier read the first OPERAND of a worked formula as the reported result ───────── */
test("RC1 correct worked formulas are never read as «AG = 129» or «Winter = 1.5» (v3.59–v3.66 false positives)", () => {
  for (const t of [
    "Anion gap = 129 − (94 + 14) = 21 mmol/L",
    "AG = 129 - (94 + 14) = 21",
    "Anion gap = Na − (Cl + HCO3) = 129 − 108 = 21 mmol/L",
    "The anion gap is 129 − 108 = 21 mmol/L, markedly elevated.",
    "Anion Gap (AG): 129 − (94 + 14) = 21",
    "AG = 21 mmol/L (129 − 108)",
    "Winter expected PaCO2 = 1.5 × 14 + 8 = 29 mmHg",
    "Winter expected PaCO2 = 1.5×[HCO3] + 8 → 29",
    "Expected PaCO₂ (Winter) = 1.5 × 14 + 8 = 29 ± 2",
    "Winter's formula: expected PaCO2 = (1.5 × HCO3) + 8 = 29 mmHg",
    "Expected PaCO2 is 29 mmHg (range 27–31)",
    "Winter expected PaCO₂ = 29 mmHg (expected range 27–31 mmHg)",
  ]) assert.deepEqual(codes(audit(t)), [], t);
});

test("RC1 a worked formula without an explicit result is EVALUATED, not truncated to its first operand", () => {
  const c = extractClaims("Winter expected PaCO2 = 1.5 × 14 + 8");
  assert.equal(c[0].value, 29);
  assert.deepEqual(codes(audit("Winter expected PaCO2 = 1.5 × 14 + 8")), []);
  assert.ok(codes(audit("Winter expected PaCO2 = 1.5 × 14 + 18")).includes("reported-winter-mismatch"));
});

test("RC1 genuinely wrong results are still detected (no safety weakening)", () => {
  assert.ok(codes(audit("Anion gap = 129 mmol/L.")).includes("reported-ag-mismatch"));
  assert.ok(codes(audit("The anion gap is 18 mmol/L.")).includes("reported-ag-mismatch"));
  assert.ok(codes(audit("Expected PaCO2 is 40 mmHg (range 38–42)")).includes("reported-winter-mismatch"));
  assert.ok(codes(audit("Winter expected PaCO2 38–42 mmHg")).includes("reported-winter-mismatch"));
  assert.ok(codes(audit("The anion gap is 21. The albumin-corrected anion gap is 31 mmol/L.")).includes("reported-corrected-ag-mismatch"));
  assert.ok(codes(audit("MAP = 71 mmHg.")).includes("reported-map-mismatch"));
  assert.ok(codes(audit("Hemoglobin fell by 5.1 g/dL")).includes("reported-hb-decline-mismatch"));
});

test("RC1 an arithmetic error INSIDE displayed working is detected even when the final number is right", () => {
  assert.ok(codes(audit("Anion gap = 129 − 108 = 22")).includes("reported-ag-mismatch"));
  const a = audit("Anion gap = 100 − (94 + 14) + 29 = 21");
  assert.ok(!codes(a).includes("reported-ag-mismatch"));
  const b = audit("Anion gap = 129 − 100 = 21");
  assert.ok(codes(b).includes("reported-ag-arithmetic-inconsistent"));
});

test("RC1 AG and albumin-corrected AG are separate quantities (v3.66 compared the corrected value with the uncorrected AG)", () => {
  for (const t of [
    "The anion gap is 21 mmol/L. The albumin-corrected anion gap is 24.5 mmol/L.",
    "Albumin-corrected anion gap = 24.5 mmol/L.",
    "AG (albumin-corrected) = 21 + 2.5 × (4 − 2.6) = 24.5",
    "Corrected AG = 24.5; uncorrected AG = 21.",
  ]) assert.deepEqual(codes(audit(t)), [], t);
});

test("RC1 MAP, Hb decline, creatinine rise/fold are now verified (they were never compared before)", () => {
  assert.deepEqual(codes(audit("MAP = (82 + 2×48)/3 = 59.3 mmHg. MAP ≈ 59 mmHg.")), []);
  assert.deepEqual(codes(audit("Hemoglobin fell by 3.6 g/dL (11.2 to 7.6). Creatinine rose 2.4-fold; the creatinine rise of 1.8 mg/dL.")), []);
  assert.ok(codes(audit("Creatinine rose 4-fold from baseline.")).includes("reported-creatinine-ratio-mismatch"));
});

test("RC1 reference ranges, comparators and hypotheticals are not claims about this patient", () => {
  assert.deepEqual(extractClaims("A normal anion gap is 8–12 mmol/L."), []);
  assert.deepEqual(extractClaims("An anion gap > 20 suggests a primary metabolic acidosis."), []);
  assert.deepEqual(extractClaims("If the anion gap were 12 the picture would differ."), []);
  assert.deepEqual(extractClaims("Anion gap = Na − (Cl + HCO3)"), []);
});

test("RC1 every occurrence is checked, not only the first", () => {
  const a = audit("Anion gap = 21 mmol/L.\nLater in the plan: the anion gap is 129 mmol/L.");
  assert.ok(codes(a).includes("reported-ag-mismatch"));
});

test("RC1 shared evaluator: Unicode minus/multiplication, brackets, ± and units", () => {
  assert.equal(evalExpr("129 − (94 + 14)"), 21);
  assert.equal(evalExpr("1.5×[14] + 8 ± 2"), 29);
  assert.equal(evalExpr("(82 + 2 × 48) ÷ 3").toFixed(2), "59.33");
  assert.equal(evalExpr("Na − Cl"), null);
});

/* ───────── ROOT CAUSE 2 · time scope was decided per LINE, units had to be glued to the number ───────── */
test("RC2 «Baseline/current creatinine …» no longer turns every later value on the line into a baseline", () => {
  const f = parseClinicalData(extractLabelledClinicalData(CASE_TEXT));
  for (const k of ["na", "chloride", "hco3", "albumin", "paco2", "ph", "sbp", "dbp"]) assert.ok(f[k], `${k} must be a CURRENT reading`);
  assert.equal(f.na.value, 129); assert.equal(f.hco3.value, 14); assert.equal(f.paco2.value, 30);
  assert.equal(f.hb.value, 7.6); assert.equal(f.hbbaseline.value, 11.2);
  assert.equal(f.creatinine.value, 3.1); assert.equal(f.creatininebaseline.value, 1.3);
  assert.ok(!f.nabaseline && !f.paco2baseline && !f.hco3baseline);
});

test("RC2 unit placement and notation variants all read the same values", () => {
  for (const [text, key, value, unit] of [
    ["Na 129, Cl 94, HCO3 14 mmol/L", "na", 129, "mmol/L"],
    ["sodium 129 (mmol/L), chloride 94 (mmol/L)", "chloride", 94, "mmol/L"],
    ["sodium (mmol/L) 129", "na", 129, "mmol/L"],
    ["PaCO₂ was 30 mm Hg", "paco2", 30, "mmHg"],
    ["PaCO2 of 30 mmHg", "paco2", 30, "mmHg"],
    ["pCO2 30", "paco2", 30, "mmHg"],
    ["HCO₃⁻ 14 mEq/L", "hco3", 14, "mEq/L"],
    ["Blood pressure 82/48", "sbp", 82, "mmHg"],
    ["BP | 82/48 mmHg", "dbp", 48, "mmHg"],
    ["K+ 6.4 mmol/L", "potassium", 6.4, "mmol/L"],
  ]) {
    const f = parseClinicalData(extractLabelledClinicalData(text));
    assert.equal(f[key]?.value, value, `${text} → ${key}`);
    assert.equal(f[key]?.unit, unit, `${text} unit`);
  }
});

test("RC2 baseline/current expressed as pairs, «from … to …», parentheses, trailing cues and list headers", () => {
  const read = (t) => parseClinicalData(extractLabelledClinicalData(t));
  let f = read("Baseline/current hemoglobin 11.2/7.6 g/dL"); assert.equal(f.hbbaseline.value, 11.2); assert.equal(f.hb.value, 7.6);
  f = read("Current/baseline creatinine 3.1/1.3 mg/dL"); assert.equal(f.creatinine.value, 3.1); assert.equal(f.creatininebaseline.value, 1.3);
  f = read("Hemoglobin dropped from 11.2 to 7.6 g/dL"); assert.equal(f.hbbaseline.value, 11.2); assert.equal(f.hb.value, 7.6);
  f = read("Hb 7.6 g/dL (baseline 11.2 g/dL)"); assert.equal(f.hb.value, 7.6); assert.equal(f.hbbaseline.value, 11.2);
  f = read("Baseline creatinine 1.3 mg/dL, current creatinine 3.1 mg/dL"); assert.equal(f.creatininebaseline.value, 1.3); assert.equal(f.creatinine.value, 3.1);
  f = read("Creatinine 1.3 mg/dL two months ago and 3.1 mg/dL now"); assert.equal(f.creatininebaseline.value, 1.3); assert.equal(f.creatinine.value, 3.1);
  f = read("Baseline labs: Na 140 mmol/L, K 4.0 mmol/L.\nCurrent: Na 129 mmol/L"); assert.equal(f.nabaseline.value, 140); assert.equal(f.potassiumbaseline.value, 4); assert.equal(f.na.value, 129);
});

test("RC2 hemolyzed and repeat potassium are different measurements, not a «conflict»", () => {
  const prose = "Hemolyzed potassium 7.1 mmol/L; repeat non-hemolyzed potassium 6.4 mmol/L.";
  const f = parseClinicalData(extractLabelledClinicalData(prose));
  assert.equal(f.potassiumhemolyzed.value, 7.1); assert.equal(f.potassium.value, 6.4);
  const d = parseClinicalDataDiagnostics("potassium=7.1 mmol/L (hemolyzed); potassium=6.4 mmol/L (repeat, non-hemolyzed)");
  assert.equal(d.duplicates.length, 0); assert.equal(d.facts.potassiumhemolyzed.value, 7.1); assert.equal(d.facts.potassium.value, 6.4);
  const t = parseClinicalData(extractLabelledClinicalData("| Parameter | Current |\n|---|---|\n| Potassium (hemolyzed) | 7.1 mmol/L |\n| Potassium (repeat) | 6.4 mmol/L |\n| Sodium | 129 mmol/L |\n"));
  assert.ok(t.na);
});

test("RC2 ambiguity is reported, never guessed; units are assumed only where physiologically unambiguous", () => {
  const amb = extractMeasurements("Creatinine 1.3/3.1 mg/dL");
  assert.equal(amb.measurements.filter((m) => m.key === "creatinine").length, 0);
  assert.ok(amb.ambiguities.length > 0);
  assert.equal(extractMeasurements("Glucose 180").measurements.length, 0, "glucose unit (mg/dL vs mmol/L) is never assumed");
  assert.equal(extractMeasurements("Lactate 5.1").measurements.length, 0);
  assert.equal(extractMeasurements("Creatinine 274").measurements.length, 0, "274 is not a plausible mg/dL value: not assumed");
  const na = extractMeasurements("Na 129").measurements[0];
  assert.equal(na.unit, "mmol/L"); assert.equal(na.assumedUnit, true);
  assert.equal(extractMeasurements("Na 129 mg/dL").measurements.length, 0, "a unit that does not belong to the analyte is never reinterpreted");
});

test("RC2 one canonical identity for every spelling of a baseline/current reading (hb_baseline vs hbbaseline schema split)", () => {
  const spellings = ["historical_hb=11.2 g/dL", "hb_baseline=11.2 g/dL", "baseline hemoglobin=11.2 g/dL", "Hb_historical=11.2 g/dL", "hbbaseline=11.2 g/dL"];
  for (const s of spellings) assert.equal(parseClinicalData(s).hbbaseline?.value, 11.2, s);
  assert.equal(parseClinicalData("current_hb=7.6 g/dL").hb.value, 7.6);
  assert.equal(parseClinicalData("BP_systolic=82 mmHg; BP_diastolic=48 mmHg").sbp.value, 82);
  assert.equal(parseClinicalData("K_hemolyzed=7.1 mmol/L").potassiumhemolyzed.value, 7.1);
});

/* ───────── ROOT CAUSE 3 · corroboration required OUR regex to re-derive the value; formulas demanded inputs they do not use ───────── */
test("RC3 a value printed next to its label in the original source is source-grounded even when no extractor phrasing matches", () => {
  const source = "The labs were: serum sodium level reported as 129, then chloride, 94 mEq/L, and the bicarbonate was low at 14.";
  assert.equal(groundedInSource(source, "na", 129), true);
  assert.equal(groundedInSource(source, "na", 139), false, "a number that is not in the source is never grounded");
  assert.equal(groundedInSource(source, "hco3", 14), true);
  assert.equal(groundedInSource("Sodium 129 mmol/L", "na", 129), true);
  assert.equal(groundedInSource("sodium 129", "na", 12), false, "129 must not ground 12");
  assert.equal(groundedInSource("Baseline sodium 137", "nabaseline", 137), false, "time-scoped identities are never grounded by proximity");
});

test("RC3 grounding rescues the false «missing from source» (v3.66 blocked a correct answer) but never an invented value", () => {
  const solver = "na=129 mmol/L; chloride=94 mmol/L; hco3=14 mmol/L";
  const prose = "Her sodium came back as 129 and the chloride at 94, bicarbonate 14 mmol/L.";
  const ok = auditClinicalCalculations({ dataText: solver, modelDataText: solver, authorityDataText: "", sourceText: prose, requireAuthorityInputs: true, narrative: "Anion gap = 21 mmol/L", contextText: "anion gap" });
  assert.equal(ok.results.find((r) => r.id === "ag")?.value, 21);
  assert.ok(!codes(ok).includes("clinical-inputs-not-independently-confirmed"));
  const invented = "na=129 mmol/L; chloride=94 mmol/L; hco3=18 mmol/L";
  const bad = auditClinicalCalculations({ dataText: invented, modelDataText: invented, authorityDataText: "", sourceText: prose, requireAuthorityInputs: true, narrative: "Anion gap = 17 mmol/L", contextText: "anion gap" });
  assert.ok(codes(bad).includes("clinical-inputs-not-independently-confirmed"));
  assert.ok(!bad.results.some((r) => r.id === "ag"), "an ungrounded input never yields a displayed verified result");
});

test("RC3 each formula owns only its own inputs: Winter's expected PaCO₂ needs HCO₃ alone", () => {
  const solver = "hco3=14 mmol/L; paco2=30 mmHg";
  const a = auditClinicalCalculations({ dataText: solver, modelDataText: solver, authorityDataText: "hco3=14 mmol/L", requireAuthorityInputs: true, narrative: "Winter expected PaCO2 = 1.5 × 14 + 8 = 29 mmHg", contextText: "Winter metabolic acidosis" });
  assert.equal(a.results.find((r) => r.id === "winter")?.value, 29);
  assert.deepEqual(codes(a), []);
  assert.ok(!a.notes.some((n) => /^Measured PaCO₂/.test(n)), "no comparison with an unconfirmed measured PaCO₂");
  const withPaco = auditClinicalCalculations({ dataText: solver, modelDataText: solver, authorityDataText: "hco3=14 mmol/L; paco2=30 mmHg", requireAuthorityInputs: true, narrative: "Winter expected PaCO2 = 29", contextText: "Winter metabolic acidosis" });
  assert.ok(withPaco.notes.some((n) => /within Winter's expected range/.test(n)));
});

test("RC3 tiering: an unconfirmed MAP/Winter/Fick input withholds that formula only; an unconfirmed anion-gap input blocks", () => {
  const solver = "sbp=82 mmHg; dbp=48 mmHg; na=129 mmol/L; chloride=94 mmol/L; hco3=14 mmol/L";
  const noBp = auditClinicalCalculations({ dataText: solver, modelDataText: solver, authorityDataText: "na=129 mmol/L; chloride=94 mmol/L; hco3=14 mmol/L", requireAuthorityInputs: true, narrative: "MAP = 59.3 mmHg. Anion gap = 21.", contextText: "anion gap MAP" });
  assert.ok(noBp.results.some((r) => r.id === "ag") && !noBp.results.some((r) => r.id === "map"));
  const c = noBp.conflicts.find((x) => x.code === "clinical-inputs-not-independently-confirmed");
  assert.equal(c.impact, "formula-withheld"); assert.equal(isBlockingConflict(c), false);
  assert.equal(blocksClinicalSynthesisForCalculationConflict(noBp, true), false);
  const noNa = auditClinicalCalculations({ dataText: solver, modelDataText: solver, authorityDataText: "chloride=94 mmol/L; hco3=14 mmol/L", requireAuthorityInputs: true, narrative: "Anion gap = 21.", contextText: "anion gap" });
  assert.equal(blocksClinicalSynthesisForCalculationConflict(noNa, true), true);
});

test("RC3 a source-vs-solver disagreement on ANY clinical input (not only Na/Cl/HCO₃) blocks synthesis in an acid-base case", () => {
  const a = auditClinicalCalculations({ dataText: "na=129 mmol/L; chloride=94 mmol/L; hco3=14 mmol/L; paco2=55 mmHg", authorityDataText: "na=129 mmol/L; chloride=94 mmol/L; hco3=14 mmol/L; paco2=30 mmHg", secondaryDataText: ["na=129 mmol/L; chloride=94 mmol/L; hco3=14 mmol/L; paco2=30 mmHg"], modelDataText: "paco2=55 mmHg", requireAuthorityInputs: true, narrative: "Anion gap = 21", contextText: "metabolic acidosis anion gap" });
  assert.ok(codes(a).includes("extraction-paco2-mismatch"));
  assert.equal(blocksClinicalSynthesisForCalculationConflict(a, true), true);
  assert.equal(a.conflicts.filter((c) => c.code === "extraction-paco2-mismatch").length, 1, "no duplicate finding");
});

test("RC3 deterministic reference values for the audited case (computed, not hard-coded in the engine)", () => {
  const a = audit("");
  const v = (id) => a.results.find((r) => r.id === id)?.value;
  assert.equal(v("map"), 59.33); assert.equal(v("ag"), 21); assert.equal(v("corrected-ag"), 24.5);
  assert.equal(v("winter"), 29); assert.equal(v("hb-decline"), 3.6);
  assert.equal(v("creatinine-delta"), 1.8); assert.equal(v("creatinine-ratio"), 2.38);
});

/* ───────── ROOT CAUSE 4 · one finding was reported by several channels and phrased several ways ───────── */
test("RC4 a finding reaches the banner once (flag + concern + solve-phase + final used to print it 2–4 times)", () => {
  const a = { tier: "LOW", flags: [{ code: "x", msg: "Anion gap: reported 18, computed 21." }, { code: "x", msg: "Anion gap: reported 18, computed 21." }], concerns: [{ code: "x", en: "Anion gap: reported 18, computed 21.", ar: "حسابات متعارضة" }, { code: "y", en: "other", ar: "حسابات متعارضة" }], reasons: [], issues: [] };
  assert.equal(banner(a, "en").why.length, 2);
  assert.equal(banner(a, "ar").why.filter((w) => w === "حسابات متعارضة").length, 1);
  const merged = replaceAuditItemsByMessage([{ ar: "m" }], [{ ar: "m" }, { ar: "m" }], (i) => i.ar);
  assert.equal(merged.length, 1);
});

test("RC4 a withheld formula is a concern, never a flag, never LOW, never clears the answer", () => {
  const brief = "PREMISE: x\nANSWER: B\nTYPE: MCQ\nKEYWORD: best\nCONCEPTS: a; b\nDATA: sbp=82 mmHg; dbp=48 mmHg\nOPTIONS:\nA) ❌ no\nB) ✅ yes\nCALC: MAP = 59.3 mmHg\nCONFIDENCE: high";
  const a = assessSolve({ raw: brief, stem: "Question with BP and options A) x B) y", sourceDataText: "" });
  assert.ok(!a.flags.some((f) => f.code === "clinical-calculation" && /not independently confirmed/.test(f.msg)));
  assert.ok(a.concerns.filter((c) => c.code === "formula-inputs-unconfirmed").length <= 1);
});

/* ───────── ROOT CAUSE 5 · approval state was not shared by every UI component ───────── */
test("RC5 a blocked clinical synthesis exposes NO generated content through any trust surface", () => {
  const trust = filterTrustForBlockedClinicalSynthesis({ clinicalSynthesisBlocked: true, banner: { head: "x", why: [] }, cards: [1], conflicts: [1], analogies: ["stop all drugs"], memoAids: ["m"], patches: [1], items: [1], stripped: [1], stats: { n: 1 } });
  const v = lessonView(trust);
  assert.equal(v.analogies.length + v.memoAids.length + v.cards.length + v.fixes.length + v.warnings.length + v.notes.length + v.conflicts.length, 0);
  assert.equal(v.clinicalSynthesisBlocked, true);
});

test("RC5 the follow-up chat shares the approval state: it never sees nor re-creates a withheld clinical answer", () => {
  const ctx = { kind: "question", question: "case text", explanation: "SECRET-WITHHELD-EXPLANATION stop all drugs", tricks: "SECRET-TRICK", clinicalBlocked: true };
  const sys = buildSystem(ctx, [], null, "balanced", false);
  assert.ok(!sys.includes("SECRET-WITHHELD-EXPLANATION") && !sys.includes("SECRET-TRICK"));
  assert.ok(sys.includes(CLINICAL_WITHHELD_NOTE));
  const open = buildSystem({ ...ctx, clinicalBlocked: false }, [], null, "balanced", false);
  assert.ok(open.includes("SECRET-WITHHELD-EXPLANATION"));
});

/* ───────── END-TO-END through the real createAnalysis pipeline (mocked Gemini) ───────── */
const goodLesson = lessonText("Anion gap = 129 − (94 + 14) = 21 mmol/L. Albumin-corrected anion gap = 21 + 2.5 × (4 − 2.6) = 24.5 mmol/L. Winter expected PaCO2 = 1.5 × 14 + 8 = 29 mmHg (27–31); measured 30 is appropriate. MAP = 59.3 mmHg. Hemoglobin fell by 3.6 g/dL.");

test("E2E correct model arithmetic is NOT blocked and every expected reference value is produced", async () => {
  const r = await runCase({ respond: (k) => (k === "solve" ? briefWith({ calc: GOOD_CALC, data: FULL_DATA }) : goodLesson) });
  const f = r.final;
  assert.equal(f.clinicalSynthesisBlocked, false);
  assert.deepEqual(f.calculationAudit.conflicts, []);
  const v = (id) => f.calculationAudit.results.find((x) => x.id === id)?.value;
  assert.equal(v("map"), 59.33); assert.equal(v("ag"), 21); assert.equal(v("corrected-ag"), 24.5); assert.equal(v("winter"), 29); assert.equal(v("hb-decline"), 3.6);
  assert.ok(/Anion gap = 129 − \(94 \+ 14\) = 21/.test(r.finalUpdate.explanation), "the generated explanation is retained");
  assert.equal(f.banner, null, "no warning for a correct answer");
});

test("E2E a model that really reports AG = 129 is blocked, once, with an empty supplementary surface", async () => {
  const r = await runCase({ respond: (k) => (k === "solve" ? briefWith({ calc: "AG = 129 mmol/L", data: FULL_DATA }) : lessonText("The anion gap is 129 mmol/L.")) });
  const f = r.final;
  assert.equal(f.clinicalSynthesisBlocked, true);
  assert.ok(f.calculationAudit.conflicts.some((c) => c.code === "reported-ag-mismatch"));
  assert.equal(f.analogies.length + f.memoAids.length + f.cards.length + f.items.length + f.patches.length + f.stripped.length, 0);
  assert.equal(r.finalUpdate.tricks, "");
  assert.ok(!/Stop all nephrotoxic drugs/.test(r.finalUpdate.explanation), "no generated advice leaks into the main answer");
  assert.deepEqual(f.banner.why, [], "the blocking body lists the finding once; the banner does not repeat it");
  const body = r.finalUpdate.explanation;
  const occurrences = body.split("the answer reports 129").length - 1;
  assert.equal(occurrences, 1, "the conflict is printed exactly once in the body");
});

test("E2E the solve-phase banner never shows a preliminary conclusion for clinical content", async () => {
  const r = await runCase({ respond: (k) => (k === "solve" ? briefWith({ calc: GOOD_CALC, data: FULL_DATA }) : goodLesson) });
  assert.equal(r.solve.clinicalPending, true);
  if (r.solve.banner) assert.equal(r.solve.banner.likely, "");
});

test("E2E question answers are never streamed before the final gates", async () => {
  const r = await runCase({ respond: (k) => (k === "solve" ? briefWith({ calc: "AG = 129 mmol/L", data: FULL_DATA }) : lessonText("The anion gap is 129 mmol/L.")) });
  const streamed = r.updates.filter((u) => u.name === "reason" && !u.meta?.final);
  assert.ok(streamed.every((u) => u.data.explanation === null && u.data.tricks === null));
});

test("E2E unrelated formula failure does not suppress independently verified results (source lacks PaCO₂)", async () => {
  const text = CASE_TEXT.replace("Arterial pH 7.24, PaCO2 30 mmHg, ", "Arterial pH 7.24, ");
  const data = FULL_DATA.replace("; PaCO₂=30 mmHg", "");
  const r = await runCase({ text, respond: (k) => (k === "solve" ? briefWith({ calc: "AG = 129 − (94 + 14) = 21", data }) : lessonText("Anion gap = 129 − (94 + 14) = 21 mmol/L. Winter expected PaCO2 = 1.5 × 14 + 8 = 29 mmHg.")) });
  assert.equal(r.final.clinicalSynthesisBlocked, false);
  assert.equal(r.final.calculationAudit.results.find((x) => x.id === "ag")?.value, 21);
  assert.equal(r.final.calculationAudit.results.find((x) => x.id === "winter")?.value, 29);
});

test("E2E a model-invented PaCO₂ that contradicts the source blocks synthesis (single finding)", async () => {
  const r = await runCase({ respond: (k) => (k === "solve" ? briefWith({ calc: "AG = 21", data: FULL_DATA.replace("PaCO₂=30", "PaCO₂=55") }) : lessonText("Measured PaCO2 55 mmHg.")) });
  assert.equal(r.final.clinicalSynthesisBlocked, true);
  assert.equal(r.final.calculationAudit.conflicts.filter((c) => c.code === "extraction-paco2-mismatch").length, 1);
});

test("E2E missing clinical information is never invented: absent inputs produce no number", async () => {
  const text = "Open-ended case. A patient with metabolic acidosis. Sodium 129 mmol/L, bicarbonate 14 mmol/L. Explain the anion gap.";
  const r = await runCase({ text, respond: (k) => (k === "solve" ? briefWith({ calc: "AG not calculable", data: "na=129 mmol/L; hco3=14 mmol/L" }) : lessonText("The anion gap cannot be calculated because chloride is not provided.")) });
  assert.ok(!(r.final.calculationAudit?.results || []).some((x) => x.id === "ag"));
});

/* ───────── CROSS-SPECIALTY GENERALISATION (none of these touch the audited patient) ───────── */
test("XS cardiology: Fick/SVR worked formula and units", () => {
  const data = "VO2=250 mL/min; CaO2=20 mL/dL; CvO2=15 mL/dL; MAP=70 mmHg; CVP=10 mmHg";
  const run = (t) => auditClinicalCalculations({ dataText: data, narrative: t, contextText: "Fick principle and SVR" });
  assert.deepEqual(codes(run("CO = 250 ÷ [10 × (20 − 15)] = 5 L/min. SVR = (70 − 10) ÷ 5 × 80 = 960 dyn·s/cm⁵.")), []);
  assert.ok(codes(run("SVR = (70 − 10) / 5 × 80 = 560 dyn·s/cm⁵")).includes("reported-svr-mismatch"));
  assert.ok(codes(run("Cardiac output by Fick is 7 L/min.")).includes("reported-co-mismatch"));
});

test("XS toxicology: osmolal gap worked formula, reference text ignored", () => {
  const data = "Na=140 mmol/L; glucose=90 mg/dL; BUN=14 mg/dL; measuredOsm=320 mOsm/kg";
  const a = auditClinicalCalculations({ dataText: data, narrative: "Calculated osmolality = 2×140 + 90/18 + 14/2.8 = 290. Osmolal gap = 320 − 290 = 30 mOsm/kg. A normal osmolal gap is < 10.", contextText: "osmolal gap toxic alcohol" });
  assert.deepEqual(codes(a), []);
  const bad = auditClinicalCalculations({ dataText: data, narrative: "Osmolal gap = 12 mOsm/kg", contextText: "osmolal gap toxic alcohol" });
  assert.ok(codes(bad).includes("reported-og-mismatch"));
});

test("XS nephrology / critical care extraction across free-text styles", () => {
  const f = parseClinicalData(extractLabelledClinicalData("Cardiac output 5 L/min, CVP 10 mmHg, mean arterial pressure 70 mmHg, SaO2 98 %, hemoglobin 13 g/dL."));
  assert.equal(f.co.value, 5); assert.equal(f.cvp.value, 10); assert.equal(f.map.value, 70); assert.equal(f.sao2.value, 98); assert.equal(f.hb.value, 13);
});

test("XS PK/CRRT: R₀ claim with hr unit is parsed as the result, not an operand", () => {
  const c = extractClaims("Maintenance infusion rate = 2 × (3 + 4) = 14 mg/hr");
  assert.equal(c[0].id, "r0"); assert.equal(c[0].value, 14);
});

test("XS Arabic label and Arabic digits are understood", () => {
  const c = extractClaims("الفجوة الأنيونية = ٢١");
  assert.equal(c[0]?.id, "ag"); assert.equal(c[0]?.value, 21);
});

test("XS claim verification is a pure function of (claims, results): no clinical knowledge hard-coded for the audited case", () => {
  const results = [{ id: "ag", label: "Anion gap", value: 10, unit: "mmol/L" }];
  assert.deepEqual(verifyClaims(extractClaims("Anion gap = 100 − (60 + 30) = 10"), results), []);
  assert.equal(verifyClaims(extractClaims("Anion gap = 10 mmol/L"), results).length, 0);
  assert.equal(verifyClaims(extractClaims("Anion gap = 21 mmol/L"), results).length, 1);
});

/* ───────── GENERATED: many patients × many phrasings (seeded, deterministic) ───────── */
function lcg(seed) { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32; }
test("GEN 600 generated worked-formula phrasings: zero false positives on correct maths, 100% detection of a perturbed result", () => {
  const rnd = lcg(367);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const r1 = (x) => Math.round(x * 10) / 10;
  const templates = {
    ag: [(v) => `Anion gap = ${v.na} − (${v.cl} + ${v.hco3}) = ${v.ag} mmol/L`, (v) => `AG = ${v.na} - ${v.cl} - ${v.hco3} = ${v.ag}`, (v) => `The anion gap is ${v.ag} mmol/L (${v.na} − ${v.cl + v.hco3}).`, (v) => `Anion Gap (AG): ${v.na} − (${v.cl} + ${v.hco3}) = ${v.ag}`, (v) => `anion gap ≈ ${v.ag}`],
    cag: [(v) => `Albumin-corrected anion gap = ${v.ag} + 2.5 × (4 − ${v.alb}) = ${v.cag} mmol/L`, (v) => `Corrected AG is ${v.cag} mmol/L.`, (v) => `AG (albumin-corrected) = ${v.cag}`],
    win: [(v) => `Winter expected PaCO2 = 1.5 × ${v.hco3} + 8 = ${v.win} mmHg`, (v) => `Expected PaCO₂ (Winter) = 1.5×[HCO3] + 8 → ${v.win}`, (v) => `Winter's formula gives ${v.win} ± 2 mmHg.`, (v) => `Expected PaCO2 is ${v.win} mmHg (range ${v.win - 2}–${v.win + 2})`],
    map: [(v) => `MAP = (${v.sbp} + 2×${v.dbp})/3 = ${r1((v.sbp + 2 * v.dbp) / 3)} mmHg`, (v) => `Mean arterial pressure ≈ ${Math.round((v.sbp + 2 * v.dbp) / 3)} mmHg`],
  };
  let checked = 0, perturbed = 0;
  for (let n = 0; n < 60; n++) {
    const na = 120 + Math.floor(rnd() * 25), cl = 85 + Math.floor(rnd() * 25), hco3 = 8 + Math.floor(rnd() * 20), alb = r1(1.5 + rnd() * 2.5), sbp = 70 + Math.floor(rnd() * 70), dbp = 35 + Math.floor(rnd() * 40);
    const ag = na - (cl + hco3), cag = r1(ag + 2.5 * (4 - alb)), win = 1.5 * hco3 + 8;
    if (!(sbp > dbp)) continue;
    const v = { na, cl, hco3, alb, ag, cag, win: Number.isInteger(win) ? win : r1(win), sbp, dbp };
    const data = `na=${na} mmol/L; chloride=${cl} mmol/L; hco3=${hco3} mmol/L; albumin=${alb} g/dL; sbp=${sbp} mmHg; dbp=${dbp} mmHg`;
    const run = (text) => auditClinicalCalculations({ dataText: data, authorityDataText: data, modelDataText: data, requireAuthorityInputs: true, answerText: text, narrative: text, contextText: "metabolic acidosis anion gap Winter MAP albumin" });
    for (const [kind, list] of Object.entries(templates)) for (const tpl of list) {
      const good = tpl(v);
      assert.deepEqual(run(good).conflicts.map((c) => c.code), [], good);
      checked++;
      if (kind === "map") continue;
      const bad = good.split(String(kind === "ag" ? v.ag : kind === "cag" ? v.cag : v.win)).join(String((kind === "ag" ? v.ag : kind === "cag" ? v.cag : v.win) + 7));
      if (bad === good) continue;
      const wrongRes = run(bad);
      assert.ok(wrongRes.conflicts.length > 0, `perturbed result must be flagged: ${bad}`);
      perturbed++;
    }
  }
  assert.ok(checked >= 500, `checked ${checked}`);
  assert.ok(perturbed >= 250, `perturbed ${perturbed}`);
});

test("RC1 negative results keep their sign (a minus attached to the number is a sign, not a separator)", () => {
  assert.equal(extractClaims("The anion gap is -4 mmol/L")[0].value, -4);
  assert.equal(extractClaims("Anion gap = −4 mmol/L")[0].value, -4);
  assert.equal(extractClaims("Anion gap – 21 mmol/L")[0].value, 21, "a spaced dash is a separator");
});

/* ───────── FORMATTING CANNOT HIDE A WRONG NUMBER (markdown, tables, LaTeX) ───────── */
test("FMT wrong values are caught in bold, bullet, table-cell and inline-code formatting; correct ones pass", () => {
  for (const wrong of ["- **Anion gap:** 18 mmol/L", "**Anion gap** = 18", "Anion gap = **18** mmol/L", "| Anion gap | 18 mmol/L |", "`AG = 18`", "| **Winter expected PaCO₂** | 40 mmHg |"]) {
    assert.ok(audit(wrong).conflicts.length > 0, `must flag: ${wrong}`);
  }
  for (const right of ["- **Anion gap:** 21 mmol/L", "**Anion Gap (AG)** = 129 − (94 + 14) = **21 mmol/L**", "| Anion gap | 21 mmol/L |", "$AG = 129 - (94+14) = 21$", "| **Winter expected PaCO₂** | 29 mmHg |"]) {
    assert.deepEqual(codes(audit(right)), [], right);
  }
});

test("FMT source readings survive markdown emphasis and bullets", () => {
  const f = parseClinicalData(extractLabelledClinicalData("- **Sodium:** 129 mmol/L\n- **Chloride:** 94 mmol/L\n- **Bicarbonate:** 14 mmol/L\n- **PaCO₂:** 30 mmHg"));
  assert.equal(f.na.value, 129); assert.equal(f.chloride.value, 94); assert.equal(f.hco3.value, 14); assert.equal(f.paco2.value, 30);
});

/* ───────── PRE-GENERATION HANDOFF is data-driven, so a case that never says «anion gap» still gets verified numbers ───────── */
test("HANDOFF the lesson writers receive verified AG / corrected AG / Winter / MAP / Hb-decline before generating (v3.66 sent nothing for natural prose)", () => {
  const h = buildPreGenerationCalculationHandoff(CASE_TEXT);
  for (const needle of [/Anion gap: 21 mmol\/L/, /Albumin-corrected anion gap: 24\.5 mmol\/L/, /Winter expected PaCO₂: 29 mmHg/, /mean arterial pressure: 59\.33 mmHg/, /decline\): 3\.6 g\/dL/]) assert.match(h, needle);
  assert.match(h, /129 − \(94 \+ 14\)/);
});

test("HANDOFF is not over-triggered: normal chemistry produces no acid-base handoff", () => {
  assert.equal(buildPreGenerationCalculationHandoff("Routine labs: sodium 140 mmol/L, chloride 104 mmol/L, bicarbonate 24 mmol/L, pH 7.40."), "");
  assert.equal(buildPreGenerationCalculationHandoff("A patient with a cough. Explain the stages of wound healing."), "");
});
