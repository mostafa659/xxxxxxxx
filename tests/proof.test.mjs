/* v3.40 · the proofreader: a second reader returns corrections, plain code decides which may be applied. */
import test from "node:test";
import assert from "node:assert/strict";
import { installFetch, script, reset, log } from "./mockfetch.mjs";
import * as R from "../src/lib/router.js";
import { setExtKeys, setEnginePrefs } from "../src/lib/providers.js";
import { runTask, getModelLists } from "../src/lib/gemini.js";
import { acceptable, applyProof, parseProof, chunkForProof, shouldProof, setProof, __resetProof } from "../src/lib/proof.js";

const TEXT2 = "💡 Tip: Prazole pumps acid down — برازيل يسفع الحمض للأسفل، وبزموث يمسك البكتيريا السيئة جوه المعدة.";   // "يسفع" is not in the known-spellings table: only the second reader can catch it
const TEXT = "💡 Tip: Prazole pumps acid down — برازيل يضفع الحمض للأسفل، وبزموث يمسك البكتيريا السيئة جوه المعدة.";

test("a spelling fix of the same words is accepted", () => {
  assert.ok(acceptable({ from: "يضفع", to: "يدفع" }, TEXT));
  assert.ok(acceptable({ from: "برازيل يضفع", to: "برازول يدفع" }, TEXT));
  assert.equal(applyProof(TEXT, [{ from: "برازيل يضفع", to: "برازول يدفع" }]).text.includes("برازول يدفع الحمض"), true);
});

test("anything that is more than a spelling fix is refused", () => {
  assert.ok(!acceptable({ from: "يضفع", to: "يدفع الحمض" }, TEXT), "different number of words");
  assert.ok(!acceptable({ from: "الحمض", to: "المعدة" }, TEXT), "a different word, not a typo");
  assert.ok(!acceptable({ from: "جوه", to: "داخل" }, TEXT), "colloquial → standard");
  assert.ok(!acceptable({ from: "بيفكر", to: "يفكر" }, "الطالب بيفكر في الحل دلوقتي كويس جدا ومركز"), "a dropped dialect prefix");
  assert.ok(!acceptable({ from: "غير موجود", to: "غير موجوم" }, TEXT), "the phrase is not in the text");
  assert.ok(!acceptable({ from: "يضفع", to: "Prazole" }, TEXT), "Latin letters");
  assert.ok(!acceptable({ from: "يضفع", to: 'يدفع"}' }, TEXT), "JSON / markup characters");
  assert.ok(!acceptable({ from: "يضفع", to: "يضفع" }, TEXT), "no change");
  assert.ok(!acceptable({ from: "ضفع", to: "دفع" }, TEXT), "must match whole words only");
});

test("parseProof tolerates fences and garbage", () => {
  assert.deepEqual(parseProof('```json\n{"fixes":[{"from":"أ","to":"ب"}]}\n```'), [{ from: "أ", to: "ب" }]);
  assert.deepEqual(parseProof("no json at all"), []);
  assert.deepEqual(parseProof('{"fixes":"x"}'), []);
  assert.deepEqual(parseProof(""), []);
});

test("short texts are not proofread, long ones are cut into at most three pieces", () => {
  assert.equal(shouldProof("كلمتين بس"), false);
  const long = Array.from({ length: 400 }, (_, i) => `سطر رقم ${i} فيه كلام عربي كفاية علشان يتحسب كمان`).join("\n");
  const ch = chunkForProof(long);
  assert.ok(ch.length >= 1 && ch.length <= 3);
  assert.ok(ch.every((c) => c.length < 7000));
});

/* ── through the real engine ── */
installFetch();
let KEY = "AIzaPROOF00", seq = 0;
const G = (m) => `gemini:${m}`;
const base = (over = {}) => ({ apiKey: KEY, task: "lesson:chat", system: "Answer the student.", parts: [{ text: "hi" }], spec: { levels: ["low"], budget: 0 }, maxOut: 2000, firstMs: 3000, idleMs: 3000, ...over });
const fresh = () => { KEY = `AIzaPROOF${String(++seq).padStart(6, "0")}`; reset(); R.__resetRouter(); window.localStorage.clear(); setExtKeys({}); setEnginePrefs({ mode: "auto" }); __resetProof(); setProof(true); };
const proofModels = () => getModelLists(KEY).fast;

test("engine: the author's typo is corrected by the second reader and the student gets the clean text", async () => {
  fresh();
  const author = "gemini-3.8-flash";
  script(G(author), { ok: TEXT2 }, { ok: JSON.stringify({ fixes: [{ from: "برازيل يسفع", to: "برازول يدفع" }] }) });
  for (const m of proofModels()) if (m !== author) script(G(m), { ok: JSON.stringify({ fixes: [{ from: "برازيل يسفع", to: "برازول يدفع" }] }) });
  const res = await runTask(base({ models: [author] }));
  assert.ok(res.text.includes("برازول يدفع الحمض للأسفل"), res.text);
  assert.ok(!res.text.includes("يسفع"));
  assert.ok(res.text.includes("Tip: Prazole pumps acid down"), "English untouched");
  assert.equal(log.filter((l) => l.lane !== "list").length, 2, "one author request + one proofreading request");
});

test("engine: a proofreader that returns a rewrite or nonsense changes nothing", async () => {
  fresh();
  const author = "gemini-3.8-flash";
  const evil = JSON.stringify({ fixes: [{ from: "الحمض للأسفل", to: "المعدة للأعلى" }, { from: "جوه", to: "داخل" }] });
  script(G(author), { ok: TEXT2 }, { ok: evil });
  for (const m of proofModels()) if (m !== author) script(G(m), { ok: evil });
  const res = await runTask(base({ models: [author] }));
  assert.ok(res.text.includes("برازيل يسفع"), "only guard.js repairs apply: the typo stays, nothing was invented");
  assert.ok(res.text.includes("الحمض للأسفل") && res.text.includes("جوه"));
});

test("engine: a proofreader that fails never breaks the answer", async () => {
  fresh();
  const author = "gemini-3.8-flash";
  script(G(author), { ok: TEXT2 }, { status: 500, msg: "boom" });
  for (const m of proofModels()) if (m !== author) script(G(m), { status: 500, msg: "boom" });
  const res = await runTask(base({ models: [author] }));
  assert.ok(res.text.includes("الحمض للأسفل"));
});

test("engine: JSON tasks, short answers and a switched-off proofreader are never proofread", async () => {
  fresh();
  script(G("gemini-3.8-flash"), { ok: '{"a":"برازيل يضفع الحمض للأسفل وبزموث يمسك البكتيريا السيئة جوه المعدة"}' });
  await runTask(base({ task: "exam:part", models: ["gemini-3.8-flash"] }));
  assert.equal(log.filter((l) => l.lane !== "list").length, 1);
  fresh(); script(G("gemini-3.8-flash"), { ok: "ده شرح قصير" });
  await runTask(base({ models: ["gemini-3.8-flash"] }));
  assert.equal(log.filter((l) => l.lane !== "list").length, 1);
  fresh(); setProof(false); script(G("gemini-3.8-flash"), { ok: TEXT2 });
  await runTask(base({ models: ["gemini-3.8-flash"] }));
  assert.equal(log.filter((l) => l.lane !== "list").length, 1);
});
