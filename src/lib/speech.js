/* ───────────── Pronunciation (American English) ─────────────
   v3.40.10 — GOOGLE ONLY. The Gemini voice (and its voice switch in the settings) was removed: pronouncing a word must never spend a token or
   a request of the student's Gemini quota. Order of play:
     0. Cache (memory → IndexedDB): a word you have heard once is instant, also offline. Nothing is ever downloaded twice.
     1. Google US-English voice (translate_tts, tl=en-US): about 0.3 s per word, no key and no daily quota, the same General-American
        voice for every word and every phone. The words of a list are loaded quietly in the background (warm()), so a tap is usually instant.
     2. The phone's own voice, ONLY when it is a real en-US voice (a non-US voice is never used: no wrong accent, ever).

   Speed: in-flight requests are shared, playback speed is adjustable (pitch is kept), and a selected sentence is cut into
   short pieces that are fetched together and played one after the other.                                                       */

import { useSyncExternalStore } from "react";
import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { store, prefs } from "./storage.js";

const U_CACHE = "tts:us1:";            // Google US voice

/* ── what to say: English only (the Arabic gloss must never be read by the American voice) ── */
export function speakable(s) {
  return String(s || "")
    .replace(/\*\*/g, "")
    .replace(/[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]+/g, " ")
    .replace(/\(\s*[,;/\-–—]?\s*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* ── tiny external store so every speaker button knows if ITS word is loading / playing ── */
let current = { id: null, state: "idle" };
const subs = new Set();
const setState = (id, state) => { current = { id, state }; subs.forEach((f) => f()); };
const subscribe = (f) => { subs.add(f); return () => subs.delete(f); };
const snapshot = () => current;

export function useSpeechState(id) {
  const c = useSyncExternalStore(subscribe, snapshot, snapshot);
  return c.id === id ? c.state : "idle";
}

/* ── playback speed (shared by every speaker button, remembered between launches) ── */
export const SPEEDS = [0.5, 0.75, 1, 1.25];
let speed = (() => { const v = parseFloat(prefs.get("clinix:speed", "1")); return SPEEDS.includes(v) ? v : 1; })();
const speedSubs = new Set();
export const useSpeed = () =>
  useSyncExternalStore((f) => { speedSubs.add(f); return () => speedSubs.delete(f); }, () => speed, () => speed);

/* ── audio plumbing ── */
let ctx = null;
let src = null;      // AudioBufferSource (fallback player)
let el = null;       // <audio> element (main player: keeps the pitch when the speed changes)
let elUrl = null;
let token = 0;
const mem = new Map();
const inflight = new Map();

export function cycleSpeed() {
  speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
  prefs.set("clinix:speed", String(speed));
  try { if (el) { el.defaultPlaybackRate = speed; el.playbackRate = speed; } } catch (e) { /* ignore */ }
  try { if (src) src.playbackRate.value = speed; } catch (e) { /* ignore */ }
  speedSubs.forEach((f) => f());
}

function getCtx() {
  const AC = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
  if (!AC) return null;
  if (!ctx) { try { ctx = new AC(); } catch (e) { return null; } }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

/* the element is created inside the tap, so the browser lets it play later without asking again */
function getEl() {
  if (!el && typeof Audio === "function") { try { el = new Audio(); el.preload = "auto"; } catch (e) { el = null; } }
  return el;
}

function freeEl() {
  if (el) { el.onended = null; el.onerror = null; try { el.pause(); } catch (e) { /* ignore */ } }
  if (elUrl) { try { URL.revokeObjectURL(elUrl); } catch (e) { /* ignore */ } elUrl = null; }
}

export function stopSpeaking() {
  token += 1;
  freeEl();
  try { if (src) { src.onended = null; src.stop(); } } catch (e) { /* already stopped */ }
  src = null;
  try { if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel(); } catch (e) { /* ignore */ }
  setState(null, "idle");
}

/* ── byte helpers ── */
const bytesToB64 = (u8) => {
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
};
const b64ToUrl = (b64, type) => {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([u8], { type }));
};
/* a real MP3 starts with an "ID3" tag or an MPEG frame sync; an HTML error page / captcha never does */
const mp3Header = (u8) => (u8[0] === 0x49 && u8[1] === 0x44 && u8[2] === 0x33) || (u8[0] === 0xff && (u8[1] & 0xe0) === 0xe0);
const looksLikeMp3 = (u8) => u8.length > 200 && mp3Header(u8);
const b64LooksLikeMp3 = (b64) => { try { return b64.length > 270 && mp3Header(Uint8Array.from(atob(b64.slice(0, 16)), (c) => c.charCodeAt(0))); } catch (e) { return false; } };

/* ── 1 · Google US voice ──
   Several equivalent endpoints, tried in turn. tl=en-US pins the American voice.
   Android: the native HTTP client (WebView fetch is blocked by CORS there). Desktop: fetch (the app already allows this host). */
const G_URLS = [
  (q) => `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=en-US&q=${q}`,
  (q) => `https://translate.googleapis.com/translate_tts?ie=UTF-8&client=gtx&tl=en-US&q=${q}`,
  (q) => `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=en&q=${q}`,
];
const UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";

async function mp3Bytes(url, ms = 7000) {
  if (Capacitor.isNativePlatform()) {
    const r = await CapacitorHttp.request({ url, method: "GET", responseType: "blob", headers: { "User-Agent": UA, Referer: "https://translate.google.com/" }, connectTimeout: ms, readTimeout: ms });
    if (r.status < 200 || r.status >= 300) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
    const b64 = typeof r.data === "string" ? r.data.replace(/^data:[^,]*,/, "") : "";
    if (!b64LooksLikeMp3(b64)) throw new Error("not audio");
    return b64;
  }
  const ctl = new AbortController();
  const tm = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctl.signal, referrerPolicy: "no-referrer" });
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
    const u8 = new Uint8Array(await res.arrayBuffer());
    if (!looksLikeMp3(u8)) throw new Error("not audio");
    return bytesToB64(u8);
  } finally { clearTimeout(tm); }
}

/* Google reads at most ~200 characters per request → cut longer text at sentence / comma / space boundaries */
export function splitForTts(text, max = 180) {
  const out = [];
  let rest = String(text || "").trim();
  while (rest.length > max) {
    let cut = -1;
    for (const re of [/[.!?;:](?=\s)/g, /,(?=\s)/g, /\s/g]) {
      let m, best = -1;
      re.lastIndex = 0;
      while ((m = re.exec(rest)) && m.index < max) best = m.index + 1;
      if (best > max * 0.4) { cut = best; break; }
    }
    if (cut < 1) cut = max;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out.filter(Boolean);
}

let googleCool = 0;   // after repeated failures Google is skipped for a while, so a tap never waits for a dead endpoint
async function googlePart(q) {
  let last = new Error("google tts failed");
  for (const mk of G_URLS) {
    const url = mk(encodeURIComponent(q));
    try { return await mp3Bytes(url); }
    catch (e) {
      last = e;
      if (e && e.status === 429) break;                                  // blocked for now: the other hosts will say the same
      if (!Capacitor.isNativePlatform() && e instanceof TypeError) {     // plain browser: CORS blocks reading it, but an <audio> can still play the URL
        throw Object.assign(new Error("cors"), { code: "cors", url });
      }
    }
  }
  throw last;
}

async function fetchGoogle(text) {
  if (Date.now() < googleCool) throw new Error("google cooling down");
  const pieces = splitForTts(text);
  try {
    const parts = await Promise.all(pieces.map(googlePart));
    return { k: "mp3", parts };
  } catch (e) {
    if (e && e.code === "cors") return { k: "url", urls: pieces.map((p) => G_URLS[0](encodeURIComponent(p))) };
    googleCool = Date.now() + 45000;
    throw e;
  }
}

/* ── cache (IndexedDB): "M|part|part" = Google mp3 pieces ── */
async function cacheGet(text) {
  let v;
  try { v = await store.get(U_CACHE + text); } catch (e) { return null; }
  return v && typeof v === "string" && v.startsWith("M|") ? { k: "mp3", parts: v.slice(2).split("|") } : null;
}
function cachePut(text, item) {
  try {
    if (item.k === "mp3") Promise.resolve(store.set(U_CACHE + text, "M|" + item.parts.join("|"))).catch(() => {});
  } catch (e) { /* the cache is a bonus, never a reason to fail */ }
}

/* memory → IndexedDB → Google. One shared promise per text, so a tap on a word that is being warmed up just waits for that same request. */
function audioFor(text) {
  if (mem.has(text)) return Promise.resolve(mem.get(text));
  if (inflight.has(text)) return inflight.get(text);
  const p = (async () => {
    const hit = await cacheGet(text);
    if (hit) { mem.set(text, hit); return hit; }
    const item = await fetchGoogle(text);
    if (item.k !== "url") cachePut(text, item);
    mem.set(text, item);
    return item;
  })().finally(() => inflight.delete(text));
  inflight.set(text, p);
  return p;
}

/* Read-ahead. warm(list): the words of a list are loaded quietly in the background (2 at a time), so the tap is instant.
   Google voice has no quota; silent on every error; stops by itself when Google starts refusing. */
const warmQueue = [];
let warmRunning = 0;
function warmPump() {
  while (warmRunning < 2 && warmQueue.length) {
    const t = warmQueue.shift();
    if (mem.has(t) || inflight.has(t)) continue;
    warmRunning += 1;
    audioFor(t).catch(() => { if (Date.now() < googleCool) warmQueue.length = 0; })
      .finally(() => { warmRunning -= 1; setTimeout(warmPump, 120); });
  }
}
export function warm(list) {
  if (Date.now() < googleCool) return;
  const seen = new Set(warmQueue);
  (list || []).slice(0, 80).forEach((raw) => {
    const t = speakable(raw);
    if (t && t.length <= 60 && !mem.has(t) && !inflight.has(t) && !seen.has(t)) { seen.add(t); warmQueue.push(t); }
  });
  warmPump();
}
/* old name, kept for callers: a few words ahead */
export const prefetch = (list) => warm((list || []).slice(0, 3));

/* ── 3 · phone voice: only a REAL en-US voice, never anything else ── */
const MALE_NAME = /\b(david|mark|guy|alex|fred|aaron|ryan|christopher|eric|roger|brian|andrew|matthew|steffan|tom|daniel|james)\b|x-(iom|iol|tpd)\b|\bmale\b/i;

function pickVoice() {
  try {
    const all = window.speechSynthesis.getVoices() || [];
    const us = all.filter((v) => /^en[-_]US$/i.test(v.lang));
    if (all.length && !us.length) return "none";                        // the phone has voices, but none is American → say nothing rather than a wrong accent
    const label = (v) => `${v.name} ${v.voiceURI}`;
    return us.find((v) => MALE_NAME.test(label(v)) && !/female/i.test(label(v))) || us[0] || null;
  } catch (e) { return null; }
}

function systemSpeak(text, my, id) {
  if (typeof window === "undefined" || !("speechSynthesis" in window) || typeof window.SpeechSynthesisUtterance !== "function") return false;
  try {
    const v = pickVoice();
    if (v === "none") return false;
    const u = new window.SpeechSynthesisUtterance(text);
    u.lang = "en-US";
    if (v) u.voice = v;
    u.rate = 0.9 * speed;
    u.onend = u.onerror = () => { if (token === my) setState(null, "idle"); };
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
    setState(id, "play");
    return true;
  } catch (e) { return false; }
}

const fail = (msg) => {
  try { window.dispatchEvent(new CustomEvent("clinix:speech-error", { detail: msg })); } catch (e) { /* ignore */ }
};

const prep = (a) => {
  a.defaultPlaybackRate = speed;
  a.playbackRate = speed;
  for (const k of ["preservesPitch", "webkitPreservesPitch", "mozPreservesPitch"]) { try { a[k] = true; } catch (e) { /* ignore */ } }
};

/* mp3 pieces (Google) or plain URLs, one after the other */
async function playSequence(a, sources, my, id, isUrl) {
  if (!a) throw new Error("no audio element");
  let i = 0;
  const next = async () => {
    if (token !== my) return;
    if (i >= sources.length) { freeEl(); setState(null, "idle"); return; }
    const s = sources[i++];
    freeEl();
    if (isUrl) a.src = s; else { elUrl = b64ToUrl(s, "audio/mpeg"); a.src = elUrl; }
    prep(a);
    a.onended = next;
    a.onerror = () => { if (token === my) { freeEl(); setState(null, "idle"); } };
    await a.play();
    if (token === my) setState(id, "play");
  };
  await next();
}

/* mp3 through Web Audio (used when the <audio> element refuses to start, e.g. autoplay rules) */
async function playMp3Web(c, parts, my, id) {
  if (!c) throw new Error("no audio context");
  for (let i = 0; i < parts.length; i++) {
    if (token !== my) return;
    const bin = atob(parts[i]);
    const u8 = new Uint8Array(bin.length);
    for (let j = 0; j < bin.length; j++) u8[j] = bin.charCodeAt(j);
    const buf = await c.decodeAudioData(u8.buffer);
    if (token !== my) return;
    await new Promise((resolve) => {
      const s = c.createBufferSource();
      s.buffer = buf; s.playbackRate.value = speed; s.connect(c.destination); s.onended = resolve;
      src = s; s.start();
      if (i === 0) setState(id, "play");
    });
  }
  if (token === my) { src = null; setState(null, "idle"); }
}

async function playItem(a, c, item, my, id) {
  if (item.k === "url") return playSequence(a, item.urls, my, id, true);
  try { await playSequence(a, item.parts, my, id, false); }
  catch (e) { if (token !== my) return; freeEl(); await playMp3Web(c, item.parts, my, id); }
}

/* ── public: tap once = play, tap again while it plays = stop ── */
export async function speak(raw, id = raw) {
  const text = speakable(raw);
  if (!text) return;
  if (current.id === id && current.state !== "idle") { stopSpeaking(); return; }
  stopSpeaking();
  const my = ++token;
  const c = getCtx(); // must be created/resumed inside the tap, before any await
  const a = getEl();
  setState(id, "load");
  try {
    const item = await audioFor(text);
    if (my !== token) return;
    await playItem(a, c, item, my, id);
  } catch (e) {
    if (my !== token) return;
    freeEl();
    if (systemSpeak(text, my, id)) return;
    setState(null, "idle");
    fail("مقدرتش أجيب النطق الأمريكي دلوقتي. اتأكد من النت وجرّب تاني.");
  }
}
