/* ───────────── غلطاتي (My Mistakes) ─────────────
   Every exam question the student answers WRONG is saved here automatically (components/ExamCard.jsx → recordAnswer).
   The screen (screens/MistakesScreen.jsx) shows them organised: category → topic → question.

   Entry: { id, stem, options[], correct[], type, rationale, topic, topicKey, cat, exam, picked[], wrong, right, streak,
            mastered, firstAt, lastAt, masteredAt }
   • the same question missed again is NOT duplicated: its `wrong` counter goes up (id = fingerprint of the stem);
   • a question answered right when re-practised counts towards `streak`; MASTER_AT right answers in a row = mastered (اتقنتها);
     a wrong answer breaks the streak and un-masters it;
   Module-level store + useSyncExternalStore (same pattern as vocab.js), saved to IndexedDB under "clinix:mistakes". */

import { useSyncExternalStore } from "react";
import { store } from "./storage.js";

export const KEY = "clinix:mistakes";
export const MASTER_AT = 2;

let state = { list: [] };
const subs = new Set();
const sub = (f) => { subs.add(f); return () => subs.delete(f); };
const snap = () => state;

/* ── helpers (pure, tested) ── */
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, " ").trim();
export const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

/* a short fingerprint of the question text, so the same question has the same id on every device */
export function mistakeId(stem) {
  const t = norm(stem).slice(0, 400);
  let h1 = 5381, h2 = 52711;
  for (let i = 0; i < t.length; i++) { const c = t.charCodeAt(i); h1 = ((h1 << 5) + h1) ^ c; h2 = ((h2 << 5) + h2 + c) | 0; }
  return "m" + (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36) + t.length.toString(36);
}

export const topicKey = (t) => norm(t).replace(/\s+/g, "");

/* NCLEX-style categories. The first rule that matches the topic wins; then the exam title; then the question text (weak rules are skipped there). */
export const CATS = [
  { id: "pharm", emoji: "💊", name: "الأدوية", re: /pharmac|medication|\bdrugs?\b|dosage|\bdose\b|antibiotic|antidote|toxicity|adverse|anticoag|warfarin|heparin|opioid|analgesic|antihypertens|diuretic|nsaid|vancomycin|aminoglycoside|digoxin|lithium|دوا|أدوي|ادوي/i },
  { id: "ob", emoji: "🤰", name: "الولادة وحديثي الولادة", re: /pregnan|labor\b|obstet|postpartum|newborn|neonat|maternal|preeclampsia|eclampsia|fetal|gestation|breastfeed|contracept|delivery|ولاد|حمل|نفاس/i },
  { id: "peds", emoji: "🧒", name: "الأطفال", re: /pediatric|paediatric|child|infant|toddler|adolescent|croup|kawasaki|vaccin|immuniz|طفل|أطفال|اطفال|رضيع/i },
  { id: "psych", emoji: "🧘", name: "الصحة النفسية", re: /psych|mental|depress|suicid|anxiety|bipolar|schizo|delirium|dementia|substance|alcohol|withdrawal|therapeutic comm|eating disorder|نفسي|اكتئاب/i },
  { id: "cardio", emoji: "🫀", name: "القلب والأوعية", re: /heart|cardi|myocard|angina|hypertens|hypotens|arrhythm|atrial|ventric|\bec?kg\b|shock|aneurysm|\bdvt\b|thromb|embol|valve|vascular|peripheral|edema|قلب|ضغط|شرايين/i },
  { id: "resp", emoji: "🫁", name: "الجهاز التنفسي", re: /respir|lung|pulmon|asthma|copd|pneumo|oxygen|tracheo|chest tube|ards|bronch|tubercul|airway|ventilat|dyspnea|cough|تنفس|رئة|رئه|صدر/i },
  { id: "neuro", emoji: "🧠", name: "الأعصاب والدماغ", re: /neuro|stroke|seizure|epilep|\bcva\b|intracranial|\bicp\b|spinal|brain|meningitis|parkinson|alzheimer|glasgow|head injury|myasthenia|guillain|multiple sclerosis|عصب|دماغ|جلطة|تشنج/i },
  { id: "endo", emoji: "🩸", name: "الغدد والسكري", re: /diabet|insulin|glucose|\bdka\b|thyroid|adrenal|cushing|addison|pituitary|hyperglyc|hypoglyc|endocr|سكر|غدة|غدد/i },
  { id: "renal", emoji: "💧", name: "الكلى والسوائل والأملاح", re: /renal|kidney|dialysis|urin|fluid|electrolyte|potassium|sodium|calcium|magnesium|phosph|hyperkal|hypokal|hypernat|hyponat|dehydrat|acid.?base|\babg\b|\buti\b|كلى|كلي|بول|أملاح|املاح|سوائل/i },
  { id: "gi", emoji: "🍽️", name: "الجهاز الهضمي والكبد", re: /gastro|\bgi\b|bowel|liver|hepat|cirrho|pancrea|ulcer|crohn|colitis|appendic|nutrition|ostomy|diarrhea|constipation|nasogastric|tube feeding|gerd|هضم|معدة|كبد/i },
  { id: "heme", emoji: "🧬", name: "الدم والأورام", re: /anemia|sickle|leukemia|lymphoma|cancer|oncolog|chemotherapy|transfus|hemophilia|neutropenia|blood|أنيميا|انيميا|سرطان|دم\b/i },
  { id: "msk", emoji: "🦴", name: "العظام والجلد والحروق", re: /fracture|orthop|\bbone\b|osteo|\bcast\b|traction|amputat|\bburns?\b|skin|wound|pressure (ulcer|injur)|arthritis|gout|musculo|كسر|عظام|حروق|جلد/i },
  { id: "sense", emoji: "👁️", name: "العين والأذن", re: /glaucoma|cataract|retina|hearing|\bear\b|\beye\b|vision|عين|أذن|اذن|نظر/i },
  { id: "infect", emoji: "🛡️", name: "العدوى والسلامة", weak: true, re: /infect|isolation|precaution|steril|hand hygiene|\bppe\b|safety|\bfalls?\b|restraint|fire|sepsis|\bhiv\b|mrsa|c\.? ?diff|عدوى|تعقيم|سلامة/i },
  { id: "mgmt", emoji: "📋", name: "الأولويات والتفويض والقانون", weak: true, re: /delegat|priorit|triage|ethic|legal|consent|confidential|hipaa|leadership|assign|supervis|advance directive|incident|scope of|management of care|تفويض|أولوي|اولوي|قانون/i },
  { id: "lab", emoji: "🧪", name: "التحاليل والفحوصات", weak: true, re: /\blabs?\b|laboratory|diagnostic|lab value|\bcbc\b|\bbun\b|creatinine|\binr\b|\bptt?\b|troponin|specimen|تحليل|تحاليل|فحص/i },
];
export const OTHER_CAT = { id: "other", emoji: "📚", name: "مواضيع متنوعة" };
const CAT_BY_ID = Object.fromEntries([...CATS, OTHER_CAT].map((c) => [c.id, c]));
export const catInfo = (id) => CAT_BY_ID[id] || OTHER_CAT;

export function categoryOf({ topic = "", exam = "", stem = "" } = {}) {
  for (const c of CATS) if (c.re.test(topic)) return c.id;
  for (const c of CATS) if (c.re.test(exam)) return c.id;
  for (const c of CATS) if (!c.weak && c.re.test(stem)) return c.id;
  return OTHER_CAT.id;
}

const tidyTopic = (t) => String(t || "").replace(/\s+/g, " ").trim().slice(0, 48);

/* ── state changes ── */
const emit = () => { subs.forEach((f) => f()); store.set(KEY, state.list); };

export function shapeMistakes(raw) {
  const list = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.list) ? raw.list : []);
  return list.filter((m) => m && m.id && m.stem && Array.isArray(m.options) && Array.isArray(m.correct));
}

export function initMistakes(raw) { state = { list: shapeMistakes(raw) }; }

/* Load from the database when the boot data did not carry it (fallback only). */
export async function loadMistakes() {
  try { const raw = await store.get(KEY); if (!state.list.length) { state = { list: shapeMistakes(raw) }; subs.forEach((f) => f()); } } catch (e) { /* keep what we have */ }
}

/* Called when the student confirms an answer.
   q: { stem, options, correct[], type, rationale, topic } · sel: chosen indexes · ctx: { exam: title of the exam, retry: true when it is a re-practice }
   Returns "new" | "again" | "fixed" | "mastered" | null (nothing changed: it was right and never a mistake). */
export function recordAnswer(q, sel, ctx = {}) {
  if (!q || !q.stem || !Array.isArray(q.options) || !Array.isArray(q.correct)) return null;
  const right = sameSet(sel || [], q.correct);
  const id = mistakeId(q.stem);
  const old = state.list.find((m) => m.id === id);
  const now = Date.now();
  if (right) {
    if (!old) return null;
    const streak = (old.streak || 0) + 1;
    const mastered = streak >= MASTER_AT;
    const next = { ...old, right: (old.right || 0) + 1, streak, mastered, masteredAt: mastered ? (old.masteredAt || now) : old.masteredAt, lastAt: now };
    state = { list: state.list.map((m) => (m.id === id ? next : m)) };
    emit();
    return mastered && !old.mastered ? "mastered" : "fixed";
  }
  const topic = tidyTopic(q.topic) || (old && old.topic) || "";
  const entry = {
    id, stem: String(q.stem), options: q.options.map(String), correct: [...q.correct], type: q.type === "multi" ? "multi" : "single",
    rationale: String(q.rationale || ""), topic, topicKey: topicKey(topic || ctx.exam || "عام"),
    cat: categoryOf({ topic, exam: ctx.exam, stem: q.stem }),
    exam: ctx.exam || (old && old.exam) || "", picked: [...(sel || [])],
    wrong: (old ? old.wrong || 1 : 0) + 1, right: old ? old.right || 0 : 0, streak: 0, mastered: false, masteredAt: undefined,
    firstAt: old ? old.firstAt : now, lastAt: now,
  };
  state = { list: old ? state.list.map((m) => (m.id === id ? entry : m)) : [entry, ...state.list] };
  emit();
  return old ? "again" : "new";
}

export function setMastered(id, on) {
  state = { list: state.list.map((m) => (m.id === id ? { ...m, mastered: !!on, streak: on ? Math.max(m.streak || 0, MASTER_AT) : 0, masteredAt: on ? Date.now() : undefined } : m)) };
  emit();
}
export function removeMistake(id) { state = { list: state.list.filter((m) => m.id !== id) }; emit(); }
export function clearMastered() { state = { list: state.list.filter((m) => !m.mastered) }; emit(); }

/* backup restore: union by id; the one used more recently wins, the counters keep the larger value */
export function mergeMistakes(a, b) {
  const map = new Map();
  for (const m of [...shapeMistakes(a), ...shapeMistakes(b)]) {
    const o = map.get(m.id);
    if (!o) { map.set(m.id, m); continue; }
    const [n, p] = (m.lastAt || 0) >= (o.lastAt || 0) ? [m, o] : [o, m];
    const first = [m.firstAt, o.firstAt].filter(Boolean);
    map.set(m.id, { ...n, wrong: Math.max(m.wrong || 0, o.wrong || 0), right: Math.max(m.right || 0, o.right || 0), firstAt: first.length ? Math.min(...first) : n.firstAt, topic: n.topic || p.topic });
  }
  return [...map.values()].sort((x, y) => (y.lastAt || 0) - (x.lastAt || 0));
}

export const useMistakes = () => useSyncExternalStore(sub, snap);
export const openCount = (list) => list.filter((m) => !m.mastered).length;

/* ── organisation: category → topic → questions ── */
export function filterList(list, { status = "open", q = "", cat = "" } = {}) {
  const s = norm(q);
  return list.filter((m) => {
    if (status === "open" && m.mastered) return false;
    if (status === "done" && !m.mastered) return false;
    if (cat && m.cat !== cat) return false;
    if (s && !norm(`${m.stem} ${m.topic} ${m.exam} ${m.options.join(" ")}`).includes(s)) return false;
    return true;
  });
}

/* → [{ cat, items, open, topics:[{ key, name, items, open, done }] }]  — categories and topics: most open mistakes first */
export function organizeMistakes(list) {
  const cats = new Map();
  for (const m of list) {
    const c = cats.get(m.cat) || { cat: m.cat, items: [], topics: new Map() };
    c.items.push(m);
    const key = m.topicKey || topicKey(m.topic || m.exam || "عام");
    const t = c.topics.get(key) || { key, name: m.topic || m.exam || "عام", items: [] };
    if (m.topic && t.name.length < m.topic.length && t.name === (m.exam || "عام")) t.name = m.topic;
    t.items.push(m);
    c.topics.set(key, t);
    cats.set(m.cat, c);
  }
  const openOf = (arr) => arr.filter((m) => !m.mastered).length;
  const out = [...cats.values()].map((c) => {
    const topics = [...c.topics.values()].map((t) => ({
      ...t, open: openOf(t.items), done: t.items.length - openOf(t.items),
      items: [...t.items].sort((a, b) => Number(!!a.mastered) - Number(!!b.mastered) || (b.wrong || 0) - (a.wrong || 0) || (b.lastAt || 0) - (a.lastAt || 0)),
    })).sort((a, b) => b.open - a.open || b.items.length - a.items.length || a.name.localeCompare(b.name));
    return { cat: c.cat, items: c.items, open: openOf(c.items), topics };
  }).sort((a, b) => b.open - a.open || b.items.length - a.items.length);
  return out;
}

export function summarize(list) {
  const open = list.filter((m) => !m.mastered);
  const byTopic = new Map();
  for (const m of open) { const k = m.topicKey; const e = byTopic.get(k) || { name: m.topic || m.exam || "عام", n: 0 }; e.n += (m.wrong || 1); byTopic.set(k, e); }
  const weakest = [...byTopic.values()].sort((a, b) => b.n - a.n)[0] || null;
  return {
    total: list.length, open: open.length, done: list.length - open.length,
    topics: new Set(open.map((m) => m.topicKey)).size, weakest,
    repeated: open.filter((m) => (m.wrong || 0) > 1).length,
  };
}

/* test hook */
export const __setState = (list) => { state = { list }; };
export const __getState = () => state;
