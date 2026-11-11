/* ───────────── Storage ─────────────
   IndexedDB (big quota, good for images) with a localStorage fallback.
   `loadBoot()` reads everything the first screen needs in ONE transaction so the
   app can render its final UI on the very first paint (no spinner, no layout jump). */

import { shapeTopics } from "./topics.js";

/* v3.27 — the app was renamed (NCLEX-RN → ClinixStudy): the database and every key got the new name.
   Whatever the student saved under the old names is copied over ONCE, the first time the new database opens (the old one is left untouched). */
const DB_NAME = "clinix-study", OLD_DB = "nclex-rn", MIGRATED = "clinix:idb-migrated";
const renameKey = (k) => (typeof k === "string" && k.startsWith("nclex:") ? `clinix:${k.slice(6)}` : k);

function readLegacyDb() {
  return new Promise((resolve) => {
    try {
      const r = indexedDB.open(OLD_DB);
      r.onerror = () => resolve(null);
      r.onblocked = () => resolve(null);
      r.onsuccess = () => {
        const old = r.result;
        if (!old.objectStoreNames.contains("kv")) { old.close(); return resolve(null); }
        const tx = old.transaction("kv", "readonly");
        const st = tx.objectStore("kv");
        const keys = st.getAllKeys(), vals = st.getAll();
        tx.oncomplete = () => { old.close(); resolve({ keys: keys.result, vals: vals.result }); };
        tx.onerror = tx.onabort = () => { old.close(); resolve(null); };
      };
    } catch (e) { resolve(null); }
  });
}

async function migrateLegacyDb(db) {
  try { if (window.localStorage.getItem(MIGRATED)) return; } catch (e) { /* no localStorage: just try */ }
  try {
    if (typeof indexedDB.databases === "function") {
      const list = await indexedDB.databases();
      if (!list.some((d) => d.name === OLD_DB)) { try { window.localStorage.setItem(MIGRATED, "1"); } catch (e) { /* ignore */ } return; }
    }
    const old = await readLegacyDb();
    if (!old || !old.keys.length) return;
    await new Promise((resolve) => {
      const tx = db.transaction("kv", "readwrite");
      const st = tx.objectStore("kv");
      const have = st.getAllKeys();
      have.onsuccess = () => {
        const set = new Set(have.result);
        old.keys.forEach((k, i) => { const nk = renameKey(k); if (!set.has(nk)) st.put(old.vals[i], nk); });   // never overwrites something already saved under the new name
      };
      tx.oncomplete = resolve; tx.onerror = resolve; tx.onabort = resolve;
    });
    try { window.localStorage.setItem(MIGRATED, "1"); } catch (e) { /* ignore */ }
  } catch (e) { /* the old data stays where it is; the app starts with the new database */ }
}

let _dbp = null;
const openDb = () => {
  if (!_dbp) {
    _dbp = new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") return reject(new Error("no idb"));
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onsuccess = () => { const db = r.result; migrateLegacyDb(db).then(() => resolve(db), () => resolve(db)); };
      r.onerror = () => reject(r.error);
    });
  }
  return _dbp;
};

const idbRun = async (mode, fn) => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("kv", mode);
    const req = fn(tx.objectStore("kv"));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
};

export const store = {
  async get(key) {
    try {
      const v = await idbRun("readonly", (s) => s.get(key));
      return v === undefined ? null : v;
    } catch (e) {
      try { const v = window.localStorage.getItem(key); return v ? JSON.parse(v) : null; }
      catch (e2) { return null; }
    }
  },
  async set(key, value) {
    try { await idbRun("readwrite", (s) => s.put(value, key)); return true; }
    catch (e) {
      try { window.localStorage.setItem(key, JSON.stringify(value)); return true; }
      catch (e2) { return false; }
    }
  },
  async del(key) {
    try { await idbRun("readwrite", (s) => s.delete(key)); }
    catch (e) { try { window.localStorage.removeItem(key); } catch (e2) { /* ignore */ } }
  },
};

const BOOT_KEYS = ["clinix:questions", "clinix:words", "clinix:apikey", "clinix:mode", "clinix:goal", "clinix:perf", "clinix:topics", "clinix:vocab", "clinix:mistakes"];

export async function loadBoot() {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("kv", "readonly");
      const st = tx.objectStore("kv");
      const out = {};
      BOOT_KEYS.forEach((k) => {
        const r = st.get(k);
        r.onsuccess = () => { out[k] = r.result === undefined ? null : r.result; };
      });
      tx.oncomplete = () => resolve(shape(out));
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch (e) {
    const out = {};
    for (const k of BOOT_KEYS) out[k] = await store.get(k);
    return shape(out);
  }
}

function shape(o) {
  return {
    questions: Array.isArray(o["clinix:questions"]) ? o["clinix:questions"] : [],
    words: Array.isArray(o["clinix:words"]) ? o["clinix:words"] : [],
    apiKey: typeof o["clinix:apikey"] === "string" ? o["clinix:apikey"].trim() : "",
    mode: typeof o["clinix:mode"] === "string" ? o["clinix:mode"] : null,
    goal: Number.isFinite(o["clinix:goal"]) ? o["clinix:goal"] : 5,
    topics: shapeTopics(o["clinix:topics"]),
    mistakes: Array.isArray(o["clinix:mistakes"]) ? o["clinix:mistakes"] : [],
    vocab: o["clinix:vocab"] && typeof o["clinix:vocab"] === "object" ? o["clinix:vocab"] : {},
    perf: o["clinix:perf"] && typeof o["clinix:perf"] === "object" ? o["clinix:perf"] : {},
  };
}

/* Tiny synchronous prefs (theme) — localStorage so it can be read before first paint. */
export const prefs = {
  get(k, d = null) { try { const v = window.localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
  set(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
};
