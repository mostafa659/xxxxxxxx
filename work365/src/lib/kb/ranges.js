/* ───────────── reference-range checks (v3.43 · F2/B4/B5) ─────────────
   A lab value with its unit is compared with the KB range for the patient's SEX and AGE stratum, in SI or conventional units.
   Code only. Nothing here asks a model. A range is never applied to a stratum it does not cover. */
import { loadedFacts, inScope } from "./index.js";
import { norm } from "../accuracy.js";
import { normTerm } from "./rules.js";

const UNITS = "mmol\\/L|mEq\\/L|g\\/dL|g\\/L|mg\\/dL|µmol\\/L|umol\\/L|μmol\\/L|mg\\/L|ng\\/mL|ng\\/dL|pg\\/mL|mcg\\/mL|µg\\/mL|mcg\\/dL|µg\\/dL|mIU\\/L|IU\\/L|U\\/L|mmHg|kPa|%|bpm|beats\\/min|beats per minute|breaths\\/min|breaths per minute|\\/min|seconds|sec|fL|mL\\/min|x10\\^?9\\/L|×10\\^?9\\/L|\\/mm3|\\/mm³|\\/µL|cells\\/mm3";
const VAL = new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*(${UNITS})`, "i");
const BARE = /\b(?:ph|inr|potassium|sodium|k\+|na\+)\s*(?:is|was|of|=|:|level of|level is|at|came back at)?\s*(\d+(?:\.\d+)?)(?![\d.]*\s*(?:meq|mmol|mg|%|mcg|g\/|units|ml|l\b))/i;
const SEX_M = /\b(?:man|men|male|boy|gentleman)\b|رجل|ذكر|راجل|ولد/i;
const SEX_F = /\b(?:woman|women|female|girl|lady|pregnant)\b|امرأة|امراة|سيدة|أنثى|انثى|ست\b|بنت|حامل/i;
const AGE = /(\d{1,3})\s*[- ]?\s*(?:year|yr|y\/o|yo|سنة|سنه|عام)|\b(newborn|neonate|infant|toddler|child|pediatric|adolescent)\b|\b(adult)\b|(طفل|رضيع|حديث الولادة)/i;
const CLAIM = { normal: /\b(?:normal|therapeutic(?: range| level)?|within (?:the )?(?:normal |therapeutic )?(?:range|limits))\b|طبيعي|ضمن المعدل|في المعدل/i,
  high: /\b(?:high|elevated|raised|hyper\w*|above|toxic|supratherapeutic|leukocytosis|thrombocytosis)\b|مرتفع|عالي|زيادة/i, low: /\b(?:low|decreased|reduced|hypo\w*|below|subtherapeutic|anemi\w*|leukopeni\w*|thrombocytopeni\w*)\b|منخفض|واطي|ناقص|قليل/i };

const toSi = (v, unit, f) => {
  const u = unit.toLowerCase().replace("umol", "µmol").replace("μ", "µ");
  if (u === f.data.si.unit.toLowerCase()) return v;
  if (f.data.conv && u === f.data.conv.unit.toLowerCase()) return v / f.data.conv.factor;
  return null;
};
const toConv = (siv, f) => (f.data.conv ? siv * f.data.conv.factor : null);
const fmt = (x) => (Math.abs(x) >= 100 ? Math.round(x) : Math.round(x * 100) / 100);

export function patientOf(text) {
  const t = String(text || "");
  const sex = SEX_M.test(t) && !SEX_F.test(t) ? "m" : SEX_F.test(t) && !SEX_M.test(t) ? "f" : "any";
  const a = AGE.exec(t);
  let age = null;
  if (a) { if (a[1]) age = parseInt(a[1], 10); else if (a[3]) age = 30; else age = 5; }
  return { sex, age, child: !!(a && (a[2] || a[4])) };
}

const ALIAS_RX = new Map();
const aliasRx = (a) => { let r = ALIAS_RX.get(a); if (r === undefined) { const n = norm(a); r = n.length >= 2 ? new RegExp(`(?<![a-z\\u0621-\\u064A])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z\\u0621-\\u064A])`) : null; ALIAS_RX.set(a, r); } return r; };
const hasAlias = (f, t) => {
  const nt = ` ${norm(t)} `;
  return [...(f.aliases.en || []), ...(f.aliases.ar || [])].some((a) => { const r = aliasRx(a); return r && r.test(nt); });
};

/* → null | { analyte, value, unit, valueSi, candidates:[{stratum, status, range}], statuses:Set, claim, noStratum, varies, fact } */
export function rangeInfo(sentence, patient, profile) {
  if (!/\d/.test(sentence)) return null;                        // a value needs a digit: most sentences stop here
  let m = VAL.exec(sentence), bare = false;
  if (!m) { const bm = BARE.exec(sentence); if (!bm) return null; m = [bm[0], bm[1], ""]; bare = true; }
  const p = patient || patientOf(sentence);
  for (const f of loadedFacts()) {
    if (f.kind !== "range" || !inScope(f, profile) || !hasAlias(f, sentence)) continue;
    if (bare && !f.data.bareOk) continue;                        // only the few analytes that are written without a unit (pH, INR, K, Na)
    const value = parseFloat(m[1].replace(",", "."));
    const si = bare ? value : toSi(value, m[2], f);
    if (si == null) continue;
    if (bare && (si < f.data.strata[0].low * 0.2 || si > f.data.strata[0].high * 5)) continue;     // not a plausible value of this analyte: ignore
    const strata = f.data.strata.filter((s) => (s.sex === "any" || p.sex === "any" || s.sex === p.sex) && (p.age == null || (p.age >= s.ageMin && p.age <= s.ageMax)));
    let claim = CLAIM.normal.test(sentence) ? "normal" : CLAIM.low.test(sentence) ? "low" : CLAIM.high.test(sentence) ? "high" : null;
    const dir = f.data.terms || {};                              // hypokalemia / hyperkalemia … written without "low" / "high"
    if (!claim) { const ns = ` ${normTerm(sentence)} `; if ((dir.low || []).some((t) => ns.includes(` ${normTerm(t)} `))) claim = "low"; else if ((dir.high || []).some((t) => ns.includes(` ${normTerm(t)} `))) claim = "high"; }
    if (!strata.length) return { analyte: f.data.analyte, value, unit: m[2], valueSi: si, candidates: [], statuses: new Set(), plausible: new Set(), claim, noStratum: true, varies: f.data.variesByLab, fact: f };
    const candidates = strata.map((s) => ({ stratum: s, status: si < s.low ? "low" : si > s.high ? "high" : "normal", range: { low: s.low, high: s.high, lowConv: toConv(s.low, f), highConv: toConv(s.high, f) } }));
    /* boundary tolerance: a value within 10 % of the range width of a limit is a dispute about the limit (labs differ), never an error */
    const plausible = new Set();
    for (const c of candidates) { const w = (c.stratum.high - c.stratum.low) || Math.max(1, c.stratum.high * 0.1), mg = w * 0.1; plausible.add(c.status); if (si < c.stratum.low + mg) plausible.add("low"); if (si > c.stratum.high - mg) plausible.add("high"); if (si >= c.stratum.low - mg && si <= c.stratum.high + mg) plausible.add("normal"); }
    return { analyte: f.data.analyte, value, unit: m[2], valueSi: si, candidates, statuses: new Set(candidates.map((c) => c.status)), plausible, claim, noStratum: false, varies: f.data.variesByLab, fact: f, patient: p };
  }
  return null;
}

export function describeRange(info) {
  const c = info.candidates[0];
  const f = info.fact, conv = f.data.conv;
  const who = c.stratum.sex === "m" ? "adult male" : c.stratum.sex === "f" ? "adult female" : "adult";
  const r = conv ? `${fmt(c.range.lowConv)}–${fmt(c.range.highConv)} ${conv.unit} (${fmt(c.range.low)}–${fmt(c.range.high)} ${f.data.si.unit})` : `${fmt(c.range.low)}–${fmt(c.range.high)} ${f.data.si.unit}`;
  return `${f.data.analyte}, ${who}: ${r}${info.varies ? "; varies by lab" : ""}`;
}

/* the claimed status vs the value, from an already computed info → the corrected sentence, else null */
export function contradictionOf(info) {
  if (!info || info.noStratum || !info.claim) return null;
  if (info.statuses.has(info.claim) || (info.plausible && info.plausible.has(info.claim))) return null;      // true for a stratum that could apply, or only a boundary dispute → never "fix" it
  const actual = [...info.statuses][0];
  const word = actual === "low" ? "below" : actual === "high" ? "above" : "within";
  return { info, text: `${info.analyte[0].toUpperCase()}${info.analyte.slice(1)} ${info.value} ${info.unit} is ${word} the reference range (${describeRange(info)}).` };
}
/* a sentence that CLAIMS a status the value does not have for the patient's stratum → the corrected sentence, else null */
export function rangeContradiction(sentence, patient, profile) { return contradictionOf(rangeInfo(sentence, patient, profile)); }
