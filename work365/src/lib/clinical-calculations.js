/*
 * Deterministic clinical calculation audit (v3.60).
 *
 * This module never diagnoses or prescribes. It independently recomputes a small,
 * explicit set of examination calculations from values in the solver DATA field
 * and a separate model-generated source-reading pass / lesson extraction (not an orthogonal OCR engine). Missing inputs are never guessed. In particular, the
 * sieving coefficient is NOT silently replaced with the unbound fraction.
 */

import { extractMeasurements } from "./clinical-measurements.js";
import { extractClaims, verifyClaims } from "./calc-claims.js";

const NUM = "-?[0-9\\u0660-\\u0669]+(?:[.,٫][0-9\\u0660-\\u0669]+)?";
const PAIR_RE = new RegExp(`(?:^|[;|,\\n])\\s*([A-Za-z][A-Za-z0-9_\\u2080-\\u2089]*(?: [A-Za-z][A-Za-z0-9_\\u2080-\\u2089]*){0,3})\\s*=\\s*(${NUM})\\s*([^;,\\n]*)`, "g");

const KEY_ALIASES = {
  map: ["map", "mean arterial pressure"],
  sbp: ["sbp", "systolic blood pressure", "systolic bp", "systolic_bp", "bp systolic", "bp_systolic"],
  dbp: ["dbp", "diastolic blood pressure", "diastolic bp", "diastolic_bp", "bp diastolic", "bp_diastolic"],
  cvp: ["cvp", "central venous pressure"],
  co: ["co", "cardiac output"],
  vo2: ["vo2", "oxygen consumption"],
  cao2: ["cao2", "arterial oxygen content"],
  cvo2: ["cvo2", "venous oxygen content"],
  hb: ["hb", "hemoglobin", "haemoglobin", "current hb", "current_hb", "current hemoglobin", "current haemoglobin"],
  sao2: ["sao2", "arterial oxygen saturation"],
  pao2: ["pao2", "arterial oxygen partial pressure"],
  svo2: ["svo2", "venous oxygen saturation"],
  pvo2: ["pvo2", "venous oxygen partial pressure"],
  na: ["na", "sodium"],
  glucose: ["glucose", "glu"],
  bun: ["bun", "blood urea nitrogen"],
  urea: ["urea"],
  measuredosm: ["measuredosm", "measured osmolality"],
  ethanol: ["ethanol", "etoh"],
  ethanoldivisor: ["ethanoldivisor", "ethanol divisor"],
  chloride: ["chloride", "cl"],
  hco3: ["hco3", "bicarbonate"],
  potassium: ["potassium", "serum potassium", "k"],
  creatinine: ["creatinine", "serum creatinine"],
  albumin: ["albumin", "alb"],
  ph: ["ph"],
  paco2: ["paco2", "arterial carbon dioxide"],
  fu: ["fu", "unbound fraction", "free fraction"],
  clint: ["clint", "intrinsic clearance"],
  qeff: ["qeff", "delivered effluent flow", "effluent flow"],
  sc: ["sc", "sieving coefficient"],
  scequalsfu: ["scequalsfu", "sc equals fu", "sieving coefficient equals fu"],
  cssu: ["cssu", "target unbound concentration", "unbound target concentration"],
  hr: ["hr", "heart rate", "pulse", "pulse rate"],
  lactate: ["lactate", "lactic acid", "serum lactate"],
};

const normKey = (s) => String(s || "").replace(/[₀-₉]/g, (d) => String("₀₁₂₃₄₅₆₇₈₉".indexOf(d))).toLowerCase().replace(/[^a-z0-9]/g, "");
const num = (s) => Number(String(s).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0)).replace(/٫/g, ".").replace(",", "."));
const round = (x, d = 2) => Number.isFinite(x) ? Number(x.toFixed(d)) : null;
const close = (a, b, abs = 0.5, rel = 0.015) => Math.abs(a - b) <= Math.max(abs, Math.abs(b) * rel);

/* v3.67 · ONE identity scheme for a reading: <analyte>[baseline|hemolyzed].
   Before, «historical_hb» became `hb_baseline` (alias table) while «hb_baseline» and every table column became `hbbaseline` (normalised key):
   the same concept lived under two names, so channels could silently fail to meet. Qualifier words (baseline / historical / current / repeat /
   hemolyzed …) are now stripped from ANY spelling of a key and re-attached in a single canonical form. */
const QUALIFIER_RE = /(?:^|[\s_\-()\[\]/,:])(baseline|historical|prior|previous|premorbid|usual|pre-?admission|current|latest|present|repeat(?:ed)?|non[-_ ]?h(?:a)?emoly[sz]ed|h(?:a)?emoly[sz]ed)(?=$|[\s_\-()\[\]/,:])/gi;
const exactAlias = (k) => { for (const [canon, aliases] of Object.entries(KEY_ALIASES)) if (aliases.some((a) => normKey(a) === k)) return canon; return null; };
export function knownKey(key) { const k = String(key || ""); if (Object.hasOwn(KEY_ALIASES, k)) return true; const m = /^(.*?)(?:baseline|hemolyzed)$/.exec(k); return !!(m && m[1] && Object.hasOwn(KEY_ALIASES, m[1])); }

function canonicalKey(key) {
  const k = normKey(key);
  const direct = exactAlias(k);
  if (direct) return direct;
  const quals = [];
  const stripped = String(key || "").replace(QUALIFIER_RE, (m, q) => { quals.push(q.toLowerCase().replace(/[^a-z]/g, "")); return " "; });
  if (quals.length) {
    const base = exactAlias(normKey(stripped));
    if (base) {
      const baseline = quals.some((q) => /^(?:baseline|historical|prior|previous|premorbid|usual|preadmission)$/.test(q));
      const hemolyzed = quals.some((q) => /^h(?:a)?emoly[sz]ed$/.test(q));
      return `${base}${baseline ? "baseline" : ""}${hemolyzed ? "hemolyzed" : ""}`;
    }
  }
  return k;
}

export function parseClinicalDataDiagnostics(text = "") {
  const facts = {};
  const duplicates = [];
  const raw = String(text || "");
  const pairRe = new RegExp(PAIR_RE.source, "g");
  let m;
  while ((m = pairRe.exec(raw))) {
    const key = canonicalKey(m[1]);
    const value = num(m[2]);
    if (!Number.isFinite(value)) continue;
    let tail = String(m[3] || "").trim().replace(/\s+/g, " ");
    let scopedKey = key;
    // «potassium=7.1 mmol/L (hemolyzed)», «hb=11.2 g/dL (baseline)»: a qualifier printed after the unit scopes THIS reading, not the analyte
    const cue = /\(\s*([^()]*?(?:baseline|historical|prior|previous|premorbid|usual|h(?:a)?emoly[sz]ed|non[-\s]?h(?:a)?emoly[sz]ed|repeat(?:ed)?|current)[^()]*?)\s*\)/i.exec(tail);
    if (cue && Object.hasOwn(KEY_ALIASES, key)) {
      const nonHemo = /non[-\s]?h(?:a)?emoly[sz]ed/i.test(cue[1]);
      if (/baseline|historical|prior|previous|premorbid|usual/i.test(cue[1])) scopedKey = `${key}baseline`;
      else if (!nonHemo && /h(?:a)?emoly[sz]ed/i.test(cue[1])) scopedKey = `${key}hemolyzed`;
      tail = tail.replace(cue[0], "").trim();
    }
    const reading = { key: scopedKey, value, unit: tail, raw: m[0].trim().replace(/^[;|,\s]+/, "") };
    if (!facts[scopedKey]) facts[scopedKey] = reading; // first reading wins; conflicting repeats are never silently overwritten
    else {
      const prior = facts[scopedKey];
      if (!close(prior.value, reading.value, 0.0001, 0.0001) || (prior.unit && reading.unit && prior.unit.toLowerCase() !== reading.unit.toLowerCase())) {
        duplicates.push({ key: scopedKey, first: prior, repeated: reading });
      }
    }
  }
  return { facts, duplicates };
}

export function parseClinicalData(text = "") {
  return parseClinicalDataDiagnostics(text).facts;
}

/* Site / sample-route identity of a measurement (ECMO circuit position, arterial site …) — a property of the LINE it is printed on.
   v3.67: TIME scope (baseline / current / repeat / hemolyzed) is no longer decided here. It used to be: any «baseline» word earlier on the line
   tagged every later value as baseline. It is now decided per measurement in clinical-measurements.js. */
function siteTagForMeasurement(source, index) {
  const t = String(source || "");
  const lineStart = t.lastIndexOf("\n", Math.max(0, index)) + 1;
  const lineEndRaw = t.indexOf("\n", index);
  const lineEnd = lineEndRaw < 0 ? t.length : lineEndRaw;
  const line = t.slice(lineStart, lineEnd).toLowerCase();
  if (/post[-\s]?(?:oxygenator|membrane)|ecmo\s+post/.test(line)) return "ecmo_post_oxygenator";
  if (/pre[-\s]?(?:oxygenator|membrane)|ecmo\s+pre/.test(line)) return "ecmo_pre_oxygenator";
  if (/right\s+radial/.test(line)) return "right_radial";
  if (/left\s+radial/.test(line)) return "left_radial";
  if (/left\s+(?:femoral|pedal|toe)|femoral\s*\/\s*pedal/.test(line)) return "left_femoral_pedal";
  if (/right\s+(?:femoral|pedal|toe)/.test(line)) return "right_femoral_pedal";
  if (/pulmonary\s+artery\s+catheter|\bPAC\b/.test(line)) return "pulmonary_artery_catheter";
  return "";
}

function markdownCells(line) {
  // The visual transcription prompt specifies pipe-separated cells, but models
  // often omit Markdown's decorative leading/trailing pipes. Accept both forms.
  const trimmed = String(line || "").trim();
  if (!trimmed.includes("|")) return null;
  const cells = trimmed.split("|").map((cell) => cell.trim());
  if (cells[0] === "") cells.shift();
  if (cells.at(-1) === "") cells.pop();
  return cells.length >= 2 ? cells : null;
}

function tableColumnIdentity(header, index, dataColumnCount) {
  const h = String(header || "").toLowerCase();
  if (/\b(?:historical|baseline|prior|previous|pre[- ]?admission|before|2\s*months?\s*ago)\b/.test(h)) return "baseline";
  if (/\b(?:current|latest|present|today|admission|repeat|second|now)\b/.test(h)) return "current";
  return dataColumnCount === 1 ? "current" : `column${index}`;
}

function numericCell(cell) {
  const m = new RegExp(`^\\s*(${NUM})\\s*(.*?)\\s*$`).exec(String(cell || ""));
  if (!m || !m[2]) return null;
  return { value: m[1], unit: m[2].replace(/\s+/g, " ").trim() };
}

function extractMarkdownTablePairs(source) {
  const lines = String(source || "").split(/\r?\n/);
  const excluded = new Set();
  const pairs = [];
  for (let i = 0; i < lines.length; i++) {
    const headers = markdownCells(lines[i]);
    if (!headers || headers.length < 2) continue;
    const first = headers[0].toLowerCase();
    const hasTemporalColumns = headers.slice(1).some((h) => /historical|baseline|prior|previous|current|latest|present|admission|repeat|2\s*months?\s*ago/i.test(h));
    const looksLikeHeader = /^(?:parameter|test|analyte|measurement|laboratory\s+test|lab\s+test|item)$/i.test(first);
    if (!hasTemporalColumns || !looksLikeHeader) continue;

    excluded.add(i);
    let row = i + 1;
    const separator = markdownCells(lines[row] || "");
    if (separator && separator.length === headers.length && separator.every((c) => /^:?-{2,}:?$/.test(c))) {
      excluded.add(row);
      row++;
    }
    const dataColumnCount = headers.length - 1;
    for (; row < lines.length; row++) {
      const cells = markdownCells(lines[row]);
      if (!cells) break;
      excluded.add(row);
      if (cells.length < headers.length) continue;
      const baseKey = canonicalKey(cells[0]);
      if (!knownKey(baseKey)) continue;
      for (let col = 1; col < headers.length; col++) {
        const parsed = numericCell(cells[col]);
        if (!parsed) continue;
        const identity = tableColumnIdentity(headers[col], col, dataColumnCount);
        const suffix = identity === "current" ? "" : `_${identity}`;
        pairs.push(`${baseKey}${suffix}=${parsed.value} ${parsed.unit}`);
      }
    }
    i = row - 1;
  }
  return { pairs, excluded };
}

export function mergeOriginalSourceText(...sources) {
  return sources.map((x) => String(x || "").trim()).filter(Boolean).join("\n\n");
}

export function mergeExtractedClinicalData(...readings) {
  // Keep the individual extractor outputs as a concatenated audit trail. Do not
  // collapse duplicate labels here: disagreements must remain detectable below.
  return readings.map((x) => String(x || "").trim()).filter(Boolean).join("; ");
}

export function replaceAuditItemsByMessage(existing = [], incoming = [], getMessage = (item) => item?.msg ?? item?.message ?? item?.en ?? "") {
  // A preliminary solve audit and the final source-backed audit can report the
  // same finding. Keep the final finding once, and deduplicate the incoming batch
  // itself as well. The latter matters when several English conflicts share one
  // localized Arabic summary.
  const keyOf = (item) => String(getMessage(item) || "").trim();
  const incomingMessages = new Set(incoming.map(keyOf).filter(Boolean));
  const seen = new Set();
  const uniqueIncoming = incoming.filter((item) => {
    const key = keyOf(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return [...existing.filter((item) => !incomingMessages.has(keyOf(item))), ...uniqueIncoming];
}

export function extractLabelledClinicalData(text = "") {
  const source = String(text || "");
  const table = extractMarkdownTablePairs(source);
  const scanSource = source.split(/\r?\n/).map((line, i) => table.excluded.has(i) ? "" : line).join("\n");
  const pairs = [...table.pairs];
  // Preserve already-structured key=value readings from a source-reading pass.
  // The original source reader may emit canonical/underscore labels (e.g.
  // systolic_bp=82, diastolic_bp=48) rather than prose labels. Previously these
  // were accepted by parseClinicalData in solver DATA but discarded when the
  // same text passed through this label extractor for authority/source checks.
  // Permit unicode subscript digits in keys (e.g. PaCO₂=30) and canonicalize
  // them to ASCII clinical identities before handing them to the audit.
  const structured = parseClinicalDataDiagnostics(source);
  for (const [key, reading] of Object.entries(structured.facts)) {
    if (knownKey(key)) {
      pairs.push(`${key}=${reading.value} ${reading.unit}`.trim());
    }
  }
  // v3.67: every analyte (including a combined «BP 82/48» cell, hemolyzed/repeat samples and baseline/current pairs) goes through ONE
  // measurement extractor with per-measurement time/sample scope. Site tags (ECMO circuit, radial/femoral) still come from the line.
  const { measurements } = extractMeasurements(scanSource);
  for (const m of measurements) {
    const site = siteTagForMeasurement(scanSource, m.index);
    const key = [m.key, site, m.role === "baseline" ? "baseline" : "", m.sample].filter(Boolean).join("_");
    pairs.push(`${key}=${m.value} ${m.unit}`.trim());
  }
  if (/(?:\bSC\b|sieving\s+coefficient)\s*(?:=|equals?|is equal to)\s*(?:\bfu\b|unbound\s+fraction)|(?:\bfu\b|unbound\s+fraction)\s*(?:=|equals?|is equal to)\s*(?:\bSC\b|sieving\s+coefficient)/i.test(source)) pairs.push("scequalsfu=1 relationship");
  return pairs.join("; ");
}

function fact(facts, key) { return facts && facts[key] ? facts[key] : null; }
function value(facts, key) { const f = fact(facts, key); return f ? f.value : null; }
function unit(facts, key) { const f = fact(facts, key); return f ? f.unit.toLowerCase().replace(/\s/g, "") : ""; }
function missing(facts, keys) { return keys.filter((k) => !fact(facts, k)); }
function unitIs(facts, key, patterns) { const u = unit(facts, key); return patterns.some((p) => p.test(u)); }
function validFraction(facts, key) { const v = value(facts, key); return v != null && v > 0 && v <= 1; }

/* v3.67: the first-number-after-label parser (`labelledNumber`/`compareLabeled`) was REMOVED. See calc-claims.js: results are now read from the arithmetic chain. */

function claimsTripleAcidBase(text = "") {
  const t = String(text || "");
  return /(?:triple|three[- ]component|ثلاثي).{0,70}(?:acid[- ]base|metabolic\s+acidosis|اضطراب.{0,24}(?:حمض|أحماض|الأحماض)|الحموضة|القلوية)/i.test(t)
    || /اضطراب.{0,24}ثلاثي.{0,90}(?:حمض|حموض|أحماض|الأحماض|استقلابي|تنفسي|قلوي)/i.test(t)
    || /ثلاثي.{0,36}(?:اضطراب|حموضة|حمض|أحماض|الأحماض|قلاء)/i.test(t);
}

function clinicalDomains(text = "") {
  const t = String(text || "").toLowerCase();
  return {
    hemodynamics: /\bsvr\b|systemic vascular resistance|fick principle|fick equation/.test(t),
    osmolality: /osmolal gap|osmolar gap|\bog\b|calculated osmolality|calculated osmolarity/.test(t),
    acidBase: /acid[- ]base|anion gap|\bag\b|winter.?s formula|metabolic acidosis|الحموضة|القلوية|الفجوة الأنيونية|الأحماض|الحمض|حمض.{0,10}قاعدة/.test(t),
    crRT: /\bcvvh\b|\bcvvhd\b|\bcvvhdf\b|continuous renal replacement|effluent flow/.test(t),
    proteinPK: /hypoalbumin|low albumin(?:emia)?|albumin.{0,35}(?:binding|bound)|(?:binding|bound).{0,35}albumin|unbound fraction|free fraction|protein.?bound|\bfu\b|intrinsic clearance/.test(t),
    pringle: /pringle|hepatoduodenal ligament/.test(t),
    lactate: /d[- ]lactate|lactate oxidase|propylene glycol|point.of.care lactate/.test(t),
  };
}

function addResult(results, id, label, valueOut, unitOut, formula, note = "") {
  if (Number.isFinite(valueOut)) results.push({ id, label, value: round(valueOut, 2), unit: unitOut, formula, note });
}

function computeFromFacts(facts, contextText = "") {
  const domains = clinicalDomains(contextText);
  const results = [], missingInputs = [], notes = [];

  const suppliedMap = value(facts, "map");
  const systolic = value(facts, "sbp"), diastolic = value(facts, "dbp");
  if (suppliedMap == null && systolic != null && diastolic != null
      && unitIs(facts, "sbp", [/^mmhg$/]) && unitIs(facts, "dbp", [/^mmhg$/])) {
    addResult(results, "map", "Estimated mean arterial pressure", (systolic + 2 * diastolic) / 3, "mmHg", "(SBP + 2×DBP) ÷ 3", "Approximation; use a directly measured MAP when available.");
    notes.push("MAP was estimated from SBP/DBP using (SBP + 2×DBP)/3; use directly measured MAP when supplied.");
  }

  // Change from baseline: arithmetic only (no staging, no diagnosis). Current and baseline are distinct identities (hb vs hbbaseline).
  if (value(facts, "hb") != null && value(facts, "hbbaseline") != null && unitIs(facts, "hb", [/^g\/dl$/]) && unitIs(facts, "hbbaseline", [/^g\/dl$/])) {
    addResult(results, "hb-decline", "Hemoglobin change from baseline (decline)", value(facts, "hbbaseline") - value(facts, "hb"), "g/dL", "baseline Hb − current Hb", "Arithmetic only; interpret with bleeding source, volume status and sampling time.");
  }
  if (value(facts, "creatinine") != null && value(facts, "creatininebaseline") != null && value(facts, "creatininebaseline") > 0
      && unitIs(facts, "creatinine", [/^mg\/dl$/]) && unitIs(facts, "creatininebaseline", [/^mg\/dl$/])) {
    addResult(results, "creatinine-delta", "Creatinine rise from baseline", value(facts, "creatinine") - value(facts, "creatininebaseline"), "mg/dL", "current creatinine − baseline creatinine", "Arithmetic only; staging of kidney injury requires the applicable criteria and timing.");
    addResult(results, "creatinine-ratio", "Creatinine ratio (current ÷ baseline)", value(facts, "creatinine") / value(facts, "creatininebaseline"), "× baseline", "current creatinine ÷ baseline creatinine");
  }

  if (domains.hemodynamics) {
    let map = suppliedMap;
    if (map == null && value(facts, "sbp") != null && value(facts, "dbp") != null) {
      map = (value(facts, "sbp") + 2 * value(facts, "dbp")) / 3;
    }
    let co = value(facts, "co");
    let cao2 = value(facts, "cao2"), cvo2 = value(facts, "cvo2");
    // Calculate oxygen contents from the supplied Hb, saturations and partial pressures when the contents are not directly stated.
    if (cao2 == null && value(facts, "hb") != null && value(facts, "sao2") != null && value(facts, "pao2") != null) {
      if (unitIs(facts, "hb", [/^g\/dl$/]) && unitIs(facts, "sao2", [/^%$/]) && unitIs(facts, "pao2", [/^mmhg$/]) && value(facts, "sao2") >= 0 && value(facts, "sao2") <= 100) {
        cao2 = 1.34 * value(facts, "hb") * (value(facts, "sao2") / 100) + 0.003 * value(facts, "pao2");
        addResult(results, "cao2", "Calculated arterial oxygen content", cao2, "mL/dL", "1.34×Hb×SaO₂(fraction) + 0.003×PaO₂");
      } else missingInputs.push("Arterial O₂ content requires Hb in g/dL, SaO₂ in %, and PaO₂ in mmHg.");
    }
    if (cvo2 == null && value(facts, "hb") != null && value(facts, "svo2") != null && value(facts, "pvo2") != null) {
      if (unitIs(facts, "hb", [/^g\/dl$/]) && unitIs(facts, "svo2", [/^%$/]) && unitIs(facts, "pvo2", [/^mmhg$/]) && value(facts, "svo2") >= 0 && value(facts, "svo2") <= 100) {
        cvo2 = 1.34 * value(facts, "hb") * (value(facts, "svo2") / 100) + 0.003 * value(facts, "pvo2");
        addResult(results, "cvo2", "Calculated venous oxygen content", cvo2, "mL/dL", "1.34×Hb×SvO₂(fraction) + 0.003×PvO₂");
      } else missingInputs.push("Venous O₂ content requires Hb in g/dL, SvO₂ in %, and PvO₂ in mmHg.");
    }
    if (co == null && value(facts, "vo2") != null && cao2 != null && cvo2 != null) {
      const delta = cao2 - cvo2;
      if (delta > 0 && unitIs(facts, "vo2", [/^ml\/min$/]) && ((value(facts, "cao2") == null) || unitIs(facts, "cao2", [/^ml\/dl$/])) && ((value(facts, "cvo2") == null) || unitIs(facts, "cvo2", [/^ml\/dl$/]))) {
        co = value(facts, "vo2") / (10 * delta);
        addResult(results, "co", "Fick cardiac output", co, "L/min", "VO₂ ÷ [10 × (CaO₂ − CvO₂)]");
      } else missingInputs.push("Fick CO requires VO₂ in mL/min and CaO₂/CvO₂ in mL/dL, with CaO₂ > CvO₂.");
    } else if (co == null && value(facts, "vo2") != null) {
      missingInputs.push("Fick CO requires measured CaO₂/CvO₂ or enough Hb, arterial/venous saturation and PO₂ values to calculate both oxygen contents.");
    }
    if (map != null && value(facts, "cvp") != null && co != null) {
      const coUnitOk = fact(facts, "co") ? unitIs(facts, "co", [/^l\/min$/]) : true;
      const bpUnitsOk = (fact(facts, "map") ? unitIs(facts, "map", [/^mmhg$/]) : unitIs(facts, "sbp", [/^mmhg$/]) && unitIs(facts, "dbp", [/^mmhg$/]));
      if (map > value(facts, "cvp") && co > 0 && unitIs(facts, "cvp", [/^mmhg$/]) && bpUnitsOk && coUnitOk) {
        addResult(results, "svr", "Systemic vascular resistance", ((map - value(facts, "cvp")) / co) * 80, "dyn·s/cm⁵", "[(MAP − CVP) ÷ CO] × 80");
      } else missingInputs.push("SVR needs MAP and CVP in mmHg and CO in L/min; values/units supplied are not valid for this formula.");
    } else missingInputs.push(`SVR not calculated: missing ${missing(facts, ["map", "cvp", "co"]).join(", ") || "a valid MAP/CO input"}.`);
  }

  if (domains.osmolality) {
    const nitrogenKey = fact(facts, "bun") ? "bun" : fact(facts, "urea") ? "urea" : "bun";
    const required = ["na", "glucose", "measuredosm"];
    const absent = [...missing(facts, required), ...(fact(facts, nitrogenKey) ? [] : ["bun/urea"])];
    if (absent.length) missingInputs.push(`Osmolal gap not calculated: missing ${absent.join(", ")}.`);
    else {
      const na = value(facts, "na"), glucose = value(facts, "glucose"), nitrogen = value(facts, nitrogenKey);
      const naOk = unitIs(facts, "na", [/^mmol\/l$/, /^meq\/l$/]);
      const gluMg = unitIs(facts, "glucose", [/^mg\/dl$/]);
      const gluSi = unitIs(facts, "glucose", [/^mmol\/l$/]);
      const bunMg = nitrogenKey === "bun" && unitIs(facts, nitrogenKey, [/^mg\/dl$/]);
      const bunSi = unitIs(facts, nitrogenKey, [/^mmol\/l$/]);
      const ureaMg = nitrogenKey === "urea" && unitIs(facts, nitrogenKey, [/^mg\/dl$/]);
      const ureaSi = nitrogenKey === "urea" && unitIs(facts, nitrogenKey, [/^mmol\/l$/]);
      const osmOk = unitIs(facts, "measuredosm", [/^mosm\/kg$/, /^mosmol\/kg$/]);
      const nitrogenOk = bunMg || bunSi || ureaSi || ureaMg;
      if (!naOk || !(gluMg || gluSi) || !nitrogenOk || !osmOk) {
        missingInputs.push("Osmolal gap not calculated: use Na in mmol/L (or mEq/L), glucose in mg/dL or mmol/L, BUN in mg/dL or mmol/L (or urea with its own conversion), and measured osmolality in mOsm/kg.");
      } else {
        // Conventional formula; BUN and urea are not interchangeable when expressed in mg/dL.
        const nitrogenTerm = bunMg ? nitrogen / 2.8 : ureaMg ? nitrogen / 6.0 : nitrogen;
        let calc = 2 * na + (gluMg ? glucose / 18 : glucose) + nitrogenTerm;
        let ethanolIncluded = false;
        const ethanolPresent = fact(facts, "ethanol");
        if (ethanolPresent) {
          const divisor = value(facts, "ethanoldivisor");
          if (!unitIs(facts, "ethanol", [/^mg\/dl$/]) || !(divisor > 0)) {
            missingInputs.push("Osmolal gap not reported: ethanol is present, but its unit or the exact locally validated ethanol coefficient/divisor is missing. Do not assume a universal coefficient.");
          } else {
            calc += value(facts, "ethanol") / divisor;
            ethanolIncluded = true;
          }
        }
        if (!ethanolPresent || ethanolIncluded) {
          addResult(results, "calculated-osmolality", "Calculated osmolality", calc, "mOsm/kg", ethanolIncluded ? `2×Na + glucose/18 + nitrogen term + ethanol/${value(facts, "ethanoldivisor")}` : "2×Na + glucose/18 + BUN/2.8 (or urea/6.0 for urea mg/dL)", "Conventional equation; use the laboratory's validated local formula when specified.");
          addResult(results, "og", "Osmolal gap", value(facts, "measuredosm") - calc, "mOsm/kg", "Measured osmolality − calculated osmolality", ethanolIncluded ? "Includes the explicitly supplied ethanol divisor." : "No ethanol value was supplied; if ethanol is present but unavailable, the residual gap is not fully interpreted.");
        }
      }
    }
  }

  if (domains.acidBase) {
    const na = value(facts, "na"), cl = value(facts, "chloride"), hco3 = value(facts, "hco3");
    if (na != null && cl != null && hco3 != null) {
      if (unitIs(facts, "na", [/^mmol\/l$/, /^meq\/l$/]) && unitIs(facts, "chloride", [/^mmol\/l$/, /^meq\/l$/]) && unitIs(facts, "hco3", [/^mmol\/l$/, /^meq\/l$/])) {
        const ag = na - cl - hco3;
        // Include the actual substitution in the handoff so the generation model
        // does not have to reconstruct the arithmetic from memory.
        addResult(results, "ag", "Anion gap", ag, "mmol/L", `Na − (Cl + HCO₃) = ${na} − (${cl} + ${hco3})`);
        const albumin = value(facts, "albumin");
        if (albumin != null && unitIs(facts, "albumin", [/^g\/dl$/])) {
          const correctedAg = ag + 2.5 * (4 - albumin);
          addResult(results, "corrected-ag", "Albumin-corrected anion gap", correctedAg, "mmol/L", `AG + 2.5×(4 − albumin[g/dL]) = ${round(ag)} + 2.5×(4 − ${albumin})`, "Conventional correction; local laboratory reference/validated correction may differ.");
        }
        const agForDelta = albumin != null && unitIs(facts, "albumin", [/^g\/dl$/]) ? ag + 2.5 * (4 - albumin) : ag;
        const normalAg = value(facts, "normalag") ?? 12;
        const normalHco3 = value(facts, "normalhco3") ?? 24;
        const deltaAg = agForDelta - normalAg;
        const deltaHco3 = normalHco3 - hco3;
        if (deltaAg > 0 && deltaHco3 > 0) {
          const deltaGap = deltaAg - deltaHco3;
          addResult(results, "delta-gap", "Delta gap (ΔAG − ΔHCO₃)", deltaGap, "mmol/L", `(AG${albumin != null ? " corrected" : ""} − ${normalAg}) − (${normalHco3} − HCO₃)`, "Uses conventional reference values AG=12 and HCO₃=24 unless supplied otherwise; local reference ranges and baseline values can change interpretation.");
          if (deltaGap > 6) notes.push(`Delta gap ${round(deltaGap)} mmol/L is above +6 and supports a concurrent metabolic alkalosis; interpret with the clinical context and local reference range.`);
          else if (deltaGap < -6) notes.push(`Delta gap ${round(deltaGap)} mmol/L is below −6 and supports a concurrent normal-anion-gap metabolic acidosis.`);
          else notes.push(`Delta gap ${round(deltaGap)} mmol/L is within the conventional −6 to +6 interval; this calculation alone does not support an additional metabolic process.`);
        }
      } else missingInputs.push("Anion gap requires Na, Cl and HCO₃ in mmol/L (or mEq/L).");
    } else missingInputs.push(`Anion gap not calculated: missing ${missing(facts, ["na", "chloride", "hco3"]).join(", ")}.`);

    // v3.67: Winter's EXPECTED PaCO₂ is a function of HCO₃ alone. PaCO₂ is needed only to COMPARE with it. Requiring both made one missing
    // PaCO₂ withhold a number that never depended on it.
    if (value(facts, "hco3") != null && (/winter|metabolic acidosis/.test(String(contextText).toLowerCase()) || claimsTripleAcidBase(contextText))) {
      if (unitIs(facts, "hco3", [/^mmol\/l$/, /^meq\/l$/])) {
        const expected = 1.5 * value(facts, "hco3") + 8;
        addResult(results, "winter", "Winter expected PaCO₂", expected, "mmHg", `1.5×HCO₃ + 8 ± 2 = 1.5×${value(facts, "hco3")} + 8`, "Expected range: result ±2 mmHg. Compare with measured PaCO₂; do not diagnose a mixed disorder without the full acid-base context.");
      }
      if (unitIs(facts, "hco3", [/^mmol\/l$/, /^meq\/l$/]) && value(facts, "paco2") != null && unitIs(facts, "paco2", [/^mmhg$/])) {
        const expected = 1.5 * value(facts, "hco3") + 8;
        const actual = value(facts, "paco2");
        const low = expected - 2, high = expected + 2;
        if (actual < low) notes.push(`Measured PaCO₂ ${actual} mmHg is below Winter's expected range (${round(low)}–${round(high)} mmHg); this supports an additional respiratory alkalosis in the stated metabolic-acidosis context.`);
        else if (actual > high) notes.push(`Measured PaCO₂ ${actual} mmHg is above Winter's expected range (${round(low)}–${round(high)} mmHg); this supports an additional respiratory acidosis in the stated metabolic-acidosis context.`);
        else notes.push(`Measured PaCO₂ ${actual} mmHg is within Winter's expected range (${round(low)}–${round(high)} mmHg).`);
      } else if (value(facts, "paco2") != null) missingInputs.push("Winter's comparison requires PaCO₂ in mmHg.");
      else if (!unitIs(facts, "hco3", [/^mmol\/l$/, /^meq\/l$/])) missingInputs.push("Winter's formula requires HCO₃ in mmol/L.");
    }
  }

  if (domains.crRT && domains.proteinPK) {
    const scEqualsFu = value(facts, "scequalsfu") === 1;
    const scRelationMismatch = scEqualsFu && fact(facts, "sc") && !close(value(facts, "sc"), value(facts, "fu"), 0.0001, 0.0001);
    const needed = ["fu", "clint", "qeff", "cssu", ...(scEqualsFu ? [] : ["sc"])];
    const absent = missing(facts, needed);
    if (scRelationMismatch) {
      missingInputs.push("Drug infusion rate not calculated: the explicitly stated SC=fu relationship conflicts with the separately supplied numeric SC value.");
    } else if (absent.length) {
      missingInputs.push(`Drug infusion rate NOT calculated: missing ${absent.join(", ")}. SC may be set equal to fu only when that relationship is explicitly established for this drug/filter setting.`);
    } else if (!validFraction(facts, "fu") || (!scEqualsFu && (value(facts, "sc") < 0 || value(facts, "sc") > 1)) || value(facts, "clint") <= 0 || value(facts, "qeff") <= 0 || value(facts, "cssu") <= 0 || !unitIs(facts, "clint", [/^l\/h$/]) || !unitIs(facts, "qeff", [/^l\/h$/]) || !unitIs(facts, "cssu", [/^mg\/l$/])) {
      missingInputs.push("Drug infusion rate not calculated: verify fu and SC are fractions 0–1, CLint/Qeff are L/h, and target unbound Css is mg/L.");
    } else if (!/low.?extraction|restrictive|well.?stirred.{0,30}low/i.test(String(contextText))) {
      missingInputs.push("Drug infusion rate not calculated: the low-extraction/restrictive hepatic-clearance assumption is not explicitly established.");
    } else {
      const fu = value(facts, "fu"), sc = scEqualsFu ? fu : value(facts, "sc");
      const clHep = fu * value(facts, "clint"), clCrrt = value(facts, "qeff") * sc;
      const total = clHep + clCrrt;
      const rate = value(facts, "cssu") * total / fu;
      const formula = scEqualsFu
        ? "SC=fu explicitly established: Css,u × (CLint + Qeff,delivered)"
        : "SC independent: Css,u × [(fu×CLint + Qeff,delivered×SC) ÷ fu]";
      addResult(results, "r0", "Modelled IV maintenance infusion rate", rate, "mg/h", formula, "Model only: includes only the stated low-extraction hepatic and delivered-CVVH clearances. Not a prescribing recommendation; other clearance pathways, CRRT downtime, predilution, membrane adsorption and changing physiology may alter exposure.");
      notes.push(`Clearance terms kept separate: hepatic=${round(clHep)} L/h; CVVH=${round(clCrrt)} L/h. ${scEqualsFu ? "SC=fu was explicitly supplied and used." : "SC was used independently as supplied; it was not assumed equal to fu."}`);
    }
  }

  return { domains, results, missingInputs: [...new Set(missingInputs)], notes, conflicts: [], inputCount: Object.keys(facts || {}).length };
}

function narrativeRuleFindings(text = "", dataText = "") {
  const t = String(text || "");
  const low = t.toLowerCase();
  const findings = [];

  // Reject the classic missing-2 sodium equation. Do not reject a clearly stated site-specific validated formula.
  for (const line of t.split(/\n/)) {
    if (/calculated\s+(?:serum\s+)?(?:osmolality|osmolarity)|(?:حساب|معادلة).{0,30}(?:الأسمول|الاوزمول)/i.test(line) && /\b(?:Na|sodium|الصوديوم)\b/i.test(line) && /(?:\+|plus)/i.test(line)) {
      const hasDoubleNa = /(?:2\s*[×x*]?\s*(?:Na|sodium|الصوديوم)|(?:Na|sodium|الصوديوم)\s*[×x*]?\s*2|٢\s*(?:×|ضرب)\s*(?:Na|sodium|الصوديوم))/i.test(line);
      const explicitlyLocal = /local|institutional|laboratory.?validated|site.?specific|معتمد محلي/i.test(line);
      if (!hasDoubleNa && !explicitlyLocal) findings.push({ code: "osmolality-missing-sodium-counterion", severity: "high", message: "The displayed calculated-osmolality equation appears to omit the coefficient 2 before sodium. Recalculate before using the osmolal gap." });
    }
  }

  if (/\bMAP\s*(?:=|:)\s*\(?\s*SBP\s*\+\s*DBP\s*\)?\s*\/\s*3/i.test(t)) {
    findings.push({ code: "map-formula-missing-diastolic-weight", severity: "high", message: "The stated MAP approximation appears to use (SBP+DBP)/3. Use (SBP+2×DBP)/3, or use directly measured MAP." });
  }
  if (claimsTripleAcidBase(t)) {
    const fields = parseClinicalData(`${dataText}\n${text}`);
    const required = ["na", "chloride", "hco3", "ph", "paco2"];
    const absent = missing(fields, required);
    if (absent.length) findings.push({ code: "triple-acid-base-without-inputs", severity: "high", message: `A triple acid-base diagnosis is asserted without a complete structured dataset; missing ${absent.join(", ")}. OG alone cannot establish a mixed acid-base disorder.` });
  }
  const mentionsPocLactate = /(?:point[- ]of[- ]care|\bPOC\b|bedside).{0,100}lactate|lactate.{0,100}(?:point[- ]of[- ]care|\bPOC\b|bedside)/i.test(t);
  const claimsLOnly = /(?:detects?|measures?|reads?|recognizes?|sees?)\s+(?:only\s+)?l[- ]lactate|only\s+l[- ]lactate|miss(?:es)?\s+d[- ]lactate|does not (?:detect|measure|quantify)\s+d[- ]lactate|بس\s+l[- ]lactate|فقط\s+l[- ]lactate/i.test(t);
  if (mentionsPocLactate && /d[- ]lactate|d لاكتات/i.test(t) && claimsLOnly) {
    findings.push({ code: "lactate-assay-overgeneralization", severity: "high", message: "Do not generalize D-lactate detection across point-of-care devices. State the specific analyser/method and qualify the conclusion as assay-dependent." });
  }

  if ((/pringle|hepatoduodenal ligament/i.test(t)) && /(persistent|continued|ongoing) bleeding|استمرار النزيف|النزيف مستمر/i.test(t) && /(proves?|confirms?|definitive|certainly|only possible source|يثبت|يثبت تماما|دليل قاطع|مصدر مؤكد)/i.test(t)) {
    findings.push({ code: "pringle-overclaim", severity: "high", message: "Persistent bleeding after a Pringle maneuver raises suspicion for hepatic-vein/retrohepatic-IVC injury, but does not prove it; consider aberrant hepatic arterial inflow and other sources." });
  }

  if ((/\bfu\b|unbound fraction|free fraction/i.test(t)) && /hypoalbumin|low albumin|نقص الألبومين/i.test(t) && /(always|automatically|must be halved|double the dose|halve the infusion|always doubles|دائما|تلقائيا|للنصف|يتضاعف)/i.test(t)) {
    findings.push({ code: "protein-binding-dose-overgeneralization", severity: "high", message: "Hypoalbuminemia alone does not justify a universal dose increase/reduction. Drug-specific clearance, unbound target, actual CRRT delivery, membrane/SC and other clearance pathways are required." });
  }

  // fu cancels from the modelled R0 only when the extracorporeal sieving coefficient is explicitly equal to fu.
  if (/fu\s*(?:cancels?|is cancelled|cancellation)|يلغى.{0,15}(?:fu|الجزء الحر)/i.test(t) && /cvvh|cvvhdf|cvvhd|effluent|الغسيل المستمر/i.test(t)) {
    const scEqualsFu = /(?:\bSC\b|sieving coefficient)\s*(?:=|equals?|is equal to)\s*(?:\bfu\b|unbound fraction)|(?:\bfu\b|unbound fraction)\s*(?:=|equals?|is equal to)\s*(?:\bSC\b|sieving coefficient)/i.test(t);
    if (!scEqualsFu) findings.push({ code: "fu-cancellation-assumption", severity: "high", message: "The answer says fu cancels in a model that includes CVVH clearance, but does not establish SC=fu. Keep the supplied sieving coefficient separate; the CVVH term does not generally cancel fu." });
    else if (/(?:normal albumin|albumin was normal|albumin returns to normal|عودة الألبومين للطبيعي|الألبومين طبيعي)/i.test(t)) {
      const rates = [...t.matchAll(/\bR\s*[₀0]\s*(?:(?:=|is|of)\s*|(?:would\s+)?(?:become|be|increase\s+to|decrease\s+to)\s*)(\d+(?:[.,]\d+)?)\s*(?:mg\s*\/\s*h|mg\/hr)?/gi)].map((m) => num(m[1]));
      if (rates.length >= 2 && rates.some((v, i) => rates.slice(i + 1).some((w) => !close(v, w, 0.01, 0.01)))) {
        findings.push({ code: "fu-cancellation-counterfactual-conflict", severity: "high", message: "The answer explicitly states SC=fu so fu cancels for a fixed unbound target, yet changes R0 solely because albumin normalises. Under those unchanged assumptions, the modelled R0 should remain the same." });
      }
    }
  }

  return findings;
}

function authorityInputRequirements(facts, computed, generatedText = "", contextText = "") {
  // Each result owns only the inputs used by its formula. A missing CVP/Fick
  // measurement must never suppress independently confirmed acid-base math.
  const requirements = [];
  const claimIds = new Set(extractClaims(generatedText).map((c) => c.id));
  const mapClaim = claimIds.has("map");
  const svrClaim = claimIds.has("svr");
  const fickCoClaim = claimIds.has("co") && /fick/i.test(generatedText);
  const agClaim = claimIds.has("ag");
  const correctedAgClaim = claimIds.has("corrected-ag");
  const winterClaim = claimIds.has("winter");
  const ogClaim = claimIds.has("og");
  const r0Claim = claimIds.has("r0");
  const resultIds = new Set(computed.results.map((r) => r.id));
  const add = (id, fields, resultIdsForGate = [id]) => requirements.push({ id, fields: [...new Set(fields)], resultIds: resultIdsForGate });
  const mapFields = [fact(facts, "map") ? "map" : "map-or-sbp+dbp"];

  if (resultIds.has("map") || mapClaim) add("map", mapFields);

  if (resultIds.has("co") || fickCoClaim) {
    const fields = ["vo2"];
    if (fact(facts, "cao2")) fields.push("cao2");
    else fields.push("hb", "sao2", "pao2");
    if (fact(facts, "cvo2")) fields.push("cvo2");
    else fields.push("hb", "svo2", "pvo2");
    add("co", fields, ["co", ...(svrClaim || resultIds.has("svr") ? ["svr"] : [])]);
  }

  if (resultIds.has("svr") || svrClaim) {
    const fields = [...mapFields, "cvp"];
    if (fact(facts, "co")) fields.push("co");
    else if (fact(facts, "vo2") || fickCoClaim || /\bfick\b/i.test(contextText)) {
      fields.push("vo2");
      if (fact(facts, "cao2")) fields.push("cao2");
      else fields.push("hb", "sao2", "pao2");
      if (fact(facts, "cvo2")) fields.push("cvo2");
      else fields.push("hb", "svo2", "pvo2");
    } else fields.push("co");
    add("svr", fields, ["svr"]);
  }

  if (resultIds.has("calculated-osmolality")) {
    const fields = ["na", "glucose", fact(facts, "bun") ? "bun" : fact(facts, "urea") ? "urea" : "bun-or-urea"];
    if (fact(facts, "ethanol")) fields.push("ethanol", "ethanoldivisor");
    add("calculated-osmolality", fields);
  }
  if (resultIds.has("og") || ogClaim) {
    const fields = ["na", "glucose", "measuredosm", fact(facts, "bun") ? "bun" : fact(facts, "urea") ? "urea" : "bun-or-urea"];
    if (fact(facts, "ethanol")) fields.push("ethanol", "ethanoldivisor");
    add("og", fields);
  }

  if (resultIds.has("ag") || agClaim || /anion\s+gap|\bAG\b|الفجوة الأنيونية/i.test(contextText)) {
    add("ag", ["na", "chloride", "hco3"]);
  }
  if (resultIds.has("corrected-ag") || correctedAgClaim) {
    add("corrected-ag", ["na", "chloride", "hco3", "albumin"]);
  }
  if (resultIds.has("delta-gap")) {
    add("delta-gap", ["na", "chloride", "hco3", ...(fact(facts, "albumin") ? ["albumin"] : [])]);
  }
  if (resultIds.has("winter") || winterClaim || /winter|respiratory compensation|تعويض تنفسي/i.test(contextText)) {
    add("winter", ["hco3"]);
  }
  // Change-from-baseline results are verification targets: they demand corroboration only when the answer actually states them.
  if (claimIds.has("hb-decline")) add("hb-decline", ["hb", "hbbaseline"]);
  if (claimIds.has("creatinine-delta") || claimIds.has("creatinine-ratio")) add("creatinine-delta", ["creatinine", "creatininebaseline"], ["creatinine-delta", "creatinine-ratio"]);
  if (claimsTripleAcidBase(generatedText)) add("triple-acid-base", ["na", "chloride", "hco3", "ph", "paco2"]);

  if (resultIds.has("r0") || r0Claim) {
    const fields = ["fu", "clint", "qeff", "cssu", fact(facts, "sc") ? "sc" : fact(facts, "scequalsfu") ? "scequalsfu" : "sc-or-scequalsfu"];
    add("r0", fields);
  }
  return requirements;
}
/* v3.67 · «is this value printed next to its own label in the ORIGINAL source text?»
   Corroboration used to require that our regex extractor re-derived the field from the source. When the extractor merely failed to parse a
   phrasing, a value the source plainly contains was reported as "missing from the source" (false missing-input warnings). A value is now also
   accepted as source-grounded when the same number appears within a short window after any alias of its analyte in the original text.
   This is a provenance check (the number exists in the source next to that label), not a transcription guarantee. Time/sample-scoped keys
   (baseline, hemolyzed) are NOT grounded this way: their identity must come from the extractor. */
const GROUND_ALIASES = { sbp: ["bp", "blood pressure", "systolic"], dbp: ["bp", "blood pressure", "diastolic"] };
export function groundedInSource(sourceText, key, val) {
  const text = String(sourceText || "");
  if (!text || !Number.isFinite(val) || /(?:baseline|hemolyzed)$/.test(key)) return false;
  const aliases = [...(KEY_ALIASES[key] || []), ...(GROUND_ALIASES[key] || [])].filter((a) => a.length > 1 || key === "potassium");
  if (!aliases.length) return false;
  const lower = text.toLowerCase().replace(/[₀-₉]/g, (d) => String("₀₁₂₃₄₅₆₇₈₉".indexOf(d)));
  for (const alias of aliases) {
    const a = alias.toLowerCase().replace(/[₀-₉]/g, (d) => String("₀₁₂₃₄₅₆₇₈₉".indexOf(d)));
    let from = 0;
    for (;;) {
      const i = lower.indexOf(a, from);
      if (i < 0) break;
      from = i + a.length;
      const before = lower[i - 1], after = lower[i + a.length];
      if ((before && /[a-z0-9]/.test(before)) || (after && /[a-z]/.test(after))) continue;
      const window = lower.slice(from, from + 70).split(/\n|[;؛]|(?<![0-9])\.\s/)[0];
      for (const n of window.matchAll(/(?<![0-9.,])[0-9]+(?:[.,][0-9]+)?(?![0-9])/g)) {
        if (Math.abs(Number(n[0].replace(",", ".")) - val) < 1e-9) return true;
      }
    }
  }
  return false;
}

function missingAuthorityFields(required, authorityFacts, grounded = () => false) {
  const labels = {
    "map-or-sbp+dbp": "MAP or SBP+DBP", "bun-or-urea": "BUN or urea",
    "sc-or-scequalsfu": "SC or an explicitly stated SC=fu relationship",
  };
  return required.filter((key) => {
    if (key === "map-or-sbp+dbp") return !((authorityFacts.map || grounded("map")) || ((authorityFacts.sbp || grounded("sbp")) && (authorityFacts.dbp || grounded("dbp"))));
    if (key === "bun-or-urea") return !(authorityFacts.bun || authorityFacts.urea || grounded("bun") || grounded("urea"));
    if (key === "sc-or-scequalsfu") return !(authorityFacts.sc || authorityFacts.scequalsfu);
    return !(authorityFacts[key] || grounded(key));
  }).map((key) => labels[key] || key);
}

export function stripOptionReviewSection(text = "") {
  const t = String(text || "");
  const m = /^##\s*(?:🔍\s*)?(?:كل اختيار لوحده|Every option|Every answer option)\s*$/im.exec(t);
  if (!m) return t;
  const start = m.index + m[0].length;
  const next = /\n##\s/.exec(t.slice(start));
  return `${t.slice(0, m.index)}${next ? t.slice(start + next.index) : ""}`.trim();
}

export function extractCorrectAnswerSection(text = "") {
  const t = String(text || "");
  const m = /^##\s*(?:✅\s*)?(?:الإجابة الصح|The correct answer)\s*$/im.exec(t);
  if (!m) return "";
  const start = m.index + m[0].length;
  const next = /\n##\s/.exec(t.slice(start));
  return (next ? t.slice(start, start + next.index) : t.slice(start)).trim();
}

export function auditClinicalCalculations({ dataText = "", secondaryDataText = "", authorityDataText = "", modelDataText = "", sourceText = "", requireAuthorityInputs = false, narrative = "", answerText = "", calcText = "", contextText = "", optionText = "" } = {}) {
  const generatedText = [narrative, answerText, calcText, optionText].filter(Boolean).join("\n");
  const combined = [contextText, generatedText].filter(Boolean).join("\n");
  const sourceTexts = [dataText, ...(Array.isArray(secondaryDataText) ? secondaryDataText : [secondaryDataText]), authorityDataText].filter((x) => String(x || "").trim());
  const sourceReports = sourceTexts.map(parseClinicalDataDiagnostics);
  const sourceFacts = sourceReports.map((x) => x.facts).filter((x) => Object.keys(x).length);
  const authorityFacts = parseClinicalData(authorityDataText);
  const modelFacts = parseClinicalData(modelDataText || (requireAuthorityInputs ? "" : dataText));
  const facts = {};
  const inputConflicts = [];
  // Compare every extractor pair, not only each secondary source against the first one.
  // This catches conflicts even when the primary extraction omitted that particular field.
  const readings = new Map();
  for (const report of sourceReports) {
    for (const d of report.duplicates) {
      inputConflicts.push({ code: `within-source-${d.key}-ambiguous`, severity: "high", message: `The same source contains multiple non-equivalent readings for ${d.key}: ${d.first.raw} versus ${d.repeated.raw}. This may be a current/baseline/reference value mix-up; re-read and time-label the source before calculating.` });
    }
  }
  for (const factsFromSource of sourceFacts) {
    for (const [key, reading] of Object.entries(factsFromSource)) {
      if (!readings.has(key)) readings.set(key, []);
      readings.get(key).push(reading);
      if (!facts[key]) facts[key] = reading;
    }
  }
  for (const [key, values] of readings) {
    for (let i = 0; i < values.length; i++) for (let j = i + 1; j < values.length; j++) {
      const a = values[i], b = values[j];
      if (!close(a.value, b.value, 0.0001, 0.0001) || (a.unit && b.unit && a.unit.toLowerCase() !== b.unit.toLowerCase())) {
        inputConflicts.push({ code: `extraction-${key}-mismatch`, severity: "high", message: `Independent source readings disagree about ${key}: ${a.raw} versus ${b.raw}. Do not calculate from either value until the original source is re-read.` });
      }
    }
  }
  // Model-extracted method constants/relations must be confirmed by the separate source-reading pass;
  // otherwise the model could smuggle a made-up SC=fu relation or ethanol divisor into DATA.
  if (facts.scequalsfu && !authorityFacts.scequalsfu) inputConflicts.push({ code: "sc-fu-relation-unverified", severity: "high", message: "The SC=fu relationship appears in model-extracted data but is not present in the separate source-reading pass. Do not cancel fu or calculate the infusion rate until the source is re-read." });
  if (facts.ethanoldivisor && !authorityFacts.ethanoldivisor) inputConflicts.push({ code: "ethanol-divisor-unverified", severity: "high", message: "The ethanol divisor appears in model-extracted data but is not present in the separate source-reading pass. Do not use it as a validated coefficient." });
  const combinedDomains = clinicalDomains(combined);
  const mergedDataText = Object.values(facts).map((f) => `${f.key}=${f.value} ${f.unit}`.trim()).join("; ");
  // A conflict in one formula's inputs must not erase unrelated verified math.
  // Remove only fields with source-extraction disagreements before recomputation.
  const conflictedKeys = new Set();
  for (const item of inputConflicts) {
    const m = /^(?:within-source|extraction)-([a-z0-9_]+)-(?:ambiguous|mismatch)$/.exec(item.code || "");
    if (m) conflictedKeys.add(m[1]);
  }
  const calculationFacts = Object.fromEntries(Object.entries(facts).filter(([key]) => !conflictedKeys.has(key)));
  if (inputConflicts.some((item) => item.code === "sc-fu-relation-unverified")) delete calculationFacts.scequalsfu;
  if (inputConflicts.some((item) => item.code === "ethanol-divisor-unverified")) delete calculationFacts.ethanoldivisor;
  const rawComputed = computeFromFacts(calculationFacts, combined);
  const requirements = requireAuthorityInputs
    ? authorityInputRequirements(calculationFacts, rawComputed, generatedText, contextText)
    : [];
  // a field counts as source-confirmed when the extractor re-derived it OR the SAME value is printed next to its label in the original source
  const grounded = (key) => !!facts[key] && groundedInSource(sourceText, key, facts[key].value);
  const missingByRequirement = requirements.map((requirement) => ({
    requirement,
    authority: missingAuthorityFields(requirement.fields, authorityFacts, grounded),
    model: missingAuthorityFields(requirement.fields, modelFacts),
  }));
  const failedRequirements = missingByRequirement.filter((x) => x.authority.length || x.model.length);
  const missingAuthority = [...new Set(failedRequirements.flatMap((x) => x.authority))];
  const missingModel = [...new Set(failedRequirements.flatMap((x) => x.model))];
  const unverifiedResultIds = new Set(failedRequirements.flatMap((x) => x.requirement.resultIds));
  // Tiering (v3.67): an unconfirmed input of the anion-gap family (Na/Cl/HCO₃/albumin) can change the whole acid-base interpretation → blocking.
  // An unconfirmed input of any other formula (MAP, Winter, Fick/SVR, osmolal gap, R0, Δ-baseline) withholds THAT formula only.
  const CORE_FAMILY = new Set(["ag", "corrected-ag", "delta-gap", "triple-acid-base"]);
  const describe = (list) => list.map((x) => `${x.requirement.id}: source ${x.authority.length ? x.authority.join(", ") : "complete"}; solver ${x.model.length ? x.model.join(", ") : "complete"}`).join(" | ");
  const blockingFailed = failedRequirements.filter((x) => CORE_FAMILY.has(x.requirement.id));
  const withheldFailed = failedRequirements.filter((x) => !CORE_FAMILY.has(x.requirement.id));
  if (blockingFailed.length) inputConflicts.push({ code: "clinical-inputs-not-independently-confirmed", severity: "high", impact: "blocking", message: `Inputs required for these specific numerical calculations were not independently confirmed: ${describe(blockingFailed)}. Do not confirm those results from a single extraction channel.` });
  if (withheldFailed.length) inputConflicts.push({ code: "clinical-inputs-not-independently-confirmed", severity: "moderate", impact: "formula-withheld", message: `Inputs required for these specific numerical calculations were not independently confirmed: ${describe(withheldFailed)}. Only these calculations are withheld; independently verified results are unaffected.` });
  // Auxiliary change-from-baseline results are shown/verified only when BOTH readings were seen by the source channel.
  const auxNeeds = { "hb-decline": ["hb", "hbbaseline"], "creatinine-delta": ["creatinine", "creatininebaseline"], "creatinine-ratio": ["creatinine", "creatininebaseline"] };
  const auxWithheld = (id) => requireAuthorityInputs && auxNeeds[id] && auxNeeds[id].some((k) => !authorityFacts[k]);
  const paco2Confirmed = !requireAuthorityInputs || !!authorityFacts.paco2 || grounded("paco2");
  const computed = {
    ...rawComputed,
    notes: paco2Confirmed ? rawComputed.notes : rawComputed.notes.filter((n) => !/^Measured PaCO₂/.test(n)),
    results: rawComputed.results.filter((result) => !unverifiedResultIds.has(result.id) && !auxWithheld(result.id)),
  };
  const claimsTriple = claimsTripleAcidBase(combined);
  if (claimsTriple && !["na", "chloride", "hco3", "ph", "paco2"].some((key) => conflictedKeys.has(key))) {
    const deltaGap = computed.results.find((r) => r.id === "delta-gap");
    const winter = computed.results.find((r) => r.id === "winter");
    const measuredPaco2 = value(facts, "paco2");
    const gapSupportsMetAlk = !!deltaGap && deltaGap.value > 6;
    const winterSupportsRespAlk = !!winter && measuredPaco2 != null && measuredPaco2 < winter.value - 2;
    if (!gapSupportsMetAlk || !winterSupportsRespAlk) {
      const absent = [!gapSupportsMetAlk ? "delta gap does not support an additional metabolic alkalosis" : "", !winterSupportsRespAlk ? "measured PaCO₂ is not below Winter's expected range to support a primary respiratory alkalosis" : ""].filter(Boolean).join("; ");
      inputConflicts.push({ code: "triple-acid-base-not-supported", severity: "high", message: `The claimed triple disorder is not established by the supplied calculations: ${absent}. Reassess the mixed-disorder interpretation.` });
    }
  }
  // Numeric comparison targets the selected answer and calculation, never deliberately wrong distractors.
  const textToCheck = [answerText, narrative, calcText, optionText].filter(Boolean).join("\n");
  const formulaFindings = narrativeRuleFindings(combined, mergedDataText || dataText);
  const claims = extractClaims(textToCheck);
  const valueConflicts = verifyClaims(claims, computed.results);
  const unsupportedOutputs = [];
  const claimed = new Set(claims.map((c) => c.id));
  const hasResult = (id) => computed.results.some((r) => r.id === id);
  if (computed.domains.hemodynamics && !hasResult("svr") && claimed.has("svr")) unsupportedOutputs.push({ code: "svr-without-inputs", severity: "high", message: "An SVR result is reported, but the structured case inputs are insufficient to independently calculate it. Do not present the number as verified." });
  if (computed.domains.osmolality && !hasResult("og") && claimed.has("og")) unsupportedOutputs.push({ code: "og-without-inputs", severity: "high", message: "An osmolal-gap result is reported, but sodium, glucose, BUN, and measured osmolality (with a consistent ethanol method when applicable) were not all available. Do not present the number as verified." });
  if (computed.domains.acidBase && !hasResult("ag") && claimed.has("ag")) unsupportedOutputs.push({ code: "ag-without-inputs", severity: "high", message: "An anion-gap number is reported, but verified sodium, chloride and bicarbonate values in compatible units are not all available. Do not present the number as verified." });
  if (computed.domains.crRT && computed.domains.proteinPK && !hasResult("r0") && claimed.has("r0")) unsupportedOutputs.push({ code: "r0-without-inputs", severity: "high", message: "An infusion rate is reported without all required drug-specific PK/CRRT inputs. Do not provide a numerical maintenance rate or substitute an assumed sieving coefficient." });
  const seenConflict = new Set();
  const conflicts = [...inputConflicts, ...formulaFindings, ...valueConflicts, ...unsupportedOutputs].filter((c) => { const k = `${c.code}|${c.message}`; if (seenConflict.has(k)) return false; seenConflict.add(k); return true; });
  const activeCalculationDomain = computed.domains.hemodynamics || computed.domains.osmolality || computed.domains.acidBase
    || (computed.domains.crRT && computed.domains.proteinPK) || computed.domains.pringle || computed.domains.lactate;
  return {
    ...computed,
    sourceVerification: { required: !!requireAuthorityInputs, method: "separate source-reading pass; may be model-generated and is not human or orthogonal OCR verification", authorityFieldsAvailable: Object.keys(authorityFacts).length, modelFieldsAvailable: Object.keys(modelFacts).length, missingSourceFields: missingAuthority, missingModelFields: missingModel },
    conflicts,
    // A stray distractor mentioning CRRT and a separate distractor mentioning albumin
    // must not activate a drug-clearance calculation. PK/CRRT is a joint domain.
    triggered: activeCalculationDomain || conflicts.length > 0,
    status: conflicts.length ? "conflict" : computed.results.length ? "computed" : activeCalculationDomain && computed.inputCount ? "incomplete" : "no-structured-inputs",
  };
}

export function formatClinicalCalculationAudit(audit) {
  if (!audit || !audit.triggered) return "";
  const lines = ["APPLICATION CALCULATION AUDIT (independent arithmetic; use this over model mental arithmetic):"];
  for (const r of audit.results) lines.push(`- ${r.label}: ${r.value} ${r.unit}. Formula: ${r.formula}. ${r.note || ""}`.trim());
  for (const m of audit.missingInputs) lines.push(`- NOT CALCULATED: ${m}`);
  for (const n of audit.notes) lines.push(`- Interpretation note: ${n}`);
  for (const c of audit.conflicts) lines.push(`- HARD CONFLICT: ${c.message}`);
  if (!audit.results.length && !audit.missingInputs.length && !audit.conflicts.length) lines.push("- No supported independent calculation could be completed; do not invent a numerical result.");
  lines.push(audit.sourceVerification?.required ? "Every critical input must match between solver DATA and a separate source-reading pass. When that pass is model-generated, it is not an orthogonal OCR system or human verification; high-risk inputs still require confirmation against the original source." : "Arithmetic was recalculated from available extracted values; this alone does not independently verify transcription, diagnosis or prescribing safety.");
  return lines.join("\n");
}

// Calculate source-derived numerical checks before any lesson-writing model starts.
// This is an arithmetic preflight only: it does not independently validate the source transcription.
export function buildPreGenerationCalculationHandoff(sourceText = "") {
  const source = String(sourceText || "").trim();
  if (!source) return "";
  const extracted = extractLabelledClinicalData(source);
  if (!String(extracted || "").trim()) return "";
  // v3.67: the trigger is DATA-driven as well as keyword-driven. A case that merely lists Na/Cl/HCO₃ with an acidaemic pH or a low bicarbonate never says
  // «anion gap», so the lesson writers used to receive no verified numbers at all and had to do the arithmetic themselves.
  const f = parseClinicalData(extracted);
  const acidaemic = (f.ph && f.ph.value < 7.35) || (f.hco3 && f.hco3.value < 22);
  const dataHint = f.na && f.chloride && f.hco3 && acidaemic ? "\nacid-base: metabolic acidosis anion gap" : "";
  const audit = auditClinicalCalculations({
    dataText: extracted,
    modelDataText: extracted,
    contextText: `${source}${dataHint}`,
    requireAuthorityInputs: false,
  });
  if (!audit.triggered) return "";
  return formatClinicalCalculationAudit(audit);
}

export function extractClinicalDataBlock(text = "") {
  const t = String(text || "");
  const re = /===CLINICAL_DATA===\s*([\s\S]*?)\s*===END_CLINICAL_DATA===/i;
  const match = re.exec(t);
  return { dataText: match ? match[1].trim() : "", text: match ? `${t.slice(0, match.index)}${t.slice(match.index + match[0].length)}`.replace(/\n{3,}/g, "\n\n").trim() : t, found: !!match };
}

export function stripPartialClinicalDataBlock(text = "") {
  const t = String(text || "");
  const start = t.search(/===CLINICAL_DATA===/i);
  if (start < 0) return t;
  const end = t.search(/===END_CLINICAL_DATA===/i);
  return (end >= start ? `${t.slice(0, start)}${t.slice(end).replace(/===END_CLINICAL_DATA===/i, "")}` : t.slice(0, start)).replace(/\n{3,}/g, "\n\n").trimEnd();
}

export function maskOptionsWhenCalculationConflicts(text = "") {
  const t = String(text || "");
  const optionHead = /^##\s*(?:🔍\s*)?(?:كل اختيار لوحده|Every option|Every answer option)\s*$/im.exec(t);
  if (!optionHead) return t;
  const start = optionHead.index + optionHead[0].length;
  const tailMatch = /\n##\s/.exec(t.slice(start));
  const end = tailMatch ? start + tailMatch.index : t.length;
  const section = t.slice(start, end).replace(/^(\s*(?:[-*]\s*)?(?:\*\*)?[A-H][).:](?:\*\*)?.*?)(✅|✔|✓)/gm, "$1⚠️");
  return `${t.slice(0, start)}${section}${t.slice(end)}`;
}

export function renderClinicalAuditForStudent(audit, lang = "ar") {
  if (!audit || !audit.triggered || !audit.results.length || audit.conflicts.length) return "";
  const ar = lang !== "en";
  const rows = audit.results.map((r) => `- **${r.label}: ${r.value} ${r.unit}** — ${r.formula}${r.note ? `. ${r.note}` : ""}`);
  const head = ar ? "## 🧮 مراجعة الحسابات" : "## 🧮 Calculation check";
  const intro = ar ? "أُعيد حساب النتائج برمجيًا من القيم المستخرجة من السؤال:" : "These values were independently recalculated in application code from the values extracted from the question:";
  const notes = audit.notes.map((n) => `- ${n}`);
  return [head, intro, ...rows, ...notes].join("\n");
}

// A wrong AG or unreliable Na/Cl/HCO3 extraction can alter the entire acid-base
// interpretation. In a clinical open case, do not display generated teaching or
// management prose while one of these high-impact numeric conflicts remains.
export function blocksClinicalSynthesisForCalculationConflict(audit, clinicalContext = false) {
  if (!clinicalContext || !audit || !audit.domains?.acidBase || !Array.isArray(audit.conflicts)) return false;
  const blocking = /^(?:reported-(?:corrected-)?ag-(?:mismatch|arithmetic-inconsistent)|ag-without-inputs|extraction-[a-z0-9_]+-mismatch|within-source-[a-z0-9_]+-ambiguous)$/;
  return audit.conflicts.some((c) => c?.severity === "high" && blocking.test(String(c.code || "")))
    || audit.conflicts.some((c) => c?.severity === "high" && c.impact !== "formula-withheld" && c.code === "clinical-inputs-not-independently-confirmed");
}

// When the model's number is wrong but source channels agree, show only the
// deterministic arithmetic and the conflict. Never expose recomputed values if
// the inputs themselves disagree or were not independently corroborated.
export function renderClinicalCalculationConflictForStudent(audit, lang = "ar") {
  if (!audit || !audit.conflicts?.length) return "";
  const ar = lang !== "en";
  // `audit.results` has already been filtered per formula: only outputs whose
  // own inputs passed source corroboration remain. A missing CVP must not hide
  // a separately corroborated anion gap or Winter calculation.
  const rows = Array.isArray(audit.results)
    ? audit.results.map((r) => `- **${r.label}: ${r.value} ${r.unit}** — ${r.formula}${r.note ? `. ${r.note}` : ""}`)
    : [];
  const hasInputIssue = audit.conflicts.some((c) => /^(?:extraction-|within-source-)/.test(String(c.code || "")) || c.code === "clinical-inputs-not-independently-confirmed");
  const conflicts = audit.conflicts.slice(0, 5).map((c) => `- ${c.message}`);
  const head = ar ? "## 🧮 تدقيق الحسابات الذي أوقف اعتماد الإجابة" : "## 🧮 Calculation audit that blocked the generated answer";
  const intro = rows.length
    ? (hasInputIssue
      ? (ar ? "نعرض فقط الحسابات التي اجتازت مطابقة مدخلاتها الخاصة؛ أما الحسابات التي تنقصها مدخلات أو تختلف قراءاتها فقد حُجبت." : "Only calculations whose own inputs passed corroboration are shown; calculations with missing or conflicting inputs have been withheld.")
      : (ar ? "هذه إعادة حساب برمجية من القيم المستخرجة؛ وهي لا تثبت وحدها أن قراءة المصدر صحيحة. لم يُعتمد النص الطبي الذي ولّده النموذج." : "These are deterministic recalculations from the extracted values; they do not by themselves prove that source transcription is correct. The model-generated clinical text has not been cleared."))
    : (ar ? "توجد مشكلة في هوية/توافق مدخلات الحساب نفسها؛ لذلك لم نعرض ناتجًا محسوبًا باعتباره موثوقًا." : "The calculation inputs themselves conflict or are not independently corroborated, so no derived result is presented as reliable.");
  const sourceCaveat = audit.sourceVerification?.required
    ? (ar ? "طريقة القراءة الثانية قد تكون بواسطة نموذج آخر؛ وليست OCR مستقلاً أو مراجعة بشرية." : "The second reading may be model-generated; it is not independent OCR or human verification.")
    : "";
  return [head, intro, ...rows, ...(conflicts.length ? [ar ? "**سبب الإيقاف:**" : "**Blocking findings:**", ...conflicts] : []), sourceCaveat].filter(Boolean).join("\n");
}

/* conflicts that must clear the answer / force LOW (everything except a single formula being withheld) */
export const isBlockingConflict = (c) => !!c && c.impact !== "formula-withheld";
export const GENERIC_CALCULATION_CONFLICT_AR = "الحساب المستقل كشف تعارضًا في الأرقام أو المعادلة؛ لا تعتمد الاختيار قبل تصحيحه.";
export const FORMULA_WITHHELD_AR = "تعذر تأكيد مدخلات حساب معيّن من المصدر؛ حُجب هذا الحساب وحده ولم تتأثر الحسابات الأخرى المؤكدة.";
