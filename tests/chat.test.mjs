import test from "node:test";
import assert from "node:assert/strict";
import { installFetch, script, reset, log } from "./mockfetch.mjs";
import * as R from "../src/lib/router.js";
import { setExtKeys, setEnginePrefs } from "../src/lib/providers.js";
import { isBigAsk, cleanOutline, compose, runSliced } from "../src/lib/chatflow.js";
import { createFileCache } from "../src/lib/gfiles.js";

installFetch();

test("isBigAsk: only genuinely big requests", () => {
  for (const t of ["اشرحلي أمراض القلب بالتفصيل", "اعملي ملخص شامل للفصل ده", "explain heart failure in detail and in depth", "Give me a complete guide to insulin"]) assert.ok(isBigAsk(t), t);
  for (const t of ["ليه الإجابة B؟", "كمّل", "what does NPO mean?", "اديني مثال شبهه"]) assert.ok(!isBigAsk(t), t);
  assert.ok(isBigAsk("لخصلي الملف ده", { files: 1 }));                          // "summarise the file" is a big ask
  assert.ok(!isBigAsk("اشرح ده", { files: 1 }));                                 // too short
  assert.ok(isBigAsk("لخصلي الملف اللي رفعته ده كله لو سمحت", { files: 1 }));
});

test("cleanOutline: 2–4 sections, rejects junk and single sections", () => {
  assert.equal(cleanOutline("not json"), null);
  assert.equal(cleanOutline('{"sections":[{"title":"A","focus":"x"}]}'), null);
  const o = cleanOutline('```json\n{"sections":[{"title":"A","focus":"a"},{"title":"B"},{"title":"C"},{"title":"D"}]}\n```', 3);
  assert.deepEqual(o.map((s) => s.title), ["A", "B", "C"]);
});

test("compose: a section is shown the moment it has words; unfinished ones keep their place (heading + placeholder)", () => {
  assert.equal(compose(["one", "two", ""], [false, true, false], false), "one\n\ntwo");                    // no waiting for the section before it
  assert.equal(compose(["", "two", ""], [false, true, false], false), "two");                                 // without an outline there is nothing to hold a place with
  const outline = [{ title: "أ" }, { title: "ب" }, { title: "ج" }];
  assert.equal(compose(["", "two", ""], [false, true, false], false, outline), "## أ\n\n⏳ بيتكتب دلوقتي…\n\ntwo\n\n## ج\n\n⏳ بيتكتب دلوقتي…");
  assert.equal(compose(["one", "two", "three"], [true, true, true], true, outline), "one\n\ntwo\n\nthree");
  assert.equal(compose(["one", "", "three"], [true, true, true], true, outline), "one\n\nthree", "a failed section leaves no placeholder behind");
});

test("runSliced: sections are written AT THE SAME TIME (wall clock ≈ the longest one, not the sum)", async () => {
  const t0 = Date.now();
  const ask = async (kind, cb) => {
    if (kind === "plan") return { text: '{"sections":[{"title":"أ"},{"title":"ب"},{"title":"ج"}]}' };
    await new Promise((r) => setTimeout(r, 300));
    cb && cb("part " + kind.slice, "m");
    return { text: "## " + kind.outline[kind.slice].title + "\nbody", model: "m" };
  };
  const shown = [];
  const r = await runSliced({ ask, onText: (t) => shown.push(t) });
  assert.ok(Date.now() - t0 < 700, "three 300 ms writers took " + (Date.now() - t0));
  assert.equal(r.sections, 3);
  assert.equal(r.text, "## أ\nbody\n\n## ب\nbody\n\n## ج\nbody");
  assert.ok(shown.every((t) => !t.includes("part 1") || (t.includes("part 0") || t.includes("## أ")) && t.indexOf("part 1") > Math.min(...["part 0", "## أ"].map((x) => t.indexOf(x)).filter((i) => i >= 0))), "section 2 never shows ABOVE section 1: its place is held");
});

test("runSliced: a finished section is shown at once even while an earlier one is still being written", async () => {
  const ask = async (kind, cb) => {
    if (kind === "plan") return { text: '{"sections":[{"title":"أ"},{"title":"ب"}]}' };
    await new Promise((r) => setTimeout(r, kind.slice === 0 ? 400 : 50));
    return { text: "## " + kind.outline[kind.slice].title + "\nbody" + kind.slice, model: "m" };
  };
  const shown = [];
  await runSliced({ ask, onText: (t) => shown.push(t) });
  const early = shown.find((t) => t.includes("body1"));
  assert.ok(early, "section 2 appeared before the whole answer was done");
  assert.ok(early.indexOf("## أ") < early.indexOf("body1") && early.includes("بيتكتب"), "...below section 1's place, which shows its heading and a placeholder");
  assert.ok(!shown[shown.length - 1].includes("بيتكتب"), "the final text has no placeholder");
});

test("runSliced: a bad plan falls back to the normal single answer; one failed section keeps the others and says which", async () => {
  assert.deepEqual(await runSliced({ ask: async () => ({ text: "nonsense" }) }), { sliced: false });
  const ask = async (kind) => {
    if (kind === "plan") return { text: '{"sections":[{"title":"A"},{"title":"B"}]}' };
    if (kind.slice === 1) throw Object.assign(new Error("boom"), { detail: "d" });
    return { text: "## A\nbody", model: "m" };
  };
  let shown = "";
  await assert.rejects(runSliced({ ask, onText: (t) => { shown = t; } }), (e) => /«B»/.test(e.message) && e.partial.includes("## A"));
  assert.ok(shown.includes("## A"));
});

test("file cache: an upload is remembered and not repeated (chat turns, restarts)", async () => {
  const mem = {}; const store = { load: () => JSON.parse(JSON.stringify(mem.m || {})), save: (m) => { mem.m = m; } };
  let uploads = 0;
  const upload = async () => { uploads++; return { fileUri: "https://g/files/abc", mimeType: "application/pdf" }; };
  const big = { inlineData: { mimeType: "application/pdf", data: "A".repeat(1_200_000) } };
  const mk = () => createFileCache({ apiKey: "AIzaKEY12345678", upload, persist: true, store });
  const c1 = mk(); const out1 = await c1.swap([big, { text: "q1" }]);
  assert.equal(out1[0].fileData.fileUri, "https://g/files/abc");
  const c2 = mk(); const out2 = await c2.swap([big, { text: "q2" }]);         // a later chat turn
  assert.equal(out2[0].fileData.fileUri, "https://g/files/abc");
  assert.equal(uploads, 1, "uploaded once for the whole conversation");
  const c3 = createFileCache({ apiKey: "AIzaOTHERKEY0000", upload, persist: true, store });   // another key = another project: its own upload
  await c3.swap([big]);
  assert.equal(uploads, 2);
  c2.disable();                                                                // Google refused the link → forgotten
  assert.deepEqual(store.load(), {});
});

test("askChat end-to-end: a short question = ONE request with low thinking; a big one = plan + parallel sections", async () => {
  const { askChat, thinkFor } = await import("../src/lib/chat.js");
  assert.deepEqual(thinkFor("what does NPO mean?").levels, ["low", "minimal"]);
  assert.deepEqual(thinkFor("أنا معترض على الإجابة").levels, ["medium", "low"]);

  reset(); R.__resetRouter(); window.localStorage.clear(); setExtKeys({}); setEnginePrefs({ mode: "auto", slice: true });
  const key = "AIzaCHATKEY00001";
  const history = (t) => [{ role: "user", text: t }];
  const ctx = { kind: "global" };
  await askChat({ apiKey: key, history: history("what does NPO mean?"), ctx, onText() {} });
  const calls1 = log.filter((l) => l.lane !== "list");
  assert.equal(calls1.length, 1);
  assert.equal(calls1[0].body.generationConfig.thinkingConfig.thinkingLevel, "minimal", "v3.35: an easy question: almost no thinking …");
  assert.ok(/lite/.test(calls1[0].lane), "… on the weakest model: " + calls1[0].lane);
  reset(); R.__resetRouter();
  await askChat({ apiKey: key, history: history("why is the answer B?"), ctx, onText() {} });
  const calls1b = log.filter((l) => l.lane !== "list");
  assert.equal(calls1b[0].body.generationConfig.thinkingConfig.thinkingLevel, "medium", "a 'why' question is not easy");
  assert.ok(!/lite/.test(calls1b[0].lane), calls1b[0].lane);

  reset(); R.__resetRouter();
  /* v3.27: the outline request goes to the smallest, fastest model first; the sections are written by the everyday model */
  script("gemini:gemini-flash-lite-latest", { ok: '{"sections":[{"title":"A","focus":"a"},{"title":"B","focus":"b"}]}' });
  script("gemini:gemini-flash-latest", { ok: "## X\ntext" });
  const out = await askChat({ apiKey: key, history: history("اشرحلي أمراض القلب بالتفصيل"), ctx, onText() {} });
  const calls2 = log.filter((l) => l.lane !== "list");
  assert.equal(calls2.length, 3, "1 plan + 2 sections");
  assert.ok(out.text.includes("## X"));
  // the system prompt of every section is identical to the normal one + the section instruction (cache-friendly prefix)
  assert.ok(calls2[1].body.systemInstruction.parts[0].text.includes("PARALLEL WRITING"));
});

test("reply level: the level decides the model family, the thinking depth and the hedging", async () => {
  const { askChat, replyPlan, REPLY_LEVELS, DEFAULT_LEVEL } = await import("../src/lib/chat.js");
  const lists = { fast: ["gemini-flash-latest", "gemini-flash-lite-latest"], pro: ["gemini-pro-latest"] };
  assert.deepEqual(REPLY_LEVELS.map((l) => l.id), ["quick", "balanced", "deep", "max"]);
  assert.equal(DEFAULT_LEVEL, "balanced");
  assert.equal(replyPlan("quick", lists, "x").models[0], "gemini-flash-lite-latest");     // the small model first
  assert.equal(replyPlan("balanced", lists, "x").models[0], "gemini-flash-latest");       // the everyday model
  assert.equal(replyPlan("deep", lists, "x").models[0], "gemini-pro-latest");             // the strong model
  assert.equal(replyPlan("max", lists, "x").models[0], "gemini-pro-latest");
  assert.equal(replyPlan("max", lists, "x").think.levels[0], "high");
  assert.equal(replyPlan("deep", lists, "x").hedgeClass, "solve");                        // a thinking model is never raced after 4 s
  assert.equal(replyPlan("nonsense", lists, "x").id, "balanced");                         // an unknown value falls back to the default
  assert.ok(replyPlan("deep", lists, "x").maxOut > replyPlan("quick", lists, "x").maxOut);

  const key = "AIzaLEVELKEY0001";
  const ctx = { kind: "global" };
  const ask = async (level, text = "why is the answer B in this question?") => {       // a question that is NOT easy: the level alone decides the model
    reset(); R.__resetRouter(); window.localStorage.clear(); setExtKeys({}); setEnginePrefs({ mode: "auto", slice: true });
    await askChat({ apiKey: key, history: [{ role: "user", text }], ctx, level, onText() {} });
    const calls = log.filter((l) => l.lane !== "list");
    assert.equal(calls.length, 1, level);
    return calls[0];
  };
  const quick = await ask("quick");
  assert.ok(/lite/.test(quick.lane), quick.lane);
  assert.ok(quick.body.systemInstruction.parts[0].text.includes("QUICK"));
  const bal = await ask("balanced");
  assert.ok(/gemini-flash-latest/.test(bal.lane) && !bal.body.systemInstruction.parts[0].text.includes("REPLY LEVEL"), bal.lane);
  const deep = await ask("deep");
  assert.ok(/pro/.test(deep.lane), deep.lane);
  assert.equal(deep.body.generationConfig.thinkingConfig.thinkingLevel, "medium");
  const max = await ask("max");
  assert.ok(/pro/.test(max.lane), max.lane);
  assert.equal(max.body.generationConfig.thinkingConfig.thinkingLevel, "high");
  assert.ok(max.body.systemInstruction.parts[0].text.includes("MAXIMUM ACCURACY"));
});

test("'summarise what I studied' is a BIG ask, split by the student's own topics, with NO planning request", async () => {
  const { isBigAsk, isLibraryAsk, localOutline } = await import("../src/lib/chatflow.js");
  const { askChat } = await import("../src/lib/chat.js");
  for (const t of ["لخص ما ذاكرت", "لخصلي اللي ذاكرته", "لخّصلي أهم الأفكار والتريكات في الأسئلة والشروحات اللي ذاكرتها، مجمّعة حسب الموضوع.", "summarize everything I studied"]) {
    assert.ok(isLibraryAsk(t) && isBigAsk(t), t);
  }
  for (const t of ["لخّصلي القاعدة في سطرين", "ليه الإجابة B؟", "هل ذاكرت الموضوع ده قبل كده؟"]) assert.ok(!isBigAsk(t), t);

  const questions = Array.from({ length: 7 }, (_, i) => ({ id: "q" + i, kind: "question", title: "سؤال " + i, explanation: "شرح رقم " + i, original_question_text: "text " + i, updatedAt: 100 - i }));
  const topics = { list: [
    { id: "t1", name: "القلب", emoji: "❤️", qids: ["q0", "q1", "q2"] }, { id: "t2", name: "الكلى", emoji: "💧", qids: ["q3", "q4"] },
    { id: "t3", name: "الأدوية", emoji: "💊", qids: ["q5"] },
  ] };
  const o = localOutline(topics, questions, 4);
  assert.equal(o.length, 3, "one section per topic when there are 3 topics");
  const all = o.flatMap((x) => x.ids).sort();
  assert.deepEqual(all, questions.map((q) => q.id).sort(), "every saved item belongs to exactly one section (q6 has no topic → lightest group)");
  assert.equal(new Set(all).size, all.length);
  assert.equal(localOutline({ list: [{ id: "t", name: "x", qids: ["q0"] }] }, questions, 4), null, "one topic = nothing to split");

  reset(); R.__resetRouter(); window.localStorage.clear(); setExtKeys({}); setEnginePrefs({ mode: "auto", slice: true });
  script("gemini:gemini-flash-latest", { ok: "## part\nbody" });
  const out = await askChat({ apiKey: "AIzaLIBKEY000001", history: [{ role: "user", text: "لخص ما ذاكرت" }], ctx: { kind: "global" }, library: { questions, topics }, onText() {} });
  const calls = log.filter((l) => l.lane !== "list");
  assert.equal(calls.length, 3, "3 writers at once and no plan request");
  assert.ok(calls.every((c) => c.body.systemInstruction.parts[0].text.includes("PARALLEL WRITING")));
  const bodies = calls.map((c) => c.body.contents[0].parts.map((p) => p.text || "").join("\n"));
  assert.ok(bodies.some((b) => b.includes("شرح رقم 0")) && bodies.some((b) => b.includes("شرح رقم 3")) && bodies.some((b) => b.includes("شرح رقم 5")), "each writer sees the full text of the items it owns");
  assert.ok(!bodies[0].includes("شرح رقم 5") || !bodies[0].includes("شرح رقم 0"), "...and not everyone's");
  assert.ok(out.text.includes("## part"));
});

test("stripPending: a stopped answer keeps what was written and loses the held places", async () => {
  const { stripPending, compose } = await import("../src/lib/chatflow.js");
  const outline = [{ title: "أ" }, { title: "ب" }, { title: "ج" }];
  const mid = compose(["## أ\nbody", "", ""], [false, false, false], false, outline);
  assert.ok(mid.includes("بيتكتب"));
  assert.equal(stripPending(mid), "## أ\nbody");
  assert.equal(stripPending(compose(["", "x", ""], [false, false, false], false, outline)), "x");
});

test("search first: every tutor answer asks Google Search, and the pages it used come back as tidy sources", async () => {
  const { askChat } = await import("../src/lib/chat.js");
  const { readSources, needsNote } = await import("../src/lib/sources.js");
  const G = {
    groundingChunks: [{ web: { uri: "https://vertexaisearch.cloud.google.com/r/1", title: "who.int" } }, { web: { uri: "https://vertexaisearch.cloud.google.com/r/2", title: "cdc.gov" } }, { web: { uri: "https://vertexaisearch.cloud.google.com/r/3", title: "who.int" } }, { web: { uri: "javascript:alert(1)", title: "evil" } }],
    webSearchQueries: ["hand hygiene steps", "hand hygiene steps"],
  };
  const base = () => { reset(); R.__resetRouter(); window.localStorage.clear(); setExtKeys({}); setEnginePrefs({ mode: "auto", slice: true }); };
  const key = "AIzaSRCKEY0000001";
  const hist = [{ role: "user", text: "how long should hand hygiene take, and why?" }];      // not an easy question: it goes to the everyday model

  base(); script("gemini:gemini-flash-latest", { ok: "20 seconds.", grounding: G });
  const out = await askChat({ apiKey: key, history: hist, ctx: { kind: "global" }, onText() {} });
  const call = log.filter((l) => l.lane !== "list")[0];
  assert.deepEqual(call.body.tools, [{ google_search: {} }]);
  assert.ok(call.body.systemInstruction.parts[0].text.includes("SEARCH FIRST"));
  assert.equal(out.searchOn, true);
  assert.deepEqual(out.sources.links.map((l) => l.title), ["who.int", "cdc.gov"], "deduplicated by site; a non-http link is dropped");
  assert.deepEqual(out.sources.queries, ["hand hygiene steps"]);

  base(); setEnginePrefs({ search: false }); script("gemini:gemini-flash-latest", { ok: "20 seconds.", grounding: G });
  const off = await askChat({ apiKey: key, history: hist, ctx: { kind: "global" }, onText() {} });
  const c2 = log.filter((l) => l.lane !== "list")[0];
  assert.ok(!c2.body.tools && !c2.body.systemInstruction.parts[0].text.includes("SEARCH FIRST"));
  assert.equal(off.searchOn, false);

  base(); script("gemini:gemini-flash-latest", { status: 400, msg: "Search as a tool is not supported for this model" }, { ok: "plain answer" });
  const fb = await askChat({ apiKey: key, history: hist, ctx: { kind: "global" }, onText() {} });
  const reqs = log.filter((l) => l.lane !== "list");
  assert.equal(reqs.length, 2); assert.ok(reqs[0].body.tools && !reqs[1].body.tools, "a model that refuses the tool still answers, without it");
  assert.equal(fb.text, "plain answer"); assert.equal(fb.sources.links.length, 0);

  assert.equal(needsNote("x".repeat(300), { links: [] }, true), true);
  assert.equal(needsNote("short", { links: [] }, true), false);
  assert.equal(needsNote("x".repeat(300), { links: [{ url: "https://a.b", title: "a" }] }, true), false);
  assert.equal(needsNote("x".repeat(300), { links: [] }, false), false);
  assert.equal(readSources([]).links.length, 0); assert.equal(readSources(null).links.length, 0);
});

test("search first: a big answer plans WITHOUT search, writes WITH search, and merges the sources of all writers", async () => {
  const { askChat } = await import("../src/lib/chat.js");
  reset(); R.__resetRouter(); window.localStorage.clear(); setExtKeys({}); setEnginePrefs({ mode: "auto", slice: true });
  script("gemini:gemini-flash-lite-latest", { ok: '{"sections":[{"title":"A","focus":"a"},{"title":"B","focus":"b"}]}' });
  script("gemini:gemini-flash-latest",
    { ok: "## A\ntext a", grounding: { groundingChunks: [{ web: { uri: "https://x.test/1", title: "nih.gov" } }] } },
    { ok: "## B\ntext b", grounding: { groundingChunks: [{ web: { uri: "https://x.test/2", title: "nih.gov" } }, { web: { uri: "https://x.test/3", title: "fda.gov" } }] } });
  const out = await askChat({ apiKey: "AIzaSRCKEY0000002", history: [{ role: "user", text: "اشرحلي بالتفصيل كل حاجة عن الدورة الدموية وأمراض القلب من الصفر" }], ctx: { kind: "global" }, onText() {} });
  const calls = log.filter((l) => l.lane !== "list");
  const plan = calls.find((c) => /lite/.test(c.lane));
  assert.ok(plan && !plan.body.tools, "the outline request never searches");
  const writers = calls.filter((c) => !/lite/.test(c.lane));
  assert.ok(writers.length >= 2 && writers.every((c) => c.body.tools), "every writer searches");
  assert.deepEqual(out.sources.links.map((l) => l.title).sort(), ["fda.gov", "nih.gov"], "merged and deduplicated across writers");
});

test("speed: a library summary never searches the web; an ordinary question does and gets an earlier hedge than a plain solve", async () => {
  const { askChat } = await import("../src/lib/chat.js");
  const { HEDGE_MS } = await import("../src/lib/router.js");
  assert.ok(HEDGE_MS.search.min < HEDGE_MS.solve.min && HEDGE_MS.search.min > HEDGE_MS.chat.min);
  const questions = Array.from({ length: 4 }, (_, i) => ({ id: "q" + i, kind: "question", title: "سؤال " + i, explanation: "شرح " + i, original_question_text: "t" + i, updatedAt: 9 - i }));
  const topics = { list: [{ id: "a", name: "أ", qids: ["q0", "q1"] }, { id: "b", name: "ب", qids: ["q2", "q3"] }] };
  reset(); R.__resetRouter(); window.localStorage.clear(); setExtKeys({}); setEnginePrefs({ mode: "auto", slice: true });
  script("gemini:gemini-flash-latest", { ok: "## part\nbody" });
  const out = await askChat({ apiKey: "AIzaFAST000000001", history: [{ role: "user", text: "لخص ما ذاكرت" }], ctx: { kind: "global" }, library: { questions, topics }, onText() {} });
  const calls = log.filter((l) => l.lane !== "list");
  assert.ok(calls.length >= 2 && calls.every((c) => !c.body.tools && !c.body.systemInstruction.parts[0].text.includes("SEARCH FIRST")), "no web search for a summary of the student's own items");
  assert.equal(out.searchOn, false);
  reset(); R.__resetRouter(); script("gemini:gemini-flash-latest", { ok: "answer" });
  const q = await askChat({ apiKey: "AIzaFAST000000001", history: [{ role: "user", text: "ما هي قيمة البوتاسيوم الطبيعية؟" }], ctx: { kind: "global" }, library: { questions, topics }, onText() {} });
  assert.equal(q.searchOn, true);
  assert.ok(log.filter((l) => l.lane !== "list")[0].body.tools);
});

test("search 429 (v3.34): a chat question whose search request is turned away is answered by the SAME model without the search tool, not failed on every model", async () => {
  const { askChat } = await import("../src/lib/chat.js");
  const { __resetSearchGate } = await import("../src/lib/gemini.js");
  const base = () => { reset(); R.__resetRouter(); window.localStorage.clear(); setExtKeys({}); setEnginePrefs({ mode: "auto", slice: true }); __resetSearchGate(); };
  const key = "AIzaSRCH429KEY0001";
  const hist = [{ role: "user", text: "مش فاهم ليه 3 غلط" }];
  const reqs = () => log.filter((l) => l.lane !== "list");
  const FLASH = "gemini:gemini-flash-latest";

  /* a plain 429 on the request that carries the search tool */
  base(); script(FLASH, { status: 429, msg: "Resource has been exhausted (e.g. check quota)." }, { ok: "الإجابة B لأن الأولوية للـ airway." });
  const a = await askChat({ apiKey: key, history: hist, ctx: { kind: "global" }, onText() {} });
  const r1 = reqs();
  assert.equal(r1.length, 2, "one rejected request + one answer: no tour of every model");
  assert.ok(r1[0].body.tools && !r1[1].body.tools, "the second request leaves the search tool out");
  assert.equal(r1[0].lane, r1[1].lane, "same model, not the next one");
  assert.ok(r1[0].body.systemInstruction.parts[0].text.includes("SEARCH FIRST"));
  assert.ok(!r1[1].body.systemInstruction.parts[0].text.includes("SEARCH FIRST"), "without the tool the model is not told to search");
  assert.equal(a.text, "الإجابة B لأن الأولوية للـ airway.");
  assert.equal(a.sources.links.length, 0);
  assert.equal(a.searchOn, true, "the screen can then say the answer has no sources");

  /* the 429 is about the search quota itself: the next questions skip the tool at once (no wasted round trip) */
  base(); script(FLASH, { status: 429, msg: "Quota exceeded for metric: generativelanguage.googleapis.com/search_grounding_requests, limit: 5" }, { ok: "answer 1" }, { ok: "answer 2" });
  await askChat({ apiKey: key, history: hist, ctx: { kind: "global" }, onText() {} });
  assert.equal(reqs().length, 2);
  const before = reqs().length;
  const b = await askChat({ apiKey: key, history: hist, ctx: { kind: "global" }, onText() {} });
  const r2 = reqs().slice(before);
  assert.equal(r2.length, 1); assert.ok(!r2[0].body.tools, "search stays off for a few minutes after Google refused it");
  assert.equal(b.text, "answer 2");
  __resetSearchGate();

  /* a finished DAILY quota of the model itself: asking again without the tool would change nothing, so no extra request is made on that model */
  base(); script(FLASH, { status: 429, msg: "You exceeded your current quota, limit: 20 per day", details: [{ violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier", quotaValue: "20", quotaDimensions: { model: "gemini-flash-latest" } }] }] });
  const c = await askChat({ apiKey: key, history: hist, ctx: { kind: "global" }, onText() {} });
  assert.equal(reqs().filter((l) => l.lane === FLASH).length, 1, "a dead daily quota is not retried");
  assert.ok(c.text, "another model answered");
  __resetSearchGate();
});


test("easy questions (v3.35): isEasyAsk is strict; an easy chat question goes to the weakest model with no thinking, everything else is untouched", async () => {
  const { isEasyAsk, replyPlan, askChat } = await import("../src/lib/chat.js");
  for (const t of ["what does NPO mean?", "ايه معنى tachycardia؟", "يعني ايه bradycardia", "define edema"]) assert.equal(isEasyAsk(t), true, t);
  for (const t of ["", "why is B wrong", "ليه الإجابة ب غلط؟", "قارن بين الاتنين", "calculate the dose of 5 mg/kg", "the normal potassium is 3.5-5", "اشرحلي أمراض القلب", "summarize the lesson", "اعمل امتحان على القلب", "what does NPO mean?\nand NPO after midnight?", "x ".repeat(30), "ذاكرت ايه؟"]) assert.equal(isEasyAsk(t), false, t);
  assert.equal(isEasyAsk("what does NPO mean?", { files: 1 }), false, "an attached file is never easy");
  assert.equal(isEasyAsk("what does NPO mean?", { turns: 9 }), false, "deep inside a long conversation it is not self-contained");

  const lists = { fast: ["gemini-flash-latest", "gemini-flash-lite-latest"], pro: ["gemini-pro-latest"] };
  assert.deepEqual(replyPlan("balanced", lists, "x", { easy: true }).models, ["gemini-flash-lite-latest", "gemini-flash-latest", "gemini-pro-latest"], "weakest first, the strongest last");
  assert.equal(replyPlan("balanced", lists, "x").models[0], "gemini-flash-latest", "not easy: as before");
  assert.equal(replyPlan("deep", lists, "x", { easy: true }).models[0], "gemini-pro-latest", "a level the student chose is never lowered");
  assert.equal(replyPlan("max", lists, "x", { easy: true }).models[0], "gemini-pro-latest");

  reset(); R.__resetRouter(); window.localStorage.clear(); setExtKeys({}); setEnginePrefs({ mode: "auto", slice: true });
  const out = await askChat({ apiKey: "AIzaEASYKEY00000001", history: [{ role: "user", text: "ايه معنى NPO؟" }], ctx: { kind: "global" }, level: "deep", onText() {} });
  assert.ok(/pro/.test(log.filter((l) => l.lane !== "list")[0].lane), "deep stays on the strong model even for an easy sentence");
  assert.ok(out.text);
});
