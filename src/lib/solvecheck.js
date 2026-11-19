/* ───────────── lib/solvecheck.js · is the AI's own answer to a question trustworthy? (v3.43 · Part B) ─────────────
   Part B has NO reference: the model is the only author. So nothing here "asks again". Everything is read from the ONE solve request that already exists:
     B2  free confidence from the ANSWER tokens (logprobs): top-1 probability and margin, renormalised over the valid option letters; tiers HIGH / MEDIUM / LOW
     B3  format + logic checks in code (answer letters exist, ✅ set = ANSWER, "select N", every part answered, polarity, answer shape of the exam item type)
     B4  KB checks on the option verdicts + CALC recomputed in code (units, conversions, rounding)
     B5  DATA: what the model read from the image, shown to the student; low-probability digits / units raise "check this"
     B6  honest display model (banner, runner-up, per-option confidence only where the exam penalises wrong picks)
   Tier thresholds come from calibration.js (tuned per profile on its golden set). A profile with NO calibrated golden set is capped at MEDIUM. */
import { norm } from "./accuracy.js";
import { profileKey, examOf, penalizesWrongPicks } from "./profile.js";
import { CAL, DEFAULT_THRESHOLDS } from "./calibration.js";
import { rangeInfo, rangeContradiction, patientOf, describeRange } from "./kb/ranges.js";

export const TIERS = ["LOW", "MEDIUM", "HIGH"];
const tierMin = (a, b) => TIERS[Math.min(TIERS.indexOf(a), TIERS.indexOf(b))];
const tierDown = (t) => TIERS[Math.max(0, TIERS.indexOf(t) - 1)];

/* ── parse the brief ── */
const LETTER = /\b([A-H])\b/g;
export const PREMISE_MAX_WORDS = 24;      // hard cut for display; the prompt asks for ≤ 20 words (≈ 26 tokens of output): 1-2 short clauses, written BEFORE the answer
export function parseBrief(raw) {
  const t = String(raw || "").replace(/\r/g, "").replace(/```[a-z]*\n?|```/gi, "");
  const get = (name) => { const m = new RegExp(`^\\s*${name}\\s*:\\s*(.*)$`, "im").exec(t); return m ? m[1].trim() : ""; };
  // ANSWER can span several lines for Next-Gen items (one per blank / row / part): everything up to the next KEY:
  const am = /^\s*ANSWER\s*:\s*([\s\S]*?)(?=^\s*(?:PREMISE|TYPE|KEYWORD|CONCEPTS|DATA|OPTIONS|CALC|CONFIDENCE|RATIONALE)\s*:|$(?![\s\S]))/im.exec(t);
  const premiseRaw = get("PREMISE");
  const premiseWords = premiseRaw.split(/\s+/).filter(Boolean);
  const premise = premiseWords.slice(0, PREMISE_MAX_WORDS).join(" ");
  const premiseFirst = !!premiseRaw && t.search(/^\s*PREMISE\s*:/im) < t.search(/^\s*ANSWER\s*:/im);
  const answerRaw = am ? am[1].trim() : "";
  const answerLines = answerRaw.split("\n").map((l) => l.trim()).filter(Boolean);
  const letters = [...new Set([...(answerLines.length ? answerLines[0] : "").matchAll(LETTER)].map((m) => m[1]))];
  const options = [];
  const om = /^\s*OPTIONS\s*:\s*$([\s\S]*?)(?=^\s*(?:RATIONALE|CALC|CONFIDENCE)\s*:|$(?![\s\S]))/im.exec(t);
  if (om) for (const l of om[1].split("\n")) {
    const m = /^\s*([A-H])\s*[).:]\s*(✅|❌|✔|✓|✗|✘)?\s*(.*)$/.exec(l);
    if (m) options.push({ letter: m[1], mark: /✅|✔|✓/.test(m[2] || "") ? "yes" : m[2] ? "no" : "?", why: m[3].trim() });
  }
  const conf = get("CONFIDENCE");
  return {
    premise, premiseLong: premiseWords.length > 20, premiseFirst, answerRaw, answerLines, letters, type: get("TYPE"), keyword: get("KEYWORD"), concepts: get("CONCEPTS"), data: get("DATA"), calc: get("CALC"), options,
    confidence: /^(high|medium|low)/i.test(conf) ? conf.match(/^(high|medium|low)/i)[1].toLowerCase() : "", confidenceReason: conf.replace(/^(high|medium|low)\W*/i, "").trim(),
  };
}

/* the item format of the TYPE line / stem, mapped to the exam module's format ids */
export function itemFormat(type, stem) {
  const t = `${type} ${stem}`.toLowerCase();
  if (/sata|select all|all that apply|multiple response/.test(t)) return "sata";
  if (/matrix/.test(t)) return "matrix";
  if (/bow[- ]?tie/.test(t)) return "bowtie";
  if (/cloze|drop[- ]?down/.test(t)) return "cloze";
  if (/highlight/.test(t)) return "highlight";
  if (/drag/.test(t)) return "dragdrop";
  if (/order|rank|sequence/.test(t)) return "ordered";
  return "mcq";
}

/* ── B3 · format and logic checks (zero tokens) ── */
const NEG_STEM = /\b(?:EXCEPT|NOT|LEAST|further teaching|needs? further|requires? follow[- ]?up|incorrect|false|unsafe)\b/;
const NEG_BRIEF = /\b(?:negative|EXCEPT|NOT|LEAST|further teaching|incorrect|false|wrong statement)\b/i;
const NUMWORD = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

export function formatChecks(b, { stem = "", profile } = {}) {
  const flags = [];
  const add = (code, msg) => flags.push({ code, msg });
  const fmt = itemFormat(b.type, stem);
  const ex = examOf(profile);
  if (!b.answerRaw) { add("no-answer", "no ANSWER line"); return flags; }
  const optLetters = b.options.map((o) => o.letter);
  const multiPart = b.answerLines.length > 1 && !/^[A-H](?:\s*[,&]\s*[A-H])*\.?$/.test(b.answerLines[0]);
  // answer letters exist among the options
  if (optLetters.length && !multiPart) for (const l of b.letters) if (!optLetters.includes(l)) add("letter-missing", `ANSWER names ${l}, which is not an option`);
  // options marked ✅ equal ANSWER (single-part items)
  if (optLetters.length && !multiPart && b.letters.length) {
    const yes = b.options.filter((o) => o.mark === "yes").map((o) => o.letter).sort().join(",");
    const ans = [...b.letters].sort().join(",");
    if (yes !== ans) add("marks-mismatch", `options marked ✅ (${yes || "none"}) differ from ANSWER (${ans})`);
  }
  // an option verdict that contradicts itself
  const seen = new Map();
  for (const o of b.options) { if (seen.has(o.letter) && seen.get(o.letter) !== o.mark) add("option-contradiction", `option ${o.letter} judged both ways`); seen.set(o.letter, o.mark); }
  // "select N" must match the number of answers
  const sel = /\b(?:select|choose|pick)\s+(\d+|one|two|three|four|five|six)\b(?!\s+of\s+the\s+following\s+(?:is|are)\s+correct)/i.exec(stem);
  if (sel && !multiPart) {
    const n = /^\d+$/.test(sel[1]) ? parseInt(sel[1], 10) : NUMWORD[sel[1].toLowerCase()];
    if (n && b.letters.length !== n) add("select-count", `the stem says select ${n}, ANSWER has ${b.letters.length}`);
  }
  if (fmt === "sata" && !multiPart && b.letters.length === 0) add("sata-empty", "select-all item with no answer");
  // every blank / row / part answered
  if (["cloze", "matrix", "bowtie", "dragdrop", "highlight"].includes(fmt) && b.answerLines.length < 2 && !/,|;/.test(b.answerRaw)) add("parts-missing", `a ${fmt} item needs one answer per blank, row or part`);
  // polarity
  const stemNeg = NEG_STEM.test(stem), briefNeg = NEG_BRIEF.test(`${b.keyword} ${b.type}`);
  if (stem && stemNeg !== briefNeg && (stemNeg || /EXCEPT|NOT|LEAST/.test(b.keyword))) add("polarity", stemNeg ? "the stem has a negative keyword the analysis does not treat as negative" : "the analysis assumes negative polarity the stem does not show");
  if (ex && ex.negativeKeywords && stem) for (const k of ex.negativeKeywords) if (new RegExp(`\\b${k}\\b`, k === k.toUpperCase() ? "" : "i").test(stem) && !briefNeg) { add("polarity", `"${k}" in the stem`); break; }
  // answer shape vs the profile's exam item types
  if (ex && !ex.itemFormats.includes(fmt)) add("shape", `item type "${fmt}" is not in the ${ex.label} module`);
  if (fmt === "mcq" && b.letters.length > 1 && !multiPart) add("shape", "a single-answer item has several answers");
  return flags;
}

/* ── B4 · CALC recomputed in code ── */
const CONV = { // [from, to, factor]  value_to = value_from × factor
  "mg>g": 0.001, "g>mg": 1000, "mcg>mg": 0.001, "mg>mcg": 1000, "µg>mg": 0.001, "mg>µg": 1000, "g>kg": 0.001, "kg>g": 1000, "kg>lb": 2.20462, "lb>kg": 0.453592,
  "l>ml": 1000, "ml>l": 0.001, "h>min": 60, "min>h": 1 / 60, "min>s": 60, "s>min": 1 / 60, "cm>mm": 10, "mm>cm": 0.1, "m>cm": 100, "cm>m": 0.01, "in>cm": 2.54, "cm>in": 1 / 2.54,
  "mmol>mol": 0.001, "mol>mmol": 1000, "dl>ml": 100, "ml>dl": 0.01, "gtt>ml": null,
};
const UNIT_RX = "mcg|µg|μg|mg|kg|g|lb|ml|mL|dl|dL|l|L|h|hr|hrs|min|s|cm|mm|m|in|mmol|mol|gtt";
const normUnit = (u) => String(u || "").toLowerCase().replace("μ", "µ").replace(/^hrs?$/, "h");

/* evaluate "15 mg/kg × 70 kg ÷ 3" → number (units are ignored inside an expression; a step's unit change is checked separately) */
export function evalExpr(expr) {
  const s = String(expr).replace(/,(?=\d{3}\b)/g, "").replace(/×|x(?=\s*[\d(])|\*/gi, "*").replace(/÷|:/g, "/").replace(/(?<=\d)\s*(?:mg|mcg|µg|μg|kg|g|lb|ml|mL|dl|dL|l|L|h|hr|min|s|cm|mm|m|in|mmol|mol|gtt|units?|IU|mEq|drops?)\b(?:\s*\/\s*(?:kg|h|hr|min|dl|dL|l|L|ml|mL|m2|m²|day|d))*/gi, "").replace(/\s+/g, "");
  if (!/^[\d.+\-*/()]+$/.test(s) || !s) return null;
  try { // tiny recursive-descent parser: no eval
    let i = 0;
    const peek = () => s[i];
    const num = () => { const st = i; while (/[\d.]/.test(s[i] || "")) i++; if (st === i) throw new Error("num"); return parseFloat(s.slice(st, i)); };
    const atom = () => { if (peek() === "(") { i++; const v = sum(); if (peek() !== ")") throw new Error(")"); i++; return v; } if (peek() === "-") { i++; return -atom(); } return num(); };
    const prod = () => { let v = atom(); while (peek() === "*" || peek() === "/") { const o = s[i++]; const r = atom(); v = o === "*" ? v * r : v / r; } return v; };
    const sum = () => { let v = prod(); while (peek() === "+" || peek() === "-") { const o = s[i++]; const r = prod(); v = o === "+" ? v + r : v - r; } return v; };
    const v = sum();
    return i === s.length && Number.isFinite(v) ? v : null;
  } catch (e) { return null; }
}
const decimalsOf = (x) => { const m = /\.(\d+)/.exec(String(x)); return m ? m[1].length : 0; };

/* → { ok, steps:[{text, ok, why}], final: number|null } ;  CALC: <step>; <step> => <final>   a step is  "expression = result unit"  or  "N unitA = M unitB" */
export function checkCalc(calc, { yesWhy = "" } = {}) {
  const out = { ok: true, steps: [], final: null };
  if (!calc) return out;
  const parts = String(calc).split(/\s*(?:;|⇒|=>)\s*/).map((x) => x.trim()).filter(Boolean);
  for (const p of parts) {
    const sides = p.split("=").map((x) => x.trim()).filter(Boolean);
    if (sides.length < 2) { const v = evalExpr(p); if (v != null && /[\d]/.test(p) && parts[parts.length - 1] === p) out.final = v; continue; }
    const rhsTxt = sides[sides.length - 1];
    const rn = /(-?\d+(?:[.,]\d+)?)/.exec(rhsTxt);
    if (!rn) continue;
    const rhs = parseFloat(rn[1].replace(",", "."));
    const step = { text: p, ok: true, why: "" };
    // a pure unit conversion  "500 mg = 0.5 g"
    const a = new RegExp(`^(-?\\d+(?:[.,]\\d+)?)\\s*(${UNIT_RX})\\s*$`, "i").exec(sides[0]);
    const b2 = new RegExp(`^(-?\\d+(?:[.,]\\d+)?)\\s*(${UNIT_RX})\\b`, "i").exec(rhsTxt);
    if (sides.length === 2 && a && b2 && normUnit(a[2]) !== normUnit(b2[2])) {
      const f = CONV[`${normUnit(a[2])}>${normUnit(b2[2])}`];
      if (f == null) { step.ok = false; step.why = `unknown conversion ${a[2]} → ${b2[2]}`; }
      else { const want = parseFloat(a[1].replace(",", ".")) * f; if (Math.abs(want - rhs) > Math.max(1e-9, Math.abs(want) * 0.005)) { step.ok = false; step.why = `${a[1]} ${a[2]} = ${Math.round(want * 1e6) / 1e6} ${b2[2]}, not ${rhs}`; } }
    } else {
      const lhs = evalExpr(sides[0]);
      if (lhs == null) { step.why = "not an arithmetic step"; }
      else {
        const d = decimalsOf(rn[1]);
        const rounded = Math.round(lhs * 10 ** d) / 10 ** d;
        const tol = Math.max(1e-9, Math.abs(lhs) * 0.005);
        if (Math.abs(lhs - rhs) > tol && Math.abs(rounded - rhs) > 1e-9) { step.ok = false; step.why = `${sides[0]} = ${Math.round(lhs * 1e6) / 1e6}, not ${rhs}`; }
      }
    }
    if (!step.ok) out.ok = false;
    out.steps.push(step);
    out.final = rhs;
  }
  // the final value must appear in the ✅ option's text (when that text carries a number)
  if (out.final != null && yesWhy) {
    const nums = [...yesWhy.matchAll(/-?\d+(?:[.,]\d+)?/g)].map((m) => parseFloat(m[0].replace(",", ".")));
    if (nums.length && !nums.some((n) => Math.abs(n - out.final) <= Math.max(1e-9, Math.abs(out.final) * 0.01))) { out.ok = false; out.steps.push({ text: "final value", ok: false, why: `CALC ends at ${out.final} but the ✅ option says ${nums.join(" / ")}` }); }
  }
  return out;
}

/* ── B2 · confidence from the answer tokens ── */
const lp = (x) => (typeof x === "number" ? Math.exp(x) : 0);
/* logprobsResult → { chosen:[{token, p}], top:[[{token,p}]] } */
export function normLogprobs(r) {
  if (!r) return null;
  const chosen = (r.chosenCandidates || []).map((c) => ({ token: c.token, p: lp(c.logProbability) }));
  const top = (r.topCandidates || []).map((t) => (t.candidates || []).map((c) => ({ token: c.token, p: lp(c.logProbability) })));
  return chosen.length ? { chosen, top } : null;
}

/* the tokens of the "ANSWER:" line → the position of every option letter that was chosen */
export function answerPositions(L) {
  if (!L) return [];
  let acc = "", start = -1;
  for (let i = 0; i < L.chosen.length; i++) {
    acc += L.chosen[i].token;
    if (start < 0 && /(?:^|\n)\s*ANSWER\s*:\s*$/i.test(acc)) { start = i + 1; break; }
  }
  if (start < 0) return [];
  const pos = [];
  for (let i = start; i < L.chosen.length; i++) {
    const tk = L.chosen[i].token;
    if (/\n/.test(tk) && pos.length) break;
    const m = /^\s*([A-H])\s*$/.exec(tk);
    if (m) pos.push({ i, letter: m[1] });
    if (pos.length >= 8) break;
  }
  return pos;
}

/* → { p1, margin, runnerUp, per:[{letter, p}], missed:[{letter,p}], digitsLow } renormalised over the valid option letters */
export function answerConfidence(L, validLetters) {
  const pos = answerPositions(L);
  if (!pos.length) return null;
  const valid = new Set(validLetters && validLetters.length ? validLetters : "ABCDEFGH".split(""));
  const per = [];
  let runnerUp = null, p1 = null, margin = null;
  pos.forEach((ps, k) => {
    const alts = (L.top[ps.i] || []).map((c) => ({ letter: (/^\s*([A-H])\s*$/.exec(c.token) || [])[1], p: c.p })).filter((c) => c.letter && valid.has(c.letter));
    if (!alts.some((a) => a.letter === ps.letter)) alts.push({ letter: ps.letter, p: L.chosen[ps.i].p });
    const sum = alts.reduce((a, c) => a + c.p, 0) || 1;
    const sorted = alts.map((c) => ({ letter: c.letter, p: c.p / sum })).sort((a, b) => b.p - a.p);
    const mine = sorted.find((c) => c.letter === ps.letter);
    per.push({ letter: ps.letter, p: mine ? mine.p : 0 });
    if (k === 0) { p1 = sorted[0].p; margin = sorted.length > 1 ? sorted[0].p - sorted[1].p : sorted[0].p; runnerUp = sorted.find((c) => c.letter !== ps.letter) || null; if (runnerUp && sorted[0].letter !== ps.letter) runnerUp = sorted[0]; }
  });
  // option letters that were NOT chosen but carried real probability at some answer position (a select-all item may be missing them)
  const chosenSet = new Set(per.map((x) => x.letter));
  const missed = [];
  for (const ps of pos) for (const c of L.top[ps.i] || []) { const l = (/^\s*([A-H])\s*$/.exec(c.token) || [])[1]; if (l && valid.has(l) && !chosenSet.has(l) && c.p >= 0.15 && !missed.some((m) => m.letter === l)) missed.push({ letter: l, p: c.p }); }
  return { p1: p1 == null ? per[0].p : p1, margin: margin == null ? 1 : margin, runnerUp: runnerUp && runnerUp.letter !== (per[0] && per[0].letter) ? runnerUp : runnerUp, per, missed };
}

/* the digits and unit tokens inside the DATA line: any with a low probability → "check this" */
export function dataDoubts(L, minP = 0.7) {
  if (!L) return [];
  let acc = "", from = -1, to = L.chosen.length;
  for (let i = 0; i < L.chosen.length; i++) {
    acc += L.chosen[i].token;
    if (from < 0 && /(?:^|\n)\s*DATA\s*:\s*$/i.test(acc)) from = i + 1;
    else if (from >= 0 && /\n/.test(L.chosen[i].token)) { to = i; break; }
  }
  if (from < 0) return [];
  const out = [];
  for (let i = from; i < to; i++) {
    const c = L.chosen[i];
    if (/\d|mg|mmol|mEq|g\/dL|mmHg|°|%/.test(c.token) && c.p < minP) out.push({ token: c.token.trim(), p: Math.round(c.p * 100) / 100 });
  }
  return out;
}

/* the thresholds of this profile (calibration.js) */
export const thresholdsFor = (profile) => { const k = profileKey(profile || {}); const c = CAL[k] || CAL[(profile && profile.discipline) || ""] || null; return c ? { ...DEFAULT_THRESHOLDS, ...c.thresholds, calibrated: !!c.calibrated, n: c.n || 0, highErr: c.highErr } : { ...DEFAULT_THRESHOLDS, calibrated: false, n: 0 }; };

/* ── the one function: raw brief + logprobs + stem + profile → the assessment ── */
export function assessSolve({ raw, logprobs, stem = "", profile, kbFlags = [] } = {}) {
  const b = parseBrief(raw);
  const th = thresholdsFor(profile);
  const L = normLogprobs(logprobs);
  const flags = [...formatChecks(b, { stem, profile })];
  const reasons = [];
  const fmt = itemFormat(b.type, stem);

  // B5 · what the model read from the image: KB range check of every lab in DATA, with the patient's sex / age from DATA + stem
  const dataFlags = [];
  if (b.data) {
    const patient = patientOf(`${stem}\n${b.data}`);
    for (const part of b.data.split(/[;\n]|,(?=\s*[A-Za-z\u0621-\u064A])/)) {
      const info = rangeInfo(part, patient, profile);
      if (!info) continue;
      dataFlags.push({ text: part.trim(), analyte: info.analyte, status: info.noStratum ? "no-range" : [...info.statuses].join("/"), range: info.noStratum ? "" : describeRange(info) });
    }
    // an option verdict that calls a lab normal / abnormal against the code's reading
    for (const o of b.options) {
      const rc = rangeContradiction(o.why, patient, profile);
      if (rc) flags.push({ code: "kb-range", msg: `option ${o.letter}: ${rc.text}` });
    }
  }
  for (const f of kbFlags) flags.push(f);

  // B4 · CALC
  const yes = b.options.find((o) => o.mark === "yes");
  const calc = b.calc ? checkCalc(b.calc, { yesWhy: yes ? yes.why : "" }) : null;
  if (calc && !calc.ok) flags.push({ code: "calc", msg: calc.steps.filter((s) => !s.ok).map((s) => s.why).join("; ") });
  if (/\b(?:calculat|dose|dosage|mL\/h|drip|rate|conversion)\w*/i.test(`${b.type} ${stem}`) && !b.calc) reasons.push("a calculation item without a CALC line");

  // B2 · confidence
  const conf = L ? answerConfidence(L, b.options.map((o) => o.letter)) : null;
  const doubts = dataDoubts(L);
  let tier;
  if (conf) {
    tier = conf.p1 >= th.high && conf.margin >= th.margin ? "HIGH" : conf.p1 >= th.medium ? "MEDIUM" : "LOW";
    if (b.confidence === "low") tier = tierDown(tier);                                    // the verbalised line is only a tie-breaker / a brake
    else if (Math.abs(conf.p1 - th.high) < 0.03 && b.confidence === "high" && tier === "MEDIUM") tier = "HIGH";
  } else {
    tier = b.confidence === "low" ? "LOW" : "MEDIUM";                                      // no logprobs: code checks + the verbalised line, capped at MEDIUM
    reasons.push("answer probabilities were not available");
  }
  if (!th.calibrated) { tier = tierMin(tier, "MEDIUM"); reasons.push("not calibrated for this subject"); }
  // the model must reason BEFORE it commits: no premise, or a premise written after the answer, is not the reasoning order this analysis was designed for
  if (b.answerRaw && (!b.premise || !b.premiseFirst)) { tier = tierMin(tier, "MEDIUM"); reasons.push(!b.premise ? "no clinical premise before the answer" : "the premise came after the answer"); }
  if (!b.answerRaw) tier = "LOW";
  if (flags.length) tier = "LOW";
  if (/blur|crop|cut off|unreadable|illegible|ambiguous|missing information|can.?t read/i.test(b.confidenceReason)) { tier = "LOW"; reasons.push(b.confidenceReason); }
  if (b.confidence && b.confidence !== "high" && b.confidenceReason) reasons.push(b.confidenceReason);
  if (doubts.length) reasons.push("a number or unit in what I read from the image is uncertain");
  if (!b.answerRaw) reasons.push("no answer was produced");

  const per = conf ? conf.per : [];
  return {
    tier, calibrated: th.calibrated, premise: b.premise, premiseFirst: b.premiseFirst, premiseLong: b.premiseLong, answer: b.answerRaw, letters: b.letters, format: fmt, type: b.type, keyword: b.keyword,
    p1: conf ? Math.round(conf.p1 * 1000) / 1000 : null, margin: conf ? Math.round(conf.margin * 1000) / 1000 : null,
    runnerUp: conf && conf.runnerUp ? { letter: conf.runnerUp.letter, p: Math.round(conf.runnerUp.p * 1000) / 1000 } : null,
    perOption: per.map((x) => ({ letter: x.letter, p: Math.round(x.p * 100) / 100, high: x.p >= th.high })), missed: conf ? conf.missed : [],
    data: b.data, dataFlags, dataDoubts: doubts, flags, reasons: [...new Set(reasons)], calc, verbalized: b.confidence,
    hasLogprobs: !!conf, eligible: tier === "HIGH" && !flags.length,
    perOptionAdvice: penalizesWrongPicks(profile, fmt),          // only for exams that really penalise a wrong pick (never invented for the others)
  };
}

/* ── B6 · what the screen says ── */
export function banner(a, lang = "ar") {
  if (!a || a.tier === "HIGH") return null;
  const ar = lang !== "en";
  const why = [...a.flags.map((f) => f.msg), ...a.reasons].filter(Boolean).slice(0, 4);
  const head = ar ? (a.tier === "LOW" ? "الذكاء الاصطناعي مش متأكد من الإجابة دي" : "الذكاء الاصطناعي مش متأكد 100% من الإجابة دي") : (a.tier === "LOW" ? "AI is not sure about this answer" : "AI is not fully sure about this answer");
  const likely = a.answer ? (ar ? `الأرجح: ${a.answer.split("\n")[0]}` : `Most likely: ${a.answer.split("\n")[0]}`) : "";
  const ru = a.runnerUp ? (ar ? `البديل الأقرب: ${a.runnerUp.letter}` : `Runner-up: ${a.runnerUp.letter}`) : "";
  const adv = a.perOptionAdvice && a.perOption.length ? (ar ? "الامتحان ده بيخصم على الاختيار الغلط: اختار بس الاختيارات اللي ثقتها عالية." : "This exam penalises wrong picks: select only the high-confidence options.") : "";
  return { tier: a.tier, head, likely, runnerUp: ru, why, advice: adv, perOption: a.perOptionAdvice ? a.perOption : [] };
}

/* ── B8 · lesson consistency ──
   The correct-answer section must equal the brief's ANSWER. Mismatch → that section's first line is replaced by the brief's answer, and the flag is reported.
   For MEDIUM / LOW the "AI is not sure" bullet is added BY CODE (the prompt no longer spends tokens on it). */
const ANSWER_HEAD = /^##\s*(?:✅\s*)?(?:الإجابة الصح|The correct answer)\s*$/m;
export function reconcileLesson(text, a, lang = "ar") {
  if (!a || !a.answer) return { text, mismatch: false, replaced: false };
  const t = String(text || "");
  const m = ANSWER_HEAD.exec(t);
  if (!m) return { text: t, mismatch: false, replaced: false };
  const start = m.index + m[0].length;
  const rest = t.slice(start);
  const nextH = /\n##\s/.exec(rest);
  const body = nextH ? rest.slice(0, nextH.index) : rest;
  const tail = nextH ? rest.slice(nextH.index) : "";
  const first = body.split("\n").find((l) => l.trim()) || "";
  const bold = [...first.matchAll(/\*\*\s*([A-H])\s*\)?\s*\*\*/g)].map((x) => x[1]);
  const wrote = [...new Set(bold.length ? bold : [...first.matchAll(LETTER)].map((x) => x[1]))].sort().join(",");
  const want = [...a.letters].sort().join(",");
  let mismatch = false, newBody = body;
  if (want && wrote && wrote !== want) {
    mismatch = true;
    const label = a.answer.split("\n")[0].replace(/\*+/g, "");
    newBody = `\n- **${label}** — ${lang === "en" ? "(corrected to match the verified analysis)" : "(اتصحّحت عشان تطابق التحليل المتحقق منه)"}\n`;
  }
  let warn = "";
  if (a.tier !== "HIGH") warn = `\n- ⚠️ ${lang === "en" ? "The AI is not sure of this answer; treat it as the most likely one" : "الذكاء الاصطناعي مش متأكد من الإجابة دي؛ اعتبرها الأرجح مش المؤكدة"}${a.runnerUp ? ` (${lang === "en" ? "runner-up" : "البديل"}: ${a.runnerUp.letter})` : ""}.`;
  const out = t.slice(0, start) + warn + newBody + tail;
  return { text: out, mismatch, replaced: mismatch || !!warn };
}
