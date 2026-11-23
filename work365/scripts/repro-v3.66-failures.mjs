/* Re-runnable reproduction of the v3.66.0 failures. Run from the project root:   node --import ./tests/register.mjs scripts/repro-v3.66-failures.mjs
   Run it on the v3.66.0 tree to see the defects, on v3.67.0 to see them fixed. It uses only public exports that exist in both versions. */
import { auditClinicalCalculations, extractLabelledClinicalData, parseClinicalData } from "../src/lib/clinical-calculations.js";

const DATA = "na=129 mmol/L; chloride=94 mmol/L; hco3=14 mmol/L; albumin=2.6 g/dL; paco2=30 mmHg; sbp=82 mmHg; dbp=48 mmHg; hb=7.6 g/dL";
const audit = (t) => auditClinicalCalculations({ dataText: DATA, authorityDataText: DATA, modelDataText: DATA, requireAuthorityInputs: true, answerText: t, narrative: t, contextText: "metabolic acidosis anion gap Winter MAP" });

console.log("\n[1] CORRECT worked formulas — a conflict here is a FALSE POSITIVE");
for (const t of ["Anion gap: 129 − (94 + 14) = 21 mmol/L", "AG = 129 - (94 + 14) = 21", "The anion gap is 129 − 108 = 21 mmol/L.", "Winter expected PaCO2 = 1.5×[HCO3] + 8 → 29", "The anion gap is 21. The albumin-corrected anion gap is 24.5 mmol/L."]) {
  const c = audit(t).conflicts.map((x) => x.code);
  console.log(`  ${c.length ? "FALSE-POSITIVE" : "ok            "}  ${t}  ${c.join(",")}`);
}
console.log("\n[2] WRONG values — silence here is a MISSED DETECTION");
for (const t of ["MAP = 71 mmHg.", "Hemoglobin fell by 5.1 g/dL", "The anion gap is 21. The albumin-corrected anion gap is 31 mmol/L.", "Anion gap = 129 mmol/L."]) {
  const c = audit(t).conflicts.map((x) => x.code);
  console.log(`  ${c.length ? "detected      " : "MISSED        "}  ${t}  ${c.join(",")}`);
}
console.log("\n[3] SOURCE extraction from a natural paragraph");
const para = "Blood pressure 82/48 mmHg, heart rate 40 bpm. Baseline/current creatinine 1.3/3.1 mg/dL. Baseline/current hemoglobin 11.2/7.6 g/dL. Hemolyzed potassium 7.1 mmol/L; repeat non-hemolyzed potassium 6.4 mmol/L. Sodium 129 mmol/L, chloride 94 mmol/L, bicarbonate 14 mmol/L, albumin 2.6 g/dL. Arterial pH 7.24, PaCO2 30 mmHg.";
const f = parseClinicalData(extractLabelledClinicalData(para));
console.log("  keys read:", Object.keys(f).join(", "));
console.log("  current Na / HCO3 / PaCO2 present as CURRENT readings:", !!f.na && !!f.hco3 && !!f.paco2);
const f2 = parseClinicalData(extractLabelledClinicalData("Na 129, Cl 94, HCO3 14 mmol/L. sodium 129 (mmol/L)."));
console.log("  glued-unit tolerance («Na 129,» / «sodium 129 (mmol/L)»):", !!f2.na && !!f2.chloride);
