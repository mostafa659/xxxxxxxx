/* ───────────── Chat history: many conversations per chat ─────────────
   A chat (the general "AI" window, or the chat of one saved question) used to keep ONE conversation under `storeKey`.
   Now every chat has a list of conversations:

     `${storeKey}:idx`      → [{ id, title, createdAt, updatedAt, n }]      (small, read when the chat opens)
     `${storeKey}:c:${id}`  → [message, …]                                  (one record per conversation)

   An older version stored the messages directly under `storeKey`: they are moved into a conversation the first time the chat opens. */

import { store } from "./storage.js";

const idxKey = (base) => `${base}:idx`;
const convKey = (base, id) => `${base}:c:${id}`;
export const newConvId = () => "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

const clean = (s) => String(s || "").replace(/[*=«»#>`_]/g, " ").replace(/\s+/g, " ").trim();

/* the title of a conversation = the beginning of the first thing the student wrote */
export function convTitle(messages) {
  const first = (messages || []).find((m) => m.role === "user" && m.text && !/^\(ملفات مرفقة\)$/.test(m.text));
  const t = clean(first ? first.text : "");
  if (t) return t.length > 48 ? t.slice(0, 46).trimEnd() + "…" : t;
  const f = (messages || []).find((m) => m.role === "user" && m.atts && m.atts.length);
  return f ? `ملفات: ${f.atts[0].name}`.slice(0, 48) : "محادثة جديدة";
}

const byNewest = (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0);
const shapeIdx = (r) => (Array.isArray(r) ? r.filter((e) => e && e.id) : []);

/* the list of conversations (newest first). Moves an old single-conversation record into the list. */
export async function loadIndex(base) {
  let idx = shapeIdx(await store.get(idxKey(base)));
  const legacy = await store.get(base);
  if (Array.isArray(legacy) && legacy.length) {
    const id = newConvId();
    const now = Date.now();
    await store.set(convKey(base, id), legacy);
    idx = [...idx, { id, title: convTitle(legacy), createdAt: now - 1, updatedAt: now - 1, n: legacy.length }];
    await store.set(idxKey(base), idx);
    await store.del(base);
  }
  return idx.sort(byNewest);
}

export async function loadConv(base, id) {
  const r = await store.get(convKey(base, id));
  return Array.isArray(r) ? r : [];
}

/* writes one conversation and its row in the list; returns the new list (newest first) */
export async function saveConv(base, id, messages) {
  const idx = shapeIdx(await store.get(idxKey(base)));
  const old = idx.find((e) => e.id === id);
  const now = Date.now();
  const row = { id, title: old ? old.title : convTitle(messages), createdAt: old ? old.createdAt : now, updatedAt: now, n: messages.length };
  if (old && (!old.title || old.title === "محادثة جديدة")) row.title = convTitle(messages);
  await store.set(convKey(base, id), messages);
  const next = [row, ...idx.filter((e) => e.id !== id)].sort(byNewest);
  await store.set(idxKey(base), next);
  return next;
}

export async function removeConv(base, id) {
  const idx = shapeIdx(await store.get(idxKey(base))).filter((e) => e.id !== id);
  await store.del(convKey(base, id));
  await store.set(idxKey(base), idx);
  return idx.sort(byNewest);
}

/* every conversation of a chat (when the saved question itself is deleted) */
export async function removeAllConvs(base) {
  const idx = shapeIdx(await store.get(idxKey(base)));
  for (const e of idx) await store.del(convKey(base, e.id));
  await store.del(idxKey(base));
  await store.del(base);
}

/* for the backup file: the keys that belong to one chat */
export async function convKeys(base) {
  const idx = shapeIdx(await store.get(idxKey(base)));
  return [idxKey(base), ...idx.map((e) => convKey(base, e.id))];
}
