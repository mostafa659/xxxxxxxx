import test from "node:test";
import assert from "node:assert/strict";
import { cleanWords, keepEntry, isEasy } from "../src/lib/parse.js";

const lines = (s) => s.split("\n").filter(Boolean).map((l) => l.split(" — ")[0]);

test("easy words are dropped even when the AI labels them B2 / MED (the dictionary decides, not the AI)", () => {
  const raw = [
    "[B2] temperature — درجة الحرارة", "[B2] pressure — ضغط", "[B2] recommend — يوصي", "[B2] immediately — فورا", "[B2] recently — مؤخرا",
    "[C1] symptom — عرض", "[B2] careful — حذر", "[MED] fever — حمى", "[MED] pain — ألم", "[MED] blood pressure — ضغط الدم", "[MED] chest pain — ألم الصدر",
    "[B2] take care — ياخد باله", "[B2] go to bed — يروح السرير", "[B2] pick up — يلتقط", "[B2] wait for — يستنى", "[B2] treatment — علاج", "[B1] schedule — جدول", "[B2] review — يراجع",
  ].join("\n");
  assert.deepEqual(lines(cleanWords(raw, true)), []);
});

test("real B2+ words, medical terms, abbreviations, phrasal verbs and fixed exam phrases survive", () => {
  const keep = [
    "[C1] exacerbation — تفاقم", "[B2] adverse — ضار", "[B2] subsequent — لاحق", "[B2] impaired — متضرر", "[B2] deteriorate — يسوء", "[B2] intervene — يتدخل",
    "[C1] contraindicated — ممنوع", "[B2] refrain — يمتنع", "[C1] cessation — توقف", "[B2] prioritize — يحدد الأولوية", "[B2] comply — يلتزم", "[B2] reinforce — يعزز",
    "[C1] impending — وشيك", "[B2] mitigate — يخفف", "[B2] exhibit — يُظهر", "[C1] manifest — يظهر", "[B2] concurrent — متزامن", "[B2] adhere — يلتزم",
    "[C1] ambulate — يمشي", "[MED] edema — وذمة", "[MED] dyspnea — ضيق نفس", "[MED] infection — عدوى", "[MED] deep vein thrombosis — جلطة", "[ABBR] NPO — ممنوع الأكل",
    "[ABBR] PRN — عند الحاجة", "[B2] rule out — يستبعد", "[B2] carry out — ينفذ", "[B2] cut back on — يقلل", "[B2] deal with — يتعامل مع", "[B2] requires further teaching — محتاج شرح",
    "[B2] assess — يقيّم", "[B2] administer — يعطي", "[B2] adequate — كافي", "[B2] delegate — يفوّض",
  ];
  const out = lines(cleanWords(keep.join("\n"), true));
  assert.deepEqual(out, keep.map((l) => l.replace(/^\[[A-Z0-9]+\]\s*/, "").split(" — ")[0]));
});

test("the dictionary is only ever consulted for EVERYDAY words: a rare word is never 'easy'", () => {
  for (const w of ["edema", "exacerbation", "dyspnea", "thrombosis", "contraindicated", "NPO", "mitigate"]) assert.equal(isEasy(w), false, w);
  for (const w of ["temperature", "pressure", "recommend", "immediately", "treatments", "carefully", "schedule"]) assert.equal(isEasy(w), true, w);
});

test("keepEntry: an AI tag of A1 / A2 / B1 always drops the entry", () => {
  for (const t of ["A1", "A2", "B1"]) assert.equal(keepEntry(t, "exacerbation"), false);
  assert.equal(keepEntry("C1", "exacerbation"), true);
});

test("waiting card logic: stages, a bar that never reaches 100 %, rotating items of three kinds", async () => {
  const W = await import("../src/lib/waiting.js");
  assert.ok(W.waitProgress(0, 20) === 0 && W.waitProgress(10000, 20) <= 0.94);
  assert.ok(W.waitProgress(10, 20) < W.waitProgress(30, 20));
  assert.match(W.waitHeadline({ stage: { kind: "plan" } }).text, /أقسام/);
  const h = W.waitHeadline({ stage: { kind: "write", n: 4, done: 1 } });
  assert.ok(h.text.includes("4") && h.text.includes("1"));
  assert.match(W.waitHeadline({ level: "max" }).text, /أقصى دقة/);
  assert.equal(W.waitHeadline({ secs: 5 }).sub, "");
  assert.ok(W.waitHeadline({ secs: 50 }).sub.length > 0);
  assert.equal(W.waitClock(12), "12ث"); assert.equal(W.waitClock(75), "1:15");
  const items = W.waitItems(7);
  assert.deepEqual([...new Set(items.map((i) => i.k))].sort(), ["cheer", "tip", "word"]);
  assert.equal(new Set(items.slice(0, 3).map((i) => i.k)).size, 3, "kinds alternate");
  assert.ok(W.waitExpected("max") > W.waitExpected("quick"));
});
