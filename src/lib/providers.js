/* ───────────── Extra free engines (v3.26) ─────────────
   Groq · OpenRouter (":free" models) · Mistral — three OTHER companies, each with its OWN free quota that has nothing to do with Google's.
   They all speak the OpenAI "chat/completions" format, so one small client covers them.

   What they are used for (see router.js for the order):
     • a second lane when Google is busy → the request is answered at once instead of waiting 2 s · 4 s · 8 s
     • "hedging": a slow first lane is raced by one of these (different company = different quota)
     • "speed" mode: the tutor chat is answered by the fast lane first
   What they are NOT used for: anything that must READ a PDF or a scan (only Gemini does that) — router.js keeps those on Gemini.

   Every key is optional. With no extra key the app behaves exactly like before (plus the Gemini-only improvements).
   Keys live in localStorage (this device only) or in the build env: VITE_GROQ_API_KEY · VITE_OPENROUTER_API_KEY · VITE_MISTRAL_API_KEY.

   No imports from the rest of the app (and none from Capacitor): the network pieces are injected, so this file is tested in Node. */

/* v3.34 · two more companies, both PAID (so they are a fallback, never a racer): OpenAI (ChatGPT) speaks the same chat/completions format;
   Anthropic (Claude) has its own format (api: "anthropic"): its request, headers and stream are handled by the *Anthropic functions below.
   The keys no longer live in three boxes: they are in the key ring (keyring.js), any number per provider; this file only asks the ring. */
import * as Ring from "./keyring.js";

const ENV = (typeof import.meta !== "undefined" && import.meta.env) || {};
const LS = () => { try { return window.localStorage; } catch (e) { return null; } };
const read = (k) => { try { return JSON.parse(LS().getItem(k)); } catch (e) { return null; } };
const write = (k, v) => { try { LS().setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } };

/* ── provider catalogue ──
   maxTokens = what ONE request may weigh (prompt + answer) on the free plan. Groq's free plan allows about 8,000 tokens per minute per
   model, so bigger prompts are never sent there (router.js keeps them on Gemini); the others have large windows.
   prefer = which of the models the provider lists to use, best first (matched against the live list, so a renamed model is not a problem). */
export const PROVIDERS = {
  groq: {
    id: "groq", label: "Groq", rank: 1,
    base: String(ENV.VITE_GROQ_BASE || "https://api.groq.com/openai/v1"),
    keyUrl: "console.groq.com/keys", keyHint: "gsk_…",
    maxTokens: 7000,
    prefer: [
      { re: /gpt-oss-120b/i, kind: "big", effort: true },
      { re: /qwen.*(32b|27b|30b|235b|next)/i, kind: "big" },
      { re: /llama-3\.3-70b/i, kind: "big", maxTokens: 5500 },
      { re: /gpt-oss-20b/i, kind: "small", effort: true },
    ],
    skip: /whisper|tts|guard|safeguard|prompt-guard|embed|orpheus|distil/i,
  },
  mistral: {
    id: "mistral", label: "Mistral", rank: 2,
    base: String(ENV.VITE_MISTRAL_BASE || "https://api.mistral.ai/v1"),
    keyUrl: "console.mistral.ai/api-keys", keyHint: "…",
    maxTokens: 60000,
    prefer: [
      { re: /^mistral-large-latest$/i, kind: "big" },
      { re: /^mistral-medium-latest$/i, kind: "big" },
      { re: /^mistral-small-latest$/i, kind: "small" },
    ],
    skip: /embed|moderation|ocr|codestral|pixtral|ministral|voxtral|devstral/i,
  },
  openai: {
    id: "openai", label: "ChatGPT (OpenAI)", rank: 4, paid: true, api: "openai", completionTokens: true, oneEach: true,
    base: String(ENV.VITE_OPENAI_BASE || "https://api.openai.com/v1"),
    keyUrl: "platform.openai.com/api-keys", keyHint: "sk-…",
    maxTokens: 100000, vision: true,
    prefer: [
      { re: /^gpt-5(?:\.\d+)?$/i, kind: "big", effort: true },
      { re: /^gpt-4\.1$/i, kind: "big" },
      { re: /^gpt-4o$/i, kind: "big" },
      { re: /^gpt-5(?:\.\d+)?-mini$/i, kind: "small", effort: true },
      { re: /^gpt-4\.1-mini$/i, kind: "small" },
      { re: /^gpt-4o-mini$/i, kind: "small" },
    ],
    skip: /embed|tts|whisper|audio|realtime|transcribe|moderation|dall|image|search|codex|instruct|davinci|babbage|computer|sora|chat-latest|\d{4}-\d{2}-\d{2}/i,
  },
  anthropic: {
    id: "anthropic", label: "Claude (Anthropic)", rank: 5, paid: true, api: "anthropic", oneEach: true,
    base: String(ENV.VITE_ANTHROPIC_BASE || "https://api.anthropic.com/v1"),
    keyUrl: "console.anthropic.com/settings/keys", keyHint: "sk-ant-…",
    maxTokens: 150000, vision: true,
    prefer: [
      { re: /^claude-sonnet-[\d-]+$/i, kind: "big" },
      { re: /^claude-opus-[\d-]+$/i, kind: "big" },
      { re: /^claude-haiku-[\d-]+$/i, kind: "small" },
    ],
    skip: /embed|\d{8}$/i,
  },
  openrouter: {
    id: "openrouter", label: "OpenRouter", rank: 3,
    base: String(ENV.VITE_OPENROUTER_BASE || "https://openrouter.ai/api/v1"),
    keyUrl: "openrouter.ai/keys", keyHint: "sk-or-…",
    maxTokens: 40000,
    freeOnly: true,                               // only ":free" models, and only the biggest two (its free plan is 20 requests a minute, ~50 a day)
    prefer: [],
    skip: /vision|image|audio|embed|moderation|guard|safeguard|ocr|video|tts|whisper|rerank/i,
  },
};
export const PROVIDER_IDS = Object.keys(PROVIDERS);

/* ── the student's choices ── */

const ENV_KEYS = { groq: ENV.VITE_GROQ_API_KEY, mistral: ENV.VITE_MISTRAL_API_KEY, openrouter: ENV.VITE_OPENROUTER_API_KEY, openai: ENV.VITE_OPENAI_API_KEY, anthropic: ENV.VITE_ANTHROPIC_API_KEY };

/* every key of one provider, in the student's order (a build-time key goes last), and the ones that are not resting */
export const extKeyList = (provider) => {
  const mine = Ring.keysOf(provider), env = String(ENV_KEYS[provider] || "").trim();
  return env && !mine.includes(env) ? [...mine, env] : mine;
};
export const liveExtKeys = (provider, tried = new Set()) => Ring.candidates(provider, { tried, extra: String(ENV_KEYS[provider] || "") }).filter(Ring.isLive);

/* provider → the key that is used now (a provider whose keys are all resting is still listed: its lanes are hidden by getExtLanes, and wake up by themselves) */
export function getExtKeys() {
  const out = {};
  for (const id of PROVIDER_IDS) { const all = extKeyList(id); if (!all.length) continue; out[id] = all.find(Ring.isLive) || all[0]; }
  return out;
}
export function getSavedExtKeys() {            // the first key of each provider (the old three-box view; kept for compatibility)
  const out = {};
  for (const id of PROVIDER_IDS) out[id] = Ring.keysOf(id)[0] || "";
  return out;
}
export function setExtKeys(obj) {
  Ring.replaceProviderKeys(PROVIDER_IDS, obj);
  _lanes = null;                               // the lane list is rebuilt with the new keys
}
/* a key was added / removed / came back: lanes that were set aside for hours because of the OLD keys get a new chance */
export function keysChanged(provider) {
  const d = read(LS_DEAD) || {};
  for (const k of Object.keys(d)) if (!provider || k.startsWith(`${provider}:`)) delete d[k];
  write(LS_DEAD, d);
  _lanes = null;
}

const LS_PREFS = "clinix:engine:v1";
export const ENGINE_MODES = ["auto", "quality", "speed"];
export function getEnginePrefs() {
  const p = read(LS_PREFS) || {};
  return { mode: ENGINE_MODES.includes(p.mode) ? p.mode : "auto", slice: p.slice !== false, search: p.search !== false, reuse: p.reuse !== false };
}
export function setEnginePrefs(next) { write(LS_PREFS, { ...getEnginePrefs(), ...next }); }
export const getEngineMode = () => getEnginePrefs().mode;
/* v3.38 · the "quality first" / "max speed" buttons are gone from the settings: the app always chooses by itself ("auto").
   Anyone who had picked one of them earlier is moved to auto once, so nothing stays switched on that can no longer be seen or switched off. */
export function retireManualModes() {
  const p = read(LS_PREFS);
  if (p && p.mode && p.mode !== "auto") write(LS_PREFS, { ...p, mode: "auto" });
}

/* ── lanes: discovered from each provider's own model list (cached), never hard-coded to a name that may be renamed tomorrow ── */

const LS_LANES = "clinix:xlanes:v1";
const LS_DEAD = "clinix:xdead:v1";
const LANES_TTL = 3 * 864e5;
const DEAD_TTL = 5 * 3600e3;
const tag = (k) => String(k || "").slice(-8);
let _lanes = null;

/* used only until the first successful model-list call (or when it cannot be made): the usual names; a wrong guess just answers 404 and is put aside */
const FALLBACK = {
  groq: ["openai/gpt-oss-120b", "openai/gpt-oss-20b"],
  mistral: ["mistral-large-latest", "mistral-small-latest"],
  openrouter: [],
  openai: ["gpt-5", "gpt-5-mini"],
  anthropic: ["claude-sonnet-5-5", "claude-haiku-5-5"],
};

const sizeOf = (id) => { const m = String(id).match(/(\d+(?:\.\d+)?)\s*b\b/i) || String(id).match(/-(\d+)b/i); return m ? parseFloat(m[1]) : 0; };

/* the provider's list → the lanes we will use */
export function pickLanes(provider, list) {
  const P = PROVIDERS[provider];
  const items = (Array.isArray(list) ? list : []).map((m) => (typeof m === "string" ? { id: m } : m)).filter((m) => m && m.id && !P.skip.test(m.id));
  const mk = (m, extra = {}) => ({
    id: `${provider}:${m.id}`, provider, model: m.id, kind: "big", vision: !!P.vision, pdf: false,
    maxTokens: P.maxTokens, rank: P.rank, effort: false, paid: !!P.paid, ...extra,
  });
  const lanes = [];

  if (P.freeOnly) {
    const free = items.filter((m) => /:free$/i.test(m.id) || (m.pricing && Number(m.pricing.prompt) === 0 && Number(m.pricing.completion) === 0))
      .filter((m) => !m.context_length || m.context_length >= 16000)
      .filter((m) => !m.architecture || !m.architecture.output_modalities || m.architecture.output_modalities.includes("text"))
      .sort((a, b) => sizeOf(b.id) - sizeOf(a.id) || (b.context_length || 0) - (a.context_length || 0));
    for (const m of free.slice(0, 2)) lanes.push(mk(m, { maxTokens: Math.min(P.maxTokens, m.context_length || P.maxTokens) }));
    return lanes;
  }

  for (const pref of P.prefer) {
    if (P.oneEach && lanes.some((l) => l.kind === pref.kind)) continue;               // v3.34 (paid providers): the best model of each size only
    const hit = items.find((m) => pref.re.test(m.id) && !lanes.some((l) => l.model === m.id));
    if (hit) lanes.push(mk(hit, { kind: pref.kind, effort: !!pref.effort, maxTokens: pref.maxTokens || P.maxTokens }));
  }
  return lanes;
}

/* what the "GET /models" call of a provider returns → an array of model objects */
export const modelsOf = (json) => (Array.isArray(json && json.data) ? json.data : Array.isArray(json && json.models) ? json.models : []);

const deadMap = () => { const d = read(LS_DEAD) || {}; const t = Date.now(); const out = {}; for (const k of Object.keys(d)) if (d[k] > t) out[k] = d[k]; return out; };
export function markExtDead(laneId, ttl = DEAD_TTL) { const d = deadMap(); d[laneId] = Date.now() + ttl; write(LS_DEAD, d); _lanes = null; }
export const extDeadSet = () => new Set(Object.keys(deadMap()));

/* the lanes the router may use right now (synchronous: it reads the cache; refreshLanes() fills it in the background) */
export function getExtLanes() {
  if (_lanes) return _lanes;
  const keys = getExtKeys();
  const cache = read(LS_LANES) || {};
  const dead = extDeadSet();
  const out = [];
  for (const id of PROVIDER_IDS) {
    if (!keys[id]) continue;
    if (!liveExtKeys(id).length) continue;                // every key of this provider is resting (quota finished / refused): its lanes wait out of sight
    const c = cache[id];
    const fresh = c && Date.now() - c.t < LANES_TTL && Array.isArray(c.lanes);   // the model list is the provider's, not the key's
    const lanes = fresh ? c.lanes : pickLanes(id, FALLBACK[id]);
    for (const l of lanes) if (!dead.has(l.id)) out.push(l);
  }
  out.sort((a, b) => (a.rank - b.rank) || (a.kind === b.kind ? 0 : a.kind === "big" ? -1 : 1));
  _lanes = out;
  return out;
}

/* fetch one provider's model list and cache the lanes. `request(method, url, body, timeoutMs, headers)` is injected (gemini.js → rawRequest). */
export async function refreshLanes(provider, request, { force = false } = {}) {
  const keys = getExtKeys();
  const key = keys[provider];
  if (!key) return [];
  const cache = read(LS_LANES) || {};
  const c = cache[provider];
  if (!force && c && Date.now() - c.t < LANES_TTL && Array.isArray(c.lanes) && c.lanes.length) return c.lanes;
  const P = PROVIDERS[provider];
  const { status, json } = await request("GET", `${P.base}/models${P.api === "anthropic" ? "?limit=100" : ""}`, undefined, 20000, headersFor(provider, key));
  if (status === 401 || status === 403) throw extError(status, JSON.stringify(json), {}, `${provider}:models`);
  if (status !== 200) throw extError(status, JSON.stringify(json), {}, `${provider}:models`);
  const lanes = pickLanes(provider, modelsOf(json));
  cache[provider] = { k: tag(key), t: Date.now(), lanes };
  write(LS_LANES, cache);
  _lanes = null;
  return lanes;
}

/* background warm-up for every configured provider (never throws, never blocks) */
export function warmExt(request) {
  for (const id of Object.keys(getExtKeys())) refreshLanes(id, request).catch(() => {});
}

export const bearer = (key) => ({ "Content-Type": "application/json", Authorization: `Bearer ${key}` });
/* the headers each company wants (Anthropic: its own key header; the "direct browser access" one is what lets the app's WebView call it) */
export const anthropicHeaders = (key) => ({ "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" });
export const headersFor = (provider, key) => (PROVIDERS[provider] && PROVIDERS[provider].api === "anthropic" ? anthropicHeaders(key) : bearer(key));
const urlFor = (lane) => (PROVIDERS[lane.provider].api === "anthropic" ? `${PROVIDERS[lane.provider].base}/messages` : `${PROVIDERS[lane.provider].base}/chat/completions`);

/* ── errors (same flags the Gemini side uses, so one retry engine reads both) ── */

const friendlyExt = (status, label) => {
  if (status === 401 || status === 403) return `مفتاح ${label} مش مقبول.`;
  if (status === 429) return `${label} عليه ضغط دلوقتي.`;
  if (status >= 500) return `${label} مشغول دلوقتي.`;
  return `${label}: حصلت مشكلة.`;
};

export function extError(status, bodyText, headers, laneId) {
  let message = "";
  try { const j = JSON.parse(bodyText); message = (j && j.error && (j.error.message || j.error.code)) || j.message || ""; if (typeof message !== "string") message = JSON.stringify(message); }
  catch (e) { message = String(bodyText || "").slice(0, 240); }
  const m = message.toLowerCase();
  const label = (PROVIDERS[String(laneId).split(":")[0]] || {}).label || "المحرك";
  const err = new Error(friendlyExt(status, label));
  err.status = status;
  err.ext = true;
  err.detail = `[${laneId}] HTTP ${status} · ${message}`.slice(0, 400);

  const get = (n) => (headers && (typeof headers.get === "function" ? headers.get(n) : headers[n])) || null;
  let retry = 0;
  const ra = get("retry-after");
  if (ra && /^[\d.]+$/.test(String(ra))) retry = parseFloat(ra) * 1000;
  const mm = m.match(/try again in\s+(?:(\d+)m)?\s*([\d.]+)\s*(ms|s)/);
  if (!retry && mm) retry = ((parseInt(mm[1] || "0", 10) * 60) + parseFloat(mm[2]) / (mm[3] === "ms" ? 1000 : 1)) * 1000;
  if (retry) err.retryAfterMs = Math.min(Math.round(retry), 60000);

  err.badKey = status === 401 || (status === 403 && /key|auth|permission|forbidden/.test(m));
  err.tooBig = status === 413 || /request too large|reduce your message|context length|maximum context|too many tokens|exceeds the (?:max|limit)/.test(m) && status !== 429
    || (status === 429 && /request too large/.test(m));
  err.daily = status === 429 && /per day|daily|tokens per day|requests per day|\btpd\b|\brpd\b|quota/.test(m) && !/per minute/.test(m);
  /* v3.34 · a paid account with no credit left says so with a 400 (Claude) or a 429 "insufficient_quota" (OpenAI): that key cannot work until it is topped up */
  if (/credit balance|insufficient_quota|billing (?:hard )?limit|exceeded your current quota|plans and billing/.test(m)) err.daily = true;
  err.paramBad = status === 400 && /(unsupported|unknown|invalid|unrecognized).*(param|reasoning|effort|field)|reasoning_effort/.test(m);
  err.dead = err.badKey || err.daily || status === 404 || status === 402
    || (status === 400 && /decommission|deprecated|does not exist|not found|no longer/.test(m))
    || (status === 403 && !err.badKey);
  return err;
}

/* ── request body ── */

const textOf = (parts) => (parts || []).filter((p) => p && typeof p.text === "string").map((p) => p.text).join("\n\n");

/* Gemini-style parts → one OpenAI user message. Images become image_url parts (only for a lane that says it can see). */
export function toMessages(system, parts, lane) {
  const msgs = [];
  if (system) msgs.push({ role: "system", content: String(system) });
  const hasImg = (parts || []).some((p) => p && p.inlineData && /^image\//.test(p.inlineData.mimeType || ""));
  if (hasImg && lane && lane.vision) {
    const content = [];
    for (const p of parts) {
      if (p && typeof p.text === "string") content.push({ type: "text", text: p.text });
      else if (p && p.inlineData && /^image\//.test(p.inlineData.mimeType || "")) content.push({ type: "image_url", image_url: { url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}` } });
    }
    msgs.push({ role: "user", content });
  } else {
    msgs.push({ role: "user", content: textOf(parts) });
  }
  return msgs;
}

/* the thinking level the app asks for → the lane's own knob (only models that have one) */
export const effortFor = (spec) => {
  const l = (spec && spec.levels && spec.levels[0]) || "low";
  return l === "high" ? "high" : l === "medium" ? "medium" : "low";
};

/* Gemini-style parts → Anthropic's message content (text blocks and base64 image blocks) */
function toAnthropicContent(parts, lane) {
  const content = [];
  for (const p of parts || []) {
    if (p && typeof p.text === "string") { if (p.text) content.push({ type: "text", text: p.text }); }
    else if (lane && lane.vision && p && p.inlineData && /^image\/(png|jpeg|gif|webp)$/.test(p.inlineData.mimeType || "")) content.push({ type: "image", source: { type: "base64", media_type: p.inlineData.mimeType, data: p.inlineData.data } });
  }
  return content.length ? content : [{ type: "text", text: "." }];
}

export function buildBody({ lane, system, parts, spec, maxOut, stream = true, extras = true }) {
  const P = PROVIDERS[lane.provider];
  if (P && P.api === "anthropic") {
    const body = { model: lane.model, max_tokens: Math.max(256, Math.floor(maxOut)), stream, messages: [{ role: "user", content: toAnthropicContent(parts, lane) }] };
    if (system) body.system = String(system);
    return body;
  }
  const body = {
    model: lane.model,
    messages: toMessages(system, parts, lane),
    stream,
    max_tokens: Math.max(256, Math.floor(maxOut)),
    temperature: 0.3,
  };
  if (P && P.completionTokens) { body.max_completion_tokens = body.max_tokens; delete body.max_tokens; delete body.temperature; }   // OpenAI's newer models refuse max_tokens and a custom temperature
  if (extras && lane.effort) body.reasoning_effort = effortFor(spec);
  return body;
}

/* the answer window the lane can still give after the prompt (Groq's per-minute token window is small) */
export function answerBudget(lane, promptTokens, wanted) {
  const room = (lane.maxTokens || 8000) - promptTokens - 150;
  return Math.max(0, Math.min(wanted, room));
}

const anthropicStatus = (type) => ({ authentication_error: 401, permission_error: 403, not_found_error: 404, rate_limit_error: 429, request_too_large: 413, overloaded_error: 529, invalid_request_error: 400 }[type] || 500);

/* ── <think> blocks some models put inside the visible text ── */
export function stripThink(raw) {
  let s = String(raw || "");
  s = s.replace(/<think>[\s\S]*?<\/think>\s*/gi, "");
  const open = s.search(/<think>/i);
  if (open >= 0) s = s.slice(0, open);                                  // still thinking: nothing visible yet
  s = s.replace(/<(?:t(?:h(?:i(?:n(?:k)?)?)?)?)?$/i, "");              // half-written "<thi" at the very end
  return s;
}

/* ── streaming (SSE over fetch) ──
   transport: { fetch, abortError, timeoutError }  — injected by gemini.js so the error objects match the rest of the app */
export async function streamChat({ lane, key, body, signal, onText, onAlive, firstMs = 45000, idleMs = 30000, transport }) {
  const { fetch: f, abortError, timeoutError } = transport;
  if (signal.aborted) throw abortError();
  const url = urlFor(lane);
  const claude = PROVIDERS[lane.provider].api === "anthropic";
  const ctrl = new AbortController();
  const link = () => ctrl.abort();
  signal.addEventListener("abort", link);
  let timer = null, why = null;
  const arm = (ms, w) => { clearTimeout(timer); timer = setTimeout(() => { why = w; ctrl.abort(); }, ms); };
  arm(firstMs, "first-byte");

  let raw = "", finish = null;
  const handle = (line) => {
    if (!line.startsWith("data:")) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") return;
    let j;
    try { j = JSON.parse(payload); } catch (e) { return; }
    if (claude) {                                                            // Anthropic's events: message_start · content_block_delta · message_delta · error
      if (j.type === "error" || j.error) throw extError(anthropicStatus(j.error && j.error.type), JSON.stringify(j), {}, lane.id);
      if (j.type === "message_start" || j.type === "ping") onAlive && onAlive();
      else if (j.type === "content_block_delta" && j.delta) {
        if (j.delta.type === "text_delta" && typeof j.delta.text === "string" && j.delta.text) { raw += j.delta.text; onAlive && onAlive(); onText(raw); }
        else onAlive && onAlive();                                          // thinking deltas: proof of life
      } else if (j.type === "message_delta" && j.delta && j.delta.stop_reason) finish = j.delta.stop_reason === "max_tokens" ? "length" : j.delta.stop_reason;
      return;
    }
    if (j.error) throw extError(Number(j.error.code) || 500, JSON.stringify(j), {}, lane.id);
    const ch = j.choices && j.choices[0];
    if (!ch) return;
    const d = ch.delta || ch.message || {};
    const think = d.reasoning || d.reasoning_content || d.thinking;
    if (typeof d.content === "string" && d.content) {
      raw += d.content;
      onAlive && onAlive();
      const vis = stripThink(raw);
      if (vis) onText(vis);
    } else if (think) {
      onAlive && onAlive();                                                  // thinking = proof of life, never shown
    } else if (d.role) {
      onAlive && onAlive();
    }
    if (ch.finish_reason) finish = ch.finish_reason;
  };

  try {
    let res;
    try {
      res = await f(url, { method: "POST", headers: headersFor(lane.provider, key), body: JSON.stringify(body), signal: ctrl.signal });
    } catch (e) {
      if (signal.aborted) throw abortError();
      if (why) throw timeoutError(why);
      throw Object.assign(new Error("مفيش اتصال بالمحرك الإضافي."), { detail: `[${lane.id}] fetch: ${String((e && e.message) || e)}`, netBeforeStart: true, ext: true });
    }
    if (!res.ok) throw extError(res.status, await res.text(), res.headers, lane.id);
    arm(idleMs, "idle");

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
          throw Object.assign(new Error("النت قطع في نص التحميل."), { detail: `[${lane.id}] stream: ${String((e && e.message) || e)}`, interrupted: true, ext: true });
        }
        if (chunk.done) break;
        arm(idleMs, "idle");
        buf += dec.decode(chunk.value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).replace(/\r$/, "");
          buf = buf.slice(nl + 1);
          handle(line);
        }
      }
      buf += dec.decode();
      if (buf.trim()) handle(buf.replace(/\r$/, ""));
    }
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", link);
  }
  return { text: stripThink(raw), finish, block: null };
}

/* Non-streaming call through the phone's native HTTP client (used when the WebView is not allowed to read the provider's replies — CORS).
   native(url, headers, body, timeoutMs) → { status, data, headers } */
export async function nativeChat({ lane, key, body, signal, onText, onAlive, native, abortError, timeoutError }) {
  if (signal.aborted) throw abortError();
  const url = urlFor(lane);
  const claude = PROVIDERS[lane.provider].api === "anthropic";
  let r;
  try { r = await native(url, headersFor(lane.provider, key), { ...body, stream: false }, 120000); }
  catch (e) {
    if (signal.aborted) throw abortError();
    const msg = String((e && e.message) || e);
    if (/timeout|timed out/i.test(msg)) throw timeoutError("native");
    throw Object.assign(new Error("مفيش اتصال بالمحرك الإضافي."), { detail: `[${lane.id}] native: ${msg}`, netBeforeStart: true, ext: true });
  }
  if (signal.aborted) throw abortError();
  let json = r.data;
  if (typeof json === "string") { try { json = JSON.parse(json); } catch (e) { json = {}; } }
  if (r.status !== 200) throw extError(r.status, JSON.stringify(json || {}), r.headers || {}, lane.id);
  if (claude) {
    const text = ((json && json.content) || []).filter((b) => b && b.type === "text").map((b) => b.text).join("");
    onAlive && onAlive();
    if (text) onText(text);
    return { text, finish: json && json.stop_reason === "max_tokens" ? "length" : (json && json.stop_reason) || null, block: null };
  }
  const ch = json && json.choices && json.choices[0];
  const text = stripThink((ch && ch.message && ch.message.content) || "");
  onAlive && onAlive();
  if (text) onText(text);
  return { text, finish: (ch && ch.finish_reason) || null, block: null };
}
