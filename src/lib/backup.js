/* ───────────── Backup / restore ─────────────
   Everything lives on this device only (IndexedDB). One tap saves it all to a JSON file; one tap brings it back.
   The API key is NEVER included.

   v3.31 — WHY «النسخ الاحتياطي لا يعمل»:
   the old code made the file with <a download href="blob:…">. The Android app's WebView has no download handler, so on the phone the
   tap did NOTHING (and the app still said "saved ✅"). Now:
     • phone app  → the file is written with @capacitor/filesystem (in small pieces) and handed to the system share sheet
                    (@capacitor/share): the student picks Drive / Files / WhatsApp / Telegram … and it is really saved;
     • mobile browser → Web Share with the file;   • computer / Electron → the normal download.
   Each step falls back to the next one, and the message tells the truth (a cancelled share sheet is not "saved").
   v3.31 also puts the mistakes («غلطاتي») and the image gallery into the file, and restores topics (they used to be dropped). */
import { Capacitor } from "@capacitor/core";
import { store, prefs } from "./storage.js";
import { convKeys } from "./chathist.js";
import { mergeTopics } from "./topics.js";
import { mergeMistakes } from "./mistakes.js";

const BASE = ["clinix:questions", "clinix:words", "clinix:mode", "clinix:goal", "clinix:topics", "clinix:vocab", "clinix:mistakes", "clinix:chat:global", "clinix:imgbank:index"];
export const LAST_KEY = "clinix:lastBackup";

export async function buildBackup() {
  const data = {};
  for (const k of [...BASE, ...(await convKeys("clinix:chat:global"))]) { const v = await store.get(k); if (v !== null) data[k] = v; }
  const qs = Array.isArray(data["clinix:questions"]) ? data["clinix:questions"] : [];
  for (const q of qs) {
    for (const k of [`clinix:img:${q.id}`, `clinix:chat:${q.id}`, ...(await convKeys(`clinix:chat:${q.id}`))]) { const v = await store.get(k); if (v !== null) data[k] = v; }
  }
  const gallery = Array.isArray(data["clinix:imgbank:index"]) ? data["clinix:imgbank:index"] : [];
  for (const e of gallery) { if (!e || !e.id) continue; const k = `clinix:imgbank:img:${e.id}`; const v = await store.get(k); if (v !== null) data[k] = v; }
  const mistakes = Array.isArray(data["clinix:mistakes"]) ? data["clinix:mistakes"].length : 0;
  return { app: "clinixstudy", version: 2, savedAt: Date.now(), count: qs.length, mistakes, data };
}

export const backupName = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, "0");
  return `clinixstudy-backup-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
};

/* cut a string into pieces without splitting a surrogate pair (an emoji cut in half would corrupt the file) */
export function chunkText(text, size) {
  const out = [];
  for (let i = 0; i < text.length;) {
    let end = Math.min(text.length, i + size);
    if (end < text.length) { const c = text.charCodeAt(end - 1); if (c >= 0xd800 && c <= 0xdbff) end -= 1; }
    out.push(text.slice(i, end));
    i = end;
  }
  return out;
}

const isCancel = (e) => /cancel|abort|dismiss/i.test(String((e && (e.message || e.name || e)) || ""));

/* phone app: write the file in the cache folder (piece by piece) and open the share sheet */
async function saveNative(name, text) {
  const { Filesystem, Directory, Encoding } = await import("@capacitor/filesystem");
  const { Share } = await import("@capacitor/share");
  const parts = chunkText(text, 400 * 1024);
  await Filesystem.writeFile({ path: name, data: parts[0] || "", directory: Directory.Cache, encoding: Encoding.UTF8 });
  for (let i = 1; i < parts.length; i++) await Filesystem.appendFile({ path: name, data: parts[i], directory: Directory.Cache, encoding: Encoding.UTF8 });
  const { uri } = await Filesystem.getUri({ path: name, directory: Directory.Cache });
  await Share.share({ title: "نسخة ClinixStudy الاحتياطية", url: uri, dialogTitle: "احفظ النسخة الاحتياطية" });
}

async function saveWebShare(name, blob) {
  const file = new File([blob], name, { type: "application/json" });
  if (!(navigator.canShare && navigator.canShare({ files: [file] }))) throw new Error("no web share");
  await navigator.share({ files: [file], title: "نسخة ClinixStudy الاحتياطية" });
}

function saveAnchor(name, blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

/* → { count, mistakes, bytes, how: "share" | "download", cancelled? } */
export async function downloadBackup() {
  const b = await buildBackup();
  const text = JSON.stringify(b);
  const name = backupName();
  const info = { count: b.count, mistakes: b.mistakes, bytes: text.length };
  const mobileUa = /Android|iPhone|iPad/i.test((typeof navigator !== "undefined" && navigator.userAgent) || "");
  let native = false;
  try { native = !!Capacitor.isNativePlatform(); } catch (e) { native = false; }

  if (native) {
    try { await saveNative(name, text); prefs.set(LAST_KEY, String(Date.now())); return { ...info, how: "share" }; }
    catch (e) { if (isCancel(e)) return { ...info, how: "share", cancelled: true }; /* otherwise try the next way */ }
  }
  const blob = new Blob([text], { type: "application/json" });
  if (mobileUa) {
    try { await saveWebShare(name, blob); prefs.set(LAST_KEY, String(Date.now())); return { ...info, how: "share" }; }
    catch (e) { if (isCancel(e)) return { ...info, how: "share", cancelled: true }; }
  }
  saveAnchor(name, blob);
  prefs.set(LAST_KEY, String(Date.now()));
  return { ...info, how: "download" };
}

const readText = (file) => (file && typeof file.text === "function" ? file.text() : new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result || ""));
  r.onerror = () => reject(r.error || new Error("read"));
  r.readAsText(file);
}));

/* merge: questions are matched by id (the newer one wins); words / topics / vocab / mistakes / gallery are merged too */
export async function restoreBackup(file) {
  let b;
  try { b = JSON.parse(await readText(file)); } catch (e) { throw new Error("الملف مش نسخة احتياطية صالحة."); }
  /* backups made before the rename say "nclex-rn" and use "nclex:…" keys: they are accepted and their keys are moved to the new names */
  if (!b || !["clinixstudy", "nclex-rn"].includes(b.app) || !b.data || typeof b.data !== "object") throw new Error("الملف مش نسخة احتياطية صالحة.");
  const d = {};
  for (const [k, v] of Object.entries(b.data)) d[k.replace(/^nclex:/, "clinix:")] = v;
  const cur = (await store.get("clinix:questions")) || [];
  const map = new Map(cur.map((q) => [q.id, q]));
  let added = 0;
  for (const q of d["clinix:questions"] || []) {
    const old = map.get(q.id);
    if (!old) added += 1;
    if (!old || (q.updatedAt || 0) >= (old.updatedAt || 0)) map.set(q.id, q);
  }
  const merged = [...map.values()].sort((a, c) => (c.updatedAt || 0) - (a.updatedAt || 0));
  if (!(await store.set("clinix:questions", merged))) throw new Error("التخزين على الجهاز ممتلئ، ما قدرتش أرجّع النسخة.");
  let mistakesAdded = 0;
  for (const [k, v] of Object.entries(d)) {
    if (k === "clinix:questions" || k === "clinix:apikey") continue;
    if (k === "clinix:vocab") { await store.set(k, { ...(v || {}), ...((await store.get(k)) || {}) }); continue; }
    if (k === "clinix:words") { const w = (await store.get(k)) || []; const ids = new Set(w.map((x) => x.id || x.qid)); await store.set(k, [...w, ...(v || []).filter((x) => !ids.has(x.id || x.qid))]); continue; }
    if (k === "clinix:topics") { await store.set(k, mergeTopics(await store.get(k), v, new Set(map.keys()))); continue; }
    if (k === "clinix:mistakes") {
      const have = (await store.get(k)) || [];
      const next = mergeMistakes(have, v);
      mistakesAdded = Math.max(0, next.length - (Array.isArray(have) ? have.length : 0));
      await store.set(k, next);
      continue;
    }
    if ((k.startsWith("clinix:chat:") && k.endsWith(":idx")) || k === "clinix:imgbank:index") {   // lists: merged by id, never replaced
      const have = (await store.get(k)) || [];
      const ids = new Set(have.map((e) => e.id));
      await store.set(k, [...have, ...(Array.isArray(v) ? v : []).filter((e) => e && !ids.has(e.id))]);
      continue;
    }
    if ((await store.get(k)) === null) await store.set(k, v);
  }
  return { added, total: map.size, mistakes: mistakesAdded };
}
