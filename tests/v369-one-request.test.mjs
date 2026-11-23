/* v3.69 · the task-contract path must cost ONE generative request on the happy path, at most one more for proven defects, and zero for a repeat. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { installFetch, script, reset } from "./mockfetch.mjs";
import * as Router from "../src/lib/router.js";
import { setExtKeys, setEnginePrefs } from "../src/lib/providers.js";
import { createAnalysis } from "../src/lib/analysis.js";
import { parseTaskContract, parseItemOutput, auditItems, defects, assembleAnswer } from "../src/lib/taskcontract.js";
import { auditCitations, annotateCitations } from "../src/lib/citation-audit.js";
import { selectAnchors, formatAnchorReferences } from "../src/lib/clinical-anchors.js";
import { getContractResult, contractKey, clearContractResults } from "../src/lib/contract-cache.js";
import { PROOF_TASK, PROSE_TASK } from "../src/lib/guard.js";

installFetch();
const CASE = fs.readFileSync(new URL("./fixtures/consultant-case.md", import.meta.url), "utf8");
const C = parseTaskContract(CASE);
const sysOf = (b) => String(b?.systemInstruction?.parts?.[0]?.text || "");

/* a well-formed answer for every item, honouring limits, field names and list lengths */
function goodItem(it) {
  if (it.kind === "subject") return it.fields.map((f) => `**${f.replace(/[.:]$/, "")}:** concrete evidence from the case with value, unit and time, plus the reasoning that links it to ${it.label}.`).join("\n");
  if (it.minCount) return Array.from({ length: it.minCount }, (_, i) => `${i + 1}. A dangerous conclusion number ${i + 1}, the overlooked evidence, and the harm that follows from it.`).join("\n");
  if (it.limit) return "A 34-year-old woman with lupus, antiphospholipid syndrome and a kidney transplant has microangiopathic hemolysis, severe thrombocytopenia, acute graft dysfunction and multi-organ small-vessel thrombosis, after a tacrolimus increase, fluconazole and urinary infection.";
  return `${it.label.replace(/\.$/, "")}: ` + "evidence [Fact] with value and unit; reasoning [Inference] with the rule applied; missing data [Unknown] and the test that would settle it. ".repeat(2);
}
const fullOutput = (skip = new Set()) => C.tasks.flatMap((t) => t.items).filter((it) => !skip.has(it.key)).map((it) => `@@${it.key}@@\n${goodItem(it)}`).join("\n") + "\n@@TRICKS@@\n- **Trap:** x → y → z";

async function run({ respond, modeId = "balanced", key, doc = { kind: "text", name: "q.txt", text: CASE }, keepCache = false, retryAfter = false }) {
  key = key || `AIzaV369${String(Math.floor(Math.random() * 1e9)).padStart(10, "0")}`;
  reset(); Router.__resetRouter(); if (!keepCache) window.localStorage.clear(); setExtKeys({}); setEnginePrefs({ mode: "auto" });
  const calls = [];
  for (const m of ["gemini-flash-latest", "gemini-pro-latest", "gemini-flash-lite-latest", "gemini-3.1-pro-preview"]) script(`gemini:${m}`, { ok: (b) => { calls.push({ model: m, sys: sysOf(b) }); return respond(b, calls.length); } });
  const updates = [];
  const dones = [];
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), 20000); const done = new Set();
    const a = createAnalysis({ kind: "question", history: [], dataUrl: null, doc, extra: "", chips: [], apiKey: key, modeId,
      onUpdate: (name, data, meta) => updates.push({ name, data, meta }),
      onDone: (name, m) => { dones.push({ name, m }); done.add(name); if (done.has("reason") && done.has("words")) { clearTimeout(t); resolve(); } },
      onError: (name, err) => { clearTimeout(t); reject(new Error(`${name}: ${err && err.message}`)); }, onNotice() {}, onTrust() {} });
    a.start();
  });
  const final = updates.filter((u) => u.name === "reason" && u.meta && u.meta.final).at(-1).data;
  return { final, calls: calls.filter((c) => /ONE pass|repairing specific items/.test(c.sys)), all: calls, dones };
}
const words = () => "- **term** — معنى";
const dispatch = (fn) => (b) => (/ONE pass|repairing specific items/.test(sysOf(b)) ? fn(b) : words());

test("proofreader keeps its v3.40 scope; the guard covers every writer", () => {
  for (const n of ["lessonA:balanced", "lessonB:fast", "lessonC:balanced"]) { assert.ok(PROSE_TASK.test(n)); assert.ok(!PROOF_TASK.test(n), `${n} must not trigger the proofreader`); }
  assert.ok(PROOF_TASK.test("lesson:chat"));
});

test("item model: parse, audit, defects and assembly are consistent", () => {
  const m = parseItemOutput(fullOutput(new Set(["2.3"])), C);
  assert.equal(m.has("2.3"), false);
  assert.equal(m.has("TRICKS"), true);
  const a = auditItems(C, m);
  assert.deepEqual(a.missing, ["2.3"]);
  assert.equal(defects(a).get("2.3")[0].startsWith("MISSING"), true);
  const text = assembleAnswer(C, m);
  assert.match(text, /## Task 9 — Adversarial Error Detection/);
  assert.match(text, /\*\*Catastrophic antiphospholipid syndrome \(CAPS\)\.\*\*/);
  assert.ok(!/@@/.test(text));
});

test("item audit: a short list, a missing field, an over-limit item and a thin item are each found", () => {
  const m = parseItemOutput(fullOutput(), C);
  m.set("9.1", "1. only one");
  m.set("2.1", "**Supporting evidence:** a lot of words ".repeat(6));
  m.set("1.1", "word ".repeat(300));
  m.set("5.2", "short");
  const a = auditItems(C, m);
  assert.ok(a.count.some((x) => x.key === "9.1"));
  assert.ok(a.fields.some((x) => x.key === "2.1"));
  assert.ok(a.limit.some((x) => x.key === "1.1"));
  assert.ok(a.thin.some((x) => x.key === "5.2"));
});

test("citation audit: anchor citations pass, an invented one is found and marked", () => {
  const anchors = selectAnchors(CASE);
  const t = "Per Asherson 2003 the criteria need three organs. Zheng 2020 (ISTH) advises sampling before TPE. Rossi et al. 2018 proved the opposite.";
  const r = auditCitations(t, anchors);
  assert.deepEqual(r.unverified.map((x) => x.name), ["rossi"]);
  assert.match(annotateCitations(t, r, "ar"), /Rossi et al\. 2018 ⟦/);
  assert.equal(auditCitations("Rossi et al. 2018 (من الذاكرة — راجع المصدر).", anchors).unverified.length, 0);
});

test("references section lists only the retrieved anchors, with the links that were opened", () => {
  const r = formatAnchorReferences(selectAnchors(CASE), "en");
  assert.match(r, /pubmed\.ncbi\.nlm\.nih\.gov\/32914526/);
  assert.equal(formatAnchorReferences([], "en"), "");
});

test("E2E happy path: exactly ONE generative request for the 10-task case, all 38 items, no ledger, no notice", async () => {
  const { final, calls, all } = await run({ respond: dispatch(() => fullOutput()) });
  assert.equal(calls.length, 1, "one request for the whole contract");
  assert.ok(!all.some((c) => /single shared analysis/.test(c.sys)), "no ledger request");
  for (let n = 1; n <= 10; n++) assert.match(final.explanation, new RegExp(`## Task ${n} —`));
  assert.ok(!/فحص اكتمال الإجابة/.test(final.explanation));
  assert.match(final.explanation, /المراجع المسترجعة/);
  assert.match(final.tricks, /Trap/);
});

test("E2E repair: missing items cost exactly ONE extra batched request and only those items are asked for", async () => {
  let repairBody = "";
  const { final, calls } = await run({ respond: dispatch((b) => {
    const s = sysOf(b);
    if (/repairing specific items/.test(s)) { repairBody = JSON.stringify(b.contents); return `@@5.2@@\n${goodItem(C.tasks[4].items[1])}\n@@7.3@@\n${goodItem(C.tasks[6].items[2])}`; }
    return fullOutput(new Set(["5.2", "7.3"]));
  }) });
  assert.equal(calls.length, 2);
  assert.ok(/@@5\.2@@/.test(repairBody) && /@@7\.3@@/.test(repairBody));
  assert.ok(!/@@4\.1@@\s+Interpret/.test(repairBody), "complete items are not re-requested");
  assert.ok(!/لم تُكتب إجابتها/.test(final.explanation));
  assert.equal((final.explanation.match(/## Task 5 —/g) || []).length, 1);
});

test("E2E repair: a flagged reasoning trap (confounded negative used to exclude) goes into the same single repair request", async () => {
  let repairs = 0, sawReason = "";
  const bad = fullOutput().replace(/(@@4\.1@@\n)[^\n]*/, "$1ADAMTS13 activity of 17% effectively excludes TTP, so TTP is ruled out. [Fact] value [Inference] rule [Unknown] test needed, with enough words to pass the floor of the audit.");
  const { calls } = await run({ respond: dispatch((b) => {
    if (/repairing specific items/.test(sysOf(b))) { repairs++; sawReason = JSON.stringify(b.contents); return `@@4.1@@\n${goodItem(C.tasks[3].items[0])}`; }
    return bad;
  }) });
  assert.equal(calls.length, 2);
  assert.equal(repairs, 1);
  assert.match(sawReason, /confounded-negative-excludes/);
});

test("E2E cache: re-running the same case costs ZERO generative requests; Retry bypasses the cache", async () => {
  const k = "AIzaV369CACHEKEY000001";
  const first = await run({ respond: dispatch(() => fullOutput()), key: k });
  assert.equal(first.calls.length, 1);
  assert.ok(JSON.parse(window.localStorage.getItem("clinix:contract:v1") || "[]").length === 1, "result stored");
  const second = await run({ respond: dispatch(() => { throw new Error("must not be called"); }), key: k, keepCache: true });
  assert.equal(second.calls.length, 0);
  assert.match(second.final.explanation, /## Task 10 —/);
  clearContractResults();
});

test("E2E honesty: a defective answer is never cached and its gaps are reported", async () => {
  clearContractResults();
  const { final, calls } = await run({ respond: dispatch((b) => (/repairing specific items/.test(sysOf(b)) ? "@@9.9@@\nnothing useful" : fullOutput(new Set(["8.2"])))) });
  assert.equal(calls.length, 2);
  assert.match(final.explanation, /لم تُكتب إجابتها: Task 8 \(8\.2\)/);
  assert.equal(window.localStorage.getItem("clinix:contract:v1"), null);
});

test("E2E partial: tokens already paid for are kept when the request breaks half-way; only the rest is repaired", async () => {
  let n = 0;
  const { final, calls } = await run({ respond: dispatch((b) => {
    if (/repairing specific items/.test(sysOf(b))) { const keys = [...JSON.stringify(b.contents).matchAll(/@@(\d+\.\d+)@@/g)].map((m) => m[1]); return [...new Set(keys)].map((k) => { const it = C.tasks.flatMap((t) => t.items).find((x) => x.key === k); return it ? `@@${k}@@\n${goodItem(it)}` : ""; }).join("\n"); }
    n++; return fullOutput(new Set(C.tasks.flatMap((t) => t.items).filter((it) => it.number >= 9 || +it.key.split(".")[0] >= 9).map((it) => it.key)));
  }) });
  assert.equal(calls.length, 2);
  assert.match(final.explanation, /## Task 10 —/);
  assert.ok(n >= 1);
});
