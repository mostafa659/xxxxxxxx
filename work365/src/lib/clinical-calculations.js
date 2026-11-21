/*
 * Deterministic clinical calculation audit (v3.60).
 *
 * This module never diagnoses or prescribes. It independently recomputes a small,
 * explicit set of examination calculations from values in the solver DATA field
 * and a separate model-generated source-reading pass / lesson extraction (not an orthogonal OCR engine). Missing inputs are never guessed. In particular, the
 * sieving coefficient is NOT silently replaced with the unbound fraction.
 */

const NUM = "-?[0-9\\u0660-\\u0669]+(?:[.,٫][0-9\\u0660-\\u0669]+)?";
const PAIR_RE = new RegExp(`(?:^|[;|,\\n])\\s*([A-Za-z][A-Za-z0-9_\\u2080-\\u2089]*)\\s*=\\s*(${NUM})\\s*([^;,\\n]*)`, "g");

const KEY_ALIASES = {
  map: ["map", "mean arterial pressure"],
  sbp: ["sbp", "systolic blood pressure", "systolic bp", "systolic_bp"],
  dbp: ["dbp", "diastolic blood pressure", "diastolic bp", "diastolic_bp"],
  cvp: ["cvp", "central venous pressure"],
  co: ["co", "cardiac output"],
  vo2: ["vo2", "oxygen consumption"],
  cao2: ["cao2", "arterial oxygen content"],
  cvo2: ["cvo2", "venous oxygen content"],
  hb: ["hb", "hemoglobin", "haemoglobin", "current hb", "current_hb", "current hemoglobin", "current haemoglobin"],
  hb_baseline: ["historical hb", "historical_hb", "baseline hb", "baseline_hb", "historical hemoglobin", "baseline hemoglobin", "historical haemoglobin", "baseline haemoglobin"],
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
};

const normKey = (s) => String(s || "").replace(/[₀-₉]/g, (d) => String("₀₁₂₃₄₅₆₇₈₉".indexOf(d))).toLowerCase().replace(/[^a-z0-9]/g, "");
const num = (s) => Number(String(s).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0)).replace(/٫/g, ".").replace(",", "."));
const round = (x, d = 2) => Number.isFinite(x) ? Number(x.toFixed(d)) : null;
const close = (a, b, abs = 0.5, rel = 0.015) => Math.abs(a - b) <= Math.max(abs, Math.abs(b) * rel);

function canonicalKey(key) {
  const k = normKey(key);
  for (const [canon, aliases] of Object.entries(KEY_ALIASES)) {
    if (aliases.some((a) => normKey(a) === k)) return canon;
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
    const reading = { key, value, unit: String(m[3] || "").trim().replace(/\s+/g, " "), raw: m[0].trim() };
    if (!facts[key]) facts[key] = reading; // first reading wins; conflicting repeats are never silently overwritten
    else {
      const prior = facts[key];
      if (!close(prior.value, reading.value, 0.0001, 0.0001) || (prior.unit && reading.unit && prior.unit.toLowerCase() !== reading.unit.toLowerCase())) {
        duplicates.push({ key, first: prior, repeated: reading });
      }
    }
  }
  return { facts, duplicates };
}

export function parseClinicalData(text = "") {
  return parseClinicalDataDiagnostics(text).facts;
}

function qualifierForMeasurement(source, index) {
  const t = String(source || "");
  const lineStart = t.lastIndexOf("\n", Math.max(0, index)) + 1;
  const lineEndRaw = t.indexOf("\n", index);
  const lineEnd = lineEndRaw < 0 ? t.length : lineEndRaw;
  const line = t.slice(lineStart, lineEnd).toLowerCase();
  const beforeOnLine = t.slice(lineStart, index).toLowerCase();
  const lastHeading = [...t.slice(0, index).matchAll(/(?:^|\n)\s*#{1,6}\s*([^\n]+)/g)].at(-1);
  const headingText = String(lastHeading?.[1] || "").toLowerCase();
  const tags = [];
  if (/post[-\s]?(?:oxygenator|membrane)|ecmo\s+post/.test(line)) tags.push("ecmo_post_oxygenator");
  else if (/pre[-\s]?(?:oxygenator|membrane)|ecmo\s+pre/.test(line)) tags.push("ecmo_pre_oxygenator");
  else if (/right\s+radial/.test(line)) tags.push("right_radial");
  else if (/left\s+radial/.test(line)) tags.push("left_radial");
  else if (/left\s+(?:femoral|pedal|toe)|femoral\s*\/\s*pedal/.test(line)) tags.push("left_femoral_pedal");
  else if (/right\s+(?:femoral|pedal|toe)/.test(line)) tags.push("right_femoral_pedal");
  else if (/pulmonary\s+artery\s+catheter|\bPAC\b/.test(line)) tags.push("pulmonary_artery_catheter");
  // Do not let a baseline column header leak into unrelated rows later in the section.
  // Markdown tables are handled with explicit column identity below.
  if (/\b(?:baseline|historical|prior|previous|preoperative|pre-op)\b/.test(`${headingText} ${beforeOnLine}`)
      || /\b(?:two|three|four|six|twelve)\s+(?:days?|weeks?|months?|years?)\s+ago\b/.test(beforeOnLine)) tags.push("baseline");
  return tags.length ? tags.join("_") : "";
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
      if (!Object.hasOwn(KEY_ALIASES, baseKey)) continue;
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
  // same finding. Keep the final finding (which may carry a more specific code)
  // once, instead of showing duplicate warnings to the learner.
  const incomingMessages = new Set(incoming.map((item) => String(getMessage(item) || "").trim()).filter(Boolean));
  return [...existing.filter((item) => !incomingMessages.has(String(getMessage(item) || "").trim())), ...incoming];
}

export function extractLabelledClinicalData(text = "") {
  const source = String(text || "");
  const table = extractMarkdownTablePairs(source);
  const scanSource = source.split(/\r?\n/).map((line, i) => table.excluded.has(i) ? "" : line).join("\n");
  const specs = [
    ["map", new RegExp(`(?:mean\\s+arterial\\s+pressure|\\bMAP\\b)\\s*(?:was|is|of|[:=]|\\|)?\\s*(${NUM})\\s*(mm\\s*hg)`, "i")],
    ["sbp", new RegExp(`(?:systolic\\s+blood\\s+pressure|\\bSBP\\b)\\s*(?:was|is|of|[:=]|\\|)?\\s*(${NUM})\\s*(mm\\s*hg)`, "i")],
    ["dbp", new RegExp(`(?:diastolic\\s+blood\\s+pressure|\\bDBP\\b)\\s*(?:was|is|of|[:=]|\\|)?\\s*(${NUM})\\s*(mm\\s*hg)`, "i")],
    ["cvp", new RegExp(`(?:central\\s+venous\\s+pressure|\\bCVP\\b)\\s*(?:was|is|of|[:=]|\\|)?\\s*(${NUM})\\s*(mm\\s*hg)`, "i")],
    ["co", new RegExp(`(?:cardiac\\s+output|\\bCO\\b)\\s*(?:was|is|of|[:=]|\\|)?\\s*(${NUM})\\s*(L\\s*\\/\\s*min)`, "i")],
    ["vo2", new RegExp(`(?:oxygen\\s+consumption|\\bVO2\\b)\\s*(?:was|is|of|[:=]|\\|)?\\s*(${NUM})\\s*(mL\\s*\\/\\s*min)`, "i")],
    ["cao2", new RegExp(`(?:arterial\\s+oxygen\\s+content|\\bCaO2\\b)\\s*(?:was|is|of|[:=]|\\|)?\\s*(${NUM})\\s*(mL\\s*\\/\\s*dL)`, "i")],
    ["cvo2", new RegExp(`(?:venous\\s+oxygen\\s+content|\\bCvO2\\b)\\s*(?:was|is|of|[:=]|\\|)?\\s*(${NUM})\\s*(mL\\s*\\/\\s*dL)`, "i")],
    ["hb", new RegExp(`(?:hemoglobin|haemoglobin|\\bHb\\b)\\s*(?:was|is|of|[:=]|\\|)?\\s*(${NUM})\\s*(g\\s*\\/\\s*dL)`, "i")],
    ["sao2", new RegExp(`(?:arterial\\s+oxygen\\s+saturation|\\bSaO2\\b)\\s*(?:was|is|of|[:=]|\\|)?\\s*(${NUM})\\s*(%)`, "i")],
    ["pao2", new RegExp(`(?:arterial\\s+oxygen\\s+partial\\s+pressure|\\bPaO2\\b)\\s*(?:was|is|of|[:=]|\\|)?\\s*(${NUM})\\s*(mm\\s*hg)`, "i")],
    ["svo2", new RegExp(`(?:venous\\s+oxygen\\s+saturation|\\bSvO2\\b)\\s*(?:was|is|of|[:=]|\\|)?\\s*(${NUM})\\s*(%)`, "i")],
    ["pvo2", new RegExp(`(?:venous\\s+oxygen\\s+partial\\s+pressure|\\bPvO2\\b)\\s*(?:was|is|of|[:=]|\\|)?\\s*(${NUM})\\s*(mm\\s*hg)`, "i")],
    ["fu", new RegExp(`(?:unbound\\s+fraction|free\\s+fraction|\\bfu\\b)\\s*(?:was|is|of|[:=]|\\|)?\\s*(${NUM})`, "i")],
    ["sc", new RegExp(`(?:sieving\\s+coefficient|\\bSC\\b)\\s*(?:was|is|of|[:=]|\\|)?\\s*(${NUM})`, "i")],
    ["clint", new RegExp(`(?:intrinsic\\s+clearance|\\bCLint\\b)\\s*(?:was|is|of|[:=]|\\|)?\\s*(${NUM})\\s*(L\\s*\\/\\s*h)`, "i")],
    ["qeff", new RegExp(`(?:delivered\\s+effluent\\s+flow|effective\\s+effluent\\s+flow|\\bQeff\\b)\\s*(?:was|is|of|[:=]|\\|)?\\s*(${NUM})\\s*(L\\s*\\/\\s*h)`, "i")],
    ["cssu", new RegExp(`(?:target\\s+unbound\\s+concentration|unbound\\s+Css|\\bCssu\\b)\\s*(?:was|is|of|[:=]|\\|)?\\s*(${NUM})\\s*(mg\\s*\\/\\s*L)`, "i")],
    ["ethanoldivisor", new RegExp(`(?:ethanol\\s+(?:conversion\\s+)?divisor|ethanol\\s+coefficient|\\bEthanolDivisor\\b)\\s*(?:was|is|of|[:=]|\\|)?\\s*(${NUM})`, "i")],
    ["na", new RegExp(`(?:sodium|\\bNa\\+?)\\s*(?:was|is|of|[:=]|\\|)?\\s*(${NUM})\\s*(mmol\\s*\\/\\s*L|mEq\\s*\\/\\s*L)`, "i")],
    ["glucose", new RegExp(`(?:glucose|blood\\s+sugar)\\s*(?:was|is|of|[:=]|\\|)?\\s*(${NUM})\\s*(mg\\s*\\/\\s*dL|mmol\\s*\\/\\s*L)`, "i")],
    ["bun", new RegExp(`(?:blood\\s+urea\\s+nitrogen|\\bBUN\\b)\\s*(?:was|is|of|[:=]|\\|)?\\s*(${NUM})\\s*(mg\\s*\\/\\s*dL|mmol\\s*\\/\\s*L)`, "i")],
    ["urea", new RegExp(`\\burea\\b\\s*(?:was|is|of|[:=]|\\|)?\\s*(${NUM})\\s*(mg\\s*\\/\\s*dL|mmol\\s*\\/\\s*L)`, "i")],
    ["measuredosm", new RegExp(`(?:measured\\s+(?:serum\\s+)?osmolality)\\s*(?:was|is|of|[:=]|\\|)?\\s*(${NUM})\\s*(mOsm\\s*\\/\\s*kg)`, "i")],
    ["ethanol", new RegExp(`(?:ethanol|alcohol\\s+level)\\s*(?:was|is|of|[:=]|\\|)?\\s*(${NUM})\\s*(mg\\s*\\/\\s*dL)`, "i")],
    ["ph", new RegExp(`\\bpH\\b\\s*(?:was|is|of|[:=]|\\|)?\\s*(${NUM})`, "i")],
    ["chloride", new RegExp(`(?:chloride|\\bCl-?)\\s*(?:was|is|of|[:=]|\\|)?\\s*(${NUM})\\s*(mmol\\s*\\/\\s*L|mEq\\s*\\/\\s*L)`, "i")],
    ["hco3", new RegExp(`(?:bicarbonate|\\bHCO[₃3][⁻-]?)\\s*(?:was|is|of|[:=]|\\|)?\\s*(${NUM})\\s*(mmol\\s*\\/\\s*L|mEq\\s*\\/\\s*L)`, "i")],
    ["albumin", new RegExp(`(?:albumin|\\bAlb\\b)\\s*(?:was|is|of|[:=]|\\|)?\\s*(${NUM})\\s*(g\\s*\\/\\s*dL)`, "i")],
    ["paco2", new RegExp(`(?:PaCO[₂2]|arterial\\s+carbon\\s+dioxide)\\s*(?:was|is|of|[:=]|\\|)?\\s*(${NUM})\\s*(mm\\s*\\/?\\s*hg)`, "i")],
  ];
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
    if (Object.hasOwn(KEY_ALIASES, key)) {
      pairs.push(`${key}=${reading.value} ${reading.unit}`.trim());
    }
  }
  // A combined BP cell (for example, "Blood pressure | 82/48 mmHg") carries two inputs.
  // Extract SBP and DBP separately so MAP can be recomputed without inventing either value.
  const bpPattern = /(?:blood\s+pressure|\bBP\b)\s*(?:was|is|of|[:=]|\|)?\s*(\d{2,3})\s*\/\s*(\d{2,3})\s*(mm\s*hg)/ig;
  for (const match of scanSource.matchAll(bpPattern)) {
    const qualifier = qualifierForMeasurement(scanSource, match.index);
    const suffix = qualifier ? `_${qualifier}` : "";
    pairs.push(`sbp${suffix}=${match[1]} ${String(match[3]).replace(/\s+/g, "")}`);
    pairs.push(`dbp${suffix}=${match[2]} ${String(match[3]).replace(/\s+/g, "")}`);
  }
  for (const [key, re] of specs) {
    // Preserve every occurrence: selecting only the first match can silently pick a baseline,
    // reference-range value, or earlier time point instead of the current result.
    const global = new RegExp(re.source, `${re.flags.replace(/g/g, "")}g`);
    for (const match of scanSource.matchAll(global)) {
      // Site/sample qualifiers are part of a measurement's identity. Right-radial
      // patient gas and post-oxygenator gas, for example, are not competing readings.
      const qualifier = qualifierForMeasurement(scanSource, match.index);
      const scopedKey = qualifier ? `${key}_${qualifier}` : key;
      pairs.push(`${scopedKey}=${match[1]} ${String(match[2] || "").replace(/\s+/g, "")}`.trim());
    }
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

function labelledNumber(text, aliases) {
  const t = String(text || "");
  for (const alias of aliases) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const boundary = /^[A-Za-z0-9]+$/.test(alias) ? `\\b${escaped}\\b` : escaped;
    const re = new RegExp(`${boundary}\\s*(?:[:=]|is|of|\\|)?\\s*(${NUM})`, "i");
    const m = re.exec(t);
    if (m) return num(m[1]);
  }
  return null;
}

function compareLabeled(text, result) {
  const aliases = {
    svr: ["systemic vascular resistance", "SVR"],
    og: ["osmolal gap", "osmolar gap", "OG"],
    co: ["cardiac output", "CO"],
    ag: ["corrected anion gap", "anion gap", "AG"],
    winter: ["Winter expected PaCO2", "expected PaCO2", "expected PaCO₂"],
    r0: ["R0", "R₀", "maintenance infusion rate", "infusion rate"],
  };
  const conflicts = [];
  for (const r of result.results) {
    const keys = aliases[r.id];
    if (!keys) continue;
    const observed = labelledNumber(text, keys);
    if (observed == null) continue;
    if (!close(observed, r.value, r.id === "og" ? 0.5 : 0.1, 0.015)) {
      conflicts.push({ code: `reported-${r.id}-mismatch`, severity: "high", id: r.id, reported: observed, computed: r.value, unit: r.unit, message: `${r.label}: the answer reports ${observed} ${r.unit}, while the independent calculation from the extracted inputs is ${r.value} ${r.unit}.` });
    }
  }
  return conflicts;
}

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

    if (value(facts, "hco3") != null && value(facts, "paco2") != null && (/winter|metabolic acidosis/.test(String(contextText).toLowerCase()) || claimsTripleAcidBase(contextText))) {
      if (unitIs(facts, "hco3", [/^mmol\/l$/]) && unitIs(facts, "paco2", [/^mmhg$/])) {
        const expected = 1.5 * value(facts, "hco3") + 8;
        addResult(results, "winter", "Winter expected PaCO₂", expected, "mmHg", "1.5×HCO₃ + 8 ± 2", "Expected range: result ±2 mmHg. Compare with measured PaCO₂; do not diagnose a mixed disorder without the full acid-base context.");
        const actual = value(facts, "paco2");
        const low = expected - 2, high = expected + 2;
        if (actual < low) notes.push(`Measured PaCO₂ ${actual} mmHg is below Winter's expected range (${round(low)}–${round(high)} mmHg); this supports an additional respiratory alkalosis in the stated metabolic-acidosis context.`);
        else if (actual > high) notes.push(`Measured PaCO₂ ${actual} mmHg is above Winter's expected range (${round(low)}–${round(high)} mmHg); this supports an additional respiratory acidosis in the stated metabolic-acidosis context.`);
        else notes.push(`Measured PaCO₂ ${actual} mmHg is within Winter's expected range (${round(low)}–${round(high)} mmHg).`);
      } else missingInputs.push("Winter's formula requires HCO₃ in mmol/L and PaCO₂ in mmHg.");
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
  const hasNumber = (aliases) => labelledNumber(generatedText, aliases) != null;
  const mapClaim = hasNumber(["estimated mean arterial pressure", "mean arterial pressure", "MAP"]);
  const svrClaim = hasNumber(["systemic vascular resistance", "SVR"]);
  const fickCoClaim = hasNumber(["Fick cardiac output", "cardiac output by Fick", "cardiac output"])
    && /fick/i.test(generatedText);
  const agClaim = hasNumber(["albumin-corrected anion gap", "corrected anion gap", "anion gap", "AG"]);
  const correctedAgClaim = hasNumber(["albumin-corrected anion gap", "corrected anion gap"]);
  const winterClaim = hasNumber(["Winter expected PaCO2", "expected PaCO2", "expected PaCO₂"]);
  const ogClaim = hasNumber(["osmolal gap", "osmolar gap", "OG"]);
  const r0Claim = hasNumber(["maintenance infusion rate", "infusion rate", "R0", "R₀"]);
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
    add("winter", ["hco3", "paco2"]);
  }
  if (claimsTripleAcidBase(generatedText)) add("triple-acid-base", ["na", "chloride", "hco3", "ph", "paco2"]);

  if (resultIds.has("r0") || r0Claim) {
    const fields = ["fu", "clint", "qeff", "cssu", fact(facts, "sc") ? "sc" : fact(facts, "scequalsfu") ? "scequalsfu" : "sc-or-scequalsfu"];
    add("r0", fields);
  }
  return requirements;
}
function missingAuthorityFields(required, authorityFacts) {
  const labels = {
    "map-or-sbp+dbp": "MAP or SBP+DBP", "bun-or-urea": "BUN or urea",
    "sc-or-scequalsfu": "SC or an explicitly stated SC=fu relationship",
  };
  return required.filter((key) => {
    if (key === "map-or-sbp+dbp") return !(authorityFacts.map || (authorityFacts.sbp && authorityFacts.dbp));
    if (key === "bun-or-urea") return !(authorityFacts.bun || authorityFacts.urea);
    if (key === "sc-or-scequalsfu") return !(authorityFacts.sc || authorityFacts.scequalsfu);
    return !authorityFacts[key];
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

export function auditClinicalCalculations({ dataText = "", secondaryDataText = "", authorityDataText = "", modelDataText = "", requireAuthorityInputs = false, narrative = "", answerText = "", calcText = "", contextText = "", optionText = "" } = {}) {
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
  const missingByRequirement = requirements.map((requirement) => ({
    requirement,
    authority: missingAuthorityFields(requirement.fields, authorityFacts),
    model: missingAuthorityFields(requirement.fields, modelFacts),
  }));
  const failedRequirements = missingByRequirement.filter((x) => x.authority.length || x.model.length);
  const missingAuthority = [...new Set(failedRequirements.flatMap((x) => x.authority))];
  const missingModel = [...new Set(failedRequirements.flatMap((x) => x.model))];
  const unverifiedResultIds = new Set(failedRequirements.flatMap((x) => x.requirement.resultIds));
  if (failedRequirements.length) {
    const detail = failedRequirements.map((x) => `${x.requirement.id}: source ${x.authority.length ? x.authority.join(", ") : "complete"}; solver ${x.model.length ? x.model.join(", ") : "complete"}`).join(" | ");
    inputConflicts.push({ code: "clinical-inputs-not-independently-confirmed", severity: "high", message: `Inputs required for these specific numerical calculations were not independently confirmed: ${detail}. Do not confirm those results from a single extraction channel.` });
  }
  const computed = {
    ...rawComputed,
    results: rawComputed.results.filter((result) => !unverifiedResultIds.has(result.id)),
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
  const valueConflicts = compareLabeled(textToCheck, computed);
  const unsupportedOutputs = [];
  const hasOutput = (re) => re.test(textToCheck);
  if (computed.domains.hemodynamics && !computed.results.some((r) => r.id === "svr") && hasOutput(/\b(?:SVR|systemic vascular resistance)\s*(?:=|:|is)\s*\d/i)) unsupportedOutputs.push({ code: "svr-without-inputs", severity: "high", message: "An SVR result is reported, but the structured case inputs are insufficient to independently calculate it. Do not present the number as verified." });
  if (computed.domains.osmolality && !computed.results.some((r) => r.id === "og") && hasOutput(/\b(?:OG|osmolal gap|osmolar gap)\s*(?:=|:|is)\s*\d/i)) unsupportedOutputs.push({ code: "og-without-inputs", severity: "high", message: "An osmolal-gap result is reported, but sodium, glucose, BUN, and measured osmolality (with a consistent ethanol method when applicable) were not all available. Do not present the number as verified." });
  if (computed.domains.acidBase && !computed.results.some((r) => r.id === "ag") && hasOutput(/\b(?:albumin[- ]corrected\s+)?anion\s+gap\s*(?:=|:|is)\s*\d/i)) unsupportedOutputs.push({ code: "ag-without-inputs", severity: "high", message: "An anion-gap number is reported, but verified sodium, chloride and bicarbonate values in compatible units are not all available. Do not present the number as verified." });
  if (computed.domains.crRT && computed.domains.proteinPK && !computed.results.some((r) => r.id === "r0") && hasOutput(/(?:\bR\s*[₀0]|(?:maintenance\s+)?infusion\s+rate)\s*(?:=|:|is)\s*\d/i)) unsupportedOutputs.push({ code: "r0-without-inputs", severity: "high", message: "An infusion rate is reported without all required drug-specific PK/CRRT inputs. Do not provide a numerical maintenance rate or substitute an assumed sieving coefficient." });
  const conflicts = [...inputConflicts, ...formulaFindings, ...valueConflicts, ...unsupportedOutputs];
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
  const audit = auditClinicalCalculations({
    dataText: extracted,
    modelDataText: extracted,
    contextText: source,
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
  const blocking = /^(?:reported-(?:corrected-)?ag-mismatch|ag-without-inputs|extraction-(?:na|chloride|hco3|albumin)-mismatch|within-source-(?:na|chloride|hco3|albumin)-ambiguous)$/;
  return audit.conflicts.some((c) => c?.severity === "high" && blocking.test(String(c.code || "")))
    || audit.conflicts.some((c) => c?.severity === "high" && c.code === "clinical-inputs-not-independently-confirmed");
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
