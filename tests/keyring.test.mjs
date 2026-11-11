import test from "node:test";
import assert from "node:assert/strict";
import { installFetch, script, reset, log } from "./mockfetch.mjs";
import * as R from "../src/lib/router.js";
import * as Ring from "../src/lib/keyring.js";
import { setExtKeys, setEnginePrefs, getExtKeys, getExtLanes, buildBody, PROVIDERS } from "../src/lib/providers.js";

installFetch();

const G1 = "AIzaRING0000000000000000000001", G2 = "AIzaRING0000000000000000000002", G3 = "AIzaRING0000000000000000000003";
const C1 = "sk-ant-api03-RINGCLAUDE0000000000000001", C2 = "sk-ant-api03-RINGCLAUDE0000000000000002";
const O1 = "sk-proj-RINGOPENAI000000000000000001";
const fresh = () => { reset(); R.__resetRouter(); window.localStorage.clear(); Ring.__resetKeyring(); Ring.__setClock(); setExtKeys({}); setEnginePrefs({ mode: "auto", slice: true, search: false }); };
const reqs = () => log.filter((l) => l.lane !== "list");
const GEM_MODELS = ["gemini-flash-latest", "gemini-flash-lite-latest", "gemini-pro-latest", "gemini-3.1-pro-preview"];
const scriptAll = (key, step) => GEM_MODELS.forEach((m) => script(`gemini:${m}#${key}`, step));

test("detectProvider: one box, any key: the app knows whose it is", () => {
  assert.equal(Ring.detectProvider(G1), "gemini");
  assert.equal(Ring.detectProvider(C1), "anthropic");
  assert.equal(Ring.detectProvider(O1), "openai");
  assert.equal(Ring.detectProvider("sk-abcdefghijklmnopqrstuvwxyz0123456789"), "openai");
  assert.equal(Ring.detectProvider("sk-or-v1-abcdefghijklmnopqrstuvwxyz"), "openrouter");
  assert.equal(Ring.detectProvider("gsk_abcdefghijklmnopqrstuvwxyz0123"), "groq");
  assert.equal(Ring.detectProvider("abcdefghijklmnopqrstuvwxyz012345"), "unknown");
  assert.equal(Ring.detectProvider(""), "unknown");
  assert.equal(Ring.detectProvider("AQ.Ab8RN6IEKR0Ehbgy9BWS7jVTs-SHxxxxxxxxxxxx"), "gemini");
});

test("the ring: any number of keys, in order; duplicates and junk are refused; keys can be moved and removed", () => {
  fresh();
  assert.ok(Ring.addKey(G1).ok); assert.ok(Ring.addKey(C1).ok); assert.ok(Ring.addKey(G2).ok);
  assert.deepEqual(Ring.listKeys().map((e) => e.provider), ["gemini", "anthropic", "gemini"]);
  assert.deepEqual(Ring.keysOf("gemini"), [G1, G2]);
  assert.equal(Ring.addKey(G1).dup, true);
  assert.equal(Ring.addKey("short").ok, false);
  assert.equal(Ring.addKey("has a space in it 1234567890").ok, false);
  assert.equal(Ring.addKey("abcdefghijklmnopqrstuvwxyz012345").reason, "unknown");
  for (let i = 0; i < 25; i++) assert.ok(Ring.addKey(`AIzaMANY${String(i).padStart(24, "0")}`).ok, "no limit on the number of keys");
  assert.equal(Ring.keysOf("gemini").length, 27);
  const id = Ring.listKeys().find((e) => e.key === G2).id;
  assert.ok(Ring.moveKey(id, -1));                       // swaps with its neighbour in the list the student sees (the Claude key)
  assert.deepEqual(Ring.listKeys().slice(0, 3).map((e) => e.key), [G1, G2, C1]);
  assert.ok(Ring.moveKey(id, -1));
  assert.deepEqual(Ring.keysOf("gemini").slice(0, 2), [G2, G1]);
  assert.equal(Ring.moveKey(id, -1), false, "already first");
  assert.equal(Ring.removeKey(id).key, G2);
  assert.ok(!Ring.keysOf("gemini").includes(G2));
  assert.equal(Ring.mask(G1), "AIza…0001");
});

test("a key put aside is skipped, and comes back by itself when its time is up", () => {
  fresh();
  let t = 1_000_000; Ring.__setClock(() => t);
  Ring.addKey(G1); Ring.addKey(G2);
  assert.deepEqual(Ring.candidates("gemini"), [G1, G2]);
  Ring.penalize(G1, 60_000, "day");
  assert.deepEqual(Ring.candidates("gemini"), [G2]);
  assert.equal(Ring.statusOf(Ring.listKeys()[0]).state, "day");
  t += 61_000;
  assert.deepEqual(Ring.candidates("gemini"), [G1, G2], "the first key is first again");
  /* a key outside the ring (the one a caller passes) goes last; tried keys are never offered twice */
  assert.deepEqual(Ring.candidates("gemini", { extra: G3 }), [G1, G2, G3]);
  assert.deepEqual(Ring.candidates("gemini", { tried: new Set([G1]) }), [G2]);
  /* nothing live: the keys are still offered (soonest to wake first) so the provider's real error can be shown; once tried, nothing */
  Ring.penalize(G1, 300_000, "day"); Ring.penalize(G2, 100_000, "busy");
  assert.deepEqual(Ring.candidates("gemini"), [G2, G1]);
  assert.deepEqual(Ring.candidates("gemini", { tried: new Set([G2]) }), [], "with a key already tried and none live there is nothing left");
  Ring.__setClock();
});

test("migration: the three boxes of v3.33 and the single Gemini key become ring entries (once); an old key never comes back over a newer ring", () => {
  fresh(); window.localStorage.removeItem("clinix:keyring:v1");      // as on a device that has never had a ring
  window.localStorage.setItem("clinix:xkeys:v1", JSON.stringify({ groq: "gsk_oldgroqkey0000000000000000", mistral: "" }));
  assert.deepEqual(Ring.listKeys().map((e) => e.provider), ["groq"]);
  Ring.seedLegacyGemini(G1);
  assert.deepEqual(Ring.listKeys().map((e) => e.provider), ["gemini", "groq"]);
  assert.equal(getExtKeys().groq, "gsk_oldgroqkey0000000000000000", "the old API of providers.js still sees it");
  fresh(); Ring.addKey(G2); Ring.seedLegacyGemini(G1);
  assert.deepEqual(Ring.keysOf("gemini"), [G2]);
});

test("Claude and ChatGPT: their own request formats", () => {
  const lane = (p, model) => ({ id: `${p}:${model}`, provider: p, model, vision: true, effort: false });
  const parts = [{ text: "hello" }, { inlineData: { mimeType: "image/png", data: "AAAA" } }];
  const a = buildBody({ lane: lane("anthropic", "claude-sonnet-5-5"), system: "SYS", parts, spec: { levels: ["low"] }, maxOut: 4000 });
  assert.equal(a.system, "SYS"); assert.equal(a.max_tokens, 4000); assert.equal(a.stream, true);
  assert.deepEqual(a.messages[0].content.map((c) => c.type), ["text", "image"]);
  assert.equal(a.messages[0].content[1].source.media_type, "image/png");
  assert.ok(!("temperature" in a));
  const o = buildBody({ lane: lane("openai", "gpt-5"), system: "SYS", parts: [{ text: "hi" }], spec: { levels: ["low"] }, maxOut: 4000 });
  assert.equal(o.max_completion_tokens, 4000); assert.ok(!("max_tokens" in o) && !("temperature" in o));
  assert.equal(o.messages[0].role, "system");
  assert.ok(PROVIDERS.anthropic.paid && PROVIDERS.openai.paid && !PROVIDERS.groq.paid);
});

test("ring · Gemini: a refused key is skipped IN THE SAME request; the next call does not even touch it", async () => {
  const { askChat } = await import("../src/lib/chat.js");
  fresh(); Ring.addKey(G1); Ring.addKey(G2);
  scriptAll(G1, { status: 400, msg: "API key not valid. Please pass a valid API key." });
  const out = await askChat({ apiKey: G1, history: [{ role: "user", text: "what does NPO mean?" }], ctx: { kind: "global" }, onText() {} });
  assert.ok(out.text);
  const r = reqs();
  assert.equal(r[0].key, G1); assert.equal(r[r.length - 1].key, G2, "answered by the second key");
  assert.equal(Ring.statusOf(Ring.listKeys()[0]).state, "bad");
  const n = reqs().length;
  await askChat({ apiKey: G1, history: [{ role: "user", text: "and NPO after midnight?" }], ctx: { kind: "global" }, onText() {} });
  assert.ok(reqs().slice(n).every((l) => l.key === G2), "the refused key is not tried again");
});

test("ring · Gemini: the daily quota of key 1 finishes → key 2 answers at once, and key 1 is left alone until the reset", async () => {
  const { askChat } = await import("../src/lib/chat.js");
  fresh(); Ring.addKey(G1); Ring.addKey(G2);
  const daily = { status: 429, msg: "You exceeded your current quota, limit: 20 per day", details: [{ violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier", quotaValue: "20" }] }] };
  scriptAll(G1, daily);
  const t0 = Date.now();
  const out = await askChat({ apiKey: G1, history: [{ role: "user", text: "explain heparin in one line" }], ctx: { kind: "global" }, onText() {} });
  assert.ok(out.text); assert.ok(Date.now() - t0 < 6000, "no long wait: " + (Date.now() - t0));
  assert.equal(reqs().pop().key, G2);
  const pen = Ring.penaltyOf(G1, "mid");                    // v3.35: "explain …" is not an easy question → it starts on the middle model; only that size is put aside, not the whole key
  assert.equal(pen.why, "day"); assert.ok(pen.until - Date.now() > 60_000, "put aside until the daily reset");
  const n = reqs().length;
  await askChat({ apiKey: G1, history: [{ role: "user", text: "explain warfarin in one line" }], ctx: { kind: "global" }, onText() {} });
  assert.ok(reqs().slice(n).length >= 1 && reqs().slice(n).every((l) => l.key === G2));
});

test("ring · Gemini: a per-minute 429 / busy key hands over to the next key without a long wait", async () => {
  const { askChat } = await import("../src/lib/chat.js");
  fresh(); Ring.addKey(G1); Ring.addKey(G2);
  scriptAll(G1, { status: 429, msg: "Resource has been exhausted (e.g. check quota).", retry: 30 });
  const t0 = Date.now();
  const out = await askChat({ apiKey: G1, history: [{ role: "user", text: "what is a PRN order?" }], ctx: { kind: "global" }, onText() {} });
  assert.ok(out.text); assert.ok(Date.now() - t0 < 6000, "took " + (Date.now() - t0));
  assert.equal(reqs().pop().key, G2);
  assert.equal(Ring.penaltyOf(G1, "weak").why, "busy");
});

test("ring · with ONE key nothing changes: its daily quota finishing is still said plainly", async () => {
  const { askChat } = await import("../src/lib/chat.js");
  fresh(); Ring.addKey(G1);
  const daily = { status: 429, msg: "You exceeded your current quota, limit: 20 per day", details: [{ violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier", quotaValue: "20" }] }] };
  scriptAll(G1, daily);
  await assert.rejects(() => askChat({ apiKey: G1, history: [{ role: "user", text: "hi there" }], ctx: { kind: "global" }, onText() {} }), (e) => e.status === 429);
});

test("ring · a key that is penalised comes back by itself (the first key is the first again after its time)", async () => {
  const { askChat } = await import("../src/lib/chat.js");
  fresh(); Ring.addKey(G1); Ring.addKey(G2);
  Ring.penalize(G1, 30_000, "busy");
  await askChat({ apiKey: G1, history: [{ role: "user", text: "what is a PRN order?" }], ctx: { kind: "global" }, onText() {} });
  assert.ok(reqs().every((l) => l.key === G2));
  Ring.__setClock(() => Date.now() + 31_000);
  const n = reqs().length;
  await askChat({ apiKey: G1, history: [{ role: "user", text: "and a STAT order?" }], ctx: { kind: "global" }, onText() {} });
  assert.equal(reqs()[n].key, G1);
  Ring.__setClock();
});

test("ring · Claude alone is enough for chat (no Google key at all)", async () => {
  const { askChat } = await import("../src/lib/chat.js");
  fresh(); Ring.addKey(C1);
  const out = await askChat({ apiKey: Ring.NO_GEMINI, history: [{ role: "user", text: "what does NPO mean?" }], ctx: { kind: "global" }, onText() {} });
  assert.ok(out.text.startsWith("hello from anthropic:"), out.text);
  const r = reqs();
  assert.equal(r.length, 1); assert.equal(r[0].key, C1);
  assert.ok(r[0].body.system && r[0].body.messages[0].content[0].type === "text");
  assert.ok(!reqs().some((l) => l.lane.startsWith("gemini:")), "no request went to Google");
});

test("ring · ChatGPT and Claude are a safety net: never used while Google answers, used the moment it cannot", async () => {
  const { askChat } = await import("../src/lib/chat.js");
  fresh(); Ring.addKey(G1); Ring.addKey(C1); Ring.addKey(O1);
  const out = await askChat({ apiKey: G1, history: [{ role: "user", text: "what does NPO mean?" }], ctx: { kind: "global" }, onText() {} });
  assert.ok(out.text.startsWith("hello from gemini:"));
  assert.ok(reqs().every((l) => l.lane.startsWith("gemini:")), "a paid key is not spent while the free lane works");

  fresh(); Ring.addKey(G1); Ring.addKey(C1);
  scriptAll(G1, { status: 503, msg: "The model is overloaded." });
  const out2 = await askChat({ apiKey: G1, history: [{ role: "user", text: "what does NPO mean?" }], ctx: { kind: "global" }, onText() {} });
  assert.ok(out2.text.startsWith("hello from anthropic:"), out2.text);
});

test("ring · two Claude keys: the one out of credit is skipped inside the same request", async () => {
  const { askChat } = await import("../src/lib/chat.js");
  fresh(); Ring.addKey(C1); Ring.addKey(C2);
  script(`anthropic:claude-sonnet-5-5#${C1}`, { status: 400, msg: "Your credit balance is too low to access the Anthropic API." });
  script(`anthropic:claude-haiku-5-5#${C1}`, { status: 400, msg: "Your credit balance is too low to access the Anthropic API." });
  const out = await askChat({ apiKey: Ring.NO_GEMINI, history: [{ role: "user", text: "what does NPO mean?" }], ctx: { kind: "global" }, onText() {} });
  assert.ok(out.text.startsWith("hello from anthropic:"));
  const r = reqs();
  assert.equal(r[0].key, C1); assert.equal(r[r.length - 1].key, C2);
  assert.equal(Ring.penaltyOf(C1).why, "day");
});

test("addApiKey: pasted, recognised, checked with its company, added; a wrong key is refused", async () => {
  const { addApiKey } = await import("../src/lib/gemini.js");
  fresh();
  const a = await addApiKey(G1);
  assert.ok(a.ok && a.provider === "gemini", a.msg);
  const b = await addApiKey(C1);
  assert.ok(b.ok && b.provider === "anthropic");
  const probe = log.filter((l) => l.lane === "list").map((l) => l.url);
  assert.ok(probe.some((u) => u.includes("generativelanguage")) && probe.some((u) => u.includes("api.anthropic.com")), "each key was checked at its own company");
  assert.equal((await addApiKey(G1)).ok, false, "duplicate");
  script("list#" + G2, { status: 400, msg: "API key not valid" });
  const bad = await addApiKey(G2);
  assert.equal(bad.ok, false); assert.ok(!Ring.keysOf("gemini").includes(G2));
  /* no prefix: each company is asked in turn; Google refuses it, Mistral claims it */
  script("list:gemini#abcdefghijklmnopqrstuvwxyz012345", { status: 400, msg: "API key not valid" });
  const m = await addApiKey("abcdefghijklmnopqrstuvwxyz012345");
  assert.ok(m.ok && m.provider === "mistral");
  script("list#zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz", { status: 401, msg: "unauthorized" });
  const u = await addApiKey("zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz");
  assert.equal(u.ok, false);
  /* a brand-new Google key shape with no known prefix is still recognised, because Google accepts it */
  const nk = await addApiKey("ZZ.newgooglekeyshape0000000000000001");
  assert.ok(nk.ok && nk.provider === "gemini", nk.msg);
});

/* ── v3.35 · tier first, then key ── */
import { runTask } from "../src/lib/gemini.js";
const LITE = "gemini-flash-lite-latest", FLASH = "gemini-flash-latest", PRO = "gemini-pro-latest";
const job = (models, task = "words") => runTask({ apiKey: G1, models, task, system: "s", parts: [{ text: "hi" }], spec: { levels: ["low"], budget: 0 }, maxOut: 1000, signal: new AbortController().signal, onText() {} });
const DAILY = { status: 429, msg: "You exceeded your current quota, limit: 20 per day", details: [{ violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier", quotaValue: "20" }] }] };

test("tiers: tierOf / weakFirst / tierStages", () => {
  assert.equal(R.tierOf("gemini-flash-lite-latest"), "weak"); assert.equal(R.tierOf("gemini-3.1-pro-preview"), "strong"); assert.equal(R.tierOf("gemini-3-flash-preview"), "mid");
  assert.deepEqual(R.weakFirst([FLASH, PRO, LITE, "gemini-3-flash-preview"]), [LITE, FLASH, "gemini-3-flash-preview", PRO]);
  assert.deepEqual(R.tierStages([PRO, FLASH, LITE, "gemini-3.1-pro-preview"]).map((x) => [x.tier, x.models.length]), [["strong", 2], ["mid", 1], ["weak", 1]]);
});

test("tiers · the weak model of key 1 is finished → the weak job goes to the weak model of key 2, and key 1's strong model is NOT touched", async () => {
  fresh(); Ring.addKey(G1); Ring.addKey(G2);
  script(`gemini:${LITE}#${G1}`, DAILY);
  const t0 = Date.now();
  const r = await job(R.weakFirst([FLASH, LITE, PRO]));
  assert.equal(r.model, LITE, "answered by the weak model");
  const q = reqs();
  assert.deepEqual(q.map((l) => [l.lane.replace("gemini:", ""), l.key === G1 ? "K1" : "K2"]), [[LITE, "K1"], [LITE, "K2"]], "weak@key1 refused → weak@key2 answered; nothing else was used");
  assert.ok(Date.now() - t0 < 4000);
  assert.ok(Ring.penaltyOf(G1, "weak") && !Ring.penaltyOf(G1, "strong") && !Ring.penaltyOf(G1, "mid"), "only the weak tier of key 1 is resting");
  /* the next weak job does not even try key 1; a strong job still starts on key 1 */
  const n = reqs().length;
  await job(R.weakFirst([FLASH, LITE, PRO]));
  assert.deepEqual(reqs().slice(n).map((l) => l.key), [G2]);
  const m = reqs().length;
  const s = await job([PRO, FLASH, LITE], "lesson:solve");
  assert.equal(s.model, PRO); assert.equal(reqs()[m].key, G1, "the strong model of key 1 is still there for strong jobs");
});

test("tiers · every key's weak model finished → only THEN the job climbs to the middle model (key 1 first)", async () => {
  fresh(); Ring.addKey(G1); Ring.addKey(G2);
  script(`gemini:${LITE}#${G1}`, DAILY); script(`gemini:${LITE}#${G2}`, DAILY);
  const r = await job(R.weakFirst([FLASH, LITE, PRO]));
  assert.equal(r.model, FLASH);
  assert.deepEqual(reqs().map((l) => [l.lane.replace("gemini:", ""), l.key === G1 ? "K1" : "K2"]), [[LITE, "K1"], [LITE, "K2"], [FLASH, "K1"]]);
});

test("tiers · a strong job walks the strong model across the keys before it uses a smaller one", async () => {
  fresh(); Ring.addKey(G1); Ring.addKey(G2);
  script(`gemini:${PRO}#${G1}`, DAILY);
  const r = await job([PRO, FLASH, LITE], "lesson:solve");
  assert.equal(r.model, PRO);
  assert.deepEqual(reqs().map((l) => [l.lane.replace("gemini:", ""), l.key === G1 ? "K1" : "K2"]), [[PRO, "K1"], [PRO, "K2"]]);
});

test("tiers · any other trouble with key 1 (busy for the weak model) also moves the job to key 2", async () => {
  fresh(); Ring.addKey(G1); Ring.addKey(G2);
  script(`gemini:${LITE}#${G1}`, { status: 503, msg: "The model is overloaded." }, { status: 503, msg: "The model is overloaded." }, { status: 503, msg: "x" });
  const t0 = Date.now();
  const r = await job(R.weakFirst([FLASH, LITE, PRO]));
  assert.equal(r.model, LITE); assert.equal(reqs().pop().key, G2);
  assert.ok(Date.now() - t0 < 6000, "took " + (Date.now() - t0));
});

test("v3.38: someone who had picked 'speed' or 'quality' is moved to auto once (the buttons are gone)", async () => {
  const { retireManualModes, getEnginePrefs, setEnginePrefs: set } = await import("../src/lib/providers.js");
  fresh();
  set({ mode: "speed", reuse: false });
  retireManualModes();
  assert.equal(getEnginePrefs().mode, "auto");
  assert.equal(getEnginePrefs().reuse, false, "the other settings are untouched");
});
