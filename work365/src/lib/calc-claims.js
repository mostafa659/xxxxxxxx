/* ───────────── lib/calc-claims.js · what number does a text CLAIM for a named calculation? (v3.67) ─────────────
   ROOT CAUSE this module removes (reproduced from v3.66.0):
   the old verifier (`labelledNumber` in clinical-calculations.js) took the FIRST number after a label as the model's "reported result".
   A correct worked line such as   «Anion gap = 129 − (94 + 14) = 21»   was therefore read as «the answer reports 129»,
   and   «Winter expected PaCO₂ = 1.5 × 14 + 8 = 29»   as «the answer reports 1.5» — exactly the two "model arithmetic errors"
   reported across v3.59–v3.66. They are the first OPERANDS of correct formulas.

   Contract of this module
   1. A claim is the RESULT of the arithmetic chain that follows a label, never an operand of it:
        «= 129 − (94 + 14) = 21»  → 21     «= 1.5 × 14 + 8»  → 29 (the chain is evaluated)     «is 21 mmol/L (129 − 108)» → 21
   2. Every arithmetic step inside a chain is evaluated with the shared evaluator (arith.js). A chain that does not equal its own
      stated result («129 − 108 = 22») is reported as an internal-arithmetic inconsistency.
   3. A more specific label wins over a general one at the same position («albumin-corrected anion gap» is never an «anion gap» claim).
   4. Reference statements («normal anion gap 8–12», «if the gap were >20») and hypotheticals are not claims about THIS patient.
   5. Every occurrence is checked, not just the first.
   Nothing here computes clinical values: it only extracts what the text claims so that the deterministic engine can compare. */

import { evalExpr, normalizeArithmetic } from "./arith.js";

const UNIT_RE = /^(?:mm\s*hg|mmol\s*\/\s*l|meq\s*\/\s*l|mg\s*\/\s*dl|g\s*\/\s*dl|g\s*\/\s*l|[µμu]mol\s*\/\s*l|mosm\s*\/\s*kg|ml\s*\/\s*min|l\s*\/\s*min|ml\s*\/\s*dl|l\s*\/\s*h(?:r|our)?|mg\s*\/\s*h(?:r|our)?|mg\s*\/\s*l|dyn[·.\s]*s\s*\/\s*cm\s*[⁵5]|bpm|kpa|%|fold|units?)(?![A-Za-z])/i;
const SYMBOL_RE = /^(?:Na\+?|Cl[-⁻]?|HCO[3₃][-⁻]?|K\+?|SBP|DBP|MAP|Hb|PaCO[2₂]|albumin|alb|CVP|VO[2₂]|BUN|glucose|baseline|current)(?![A-Za-z])/i;
const BOUNDARY_RE = /^(?:=>|->|⇒|⟶|→|≈|≅|=|~)/;
const DIGIT = "0-9٠-٩۰-۹";
const NUMBER_RE = new RegExp(`^[${DIGIT}]+(?:[.,٫][${DIGIT}]+)?`);

/* [id, human label, tolerance, flags, label patterns] — patterns are listed with their own flags: acronyms are case-sensitive. */
const L = (source, flags = "gi") => ({ source, flags });
export const CLAIM_SPECS = [
  { id: "corrected-ag", abs: 0.5, rel: 0.02, labels: [
    L(String.raw`(?:albumin[-\s]*(?:corrected|adjusted)|(?<![A-Za-z])corrected|(?<![A-Za-z])adjusted)\s+anion\s+gap`),
    L(String.raw`(?:albumin[-\s]*(?:corrected|adjusted)|(?<![A-Za-z])corrected|(?<![A-Za-z])adjusted)\s+AG\b`),
    L(String.raw`\bcAG\b`, "g"),
    L(String.raw`\bAG\s*(?:\(\s*)?(?:albumin[-\s]*)?(?:corrected|adjusted)(?:\s*\))?`),
    L(String.raw`الفجوة\s+الأنيونية\s+(?:المصححة|المعدلة)`, "g"),
  ] },
  { id: "ag", abs: 0.5, rel: 0.02, labels: [
    L(String.raw`anion\s+gap`),
    L(String.raw`(?<![A-Za-zΔδ])AG\b`, "g"),
    L(String.raw`الفجوة\s+الأنيونية`, "g"),
  ] },
  { id: "winter", abs: 1, rel: 0.03, rangeAllowed: true, labels: [
    L(String.raw`winter(?:['’]s)?\s+(?:formula\s+)?(?:expected|predicted)\s+(?:PaCO[2₂]|pCO[2₂])`),
    L(String.raw`(?:expected|predicted|compensatory)\s+(?:PaCO[2₂]|pCO[2₂])`),
    L(String.raw`winter(?:['’]s)?\s+(?:formula|equation)\s*(?:gives|predicts|yields)?`),
  ] },
  { id: "map", abs: 1, rel: 0.02, labels: [
    L(String.raw`mean\s+arterial\s+(?:blood\s+)?pressure`),
    L(String.raw`(?<![A-Za-z])MAP\b`, "g"),
    L(String.raw`متوسط\s+الضغط\s+الشرياني`, "g"),
  ] },
  { id: "hb-decline", abs: 0.15, rel: 0.02, labels: [
    L(String.raw`(?:hemoglobin|haemoglobin|Hb)\s+(?:decline|drop|fall|decrease|reduction|loss)s?\s*(?:of|by|:|=|is|was)?`),
    L(String.raw`(?:hemoglobin|haemoglobin|Hb)\s+(?:fell|dropped|declined|decreased|dropping|falling)\s+(?:by|of)`),
    L(String.raw`(?:decline|drop|fall|decrease|reduction)\s+in\s+(?:hemoglobin|haemoglobin|Hb)\s*(?:of|by)?`),
    L(String.raw`Δ\s*Hb`),
  ] },
  { id: "creatinine-delta", abs: 0.15, rel: 0.02, labels: [
    L(String.raw`creatinine\s+(?:rise|increase|elevation)s?\s*(?:of|by)`),
    L(String.raw`(?:rise|increase|elevation)\s+in\s+(?:serum\s+)?creatinine\s*(?:of|by)`),
  ] },
  { id: "creatinine-ratio", abs: 0.1, rel: 0.03, labels: [
    L(String.raw`creatinine\s+(?:ratio|fold[-\s]*change)`),
  ] },
  { id: "og", abs: 0.5, rel: 0.015, labels: [
    L(String.raw`osmol[a-z]*\s+gap`),
    L(String.raw`(?<![A-Za-z])OG\b`, "g"),
  ] },
  { id: "svr", abs: 0.1, rel: 0.015, labels: [
    L(String.raw`systemic\s+vascular\s+resistance`),
    L(String.raw`(?<![A-Za-z])SVR\b`, "g"),
  ] },
  { id: "co", abs: 0.1, rel: 0.015, labels: [
    L(String.raw`cardiac\s+output`),
    L(String.raw`(?<![A-Za-z])CO\b(?![₂2])`, "g"),
  ] },
  { id: "r0", abs: 0.1, rel: 0.015, labels: [
    L(String.raw`maintenance\s+infusion\s+rate`),
    L(String.raw`infusion\s+rate`),
    L(String.raw`(?<![A-Za-z])R\s*[₀0](?![A-Za-z0-9])`, "g"),
  ] },
];

const CONNECTOR = new RegExp(
  String.raw`^\s*(?:` +
  [
    String.raw`(?:markedly|significantly|severely|mildly|persistently)\s+`,
    String.raw`(?:elevated|raised|increased|high|low|reduced|decreased)\s+(?:at|to|of)\b`,
    String.raw`(?:is|was)\s+calculated\s+(?:as|to\s+be)\b`, String.raw`calculated\s+(?:as|to\s+be)\b`,
    String.raw`comes\s+to\b`, String.raw`works\s+out\s+(?:at|to)\b`, String.raw`(?:rises|rose|falls|fell)\s+to\b`,
    String.raw`by\s+(?:the\s+)?fick(?:\s+(?:method|principle|equation))?\s*(?:is|was|=|:)?`, String.raw`equals?\b`, String.raw`(?:is|was|are|were|of|at|by)\b`, String.raw`around\b`, String.raw`about\b`, String.raw`approx(?:imately|\.)?`,
    String.raw`(?:هي|تساوي|يساوي|بلغت|حوالي)\b`,
    String.raw`[:=|]`, String.raw`[\-–—](?=\s)`, String.raw`≈`, String.raw`~`, String.raw`→`,
  ].join("|") + String.raw`)`, "i");

const CONTEXT_BEFORE = /(?:\bnormal\b|\bnormally\b|\breference\b|\bupper\s+limit\b|\btypical(?:ly)?\b|\busual(?:ly)?\b|\bcut-?\s?offs?\b|\bthreshold\b|\bif\b|\bwould\b|\bshould\b|\btarget\b|\bgoal\b|\bnl\b|\bnormal range\b|الطبيعي|المرجعي)\W[^.;\n]{0,25}$/i;
const COMPARATOR = /^\s*(?:>=?|<=?|≥|≤|above|below|greater\s+than|less\s+than|over|under|exceeds?|more\s+than)\b/i;
const COMPARATOR_SYM = /^\s*(?:>=?|<=?|≥|≤)/;

function cutSentence(tail) {
  const nl = tail.search(/\n/);
  let end = nl >= 0 ? nl : tail.length;
  const semi = tail.search(/[;؛]/);
  if (semi >= 0 && semi < end) end = semi;
  const dot = tail.search(/(?<![0-9٠-٩])\.(?=\s|$)/);
  if (dot >= 0 && dot < end) end = dot;
  return tail.slice(0, Math.min(end, 200));
}

/* Consume the arithmetic chain at the start of `tail`. Words end the chain; a bracket that directly follows a number/unit is an annotation and ends it. */
function scanChain(tail) {
  let i = 0, depth = 0, last = "", balancedEnd = 0;
  let out = "";
  while (i < tail.length) {
    const rest = tail.slice(i);
    let m;
    if ((m = /^\s+/.exec(rest))) { out += m[0]; i += m[0].length; continue; }
    if ((m = /^±\s*[0-9٠-٩]+(?:[.,٫][0-9٠-٩]+)?/.exec(rest))) { out += m[0]; i += m[0].length; if (depth === 0) balancedEnd = out.length; continue; }
    if ((m = NUMBER_RE.exec(rest))) {
      if (last === "num" || last === "unit" || last === "close" || last === "sym") break;
      out += m[0]; i += m[0].length; last = "num"; if (depth === 0) balancedEnd = out.length; continue;
    }
    if (BOUNDARY_RE.test(rest) && (m = BOUNDARY_RE.exec(rest))) {
      out += m[0]; i += m[0].length; last = "eq"; continue;
    }
    if ((last === "num" || last === "close") && (m = UNIT_RE.exec(rest))) {
      out += m[0]; i += m[0].length; last = "unit"; if (depth === 0) balancedEnd = out.length; continue;
    }
    if ((m = SYMBOL_RE.exec(rest))) {
      if (last === "num" || last === "unit" || last === "close" || last === "sym") break;
      out += m[0]; i += m[0].length; last = "sym"; if (depth === 0) balancedEnd = out.length; continue;
    }
    const ch = rest[0];
    if ("+-−–—×*÷/".includes(ch)) {
      if (last === "op" || last === "eq" || last === "") { if (ch === "-" || ch === "−") { out += ch; i++; continue; } break; }
      out += ch; i++; last = "op"; continue;
    }
    if ((ch === "x" || ch === "X") && (last === "num" || last === "close" || last === "unit") && /^\s*[0-9(\[]/.test(rest.slice(1))) { out += ch; i++; last = "op"; continue; }
    if (ch === "(" || ch === "[") {
      if (last === "num" || last === "unit" || last === "close" || last === "sym") break;
      depth++; out += ch; i++; last = "open"; continue;
    }
    if (ch === ")" || ch === "]") {
      if (depth <= 0) break;
      depth--; out += ch; i++; last = "close"; if (depth === 0) balancedEnd = out.length; continue;
    }
    break;
  }
  return out.slice(0, balancedEnd).replace(/[\s+\-−–—×*÷/=≈~→⇒]+$/, "").trim();
}

function segmentValue(segment) {
  const s = String(segment || "").trim();
  if (!s) return null;
  const stripped = s.replace(/±\s*[\d.]+/g, "");
  const letters = stripped.replace(UNIT_STRIP, "");
  if (/[A-Za-z\u0600-\u065f\u066a-\u06ef\u06fa-\u06ff]/.test(letters)) return { symbolic: true };
  const asExpr = evalExpr(stripped);
  const isExpression = /[0-9٠-٩][^0-9٠-٩.,٫%A-Za-z\s]*\s*[+\-−–—×*÷/x]\s*[(\[]?[0-9٠-٩]/.test(normalizeArithmetic(stripped).replace(/^\s*-/, ""));
  if (asExpr != null) return { value: asExpr, expression: isExpression, text: s };
  const lead = new RegExp(`^\\s*(-?[${DIGIT}]+(?:[.,٫][${DIGIT}]+)?)`).exec(normalizeArithmetic(stripped));
  if (lead) return { value: Number(lead[1].replace(/٫/g, ".").replace(",", ".")), expression: false, text: s };
  return null;
}
const UNIT_STRIP = /(?:dyn[·.\s]*s\s*\/\s*cm\s*[⁵5]|mm\s*hg|mmol\s*\/\s*l|meq\s*\/\s*l|mg\s*\/\s*dl|g\s*\/\s*dl|g\s*\/\s*l|[µμu]mol\s*\/\s*l|mosm\s*\/\s*kg|ml\s*\/\s*min|l\s*\/\s*min|ml\s*\/\s*dl|l\s*\/\s*h(?:r|our)?|mg\s*\/\s*h(?:r|our)?|mg\s*\/\s*l|bpm|kpa|fold)/gi;

/* find every label occurrence, resolve overlaps in favour of the longer (more specific) label of a DIFFERENT quantity */
function labelMatches(text) {
  const all = [];
  for (const spec of CLAIM_SPECS) {
    for (const lab of spec.labels) {
      const re = new RegExp(lab.source, lab.flags.includes("g") ? lab.flags : `${lab.flags}g`);
      for (const m of text.matchAll(re)) all.push({ id: spec.id, spec, start: m.index, end: m.index + m[0].length, text: m[0] });
    }
  }
  all.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const kept = [];
  for (const m of all) {
    const overlap = kept.length && m.start < kept[kept.length - 1].end ? kept[kept.length - 1] : null;   // sorted by start: only the last kept span can overlap
    if (overlap) {
      if (overlap.id === m.id) { overlap.end = Math.max(overlap.end, m.end); continue; }   // two labels of the same quantity: one anchor
      continue;                                                                           // the earlier/longer label of another quantity wins
    }
    kept.push({ ...m });
  }
  // «Anion gap (AG): …» — a parenthesised acronym right after its own label is the same anchor, not a second claim
  const merged = [];
  for (const m of kept) {
    const prev = merged[merged.length - 1];
    if (prev && prev.id === m.id && /^\s*\(\s*$/.test(text.slice(prev.end, m.start))) {
      const close = /^\s*\)/.exec(text.slice(m.end));
      prev.end = m.end + (close ? close[0].length : 0);
      continue;
    }
    merged.push(m);
  }
  return merged;
}

const FOLD_RE = /creatinine[^.;\n]{0,60}?([0-9]+(?:[.,][0-9]+)?)\s*[-–]?\s*(?:fold|×\s*(?:the\s+)?baseline|x\s*(?:the\s+)?baseline|times\s+(?:the\s+)?baseline)/gi;

/* → [{ id, value, range?, raw, start, chainInconsistency? }] — every claimed result in `text` */
export function extractClaims(text = "") {
  // LLM output is full of markdown: «**Anion gap:** **18** mmol/L», «| Anion gap | 18 mmol/L |», `AG = 18`, $AG = 18$. Emphasis markers are removed
  // (offsets are only used for ordering) and a table pipe is treated as a connector, so a wrong number cannot hide behind formatting.
  const src = String(text || "").replace(/\*\*|__|`|\$/g, "");
  const matches = labelMatches(src);
  const claims = [];
  for (let k = 0; k < matches.length; k++) {
    const m = matches[k];
    const before = src.slice(Math.max(0, m.start - 60), m.start);
    const clauseBefore = before.split(/[.;\n]/).pop();
    if (CONTEXT_BEFORE.test(clauseBefore) && m.id !== "winter") continue;
    let tail = src.slice(m.end, matches[k + 1] ? Math.min(matches[k + 1].start, m.end + 200) : m.end + 200);
    tail = cutSentence(tail);
    let id = m.id;
    // leading parenthetical without digits: «Anion gap (AG):», «AG (albumin-corrected) = …»
    const paren = /^\s*\(([^()0-9٠-٩]*)\)\s*/.exec(tail);
    if (paren) {
      if (id === "ag" && /corrected|adjusted|albumin/i.test(paren[1])) id = "corrected-ag";
      tail = tail.slice(paren[0].length);
    }
    for (let guard = 0; guard < 4; guard++) { const c = CONNECTOR.exec(tail); if (!c || !c[0].trim()) break; tail = tail.slice(c[0].length); }
    if (COMPARATOR.test(tail) || COMPARATOR_SYM.test(tail)) continue;
    const spec = CLAIM_SPECS.find((s) => s.id === id);
    const chain = scanChain(tail);
    if (!chain || !/[0-9٠-٩]/.test(chain)) continue;
    // a range for quantities where ranges are conventional («27–31 mmHg»); an en dash without spaces between digits
    if (spec.rangeAllowed) {
      const r = new RegExp(`^\\s*([${DIGIT}]+(?:[.,٫][${DIGIT}]+)?)\\s*[–—-]\\s*([${DIGIT}]+(?:[.,٫][${DIGIT}]+)?)\\s*(?:mm\\s*hg)?\\s*$`, "i").exec(chain);
      if (r) {
        const lo = Number(normalizeArithmetic(r[1]).replace(/٫/g, ".").replace(",", ".")), hi = Number(normalizeArithmetic(r[2]).replace(/٫/g, ".").replace(",", "."));
        if (lo < hi) { claims.push({ id, range: [lo, hi], value: (lo + hi) / 2, raw: `${m.text}${tail.slice(0, 40)}`.trim(), start: m.start }); continue; }
      }
    }
    const segments = chain.split(/=>|->|⇒|⟶|→|≈|≅|=|~/).map((s) => s.trim()).filter(Boolean).map(segmentValue).filter((s) => s && !s.symbolic);
    if (!segments.length) continue;
    const final = segments[segments.length - 1];
    const claim = { id, value: final.value, raw: `${m.text} ${chain}`.replace(/\s+/g, " ").trim(), start: m.start, steps: segments };
    // an earlier step of the SAME chain that does not equal the stated result is an internal arithmetic error
    for (const s of segments.slice(0, -1)) {
      if (Math.abs(s.value - final.value) > Math.max(spec.abs, Math.abs(final.value) * spec.rel)) { claim.chainInconsistency = { step: s.text, evaluates: Number(s.value.toFixed(4)), stated: final.value }; break; }
    }
    claims.push(claim);
  }
  for (const m of src.matchAll(FOLD_RE)) claims.push({ id: "creatinine-ratio", value: Number(m[1].replace(",", ".")), raw: m[0].replace(/\s+/g, " ").trim(), start: m.index, steps: [] });
  return claims;
}

export const claimedIds = (text = "") => new Set(extractClaims(text).map((c) => c.id));

const tolOf = (id) => CLAIM_SPECS.find((s) => s.id === id) || { abs: 0.1, rel: 0.015 };
const decimalsOf = (x) => { const m = /\.(\d+)/.exec(String(x)); return m ? m[1].length : 0; };

/* compare claims with the deterministic results (array of {id,label,value,unit}) → conflicts[] (same shape as the other audit conflicts) */
export function verifyClaims(claims = [], results = []) {
  const byId = new Map(results.map((r) => [r.id, r]));
  const conflicts = [];
  const seen = new Set();
  const push = (c) => { const key = `${c.code}|${c.message}`; if (!seen.has(key)) { seen.add(key); conflicts.push(c); } };
  for (const claim of claims) {
    const r = byId.get(claim.id);
    if (!r) continue;
    const spec = tolOf(claim.id);
    const tol = Math.max(spec.abs, Math.abs(r.value) * spec.rel);
    let ok;
    if (claim.range) ok = r.value >= claim.range[0] - tol && r.value <= claim.range[1] + tol;
    else {
      const d = decimalsOf(String(claim.value));
      ok = Math.abs(claim.value - r.value) <= tol || Number(r.value.toFixed(d)) === claim.value;
    }
    const shown = claim.range ? `${claim.range[0]}–${claim.range[1]}` : claim.value;
    if (!ok) {
      const derivation = claim.chainInconsistency ? ` (its own working evaluates to ${claim.chainInconsistency.evaluates})` : "";
      push({ code: `reported-${claim.id}-mismatch`, severity: "high", id: claim.id, reported: claim.value, computed: r.value, unit: r.unit, message: `${r.label}: the answer reports ${shown} ${r.unit}${derivation}, while the independent calculation from the extracted inputs is ${r.value} ${r.unit}.` });
    } else if (claim.chainInconsistency) {
      push({ code: `reported-${claim.id}-arithmetic-inconsistent`, severity: "high", id: claim.id, reported: claim.value, computed: r.value, unit: r.unit, message: `${r.label}: the stated result ${claim.value} ${r.unit} is correct, but one step of the displayed working («${claim.chainInconsistency.step}») evaluates to ${claim.chainInconsistency.evaluates}. The displayed derivation is internally inconsistent.` });
    }
  }
  return conflicts;
}
