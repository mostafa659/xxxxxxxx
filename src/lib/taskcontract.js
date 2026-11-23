/*
 * ClinixStudy · Task contract (v3.68, item model v3.69)
 *
 * WHY THIS EXISTS (root cause, verified on the v3.67.0 run of a 10-task consultant case):
 * every analysis path assumed the source is ONE exam item and squeezed it into the same lesson template
 * (decode the English → basics → options → "if the question changed" → mnemonic) with ~1,600 words and a fast
 * writer. When the SOURCE ITSELF prescribes the deliverable (numbered tasks, per-task requirements, word limits,
 * "do not …" rules) nothing in the app read that prescription, so a ten-task request received a 634-token
 * answer that addressed none of the tasks.
 *
 * This module reads the prescription deterministically (no model call), so that
 *   1. the router can choose a path with enough capacity and no lesson template,
 *   2. the writers receive the contract verbatim and one group of tasks each,
 *   3. the finished answer is AUDITED against the contract (task present, requirement touched,
 *      word limit respected) and missing tasks are re-requested or reported, never silently dropped.
 *
 * It is domain-agnostic: it recognises the structure of an instruction, not the subject matter.
 * Coverage checking is lexical (a requirement is "touched" when its distinctive words appear in the
 * task's section). It proves that a part was addressed, NOT that the content is correct.
 */

const AR_DIGITS = /[٠-٩]/g;
const norm = (s) => String(s ?? "").replace(AR_DIGITS, (d) => String(d.charCodeAt(0) - 0x660)).replace(/\r/g, "");

/* "Task 3 — Title" · "## TASK 3: Title" · "**Part 2.** Title" · "المهمة 4 - العنوان" · "المهمة الثالثة" is intentionally not parsed (digits only) */
const TASK_HEAD = /^[ \t]*(?:#{1,5}[ \t]*)?(?:\*\*)?[ \t]*(?:task|part|question|q|step|مهمة|المهمة|المهمّة|السؤال|الجزء)[ \t]*(\d{1,2})[ \t]*(?:\*\*)?[ \t]*(?:[—–:.)\-]+[ \t]*)?(?:\*\*)?(.*?)(?:\*\*)?[ \t]*$/i;
/* a heading that closes the task block (global requirements that follow the last task) */
const GLOBAL_HEAD = /^[ \t]*(?:#{1,5}[ \t]*)?(?:\*\*)?[ \t]*(?:strict response requirements|response requirements|general requirements|output requirements|grading|scoring|rubric|متطلبات الإجابة|شروط الإجابة|ضوابط الإجابة)\b/i;
const REQUIRED_HEAD = /^[ \t]*(?:#{1,5}[ \t]*)?(?:\*\*)?[ \t]*(?:required tasks|your tasks|tasks|المطلوب|المهام المطلوبة|المهام)[ \t]*[:：]?(?:\*\*)?[ \t]*$/i;
const IMPERATIVE = /^(?:explain|identify|discuss|determine|evaluate|construct|design|list|provide|describe|interpret|analy[sz]e|compare|distinguish|outline|state|justify|recommend|prioriti[sz]e|address|rank|calculate|اشرح|حدد|ناقش|قيّم|قيم|صمّم|صمم|اذكر|فسّر|فسر|قارن|ميّز|ميز|حلّل|حلل|رتّب|رتب|احسب)\b/i;
const BULLET = /^[ \t]*(?:[-*•▪◦]|\d{1,2}[.)]|\([a-hA-H1-9]\)|[a-hA-H][.)])[ \t]+(.+)$/;

const STOP = new Set(("about above after again against also among and any are because been before being below between both but can could did does doing down during each either else even every for from further had has have having here how into its itself just least less may might more most much must neither nor not now off once only onto other our out over own per rather same shall should since some such than that the their them then there these they this those through thus too under until upon very was were what when where whether which while who whom why will with within without would you your " +
  "explain identify discuss determine evaluate construct design list provide describe interpret analyze analyse compare distinguish outline state justify recommend prioritize prioritise address rank calculate specify include including explicitly clearly precisely separately specific specifically " +
  "اشرح حدد ناقش قيم فسر قارن ميز حلل رتب احسب اذكر على إلى عن من في مع هذا هذه التي الذي ذلك كما لكن أو ثم قد لا ما هل كل بين").split(/\s+/));

const stem = (w) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "").slice(0, 6);
export function distinctiveTokens(text, max = 6) {
  const seen = new Set();
  const out = [];
  for (const raw of String(text || "").split(/[\s/,;:()\-–—]+/)) {
    const w = raw.replace(/[^\p{L}\p{N}]/gu, "");
    if (w.length < 4 && !/^[A-Z0-9]{3,}$/.test(w)) continue;      // keep acronyms (CAPS, DSA, TMA, INR) even when short
    if (STOP.has(w.toLowerCase())) continue;
    const s = stem(w);
    if (s.length < 3 || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

const WORD_LIMIT = /(?:no more than|not more than|at most|maximum(?: of)?|max\.?|within|under|up to|not exceed(?:ing)?|لا تزيد عن|لا يزيد عن|بحد أقصى|في حدود|أقصاها)\s+(\d{2,4})\s*(?:words?|كلمة|كلمات)/i;
const DOMAINS = [
  ["nephrology", /\b(?:nephro\w*|kidney|renal|dialysis|glomerul\w*)\b|كلى|كلية/i],
  ["hematology", /\b(?:hemato\w*|haemato\w*|thrombo\w*|coagul\w*|anemia|anaemia|platelet|hemoly\w*)\b|دم|تجلط/i],
  ["rheumatology", /\b(?:rheumat\w*|lupus|SLE|vasculitis|antiphospholipid|APS)\b|روماتيزم|ذئبة/i],
  ["transplant", /\b(?:transplant\w*|allograft|graft|rejection|immunosuppress\w*)\b|زراعة/i],
  ["critical care", /\b(?:critical care|intensive care|ICU|shock|ventilat\w*|vasopressor)\b|عناية مركزة/i],
  ["infectious disease", /\b(?:infectious|infection|sepsis|antimicrobial|antibiotic|culture|pathogen)\b|عدوى|مضاد حيوي/i],
  ["pharmacology", /\b(?:pharmaco\w*|drug interaction|CYP\w*|dose|dosing|trough)\b|صيدلة|دوائي/i],
  ["cardiology", /\b(?:cardio\w*|myocard\w*|arrhythm\w*|heart failure)\b|قلب/i],
  ["neurology", /\b(?:neuro\w*|stroke|seizure|encephal\w*)\b|أعصاب|سكتة/i],
  ["oncology", /\b(?:onco\w*|chemotherapy|malignan\w*|tumou?r)\b|أورام/i],
  ["obstetrics", /\b(?:obstetric\w*|pregnan\w*|gestation\w*|preeclampsia)\b|حمل/i],
  ["pediatrics", /\b(?:pediatric\w*|paediatric\w*|neonat\w*|infant)\b|أطفال/i],
];

function splitBlocks(lines) {
  const heads = [];
  lines.forEach((ln, i) => { const m = TASK_HEAD.exec(ln); if (m && Number(m[1]) >= 1 && ln.trim().length < 220) heads.push({ i, n: Number(m[1]), title: (m[2] || "").replace(/[*#]+/g, "").trim() }); });
  /* a real contract numbers its tasks 1,2,3… in order; this rejects "Step 2 of the algorithm" style prose */
  const seq = [];
  for (const h of heads) { if (!seq.length ? h.n <= 2 : h.n === seq[seq.length - 1].n + 1) seq.push(h); }
  return seq;
}

/* secondary form: a "Required tasks" / "المطلوب" header followed by ≥3 imperative numbered lines */
function numberedList(lines) {
  for (let i = 0; i < lines.length; i++) {
    if (!REQUIRED_HEAD.test(lines[i])) continue;
    const items = [];
    for (let j = i + 1; j < lines.length && items.length < 20; j++) {
      const m = /^[ \t]*(\d{1,2})[.)][ \t]+(.{12,})$/.exec(lines[j]);
      if (m && Number(m[1]) === items.length + 1) items.push({ i: j, n: Number(m[1]), title: m[2].trim() });
      else if (lines[j].trim() === "" || /^[ \t]+\S/.test(lines[j])) continue;
      else if (items.length) break;
    }
    if (items.length >= 3 && items.filter((x) => IMPERATIVE.test(x.title)).length >= Math.ceil(items.length / 2)) return items;
  }
  return [];
}

export function parseTaskContract(source) {
  const text = norm(source);
  const none = { active: false, tasks: [], constraints: [], complexity: { score: 0, level: "none", reasons: [] }, domains: [], preamble: "" };
  if (!text || text.length < 120) return none;
  const lines = text.split("\n");
  let heads = splitBlocks(lines);
  let form = "labelled";
  if (heads.length < 2) { heads = numberedList(lines); form = "numbered"; }
  if (heads.length < 2) return { ...none, complexity: scoreComplexity(text, 0) };

  const endAt = (() => { const g = lines.findIndex((l, i) => i > heads[heads.length - 1].i && GLOBAL_HEAD.test(l)); return g < 0 ? lines.length : g; })();
  const tasks = heads.map((h, k) => {
    const to = k + 1 < heads.length ? heads[k + 1].i : endAt;
    const body = lines.slice(h.i + 1, to).join("\n").trim();
    const requirements = [];
    for (const ln of body.split("\n")) {
      const b = BULLET.exec(ln);
      if (b && b[1].trim().length >= 6) requirements.push(b[1].replace(/\*\*/g, "").trim());
      else if (/[:：]\s*$/.test(ln.trim()) && ln.trim().length > 8) requirements.push(ln.replace(/\*\*/g, "").replace(/[:：]\s*$/, "").trim());
    }
    const wl = WORD_LIMIT.exec(`${h.title}\n${body}`);
    const items = buildItems(h.n, h.title || `Task ${h.n}`, form === "numbered" ? "" : body);
    return {
      items,
      id: `T${h.n}`, number: h.n, title: h.title || `Task ${h.n}`,
      body: form === "numbered" ? h.title : body,
      requirements: [...new Set(requirements)].slice(0, 24),
      wordLimit: wl ? Number(wl[1]) : null,
    };
  });

  const globalBlock = endAt < lines.length ? lines.slice(endAt).join("\n") : "";
  const constraints = [];
  for (const ln of globalBlock.split("\n")) {
    const b = BULLET.exec(ln) || /^[ \t]*(.{12,})$/.exec(ln);
    const t = b ? b[1].replace(/\*\*/g, "").trim() : "";
    if (t && !GLOBAL_HEAD.test(ln) && t.length >= 12) constraints.push(t);
  }
  for (const ln of lines) if (/^\s*(?:do not|don't|never|must not|avoid|لا )/i.test(ln.replace(/^[ \t]*[-*•]\s*/, "")) && ln.trim().length > 15 && !constraints.includes(ln.replace(/^[ \t]*[-*•]\s*/, "").trim())) constraints.push(ln.replace(/^[ \t]*[-*•]\s*/, "").trim());
  const preamble = lines.slice(0, heads[0].i).join("\n").trim();
  const domains = DOMAINS.filter(([, re]) => re.test(text)).map(([d]) => d);
  const complexity = scoreComplexity(text, tasks.length, domains.length);
  const active = tasks.length >= 3 || (tasks.length >= 2 && complexity.score >= 3);
  return { active, form, tasks, constraints: constraints.slice(0, 16), complexity, domains, preamble: preamble.slice(0, 12000) };
}

function scoreComplexity(text, taskCount, domainCount = DOMAINS.filter(([, re]) => re.test(text)).length) {
  const reasons = [];
  let score = 0;
  if (taskCount >= 3) { score += 2; reasons.push(`${taskCount} prescribed tasks`); }
  if (taskCount >= 6) { score += 1; reasons.push("six or more tasks"); }
  if (text.length >= 2500) { score += 1; reasons.push("long case"); }
  if (domainCount >= 3) { score += 1; reasons.push(`${domainCount} specialties`); }
  if (/\b(?:consultant|expert[- ]level|adversarial|multidisciplinary|tertiary|board[- ]level)\b|استشاري|متعدد التخصصات/i.test(text)) { score += 1; reasons.push("expert framing"); }
  if (/\b(?:cite|citation|guideline|primary literature|current,? authoritative)\b|استشهد|المراجع/i.test(text)) { score += 1; reasons.push("evidence/citation required"); }
  return { score, level: score >= 5 ? "expert" : score >= 3 ? "advanced" : score >= 1 ? "standard" : "none", reasons };
}

/* contiguous groups of tasks, as even as possible, in contract order */
export function planGroups(contract, { maxGroups = 4, tasksPerGroup = 3 } = {}) {
  const tasks = contract && contract.tasks ? contract.tasks : [];
  if (!tasks.length) return [];
  const g = Math.max(1, Math.min(maxGroups, Math.ceil(tasks.length / tasksPerGroup)));
  const base = Math.floor(tasks.length / g), rem = tasks.length % g;
  const out = [];
  let at = 0;
  for (let k = 0; k < g; k++) { const size = base + (k < rem ? 1 : 0); out.push(tasks.slice(at, at + size)); at += size; }
  return out;
}

/* the section of the answer that belongs to task n ("## Task 3 — …" or "## المهمة 3"), up to the next task heading */
const SECTION_HEAD = /^[ \t]*#{1,5}[ \t]*(?:\*\*)?[ \t]*(?:[^\n\d]{0,12})?(?:task|part|مهمة|المهمة|المهمّة)[ \t]*(\d{1,2})\b.*$/gim;
export function answerSections(answer) {
  const text = norm(answer);
  const marks = [];
  let m;
  SECTION_HEAD.lastIndex = 0;
  while ((m = SECTION_HEAD.exec(text))) marks.push({ n: Number(m[1]), at: m.index, end: m.index + m[0].length });
  const by = new Map();
  marks.forEach((mk, k) => { const body = text.slice(mk.end, k + 1 < marks.length ? marks[k + 1].at : text.length); by.set(mk.n, (by.get(mk.n) || "") + "\n" + body); });
  return by;
}


/* split an answer into its "## Task N" sections (heading line kept) so a repair run can replace ONE task without touching the others */
export function splitTaskSections(answer) {
  const text = norm(answer);
  const marks = [];
  let m;
  SECTION_HEAD.lastIndex = 0;
  while ((m = SECTION_HEAD.exec(text))) marks.push({ n: Number(m[1]), at: m.index });
  if (!marks.length) return { pre: text.trim(), items: [] };
  const items = marks.map((mk, k) => ({ n: mk.n, text: text.slice(mk.at, k + 1 < marks.length ? marks[k + 1].at : text.length).trim() }));
  return { pre: text.slice(0, marks[0].at).trim(), items };
}

/* extra's sections replace base's sections of the same number; the result is in task order and never duplicates a heading */
export function mergeTaskSections(base, extra) {
  const a = splitTaskSections(base), b = splitTaskSections(extra);
  const by = new Map();
  for (const it of a.items) by.set(it.n, by.has(it.n) ? `${by.get(it.n)}\n\n${it.text}` : it.text);
  for (const it of b.items) by.set(it.n, it.text);
  const body = [...by.entries()].sort((x, y) => x[0] - y[0]).map(([, t]) => t).join("\n\n");
  return [a.pre, body].filter(Boolean).join("\n\n");
}

const countWords = (s) => (String(s || "").match(/[\p{L}\p{N}][\p{L}\p{N}'’.\-/]*/gu) || []).length;

/* ───────────── v3.69 · ITEM MODEL ─────────────
   A task is not one blob: it is an ordered list of ITEMS the answer must contain. The item is the unit of
   generation (the model writes `@@2.3@@ …`), of assembly (code writes the headings and labels, so they cost no output tokens and cannot drift),
   of audit (present? long enough? every field named? inside its own word limit? at least N list entries?) and of repair (only the defective
   items are ever asked for again). Kinds:
     dir      a directive sentence            "Construct a problem representation in no more than 100 words."
     bullet   one listed requirement           "- Histopathological evidence."
     subject  one row of a matrix              "1. CAPS" + "For each diagnosis, specify: a, b, c, d"  → fields = [a, b, c, d]
     whole    the task has no sub-structure    "List at least ten dangerous conclusions."  (minCount = 10) */
const NUMWORD = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20 };
const MIN_COUNT = /\b(?:at least|no fewer than|not fewer than|a minimum of|minimum of|على الأقل)\s+(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty)\b/i;
const FOR_EACH = /^(?:for\s+(?:each|every)\b|لكل\b)/i;
const minCountOf = (t) => { const m = MIN_COUNT.exec(t || ""); if (!m) return null; const v = /^\d/.test(m[1]) ? Number(m[1]) : NUMWORD[m[1].toLowerCase()]; return v >= 2 ? v : null; };
const limitOf = (t) => { const m = WORD_LIMIT.exec(t || ""); return m ? Number(m[1]) : null; };

export function buildItems(n, title, body) {
  const parts = [];                       // {type:"dir", t} | {type:"group", lead, bullets[]}
  let cur = null;
  for (const raw of String(body || "").split("\n")) {
    const clean = raw.replace(/\*\*/g, "");
    const ln = clean.trim();
    if (!ln) continue;
    const b = BULLET.exec(clean);
    if (b && b[1].trim().length >= 4) {
      if (!cur) { cur = { type: "group", lead: "", bullets: [] }; parts.push(cur); }
      cur.bullets.push(b[1].trim());
    } else if (/[:：]$/.test(ln)) {
      cur = { type: "group", lead: ln.replace(/[:：]$/, "").trim(), bullets: [] };
      parts.push(cur);
    } else {
      cur = null;
      for (const sent of ln.split(/(?<=[.!?؟])\s+/)) if (sent.trim().length >= 12) parts.push({ type: "dir", t: sent.trim() });
    }
  }
  const items = [];
  let i = 0;
  const add = (o) => { if (items.length < 40) items.push({ key: `${n}.${++i}`, ...o }); };
  for (let k = 0; k < parts.length; k++) {
    const p = parts[k];
    if (p.type === "dir") { add({ kind: "dir", label: p.t, limit: limitOf(p.t), minCount: minCountOf(p.t) }); continue; }
    const next = parts[k + 1];
    const isMatrix = p.bullets.length >= 2 && next && next.type === "group" && FOR_EACH.test(next.lead) && next.bullets.length >= 1;
    if (isMatrix) { p.bullets.forEach((subj) => add({ kind: "subject", label: subj, fields: next.bullets.slice(0, 8), lead: p.lead })); k++; continue; }
    if (!p.bullets.length) { add({ kind: "dir", label: p.lead, limit: limitOf(p.lead), minCount: minCountOf(p.lead) }); continue; }
    p.bullets.forEach((bl) => add({ kind: "bullet", label: bl, lead: p.lead, limit: limitOf(bl), minCount: minCountOf(bl) }));
  }
  if (!items.length) add({ kind: "whole", label: title, limit: limitOf(`${title}\n${body}`), minCount: minCountOf(`${title}\n${body}`) });
  /* a lone directive that carries the task's list requirement ("List at least ten …") keeps it */
  if (items.length === 1 && !items[0].minCount) items[0].minCount = minCountOf(body);
  return items;
}

/* words a defensible answer to the item needs (a floor, not a target) */
const floorWords = (it) => (it.kind === "subject" ? Math.min(120, 9 * (it.fields || []).length + 12) : it.kind === "whole" ? 40 : it.limit ? Math.min(30, Math.round(it.limit * 0.4)) : it.minCount ? 8 * it.minCount : 14);
/* soft target the prompt gives the writer, from the total number of items so that the whole answer stays near `budget` words */
export function targetWords(contract, it, budget = 3800) {
  const all = (contract.tasks || []).flatMap((t) => t.items || []);
  const weight = (x) => (x.kind === "subject" ? 1.8 : x.kind === "whole" ? 2.2 : x.minCount ? 1 + x.minCount * 0.35 : 1);
  const total = all.reduce((n, x) => n + weight(x), 0) || 1;
  const w = Math.round((budget * weight(it)) / total);
  const capped = it.limit ? Math.min(w, it.limit) : w;
  return Math.max(30, Math.min(220, capped));
}

const KEY_LINE = /^[ \t]*@@[ \t]*([0-9]{1,2}\.[0-9]{1,2}|TRICKS)[ \t]*@@[ \t]*(.*)$/;
/* model output → Map(key → text); `@@2.3@@` on its own line (inline text after the marker is kept). Unknown keys are ignored; a repeated key keeps the longer text. */
export function parseItemOutput(raw, contract) {
  const known = new Set((contract && contract.tasks || []).flatMap((t) => (t.items || []).map((x) => x.key)));
  known.add("TRICKS");
  const out = new Map();
  let key = null, buf = [];
  const flush = () => { if (key && known.has(key)) { const t = buf.join("\n").trim(); if (t && (!out.has(key) || t.length > out.get(key).length)) out.set(key, t); } };
  for (const ln of norm(raw).replace(/^```[a-z]*\n?|\n?```$/gim, "").split("\n")) {
    const m = KEY_LINE.exec(ln);
    if (m) { flush(); key = m[1]; buf = m[2] ? [m[2]] : []; } else if (key) buf.push(ln);
  }
  flush();
  return out;
}

const bodyLines = (t) => String(t || "").split("\n").filter((l) => /^\s*(?:[-*•]|\d{1,2}[.)])\s+\S/.test(l)).length;

/* item-level audit → { complete, missing[key], thin[{key,words,need}], limit[{key,limit,words}], fields[{key,missing[]}], count[{key,need,have}] } */
export function auditItems(contract, map) {
  const r = { complete: true, missing: [], thin: [], limit: [], fields: [], count: [] };
  for (const t of (contract && contract.tasks) || []) for (const it of t.items || []) {
    const body = map.get(it.key);
    if (!body || !body.trim()) { r.missing.push(it.key); continue; }
    const w = countWords(body), need = floorWords(it);
    if (w < need) r.thin.push({ key: it.key, words: w, need });
    if (it.limit && w > Math.round(it.limit * 1.35) + 25) r.limit.push({ key: it.key, limit: it.limit, words: w });
    if (it.minCount && bodyLines(body) < it.minCount) r.count.push({ key: it.key, need: it.minCount, have: bodyLines(body) });
    if (it.kind === "subject") {
      const low = body.toLowerCase();
      const miss = it.fields.filter((f) => { const tk = distinctiveTokens(f, 4); return tk.length && !tk.some((x) => low.includes(x)); });
      if (miss.length) r.fields.push({ key: it.key, missing: miss });
    }
  }
  r.complete = !r.missing.length && !r.thin.length && !r.limit.length && !r.fields.length && !r.count.length;
  return r;
}

/* the keys an audit says must be (re)written, with the reason (the reason goes into the repair prompt) */
export function defects(audit) {
  const d = new Map();
  const put = (k, m) => d.set(k, [...(d.get(k) || []), m]);
  audit.missing.forEach((k) => put(k, "MISSING: write it in full"));
  audit.thin.forEach((x) => put(x.key, `TOO THIN (${x.words} words, needs about ${x.need}+): develop it with specific evidence`));
  audit.limit.forEach((x) => put(x.key, `OVER ITS LIMIT (${x.words} words, hard limit ${x.limit}): rewrite inside the limit`));
  audit.count.forEach((x) => put(x.key, `LIST TOO SHORT (${x.have} entries, the request needs at least ${x.need}): complete the list`));
  audit.fields.forEach((x) => put(x.key, `FIELDS NOT ADDRESSED: ${x.missing.join(" | ")}`));
  return d;
}

/* code writes the headings and the labels: they cost no output tokens and the model cannot drift from the contract's wording */
export function assembleAnswer(contract, map) {
  const out = [];
  for (const t of (contract && contract.tasks) || []) {
    const rows = [`## Task ${t.number} — ${t.title}`];
    let any = false;
    const labelled = (t.items || []).length > 1;
    for (const it of t.items || []) {
      const body = map.get(it.key);
      if (!body) continue;
      any = true;
      if (it.kind === "bullet" || it.kind === "subject") rows.push(`**${it.label.replace(/\*\*/g, "").slice(0, 160)}**`);
      else if (it.kind === "dir" && labelled && it.label.length <= 90) rows.push(`**${it.label.replace(/[.:]$/, "")}**`);
      rows.push(body.trim());
    }
    if (any) out.push(rows.join("\n"));
  }
  return out.join("\n\n");
}

/* the item a sentence of the assembled answer came from: used to send a flagged sentence's item to the repair request */
export function itemOfSentence(contract, map, sentence) {
  const needle = String(sentence || "").slice(0, 60);
  if (!needle) return null;
  for (const [k, v] of map) if (k !== "TRICKS" && v.includes(needle)) return k;
  return null;
}

/* → { complete, missingTasks[], thinTasks[], uncovered[{task, requirement}], limitViolations[{task, limit, words}] } */
export function auditContractCoverage(contract, answer) {
  const secs = answerSections(answer);
  const res = { complete: true, missingTasks: [], thinTasks: [], uncovered: [], limitViolations: [] };
  if (!contract || !contract.tasks || !contract.tasks.length) return res;
  for (const t of contract.tasks) {
    const body = secs.get(t.number);
    if (!body || !body.trim()) { res.missingTasks.push(t.number); continue; }
    const words = countWords(body);
    const need = t.wordLimit ? Math.min(30, Math.round(t.wordLimit * 0.4)) : Math.max(60, Math.min(260, 28 * Math.max(1, t.requirements.length)));
    if (words < need) res.thinTasks.push({ task: t.number, words, need });
    if (t.wordLimit && words > Math.round(t.wordLimit * 1.35) + 25) res.limitViolations.push({ task: t.number, limit: t.wordLimit, words });
    const low = body.toLowerCase();
    for (const r of t.requirements) {
      const tokens = distinctiveTokens(r, 6);
      if (tokens.length < 2) continue;
      const hit = tokens.filter((k) => low.includes(k)).length;
      if (hit < Math.min(2, tokens.length)) res.uncovered.push({ task: t.number, requirement: r.slice(0, 140) });
    }
  }
  res.complete = !res.missingTasks.length && !res.thinTasks.length;
  return res;
}

/* what the user sees when the audit still finds gaps after one repair attempt (never hidden, never softened) */
export function formatCoverageNotice(audit, contract, lang = "ar") {
  if (!audit) return "";
  const rows = [];
  const label = (n) => { const t = (contract.tasks || []).find((x) => x.number === n); return t ? `Task ${n} — ${t.title}` : `Task ${n}`; };
  if (audit.missingTasks.length) rows.push(lang === "en" ? `Not answered: ${audit.missingTasks.map(label).join("; ")}.` : `لم تُكتب إجابتها: ${audit.missingTasks.map(label).join("؛ ")}.`);
  if (audit.thinTasks.length) rows.push(lang === "en" ? `Too thin to rely on: ${audit.thinTasks.map((x) => label(x.task)).join("; ")}.` : `مختصرة أكثر من اللازم: ${audit.thinTasks.map((x) => label(x.task)).join("؛ ")}.`);
  if (audit.limitViolations.length) rows.push(lang === "en" ? `Over the stated word limit: ${audit.limitViolations.map((x) => `Task ${x.task} (${x.words}/${x.limit})`).join("; ")}.` : `تجاوزت حد الكلمات المطلوب: ${audit.limitViolations.map((x) => `Task ${x.task} (${x.words}/${x.limit})`).join("؛ ")}.`);
  if (audit.uncovered.length) {
    const byTask = new Map();
    audit.uncovered.forEach((u) => byTask.set(u.task, (byTask.get(u.task) || 0) + 1));
    rows.push(lang === "en" ? `Requirements that may not be addressed: ${[...byTask].map(([t, c]) => `Task ${t} (${c})`).join(", ")}.` : `بنود مطلوبة قد لا تكون غُطّيت: ${[...byTask].map(([t, c]) => `Task ${t} (${c})`).join("، ")}.`);
  }
  if (!rows.length) return "";
  const head = lang === "en" ? "## ⚠️ Completeness check (automatic)" : "## ⚠️ فحص اكتمال الإجابة (آلي)";
  const tail = lang === "en" ? "This check is lexical: it shows that a part is missing or thin, not that the written content is correct." : "الفحص لفظي: يكشف الأجزاء الناقصة أو المختصرة، ولا يثبت صحة المحتوى المكتوب.";
  return `${head}\n${rows.map((r) => `- ${r}`).join("\n")}\n${tail}`;
}
