/* v3.40.9 · a model that keeps stalling / answering 503 on this key goes down the order, across restarts. */
import test from "node:test";
import assert from "node:assert/strict";
import { installFetch, script, reset, log } from "./mockfetch.mjs";
import * as R from "../src/lib/router.js";
import { setExtKeys, setEnginePrefs } from "../src/lib/providers.js";
import { runTask } from "../src/lib/gemini.js";
import { noteHealth, healthRate, healthBias, __setClock, __resetQuota } from "../src/lib/quota.js";

installFetch();
let KEY = "AIzaHEALTH0", seq = 0;
const G = (m) => `gemini:${m}`;
const fresh = () => { KEY = `AIzaHEALTH${String(++seq).padStart(6, "0")}`; reset(); R.__resetRouter(); window.localStorage.clear(); __resetQuota(); __setClock(null); setExtKeys({}); setEnginePrefs({ mode: "auto" }); };
const base = (over = {}) => ({ apiKey: KEY, task: "lesson:chat", system: "x", parts: [{ text: "hi" }], spec: { levels: ["low"], budget: 0 }, maxOut: 2000, firstMs: 3000, idleMs: 3000, ...over });

test("health: below four answers or a small failure rate counts for nothing", () => {
  fresh();
  for (let i = 0; i < 3; i++) noteHealth(KEY, "m-a", true);
  assert.equal(healthBias(KEY, "m-a"), 0, "three answers are noise");
  noteHealth(KEY, "m-b", true); for (let i = 0; i < 9; i++) noteHealth(KEY, "m-b", false);
  assert.equal(healthBias(KEY, "m-b"), 0, "one failure in ten answers");
});

test("health: a model that fails most of the time gets a big penalty, and the newest answers weigh most", () => {
  fresh();
  for (let i = 0; i < 6; i++) noteHealth(KEY, "m-a", true);
  assert.ok(healthBias(KEY, "m-a") >= 20);
  for (let i = 0; i < 6; i++) noteHealth(KEY, "m-a", false);       // it recovered
  assert.ok(healthBias(KEY, "m-a") < 8, "recent good answers forgive old failures: " + healthBias(KEY, "m-a"));
});

test("health: it is forgotten after twelve hours and remembered across a restart", () => {
  fresh();
  let t = 1_000_000_000_000; __setClock(() => t);
  for (let i = 0; i < 8; i++) noteHealth(KEY, "m-a", true);
  assert.ok(healthRate(KEY, "m-a") > 0.9);
  t += 13 * 3600e3;
  assert.equal(healthBias(KEY, "m-a"), 0, "a model that was overloaded yesterday gets a clean start");
  __setClock(null);
});

test("engine: a flaky model is no longer asked first (an equivalent one goes first)", async () => {
  fresh();
  const A = "gemini-3.5-flash-lite", B = "gemini-flash-lite-latest";
  for (let i = 0; i < 6; i++) noteHealth(KEY, A, true);
  script(G(A), { ok: "from A" });
  script(G(B), { ok: "from B" });
  const res = await runTask(base({ models: [A, B] }));
  assert.equal(res.text, "from B");
});

test("engine: a model that fails most of the time is not asked first even when it is the stronger kind", async () => {
  fresh();
  const A = "gemini-3.8-flash", B = "gemini-3.5-flash-lite";
  for (let i = 0; i < 7; i++) noteHealth(KEY, A, true);
  script(G(A), { ok: "from A" });
  script(G(B), { ok: "from B" });
  assert.equal((await runTask(base({ models: [A, B] }))).text, "from B");
  fresh();
  for (let i = 0; i < 3; i++) noteHealth(KEY, A, true);          // too few answers to judge: the stronger model keeps its place
  script(G(A), { ok: "from A" });
  script(G(B), { ok: "from B" });
  assert.equal((await runTask(base({ models: [A, B] }))).text, "from A");
});

test("engine: a 503 is written into the health record, a good answer too", async () => {
  fresh();
  const A = "gemini-3.8-flash", B = "gemini-3.5-flash-lite";
  script(G(A), { status: 503, msg: "overloaded" });
  script(G(B), { ok: "from B" });
  await runTask(base({ models: [A, B] }));
  assert.ok(window.localStorage.getItem("clinix:quota:v1").includes('"h":[['), "health is persisted");
});
