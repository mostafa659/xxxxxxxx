/* ClinixStudy · contract bench (v3.69).  Measures the REAL model on a task-contract case: requests, time, coverage, traps, citations.
 *   GEMINI_API_KEY=AIza... node --import ./tests/register.mjs scripts/contract-bench.mjs [case.md] [balanced|fast|deep]
 * Without a key it prints the plan only (no request is sent). One run = 1 request (+1 if the audit finds defects) + the cheap word-list request.
 * Compare configurations by editing CONTRACT in src/lib/config.js (tier / levels / wordsBudget) and re-running; keep the one with the best
 * `items complete` and fewest `trap advisories` at an acceptable time. Delete the cache first (the bench does) or the second run costs zero. */
import fs from "node:fs";
import { createAnalysis } from "../src/lib/analysis.js";
import { parseTaskContract, parseItemOutput, auditItems } from "../src/lib/taskcontract.js";
import { auditReasoningTraps } from "../src/lib/reasoning-traps.js";
import { auditCitations } from "../src/lib/citation-audit.js";
import { selectAnchors } from "../src/lib/clinical-anchors.js";
import { clearContractResults } from "../src/lib/contract-cache.js";

const file = process.argv[2] || new URL("../tests/fixtures/consultant-case.md", import.meta.url);
const modeId = process.argv[3] || "balanced";
const text = fs.readFileSync(file, "utf8");
const contract = parseTaskContract(text);
const items = contract.tasks.flatMap((t) => t.items);
console.log(`contract: active=${contract.active} tasks=${contract.tasks.length} items=${items.length} level=${contract.complexity.level} reasons=${contract.complexity.reasons.join(", ")}`);
const key = process.env.GEMINI_API_KEY;
if (!key) { console.log("no GEMINI_API_KEY: plan only (happy path = 1 generative request, repair ≤ 1, repeat = 0)"); process.exit(0); }
clearContractResults();
const t0 = Date.now();
let reqs = 0; const realFetch = globalThis.fetch;
globalThis.fetch = (...a) => { if (/generateContent|streamGenerateContent/.test(String(a[0]))) reqs++; return realFetch(...a); };
let final = null, model = "";
await new Promise((resolve, reject) => {
  const done = new Set();
  createAnalysis({ kind: "question", history: [], dataUrl: null, doc: { kind: "text", name: "case.md", text }, extra: "", chips: [], apiKey: key, modeId,
    onUpdate: (n, d, m) => { if (n === "reason" && m && m.final) { final = d; model = m.model; } },
    onDone: (n) => { done.add(n); if (done.has("reason") && done.has("words")) resolve(); },
    onError: (n, e) => reject(new Error(`${n}: ${e && e.message}`)), onNotice() {}, onTrust() {} }).start();
}).catch((e) => console.log("FAILED:", e.message));
if (final) {
  const ex = final.explanation;
  const present = items.filter((it) => new RegExp(`## Task ${it.key.split(".")[0]} —`).test(ex)).length;
  const anchors = selectAnchors(text);
  const traps = auditReasoningTraps({ source: text, answer: ex, anchorsText: "", openCase: true });
  const cit = auditCitations(ex, anchors);
  console.log(JSON.stringify({ seconds: ((Date.now() - t0) / 1000).toFixed(1), generateRequests: reqs, model, chars: ex.length, tasksPresent: `${new Set(items.map((i) => i.key.split(".")[0])).size}`, gapNotice: /فحص اكتمال الإجابة/.test(ex), trapAdvisories: traps.map((t) => t.code), citationsVerified: cit.verified, citationsUnverified: cit.unverified.map((c) => c.cite) }, null, 1));
  fs.writeFileSync("/tmp/contract-bench-answer.md", ex);
  console.log("answer written to /tmp/contract-bench-answer.md — grade it with the rubric and compare configurations");
}
