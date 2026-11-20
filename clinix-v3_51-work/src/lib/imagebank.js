/* The image gallery ("معرض الصور"): pictures the student chose to keep, grouped by lesson.

   • Nothing is kept automatically: a picture enters the gallery only when the student taps its bookmark icon (and leaves when he taps it again).
   • The index (small: ids, lesson, caption, date) is one record; every picture's pixels are a record of their own,
     so opening the gallery never loads more than it shows and one big picture can never block the others.
   • Chat history keeps only the newest pictures (storage budget). The gallery is separate: a saved picture stays even if the chat is cleared. */
import { useEffect, useState } from "react";
import { store } from "./storage.js";

const IDX = "clinix:imgbank:index";
const IMG = (id) => `clinix:imgbank:img:${id}`;
const EVT = "clinix:imgbank";
export const GLOBAL_LESSON = "global";

let cache = null;                 // the index, once loaded
let loading = null;
const pixels = new Map();         // id → { mime, data } (session cache)
let chain = Promise.resolve();    // writes run one after another: two quick taps can never overwrite each other
const enqueue = (fn) => { const p = chain.then(fn); chain = p.catch(() => {}); return p; };
const emit = () => { try { window.dispatchEvent(new Event(EVT)); } catch (e) { /* ignore */ } };

/* same pixels → same id (so the same picture can't be saved twice) */
export function imgId(img) {
  const s = String((img && img.data) || "");
  let h = 2166136261;
  const step = Math.max(1, Math.floor(s.length / 6000));
  for (let i = 0; i < s.length; i += step) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return `g${(h >>> 0).toString(36)}${s.length.toString(36)}`;
}

export function loadBank() {
  if (cache) return Promise.resolve(cache);
  if (!loading) {
    loading = store.get(IDX).then((r) => { cache = Array.isArray(r) ? r : []; return cache; }).catch(() => { cache = []; return cache; });
  }
  return loading;
}

export function getPixels(id) {
  if (pixels.has(id)) return Promise.resolve(pixels.get(id));
  return store.get(IMG(id)).then((r) => { if (r && r.data) pixels.set(id, r); return r || null; }).catch(() => null);
}

const tidy = (t, n) => String(t || "").replace(/\s+/g, " ").trim().slice(0, n);

/* → the id, or null when the device storage is full */
export function saveImage({ img, lessonId, lessonTitle, caption }) {
  return enqueue(async () => {
    const list = await loadBank();
    const id = imgId(img);
    if (list.some((e) => e.id === id)) return id;
    const rec = { mime: img.mime, data: img.data };
    if (!(await store.set(IMG(id), rec))) return null;
    const entry = {
      id, lessonId: lessonId || GLOBAL_LESSON, lessonTitle: tidy(lessonTitle, 80),
      caption: tidy(caption, 90) || "صورة", mime: img.mime, createdAt: Date.now(),
    };
    const next = [entry, ...list];
    if (!(await store.set(IDX, next))) { await store.del(IMG(id)); return null; }
    cache = next; pixels.set(id, rec); emit();
    return id;
  });
}

export function removeImage(id) {
  return enqueue(async () => {
    const list = await loadBank();
    const next = list.filter((e) => e.id !== id);
    await store.set(IDX, next);
    await store.del(IMG(id));
    cache = next; pixels.delete(id); emit();
  });
}

export function renameImage(id, caption) {
  return enqueue(async () => {
    const list = await loadBank();
    const next = list.map((e) => (e.id === id ? { ...e, caption: tidy(caption, 90) || e.caption } : e));
    await store.set(IDX, next);
    cache = next; emit();
  });
}

/* the gallery index, live */
export function useBank() {
  const [list, setList] = useState(() => cache || []);
  useEffect(() => {
    let alive = true;
    loadBank().then((l) => { if (alive) setList(l); });
    const h = () => { if (cache) setList([...cache]); };
    window.addEventListener(EVT, h);
    return () => { alive = false; window.removeEventListener(EVT, h); };
  }, []);
  return list;
}

/* one picture's pixels, loaded when the card appears */
export function useBankPixels(id) {
  const [rec, setRec] = useState(() => pixels.get(id) || null);
  useEffect(() => {
    let alive = true;
    if (pixels.has(id)) { setRec(pixels.get(id)); return undefined; }
    getPixels(id).then((r) => { if (alive) setRec(r); });
    return () => { alive = false; };
  }, [id]);
  return rec;
}
