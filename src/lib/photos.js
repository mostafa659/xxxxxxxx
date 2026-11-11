/* ───────────── Smart photos for chat answers (v3.29) ─────────────
   The text answer is NEVER delayed: it is delivered first, and everything here runs in the background afterwards.

     1. cache      the same question was answered with photos before → its saved links are shown at once (no request at all)
     2. gate       a cheap local check (the answer is long enough to be worth illustrating)
     3. need check ONE tiny Gemini request decides whether the answer really needs pictures (an organism, an organ, a procedure,
                   a map, a historical figure …) and, if so, writes up to 5 DIFFERENT image queries. Philosophy, opinions, rules,
                   calculations, study advice → "no photos", and nothing else happens.
     4. search     every shot is searched in all configured sources AT THE SAME TIME (Google · Unsplash · Pexels); the best photo
                   of each shot appears the moment it is ready
     5. unique     at most 5 photos; the same picture (same file / same id) or the same scene (near-identical title) is never shown twice
     6. save       the chosen links are written to the database, so a repeated question costs nothing

   Licences: Google results are filtered with rights=cc_publicdomain,cc_attribute,cc_sharealike (+ SafeSearch); Unsplash and Pexels
   photos are free to use under their own licences. Every photo carries its credit (photographer / site) and a link to the original page. */

import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { store, prefs } from "./storage.js";
import { getModelLists, runTask } from "./gemini.js";
import { weakFirst } from "./router.js";

export const MAX_PHOTOS = 5;
export const RIGHTS = "cc_publicdomain,cc_attribute,cc_sharealike";
const PER_SOURCE = 6;                 // candidates asked from every source for one shot
const SEARCH_MS = 6500;               // one request never takes longer than this
const GRACE_MS = 1400;                // how long a shot waits for its preferred source before it takes what is already there
const TTL_YES = 30 * 864e5, TTL_NO = 7 * 864e5, CACHE_MAX = 250;
const GOOGLE_DAILY = 90;              // Google's free plan is 100 searches a day: stop a little before it

/* ───────── settings ───────── */

const K_ON = "clinix:photos:on", K_KEYS = "clinix:photos:keys", K_GQ = "clinix:photos:gq";
export const photosOn = () => prefs.get(K_ON, "0") === "1";
export const setPhotosOn = (v) => prefs.set(K_ON, v ? "1" : "0");

const EMPTY_KEYS = { google: "", cx: "", unsplash: "", pexels: "" };
export function getPhotoKeys() {
  try { return { ...EMPTY_KEYS, ...(JSON.parse(prefs.get(K_KEYS, "{}")) || {}) }; } catch (e) { return { ...EMPTY_KEYS }; }
}
export function setPhotoKeys(k) {
  const clean = {};
  for (const f of Object.keys(EMPTY_KEYS)) clean[f] = String((k && k[f]) || "").trim();
  prefs.set(K_KEYS, JSON.stringify(clean));
}
/* which sources can be used right now */
export function configuredSources(keys = getPhotoKeys()) {
  const out = [];
  if (keys.google && keys.cx) out.push("google");
  if (keys.unsplash) out.push("unsplash");
  if (keys.pexels) out.push("pexels");
  return out;
}

/* ───────── small text tools ───────── */

const STOP = new Set("the and for with from this that what how why are was were its into onto over under of in on at to by an a or is".split(" "));
const words = (s) => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
/* 0..1: how much of the two texts is the same words (Jaccard) */
export function similar(a, b) {
  const A = new Set(words(a)), B = new Set(words(b));
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return n / (A.size + B.size - n);
}
const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); };

/* one file = one key, whatever size / tracking parameters the link carries */
export function urlKey(u) {
  try {
    const x = new URL(u);
    return x.hostname.replace(/^www\./, "").toLowerCase() + x.pathname.toLowerCase().replace(/-\d{2,4}x\d{2,4}(?=\.)/, "");
  } catch (e) { return String(u || "").toLowerCase(); }
}
const httpsOnly = (u) => (/^https:\/\//i.test(u || "") ? u : "");
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return ""; } };
const abortErr = () => Object.assign(new Error("aborted"), { name: "AbortError" });

/* ───────── HTTP (WebView fetch first, the native client on Android as a fallback) ───────── */

async function getJson(url, { headers = {}, signal, ms = SEARCH_MS } = {}) {
  const ctrl = new AbortController();
  const link = () => ctrl.abort();
  if (signal) { if (signal.aborted) throw abortErr(); signal.addEventListener("abort", link); }
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    try {
      const r = await fetch(url, { headers, signal: ctrl.signal });
      const body = await r.json().catch(() => null);
      if (!r.ok) throw Object.assign(new Error("HTTP " + r.status), { status: r.status });
      return body;
    } catch (e) {
      if (e && e.status) throw e;
      if (signal && signal.aborted) throw abortErr();
      if (!Capacitor.isNativePlatform() || ctrl.signal.aborted) throw e;
    }
    const n = await CapacitorHttp.get({ url, headers, readTimeout: ms, connectTimeout: 5000 });
    if (n.status < 200 || n.status >= 300) throw Object.assign(new Error("HTTP " + n.status), { status: n.status });
    return typeof n.data === "string" ? JSON.parse(n.data) : n.data;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", link);
  }
}

/* ───────── the three sources → one common shape ─────────
   { id, src, key, url (big), thumb (fast, shown in the chat), page (original page), credit, creditUrl, title, w, h } */

const today = () => new Date().toISOString().slice(0, 10);
const gUsed = () => { try { const o = JSON.parse(prefs.get(K_GQ, "{}")); return o.d === today() ? o.n | 0 : 0; } catch (e) { return 0; } };
const gSpend = (n = 1) => prefs.set(K_GQ, JSON.stringify({ d: today(), n: gUsed() + n }));
let googleDownUntil = 0;           // a wrong key / cx is retried only every 10 minutes

export function mapGoogle(d) {
  return ((d && d.items) || []).map((it) => {
    const img = it.image || {};
    const url = httpsOnly(it.link), thumb = httpsOnly(img.thumbnailLink) || url;
    if (!url || !thumb) return null;
    const page = httpsOnly(img.contextLink) || url;
    return { id: "g:" + urlKey(url), src: "google", key: urlKey(url), url, thumb, page, credit: it.displayLink || hostOf(page), creditUrl: page, title: String(it.title || it.snippet || ""), w: img.width | 0, h: img.height | 0 };
  }).filter(Boolean);
}
export function mapUnsplash(d) {
  const utm = "utm_source=clinixstudy&utm_medium=referral";
  return ((d && d.results) || []).map((p) => {
    const u = p.urls || {};
    const thumb = httpsOnly(u.small || u.regular), url = httpsOnly(u.regular || u.small);
    if (!thumb) return null;
    const user = p.user || {};
    const userUrl = ((user.links && user.links.html) || "https://unsplash.com") + (((user.links && user.links.html) || "").includes("?") ? "&" : "?") + utm;
    const page = ((p.links && p.links.html) || "https://unsplash.com") + "?" + utm;
    return { id: "u:" + p.id, src: "unsplash", key: "unsplash:" + p.id, url, thumb, page, credit: `${user.name || "Unsplash"} · Unsplash`, creditUrl: userUrl, title: String(p.alt_description || p.description || ""), w: p.width | 0, h: p.height | 0 };
  }).filter(Boolean);
}
export function mapPexels(d) {
  return ((d && d.photos) || []).map((p) => {
    const s = p.src || {};
    const thumb = httpsOnly(s.medium || s.large), url = httpsOnly(s.large2x || s.large || s.medium);
    if (!thumb) return null;
    return { id: "p:" + p.id, src: "pexels", key: "pexels:" + p.id, url, thumb, page: httpsOnly(p.url) || "https://www.pexels.com", credit: `${p.photographer || "Pexels"} · Pexels`, creditUrl: httpsOnly(p.photographer_url) || httpsOnly(p.url) || "https://www.pexels.com", title: String(p.alt || ""), w: p.width | 0, h: p.height | 0 };
  }).filter(Boolean);
}

const SEARCH = {
  async google(q, keys, signal) {
    if (Date.now() < googleDownUntil) throw new Error("google paused");
    if (gUsed() >= GOOGLE_DAILY) throw new Error("google daily limit");
    const u = new URL("https://customsearch.googleapis.com/customsearch/v1");
    const p = { key: keys.google, cx: keys.cx, q, searchType: "image", num: String(PER_SOURCE), rights: RIGHTS, safe: "active", imgSize: "medium" };
    Object.entries(p).forEach(([k, v]) => u.searchParams.set(k, v));
    gSpend();
    try { return mapGoogle(await getJson(u.toString(), { signal })); }
    catch (e) {
      if (e && e.status === 429) gSpend(999);                                   // the day's free searches are over
      else if (e && (e.status === 400 || e.status === 403)) googleDownUntil = Date.now() + 10 * 60 * 1000;
      throw e;
    }
  },
  async unsplash(q, keys, signal) {
    const u = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(q)}&per_page=${PER_SOURCE}&orientation=landscape&content_filter=high`;
    return mapUnsplash(await getJson(u, { headers: { Authorization: `Client-ID ${keys.unsplash}`, "Accept-Version": "v1" }, signal }));
  },
  async pexels(q, keys, signal) {
    const u = `https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=${PER_SOURCE}&orientation=landscape`;
    return mapPexels(await getJson(u, { headers: { Authorization: keys.pexels }, signal }));
  },
};

/* where a shot is searched. Diagrams, anatomy, ECG strips, maps … are almost never found on stock sites, so they go to Google
   (when it is configured); real-world photos go to every source. Preference order = the order of the list. */
export function sourcesFor(kind, configured) {
  if (kind === "photo") { const pri = ["unsplash", "pexels", "google"]; return pri.filter((s) => configured.includes(s)); }
  if (configured.includes("google")) return ["google"];
  return ["pexels", "unsplash"].filter((s) => configured.includes(s));
}

/* ───────── picking: unique photos, each one shown as soon as its shot is ready ───────── */

const trim = ({ id, src, key, url, thumb, page, credit, creditUrl, title }) => ({ id, src, key, url, thumb, page, credit, creditUrl, title });

export function createPicker(shots, configured, onUpdate) {
  const n = shots.length;
  const slots = Array(n).fill(null), done = Array(n).fill(false), graced = Array(n).fill(false);
  const lists = shots.map((s) => sourcesFor(s.kind, configured));
  const got = shots.map(() => ({}));          // source → candidates (an empty list when the source failed)
  const taken = [];

  const fresh = (it) => !taken.some((t) => t.key === it.key
    || (words(t.title).length >= 3 && words(it.title).length >= 3 && similar(t.title, it.title) >= 0.5)       // the same scene
    || (t.src === it.src && t.creditUrl === it.creditUrl && similar(t.title, it.title) >= 0.3));              // same photographer, same subject
  const emit = () => onUpdate && onUpdate(slots.filter(Boolean));

  function evaluate(i) {
    if (done[i]) return;
    const pri = lists[i];
    let pick = null;
    for (const s of pri) {
      if (!(s in got[i])) { if (!graced[i]) return; continue; }               // the preferred source has not answered yet → wait (until the grace is over)
      const ok = got[i][s].filter(fresh);
      if (ok.length) { pick = ok[0]; break; }
    }
    if (!pick) { if (pri.every((s) => s in got[i])) done[i] = true; return; }
    const alts = [];
    for (const s of pri) for (const c of got[i][s] || []) if (c !== pick && c.key !== pick.key && fresh(c) && alts.length < 2 && !alts.some((a) => a.key === c.key)) alts.push(trim(c));
    taken.push(pick);
    slots[i] = { ...trim(pick), why: shots[i].why, alts };
    done[i] = true;
    emit();
  }
  return {
    record(i, source, items) { got[i][source] = items || []; evaluate(i); },
    grace(i) { graced[i] = true; evaluate(i); },
    finish() { for (let i = 0; i < n; i++) { graced[i] = true; evaluate(i); } return slots.filter(Boolean); },
    sources: lists,
  };
}

/* run all searches at once */
export async function searchShots({ shots, keys, configured, signal, onUpdate }) {
  const picker = createPicker(shots, configured, onUpdate);
  const timers = shots.map((_, i) => setTimeout(() => picker.grace(i), GRACE_MS));
  try {
    const jobs = [];
    shots.forEach((shot, i) => {
      picker.sources[i].forEach((s) => jobs.push(
        SEARCH[s](shot.q, keys, signal).then((list) => picker.record(i, s, list), () => picker.record(i, s, [])),
      ));
    });
    await Promise.all(jobs);
    if (signal && signal.aborted) throw abortErr();
    return picker.finish();
  } finally { timers.forEach(clearTimeout); }
}

/* ───────── the "do the pictures help?" decision (one small Gemini request) ───────── */

const NEED_SYS = `You decide whether a chat answer given to a student needs PICTURES, and if it does you write the image searches.
Reply with ONE JSON object and nothing else:
{"need": true|false, "shots": [{"q": "...", "kind": "diagram"|"photo", "why": "..."}]}

need = true ONLY when a picture would truly help the student understand a concrete visual subject: an organ / anatomy / cell, an organism, a skin or wound sign, an ECG strip or rhythm, medical equipment or the steps of a procedure, a lab or science experiment, a map, a historical person / place / artifact, a landscape or species.
need = false for: philosophy, opinions, definitions that have no visual form, calculations, drug doses, priority / decision rules, test-taking or study advice, lists of rules, small talk, or anything the text already explains fully. When in doubt: false.

shots: 1 to ${MAX_PHOTOS} (fewer is better). Every shot shows a DIFFERENT aspect, never two near-identical pictures (do not ask for "heart anatomy" and "heart diagram").
- q: a precise image-search query of 2–7 English words (a concrete noun phrase, no brand names, no person names unless the answer is about that historical figure).
- kind: "diagram" for diagrams / anatomy / ECG / charts / maps / procedures; "photo" for real-world photographs (animals, plants, places, equipment, people in history).
- why: at most 8 Arabic words saying what this picture shows.
If need is false, shots must be [].`;

const cleanQ = (q) => String(q || "").replace(/[^\p{L}\p{N}\s'-]+/gu, " ").replace(/\s+/g, " ").trim();

/* model text → { need, shots }  (never throws; garbage → no photos) */
export function parseShots(text) {
  const t = String(text || "");
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b <= a) return { need: false, shots: [] };
  let j;
  try { j = JSON.parse(t.slice(a, b + 1)); } catch (e) { return { need: false, shots: [] }; }
  if (!j || j.need !== true || !Array.isArray(j.shots)) return { need: false, shots: [] };
  const shots = [];
  for (const s of j.shots) {
    const q = cleanQ(s && s.q);
    if (q.length < 3 || q.length > 70) continue;
    if (shots.some((x) => similar(x.q, q) >= 0.6)) continue;                       // two queries for the same thing
    shots.push({ q, kind: s.kind === "photo" ? "photo" : "diagram", why: String(s.why || "").trim().slice(0, 60) });
    if (shots.length >= MAX_PHOTOS) break;
  }
  return { need: shots.length > 0, shots };
}

async function decideNeed({ apiKey, question, answer, ctxHint, signal }) {
  const lists = getModelLists(apiKey);
  const text = `${ctxHint ? `CONTEXT (the saved question the student is studying): ${ctxHint}\n` : ""}STUDENT: ${String(question).slice(0, 600)}\nANSWER:\n${String(answer).slice(0, 1800)}`;
  const res = await runTask({
    apiKey, models: weakFirst(lists.fast), task: "photos:need", hedgeClass: "quick", system: NEED_SYS, parts: [{ text }],
    spec: { levels: ["minimal", "low"], budget: 0 }, maxOut: 500, firstMs: 12000, idleMs: 10000, signal,
  });
  return parseShots(res.text);
}

/* ───────── the database: question → chosen photos ───────── */

const norm = (s) => words(s).join(" ").slice(0, 220);
export const cacheKey = (question, ctxHint = "") => `clinix:photos:c:${hash(norm(question) + "|" + norm(ctxHint).slice(0, 80))}`;
const K_IDX = "clinix:photos:idx";

async function readCache(key) {
  try {
    const r = await store.get(key);
    if (!r || r.v !== 1) return null;
    if (Date.now() - (r.at || 0) > (r.need ? TTL_YES : TTL_NO)) return null;
    return r;
  } catch (e) { return null; }
}
async function writeCache(key, rec) {
  try {
    await store.set(key, { v: 1, at: Date.now(), ...rec });
    let idx = (await store.get(K_IDX)) || [];
    idx = [key, ...idx.filter((k) => k !== key)];
    for (const old of idx.slice(CACHE_MAX)) await store.del(old);
    await store.set(K_IDX, idx.slice(0, CACHE_MAX));
  } catch (e) { /* the cache is only a speed-up */ }
}

/* an answer worth illustrating is not a one-liner */
export const worthAsking = (question, answer) => String(answer || "").trim().length >= 160 && String(question || "").trim().length >= 4;

/* ───────── the one entry point ─────────
   fetchPhotos({ apiKey, question, answer, ctxHint, signal, onStart(total), onUpdate(items, { final }) })
   → { status: "done" | "none" | "nokeys", items, cached? }                                                        */
export async function fetchPhotos({ apiKey, question, answer, ctxHint = "", signal, onStart, onUpdate }) {
  const keys = getPhotoKeys();
  const configured = configuredSources(keys);
  if (!configured.length) return { status: "nokeys", items: [] };

  const ck = cacheKey(question, ctxHint);
  const hit = await readCache(ck);
  if (hit) {
    if (hit.need && hit.items && hit.items.length) { onUpdate && onUpdate(hit.items, { final: true }); return { status: "done", items: hit.items, cached: true }; }
    if (!hit.need) return { status: "none", items: [] };
  }
  if (!worthAsking(question, answer)) return { status: "none", items: [] };
  if (!apiKey) return { status: "none", items: [] };

  const d = await decideNeed({ apiKey, question, answer, ctxHint, signal });
  if (!d.need) { await writeCache(ck, { need: false }); return { status: "none", items: [] }; }

  onStart && onStart(d.shots.length);
  const items = await searchShots({ shots: d.shots, keys, configured, signal, onUpdate: (list) => onUpdate && onUpdate(list, { final: false }) });
  if (items.length) { await writeCache(ck, { need: true, items }); return { status: "done", items }; }
  return { status: "none", items: [] };
}
