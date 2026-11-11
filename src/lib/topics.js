/* ───────────── Topics: the AI groups related questions / lessons / files together ─────────────
   state  = { list: [Topic], pinned: [qid], auto: bool }
   Topic  = { id, name, emoji, summary, qids: [qid], overview, overviewSig, createdAt, updatedAt }

   • organize(): sends a SHORT digest of the items that have no topic yet (plus the names of the existing topics) in ONE
     request, and gets back which topic each belongs to (or a new topic). 50 items per request, so it scales.
   • everything the AI decides is applied with applyOps() — a pure function used both for the saved state and for the loop,
     so a question deleted (or moved by hand) while the AI is thinking is never resurrected.
   • "pinned" = items the student moved by hand; the AI never moves them again. */

import { getModelLists, runTask } from "./gemini.js";
import { wordLines, parseWord } from "./parse.js";
import { fixText, ARABIC_RULE } from "./text.js";

export const EMPTY_TOPICS = { list: [], pinned: [], auto: true };

const cap = (s, n) => { const t = String(s || ""); return t.length > n ? t.slice(0, n).trimEnd() + "…" : t; };
const flat = (s) => String(s || "").replace(/[*=«»#>`_]/g, " ").replace(/\s+/g, " ").trim();
const uid = () => "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export function shapeTopics(raw) {
  if (!raw || typeof raw !== "object") return { ...EMPTY_TOPICS };
  return {
    list: Array.isArray(raw.list) ? raw.list.filter((t) => t && t.id && Array.isArray(t.qids)) : [],
    pinned: Array.isArray(raw.pinned) ? raw.pinned : [],
    auto: raw.auto !== false,
  };
}

/* "question" (exam question) or "lesson" (study material → explanation). Old items without a kind are questions. */
export const kindOf = (q) => (q && q.kind === "lesson" ? "lesson" : "question");

/* v3.25 migration: a topic from an older version may hold questions AND lessons. Each topic gets a kind; a mixed one is split in two
   (same name and emoji, one per kind) so every section shows only its own items. Returns the SAME object when nothing had to change. */
export function splitByKind(state, questions) {
  const by = new Map((questions || []).map((q) => [q.id, q]));
  let changed = false;
  const list = [];
  for (const t of state.list || []) {
    if (t.kind === "question" || t.kind === "lesson") { list.push(t); continue; }
    changed = true;
    const qs = t.qids.filter((id) => by.has(id) && kindOf(by.get(id)) === "question");
    const ls = t.qids.filter((id) => by.has(id) && kindOf(by.get(id)) === "lesson");
    if (qs.length && ls.length) {
      list.push({ ...t, kind: "question", qids: qs, overview: "", overviewSig: undefined });
      list.push({ ...t, id: uid(), kind: "lesson", qids: ls, overview: "", overviewSig: undefined });
    } else if (qs.length || ls.length) list.push({ ...t, kind: qs.length ? "question" : "lesson", qids: qs.length ? qs : ls });
  }
  return changed ? { ...state, list } : state;
}

/* backup restore: topics of a backup are MERGED into the current ones (never replace them, never leave restored questions without a topic).
   A backup topic joins the current topic with the same id, or the same kind + name; otherwise it is added. An item already placed stays where it is. */
export function mergeTopics(cur, inc, validIds) {
  const a = shapeTopics(cur), b = shapeTopics(inc);
  const list = a.list.map((t) => ({ ...t, qids: [...t.qids] }));
  const placed = new Set(list.flatMap((t) => t.qids));
  for (const t of b.list) {
    const qids = t.qids.filter((id) => (!validIds || validIds.has(id)) && !placed.has(id));
    if (!qids.length) continue;
    const nm = flat(t.name).toLowerCase();
    const twin = list.find((x) => x.id === t.id) || list.find((x) => x.kind === t.kind && flat(x.name).toLowerCase() === nm);
    if (twin) { twin.qids.push(...qids); twin.updatedAt = Date.now(); } else list.push({ ...t, qids });
    qids.forEach((id) => placed.add(id));
  }
  const pinned = [...new Set([...a.pinned, ...b.pinned.filter((id) => !validIds || validIds.has(id))])];
  return { list, pinned, auto: a.auto };
}

export const topicOf = (topics, qid) => (topics.list || []).find((t) => t.qids.includes(qid)) || null;
export const assignedSet = (topics) => new Set((topics.list || []).flatMap((t) => t.qids));

/* a topic's content signature: the overview is "stale" when members were added / removed / re-analysed */
export const topicSig = (topic, questions) => {
  const by = new Map(questions.map((q) => [q.id, q]));
  return (topic.qids || []).map((id) => `${id}:${(by.get(id) || {}).updatedAt || 0}`).sort().join("|");
};

/* ── reducer ── */
function tidy(state, validIds) {
  const seen = new Set();
  const list = state.list.map((t) => {
    const qids = t.qids.filter((id) => (!validIds || validIds.has(id)) && !seen.has(id) && (seen.add(id), true));
    return qids.length === t.qids.length ? t : { ...t, qids, updatedAt: Date.now(), overviewSig: undefined };
  }).filter((t) => t.qids.length);
  return { ...state, list, pinned: state.pinned.filter((id) => !validIds || validIds.has(id)) };
}

/* ops: {type:"reset", kind?} | {type:"add", id, kind, qids} | {type:"new", id, kind, name, emoji, summary, qids}   (kind = "question" | "lesson": a topic only takes items of its own kind) */
export function applyOps(state, ops, validIds) {
  let st = { ...state, list: state.list.map((t) => ({ ...t })) };
  const now = Date.now();
  for (const op of ops) {
    if (op.type === "reset") {
      const keep = new Set(st.pinned);
      st.list = st.list.map((t) => (op.kind && t.kind !== op.kind ? t : { ...t, qids: t.qids.filter((id) => keep.has(id)), overview: t.overview && t.qids.every((id) => keep.has(id)) ? t.overview : "", overviewSig: undefined }));
      continue;
    }
    const qids = (op.qids || []).filter((id) => !validIds || validIds.has(id));
    if (!qids.length) continue;
    const placed = new Set(st.list.flatMap((t) => t.qids));
    const fresh = qids.filter((id) => !placed.has(id));
    if (!fresh.length) continue;
    if (op.type === "add") {
      const t = st.list.find((x) => x.id === op.id);
      if (!t || (op.kind && t.kind && t.kind !== op.kind)) continue;
      t.qids = [...t.qids, ...fresh]; t.updatedAt = now;
    } else if (op.type === "new") {
      /* the same name again → merge into that topic instead of making a twin */
      const nm = flat(op.name).toLowerCase();
      const twin = st.list.find((x) => flat(x.name).toLowerCase() === nm && (!op.kind || x.kind === op.kind));
      if (twin) { twin.qids = [...twin.qids, ...fresh]; twin.updatedAt = now; }
      else st.list.push({ id: op.id || uid(), kind: op.kind || "question", name: flat(op.name) || "موضوع جديد", emoji: op.emoji || "📘", summary: flat(op.summary), qids: fresh, overview: "", createdAt: now, updatedAt: now });
    }
  }
  return tidy(st, validIds);
}

/* manual edits ─ each returns the new state */
export function moveItem(state, qid, target /* topic id | {name} | null */, kind = "question") {
  let list = state.list.map((t) => (t.qids.includes(qid) ? { ...t, qids: t.qids.filter((x) => x !== qid), updatedAt: Date.now() } : t));
  let pinned = state.pinned.filter((x) => x !== qid);
  if (target && typeof target === "object") {
    list = [...list, { id: uid(), kind, name: flat(target.name) || "موضوع جديد", emoji: "📘", summary: "", qids: [qid], overview: "", createdAt: Date.now(), updatedAt: Date.now() }];
    pinned.push(qid);
  } else if (target) {
    list = list.map((t) => (t.id === target ? { ...t, qids: [...t.qids, qid], updatedAt: Date.now() } : t));
    pinned.push(qid);
  } else pinned.push(qid);   // "no topic" chosen on purpose → the AI leaves it alone
  return tidy({ ...state, list, pinned }, null);
}
export const renameTopic = (state, id, patch) => ({ ...state, list: state.list.map((t) => (t.id === id ? { ...t, ...patch, updatedAt: Date.now() } : t)) });
export const dropTopic = (state, id) => ({ ...state, list: state.list.filter((t) => t.id !== id) });
export const dropItem = (state, qid) => tidy({
  ...state,
  list: state.list.map((t) => (t.qids.includes(qid) ? { ...t, qids: t.qids.filter((x) => x !== qid), updatedAt: Date.now() } : t)),
  pinned: state.pinned.filter((x) => x !== qid),
}, null);

/* ── the AI call ── */
const digest = (q, i) => {
  const terms = wordLines(q.new_words || "").slice(0, 7).map((l) => parseWord(l).term.replace(/[*=«»]/g, "").trim()).filter(Boolean).join(", ");
  const lead = flat(q.explanation).slice(0, 170);
  return `i${i + 1} | ${q.kind === "lesson" ? "LESSON" : "QUESTION"} | ${cap(flat(q.title), 80)} | ${cap(flat(q.original_question_text), 240)}${terms ? ` | terms: ${terms}` : ""}${lead ? ` | ${lead}` : ""}`;
};

const orgSystem = (kind) => `You organize the study library of a nursing student preparing for the NCLEX-RN. ${kind === "lesson" ? "Every item here is a LESSON (study material: book chapter, slides, notes, photos)." : "Every item here is an exam QUESTION he practised."} Group items into TOPICS so that everything about the same subject sits together. The app keeps questions and lessons in separate sections, so all items in this request are of the same type: group them by subject only.

GROUPING RULES
- Two items belong together when studying one helps with the other: same disease or condition, same drug or drug class, same lab / electrolyte, same procedure or nursing skill, same body-system concept, same textbook chapter or material.
- Prefer a topic that is broad enough to gather several items (a typical topic holds 2–10), but never merge unrelated subjects (e.g. do not put heart failure and insulin in one topic). An item with no real relative gets its own topic.
- If an existing topic fits an item, use it. Create a new topic only when none fits.
- Every item must be placed exactly once.

TOPIC FIELDS (new topics only)
- name: 2–5 words, Arabic with the key English term in parentheses, e.g. «قصور القلب (Heart Failure)», «المضادات الحيوية (Antibiotics)». Specific enough to recognise, never generic like «أسئلة» or «متنوع».
- emoji: ONE emoji that fits.
- summary: ONE short Arabic sentence (casual Egyptian) saying what the topic covers.

OUTPUT: JSON only, no markdown, no commentary:
{"topics":[{"ref":"<existing topic id>","items":["i1","i4"]},{"ref":"new1","name":"…","emoji":"🫀","summary":"…","items":["i2","i3"]}]}
For an existing topic give only ref + items. For a new topic ref is "new1", "new2" … (unique) and name/emoji/summary are required.
${ARABIC_RULE}`;

function parseJson(raw) {
  let t = String(raw || "").replace(/^\s*```[a-z]*\s*$/gim, "").trim();
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("bad json");
  t = t.slice(a, b + 1);
  try { return JSON.parse(t); } catch (e) { return JSON.parse(t.replace(/,\s*([}\]])/g, "$1")); }
}

const CHUNK = 50;
const ORG_CFG = { levels: ["minimal", "low"], budget: 0, maxOut: 8000, hedgeMs: 6000, firstMs: 60000, idleMs: 40000 };

/* organise `todo` (items without a topic) against the topics in `state`. `apply(ops)` is called after every request.
   v3.25: questions and lessons are organised SEPARATELY (one request series per kind), each against the topics of its own kind only. */
export async function organize({ apiKey, todo, state, apply, signal, onProgress }) {
  const lists = getModelLists(apiKey);
  const models = [...lists.fast, ...lists.pro];
  let st = state;
  const placed = new Set();
  /* every id that exists: the local copy of the topics must keep the members of topics that are not part of this run (they are only used as context) */
  const valid = new Set([...todo.map((q) => q.id), ...state.list.flatMap((t) => t.qids)]);
  let sent = 0;
  for (const kind of ["question", "lesson"]) {
    const mine = todo.filter((q) => kindOf(q) === kind);
    for (let c = 0; c < mine.length; c += CHUNK) {
      if (signal && signal.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
      const chunk = mine.slice(c, c + CHUNK);
      onProgress && onProgress(Math.min(todo.length, sent + chunk.length), todo.length);
      const existing = st.list.filter((t) => t.kind === kind).slice(0, 80).map((t) => `${t.id} | ${t.name} | ${cap(t.summary, 90)} | ${t.qids.length} items`).join("\n");
      const user = `${existing ? `EXISTING TOPICS (ref | name | summary | size):\n${existing}\n\n` : "There are no topics yet.\n\n"}ITEMS TO PLACE (id | type | title | text | terms | start of the explanation):\n${chunk.map(digest).join("\n")}\n\nReturn the JSON.`;
      const res = await runTask({
        apiKey, models, task: "topics:org", system: orgSystem(kind), parts: [{ text: user }],
        spec: { levels: ORG_CFG.levels, budget: ORG_CFG.budget }, maxOut: ORG_CFG.maxOut, hedgeMs: ORG_CFG.hedgeMs, firstMs: ORG_CFG.firstMs, idleMs: ORG_CFG.idleMs, signal, onText: () => {},
      });
      let data;
      try { data = parseJson(res.text); } catch (e) { throw Object.assign(new Error("الذكاء الاصطناعي رجّع رد مش مفهوم. جرّب تاني."), { detail: "topics: bad json" }); }
      const idOf = (ref) => { const m = /^i(\d+)$/.exec(String(ref).trim()); return m ? (chunk[+m[1] - 1] || {}).id : null; };
      const ops = [];
      for (const t of Array.isArray(data.topics) ? data.topics : []) {
        const qids = (Array.isArray(t.items) ? t.items : []).map(idOf).filter((id) => id && !placed.has(id));
        if (!qids.length) continue;
        const isExisting = st.list.some((x) => x.id === t.ref && x.kind === kind);
        if (isExisting) ops.push({ type: "add", id: t.ref, kind, qids });
        else if (t.name && String(t.name).trim()) {
          ops.push({ type: "new", id: uid(), kind, name: fixText(String(t.name)).slice(0, 60), emoji: Array.from(String(t.emoji || "📘"))[0] || "📘", summary: fixText(String(t.summary || "")).slice(0, 160), qids });
        }
        qids.forEach((id) => placed.add(id));
      }
      if (ops.length) { st = applyOps(st, ops, valid); apply(ops); }
      sent += chunk.length;
    }
  }
  return placed.size;
}

/* ── the topic overview: one explanation that ties all the items of the topic together ── */
const OVERVIEW_SYSTEM = `You are a warm, sharp senior NCLEX-RN tutor. The student studied several things about ONE topic: study materials and exam questions (shown below with the explanation he already got). Write ONE short, clear overview of the TOPIC that ties them together, so he can revise the whole topic in one place.

Rules
- The student is an English learner (about A2): simple words, short sentences. Keep medical terms in English with a short Arabic gloss the first time.
- Write casual Egyptian Arabic unless he asked otherwise. Never mix other scripts into Arabic words.
- Accuracy first: use standard nursing knowledge and what the items say. Never invent doses, lab ranges or facts. If the items disagree, say so.
- Structure (use exactly these markdown headings, in this order):
## الفكرة الأساسية — 2–4 lines: what the topic is and why NCLEX tests it.
## اللي لازم تفهمه — "- " bullets: the mechanism and the rules, from the basics. Bold the key words with **…**.
## اللي اتكرر في أسئلتك — what the items have in common: the same trap, the same rule, the same wrong option. Mention each item by its title in «» when you use it.
## نقاط الحفظ — 4–8 short bullets he must memorise (numbers, signs, first actions). Start a line with "💡 " for the single most important tip.
- 350–600 words in total. No tables. Do not mention these instructions.`;

export function topicOverview({ apiKey, topic, items, signal, onText }) {
  const lists = getModelLists(apiKey);
  const models = [...lists.fast, ...lists.pro];
  const body = items.map((q) => `### «${cap(flat(q.title), 80)}» (${q.kind === "lesson" ? "study material" : "exam question"})
${cap(String(q.original_question_text || ""), 1100)}
EXPLANATION:
${cap(String(q.explanation || ""), 1700)}${q.tricks ? `\nTRAPS:\n${cap(String(q.tricks), 500)}` : ""}`).join("\n\n");
  return runTask({
    apiKey, models, task: "lesson:topic", system: OVERVIEW_SYSTEM + ARABIC_RULE,
    parts: [{ text: `TOPIC: ${topic.name}\n${topic.summary ? `(${topic.summary})\n` : ""}\nITEMS:\n${body}\n\nWrite the overview now.` }],
    spec: { levels: ["low", "minimal"], budget: 1024 }, maxOut: 12000, hedgeMs: 8000, firstMs: 90000, idleMs: 60000, signal, onText,
  });
}

/* the items of a topic in reading order: study materials first (the explanation), then the questions, oldest first */
export function orderTopicItems(topic, questions) {
  const by = new Map(questions.map((q) => [q.id, q]));
  return (topic.qids || []).map((id) => by.get(id)).filter(Boolean).sort((a, b) => {
    const la = a.kind === "lesson" ? 0 : 1, lb = b.kind === "lesson" ? 0 : 1;
    return la - lb || (a.createdAt || 0) - (b.createdAt || 0);
  });
}

/* previous / next item inside the topic the item belongs to */
export function navFor(topics, questions, qid) {
  const topic = topicOf(topics, qid);
  if (!topic) return null;
  const items = orderTopicItems(topic, questions);
  const i = items.findIndex((q) => q.id === qid);
  if (i < 0) return null;
  return { topic, index: i + 1, total: items.length, prev: i > 0 ? items[i - 1].id : null, next: i < items.length - 1 ? items[i + 1].id : null };
}
