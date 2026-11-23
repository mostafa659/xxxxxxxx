/* v3.70 · adaptive routing (a small Gemini model rates the question) + optional new-words list. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { installFetch, reset, script } from "./mockfetch.mjs";
import * as Router from "../src/lib/router.js";
import { setExtKeys, setEnginePrefs } from "../src/lib/providers.js";
import { createAnalysis } from "../src/lib/analysis.js";
import { briefWith, FULL_DATA, GOOD_CALC, lessonText, CASE_TEXT } from "./helpers-e2e.mjs";
import { heuristicLevel, parseDifficulty, combineLevels, modeForLevel, routeKey, getRoute, putRoute, clearRoutes, buildDifficultyPrompt } from "../src/lib/difficulty.js";
import { MODES, tasksFor, sectionsFor } from "../src/lib/config.js";

installFetch();
const EASY_Q = "Which of the following is the normal adult resting heart rate range? A) 60-100 B) 20-40 C) 120-160 D) 200-240";
const MED_Q = "A nurse is caring for a client with heart failure who has crackles and 2+ pitting edema. Which action should the nurse take first? A) Place the client in high Fowler position B) Offer fluids C) Check the diet order D) Ambulate the client";
const HARD_Q = `${CASE_TEXT} Calculate the corrected anion gap and Winter expected PaCO2, and explain which interactions with warfarin and amiodarone matter.`;
const CONTRACT = fs.readFileSync(new URL("./fixtures/consultant-case.md", import.meta.url), "utf8");

/* ── pure pieces ── */
test("rules: easy / medium / hard samples, calculation floor, negative-keyword and drug signals", () => {
  assert.equal(heuristicLevel(EASY_Q).level, "easy");
  assert.equal(heuristicLevel(MED_Q).level, "medium");
  assert.equal(heuristicLevel(HARD_Q).level, "hard");
  assert.equal(heuristicLevel("Calculate the infusion rate in mL/hr for heparin 18 units/kg/hr, patient weighs 80 kg, bag 25,000 units in 500 mL.").calc, true);
  assert.ok(heuristicLevel("Which statement is EXCEPT correct about warfarin and digoxin interaction? Patient on warfarin and amiodarone.").score >= 4);
});

test("verdict parsing: strict JSON, fenced JSON, loose word, garbage", () => {
  assert.deepEqual(parseDifficulty('{"level":"hard","reason":"multi-system"}'), { level: "hard", reason: "multi-system" });
  assert.equal(parseDifficulty('```json\n{"level":"Easy","reason":"x"}\n```').level, "easy");
  assert.equal(parseDifficulty("I think this is MEDIUM difficulty").level, "medium");
  assert.equal(parseDifficulty("¯\\_(ツ)_/¯"), null);
  assert.equal(parseDifficulty('{"level":"impossible"}'), null);
});

test("combine: the model decides, the rules only stop a fall of two steps or a calculation reading as easy", () => {
  assert.deepEqual(combineLevels({ level: "easy" }, { level: "hard", calc: false }), { level: "medium", source: "model", floored: true });
  assert.equal(combineLevels({ level: "easy" }, { level: "medium", calc: false }).level, "easy");
  assert.equal(combineLevels({ level: "easy" }, { level: "easy", calc: true }).level, "medium");
  assert.equal(combineLevels({ level: "hard" }, { level: "easy", calc: false }).level, "hard");   // the model may go UP freely
  assert.equal(combineLevels(null, { level: "hard" }).source, "rules");
});

test("presets: level → mode, small key never asks the strong lane; hidden presets exist and are complete", () => {
  assert.equal(modeForLevel("easy"), "light");
  assert.equal(modeForLevel("medium"), "balanced");
  assert.equal(modeForLevel("hard", { small: false }), "deep");
  assert.equal(modeForLevel("hard", { small: true }), "deepflash");
  for (const id of ["light", "deepflash"]) { const m = MODES[id]; assert.ok(m.hidden && m.solve && m.write.words && m.writeA, id); }
  assert.equal(MODES.light.skipSolve, true);
  assert.equal(MODES.deepflash.solve.tier, "fast");
});

test("classifier prompt: asks for one JSON line, forbids answering, prefers the higher level", () => {
  const p = buildDifficultyPrompt();
  assert.match(p.system, /Do NOT answer/);
  assert.match(p.system, /choose the HIGHER/);
  assert.match(p.system, /"level":"easy\|medium\|hard"/);
});

test("route cache: stores and finds by question hash", () => {
  clearRoutes();
  const k = routeKey("some question", "");
  assert.equal(getRoute(k), null);
  putRoute(k, { level: "hard", reason: "x" });
  assert.equal(getRoute(k).level, "hard");
  clearRoutes();
});

test("words are optional in the config helpers", () => {
  assert.deepEqual(tasksFor("question", false), ["reason"]);
  assert.deepEqual(tasksFor("lesson", false), ["ocr", "reason"]);
  assert.deepEqual(tasksFor("question"), ["reason", "words"]);
  assert.ok(!sectionsFor("question", false).some((s) => s.key === "new_words"));
  assert.ok(sectionsFor("question", true).some((s) => s.key === "new_words"));
});

/* ── end-to-end with the real pipeline ── */
let seq = 0;
async function run({ text, verdict, modeId = "auto", withWords = true, routeFails = false, keepStorage = false, key, afterDone }) {
  key = key || `AIzaV370${String(++seq).padStart(10, "0")}`;
  reset(); Router.__resetRouter(); if (!keepStorage) window.localStorage.clear(); setExtKeys({}); setEnginePrefs({ mode: "auto" });
  const kinds = [];
  const respond = (b) => {
    const s = String(b?.systemInstruction?.parts?.[0]?.text || "");
    if (/router for a nursing\/medical exam-study app/.test(s)) { kinds.push("route"); if (routeFails) throw Object.assign(new Error("boom"), { status: 400 }); return verdict; }
    if (s.includes("PREMISE:")) { kinds.push("solve"); return briefWith({ calc: GOOD_CALC, data: FULL_DATA }); }
    kinds.push("write"); return lessonText("body");
  };
  for (const m of ["gemini-flash-latest", "gemini-flash-lite-latest", "gemini-pro-latest", "gemini-3.1-pro-preview"]) script(`gemini:${m}`, { ok: respond });
  const routes = [], updates = [], doneNames = new Set();
  let a;
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout " + [...doneNames])), 15000);
    a = createAnalysis({ kind: "question", history: [], dataUrl: null, doc: { kind: "text", name: "q.txt", text }, extra: "", chips: [], apiKey: key, modeId, withWords,
      onRoute: (r) => routes.push(r),
      onUpdate: (n, d, m) => updates.push({ n, d, m }),
      onDone: (n) => { doneNames.add(n); if (doneNames.has("reason") && (!withWords || doneNames.has("words"))) { clearTimeout(t); resolve(); } },
      onError: (n, e) => { clearTimeout(t); reject(new Error(`${n}: ${e && e.message}`)); }, onNotice() {}, onTrust() {} });
    a.start();
  });
  return { kinds, routes, updates, doneNames, a, key };
}
const count = (k, x) => k.filter((y) => y === x).length;

test("E2E easy: the router asks once, the preset is 'light' (no silent solve)", async () => {
  const r = await run({ text: EASY_Q, verdict: '{"level":"easy","reason":"recall"}' });
  assert.equal(count(r.kinds, "route"), 1);
  assert.equal(count(r.kinds, "solve"), 0);
  assert.equal(r.routes[0].mode, "light");
  assert.equal(r.routes[0].level, "easy");
});

test("E2E medium: today's balanced preset, with its silent solve", async () => {
  const r = await run({ text: MED_Q, verdict: '{"level":"medium","reason":"2-3 steps"}' });
  assert.equal(r.routes[0].mode, "balanced");
  assert.equal(count(r.kinds, "solve"), 1);
});

test("E2E hard: a small (free) key gets 'deepflash', and the strong lane is not asked", async () => {
  const r = await run({ text: HARD_Q, verdict: '{"level":"hard","reason":"multi-system"}' });
  assert.equal(r.routes[0].mode, "deepflash");
  assert.equal(count(r.kinds, "solve"), 1);
});

test("E2E easy costs fewer generative requests than medium (the point of the router)", async () => {
  const e = await run({ text: EASY_Q, verdict: '{"level":"easy"}' });
  const m = await run({ text: MED_Q, verdict: '{"level":"medium"}' });
  assert.ok(e.kinds.length < m.kinds.length, `easy ${e.kinds.length} vs medium ${m.kinds.length}`);
});

test("E2E safety floor: the model says easy, the rules say hard → medium, never easy", async () => {
  const r = await run({ text: HARD_Q, verdict: '{"level":"easy","reason":"short"}' });
  assert.equal(r.routes[0].level, "medium");
  assert.equal(r.routes[0].floored, true);
});

test("E2E fail-open: a broken router never stops the answer; the rules decide", async () => {
  const r = await run({ text: MED_Q, verdict: "", routeFails: true });
  assert.equal(r.routes[0].source, "rules");
  assert.ok(r.updates.some((u) => u.n === "reason" && u.m && u.m.final));
});

test("E2E garbage verdict falls back to the rules", async () => {
  const r = await run({ text: MED_Q, verdict: "no idea" });
  assert.equal(r.routes[0].source, "rules");
});

test("E2E contract source: already hard by structure, so NO router request is spent", async () => {
  const kinds = [];
  reset(); Router.__resetRouter(); window.localStorage.clear(); setExtKeys({}); setEnginePrefs({ mode: "auto" });
  for (const m of ["gemini-flash-latest", "gemini-flash-lite-latest", "gemini-pro-latest", "gemini-3.1-pro-preview"]) script(`gemini:${m}`, { ok: (b) => { const s = String(b?.systemInstruction?.parts?.[0]?.text || ""); kinds.push(/router for a nursing/.test(s) ? "route" : /ONE pass/.test(s) ? "contract" : "other"); return /ONE pass/.test(s) ? "@@1.1@@\nx" : "- **t** — م"; } });
  const routes = [];
  await new Promise((resolve) => {
    const done = new Set();
    createAnalysis({ kind: "question", history: [], dataUrl: null, doc: { kind: "text", name: "q.md", text: CONTRACT }, extra: "", chips: [], apiKey: `AIzaV370C${++seq}`, modeId: "auto",
      onRoute: (r) => routes.push(r), onUpdate() {}, onDone: (n) => { done.add(n); if (done.has("reason") && done.has("words")) resolve(); }, onError: () => resolve(), onNotice() {}, onTrust() {} }).start();
    setTimeout(resolve, 8000);
  });
  assert.equal(kinds.filter((k) => k === "route").length, 0);
  assert.equal(routes[0].mode, "contract");
});

test("E2E retry on an auto-routed answer goes one level deeper and does NOT pay for a second classification", async () => {
  const first = await run({ text: MED_Q, verdict: '{"level":"medium"}' });
  assert.equal(first.routes[0].level, "medium");
  const before = first.kinds.filter((k) => k === "route").length;
  first.a.retry("reason");
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(first.routes.at(-1).level, "hard");
  assert.equal(first.kinds.filter((k) => k === "route").length, before, "route is cached");
});

test("E2E words OFF: no word-list request, no words update, and the analysis finishes without it", async () => {
  const on = await run({ text: MED_Q, verdict: '{"level":"medium"}', withWords: true });
  const off = await run({ text: MED_Q, verdict: '{"level":"medium"}', withWords: false });
  assert.ok(on.updates.some((u) => u.n === "words"));
  assert.ok(!off.updates.some((u) => u.n === "words"));
  assert.ok(!off.doneNames.has("words"));
  assert.equal(on.kinds.length - off.kinds.length, 1, "exactly the word-list request is saved");
});

test("E2E a manual mode is respected: no router request", async () => {
  const r = await run({ text: MED_Q, verdict: "", modeId: "balanced" });
  assert.equal(count(r.kinds, "route"), 0);
  assert.equal(r.routes.length, 0);
});
