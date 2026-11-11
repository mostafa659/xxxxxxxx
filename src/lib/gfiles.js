/* ───────────── Upload the material ONCE (v3.24) ─────────────
   Before: every request of an analysis carried the whole PDF / every page image inside its own body (base64, +33 %):
   ocr + words + 3 lesson parts = 5 uploads of up to 14 MB; with parallel slices it would have been 8 or 9. On a phone's upload
   speed that alone can cost half a minute before the model even starts.

   Now: files bigger than a few hundred KB are uploaded ONCE with Google's Files API (free, kept 48 h by Google), and every request
   refers to them by a short link ({ fileData: { fileUri } }). All requests of the analysis wait for that single upload.

   Safety net (this runs against Google's live API, so it must never be able to break an analysis):
   • any problem while uploading → that file is simply sent inline, exactly as before;
   • a request that Google refuses because of a file → the analysis switches to inline for good and repeats that request;
   • VITE_FILES_API=off turns it off completely.
   The functions that talk to the network are injectable, so the logic is tested without a network (see tests in the project notes). */

const ENV = (typeof import.meta !== "undefined" && import.meta.env) || {};
export const FILES_ENABLED = String(ENV.VITE_FILES_API || "on").toLowerCase() !== "off";

import { API_ORIGIN } from "./config.js";
const ORIGIN = API_ORIGIN;          // v3.32: Google itself, or your gateway (config.js) — one place decides
const MIN_B64 = 300 * 1024;          // below this a file is cheaper to send inline than to upload separately
const MIN_TOTAL_B64 = 900 * 1024;    // and if the whole source is small, nothing is uploaded at all
const ACTIVE_WAIT_MS = 20000;

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal && signal.aborted) return reject(Object.assign(new Error("abort"), { name: "AbortError" }));
  const t = setTimeout(resolve, ms);
  if (signal) signal.addEventListener("abort", () => { clearTimeout(t); reject(Object.assign(new Error("abort"), { name: "AbortError" })); }, { once: true });
});

const b64ToBlob = (b64, type) => {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Blob([u8], { type });
};

const keyOf = (mime, data) => `${mime}:${data.length}:${data.slice(0, 48)}:${data.slice(-48)}`;

/* the real network part: resumable upload exactly as in Google's documentation (start → upload + finalize → wait until ACTIVE) */
export async function uploadToGoogle({ apiKey, mimeType, data, name, signal, fetchImpl = fetch }) {
  const blob = b64ToBlob(data, mimeType);
  const start = await fetchImpl(`${ORIGIN}/upload/v1beta/files`, {
    method: "POST", signal,
    headers: {
      "x-goog-api-key": apiKey, "Content-Type": "application/json",
      "X-Goog-Upload-Protocol": "resumable", "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(blob.size), "X-Goog-Upload-Header-Content-Type": mimeType,
    },
    body: JSON.stringify({ file: { display_name: String(name || "material").slice(0, 100) } }),
  });
  if (!start.ok) throw Object.assign(new Error(`upload start HTTP ${start.status}`), { status: start.status });
  const url = start.headers.get("x-goog-upload-url");
  if (!url) throw new Error("no upload url");
  const up = await fetchImpl(url, {
    method: "POST", signal,
    headers: { "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize" },
    body: blob,
  });
  if (!up.ok) throw Object.assign(new Error(`upload HTTP ${up.status}`), { status: up.status });
  let file = (await up.json()).file;
  if (!file || !file.uri) throw new Error("upload: no file uri");
  const t0 = Date.now();
  while (file.state && file.state !== "ACTIVE") {
    if (file.state === "FAILED") throw new Error("file processing failed");
    if (Date.now() - t0 > ACTIVE_WAIT_MS) throw new Error("file not ready in time");
    await sleep(700, signal);
    const r = await fetchImpl(`${ORIGIN}/v1beta/${file.name}`, { headers: { "x-goog-api-key": apiKey }, signal });
    if (!r.ok) throw Object.assign(new Error(`file status HTTP ${r.status}`), { status: r.status });
    file = await r.json();
  }
  return { fileUri: file.uri, mimeType: file.mimeType || mimeType };
}

/* ── remembered uploads (v3.26) ──
   Google keeps an uploaded file for 48 h. The tutor chat used to send the whole PDF / every page image again with EVERY message
   (up to 14 MB each time). Now an upload is remembered (per key, 40 h) and every later request — chat turns included — just
   points at it. Anything wrong with a remembered link (expired, deleted) → Google refuses → the caller's existing
   "file error → send inline" fallback repeats the request, and the stale link is forgotten. */
const LS_UP = "clinix:gfiles:v1";
const UP_TTL = 40 * 3600e3;
const tagOf = (k) => String(k || "").slice(-8);
export const memoryStore = {
  load() { try { return JSON.parse(window.localStorage.getItem(LS_UP)) || {}; } catch (e) { return {}; } },
  save(m) { try { window.localStorage.setItem(LS_UP, JSON.stringify(m)); } catch (e) { /* ignore */ } },
};
const recall = (store, k, apiKey) => {
  const m = store.load(), r = m[k];
  return r && r.tag === tagOf(apiKey) && r.exp > Date.now() ? { fileUri: r.uri, mimeType: r.mime } : null;
};
const remember = (store, k, apiKey, f) => {
  const m = store.load(), now = Date.now();
  for (const key of Object.keys(m)) if (!(m[key].exp > now)) delete m[key];
  m[k] = { tag: tagOf(apiKey), uri: f.fileUri, mime: f.mimeType, exp: now + UP_TTL };
  const keys = Object.keys(m);
  if (keys.length > 24) keys.sort((a, b) => m[a].exp - m[b].exp).slice(0, keys.length - 24).forEach((x) => delete m[x]);
  store.save(m);
};
export const forgetUploads = (store = memoryStore) => store.save({});

/* one per analysis (persist:true → the uploads are remembered across requests and chat turns) */
export function createFileCache({ apiKey, upload = uploadToGoogle, enabled = FILES_ENABLED, persist = false, store = memoryStore }) {
  const ctl = new AbortController();
  const jobs = new Map();       // key → Promise<{ fileUri, mimeType } | null>
  let off = !enabled || !apiKey;
  let used = false;

  const bigParts = (parts) => parts.filter((p) => p && p.inlineData && p.inlineData.data && p.inlineData.data.length >= MIN_B64);
  const worthIt = (parts) => parts.reduce((n, p) => n + (p && p.inlineData && p.inlineData.data ? p.inlineData.data.length : 0), 0) >= MIN_TOTAL_B64;

  const job = (p, i) => {
    const k = keyOf(p.inlineData.mimeType, p.inlineData.data);
    if (!jobs.has(k)) {
      const known = persist ? recall(store, k, apiKey) : null;
      if (known) jobs.set(k, Promise.resolve(known));
      else jobs.set(k, upload({ apiKey, mimeType: p.inlineData.mimeType, data: p.inlineData.data, name: `material-${i + 1}`, signal: ctl.signal })
        .then((f) => { if (persist && f) remember(store, k, apiKey, f); return f; })
        .catch(() => null));   // any failure → null → that file stays inline
    }
    return { k, promise: jobs.get(k) };
  };

  return {
    /* parts → the same parts, with the big files replaced by links (or unchanged when that is not possible) */
    async swap(parts, signal) {
      if (off || !worthIt(parts)) return parts;
      const big = bigParts(parts);
      if (!big.length) return parts;
      const started = big.map((p, i) => ({ p, ...job(p, i) }));
      const wait = Promise.all(started.map((s) => s.promise));
      const aborted = new Promise((_, rej) => { if (signal) { if (signal.aborted) rej(Object.assign(new Error("abort"), { name: "AbortError" })); signal.addEventListener("abort", () => rej(Object.assign(new Error("abort"), { name: "AbortError" })), { once: true }); } });
      const done = await Promise.race([wait, aborted]);
      if (off) return parts;
      const byKey = new Map(started.map((s, i) => [s.k, done[i]]));
      return parts.map((p) => {
        if (!(p && p.inlineData && p.inlineData.data)) return p;
        const r = byKey.get(keyOf(p.inlineData.mimeType, p.inlineData.data));
        if (!r) return p;
        used = true;
        return { fileData: { mimeType: r.mimeType, fileUri: r.fileUri } };
      });
    },
    get used() { return used; },
    /* Google refused a request because of a file: from now on everything is inline */
    disable() { off = true; if (persist) forgetUploads(store); },
    cancel() { ctl.abort(); },
  };
}

/* does this error look like "Google could not use the file I referred to"? */
export const looksLikeFileError = (e) => /\bfile(s)?\b|fileUri|file_uri|files\//i.test(`${(e && e.message) || ""} ${(e && e.detail) || ""}`)
  && !/quota|rate|busy|overload|exhausted|timeout|مفيش اتصال/i.test(`${(e && e.message) || ""} ${(e && e.detail) || ""}`);
