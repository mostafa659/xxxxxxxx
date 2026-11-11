/* A day of studying on a FREE Gemini key, in VIRTUAL time (minutes run in a second or two).
   A fake Google enforces the free-tier limits documented for late 2026 (Flash 3.6 / 3.8: 5 requests a minute and 20 a DAY; Flash-Lite: 10 a minute and 500 a day) and answers
   with the real shape of Google's quota errors. The same student session is run on the engine of the source tree you point it at, so two versions can be compared on the
   same day:      npm run sim:free                              (this tree, quotas only)
                  node --no-warnings --import ./tests/register.mjs tests/sim/free-day.mjs <tree> [shed|stall] [seed] [quiet] [traceAnalysisNo]
     (no scenario) quotas only          shed   Flash also answers 503 to every 3rd request           stall  25% of Flash requests sit in Google's queue for ~100 s (seeded)
     N=12 sets the number of questions (default 8, one every 2.5 minutes).
   It is a MODEL of Google, built from published limits and reported error bodies: it shows how an engine behaves under those rules, it does not measure Google itself. */
/* (original header)
   A fake Google enforces the free-tier limits that are documented for late 2026 (Flash 3.6 / 3.8: 5 requests per minute + 20 per day; Flash-Lite: 10 per minute + 500 per day)
   and answers with the real shape of Google's quota errors. The SAME student session is run on the engine of whichever source tree is given.
   usage:  node --import <tree>/tests/register.mjs sim.mjs <tree> [shed]      ("shed": Flash also answers 503 to every 3rd request, as overloaded free-tier traffic does) */
import { pathToFileURL } from "node:url";
import { mock } from "node:test";

const ROOT = (process.argv[2] || process.cwd()).replace(/\/$/, "");
const SHED = process.argv[3] === "shed";
const STALL = process.argv[3] === "stall";
const TRACE_NO = parseInt(process.argv[6] || "0", 10);
let curNo = 0, curStart = 0;
const tl = [];
const SEED = parseInt(process.argv[4] || "1", 10), QUIET = process.argv[5] === "quiet", P_STALL = 0.25;
let _s = SEED * 2654435761 >>> 0;
const rnd = () => { _s |= 0; _s = _s + 0x6D2B79F5 | 0; let t = Math.imul(_s ^ _s >>> 15, 1 | _s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const T0 = Date.UTC(2026, 10, 10, 15, 0, 0);               // 17:00 in Cairo: an evening study session
mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: T0 });

const enc = new TextEncoder();
const LIM = { "gemini-3.8-flash": [5, 20, 3000], "gemini-3.6-flash": [5, 20, 3000], "gemini-3.5-flash-lite": [10, 500, 1500], "gemini-3.1-flash-lite": [10, 500, 1500] };
const ALIAS = { "gemini-flash-latest": "gemini-3.8-flash", "gemini-flash-lite-latest": "gemini-3.5-flash-lite" };
const accepted = {}, stats = { fail429: 0, fail503: 0, ok: 0, lite: 0, strong: 0 };
let shedN = 0;
const MSG = (limit, model, retry) => `You exceeded your current quota, please check your plan and billing details.\n* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: ${limit}, model: ${model}\nPlease retry in ${retry}s.`;
const qerr = (id, limit, model, retry) => ({ error: { code: 429, status: "RESOURCE_EXHAUSTED", message: MSG(limit, model, retry + ".5"), details: [{ "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaMetric: "generativelanguage.googleapis.com/generate_content_free_tier_requests", quotaId: id, quotaDimensions: { location: "global", model }, quotaValue: String(limit) }] }, { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: retry + "s" }] } });

const BODY = "ANSWER: B\nKEY: the verified reasoning. " + "x".repeat(1700);
function stream(ttft, signal) {
  const parts = BODY.match(/.{1,12}/gs);
  let i = 0, first = true;
  return new ReadableStream({
    start(c) { if (signal) signal.addEventListener("abort", () => { try { c.error(Object.assign(new Error("The operation was aborted"), { name: "AbortError" })); } catch (e) { /* already closed */ } }); },
    async pull(c) {
      if (signal && signal.aborted) { c.error(Object.assign(new Error("aborted"), { name: "AbortError" })); return; }
      await new Promise((r) => setTimeout(r, first ? ttft : 60)); first = false;
      if (signal && signal.aborted) { c.error(Object.assign(new Error("aborted"), { name: "AbortError" })); return; }
      if (i >= parts.length) { c.enqueue(enc.encode(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "" }] }, finishReason: "STOP" }] })}\n\n`)); c.close(); return; }
      c.enqueue(enc.encode(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: parts[i++] }] } }] })}\n\n`));
    },
  });
}
globalThis.fetch = async (url, init = {}) => {
  const u = String(url), signal = init.signal;
  if (!u.includes("generativelanguage")) return new Response("{}", { status: 404 });
  const m = u.match(/models\/([^:?]+)/);
  if (!m || /\/models\?/.test(u) || u.endsWith("/models")) {
    const names = ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.1-pro-preview"];
    return new Response(JSON.stringify({ models: names.map((n) => ({ name: "models/" + n, supportedGenerationMethods: ["generateContent"] })) }), { status: 200 });
  }
  const model = m[1], canon = ALIAS[model] || model, now = Date.now();
  if (!LIM[canon]) return new Response(JSON.stringify(qerr("GenerateRequestsPerDayPerProjectPerModel-FreeTier", 0, canon, "37025")), { status: 429 });
  const [rpm, rpd, ttft] = LIM[canon];
  const list = (accepted[canon] = accepted[canon] || []);
  const dayStart = Math.floor((now + 8 * 3600e3) / 864e5) * 864e5 - 8 * 3600e3;            // midnight Pacific (UTC-8)
  if (list.filter((t) => t >= dayStart).length >= rpd) { stats.fail429++; return new Response(JSON.stringify(qerr("GenerateRequestsPerDayPerProjectPerModel-FreeTier", rpd, canon, "20")), { status: 429 }); }
  const win = list.filter((t) => t > now - 60000);
  if (win.length >= rpm) { stats.fail429++; return new Response(JSON.stringify(qerr("GenerateRequestsPerMinutePerProjectPerModel-FreeTier", rpm, canon, String(Math.ceil((win[0] + 60000 - now) / 1000)))), { status: 429 }); }
  if (SHED && /flash$/.test(canon) && ++shedN % 3 === 0) { await new Promise((r) => setTimeout(r, 2500)); stats.fail503++; return new Response(JSON.stringify({ error: { code: 503, message: "The model is overloaded. Please try again later.", status: "UNAVAILABLE" } }), { status: 503 }); }
  list.push(now); stats.ok++;
  const __id = tl.length;
  let ttftUse = ttft;
  if (STALL && /flash$/.test(canon) && rnd() < P_STALL) { ttftUse = 100000; stats.stalled = (stats.stalled || 0) + 1; }      // accepted, but it sits in Google's queue for ~100 s
  /\blite\b/.test(canon) ? stats.lite++ : stats.strong++;
  if (TRACE_NO && curNo === TRACE_NO) { const row = { t: Math.round((now - curStart) / 1000), model: canon, stall: ttftUse > 50000, end: null }; tl.push(row); if (signal) signal.addEventListener("abort", () => { row.end = "ABORTED at +" + Math.round((Date.now() - curStart) / 1000) + "s"; }); }
  return new Response(stream(ttftUse, signal), { status: 200 });
};

const lib = (f) => import(pathToFileURL(`${ROOT}/src/lib/${f}`).href);
const G = await lib("gemini.js"), A = await lib("analysis.js");
let LAT = null; try { LAT = await lib("latency.js"); } catch (e) { /* old tree has none */ }
const KEY = "AIzaSIMULATED0001";
window.localStorage.clear();
await G.refreshModels(KEY, { force: true });
const lists = G.getModelLists(KEY);

async function drive(promise, maxMs) {
  let done = false; promise.then(() => { done = true; }, () => { done = true; });
  let t = 0;
  while (!done && t < maxMs) { for (let i = 0; i < 12; i++) await Promise.resolve(); await new Promise((r) => setImmediate(r)); mock.timers.tick(100); t += 100; }
  return t;
}

const N = parseInt(process.env.N || "8", 10), GAP = 150000;       // eight questions, one every 2.5 minutes
const rows = [];
let clock = T0;
for (let i = 1; i <= N; i++) {
  const start = Date.now(); curNo = i; curStart = start; globalThis.__DBG = (i === TRACE_NO);
  const before = { ...stats };
  let outcome = "ok", err = "";
  const p = new Promise((resolve) => {
    const done = {};
    const a = A.createAnalysis({
      kind: "question", history: [], dataUrl: "data:image/png;base64,iVBORw0KGgo=", doc: null, extra: "", chips: [], apiKey: KEY, modeId: "balanced",
      onUpdate() {}, onDone: (name, m) => { done[name] = true; if (m && m.lat && LAT) { (globalThis.__lat ||= {})[name] = LAT.describe(m.lat); } if (done.ocr && done.words && done.reason) resolve(); },
      onError: (name, e) => { outcome = "ERROR"; err = (e && e.message || "").slice(0, 60); resolve(); }, onNotice() {},
    });
    a.start();
  });
  await drive(p, 20 * 60000);
  const secs = Math.round((Date.now() - start) / 1000);
  if (secs > 100 && globalThis.__lat) console.log(`   #${i} was slow (${secs} s). per stage:`, JSON.stringify(globalThis.__lat));
  globalThis.__lat = {};
  rows.push({ n: i, secs, outcome, err, failed: (stats.fail429 - before.fail429) + (stats.fail503 - before.fail503), strong: stats.strong - before.strong, lite: stats.lite - before.lite });
  const wait = Math.max(0, start + GAP - Date.now());
  mock.timers.tick(wait);
}
if (TRACE_NO) { console.log(`timeline of analysis #${TRACE_NO}:`); for (const r of tl) console.log(`  +${String(r.t).padStart(3)}s  ${r.model.padEnd(24)} ${r.stall ? "STALLS 100s" : "normal     "}  ${r.end || "(ran to the end)"}`); }
if (process.env.LEDGER_DUMP) console.log("LEDGER:", window.localStorage.getItem("clinix:quota:v1"));
const tot = rows.reduce((s, r) => s + r.secs, 0);
if (QUIET) { console.log(`seed ${SEED}: avg ${Math.round(tot / N)} s   max ${Math.max(...rows.map((r) => r.secs))} s   total ${tot} s   failed ${stats.fail429 + stats.fail503}   lite ${stats.lite}   strong ${stats.strong}   stalled ${stats.stalled || 0}`); process.exit(0); }
console.log(`\nengine: ${ROOT.split("/").slice(-1)[0]}   scenario: free key${SHED ? " + 503 shedding on Flash" : STALL ? " + a Flash request in 3 sits ~100 s in Google's queue" : ""}   (8 questions, one every 2.5 min; virtual time)`);
console.log("  #   seconds   failed-attempts   strong-model-requests   lite-requests   result");
for (const r of rows) console.log(`  ${String(r.n).padStart(1)}   ${String(r.secs).padStart(7)}   ${String(r.failed).padStart(15)}   ${String(r.strong).padStart(21)}   ${String(r.lite).padStart(13)}   ${r.outcome}${r.err ? " · " + r.err : ""}`);
console.log(`  TOTAL waiting: ${tot} s   avg: ${Math.round(tot / N)} s   max: ${Math.max(...rows.map((r) => r.secs))} s   errors: ${rows.filter((r) => r.outcome !== "ok").length}   failed attempts: ${stats.fail429 + stats.fail503}   requests on the strong model: ${stats.strong}   on Lite: ${stats.lite}`);
process.exit(0);
