/* ───────────── The student's whole library, as context for the AI ─────────────
   "Ask AI" used to see ONE question. Now it sees all of them:

   1. an INDEX of every saved question / lesson (code, kind, topic, title, key terms) → the model knows what exists
   2. the FULL text (question + explanation + tricks) of the few items that match what the student is asking about,
      found locally (no extra network request) by a small TF-IDF search that understands Arabic + English.

   Every item has a short code (S1, S2 …). The model cites it as [S3]; the chat turns it into a button that opens that
   question (see splitCites). */

import { wordLines, parseWord } from "./parse.js";

const cap = (s, n) => { const t = String(s || ""); return t.length > n ? t.slice(0, n).trimEnd() + "…" : t; };
const flat = (s) => String(s || "").replace(/[*=«»#>`]/g, " ").replace(/\s+/g, " ").trim();

/* ── tokenizer: Arabic normalisation + English, prefixes stripped ── */
const AR_MARKS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;
const STOP = new Set((
  "في من على الى إلى عن مع هل ما ماذا هو هي هم ده دي دا ديه دول ان إن أن اللي الذي التي انا أنا انت أنت كل او أو ثم لو لا لم لن قد كان كانت يكون تكون " +
  "بس كمان برضو يعني ايه إيه ليه ازاي إزاي فين امتى عايز عاوز اعمل اعملي اشرح اشرحلي قولي وضحلي ممكن لي لنا له لها بعد قبل عند هذا هذه ذلك " +
  "the a an of and or is are was were to in on for with by at as be it this that these those what why how which can you me my i do does did about from into " +
  "question questions explain tell please give make"
).split(/\s+/));

export function tokens(text) {
  const t = String(text || "")
    .toLowerCase()
    .replace(AR_MARKS, "")
    .replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660));
  const out = [];
  for (let w of t.split(/[^\p{L}\p{N}]+/u)) {
    if (!w) continue;
    if (/[؀-ۿ]/.test(w)) {
      if (w.length > 4) w = w.replace(/^(?:وال|بال|كال|فال|لل|ال)/, "");
      if (w.length > 3) w = w.replace(/^[وفبل](?=.{4,})/, "");
    } else if (w.length > 3) {
      w = w.replace(/(?:ies|es|s)$/, (m) => (m === "ies" ? "y" : ""));
    }
    if (w.length < 2 || STOP.has(w)) continue;
    out.push(w);
  }
  return out;
}

const termsOf = (q) => wordLines(q.new_words || "").slice(0, 40)
  .map((l) => parseWord(l).term.replace(/[*=«»]/g, "").trim()).filter(Boolean);

/* the search index is rebuilt only when the list of questions changes */
let _memo = { qs: null, topics: null, idx: null };

function buildIndex(questions, topics) {
  if (_memo.qs === questions && _memo.topics === topics) return _memo.idx;
  const topicOf = new Map();
  ((topics && topics.list) || []).forEach((t) => (t.qids || []).forEach((id) => topicOf.set(id, t)));
  const items = [...questions].filter((q) => q && q.id).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).map((q, i) => {
    const topic = topicOf.get(q.id) || null;
    const terms = termsOf(q);
    const title = flat(q.title);
    const tf = new Map();
    const bump = (txt, w) => tokens(txt).forEach((k) => tf.set(k, (tf.get(k) || 0) + w));
    bump(title, 4); bump(topic ? topic.name : "", 3); bump(terms.slice(0, 12).join(" "), 2);
    bump(cap(q.original_question_text, 1500), 1); bump(cap(q.explanation, 2200), 1); bump(cap(q.tricks, 600), 1);
    return { code: `S${i + 1}`, q, topic, terms, title, tf };
  });
  const df = new Map();
  items.forEach((it) => it.tf.forEach((_, k) => df.set(k, (df.get(k) || 0) + 1)));
  const idx = { items, df, N: items.length, byTopic: new Map() };
  items.forEach((it) => { if (it.topic) { if (!idx.byTopic.has(it.topic.id)) idx.byTopic.set(it.topic.id, []); idx.byTopic.get(it.topic.id).push(it); } });
  _memo = { qs: questions, topics, idx };
  return idx;
}

function rank(idx, query, focusId, focusTopicId) {
  const qt = [...new Set(tokens(query))];
  const focusItem = idx.items.find((it) => it.q.id === focusId);
  const focusTopic = focusTopicId || (focusItem && focusItem.topic && focusItem.topic.id) || null;
  return idx.items.map((it) => {
    let s = 0;
    for (const k of qt) {
      const f = it.tf.get(k);
      if (!f) continue;
      s += Math.log(1 + idx.N / (1 + (idx.df.get(k) || 0))) * (1 + Math.log(f));
    }
    /* the topic's own name matches the question → every item in that topic is relevant */
    if (it.topic && qt.length) {
      const tn = new Set(tokens(it.topic.name));
      const hit = qt.filter((k) => tn.has(k)).length;
      if (hit) s += 2 + hit * 1.5;
    }
    if (focusTopic && it.topic && it.topic.id === focusTopic) s += s > 0 ? 2.5 : 1;   // same topic as the screen the student is on
    return { it, s };
  }).sort((a, b) => b.s - a.s);
}

/* a compact one-line summary: "S4 · Q · [Heart failure] · title · terms: a, b" */
const line = (it) => `${it.code} | ${it.q.kind === "lesson" ? "L" : "Q"} | ${it.topic ? it.topic.name : "-"} | ${cap(it.title, 70)}${it.terms.length ? " | " + it.terms.slice(0, 5).map((t) => cap(t, 24)).join(", ") : ""}`;

const detail = (it, per) => {
  const lesson = it.q.kind === "lesson";
  const exp = String(it.q.explanation || "");
  const tricks = String(it.q.tricks || "");
  return `### ${it.code} — ${it.title} (${lesson ? "study material" : "exam question"}${it.topic ? `, topic: ${it.topic.name}` : ""})
${lesson ? "SUMMARY" : "QUESTION"}:
${cap(it.q.original_question_text, Math.round(per * 0.4))}
EXPLANATION GIVEN TO THE STUDENT:
${cap(exp, Math.round(per * 0.45))}${tricks ? `\nTRAPS / KEY POINTS:\n${cap(tricks, Math.round(per * 0.15))}` : ""}`;
};

/* The block that goes into the system prompt.
   query      what the student is asking (last messages)
   focusId    the saved item currently open on screen (already given to the model in full elsewhere)
   focusTopicId  the topic screen the student is on
   returns { text, codes: { S3: {id,title} }, used: [ids] } — text is "" when the library is empty */
export function libraryContext({ questions, topics, query, focusId, focusTopicId, maxItems = 6, perItem = 3200, budget = 24000, forceTopic = null, forceIds = null }) {
  const idx = buildIndex(questions || [], topics);
  if (!idx.N) return { text: "", codes: {}, used: [], count: 0 };
  const codes = {};
  idx.items.forEach((it) => { codes[it.code] = { id: it.q.id, title: it.title, kind: it.q.kind === "lesson" ? "lesson" : "question" }; });

  const ranked = rank(idx, query, focusId, focusTopicId);
  let chosen = ranked.filter((r) => r.s > 0.6 && r.it.q.id !== focusId).slice(0, maxItems).map((r) => r.it);
  if (forceTopic && idx.byTopic.has(forceTopic)) {
    const extra = idx.byTopic.get(forceTopic).filter((it) => !chosen.includes(it) && it.q.id !== focusId);
    chosen = [...chosen, ...extra].slice(0, maxItems + 2);
  }
  /* a slice of a library-wide summary: exactly the items it owns, every one of them, each as long as the budget allows */
  let per = perItem;
  if (forceIds && forceIds.length) {
    const own = new Set(forceIds);
    chosen = idx.items.filter((it) => own.has(it.q.id)).slice(0, 16);
    per = Math.max(700, Math.min(3000, Math.floor((budget - 3000) / Math.max(1, chosen.length))));
  }
  let used = 0;
  const blocks = [];
  for (const it of chosen) {
    const b = detail(it, per);
    if (used + b.length > budget) break;
    used += b.length; blocks.push(b);
  }
  const index = idx.items.slice(0, 150).map(line).join("\n");
  const topicsLine = ((topics && topics.list) || []).filter((t) => t.qids && t.qids.length).slice(0, 60).map((t) => `${t.emoji || ""} ${t.name} (${t.qids.length})`).join(" · ");
  const text = `=== THE STUDENT'S SAVED LIBRARY (${idx.N} items: exam questions he practised and study materials he uploaded) ===
Index — code | Q=exam question, L=study material | topic | title | key terms:
${index}
${topicsLine ? `\nTopics: ${topicsLine}\n` : ""}${blocks.length ? `\nFull text of the items most related to what he is asking now:\n${blocks.join("\n\n")}\n` : ""}
HOW TO USE THE LIBRARY: it is what he has ALREADY studied, so use it: connect his question to his earlier questions, remind him of the rule he met before, point out repeated traps, quiz him from it. When you rely on a saved item, cite its code in square brackets right after the sentence, like [S3] or [S3][S7] (codes only, never the title). Only cite items listed above. If the library has nothing relevant, answer normally from your nursing knowledge and do not mention the library.`;
  return { text, codes, used: chosen.map((it) => it.q.id), count: idx.N };
}

/* the model's citations → { clean text, cited codes, claims }. Works on any prefix of a streamed answer.
   claims[code] = the sentence(s) of the answer that the citation stands under: it is what the saved item is searched for
   when the student opens it from the answer (see bestField / lib/highlight.js). */
export function splitCites(raw) {
  const cites = [];
  const claims = {};
  const src = String(raw || "");
  let t = src.replace(/\s?\[\s*(S\d+(?:\s*[,،;]\s*S\d+)*)\s*\]/g, (m, inner, offset) => {
    /* the sentence that ends right before the marker */
    const before = src.slice(0, offset).replace(/\s?\[\s*S\d+(?:\s*[,،;]\s*S\d+)*\s*\]/g, "");
    let start = 0;
    for (const sep of ["\n", ". ", "؟", "? ", "! ", "。", "؛"]) start = Math.max(start, before.lastIndexOf(sep) + (sep.length > 1 && sep.trim() ? 1 : sep.length));
    const claim = flat(before.slice(start)).slice(-320);
    inner.split(/[,،;]/).forEach((c) => {
      const k = c.trim();
      if (!k) return;
      if (!cites.includes(k)) cites.push(k);
      if (claim && !(claims[k] || "").includes(claim)) claims[k] = `${claims[k] ? claims[k] + " " : ""}${claim}`.slice(-600);
    });
    return "";
  });
  t = t.replace(/\s?\[\s*S?\d*(?:\s*[,،;]\s*S?\d*)*\s*$/, "");   // an unfinished "[S1" at the very end of the stream
  return { text: t, cites, claims };
}

/* ── which part of a saved item answers a sentence? (used to highlight it when the student opens the item from a chat answer) ── */
const FIELDS = ["original_question_text", "explanation", "tricks"];
const lineScore = (claimTokens, text) => {
  const lt = tokens(text);
  if (!lt.length) return { hits: 0, score: 0 };
  const set = new Set(lt);
  let hits = 0;
  for (const k of claimTokens) if (set.has(k)) hits += 1;
  return { hits, score: (hits * hits) / (lt.length + 4) };
};

/* the field of the item (question text / explanation / tricks) whose lines match the sentence best, or null when nothing matches */
export function bestField(q, claim) {
  const ct = [...new Set(tokens(claim))];
  if (!q || !ct.length) return null;
  let best = null;
  for (const f of FIELDS) {
    for (const ln of String(q[f] || "").split("\n")) {
      const { hits, score } = lineScore(ct, ln);
      if (hits >= 2 || (hits >= 1 && ct.length <= 3)) { if (!best || score > best.score) best = { field: f, score, hits }; }
    }
  }
  return best ? best.field : null;
}

/* the same scoring, for blocks of text already on the screen: indexes of the blocks to highlight (best one + close seconds, max 3) */
export function bestBlocks(texts, claim) {
  const ct = [...new Set(tokens(claim))];
  if (!ct.length) return [];
  const sc = texts.map((tx, i) => ({ i, ...lineScore(ct, tx) })).filter((r) => r.hits >= 2 || (r.hits >= 1 && ct.length <= 3));
  if (!sc.length) return [];
  sc.sort((a, b) => b.score - a.score);
  const top = sc[0];
  return sc.filter((r) => r.score >= top.score * 0.7).slice(0, 3).map((r) => r.i).sort((a, b) => a - b);
}

/* a few of the student's items as text, for building an exam from his own material */
export function materialFor({ questions, topics, query, focusId, focusTopicId, maxItems = 8, perItem = 1800, budget = 16000 }) {
  const idx = buildIndex(questions || [], topics);
  if (!idx.N) return { text: "", titles: [] };
  const ranked = rank(idx, query, focusId, focusTopicId);
  let pick = ranked.filter((r) => r.s > 0.6).slice(0, maxItems).map((r) => r.it);
  if (!pick.length) pick = idx.items.slice(0, Math.min(5, idx.N));   // nothing matches → his most recent items
  let used = 0;
  const blocks = [];
  const titles = [];
  for (const it of pick) {
    const b = detail(it, perItem);
    if (used + b.length > budget) break;
    used += b.length; blocks.push(b); titles.push(it.title);
  }
  return { text: blocks.join("\n\n"), titles, matched: ranked.some((r) => r.s > 0.6) };
}
