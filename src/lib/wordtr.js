/* English → Arabic for the two popups (double-click a word · select a sentence).

   v3.20 — ROOT-CAUSE FIX. Until v3.19 there was ONE unofficial endpoint (translate.googleapis.com) fetched straight from the
   page. In the Windows (Electron) app the page is served from file:// and only the Gemini host had its CORS headers patched,
   so the browser silently blocked the translation reply → "مقدرتش أترجمها" even with perfect internet. Now:
     1. electron/main.cjs patches CORS for the translation hosts too (see there).
     2. Several independent FREE providers are tried (Google ×3, then MyMemory). The next one starts if the previous one fails,
        or is just slow (2.5 s) — the first valid answer wins, so a single blocked / rate-limited provider can no longer break it.
     3. LAST RESORT only: if every free provider failed and a Gemini key exists, one tiny Gemini request translates it
        (set ALLOW_GEMINI_LAST_RESORT to false to forbid that). Normal translations still cost zero tokens.
   Answers are cached (memory + localStorage), so the same word / sentence is never translated twice. */

import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { fixText } from "./text.js";
import { getModelLists, runTask } from "./gemini.js";
import { weakFirst } from "./router.js";

const ALLOW_GEMINI_LAST_RESORT = true;
const PROVIDER_TIMEOUT = 7000;     // one provider may take this long
const HEDGE_AFTER = 1500;          // …but the next one starts in parallel after this long without an answer
const TOTAL_TIMEOUT = 16000;       // the student never waits longer than this for a bubble

let _key = "";
export const setTranslateKey = (k) => { _key = k || ""; };

const LS = "clinix:wtr:v2";
const mem = new Map();

function readCache() {
  try { return JSON.parse(window.localStorage.getItem(LS)) || {}; } catch (e) { return {}; }
}
function writeCache(k, v) {
  try {
    const all = readCache();
    all[k] = v;
    const keys = Object.keys(all);
    if (keys.length > 600) for (const old of keys.slice(0, keys.length - 600)) delete all[old];
    window.localStorage.setItem(LS, JSON.stringify(all));
  } catch (e) { /* ignore */ }
}

export const cachedMeaning = (word) => mem.get(word.toLowerCase()) || readCache()[word.toLowerCase()] || "";

const abortErr = () => Object.assign(new Error("aborted"), { name: "AbortError" });
const HAS_AR = /[\u0600-\u06FF]/;

/* ── one HTTP GET → parsed JSON (WebView fetch first, native client as a fallback on Android) ── */
async function getJson(url, signal, ms = PROVIDER_TIMEOUT) {
  const ctrl = new AbortController();
  const link = () => ctrl.abort();
  if (signal) { if (signal.aborted) throw abortErr(); signal.addEventListener("abort", link); }
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, ms);
  try {
    let data = null, netErr = null;
    try {
      const r = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
      if (!r.ok) netErr = new Error("HTTP " + r.status);
      else data = await r.json();
    } catch (e) {
      if (signal && signal.aborted) throw abortErr();
      netErr = timedOut ? new Error("timeout") : e;
    }
    if (data == null && Capacitor.isNativePlatform() && !(signal && signal.aborted)) {
      try {
        const n = await CapacitorHttp.get({ url, readTimeout: ms, connectTimeout: 5000 });
        if (n.status >= 200 && n.status < 300) { data = typeof n.data === "string" ? JSON.parse(n.data) : n.data; netErr = null; }
        else netErr = new Error("HTTP " + n.status);
      } catch (x) { netErr = x; }
    }
    if (signal && signal.aborted) throw abortErr();
    if (data == null) throw netErr || new Error("no data");
    return data;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", link);
  }
}

/* ── providers (all free, no key) ── */
const enc = encodeURIComponent;
const gtxParse = (d) => Array.isArray(d && d[0]) ? d[0].map((x) => x && x[0]).filter((s) => typeof s === "string").join("") : "";
const firstArabic = (d) => {
  const stack = [d];
  let any = "";
  while (stack.length) {
    const v = stack.shift();
    if (typeof v === "string") { if (HAS_AR.test(v)) return v; if (!any) any = v; }
    else if (Array.isArray(v)) stack.push(...v);
  }
  return any;
};

const PROVIDERS = [
  { name: "google-gtx", url: (q) => `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ar&dt=t&q=${enc(q)}`, parse: gtxParse },
  { name: "google-web", url: (q) => `https://translate.google.com/translate_a/single?client=gtx&sl=en&tl=ar&dt=t&q=${enc(q)}`, parse: gtxParse },
  { name: "google-ext", url: (q) => `https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=en&tl=ar&q=${enc(q)}`, parse: firstArabic },
  { name: "mymemory", url: (q) => `https://api.mymemory.translated.net/get?q=${enc(q)}&langpair=en|ar`,
    parse: (d) => (d && d.responseData && !/MYMEMORY WARNING|INVALID/i.test(String(d.responseData.translatedText || "")) && (+d.responseStatus === 200 || d.responseStatus === "200")) ? d.responseData.translatedText : "" },
];

const clean = (t) => fixText(String(t || "").replace(/\s+/g, " ").trim());

/* hedged race over the free providers: first VALID (contains Arabic) answer wins */
function freeTranslate(text, signal) {
  return new Promise((resolve, reject) => {
    const errs = [];
    let settled = false, next = 0, pending = 0, hedge = null;
    const inner = new AbortController();
    const onAbort = () => { if (!settled) { settled = true; clearTimeout(hedge); inner.abort(); reject(abortErr()); } };
    if (signal) { if (signal.aborted) return reject(abortErr()); signal.addEventListener("abort", onAbort); }
    const done = (fn) => { if (settled) return; settled = true; clearTimeout(hedge); inner.abort(); signal && signal.removeEventListener("abort", onAbort); fn(); };

    const startNext = () => {
      if (settled || next >= PROVIDERS.length) return;
      const p = PROVIDERS[next++];
      pending++;
      getJson(p.url(text), inner.signal)
        .then((d) => {
          const t = clean(p.parse(d));
          if (!t || !HAS_AR.test(t)) throw new Error("empty/non-arabic");
          done(() => resolve(t));
        })
        .catch((e) => {
          if (settled) return;
          errs.push(`${p.name}: ${(e && e.message) || e}`);
          pending--;
          if (next < PROVIDERS.length) startNext();
          else if (!pending) done(() => reject(Object.assign(new Error("free providers failed"), { detail: errs.join(" | ") })));
        });
      clearTimeout(hedge);
      if (next < PROVIDERS.length) hedge = setTimeout(startNext, HEDGE_AFTER);
    };
    startNext();
  });
}

/* last resort: one tiny Gemini request (only when every free provider failed) */
const GEM_SYS = "You translate English to Arabic for a nursing student. Output ONLY the Arabic translation, nothing else. For a single word or short term give its 1–3 most common meanings separated by «، » (put the medical meaning first when it is a medical term). For a sentence give a natural, accurate Arabic translation. Keep drug names and lab abbreviations in English. Use only Arabic letters and standard punctuation.";
async function geminiTranslate(text, signal, isWord) {
  if (!ALLOW_GEMINI_LAST_RESORT || !_key) throw new Error("no key");
  const lists = getModelLists(_key);
  const ctrl = new AbortController();
  const link = () => ctrl.abort();
  if (signal) signal.addEventListener("abort", link);
  const timer = setTimeout(() => ctrl.abort(), TOTAL_TIMEOUT - 2000);
  try {
    const res = await runTask({
      apiKey: _key, models: weakFirst(lists.fast), task: "word:tr", system: GEM_SYS, parts: [{ text }],
      spec: { levels: ["minimal", "low"], budget: 0 }, maxOut: isWord ? 800 : 3000,
      hedgeMs: 5000, firstMs: 12000, idleMs: 10000, signal: ctrl.signal,
    });
    const t = clean(res.text);
    if (!t || !HAS_AR.test(t)) throw new Error("empty");
    return t;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", link);
  }
}

async function translate(text, signal, isWord) {
  let freeErr = null;
  try { return await freeTranslate(text, signal); }
  catch (e) { if (e && e.name === "AbortError") throw e; freeErr = e; }
  try { return await geminiTranslate(text, signal, isWord); }
  catch (e) {
    if (e && e.name === "AbortError") { if (signal && signal.aborted) throw e; }
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    throw Object.assign(new Error(offline ? "مفيش اتصال بالنت." : "خدمات الترجمة مش بترد دلوقتي."), {
      detail: [freeErr && freeErr.detail, "gemini: " + ((e && e.message) || e)].filter(Boolean).join(" | "),
    });
  }
}

/* ── word ── */
export async function translateWord({ word, signal, onQuick }) {
  const key = word.toLowerCase();
  const hit = cachedMeaning(word);
  if (hit) { mem.set(key, hit); return hit; }          // next time: no localStorage parse at all
  const g = await translate(word, signal, true);
  if (g) { mem.set(key, g); writeCache(key, g); if (onQuick && !(signal && signal.aborted)) onQuick(g); }
  return g;
}

/* ── sentence (selected text) ── */
const LS_S = "clinix:str:v1";
const smem = new Map();
const sKey = (t) => t.toLowerCase().replace(/\s+/g, " ").trim();
function readS() { try { return JSON.parse(window.localStorage.getItem(LS_S)) || {}; } catch (e) { return {}; } }
function writeS(k, v) {
  try {
    const all = readS();
    delete all[k]; all[k] = v;                       // most recent last
    const keys = Object.keys(all);
    if (keys.length > 250) for (const old of keys.slice(0, keys.length - 250)) delete all[old];
    window.localStorage.setItem(LS_S, JSON.stringify(all));
  } catch (e) { /* ignore */ }
}
export const cachedSentence = (text) => { const k = sKey(text); return smem.get(k) || readS()[k] || ""; };

export const MAX_SENTENCE = 900;
export async function translateSentence({ text, signal }) {
  const k = sKey(text);
  const hit = cachedSentence(text);
  if (hit) { smem.set(k, hit); return hit; }
  const g = await translate(text.slice(0, MAX_SENTENCE), signal, false);
  if (g) { smem.set(k, g); writeS(k, g); }
  return g;
}
