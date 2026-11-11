/* ───────────── Gemini networking ─────────────
   v3.26 — LANES (read this before everything else; the details are in router.js and providers.js)
   • The retry engine no longer WAITS for a busy model. Every model (and every extra free engine: Groq · OpenRouter · Mistral) is a "lane"
     with its own quota. A lane that answers 429 / 503 / hangs is put to sleep for a while and the request moves to the next lane at once.
   • Equal-quality lanes are load-balanced, so the parallel requests of one analysis land on different models (different per-minute quotas).
   • HEDGING across lanes: a lane that has sent nothing at all after a few seconds is raced by another lane (another quota bucket);
     the first sign of life wins and the other request is cancelled. It never doubles traffic on one model (the v3.23 problem).
   • We never rotate Google projects/keys to dodge limits: Google restricts projects that do that, and its limits are per project anyway.
   v3.23 — 429 / 503 FIX (read this first)
   • NO MORE HEDGING: the old engine started a SECOND request to another model whenever the first was slow. Google counts every
     request, so a busy moment doubled the traffic and kept the key rate-limited. Now there is exactly ONE request at a time.
   • withBackoff(): a transient failure (429 per-minute · 500/502/503/504 · timeout · dropped line · empty reply) is retried at most
     3 times, after 2 s, 4 s, 8 s (+ a random jitter so parallel tasks never retry in the same millisecond). A "retry in Ns" hint
     from Google is honoured (up to 20 s); a longer one stops at once. After that the student gets a calm "try again in a minute"
     message instead of an endless loop. Dead models (404 / retired / daily quota) are skipped WITHOUT waiting.
   • The API key travels in the `x-goog-api-key` header (the documented way) instead of the URL, so it never lands in logs.
   • The model is configurable: VITE_GEMINI_MODEL (default gemini-2.5-flash) and VITE_GEMINI_MODEL_PRO — see config.js.

   Older goals (still true): first text on screen in ~1–2 s, never block on housekeeping calls, never wait for a slow
   model when another one can answer.

   • STREAMING (SSE) through the WebView fetch → text is shown while it is still being written.
   • NO blocking "list models" round trip before analysing (cached list + safe defaults; refreshed in background).
   • (v3.23: the old "hedged" parallel fallback was REMOVED — it doubled the request count during busy moments.)
   • Thinking level is remembered per model (no repeated 400 round trips).
   • "Sign of life" = any streamed part, INCLUDING Gemini's thought summaries (includeThoughts). A model that is
     busy thinking is therefore never mistaken for a stalled one (no wasted duplicate requests), and a model that
     dies while thinking is replaced by the next one before the user has seen anything.
   • systemInstruction carries the static prompt → Gemini's implicit cache can reuse it between runs.
   • Models that are unavailable for the key (404 / quota 0) are remembered for 6 h, even across app restarts.
   • v3.13 — RETIRED models: Google keeps listing gemini-2.5-* in ListModels but answers 404 "no longer available to
     new users" for keys that never used them. Such a model is now (1) dropped from the candidate lists, (2) remembered
     as retired for 7 days, (3) replaced at once by the model Google names in the error message, and (4) triggers a
     background refresh of the model list. When EVERY model fails, the error shown is the most informative one
     (rate limit / server / timeout beat "model unavailable"), plus a one-line list of what each model answered.
   • If WebView fetch cannot reach Google (CORS / network), it falls back to the native Capacitor HTTP client
     (non-streaming) automatically.                                                                       */

import { mergeGrounding } from "./sources.js";
import * as Ring from "./keyring.js";
import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { MODEL_FAST, MODEL_PRO, GATEWAY_URL, GATEWAY_TOKEN, API_BASE_URL, NET, PAID, cap, SERVICE_TIER } from "./config.js";
import { tierOf, taskClass, mediaOf, estimateTokens, tierStages, planLanes, hedgeDelayMs, nextReadyIn, readyLanes, begin as laneBegin, noteOk, noteBusy, noteDead, noteTooBig, noteSlow, clearDead as clearDeadLanes, clearCool as clearCoolLanes, coolFor, setBias, isDead, isCooling } from "./router.js";
import { makeGuard, REWRITE_AT, allowRetry } from "./guard.js";
import {
  PROVIDERS, getExtKeys, getExtLanes, refreshLanes, markExtDead, getEngineMode, answerBudget, buildBody,
  streamChat, nativeChat, bearer, headersFor, liveExtKeys, extKeyList, keysChanged as extKeysChanged,
} from "./providers.js";

const ENV = (typeof import.meta !== "undefined" && import.meta.env) || {};
import { trackRequest, noteQuota, nextResetMs } from "./usage.js";
import { FIRST_FLOOR_MS } from "./router.js";
import { parseQuota, parseDuration, noteSend, refundSend, noteQuotaError, sameAs, paceMs, budgetBias, finishedToday, deadLeftMs, finishedMessage, noteTtft, typicalTtft } from "./quota.js";
/* v3.32: behind a gateway (config.js) the "key" the app holds is the gateway's ACCESS CODE; the real (paid) Google key never leaves the server */
export const ENV_KEY = GATEWAY_URL && GATEWAY_TOKEN ? GATEWAY_TOKEN : (ENV.VITE_GEMINI_API_KEY || "");
export const API_BASE = API_BASE_URL;

/* v3.32 · behind a gateway every install sends a random id (never anything about the student): the gateway's daily limit is per device, so one heavy user cannot lock the others out.
   Only sent to the gateway: Google's own servers would refuse an unknown header in a browser pre-flight. */
function deviceId() {
  try {
    let d = window.localStorage.getItem("clinix:device");
    if (!d) {
      const raw = (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
      d = raw.replace(/[^A-Za-z0-9_\-]/g, "").slice(0, 48);
      window.localStorage.setItem("clinix:device", d);
    }
    return d;
  } catch (e) { return "no-storage-id"; }
}
/* the key goes in a header, never in the URL */
const hdrs = (apiKey) => ({ "Content-Type": "application/json", ...(apiKey ? { "x-goog-api-key": apiKey } : {}), ...(GATEWAY_URL ? { "x-clinix-device": deviceId() } : {}) });

/* ── errors ── */

const RETIRED_RE = /no longer available|not available to new users|has been (?:shut ?down|retired|deprecated)|is deprecated/;

export function friendlyError(status, message) {
  const m = (message || "").toLowerCase();
  /* behind the gateway the student has no key to fix: say what is really going on */
  if (GATEWAY_URL && (status === 401 || status === 403)) return "التطبيق مش قادر يدخل على خدمة الـ AI (رمز الدخول مش مقبول). حدّث التطبيق لآخر نسخة أو كلّم المسؤول عنه.";
  if (GATEWAY_URL && status === 429 && /daily limit/.test(m)) return "وصلت للحد اليومي للاستخدام على الجهاز ده. جرّب تاني بكرة.";
  if (/api key|api_key/.test(m) || status === 401 || status === 403)
    return "مفتاح الـ API مش مقبول أو مالوش صلاحية. اتأكد من المفتاح من أيقونة 🔑 فوق.";
  if (status === 429 && /per\s?day|daily|perday/.test(m)) return "خلصت حصة الطلبات اليومية بتاعة مفتاحك. بتتجدد منتصف الليل بتوقيت المحيط الهادي، أو استخدم مفتاح تاني.";
  if (status === 429) return "السيرفر عليه ضغط عالي دلوقتي 🙏 استنى دقيقة وجرّب تاني.";
  if (status === 404 && RETIRED_RE.test(m)) return "الموديل ده اتقفل على المفاتيح الجديدة. التطبيق بيحوّل لموديل أحدث لوحده، جرّب تاني.";
  if (status === 400 && /pdf|document/.test(m)) return "ملف الـ PDF مش مقروء أو مش مدعوم. جرّب ملف تاني أو صوّر الصفحة.";
  if (status === 400 && m.includes("image")) return "الصورة مش واضحة أو مش مدعومة. جرّب صورة تانية.";
  if (status >= 500) return "سيرفرات Google مشغولة دلوقتي 🙏 استنى دقيقة وجرّب تاني.";
  return "حصلت مشكلة أثناء التحليل.";
}

function apiError(status, bodyText) {
  let message = "", retryMs = 0, errObj = null;
  try {
    const j = JSON.parse(bodyText);
    errObj = j && j.error && typeof j.error === "object" ? j.error : null;
    message = (errObj && errObj.message) || "";
    const ri = ((errObj && errObj.details) || []).find((d) => d && d.retryDelay);
    if (ri) retryMs = parseDuration(ri.retryDelay);
  } catch (e) { message = String(bodyText || "").slice(0, 200); }
  const err = classify(status, message, errObj);
  if (!err.retryAfterMs && retryMs && !(err.quota && err.quota.kind === "day")) err.retryAfterMs = Math.min(retryMs, 60000);
  return err;
}

function classify(status, message, errObj) {
  const m = (message || "").toLowerCase();
  const err = new Error(friendlyError(status, message));
  err.status = status;
  err.detail = `HTTP ${status} · ${message || ""}`.slice(0, 400);
  err.thinking = status === 400 && /thinking|thought/.test(m);
  err.fatal = !err.thinking && (
    status === 401 ||
    /api key not valid|api_key_invalid|api key expired|invalid api key|api key not found|api key is missing/.test(m) ||
    (status === 403 && /api key|api_key|referer|ip address|has not been used|is disabled/.test(m))
  );
  if (status === 429) noteQuota(message);
  /* v3.33 · WHICH quota was hit is in details[].violations[].quotaId, not in the message: for a finished DAILY quota Google's text says neither "per day" nor
     anything true about the wait ("Please retry in 20s"). Read the structured error first; the message regex stays as the fallback for answers without details. */
  const q = status === 429 ? parseQuota(errObj, message) : null;
  if (q) err.quota = q;
  err.daily = status === 429 && (q.kind === "day" || /per\s?day|daily|perday/.test(m));
  const ra = m.match(/retry in ([\d.]+)\s*s/);
  if (ra && !(q && q.kind === "day")) err.retryAfterMs = Math.min(Math.round(parseFloat(ra[1]) * 1000), 60000);
  /* a model whose DAILY quota is gone (or whose free quota is 0) cannot answer for hours; the other models have their own quota */
  err.dead = status === 404 || (status === 429 && (q.kind === "none" || /limit:\s*0/.test(m) || err.daily)) || (status === 403 && !err.fatal);
  /* "This model models/gemini-2.5-pro is no longer available to new users. Please update your code to use models/gemini-3.1-pro-preview …" */
  err.retired = status === 404 && RETIRED_RE.test(m);
  const rep = err.retired && String(message || "").match(/(?:use|using|switch to|migrate to)\s+(?:the\s+)?(?:models\/)?(gemini-[a-z0-9.\-]+)/i);
  if (rep) err.replacement = rep[1].toLowerCase().replace(/[.,;:\-]+$/, "");
  return err;
}

const abortError = () => Object.assign(new Error("aborted"), { name: "AbortError" });
const timeoutError = (what) =>
  Object.assign(new Error("الطلب أخد وقت أطول من اللازم واتقطع. جرّب تاني أو اختار وضع أسرع."), { detail: `timeout (${what})`, timeout: true });

/* ── plain (non-stream) requests: model list, connection test ── */

function normalizeResponse(status, data) {
  let json = data;
  if (typeof data === "string") { try { json = JSON.parse(data); } catch (e) { json = {}; } }
  return { status, json: json && typeof json === "object" ? json : {} };
}

/* generic: any headers (Gemini: x-goog-api-key · extra engines: Authorization: Bearer …) */
export async function rawRequestH(method, url, body, timeoutMs, headers) {
  const errors = [];
  if (Capacitor.isNativePlatform()) {
    try {
      const opts = { url, method, headers, connectTimeout: 30000, readTimeout: timeoutMs };
      if (body !== undefined) opts.data = body;
      const r = await CapacitorHttp.request(opts);
      return normalizeResponse(r.status, r.data);
    } catch (e) { errors.push("native: " + String((e && e.message) || e)); }
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const init = { method, headers, signal: ctrl.signal };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await fetch(url, init);
    const text = await res.text();
    clearTimeout(timer);
    return normalizeResponse(res.status, text);
  } catch (e) {
    errors.push("webview: " + (e && e.name === "AbortError" ? "timeout" : String((e && e.message) || e)));
  }
  throw Object.assign(new Error("مفيش اتصال بسيرفرات Google. اتأكد من النت وجرّب تاني."), { detail: errors.join(" | ") });
}

export const rawRequest = (method, url, body, timeoutMs, apiKey) => rawRequestH(method, url, body, timeoutMs, hdrs(apiKey));

/* ── model lists (cached, never blocking) ── */

/* Only "-latest" aliases + the current generation: Google moves the aliases forward by itself, so these keep working
   when a specific model is retired. gemini-2.5-* is NOT here on purpose (404 for every key that never used it). */
const DEFAULT_LISTS = {
  fast: [MODEL_FAST, "gemini-flash-latest", "gemini-flash-lite-latest"],
  pro: [MODEL_PRO, "gemini-pro-latest", "gemini-3.1-pro-preview"],
};
const LS_MODELS = "clinix:models:v5";
const keyTag = (k) => (k || "").slice(-8);
let _lists = null;

/* models that are unavailable for this key (404 / quota 0): remembered across restarts for a few hours,
   so the first analysis of a new session does not waste a round trip on a model that cannot answer.
   RETIRED models ("no longer available to new users") are remembered for a week and survive list refreshes. */
const LS_DEAD = "clinix:dead:v2";
const DEAD_TTL = 6 * 3600e3;
const RETIRED_TTL = 7 * 864e5;
let _deadMem = null;
function deadState(apiKey) {
  const k = keyTag(apiKey);
  if (_deadMem && _deadMem.k === k) return _deadMem;
  let st = { k, map: {}, ret: {} };
  try { const raw = JSON.parse(window.localStorage.getItem(LS_DEAD)); if (raw && raw.k === k) st = { k, map: raw.map || {}, ret: raw.ret || {} }; } catch (e) { /* ignore */ }
  _deadMem = st;
  return st;
}
const saveDead = (st) => { try { window.localStorage.setItem(LS_DEAD, JSON.stringify(st)); } catch (e) { /* ignore */ } };
const deadSet = (apiKey) => {
  const st = deadState(apiKey), now = Date.now();
  return new Set([...Object.keys(st.map).filter((m) => st.map[m] > now), ...Object.keys(st.ret).filter((m) => st.ret[m] > now)]);
};
const addDead = (apiKey, model, retired, ttlMs) => {
  const st = deadState(apiKey);
  if (retired) st.ret[model] = Date.now() + RETIRED_TTL; else st.map[model] = Date.now() + (ttlMs > 0 ? ttlMs : DEAD_TTL);
  saveDead(st);
};
const clearDead = (apiKey) => {            // a fresh model list gives temporary failures a new chance; retired models stay retired
  const st = deadState(apiKey);
  st.map = {};
  saveDead(st);
  clearDeadLanes("gemini:");
};

/* the replacement Google names inside a "no longer available" error is trusted for the next analysis too */
const LS_SUGGEST = "clinix:suggest:v1";
const readSuggest = (apiKey) => {
  try { const r = JSON.parse(window.localStorage.getItem(LS_SUGGEST)); if (r && r.k === keyTag(apiKey) && Date.now() - r.t < 30 * 864e5) return r.models || []; } catch (e) { /* ignore */ }
  return [];
};
const addSuggest = (apiKey, model) => {
  if (!/^gemini-[a-z0-9.\-]+$/.test(model || "")) return;
  const cur = readSuggest(apiKey);
  if (cur.includes(model)) return;
  try { window.localStorage.setItem(LS_SUGGEST, JSON.stringify({ k: keyTag(apiKey), t: Date.now(), models: [model, ...cur].slice(0, 4) })); } catch (e) { /* ignore */ }
  _lists = null;                              // lists are rebuilt with the suggestion on the next read
};

/* a retired model → refresh the model list from Google in the background (at most once every 10 minutes) */
let _selfHealAt = 0;
function selfHeal(apiKey) {
  if (!apiKey || Date.now() - _selfHealAt < 10 * 60e3) return;
  _selfHealAt = Date.now();
  refreshModels(apiKey, { force: true }).catch(() => {});
}

const modelRank = (n) => {
  const tier = /pro/.test(n) ? 2 : /lite/.test(n) ? 0 : 1;
  const v = (n.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1];
  const base = /latest$/.test(n) ? 500 : (v ? parseFloat(v) * 10 : 0);
  return tier * 1000 + base - (/preview|exp/.test(n) ? 1 : 0);
};

const withSuggestions = (apiKey, lists) => {
  const dead = deadSet(apiKey);
  const extra = readSuggest(apiKey).filter((m) => !dead.has(m));
  const ok = (arr) => arr.filter((m) => !deadState(apiKey).ret[m] || deadState(apiKey).ret[m] <= Date.now());
  /* the model YOU configured is always tried first (unless Google says it is retired / unavailable for this key) */
  const pro = [MODEL_PRO, ...extra.filter((m) => /pro/.test(m)), ...lists.pro];
  const fast = [MODEL_FAST, ...extra.filter((m) => !/pro/.test(m)), ...lists.fast];
  const live = (arr) => [...new Set(ok(arr))].filter((m) => !dead.has(m));
  const f = live(fast), p = live(pro);
  return { fast: f.length ? f : [...new Set(ok(fast))], pro: p.length ? p : [...new Set(ok(pro))] };
};

export function getModelLists(apiKey) {
  if (_lists && _lists.k === keyTag(apiKey) && _lists.out) return _lists.out;
  let base = DEFAULT_LISTS;
  try {
    const raw = JSON.parse(window.localStorage.getItem(LS_MODELS));
    if (raw && raw.k === keyTag(apiKey) && Date.now() - raw.t < 3 * 864e5) base = raw.lists;
  } catch (e) { /* ignore */ }
  const out = withSuggestions(apiKey, base);
  _lists = { k: keyTag(apiKey), lists: base, out };
  return out;
}

/* generation number of a model id: gemini-3.1-pro-preview → 3.1 ; "-latest" aliases have none → treated as newest */
const genOf = (n) => { const v = (n.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1]; return v ? parseFloat(v) : 99; };

export async function refreshModels(apiKey, { force = false } = {}) {
  if (!apiKey) return DEFAULT_LISTS;
  if (!force) {
    try {
      const raw = JSON.parse(window.localStorage.getItem(LS_MODELS));
      if (raw && raw.k === keyTag(apiKey) && Date.now() - raw.t < 864e5) { _lists = null; return getModelLists(apiKey); }
    } catch (e) { /* ignore */ }
  }
  const { status, json } = await rawRequest("GET", `${API_BASE}?pageSize=200`, undefined, 30000, apiKey);
  if (status !== 200) throw classify(status, json?.error?.message || "");
  const all = (json.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent") && /^models\/gemini-/.test(m.name)
      && !/image|tts|audio|live|embed|robotics|computer|learnlm|gemma|aqa|vision|deep-research|customtools|transcri|speech/i.test(m.name))
    .map((m) => m.name.replace("models/", ""));
  /* ListModels still lists gemini-2.5-* although new keys get 404 on them → keep the 3.x generation (and the -latest aliases)
     whenever it exists; the old generation is used only if nothing newer is listed at all */
  const modern = all.filter((n) => genOf(n) >= 3);
  const found = (modern.length ? modern : all).sort((x, y) => modelRank(y) - modelRank(x));
  const pro = found.filter((n) => /pro/.test(n)).slice(0, 3);
  const flash = found.filter((n) => !/pro/.test(n) && !/lite/.test(n)).slice(0, 4);   // capacity is per model: more distinct models = more chances
  const lite = found.filter((n) => /lite/.test(n)).slice(0, 2);
  const fast = [...flash, ...lite];
  const lists = {
    fast: fast.length ? fast : (pro.length ? pro : DEFAULT_LISTS.fast),
    pro: pro.length ? pro : (flash.length ? flash : DEFAULT_LISTS.pro),
  };
  try { window.localStorage.setItem(LS_MODELS, JSON.stringify({ k: keyTag(apiKey), t: Date.now(), lists })); } catch (e) { /* ignore */ }
  clearDead(apiKey);
  _lists = null;
  return getModelLists(apiKey);
}

/* ── v3.34 · the key ring, as the 🔑 window uses it ── */

export const providerLabel = (p) => (p === "gemini" ? "Google Gemini" : (PROVIDERS[p] && PROVIDERS[p].label) || p);

/* the key the REST of the app (images, speech, translation, the model list) uses: the first Gemini key of the ring.
   `legacy` = the single key v3.33 saved in the app's store (it becomes the first entry of the ring, once). */
export function currentApiKey(legacy = "") {
  if (GATEWAY_URL) return ENV_KEY;
  Ring.seedLegacyGemini(legacy);
  const g = Ring.keysOf("gemini");
  return g.find(Ring.isLive) || g[0] || ENV_KEY || (Ring.hasAnyKey() ? Ring.NO_GEMINI : "");
}

/* a key was added / removed: lanes and models that were set aside because of the OLD keys get a fresh start */
export function onKeysChanged(provider) {
  if (!provider || provider === "gemini") { clearDeadLanes("gemini:"); clearCoolLanes("gemini:"); }
  if (!provider || provider !== "gemini") extKeysChanged(provider || "");
}

/* paste ANY key: the app works out whose it is, checks it with that company (a model-list call: it costs no quota) and adds it to the ring.
   → { ok, provider?, label?, msg } */
export async function addApiKey(raw) {
  const key = String(raw || "").trim();
  if (key.length < 16 || /\s/.test(key)) return { ok: false, msg: "المفتاح شكله مش مظبوط. انسخه كله من غير مسافات." };
  if (Ring.listKeys().some((e) => e.key === key)) return { ok: false, msg: "المفتاح ده مضاف قبل كده." };
  const probe = async (p) => {
    try {
      const url = p === "gemini" ? `${API_BASE}?pageSize=1` : `${PROVIDERS[p].base}/models${p === "anthropic" ? "?limit=1" : ""}`;
      return (await rawRequestH("GET", url, undefined, 20000, p === "gemini" ? hdrs(key) : headersFor(p, key))).status;
    } catch (e) { return 0; }           // no connection: not a verdict on the key
  };
  let provider = Ring.detectProvider(key), note = "";
  if (provider === "unknown") {
    /* the prefix told us nothing (a new key format, or a provider with no prefix): ask each company in turn. The first one that accepts the key owns it,
       so a future key shape never again needs an app update. */
    let sawNet = false;
    for (const p of ["gemini", "mistral", "openai", "groq", "openrouter", "anthropic"]) {
      const st = await probe(p);
      if (st === 200) { provider = p; break; }
      if (st === 0) sawNet = true;
    }
    if (provider === "unknown") return { ok: false, msg: sawNet
      ? "مقدرتش أتأكد من المفتاح ده لأن النت واقف أو المتصفح بيمنع الطلب. جرّب تاني."
      : "المفتاح ده مش مقبول من أي شركة مدعومة (Google · Claude · ChatGPT · Groq · OpenRouter · Mistral). اتأكد إنك نسخته كامل." };
  } else {
    const st = await probe(provider);
    if ([400, 401, 403].includes(st)) return { ok: false, msg: `مفتاح ${providerLabel(provider)} ده مش مقبول (غلط أو متوقف). اتأكد منه.` };
    if (st !== 200) note = " (مقدرتش أتأكد منه دلوقتي بسبب النت أو الضغط، هيتجرّب أول ما يتستخدم)";
  }
  const r = Ring.addKey(key, provider);
  if (!r.ok) return { ok: false, msg: "المفتاح ده مضاف قبل كده." };
  onKeysChanged(provider);
  if (provider === "gemini") { if (Ring.keysOf("gemini").length === 1) refreshModels(key, { force: true }).catch(() => {}); }
  else refreshLanes(provider, rawRequestH, { force: true }).catch(() => {});
  return { ok: true, provider, label: providerLabel(provider), msg: `اتضاف مفتاح ${providerLabel(provider)} ✅${note}` };
}

export async function testConnection(apiKey) {
  const { fast, pro } = await refreshModels(apiKey, { force: true });
  return `${pro[0]} + ${fast[0]}`;
}

/* the extra free engines: one line per configured provider (the model list call needs no quota) */
export async function testExtProviders() {
  const out = [];
  for (const id of Object.keys(getExtKeys())) {
    const label = PROVIDERS[id].label;
    try {
      const lanes = await refreshLanes(id, rawRequestH, { force: true });
      out.push(lanes.length
        ? { id, label, ok: true, msg: `${label} شغال ✅ ${lanes.map((l) => l.model.replace(/^.*\//, "")).join(" · ")}` }
        : { id, label, ok: false, msg: `${label}: المفتاح شغال بس مفيش موديل مناسب ظهر في القايمة.` });
    } catch (e) {
      const net = /Google/.test(e.message || "");
      out.push({ id, label, ok: false, msg: net ? `${label}: مفيش اتصال (النت أو المتصفح بيمنع الطلب).` : e.message, detail: e.detail });
    }
  }
  return out;
}

/* background: read the model lists of the extra engines (after a key was saved, and at start-up) */
export function warmExternal() {
  Object.keys(getExtKeys()).forEach((id) => refreshLanes(id, rawRequestH).catch(() => {}));
}

/* Fire-and-forget: refreshes the model list in the background. */
export function warmUp(apiKey) {
  warmExternal();
  if (!apiKey || apiKey === Ring.NO_GEMINI) return;
  refreshModels(apiKey).catch(() => {});
}

/* Opens the DNS + TLS + HTTP/2 connection to Google BEFORE the user presses "analyse", so the three
   parallel requests reuse one hot connection instead of each paying the handshake (≈ 0.3–0.8 s on mobile). */
let _warmAt = 0;
export function warmConnection(apiKey) {
  if (!apiKey || apiKey === Ring.NO_GEMINI || Date.now() - _warmAt < 45000) return;
  _warmAt = Date.now();
  try {
    fetch(`${API_BASE}?pageSize=1`, { method: "GET", cache: "no-store", headers: hdrs(apiKey) })
      .then((r) => r.arrayBuffer()).catch(() => {});
  } catch (e) { /* ignore */ }
}

/* ── thinking control ──
   Gemini 3.x uses thinkingLevel, 2.x uses thinkingBudget. The first rung that works is remembered. */

const is2x = (model) => /gemini-2\./.test(model);

function ladderFor(model, spec) {
  // Gemini 2.5 Pro cannot switch thinking off (minimum 128): asking for 0 would waste a 400 round trip
  const bud = { thinkingBudget: is2x(model) && /pro/.test(model) ? Math.max(128, spec.budget) : spec.budget };
  if (is2x(model)) return [bud, null];
  return [...spec.levels.map((l) => ({ thinkingLevel: l })), bud, null];
}

const memoKey = (model, task) => `clinix:tl:${model}|${task}`;
const readMemo = (model, task) => { try { return parseInt(window.localStorage.getItem(memoKey(model, task)) || "0", 10) || 0; } catch (e) { return 0; } };
const writeMemo = (model, task, i) => { try { window.localStorage.setItem(memoKey(model, task), String(i)); } catch (e) { /* ignore */ } };

const tempFor = (task) => (/^solve/.test(task) ? 0.2 : /^lesson/.test(task) ? 0.4 : 0.1);

function genConfig(model, think, maxOut, task) {
  const g = { maxOutputTokens: maxOut };
  if (is2x(model)) g.temperature = tempFor(task); // Gemini 3: keep Google's default temperature
  if (think) {
    const t = { ...think };
    // thought summaries stream while the model thinks → proof of life (never shown to the student)
    if (t.thinkingBudget !== 0 && t.thinkingLevel !== "minimal") t.includeThoughts = true;
    g.thinkingConfig = t;
  }
  return g;
}

/* ── one streaming request (SSE over fetch) ── */

function readParts(json) {
  const cand = json?.candidates?.[0];
  const parts = cand?.content?.parts || [];
  const text = parts.filter((p) => !p.thought && typeof p.text === "string").map((p) => p.text).join("");
  const alive = parts.some((p) => typeof p.text === "string"); // visible text OR a thought summary
  return { text, alive, finish: cand?.finishReason || null, block: json?.promptFeedback?.blockReason || null, grounding: cand?.groundingMetadata || null };
}

async function fetchStream({ apiKey, model, body, signal, onText, onAlive, firstMs, idleMs = 45000, strictFirst = false }) {
  if (signal.aborted) throw abortError();
  const url = `${API_BASE}/${model}:streamGenerateContent?alt=sse`;
  const ctrl = new AbortController();
  const link = () => ctrl.abort();
  signal.addEventListener("abort", link);
  let timer = null, why = null;
  const arm = (ms, w) => { clearTimeout(timer); timer = setTimeout(() => { why = w; ctrl.abort(); }, ms); };
  arm(firstMs, "first-byte");
  /* v3.33: with a MEASURED first-answer time (strictFirst) the short allowance does not end when the response headers arrive: Google may send them before the first word,
     and a request that is then stuck must be given up on after the same short time, not after the (much longer) mid-stream idle time. It ends at the first sign of life. */
  const t0 = Date.now();
  let seenAlive = false;
  const waitFor = () => (strictFirst && !seenAlive ? ["first-byte", Math.max(500, firstMs - (Date.now() - t0))] : ["idle", idleMs]);

  let full = "", finish = null, block = null, grounding = null, usage = null, tier = "", gwMs = 0;
  const handle = (line) => {
    if (!line.startsWith("data:")) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") return;
    let json;
    try { json = JSON.parse(payload); } catch (e) { return; }
    if (json.error) throw classify(json.error.code || 500, json.error.message || "", json.error);
    if (json.usageMetadata) usage = json.usageMetadata;          // token counts incl. the hidden thinking (latency.js)
    const r = readParts(json);
    if (r.alive) seenAlive = true;
    if (r.alive && onAlive) onAlive();
    if (r.finish) finish = r.finish;
    if (r.block) block = r.block;
    if (r.grounding) grounding = mergeGrounding(grounding, r.grounding);   // the pages Google Search used (sent in pieces, mostly at the end)
    if (r.text) { full += r.text; onText(full); }
  };

  try {
    let res;
    try {
      res = await fetch(url, { method: "POST", headers: hdrs(apiKey), body: JSON.stringify(body), signal: ctrl.signal });
    } catch (e) {
      if (signal.aborted) throw abortError();
      if (why) throw timeoutError(why);
      throw Object.assign(new Error("مفيش اتصال بسيرفرات Google. اتأكد من النت وجرّب تاني."), { detail: "fetch: " + String((e && e.message) || e), netBeforeStart: true });
    }
    if (!res.ok) throw apiError(res.status, await res.text());
    if (res.headers && typeof res.headers.get === "function") { tier = res.headers.get("x-gemini-service-tier") || ""; gwMs = parseInt(res.headers.get("x-gw-upstream-ms") || "0", 10) || 0; }
    { const [w, ms] = waitFor(); arm(ms, w); }

    const reader = res.body && typeof res.body.getReader === "function" ? res.body.getReader() : null;
    if (!reader) {
      (await res.text()).split("\n").forEach((l) => handle(l.replace(/\r$/, "")));
    } else {
      const dec = new TextDecoder("utf-8");
      let buf = "";
      for (;;) {
        let chunk;
        try { chunk = await reader.read(); }
        catch (e) {
          if (signal.aborted) throw abortError();
          if (why) throw timeoutError(why);
          throw Object.assign(new Error("النت قطع في نص التحميل. دوس إعادة المحاولة."), { detail: "stream: " + String((e && e.message) || e), interrupted: true });
        }
        if (chunk.done) break;
        buf += dec.decode(chunk.value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).replace(/\r$/, "");
          buf = buf.slice(nl + 1);
          handle(line);
        }
        { const [w, ms] = waitFor(); arm(ms, w); }              // any data resets the silence timer (the short first-answer allowance only until the first sign of life)
      }
      buf += dec.decode();
      if (buf.trim()) handle(buf.replace(/\r$/, ""));
    }
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", link);
  }
  return { text: full, finish, block, grounding, usage, tier, gwMs };
}

/* Native (non-streaming) fallback — used only if WebView fetch cannot reach Google. */
async function nativeOnce({ apiKey, model, body, signal, onText, onAlive }) {
  const url = `${API_BASE}/${model}:generateContent`;
  let r;
  try {
    r = await CapacitorHttp.request({ url, method: "POST", headers: hdrs(apiKey), data: body, connectTimeout: 30000, readTimeout: 300000 });
  } catch (e) {
    if (signal.aborted) throw abortError();
    const msg = String((e && e.message) || e);
    if (/timeout|timed out/i.test(msg)) throw timeoutError("native");
    throw Object.assign(new Error("مفيش اتصال بسيرفرات Google. اتأكد من النت وجرّب تاني."), { detail: "native: " + msg });
  }
  if (signal.aborted) throw abortError();
  const { status, json } = normalizeResponse(r.status, r.data);
  if (status !== 200) throw classify(status, json?.error?.message || "");
  const out = readParts(json);
  if (out.alive && onAlive) onAlive();
  if (out.text) onText(out.text);
  return { ...out, usage: json.usageMetadata || null, tier: (r.headers && (r.headers["x-gemini-service-tier"] || r.headers["X-Gemini-Service-Tier"])) || "", gwMs: 0 };
}

let _noStreamUntil = 0;
async function streamOrNative(args) {
  if (Date.now() >= _noStreamUntil) {
    try { return await fetchStream(args); }
    catch (e) {
      if (!(e && e.netBeforeStart && Capacitor.isNativePlatform())) throw e;
      const out = await nativeOnce(args);          // WebView could not reach Google but native can
      _noStreamUntil = Date.now() + 10 * 60 * 1000; // stop retrying fetch for a while
      return out;
    }
  }
  return nativeOnce(args);
}

let _tierOff = false;       // Google refused the service_tier field once → never send it again in this session
/* v3.34 · Google Search grounding has quotas of its OWN (smaller than the model's), and a request that carries the search tool is the one Google turns away first.
   When the search tool is what Google refused, the model itself is still fine: leave search out for a few minutes instead of failing every model in turn. */
let _noSearchUntil = 0;
export const __resetSearchGate = () => { _noSearchUntil = 0; };
async function attemptModel({ apiKey, model, task, system, noSearchSystem, parts, spec, maxOut, signal, onText, onAlive, firstMs, idleMs, search }) {
  /* v3.32 · PAID profile: a silent request is cut early (config.js NET). A Pro model that thinks "high" legitimately stays quiet longer: it keeps up to 120 s. */
  const heavy = /pro/.test(model) || ((spec && spec.levels) || []).includes("high");
  if (PAID) { firstMs = heavy ? Math.min(firstMs, 120000) : cap(firstMs, "first"); idleMs = heavy ? Math.min(idleMs, 120000) : cap(idleMs, "idle"); }
  /* v3.33 · how long is "silent for too long"? Once this key's typical first-answer time for this model and kind of job is known (quota.js), 8 times that (never under
     FIRST_FLOOR_MS): a request that has plainly stalled in Google's queue is given up on and re-sent elsewhere, instead of being waited on for the 60-240 s written for a slow day. */
  let strictFirst = false;
  { const typical = typicalTtft(apiKey, model, taskClass(task)); if (typical > 0) { const adapted = Math.max(FIRST_FLOOR_MS.v, typical * 8); if (adapted < firstMs) { firstMs = adapted; strictFirst = true; } } }
  const rungs = ladderFor(model, spec);
  let idx = Math.min(readMemo(model, task), rungs.length - 1);
  let searching = !!search && Date.now() >= _noSearchUntil;       // Google Search grounding: the model looks the facts up before it answers (v3.34: unless Google just refused the tool)
  for (;;) {
    const body = { contents: [{ role: "user", parts }], generationConfig: genConfig(model, rungs[idx], maxOut, task) };
    /* a request that goes out WITHOUT the search tool must not tell the model to search: it would claim a search it never made */
    const sys = search && !searching && noSearchSystem ? noSearchSystem : system;
    if (sys) body.systemInstruction = { parts: [{ text: sys }] };
    if (searching) body.tools = [{ google_search: {} }];
    const tierOn = !!SERVICE_TIER && !_tierOff;               // Google "Priority inference" (Tier 2+): refused → switched off, the request repeats without it
    if (tierOn) body.service_tier = SERVICE_TIER;
    let sentAt = 0;
    try {
      trackRequest(model);                                       // every request counts against the daily quota
      sentAt = noteSend(apiKey, model);                          // v3.33: the quota ledger counts it too (per model · per minute · per day, quota.js)
      const out = await streamOrNative({ apiKey, model, body, signal, onText, onAlive, firstMs, idleMs, strictFirst });
      if (!out.text.trim()) {
        throw Object.assign(new Error(out.block ? "السؤال اتحجب من فلتر الأمان بتاع Google. جرّب صورة تانية." : "الذكاء الاصطناعي رجّع رد فاضي. جرّب تاني."),
          { detail: `${model} · ${out.finish || out.block || "empty"}`, emptyReply: true, blocked: !!out.block });
      }
      writeMemo(model, task, idx);
      return { ...out, searched: searching };
    } catch (e) {
      if (e.thinking && idx < rungs.length - 1) { idx += 1; continue; }
      /* this model refuses the search tool (a 400 that mentions it): answer WITHOUT it rather than not at all; the app then says "no sources" */
      if (searching && e && e.status === 400 && !e.thinking && /tool|search|ground|retriev/i.test(String(e.detail || e.message || ""))) { searching = false; continue; }
      /* v3.34 · THE ROOT CAUSE of "the server is busy" on a chat question: every tutor answer carries the Google Search tool, and a 429 that is about the search
         quota (or a model that is only slightly over its limit) was treated as "this model is busy": it was put to sleep, the next model got the same search request, the
         same 429, and after the last one the student saw "try again in a minute" - for a question that would have been answered in seconds without the search.
         Now the SAME model is asked again at once, without the tool (the answer then carries no sources, and the screen says so). A real per-model limit still fails the
         second request and goes the normal way. Not for a finished DAILY quota of the model itself or a model with no quota (nothing would change) nor the gateway's own limit. */
      if (searching && e && e.status === 429 && !e.thinking) {
        const groundish = /ground|search/i.test(`${e.detail || ""} ${((e.quota && e.quota.ids) || []).join(" ")}`);
        const hopeless = !groundish && (e.daily || (e.quota && e.quota.kind === "none") || /daily limit/i.test(String(e.detail || "")));
        if (!hopeless) {
          if (sentAt) refundSend(apiKey, model, sentAt);
          if (groundish) _noSearchUntil = Date.now() + 5 * 60e3;
          searching = false; continue;
        }
      }
      if (tierOn && e && [400, 403, 404].includes(e.status) && !e.thinking && /service.?tier|priority/i.test(String(e.detail || ""))) { _tierOff = true; continue; }
      if (e && !e.detail) e.detail = model;
      else if (e && e.detail && !e.detail.includes(model)) e.detail = `${model} · ${e.detail}`;
      /* v3.33 · a request Google turned away without doing the work (429 / 5xx / no connection) is not counted by Google, so it is not counted here;
         and a 429 teaches the ledger which quota it was: finished for today (until the reset) or just the per-minute wall (wait exactly what Google says) */
      if (e && (e.status === 429 || e.status >= 500 || e.netBeforeStart) && sentAt) refundSend(apiKey, model, sentAt);
      if (!GATEWAY_URL && e && e.status === 429 && e.quota) {        // behind the gateway the limits are the gateway's own (UTC day, per device), not Google's free-tier ones this ledger models
        const r = noteQuotaError(apiKey, model, e.quota);
        if (r.deadMs) { e.dead = true; e.daily = true; e.deadMs = r.deadMs; }
        else if (r.coolMs) e.retryAfterMs = r.coolMs;
      }
      throw e;
    }
  }
}

/* ── retry engine: ONE request at a time, smart exponential backoff with jitter ── */

export const BACKOFF = { retries: 3, baseMs: 2000, jitterMs: 1000, maxHintMs: 20000 };

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal && signal.aborted) return reject(abortError());
  const t = setTimeout(() => { signal && signal.removeEventListener("abort", onAbort); resolve(); }, ms);
  const onAbort = () => { clearTimeout(t); reject(abortError()); };
  signal && signal.addEventListener("abort", onAbort, { once: true });
});

/* The calm message shown after the last retry. Keeps the technical detail for the (i) tooltip. */
export function busyError(last) {
  const e = new Error("السيرفر عليه ضغط عالي دلوقتي 🙏 استنى دقيقة وجرّب تاني.");
  e.detail = (last && last.detail) || "";
  e.status = last && last.status;
  e.busy = true;
  return e;
}

/* Which failures are worth another try? "Google is busy / the line dropped" is; a bad key, a blocked question, a dead model
   (404 / daily quota) or a bad file is not: retrying cannot change the answer. */
export const isTransient = (e) => !!e && !e.fatal && !e.dead && !e.blocked && !e.thinking &&
  (e.timeout || e.interrupted || e.netBeforeStart || e.emptyReply || [408, 429, 500, 502, 503, 504, 529].includes(e.status));

/* withBackoff(fn): runs fn(); on a transient error waits 2 s → 4 s → 8 s (+ random jitter) and runs it again, at most 3 retries.
   Then it throws busyError (never loops forever). onRetry({ attempt, max, waitMs, status }) lets the UI say "trying again". */
export async function withBackoff(fn, { signal, onRetry, retries = BACKOFF.retries, baseMs = BACKOFF.baseMs, jitterMs = BACKOFF.jitterMs } = {}) {
  for (let attempt = 0; ; attempt++) {
    try { return await fn(attempt); }
    catch (e) {
      if (!e || e.name === "AbortError" || (signal && signal.aborted)) throw e;
      if (!isTransient(e)) throw e;
      /* a timeout means the model hung for minutes: one more try at most, not three */
      if (attempt >= retries || (e.timeout && attempt >= 1)) throw busyError(e);
      const hint = e.retryAfterMs || 0;
      if (hint > BACKOFF.maxHintMs) throw busyError(e);              // Google itself says "come back in 30 s+": do not burn quota
      const waitMs = Math.round(Math.max(baseMs * 2 ** attempt, hint) + Math.random() * jitterMs);   // 2 s, 4 s, 8 s + jitter
      if (onRetry) onRetry({ attempt: attempt + 1, max: retries, waitMs, status: e.status || null });
      await sleep(waitMs, signal);
    }
  }
}

/* When every model failed, show the error that tells the student what to DO */
function bestError(errs, tried) {
  const real = errs.filter((e) => !e.dead);
  const daily = errs.filter((e) => e.daily);
  const pick = real.length ? real[real.length - 1] : (daily.length ? daily[daily.length - 1] : null);
  const trail = tried.join(" | ").slice(0, 600);
  if (pick) { pick.detail = [pick.detail, trail && trail !== pick.detail ? "المحاولات: " + trail : ""].filter(Boolean).join(" — "); return pick; }
  const e = new Error("مفيش موديل شغّال على مفتاحك دلوقتي: كل الموديلات اللي جرّبها التطبيق اتقفلت أو مش متاحة للمفاتيح الجديدة. جرّب تدوس 🔑 ← \"اختبار الاتصال\" عشان يحدّث الموديلات، ولو فضل كده اعمل مفتاح جديد من Google AI Studio.");
  e.detail = "المحاولات: " + trail;
  e.dead = true;
  return e;
}

/* ── one attempt on ONE lane (a Gemini model or an extra free engine) ── */

/* the phone's native HTTP client, as the "native" transport of providers.js (non-streaming) */
const nativeJson = async (url, headers, body, timeoutMs) => {
  const r = await CapacitorHttp.request({ url, method: "POST", headers, data: body, connectTimeout: 30000, readTimeout: timeoutMs });
  return { status: r.status, data: r.data, headers: r.headers || {} };
};
const EXT_TRANSPORT = { fetch: (...a) => fetch(...a), abortError, timeoutError };
const _extNative = {};          // provider → "the WebView cannot read its replies (CORS): use the native client until this time"

/* v3.34 · an engine with several keys: a key that is refused / out of credit / out of its quota is put aside and the NEXT key of the same company is used in the same
   request, at once. Only when every key of the company has failed does the lane itself fail (and the router moves on to another lane). */
async function attemptExternal(a) {
  const tried = new Set();
  let last = null;
  for (;;) {
    const key = liveExtKeys(a.lane.provider, tried)[0];
    if (!key) throw last || Object.assign(new Error("مفيش مفتاح للمحرك ده."), { ext: true, badKey: true, dead: true, detail: `[${a.lane.id}] no key` });
    try { return await attemptExternalOnce({ ...a, key }); }
    catch (e) {
      if (!e || e.name === "AbortError" || !(e.badKey || e.daily || e.status === 429)) throw e;
      Ring.penalize(key, e.badKey ? 24 * 3600e3 : e.daily ? 5 * 3600e3 : Math.max(30000, e.retryAfterMs || 0), e.badKey ? "bad" : e.daily ? "day" : "busy");
      tried.add(key); last = e;
      if (!liveExtKeys(a.lane.provider, tried).length) throw e;
    }
  }
}

async function attemptExternalOnce({ lane, key, system, parts, spec, maxOut, signal, onText, onAlive, firstMs, idleMs }) {
  if (!key) throw Object.assign(new Error("مفيش مفتاح للمحرك ده."), { ext: true, badKey: true, dead: true, detail: `[${lane.id}] no key` });
  const promptTokens = estimateTokens(system, parts, 0);
  const room = answerBudget(lane, promptTokens, maxOut);
  if (room < 700) throw Object.assign(new Error("الطلب كبير على المحرك ده."), { ext: true, tooBig: true, detail: `[${lane.id}] prompt ≈ ${promptTokens} tokens` });

  let extras = true;
  for (;;) {
    const body = buildBody({ lane, system, parts, spec, maxOut: room, extras });
    trackRequest(lane.id, true);                              // counted on its own: Google's meter must not include it
    const args = { lane, key, body, signal, onText, onAlive, firstMs: Math.min(firstMs || 45000, 45000), idleMs: Math.min(idleMs || 30000, 30000) };
    try {
      let out;
      if (Date.now() < (_extNative[lane.provider] || 0)) {
        out = await nativeChat({ ...args, native: nativeJson, abortError, timeoutError });
      } else {
        try { out = await streamChat({ ...args, transport: EXT_TRANSPORT }); }
        catch (e) {
          if (!(e && e.netBeforeStart && Capacitor.isNativePlatform())) throw e;
          out = await nativeChat({ ...args, native: nativeJson, abortError, timeoutError });   // CORS: the native client is not subject to it
          _extNative[lane.provider] = Date.now() + 6 * 3600e3;
        }
      }
      if (!out.text.trim()) throw Object.assign(new Error("المحرك الإضافي رجّع رد فاضي."), { ext: true, emptyReply: true, detail: `[${lane.id}] ${out.finish || "empty"}` });
      /* a reply that hit the token limit is cut in the middle: never show it as if it were complete */
      if (out.finish === "length") throw Object.assign(new Error("الرد اتقطع."), { ext: true, cut: true, detail: `[${lane.id}] cut at ${room} tokens` });
      return out;
    } catch (e) {
      if (e && e.paramBad && extras) { extras = false; continue; }
      throw e;
    }
  }
}

function attemptLane(a) {
  return a.lane.provider === "gemini"
    ? attemptModel({ ...a, model: a.lane.model })
    : attemptExternal(a);
}

/* ── the lane-aware engine ── */

const MAX_STARTS = 10;            // lane attempts of one task (hedges included)
const MAX_WAIT_MS = NET.maxWait;  // total time a task may spend ONLY waiting for lanes to wake up (40 s free · 15 s paid)
const MAX_HINT_MS = NET.maxHint;  // everything asleep for longer than this → say "busy" now instead of making the student stare at a spinner (25 s free · 12 s paid)

/* public: run one task.
   1. planLanes() orders the lanes that can take this request (router.js)
   2. the first ready lane starts; if it fails with "busy" the NEXT lane starts at once (no waiting); if it simply stays silent for a few
      seconds a second lane is raced against it (hedging) and the first sign of life wins
   3. only when EVERY lane is asleep does the engine wait — for the first one to wake up, never longer than MAX_WAIT_MS in total
   `hedgeMs` is accepted and ignored (old callers). */
export async function runTask(args) {
  /* v3.32: every call leaves a trace (latency.js) so a slow run can be explained instead of guessed; `onReport(trace)` receives it, success or failure */
  const trace = { task: args && args.task, t0: Date.now(), slept: 0, attempts: [], hedges: 0 };
  try { return await guardedTask(args, trace); }
  finally {
    trace.endAt = Date.now();
    if (args && typeof args.onReport === "function") { try { args.onReport(trace); } catch (e) { /* a report must never break a request */ } }
  }
}

/* v3.37 · the output guard (guard.js) wraps EVERY Arabic-prose request here, the one door all screens use:
   what streams to the screen and what is returned is already free of leaked prompt lines and of letter-level spelling glitches.
   A weak lane (Flash-Lite, an extra engine) whose answer needed several repairs is written again once by a stronger Google model (budgeted). */
async function guardedTask(args, trace) {
  const guard = args ? makeGuard(args) : null;
  if (!guard) return runTaskInner(args, trace);
  const inner = typeof args.onText === "function" ? args.onText : null;
  const wrapped = { ...args, onText: (t, m) => { if (inner) inner(guard.scrub(t, false).text, m); } };
  let res = await runTaskInner(wrapped, trace);
  let out = guard.scrub(res.text, true);
  trace.guard = { leaks: out.leaks, fixes: out.fixes, rewritten: false };
  const weakLane = res.provider !== "gemini" || tierOf(res.model || "") === "weak";
  const stronger = (args.models || []).filter((m) => tierOf(m) !== "weak");
  if (out.fixes >= REWRITE_AT && weakLane && stronger.length && !(args.signal && args.signal.aborted) && allowRetry()) {
    try {
      const again = await runTaskInner({ ...wrapped, models: stronger, engineMode: "quality" }, trace);
      const o2 = guard.scrub(again.text, true);
      if (o2.fixes < out.fixes) { res = again; out = o2; trace.guard = { leaks: o2.leaks, fixes: o2.fixes, rewritten: true }; }
    } catch (e) {
      if (e && e.name === "AbortError") throw e;                  // the student stopped it
      /* the stronger model could not answer: keep the first (already repaired) answer */
    }
  }
  return { ...res, text: out.text };
}

/* ── v3.34 · the key ring around the engine ──
   The engine below works with ONE Gemini key. Here the keys of the ring are tried in order: when the key in use cannot answer (its daily quota is finished on every model,
   it is refused, or Google keeps answering 429 / busy) it is put aside for exactly as long as it needs, the lanes' "asleep" marks (earned by that key) are forgotten and
   the SAME request goes to the next key. The student sees nothing, unless every key is out. */
const rotatable = (e) => !!e && e.name !== "AbortError" && !e.blocked && (e.fatal || e.status === 429 || e.busy || (e.dead && !e.status && !e.retired));
const needGeminiError = () => Object.assign(new Error("الطلب ده بيقرا صور أو ملفات، وده محتاج مفتاح Google Gemini. أضف مفتاح Gemini من أيقونة 🔑."), { detail: "no Gemini key in the ring", needGemini: true, fatal: true });

async function runTaskInner(args, trace) {
  if (GATEWAY_URL) return runTaskOnce(args, trace);          // behind the gateway there is no key to rotate: the gateway holds the (paid) one
  const first = Ring.candidates("gemini", { extra: args.apiKey });
  if (!first.length) return runTaskOnce({ ...args, apiKey: "" }, trace);      // no Google key at all: the other companies' lanes (if any) answer text requests
  if (first.length === 1) return runTaskOnce({ ...args, apiKey: first[0] }, trace);   // one key: exactly the engine as it always was

  /* v3.35 · several keys: the order of the walk is "tier first, then key":
       weak job   → weak model of key 1 → weak model of key 2 → … → (only then) the middle model of key 1, key 2 … → the strong model last
       strong job → strong model of key 1 → strong model of key 2 → … → then the smaller ones
     so a finished weak quota on key 1 sends the weak job to key 2's weak model and leaves key 1's strong model untouched for the jobs that need it.
     Any other trouble with a key (refused, busy, timing out) moves the job on to the next key in the same way. */
  const stages = tierStages(args.models);
  let last = null;
  for (let si = 0; si < stages.length; si++) {
    const st = stages[si];
    const tried = new Set();
    for (;;) {
      const keys = Ring.candidates("gemini", { tried, extra: args.apiKey, tier: st.tier });
      if (!keys.length) break;
      const key = keys[0];
      const more = keys.length > 1 || si < stages.length - 1;
      try { return await runTaskOnce({ ...args, apiKey: key, models: st.models, moreKeys: more }, trace); }
      catch (err) {
        if (!rotatable(err) || (args.signal && args.signal.aborted)) throw err;
        const day = !!(err.daily || (err.dead && err.status === 429));
        if (err.fatal) Ring.penalize(key, 24 * 3600e3, "bad");                                                       // refused: the whole key
        else Ring.penalize(key, day ? Math.max(60000, nextResetMs() - Date.now()) : 45000, day ? "day" : "busy", st.tier);   // only this size of model on this key
        tried.add(key); last = err;
        clearDeadLanes("gemini:"); clearCoolLanes("gemini:");      // what the old key earned (asleep / dead lanes) does not apply to the next one
      }
    }
  }
  throw last || needGeminiError();
}

async function runTaskOnce({ apiKey, moreKeys, models, task, system, noSearchSystem, parts, spec, maxOut, firstMs, idleMs, signal, onText, onNotice, engineMode, hedgeClass, search }, trace) {
  if (typeof onText !== "function") onText = () => {};
  if (!signal) signal = new AbortController().signal;
  if (signal.aborted) throw abortError();

  const order = [...new Set(models)];
  if (!order.length) throw new Error("مفيش موديل متاح دلوقتي.");

  /* v3.27 — the tutor chat's "reply level" can override two things for ONE call: the student's engine mode (a deep answer must come from the
     strong Google model, never from a small fast lane) and the class used for hedging (a model that THINKS for 30 s must not be raced by a
     weaker lane after 4 s) */
  /* a search first makes the first word come later: such a request waits a little longer than a plain chat before a second lane is raced against it */
  const cls = hedgeClass || (search ? "search" : taskClass(task));
  const mode = engineMode || getEngineMode();
  const media = mediaOf(parts);
  /* how big the request is for a lane with a small token window: the prompt plus a realistic answer (not the generous maxOut cap) */
  const tokens = estimateTokens(system, parts, Math.min(maxOut || 0, cls === "chat" ? 1500 : 3000));

  /* with another key waiting, this key is not worth a long wait: a short pause, then the next key takes over */
  const maxWaitMs = moreKeys ? Math.min(MAX_WAIT_MS, 3000) : MAX_WAIT_MS, maxHintMs = moreKeys ? Math.min(MAX_HINT_MS, 2500) : MAX_HINT_MS;
  const noGemini = !apiKey || apiKey === Ring.NO_GEMINI;

  const errs = [], tried = [];
  let shownLen = 0, shownLane = "", waited = 0, starts = 0, notices = 0, timeouts = 0, lastErr = null;

  const show = (lane, text) => {
    if (shownLane !== lane.id) { shownLane = lane.id; shownLen = 0; }        // another lane writes the answer from its own start
    if (text.length < shownLen) return;                                       // a retry on the same lane re-writes from the start: keep the longer text on screen
    shownLen = text.length;
    onText(text, lane.model);
  };

  const plan = () => {
    const dead = new Set(deadSet(apiKey));
    for (const m of order) if (finishedToday(apiKey, m)) dead.add(m);          // a model list refresh forgets "dead" marks; a finished daily quota is remembered by the ledger until the reset
    const live = order.filter((m) => !dead.has(m));
    /* v3.33 · what the quota ledger knows goes to the router BEFORE the lanes are ranked: a model that has just used its per-minute quota sleeps for exactly
       the time it needs (instead of being called, answering 429 and sleeping 15-60 s), and between equal models the one with more daily quota left goes first */
    for (const m of order) {
      const id = `gemini:${m}`;
      const gone = deadLeftMs(apiKey, m);
      if (gone > 0) noteDead(id, gone);                                    // finished for today: the router knows it too (also after a restart), so nothing is sent there
      const w = paceMs(apiKey, m);
      if (w > 0) coolFor(id, w);
      setBias(id, budgetBias(apiKey, m));
    }
    return planLanes({ geminiModels: noGemini ? [] : (live.length ? live : order), extLanes: getExtLanes(), cls, mode, media, tokens });
  };

  /* bookkeeping after a failed attempt; returns true when the whole task must stop */
  const onFail = (lane, err) => {
    tried.push(`${lane.model} → ${err.status || (err.timeout ? "timeout" : err.emptyReply ? "empty" : err.cut ? "cut" : err.tooBig ? "too-big" : "net")}${err.retired ? " (retired)" : ""}`);
    errs.push(err);
    lastErr = err;
    if (lane.provider === "gemini") {
      if (err.fatal || err.blocked) return true;                              // bad key · safety filter: another Gemini model would say the same
      if (err.dead) {
        const ttl = err.retired ? RETIRED_TTL : err.deadMs > 0 ? err.deadMs : DEAD_TTL;          // a finished daily quota: until the reset (quota.js), not a guess of 6 h
        for (const name of err.deadMs > 0 ? sameAs(apiKey, lane.model) : [lane.model]) {       // gemini-flash-latest and gemini-3.8-flash are ONE quota
          addDead(apiKey, name, !!err.retired, ttl);
          noteDead(`gemini:${name}`, ttl);
        }
        if (err.retired) {
          if (err.replacement) {
            addSuggest(apiKey, err.replacement);
            if (!order.includes(err.replacement) && !deadSet(apiKey).has(err.replacement)) order.push(err.replacement);
          }
          selfHeal(apiKey);
        }
        return false;
      }
      if (isTransient(err)) { noteBusy(lane.id, { status: err.status, retryAfterMs: err.retryAfterMs }); return false; }
      return true;                                                             // any other Gemini error (bad request …): retrying cannot change it
    }
    /* an extra engine failing is never fatal for the task: the lane is put aside and the next lane answers */
    if (err.dead || err.badKey) { markExtDead(lane.id, err.daily ? 5 * 3600e3 : err.badKey ? 3600e3 : 6 * 3600e3); noteDead(lane.id, err.daily ? 5 * 3600e3 : err.badKey ? 3600e3 : 6 * 3600e3); }
    else if (err.tooBig || err.cut) noteTooBig(lane.id, tokens);
    else noteBusy(lane.id, { status: err.status, retryAfterMs: err.retryAfterMs });
    return false;
  };

  /* one race: start the first ready lane, fail over at once, hedge when it stays silent. Resolves with the answer, rejects with the last error. */
  const race = (ready, hedgePool) => new Promise((resolve, reject) => {
    const recs = [];
    let winner = null, settled = false, hedgeTimer = null, last = null;
    const running = () => recs.filter((r) => !r.over && !r.cancelled);
    const stopAll = (except) => recs.forEach((r) => { if (r !== except && !r.over) { r.cancelled = true; r.ctrl.abort(); } });
    const finish = (fn, v) => { if (settled) return; settled = true; clearTimeout(hedgeTimer); stopAll(null); fn(v); };
    /* v3.33: `ready` was computed before this race began. A lane that has been set aside or put to sleep SINCE (a 429 on one name of the same quota, another request's
       failure) is skipped: calling it would only waste a request. If nothing else is left the race ends and the outer loop re-plans (and waits, as always). */
    const nextLane = (pool) => pool.find((l) => !recs.some((r) => r.lane.id === l.id) && !isDead(l.id) && !isCooling(l.id));

    const armHedge = (rec) => {
      clearTimeout(hedgeTimer);
      if (winner || settled || running().length >= 2) return;                    // never more than two lanes at once
      const nxt = nextLane(hedgePool.filter((l) => ready.includes(l)));
      if (!nxt || starts >= MAX_STARTS) return;
      const ms = hedgeDelayMs(cls, rec.lane, NET.hedge, rec.lane.provider === "gemini" ? typicalTtft(apiKey, rec.lane.model, cls) : 0);
      hedgeTimer = setTimeout(() => {
        if (winner || settled || signal.aborted) return;
        noteSlow(rec.lane.id, ms);
        trace.hedges += 1;
        start(nxt);
      }, ms);
    };

    const start = (lane) => {
      starts += 1;
      const ctrl = new AbortController();
      const link = () => ctrl.abort();
      signal.addEventListener("abort", link, { once: true });
      const rec = { lane, ctrl, t0: Date.now(), aliveAt: 0, textAt: 0, over: false, end: laneBegin(lane.id) };
      recs.push(rec);
      const claim = () => {
        if (rec.aliveAt) return;
        rec.aliveAt = Date.now();
        if (lane.provider === "gemini") noteTtft(apiKey, lane.model, rec.aliveAt - rec.t0, cls);       // v3.33: how fast THIS key really answers (quota.js), remembered across restarts
        if (!winner) { winner = rec; clearTimeout(hedgeTimer); stopAll(rec); }   // first sign of life wins; the others are cancelled
      };
      const closeRec = () => { rec.over = true; rec.end(); signal.removeEventListener("abort", link); };
      attemptLane({
        lane, apiKey, task, system, noSearchSystem, parts, spec, maxOut, signal: ctrl.signal, firstMs, idleMs, search,
        onText: (t) => { if (!rec.textAt && t) rec.textAt = Date.now(); if (winner === rec) show(lane, t); },
        onAlive: claim,
      }).then((res) => {
        closeRec();
        trace.attempts.push({ lane: lane.model, t0: rec.t0, aliveAt: rec.aliveAt, textAt: rec.textAt || Date.now(), endAt: Date.now(), outcome: settled ? "lost" : "ok", usage: res.usage || null, tier: res.tier || "", gwMs: res.gwMs || 0 });
        if (settled) return;
        if (!winner) winner = rec;
        noteOk(lane.id, rec.aliveAt ? rec.aliveAt - rec.t0 : Date.now() - rec.t0);
        winner = rec;
        show(lane, res.text);
        finish(resolve, { ...res, model: lane.model, provider: lane.provider });
      }, (err) => {
        closeRec();
        trace.attempts.push({ lane: lane.model, t0: rec.t0, aliveAt: rec.aliveAt, textAt: rec.textAt, endAt: Date.now(),
          outcome: err && err.name === "AbortError" ? (rec.cancelled ? "lost" : "cancel") : "fail", status: err && err.status,
          why: err && (err.timeout ? "timeout" : err.emptyReply ? "رد فاضي" : err.cut ? "اتقطع" : err.interrupted ? "النت قطع" : err.netBeforeStart ? "مفيش اتصال" : undefined) });
        if (settled) return;
        if (signal.aborted) return finish(reject, (err && err.name === "AbortError") ? err : abortError());
        if (err && err.name === "AbortError") return;                            // a lane WE cancelled (it lost the race): silent
        last = err;
        const stop = onFail(lane, err);
        if (winner === rec) winner = null;                                        // the lane that was writing died: the race is open again
        if (stop) return finish(reject, err);
        if (!running().length) {
          const nxt = starts < MAX_STARTS ? nextLane(ready) : null;
          if (nxt) start(nxt);                                                     // FAILOVER: no waiting, the next lane starts now
          else finish(reject, last);
        } else if (!winner) {
          const r = running()[0];
          armHedge(r);
        }
      });
      if (!winner) armHedge(rec);
    };

    start(ready[0]);
  });

  for (;;) {
    if (signal.aborted) throw abortError();
    const { lanes, hedge } = plan();
    if (!lanes.length) throw noGemini ? needGeminiError() : bestError(errs, tried);       // no Google key and no other company can take this request (a scan, a PDF …)

    /* quality mode keeps the extra engines out of the way unless Google really is away for long */
    const gem = lanes.filter((l) => l.provider === "gemini");
    const gemSoon = mode === "quality" && gem.length && !readyLanes(gem).length && nextReadyIn(gem) <= 8000;
    const pool = gemSoon ? gem : lanes;
    const ready = readyLanes(pool);

    if (!ready.length) {
      const left = nextReadyIn(pool);
      /* v3.33: every model is set aside (not just asleep): waiting a minute would be a lie. If the reason is the daily quota, say so, with the time it comes back. */
      if (pool.length && pool.every((l) => isDead(l.id))) {
        const msg = finishedMessage(apiKey);
        if (msg) throw Object.assign(new Error(msg), { status: 429, daily: true, dead: true, detail: "daily quota finished on every model (quota ledger)" });
      }
      if (!Number.isFinite(left) || starts >= MAX_STARTS) throw bestError(errs, tried);
      if (left > maxHintMs) throw busyError(lastErr);
      const w = Math.round(left + 150 + Math.random() * 700);
      if (waited + w > maxWaitMs) throw busyError(lastErr);
      waited += w;
      trace.slept += w;
      notices += 1;
      if (onNotice) onNotice({ attempt: notices, max: 4, waitMs: w, status: (lastErr && lastErr.status) || null });
      await sleep(w, signal);
      continue;
    }

    try {
      return await race(ready, hedge.filter((l) => pool.includes(l)));
    } catch (err) {
      if (!err || err.name === "AbortError" || signal.aborted) throw err || abortError();
      if (err.fatal || err.blocked) throw err;
      if (err.timeout && ++timeouts >= 2) throw busyError(err);                   // it hung twice: do not make the student wait a third time
      if (!isTransient(err) && !err.dead && !err.ext && !err.cut && !err.tooBig) throw err;
      if (starts >= MAX_STARTS) throw bestError(errs, tried);
      /* otherwise: re-plan (the lane that failed is now asleep or dead) and go round again */
    }
  }
}


/* ───────────── image generation (Nano Banana family) ─────────────
   The image models are NOT on Google's free tier, so the first answer for a free key is a clear message.
   Model ids change often → the list is read from the API for THIS key (cached 12 h); a static list is the fallback. */

const IMG_PREFERRED = ["gemini-3.1-flash-image", "gemini-nano-banana-2.1", "gemini-3.1-flash-image-preview", "gemini-3-pro-image", "gemini-3-pro-image-preview", "gemini-3.1-flash-lite-image", "gemini-2.5-flash-image"];
const LS_IMG = "clinix:imgmodels:v1";

async function imageModels(apiKey) {
  try {
    const c = JSON.parse(window.localStorage.getItem(LS_IMG));
    if (c && c.key === apiKey.slice(-6) && Date.now() - c.at < 12 * 3600e3 && c.list.length) return c.list;
  } catch (e) { /* ignore */ }
  let names = [];
  try {
    const r = await rawRequest("GET", `${API_BASE}?pageSize=200`, undefined, 20000, apiKey);
    names = ((r.json && r.json.models) || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent") && /image|banana/i.test(m.name) && !/imagen/i.test(m.name))
      .map((m) => m.name.replace(/^models\//, ""));
  } catch (e) { /* offline list → fall back */ }
  const rank = (n) => { const i = IMG_PREFERRED.indexOf(n); return i < 0 ? 99 : i; };
  const list = names.length ? [...names].sort((a, b) => rank(a) - rank(b)) : IMG_PREFERRED;
  try { window.localStorage.setItem(LS_IMG, JSON.stringify({ key: apiKey.slice(-6), at: Date.now(), list })); } catch (e) { /* ignore */ }
  return list;
}

export async function generateImage({ apiKey, prompt, parts = [], signal }) {
  const models = await imageModels(apiKey);
  let last = null, slow = 0;
  for (const model of models) {
    if (signal && signal.aborted) throw abortError();
    trackRequest(model);
    const url = `${API_BASE}/${model}:generateContent`;
    const body = { contents: [{ role: "user", parts: [...parts, { text: prompt }] }], generationConfig: { responseModalities: ["TEXT", "IMAGE"] } };
    let r;
    try { r = await rawRequest("POST", url, body, NET.imageMs, apiKey); }
    catch (e) { last = e; if (++slow >= NET.imageTimeouts) throw e; continue; }       // v3.32 paid profile: two silent models = stop (was: every model of the list, 170 s each)
    if (signal && signal.aborted) throw abortError();
    if (r.status === 200) {
      const ps = (((r.json.candidates || [])[0] || {}).content || {}).parts || [];
      const img = ps.find((p) => p.inlineData && /^image\//.test(p.inlineData.mimeType || "") && !p.thought);
      const text = ps.filter((p) => typeof p.text === "string" && !p.thought).map((p) => p.text).join("").trim();
      if (img) {
        try { window.localStorage.setItem(LS_IMG, JSON.stringify({ key: apiKey.slice(-6), at: Date.now(), list: [model, ...models.filter((m) => m !== model)] })); } catch (e) { /* ignore */ }
        return { mime: img.inlineData.mimeType, data: img.inlineData.data, text, model };
      }
      last = Object.assign(new Error("الموديل ما رسمش صورة (ممكن الطلب اتحجب لأسباب أمان). جرّب توصف الصورة بشكل تاني."), { detail: `${model} · no image` });
      continue;
    }
    const msg = (r.json && r.json.error && r.json.error.message) || "";
    const err = classify(r.status, msg);
    if (r.status === 404 || /not found|not supported|unsupported|is not available/i.test(msg)) { last = err; continue; }
    if (r.status === 429 || r.status === 403 || /billing|paid|free.?tier/i.test(msg)) {
      throw Object.assign(new Error("إنشاء الصور في Gemini مش متاح في الباقة المجانية. فعّل الدفع (Billing) من Google AI Studio لو عايزه."), { detail: err.detail, billing: true });
    }
    throw err;
  }
  throw Object.assign(last || new Error("مفيش موديل رسم صور متاح مع المفتاح ده."), { billing: true });
}
