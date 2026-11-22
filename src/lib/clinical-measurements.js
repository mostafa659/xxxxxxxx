/* ───────────── lib/clinical-measurements.js · read measurements out of free text (v3.67) ─────────────
   ROOT CAUSES this module removes (all reproduced from v3.66.0):
   1. LINE-LEVEL time scope. «Baseline/current creatinine 1.3/3.1 … Sodium 129 …» tagged EVERY later value on the line as baseline
      (na_baseline, chloride_baseline, paco2_baseline …), so the source channel lost its current Na/Cl/HCO₃/PaCO₂ and "PaCO₂ shown in the UI, missing in verification" followed.
      → Scope is now decided per MEASUREMENT from the cues next to it (before the label, after the number, slash pairs, «from X to Y», parentheses).
   2. GLUED UNITS. The old regexes needed «129 mmol/L» exactly; «Na 129,», «sodium 129 (mmol/L)», «sodium (mmol/L) 129» extracted nothing.
      → Units may be missing, parenthesised or shared by a pair. A missing unit is assumed ONLY where the analyte has one physiological unit
        for that magnitude (Na/Cl/HCO₃/K mmol/L≡mEq/L, pH, PaCO₂ mmHg ≥10, Hb g/dL 2–25, creatinine mg/dL ≤15, albumin g/dL ≤6.5). Glucose, BUN, lactate… are never assumed.
   3. Sample identity. A hemolyzed potassium and a repeat non-hemolyzed potassium are different measurements (potassium_hemolyzed / potassium), not a "conflict".
   Ambiguity is never resolved by guessing: a slash pair with no time cue (e.g. «creatinine 1.3/3.1») yields no values and is reported in `ambiguities`. */

const NUM = "[0-9٠-٩۰-۹]+(?:[.,٫][0-9٠-٩۰-۹]+)?";
const NUMBER_AT = new RegExp(`^[-−]?${NUM}`);

const U = {
  mmhg: String.raw`mm\s*\/?\s*hg`, mmoll: String.raw`mmol\s*\/\s*l`, meql: String.raw`meq\s*\/\s*l`, mgdl: String.raw`mg\s*\/\s*dl`, gdl: String.raw`g\s*\/\s*dl`,
  umol: String.raw`[µμu]mol\s*\/\s*l`, pct: String.raw`%`, mlmin: String.raw`ml\s*\/\s*min`, lmin: String.raw`l\s*\/\s*min`, mldl: String.raw`ml\s*\/\s*dl`,
  lh: String.raw`l\s*\/\s*h(?:r|our)?`, mgl: String.raw`mg\s*\/\s*l`, mosm: String.raw`mosm(?:ol)?\s*\/\s*kg`, bpm: String.raw`bpm|beats?\s*\/\s*min|\/\s*min|per\s+minute`,
};

/* key, labels [[source, flags]], units (regex sources), bare {unit,min,max} | null, noUnit (a pure number is the reading) */
const A = (key, labels, units, extra = {}) => ({ key, labels, units, ...extra });
const ANALYTES = [
  A("map", [[String.raw`mean\s+arterial\s+pressure`, "gi"], [String.raw`\bMAP\b`, "g"]], [U.mmhg]),
  A("sbp", [[String.raw`systolic\s+blood\s+pressure`, "gi"], [String.raw`\bSBP\b`, "gi"]], [U.mmhg]),
  A("dbp", [[String.raw`diastolic\s+blood\s+pressure`, "gi"], [String.raw`\bDBP\b`, "gi"]], [U.mmhg]),
  A("bp", [[String.raw`blood\s+pressure`, "gi"], [String.raw`\bBP\b`, "g"]], [U.mmhg], { composite: true }),
  A("hr", [[String.raw`heart\s+rate`, "gi"], [String.raw`\bHR\b`, "g"], [String.raw`\bpulse(?:\s+rate)?\b`, "gi"]], [U.bpm], { bare: { unit: "bpm", min: 15, max: 260 } }),
  A("cvp", [[String.raw`central\s+venous\s+pressure`, "gi"], [String.raw`\bCVP\b`, "gi"]], [U.mmhg]),
  A("co", [[String.raw`cardiac\s+output`, "gi"], [String.raw`\bCO\b(?![₂2])`, "g"]], [U.lmin]),
  A("vo2", [[String.raw`oxygen\s+consumption`, "gi"], [String.raw`\bVO[2₂]\b`, "gi"]], [U.mlmin]),
  A("cao2", [[String.raw`arterial\s+oxygen\s+content`, "gi"], [String.raw`\bCaO[2₂]\b`, "gi"]], [U.mldl]),
  A("cvo2", [[String.raw`venous\s+oxygen\s+content`, "gi"], [String.raw`\bCvO[2₂]\b`, "gi"]], [U.mldl]),
  A("hb", [[String.raw`h(?:a)?emoglobin`, "gi"], [String.raw`\bHb\b`, "gi"]], [U.gdl], { bare: { unit: "g/dL", min: 2, max: 25 } }),
  A("sao2", [[String.raw`arterial\s+oxygen\s+saturation`, "gi"], [String.raw`\bSaO[2₂]\b`, "gi"]], [U.pct]),
  A("pao2", [[String.raw`arterial\s+oxygen\s+partial\s+pressure`, "gi"], [String.raw`\bPaO[2₂]\b`, "gi"]], [U.mmhg]),
  A("svo2", [[String.raw`venous\s+oxygen\s+saturation`, "gi"], [String.raw`\bSvO[2₂]\b`, "gi"]], [U.pct]),
  A("pvo2", [[String.raw`venous\s+oxygen\s+partial\s+pressure`, "gi"], [String.raw`\bPvO[2₂]\b`, "gi"]], [U.mmhg]),
  A("fu", [[String.raw`unbound\s+fraction`, "gi"], [String.raw`free\s+fraction`, "gi"], [String.raw`\bfu\b`, "gi"]], [], { noUnit: true }),
  A("sc", [[String.raw`sieving\s+coefficient`, "gi"], [String.raw`\bSC\b`, "g"]], [], { noUnit: true }),
  A("clint", [[String.raw`intrinsic\s+clearance`, "gi"], [String.raw`\bCLint\b`, "gi"]], [U.lh]),
  A("qeff", [[String.raw`(?:delivered|effective)\s+effluent\s+flow`, "gi"], [String.raw`\bQeff\b`, "gi"]], [U.lh]),
  A("cssu", [[String.raw`target\s+unbound\s+concentration`, "gi"], [String.raw`unbound\s+Css`, "gi"], [String.raw`\bCssu\b`, "gi"]], [U.mgl]),
  A("ethanoldivisor", [[String.raw`ethanol\s+(?:conversion\s+)?divisor`, "gi"], [String.raw`ethanol\s+coefficient`, "gi"], [String.raw`\bEthanolDivisor\b`, "gi"]], [], { noUnit: true }),
  A("na", [[String.raw`sodium`, "gi"], [String.raw`\bNa\+?(?![A-Za-z])`, "g"]], [U.mmoll, U.meql], { bare: { unit: "mmol/L", min: 90, max: 200 } }),
  A("glucose", [[String.raw`glucose`, "gi"], [String.raw`blood\s+sugar`, "gi"]], [U.mgdl, U.mmoll]),
  A("bun", [[String.raw`blood\s+urea\s+nitrogen`, "gi"], [String.raw`\bBUN\b`, "gi"]], [U.mgdl, U.mmoll]),
  A("urea", [[String.raw`\burea\b`, "gi"]], [U.mgdl, U.mmoll]),
  A("measuredosm", [[String.raw`measured\s+(?:serum\s+)?osmolality`, "gi"]], [U.mosm]),
  A("ethanol", [[String.raw`ethanol`, "gi"], [String.raw`alcohol\s+level`, "gi"]], [U.mgdl]),
  A("ph", [[String.raw`\bpH\b`, "gi"]], [], { noUnit: true }),
  A("chloride", [[String.raw`chloride`, "gi"], [String.raw`\bCl[-⁻]?(?![A-Za-z])`, "g"]], [U.mmoll, U.meql], { bare: { unit: "mmol/L", min: 60, max: 160 } }),
  A("hco3", [[String.raw`bicarbonate`, "gi"], [String.raw`\bHCO[₃3][⁻-]?`, "gi"]], [U.mmoll, U.meql], { bare: { unit: "mmol/L", min: 3, max: 60 } }),
  A("albumin", [[String.raw`albumin`, "gi"], [String.raw`\bAlb\b`, "gi"]], [U.gdl], { bare: { unit: "g/dL", min: 0.5, max: 6.5 } }),
  A("paco2", [[String.raw`PaCO[₂2]`, "gi"], [String.raw`arterial\s+carbon\s+dioxide`, "gi"], [String.raw`\bp(?:a)?CO[₂2]\b`, "g"]], [U.mmhg], { bare: { unit: "mmHg", min: 10, max: 150 } }),
  A("potassium", [[String.raw`potassium`, "gi"], [String.raw`\bK\+?(?![A-Za-z])(?=\s*[:=]?\s*\(?\s*[0-9٠-٩])`, "g"]], [U.mmoll, U.meql], { bare: { unit: "mmol/L", min: 1.5, max: 12 } }),
  A("creatinine", [[String.raw`creatinine`, "gi"], [String.raw`\bS?Cr\b(?=\s*[:=]?\s*\(?\s*[0-9٠-٩])`, "g"]], [U.mgdl, U.umol], { bare: { unit: "mg/dL", min: 0.2, max: 15 } }),
  A("lactate", [[String.raw`lactate`, "gi"]], [U.mmoll]),
];

const BASE = /\b(?:baseline|historical|prior|previous(?:ly)?|usual|premorbid|pre-?admission|pre-?op(?:erative)?|before|earlier|(?:two|three|four|six|twelve|\d+)\s+(?:days?|weeks?|months?|years?)\s+ago)\b/i;
const CUR = /\b(?:current(?:ly)?|latest|present|now|today|on\s+admission|at\s+presentation|presenting|admission|repeat(?:ed)?|second|follow-?up|recent|re-?test(?:ed)?)\b/i;
const NONHEMO = /non[-\s]?h(?:a)?emoly[sz]ed|not\s+h(?:a)?emoly[sz]ed|without\s+h(?:a)?emolysis/i;
const HEMO = /(?<![-\s]non)(?<!not\s)h(?:a)?emoly(?:[sz]ed|sis)|contaminated|spurious/i;

const roleOf = (s) => (BASE.test(s) ? "baseline" : CUR.test(s) ? "current" : "");
const sampleOf = (s) => (NONHEMO.test(s) ? "" : HEMO.test(s) ? "hemolyzed" : "");

function compile(a) {
  const labels = a.labels.map(([src, fl]) => new RegExp(src, fl.includes("g") ? fl : `${fl}g`));
  const unit = a.units.length ? new RegExp(`^\\s*(?:\\(\\s*)?(${a.units.join("|")})(?![A-Za-z])(?:\\s*\\))?`, "i") : null;
  return { ...a, labelRes: labels, unitRe: unit };
}
const COMPILED = ANALYTES.map(compile);
const ANY_UNIT = new RegExp(`^\\s*(?:\\(\\s*)?(${Object.values(U).join("|")})(?![A-Za-z])(?:\\s*\\))?`, "i");

function labelMatches(text) {
  const all = [];
  for (const a of COMPILED) for (const re of a.labelRes) for (const m of text.matchAll(re)) all.push({ a, start: m.index, end: m.index + m[0].length });
  all.sort((x, y) => x.start - y.start || (y.end - y.start) - (x.end - x.start));
  const kept = [];
  for (const m of all) { const last = kept[kept.length - 1]; if (!last || m.start >= last.end) kept.push(m); }   // sorted by start: only the last kept span can overlap
  return kept;
}

const FILLER = /^\s*(?:\(\s*[^()0-9]{0,40}\)\s*)*(?:(?:level|levels|concentration|value|result|results|reading)\b\s*)?(?:[:=|\-–—]|(?:was|were|is|are|of|at|to\s+be|measured(?:\s+at)?|came\s+back(?:\s+at)?|returned(?:\s+at)?|(?:rose|fell|dropped|increased|decreased|declined|up|down|reached)\s+to|around|about|approximately|~|≈)\b)?\s*/i;
const FROM_TO = new RegExp(`^\\s*(?:[A-Za-z]+\\s+){0,2}?(?:from|between)\\s+(${NUM})\\s*([^0-9\\s]{0,12}(?:\\s*\\/\\s*[A-Za-z]+)?)?\\s*(?:to|→|->|until|and)\\s*(${NUM})`, "i");
const PRE_PAIR = /(baseline|historical|prior|previous|usual|admission|current|latest|present|now|repeat|follow-?up)\s*(?:\/|\\|→|->|,|and|vs\.?|then|to)\s*(baseline|historical|prior|previous|current|latest|present|now|repeat|follow-?up|discharge|today)\s*$/i;

function parseValue(raw) { return Number(String(raw).replace(/[−]/g, "-").replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0)).replace(/٫/g, ".").replace(",", ".")); }
const normUnit = (u) => String(u || "").replace(/\s+/g, "").replace(/^mm\/?hg$/i, "mmHg");

function sentenceEnd(text, from, limit) {
  let end = Math.min(text.length, from + limit);
  const nl = text.indexOf("\n", from); if (nl >= 0 && nl < end) end = nl;
  const semi = text.slice(from, end).search(/[;؛]/); if (semi >= 0) end = from + semi;
  const dot = text.slice(from, end).search(/(?<![0-9٠-٩])\.(?=\s|$)/); if (dot >= 0) end = from + dot;
  return end;
}

/* the item that contains the label: cue words printed immediately before it, within the same list item */
function preCueOf(text, start) {
  const lineStart = text.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const before = text.slice(Math.max(lineStart, start - 70), start);
  const item = before.split(/[,;]|\.\s|\(|\)/).pop() || "";
  const pair = PRE_PAIR.exec(item.trimEnd() ? item : "");
  return { item, pair: pair ? [roleOf(pair[1]) || "current", roleOf(pair[2]) || "current"] : null, role: roleOf(item), sample: sampleOf(item) };
}

/* «Baseline labs: …» at the start of the line, or a markdown heading naming the baseline, scopes the whole list */
function listScope(text, start) {
  const lineStart = text.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const line = text.slice(lineStart, start);
  const lead = /^\s*(?:[-*•]\s*)?((?:baseline|historical|prior|previous|pre-?admission|pre-?op(?:erative)?)\s+(?:labs?|laboratory|values?|results?|investigations?|data|chemistry|tests?))\s*[:\-–]/i.exec(line);
  if (lead) return "baseline";
  // headings are indexed once per text (the previous per-label rescan of the whole prefix was quadratic on long documents)
  if (headCache.text !== text) { headCache.text = text; headCache.list = [...text.matchAll(/(?:^|\n)\s*#{1,6}\s*([^\n]+)/g)].map((m) => ({ at: m.index, base: BASE.test(m[1]) })); }
  const list = headCache.list;
  let lo = 0, hi = list.length - 1, found = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (list[mid].at < start) { found = mid; lo = mid + 1; } else hi = mid - 1; }
  return found >= 0 && list[found].base ? "baseline" : "";
}
const headCache = { text: null, list: [] };

function readSlots(a, region) {
  const slots = [];
  const ambiguous = [];
  let rest = region;
  const ft = FROM_TO.exec(rest);
  if (ft && !a.composite) {
    const tailUnit = ANY_UNIT.exec(rest.slice(ft[0].length));
    const unit = normUnit((ft[2] && ANY_UNIT.test(ft[2]) ? ANY_UNIT.exec(ft[2])[1] : "") || (tailUnit ? tailUnit[1] : ""));
    return { slots: [{ raw: ft[1], unit, cues: "baseline" }, { raw: ft[3], unit, cues: "current" }], fromTo: true, ambiguous };
  }
  const f = FILLER.exec(rest); if (f) rest = rest.slice(f[0].length);
  let leadQual = f ? f[0] : "";
  for (let guard = 0; guard < 4 && rest.length; guard++) {
    const inline = /^\s*(?:\(\s*)?((?:baseline|historical|prior|previous|usual|premorbid|current|latest|present|now|repeat(?:ed)?|admission)\b)\s*(?:value|level|result)?\s*[:=]?\s*/i.exec(rest);
    let cue = inline ? inline[1] : "";
    if (inline) rest = rest.slice(inline[0].length);
    const n = NUMBER_AT.exec(rest.replace(/^\s+/, ""));
    if (!n) break;
    rest = rest.replace(/^\s+/, "").slice(n[0].length);
    let unit = "";
    const u = a.unitRe ? a.unitRe.exec(rest) : null;
    if (u) { unit = normUnit(u[1]); rest = rest.slice(u[0].length); }
    else {
      const any = ANY_UNIT.exec(rest);
      if (any) { unit = `!${normUnit(any[1])}`; rest = rest.slice(any[0].length); }   // a unit that is NOT valid for this analyte
    }
    // trailing cue: «at baseline», «previously», «currently», «(hemolyzed)»
    const trail = /^\s*(?:\(\s*)?((?:at\s+|on\s+)?(?:baseline|previously|prior|before|admission|presentation|currently|now|today|(?:\w+\s+){0,2}ago|h(?:a)?emoly[sz]ed|non[-\s]?h(?:a)?emoly[sz]ed|repeat(?:ed)?|contaminated|spurious)\b[^,;()\d]{0,30})\)?/i.exec(rest);
    let trailCue = "";
    // a cue that is directly followed by a number belongs to the NEXT reading («7.6 g/dL (baseline 11.2)»), not to this one
    if (trail) {
      // the cue regex may swallow a connector («two months ago and …»): give it back so the continuation rule can use it
      const conn = trail[0].endsWith(")") ? null : /\s*\b(?:and|then|vs\.?)\s*$/i.exec(trail[1]);
      const used = trail[0].length - (conn ? conn[0].length : 0);
      if (!/^\s*(?:value|level|result)?\s*[:=]?\s*[-−]?[0-9٠-٩]/i.test(rest.slice(used))) { trailCue = conn ? trail[1].slice(0, trail[1].length - conn[0].length) : trail[1]; rest = rest.slice(used); }
    }
    slots.push({ raw: n[0], unit, cues: `${cue} ${trailCue}`.trim() });
    // continuation: «/ 3.1», «→ 3.1», «, current 3.1», «(baseline 11.2)», «and 7.6»
    const hadCue = !!(cue || trailCue);   // «1.3 mg/dL previously, 3.1 mg/dL currently»: a comma may continue a list whose readings carry their own cues
    const cont = new RegExp(`^\\s*(?:\\(\\s*|\\/\\s*|→\\s*|->\\s*|\\bto\\b\\s*|\\band\\b\\s*|\\bvs\\.?\\s*|,\\s*(?=(?:baseline|historical|prior|previous|usual|current|latest|now|repeat${hadCue ? `|${NUM}` : ""})))`, "i").exec(rest);
    if (!cont) break;
    const after = rest.slice(cont[0].length);
    if (!(NUMBER_AT.test(after) || /^(?:baseline|historical|prior|previous|usual|premorbid|current|latest|present|now|repeat(?:ed)?|admission)\b/i.test(after))) break;
    rest = after;
  }
  // «1.3/3.1 mg/dL» / «baseline 11.2, current 7.6 g/dL»: readings of one analyte share the unit that is printed once
  const printed = slots.find((s) => s.unit && !s.unit.startsWith("!"));
  if (printed) for (const s of slots) if (!s.unit) s.unit = printed.unit;
  return { slots, fromTo: false, ambiguous, leadQual };
}

/* → { measurements:[{key,value,unit,assumedUnit,role,sample,index,raw}], ambiguities:[string] } */
export function extractMeasurements(text = "") {
  // markdown emphasis («**Sodium:** 129») is blanked with SAME-LENGTH spaces so every offset (site tags, headings) stays valid
  const src = String(text || "").replace(/\*\*|__/g, "  ").replace(/[`$]/g, " ");
  const labels = labelMatches(src);
  const measurements = [], ambiguities = [];
  for (let i = 0; i < labels.length; i++) {
    const L = labels[i], a = L.a;
    const regionEnd = Math.min(sentenceEnd(src, L.end, 180), labels[i + 1] ? labels[i + 1].start : src.length);
    const region = src.slice(L.end, regionEnd);
    if (a.composite) {
      const m = /^\s*(?:\(\s*[^()0-9]{0,25}\)\s*)?(?:[:=|]|was|is|of|at)?\s*(\d{2,3})\s*\/\s*(\d{2,3})\s*(mm\s*\/?\s*hg)?/i.exec(region);
      if (!m) continue;
      const sbp = Number(m[1]), dbp = Number(m[2]);
      if (!(sbp > dbp && sbp >= 40 && sbp <= 300 && dbp >= 15 && dbp <= 200)) continue;
      const pre = preCueOf(src, L.start), trailing = /^\s*(?:\(\s*)?((?:at\s+)?(?:baseline|previously|prior|currently|now|admission)\b)/i.exec(region.slice(m[0].length));
      const role = roleOf(trailing ? trailing[1] : "") || pre.role || listScope(src, L.start);
      const sample = pre.sample;
      for (const [key, v] of [["sbp", sbp], ["dbp", dbp]]) measurements.push({ key, value: v, unit: "mmHg", assumedUnit: !m[3], role: role === "baseline" ? "baseline" : "", sample, index: L.start, raw: m[0].trim() });
      continue;
    }
    const pre = preCueOf(src, L.start);
    const { slots, fromTo, leadQual } = readSlots(a, region);
    if (!slots.length) continue;
    const scope = listScope(src, L.start);
    const usable = [];
    slots.forEach((s, idx) => {
      let role = "";
      const slotRole = roleOf(s.cues);
      if (fromTo) role = idx === 0 ? "baseline" : "current";
      else if (slotRole) role = slotRole;
      else if (pre.pair && slots.length >= 2 && idx < 2) role = pre.pair[idx];
      else if (idx === 0) role = pre.role || roleOf(leadQual || "") || scope;
      else role = "?";
      if (role === "?") { ambiguities.push(`${a.key}: reading ${idx + 1} («${s.raw}») has no time cue`); return; }
      if (slots.length >= 2 && !fromTo && !pre.pair && idx === 0 && !slotRole && !pre.role && !scope && slots.slice(1).some((x) => !roleOf(x.cues))) { ambiguities.push(`${a.key}: a slash/arrow pair without a baseline/current cue`); role = "?"; }
      if (role === "?") return;
      const value = parseValue(s.raw);
      if (!Number.isFinite(value)) return;
      let unit = s.unit, assumedUnit = false;
      if (unit.startsWith("!")) return;                        // a unit that does not belong to this analyte: never reinterpret
      if (!unit && idx > 0 && usable[0]) unit = usable[0].unit;   // «1.3/3.1 mg/dL»: the pair shares the unit
      if (!unit && fromTo && slots[0].unit) unit = slots[0].unit;
      if (!unit) {
        if (a.noUnit) unit = "";
        else if (a.bare && value >= a.bare.min && value <= a.bare.max) { unit = a.bare.unit; assumedUnit = true; }
        else return;
      }
      const sample = sampleOf(`${s.cues} ${idx === 0 ? pre.item : ""}`) || (NONHEMO.test(`${s.cues} ${pre.item}`) ? "" : pre.sample);
      const rec = { key: a.key, value, unit, assumedUnit, role: role === "baseline" ? "baseline" : "", sample, index: L.start, raw: `${src.slice(L.start, L.end)} ${s.raw}${unit ? ` ${unit}` : ""}`.trim() };
      usable.push(rec);
    });
    measurements.push(...usable);
  }
  return { measurements, ambiguities };
}
