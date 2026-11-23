/* v3.67 · shared end-to-end harness: runs the REAL createAnalysis pipeline against the programmable fake of Google. */
import { installFetch, reset, log, script } from "./mockfetch.mjs";
import * as Router from "../src/lib/router.js";
import { setExtKeys, setEnginePrefs } from "../src/lib/providers.js";
import { createAnalysis } from "../src/lib/analysis.js";

installFetch();
let seq = 0;
export { log };

export const CASE_TEXT = "Open-ended clinical reasoning question (no answer options). A 79-year-old woman with type 2 diabetes, CKD stage 3b and HFrEF presents with suspected gastrointestinal bleeding. Blood pressure 82/48 mmHg, heart rate 40 bpm. Baseline/current creatinine 1.3/3.1 mg/dL. Baseline/current hemoglobin 11.2/7.6 g/dL. Hemolyzed potassium 7.1 mmol/L; repeat non-hemolyzed potassium 6.4 mmol/L. Sodium 129 mmol/L, chloride 94 mmol/L, bicarbonate 14 mmol/L, albumin 2.6 g/dL. Arterial pH 7.24, PaCO2 30 mmHg, lactate 5.1 mmol/L. Provide a comprehensive assessment and management plan.";

export const briefWith = ({ calc, data }) => [
  "PREMISE: shock with severe metabolic acidosis and hyperkalaemia",
  "ANSWER: Prioritise resuscitation, ECG-guided hyperkalaemia treatment and source control of bleeding.",
  "TYPE: open-ended clinical case",
  "KEYWORD: NOT APPLICABLE",
  "CONCEPTS: anion gap; Winter formula; hyperkalaemia",
  `DATA: ${data}`,
  "OPTIONS:\nNONE — no answer choices supplied",
  `CALC: ${calc}`,
  "CONFIDENCE: medium — complex case",
].join("\n");

export const FULL_DATA = "BP_systolic=82 mmHg; BP_diastolic=48 mmHg; Na=129 mmol/L; Cl=94 mmol/L; HCO3=14 mmol/L; albumin=2.6 g/dL; pH=7.24; PaCO₂=30 mmHg; Hb=7.6 g/dL; historical_hb=11.2 g/dL; creatinine=3.1 mg/dL";
export const GOOD_CALC = "MAP = (82 + 2×48)/3 = 59.3 mmHg; AG = 129 − (94 + 14) = 21; corrected AG = 21 + 2.5 × (4 − 2.6) = 24.5; Winter expected PaCO2 = 1.5 × 14 + 8 = 29 mmHg";

export const lessonText = (body) => `## 🎯 Assessment\n${body}\n## ✅ The correct answer\n- Resuscitate, treat hyperkalaemia, control bleeding.\n## 💡 Memory aid\n- Think shock first. Stop all nephrotoxic drugs immediately.`;

/* run one analysis; `respond(kind, body)` returns the text of the fake model for a solve ("solve") or writing ("write") request */
export async function runCase({ text = CASE_TEXT, respond, mode = "balanced", kind = "question", chips = [] }) {
  const key = `AIzaV367${String(++seq).padStart(10, "0")}`;
  reset(); Router.__resetRouter(); window.localStorage.clear();
  setExtKeys({}); setEnginePrefs({ mode: "auto" });
  const isSolve = (b) => String(b?.systemInstruction?.parts?.[0]?.text || "").includes("PREMISE:");
  script("gemini:gemini-flash-latest", { ok: (b) => respond(isSolve(b) ? "solve" : "write", b) });
  const trust = [], updates = [];
  await new Promise((resolve, reject) => {
    let finished = false; const done = new Set();
    const timeout = setTimeout(() => reject(new Error("analysis did not finish")), 15000);
    const a = createAnalysis({
      kind, history: [], dataUrl: null, doc: { kind: "text", name: "question.txt", text }, extra: "", chips, apiKey: key, modeId: mode,
      onUpdate: (name, data, meta) => updates.push({ name, data, meta }),
      onDone: (name) => { done.add(name); if (!finished && done.has("reason") && done.has("words")) { finished = true; clearTimeout(timeout); resolve(); } },
      onError: (name, err) => { clearTimeout(timeout); reject(new Error(`${name}: ${err?.message || err}`)); },
      onNotice() {}, onTrust: (t) => trust.push(t),
    });
    a.start();
  });
  const finalUpdate = updates.filter((u) => u.name === "reason" && u.meta?.final).at(-1)?.data || null;
  return { trust, final: trust.find((t) => t.phase === "final"), solve: trust.find((t) => t.phase === "solve"), updates, finalUpdate };
}
