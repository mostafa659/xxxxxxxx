/* ───────────── lib/kb/rules.js · the concept-rule engine (v3.44) ─────────────
   ~500 rules cannot be 500 regexes run on every sentence (slow) or 500 free-text triggers (false positives). A rule here is DATA with required anchors:

     subj   the thing the sentence must be ABOUT (aliases; EN + AR)                       ← anchor, always required
     cue    optional context words that must also be present ("antidote", "toxicity")      ← disambiguator
     truth  what a correct statement says
     wrong  what a classic wrong statement says (explicit list), or "@" = the truths of the OTHER rules of the same slot
             (so «antidote for heparin is vitamin K» is caught because vitamin K is warfarin's antidote — authored once, collisions found by the audit)
   A rule fires a CONFLICT only when: subject ∧ cue ∧ a wrong term NEAR the subject ∧ no truth term ∧ no negation before the wrong term ∧ (slot-wrong: the
   wrong term's own owner is not also in the sentence, i.e. the sentence is not a comparison). It fires SUPPORT when subject ∧ cue ∧ truth ∧ no wrong term.
   Numeric rules (#) say "X has N <noun>" and conflict when the sentence gives another number next to the noun.
   Lookup is O(candidates): a token → rule-ids inverted index built once per loaded module set; a sentence touches only the rules that share a token with it.

   Authoring format (one rule per line, fields separated by « ; », alternatives by « | »):
       slot ; subj ; cue ; truth ; wrong ; fix
       #slot ; subj ; noun ; value ; ; fix
   `fix` may be empty for templated slots (antidote, class, …). Lines starting with // are comments; « == domain » switches the domain label. */
import { norm } from "../accuracy.js";

/* ── normalisation: lower-case, Arabic-folded, punctuation → space, crude plural stem; the SAME function runs on rule terms and on sentences ── */
const stemWord = (w) => {
  if (w.length > 5 && /^ال[\u0621-\u064A]/.test(w)) w = w.slice(2);                // الهيبارين → هيبارين
  if (w.length <= 3 || !w.endsWith("s") || w.endsWith("ss") || w.endsWith("us") || w.endsWith("is")) return w;
  if (/(?:x|ch|sh|z)es$/.test(w)) return w.slice(0, -2);        // relaxes → relax, reaches → reach
  return w.slice(0, -1);
};
const DROP = new Set(["the"]);                                   // «raises the blood glucose» = «raises blood glucose»
export const normTerm = (s) => {
  const t = norm(s).replace(/[\u2019\u0027`]/g, "").replace(/[^a-z0-9\u0621-\u064A.%]+/g, " ").replace(/\.(?!\d)/g, " ").trim();
  if (!t) return "";
  const w = t.split(/\s+/);
  const out = [];
  for (let i = 0; i < w.length; i++) { if (DROP.has(w[i])) continue; out.push(stemWord(w[i])); }
  return out.join(" ");
};
export const padded = (s) => ` ${normTerm(s)} `;

const NEG = new Set(["nothing", "not", "no", "never", "cannot", "neither", "nor", "without", "isnt", "arent", "dont", "doesnt", "wont", "cant", "unlike", "rather", "instead", "لا", "مش", "ليس", "غير", "وليس", "بدون", "مفيش"]);
const NEG_PHRASES = [" is not ", " are not ", " does not ", " do not ", " rather than ", " instead of ", " as opposed to ", " is n t ", " isn t ", " aren t ", " doesn t ", " don t ", " can t ", " won t "];
const MAX_GAP = 140;                                     // characters between the subject and the wrong term (same clause)

/* shared cue lists (« $ad » in a cue field) so a rule line stays one short line */
export const MACROS = {
  ad: "antidote|reversal|reverse|reverses|counteract|treat|treatment|treated|overdose|toxicity|poisoning|antagonist|given for|given in|ترياق|عكس مفعول|مضاد|جرعة زائدة|تسمم|علاج",
  cls: "is a|is an|class|classified|belongs|type of|category|drug class|family of|فئة|نوع من|مجموعة|تصنيف|بينتمي",
  eff: "cause|caused|can cause|side effect|adverse|toxicity|risk of|lead to|monitor for|complication|monitor|monitored|monitoring|watch for|due to|بيسبب|يسبب|تسبب|اثار جانبيه|مضاعفات|سميه",
  sign: "sign|symptom|manifestation|present|characterized|cause|caused|due to|secondary to|result from|lead to|result|ecg|finding|expect|assess|feature|علامات|اعراض|بيسبب|يسبب|بتظهر",
  tx: "treat|treatment|treated|first|priority|management|manage|intervention|shock|shockable|initial|immediate|next|indicated|give|given|apply|perform|nursing|should|care|teach|instruct|advise|avoid|position",
  phys: "cause|caused|effect|increase|decrease|result|lead to|response|stimulat|activation|produce|release|raise|lower|do|does",
};
const macro = (s) => String(s || "").replace(/\$([a-z]+)/g, (m, k) => MACROS[k] || m);
const splitTerms = (s) => macro(s).split("|").map((x) => normTerm(x)).filter(Boolean);

/* ── parse ── */
export function parseRules(text, domain = "misc", startIndex = 0) {
  const rules = [];
  let dom = domain, n = startIndex;
  for (const raw of String(text).split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("//")) continue;
    if (line.startsWith("==")) { dom = line.replace(/^==\s*/, "").trim(); continue; }
    const f = line.split(";").map((x) => x.trim());
    while (f.length > 4 && f[f.length - 1] === "") f.pop();          // a trailing «;» is allowed
    const numeric = f[0].startsWith("#");
    const slot = f[0].replace(/^#/, "");
    if (f.length < 4 || f.length > 7) throw new Error(`bad rule line (${f.length} fields; a «;» inside a fix text?): ${line.slice(0, 120)}`);
    const rule = { id: `${dom}.${n++}`, domain: dom, slot, raw: line, ...(/guideline$/.test(dom) ? { guideline: true } : {}) };
    if (numeric) Object.assign(rule, { type: "num", subj: splitTerms(f[1]), noun: splitTerms(f[2]), value: parseFloat(f[3]), fix: f[5] || "" });
    else Object.assign(rule, { type: "assoc", subj: splitTerms(f[1]), cue: splitTerms(f[2]), truth: splitTerms(f[3]), wrong: f[4] === "@" ? "@" : f[4] === "-" ? [] : splitTerms(f[4]), supportOnly: f[4] === "-", fix: f[5] || "", skip: splitTerms(f[6] || ""), subjRaw: f[1].split("|")[0].trim(), truthRaw: f[3].split("|")[0].trim() });
    rules.push(rule);
  }
  return rules;
}

/* ── the index over every loaded rule ── */
export function buildRuleIndex(rules) {
  const inv = new Map();                                 // token → rule ids (by subject anchor)
  const slots = new Map();                               // slot → [{rule, term}] truths
  const add = (tok, i) => { let a = inv.get(tok); if (!a) inv.set(tok, (a = [])); if (a[a.length - 1] !== i) a.push(i); };
  rules.forEach((r, i) => {
    for (const s of r.subj) { const toks = s.split(" "); add(toks.reduce((b, t) => (t.length > b.length ? t : b), ""), i); }       // the most distinctive word of every alias
    if (r.type === "assoc") for (const t of r.truth) { if (!slots.has(r.slot)) slots.set(r.slot, []); slots.get(r.slot).push({ rule: r, term: t }); }
  });
  // token → truth terms of the slot (so an owner lookup touches a handful of terms, not every rule)
  const truthTok = new Map();
  for (const r of rules) if (r.type === "assoc") for (const t of r.truth) for (const tok of new Set(t.split(" "))) { const k = `${r.slot}|${tok}`; let a = truthTok.get(k); if (!a) truthTok.set(k, (a = [])); a.push({ term: t, rule: r }); }
  // slot-wrong lists: the truths of the other rules of the slot that do not overlap this rule's own truths
  for (const r of rules) {
    if (r.type === "assoc" && r.wrong !== "@") {
      r.wrongOwners = new Map();
      for (const w of r.wrong) {
        const seen = new Set(), owners = [];
        for (const tok of w.split(" ")) for (const c of (truthTok.get(`${r.slot}|${tok}`) || [])) {
          if (c.rule === r || seen.has(c.rule)) continue;
          if (c.term === w || (c.term.length > 5 && w.length > 5 && (c.term.includes(w) || w.includes(c.term)))) { seen.add(c.rule); owners.push(c.rule); }
        }
        r.wrongOwners.set(w, owners);
      }
    }
    if (r.type !== "assoc" || r.wrong !== "@") continue;
    const own = r.truth.join(" | ");
    r.wrongList = (slots.get(r.slot) || []).filter((x) => x.rule !== r && !r.truth.some((t) => x.term === t || x.term.includes(t) || t.includes(x.term)) && !own.includes(x.term)).map((x) => ({ term: x.term, owner: x.rule }));
  }
  return { rules, inv, slots };
}

const has = (S, t) => S.includes(` ${t} `);
/* position of a term that lies OUTSIDE the subject phrase («neostigmine overdose» must not count «neostigmine» as a separate wrong term), or -1 */
const posOutside = (S, term, sp, slen) => { let from = 0, p; while ((p = S.indexOf(` ${term} `, from)) >= 0) { if (p < sp || p >= sp + slen + 1) return p; from = p + 1; } return -1; };
const at = (S, t) => S.indexOf(` ${t} `);
/* negation anywhere in the span that joins the subject and the wrong term (plus a few words before the earlier one): «naloxone does NOT reverse benzodiazepine sedation» */
const negBetween = (S, p1, p2, len2) => {
  const lo = Math.max(0, Math.min(p1, p2) - 24), hi = Math.max(p1, p2) + len2 + 1;
  const span = S.slice(lo, hi);
  return NEG_PHRASES.some((p) => span.includes(p)) || span.trim().split(" ").some((w) => NEG.has(w));
};
/* slots whose statements describe effects / signs: «used to TREAT hypokalemia» is not a claim that the drug CAUSES it */
const SKIP_DEFAULT = ["treat", "treated", "prevent", "correct", "manage", "indicated", "reverse", "therapy for", "used to", "used for", "relieve", "improve", "reduce", "resolve", "unlike", "compared", "versus", "differ", "whereas", "while", "in contrast", "however"].map((x) => normTerm(x));
const NO_SKIP = new Set(["antidote", "class", "tx"]);

const NUMW = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, twenty: 20, thirty: 30, "اتنين": 2, "اثنين": 2, "ثلاثه": 3, "اربعه": 4, "خمسه": 5, "سته": 6, "سبعه": 7, "ثمانيه": 8, "تسعه": 9, "عشره": 10 };
const numOf = (w) => (/^\d+(?:\.\d+)?$/.test(w) ? parseFloat(w) : NUMW[w] !== undefined ? NUMW[w] : null);

/* → [{ rule, kind: "conflict"|"support", fix, subj, term }] for ONE sentence (already padded-normalised S, token array T) */
export function matchSentence(index, S, T) {
  const out = [];
  const seen = new Set();
  for (const tok of T) {
    const ids = index.inv.get(tok);
    if (!ids) continue;
    for (const i of ids) {
      if (seen.has(i)) continue;
      seen.add(i);
      const r = index.rules[i];
      const subj = r.subj.find((s) => has(S, s));
      if (!subj) continue;
      if (r.type === "num") {
        /* every occurrence of the noun that sits near the subject; support when ANY has the value, conflict only when numbers are given and none matches */
        const sp0 = at(S, subj);
        let anyNum = false, ok = false;
        for (const n of r.noun) {
          let from = 0, p;
          while ((p = S.indexOf(` ${n} `, from)) >= 0) {
            from = p + 1;
            if (Math.abs(p - sp0) > 90) continue;
            const before = S.slice(0, p).trim().split(" ").slice(-3), after = S.slice(p + n.length + 2).trim().split(" ").slice(0, 2);
            const nums = [...before, ...after].map(numOf).filter((x) => x !== null);
            if (!nums.length) continue;
            if (/\b(?:to|and|or)\b/.test(` ${before.join(" ")} `) && nums.length > 1 && !nums.includes(r.value)) continue;     // a range ("3 to 15") is not a count
            anyNum = true; if (nums.includes(r.value)) ok = true;
          }
        }
        if (anyNum) out.push({ rule: r, kind: ok ? "support" : "conflict", fix: r.fix, subj, term: String(r.value) });
        continue;
      }
      if (r.cue.length && !r.cue.some((c) => has(S, c))) continue;
      const sp = at(S, subj);
      const truth = r.truth.find((t) => posOutside(S, t, sp, subj.length) >= 0);
      let wrong = null;
      const cands = r.wrong === "@" ? (r.wrongList || []) : r.wrong.map((t) => ({ term: t, owner: null, owners: r.wrongOwners ? r.wrongOwners.get(t) : null }));
      for (const w of cands) {
        const wp = posOutside(S, w.term, sp, subj.length);
        if (wp < 0) continue;
        if (Math.abs(wp - sp) > MAX_GAP) continue;
        if (w.owner && w.owner.subj.some((s) => has(S, s))) continue;          // a comparison: the wrong term's own subject is here too
        if (w.owners && w.owners.some((o) => o.subj.some((s) => has(S, s)))) continue;
        if (negBetween(S, sp, wp, w.term.length)) continue;
        wrong = w; break;
      }
      if (wrong && !truth && !(NO_SKIP.has(r.slot) ? false : SKIP_DEFAULT.some((k) => has(S, k))) && !(r.skip && r.skip.some((k) => has(S, k)))) out.push({ rule: r, kind: "conflict", fix: fixOf(r), subj, term: wrong.term });
      else if (truth && !wrong) out.push({ rule: r, kind: "support", fix: fixOf(r), subj, term: truth });
    }
  }
  return out;
}

const SLOT_FIX = {
  antidote: (r) => `The antidote for ${r.subjRaw} is ${r.truthRaw}.`,
  class: (r) => `${cap(r.subjRaw)} is ${/^[aeiou]/i.test(r.truthRaw) ? "an" : "a"} ${r.truthRaw}.`,
};
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
export const fixOf = (r) => r.fix || (SLOT_FIX[r.slot] ? SLOT_FIX[r.slot](r) : `${cap(r.subjRaw)}: ${r.truthRaw}.`);

/* ── the audit: everything that can go wrong with ~600 rules, found by code (used by tests/kb-audit.test.mjs and `npm run kb:audit`) ── */
export function auditRules(rules) {
  const errs = [], warns = [];
  const ids = new Set();
  for (const r of rules) {
    if (ids.has(r.id)) errs.push(`duplicate id ${r.id}`); ids.add(r.id);
    if (!r.subj.length) errs.push(`${r.id}: no subject`);
    if (r.type === "assoc") {
      if (!r.truth.length) errs.push(`${r.id}: no truth`);
      if (r.wrong !== "@" && !r.wrong.length && !r.supportOnly) errs.push(`${r.id}: no wrong terms`);
      if (r.supportOnly && r.fix === "") warns.push(`${r.id}: support-only rule without a fix text`);
      if (r.wrong !== "@") for (const w of r.wrong) if (r.truth.some((t) => t === w)) errs.push(`${r.id}: «${w}» is both truth and wrong`);
      for (const s of r.subj) if (s.length < 3) errs.push(`${r.id}: subject «${s}» is too short to anchor`);
    } else if (!Number.isFinite(r.value) || !r.noun.length) errs.push(`${r.id}: bad numeric rule`);
  }
  // a subject has ONE antidote / ONE class: the same alias in two rules of those slots with different truths is a collision
  const by = new Map();
  for (const r of rules) if (r.type === "assoc" && (r.slot === "antidote" || r.slot === "class")) for (const s of r.subj) { const k = `${r.slot}|${s}`; if (!by.has(k)) by.set(k, []); by.get(k).push(r); }
  for (const [k, rs] of by) for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
    if (!rs[i].truth.some((t) => rs[j].truth.includes(t))) errs.push(`${rs[i].id} / ${rs[j].id}: «${k.split("|")[1]}» has two different ${k.split("|")[0]} answers`);
  }
  // numeric: one value per subject+noun
  const nv = new Map();
  for (const r of rules) if (r.type === "num") for (const s of r.subj) for (const n of r.noun) { const k = `${s}|${n}`; if (nv.has(k) && nv.get(k) !== r.value) errs.push(`${r.id}: «${k}» has two values`); nv.set(k, r.value); }
  // real contradictions: for the SAME subject alias, one rule's truth is another rule's wrong term (cues overlapping or empty)
  const subjIdx = new Map();
  for (const r of rules) if (r.type === "assoc") for (const s of r.subj) { if (!subjIdx.has(s)) subjIdx.set(s, []); subjIdx.get(s).push(r); }
  for (const [s, rs] of subjIdx) for (let i = 0; i < rs.length; i++) for (let j = 0; j < rs.length; j++) {
    if (i === j) continue;
    const a = rs[i], b = rs[j];
    if (b.wrong === "@" || a.slot !== b.slot) continue;
    const cueMeet = !a.cue.length || !b.cue.length || a.cue.some((c) => b.cue.includes(c));
    if (cueMeet && a.truth.some((t) => b.wrong.includes(t))) errs.push(`${a.id} truth contradicts ${b.id} wrong for «${s}»`);
  }
  return { errs, warns };
}
