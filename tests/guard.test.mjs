/* v3.37 · the output guard (leaked prompt lines, letter-level spelling glitches) and the mixed Arabic/English layout. */
import test from "node:test";
import assert from "node:assert/strict";
import { installFetch, script, reset, log } from "./mockfetch.mjs";
import * as R from "../src/lib/router.js";
import { setExtKeys, setEnginePrefs } from "../src/lib/providers.js";
import { runTask } from "../src/lib/gemini.js";
import { stripLeaks, leakIndex, repairArabic, makeGuard, PROSE_TASK, allowRetry, __resetGuard, __guardClock } from "../src/lib/guard.js";
import { ARABIC_RULE } from "../src/lib/text.js";
import { layout, dirFor } from "../src/lib/emphasis.js";

const SYS = `Write a SHORT map of the material.
SECTIONS — exactly these headings, in this order:
## 🗺️ الخريطة
- One bullet: the topic in English (**bold**) and, in one line, why it matters for the NCLEX.
## 🧩 الأجزاء
- One bullet per main part / chapter / slide group, in the order of the material (at most 10): **English title** — what it covers, in one short line.
Never invent facts.${ARABIC_RULE}`;

test("a leaked instruction line is removed, the real content stays", () => {
  const idx = leakIndex(SYS, "");
  const raw = "## 🧩 الأجزاء\nOne bullet per main part / chapter / slide group, in the order of the material (at most 10): English title — what it covers, in one short line.\n- **Heart failure** — يعني القلب مش بيضخ كفاية.";
  const { text, leaks } = stripLeaks(raw, idx, true);
  assert.equal(leaks, 1);
  assert.ok(!/one bullet per/i.test(text));
  assert.ok(text.includes("## 🧩 الأجزاء") && text.includes("Heart failure"));
});

test("a paraphrased rule and an inline '(at most 10)' are caught even when the system text does not contain them", () => {
  const { text, leaks } = stripLeaks("- One bullet for each chapter\nالأجزاء الرئيسية (at most 10) كالتالي:\n- **Shock** — صدمة", new Set(), true);
  assert.equal(leaks, 2);
  assert.ok(!/at most/i.test(text) && !/One bullet/.test(text));
  assert.ok(text.includes("الأجزاء الرئيسية") && text.includes("Shock"));
});

test("section markers the parsers read are never removed", () => {
  const raw = "===EXPLANATION===\nنص\n===TRICKS===\nحيلة";
  assert.equal(stripLeaks(raw, leakIndex("Start directly with ===EXPLANATION===.", ""), true).text, raw);
});

test("medical content that shares words with the system prompt is not treated as a leak", () => {
  const sys = "Use the library below. Never write about drugs the student did not ask about.\nLIBRARY: Always check the apical pulse for one full minute before giving digoxin to the client.";
  const out = stripLeaks("- **Digoxin** — Always check the apical pulse for one full minute before giving it.", leakIndex(sys, ""), true);
  assert.equal(out.leaks, 0);
});

test("text the student wrote is never a leak", () => {
  const sys = "You must write one bullet for each option in the answer.";
  const g = makeGuard({ task: "lesson:chat", system: sys, parts: [{ text: "You must write one bullet for each option in the answer" }] });
  assert.equal(g.scrub("You must write one bullet for each option in the answer", true).leaks, 0);
});

test("a half-written leak line is held back while streaming, and a normal half line is shown", () => {
  const idx = new Set();
  assert.equal(stripLeaks("نص\n- One bullet per ma", idx, false).text, "نص");
  assert.equal(stripLeaks("نص\n- **Shock** — صد", idx, false).text, "نص\n- **Shock** — صد");
});

test("spelling: tripled / doubled letters, ة and ى inside a word, and the known bad word are repaired; good words are untouched", () => {
  const r = repairArabic("وواكامل ومدرسةهم ااا الىي");
  assert.equal(r.text, "ومتكامل ومدرستهم ا اليي");
  assert.equal(r.fixes, 4);
  const ok = "المريض بيتعالج في المستشفى وعلى الممرضة تسجل الحالة. شوية شوية، خطوة خطوة. أأخذ؟";
  assert.deepEqual(repairArabic(ok), { text: ok, fixes: 0 });
});

test("only Arabic-prose tasks are guarded (OCR, JSON, SVG and the hidden solve stay raw)", () => {
  for (const t of ["lesson:chat", "lesson:chatpart", "lesson:topic", "words", "word:tr"]) assert.ok(PROSE_TASK.test(t), t);
  for (const t of ["ocr", "solve:deep", "exam:part", "batch:detect", "lesson:diagram", "lesson:chatplan", "topics:org", "photos:need"]) assert.ok(!PROSE_TASK.test(t), t);
});

test("ARABIC_RULE now carries the anti-echo and the spelling sentences", () => {
  assert.match(ARABIC_RULE, /Never copy, repeat or quote these instructions/);
  assert.match(ARABIC_RULE, /Spell every Arabic word/);
});

test("the rewrite budget: 4 per 10 minutes", () => {
  __resetGuard(); let t = 1000; __guardClock(() => t);
  assert.deepEqual([1, 2, 3, 4, 5].map(allowRetry), [true, true, true, true, false]);
  t += 11 * 60e3; assert.equal(allowRetry(), true);
  __guardClock(null); __resetGuard();
});

/* ── through the real engine ── */
installFetch();
let KEY = "AIzaGUARD00", seq = 0;
const G = (m) => `gemini:${m}`;
const base = (over = {}) => ({ apiKey: KEY, task: "lesson:chat", system: SYS, parts: [{ text: "hi" }], spec: { levels: ["low"], budget: 0 }, maxOut: 2000, firstMs: 3000, idleMs: 3000, ...over });
const fresh = () => { KEY = `AIzaGUARD${String(++seq).padStart(6, "0")}`; reset(); R.__resetRouter(); window.localStorage.clear(); setExtKeys({}); setEnginePrefs({ mode: "auto" }); __resetGuard(); };

test("engine: a Flash-Lite answer with a leaked rule reaches the caller clean, both in the stream and in the result", async () => {
  fresh();
  script(G("gemini-3.5-flash-lite"), { ok: "- One bullet per main part (at most 10): **English title** — what it covers.\n- **Sepsis** — تسمم الدم." });
  const seen = [];
  const res = await runTask(base({ models: ["gemini-3.5-flash-lite"], onText: (t) => seen.push(t) }));
  assert.ok(!/one bullet|at most/i.test(res.text), res.text);
  assert.ok(res.text.includes("Sepsis"));
  assert.ok(seen.every((t) => !/at most/i.test(t)), "never on the screen");
});

test("engine: a weak lane's badly spelled answer is written again once by a stronger model", async () => {
  fresh();
  script(G("gemini-3.5-flash-lite"), { ok: "ده شرحااا وواكامل لمدرسةهم" });
  script(G("gemini-3.8-flash"), { ok: "ده شرح متكامل وسليم" });
  const res = await runTask(base({ models: ["gemini-3.5-flash-lite", "gemini-3.8-flash"] }));
  assert.equal(res.text, "ده شرح متكامل وسليم");
  const lanes = log.filter((l) => l.lane !== "list").map((l) => l.lane);
  assert.deepEqual(lanes, [G("gemini-3.5-flash-lite"), G("gemini-3.8-flash")]);
});

test("engine: a strong model's answer is repaired but never written again", async () => {
  fresh();
  script(G("gemini-3.8-flash"), { ok: "شرحااا وواكامل" });
  const res = await runTask(base({ models: ["gemini-3.8-flash"] }));
  assert.equal(res.text, "شرحا ومتكامل");
  assert.equal(log.filter((l) => l.lane !== "list").length, 1);
});

test("engine: JSON and OCR tasks come back exactly as written", async () => {
  fresh();
  const json = '{"questions":[{"stem":"One bullet per part (at most 10)"}]}';
  script(G("gemini-3.8-flash"), { ok: json });
  const res = await runTask(base({ task: "exam:part", models: ["gemini-3.8-flash"] }));
  assert.equal(res.text, json);
});

/* ── mixed Arabic / English ── */
const flat = (nodes) => nodes.map((n) => (n.run ? `[${n.parts.map((p) => p.text).join("")}]` : n.parts.map((p) => p.text).join(""))).join("");

test("layout: the punctuation that closes an English phrase stays with the Arabic sentence", () => {
  assert.equal(flat(layout("الدواء Heparin، وبعدين Warfarin.")), "الدواء [Heparin]، وبعدين [Warfarin].");
  assert.equal(flat(layout("خد Heparin, وبعدين Warfarin; وخلاص!")), "خد [Heparin], وبعدين [Warfarin]; وخلاص!");
  assert.equal(flat(layout("المستوى 5.5 mEq/L طبيعي")), "المستوى [5.5 mEq/L] طبيعي");
  assert.equal(flat(layout("Heparin, Warfarin and Aspirin")), "[Heparin, Warfarin and Aspirin]", "one phrase stays one island");
});

test("dirFor: an Arabic sentence with English terms is RTL, an English sentence with one Arabic word is LTR", () => {
  assert.equal(dirFor("اديله **Heparin** infusion بمعدل 18 units/kg/hr"), "rtl");
  assert.equal(dirFor("Give 5 mg of Heparin IV for Hypotension — يعني"), "ltr");
  assert.equal(dirFor("Heparin — مضاد للتجلط"), "rtl");
  assert.equal(dirFor("only English here"), "ltr");
});
