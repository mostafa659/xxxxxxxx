/* cold vs warm timing of the KB + verification pass, and the shape of the index. node --no-warnings --import ./tests/register.mjs scripts/kb-bench.mjs */
import * as T from "../src/lib/trust.js";
import * as KB from "../src/lib/kb/index.js";
import { matchSentence, padded, auditRules } from "../src/lib/kb/rules.js";
import { buildSourceModel } from "../src/lib/provenance.js";
const GEN = { discipline: "general", exam: "", region: "" };
const t0 = performance.now();
const facts = await KB.loadKb(GEN);
const tLoad = performance.now() - t0;
const para = "- The gallbladder secretes bile. The stomach has 4 regions: cardia, fundus, body and pylorus. Give 500 mg every 8 hours. Hemoglobin 12.5 g/dL is normal for an adult man. Think of it like a blender.\n- المعدة بتهضم الأكل وبعدين تفرغ في الأمعاء الدقيقة عشان الامتصاص ده مهم جدا للجسم كله.\n";
const text = "## x\n" + para.repeat(45);
const model = buildSourceModel({ items: [{ t: "text", name: "n", text: "The stomach has four regions: cardia, fundus, body and pylorus. ".repeat(40) }] });
const run = () => { const a = performance.now(); T.verifyText({ text, sourceModel: model, profile: GEN, part: "A" }); return performance.now() - a; };
const cold = run();                                     // first pass after load: every regex still to compile
const warm = Array.from({ length: 60 }, run).sort((a, b) => a - b);
const idx = KB.rulesIndex();
const sents = text.split(/(?<=[.!?])\s+/), mt = [];
for (let k = 0; k < 10; k++) for (const s of sents) { const S = padded(s), a = performance.now(); matchSentence(idx, S, S.trim().split(" ")); mt.push(performance.now() - a); }
mt.sort((a, b) => a - b);
console.log(JSON.stringify({
  concepts: { rules: KB.allRules().length, rangesAndLegacyFacts: facts.length, total: KB.allRules().length + facts.length },
  load_ms: +tLoad.toFixed(1), firstPass_cold_ms: +cold.toFixed(1),
  warm_ms: { median: +warm[30].toFixed(2), p95: +warm[57].toFixed(2), min: +warm[0].toFixed(2) },
  matcher_ms: { p50: +mt[mt.length >> 1].toFixed(4), p95: +mt[Math.floor(mt.length * 0.95)].toFixed(4) },
  words: text.split(/\s+/).length, sentences: sents.length, indexTokens: idx.inv.size, audit: auditRules(KB.allRules()).errs.length,
}, null, 1));
