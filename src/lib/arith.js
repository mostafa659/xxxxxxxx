/* ───────────── lib/arith.js · one small, safe arithmetic evaluator (v3.67) ─────────────
   Extracted from solvecheck.js so that the clinical calculation verifier and the CALC-line checker share ONE implementation.
   No eval(): a tiny recursive-descent parser. Units inside an expression are ignored; Unicode minus/multiplication/division and
   [brackets] are normalised first. Anything that is not pure arithmetic returns null (never a guess). */

const UNIT_WORDS = "mmol|mol|mEq|meq|mOsm|mosm|mmHg|mg|mcg|µg|μg|kg|g|lb|ml|mL|dl|dL|l|L|h|hr|min|s|cm|mm|m|in|gtt|units?|IU|drops?|bpm|kPa|%";

export function normalizeArithmetic(expr) {
  return String(expr)
    .replace(/[−–—‒]/g, "-")
    .replace(/[×✕✖⋅·]/g, "*")
    .replace(/÷/g, "/")
    .replace(/[\[\{]/g, "(").replace(/[\]\}]/g, ")")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0))
    .replace(/±\s*\d+(?:\.\d+)?/g, "");
}

/* evaluate "15 mg/kg × 70 kg ÷ 3" → number. Returns null when the text is not pure arithmetic. */
export function evalExpr(expr) {
  const s = normalizeArithmetic(expr)
    .replace(/,(?=\d{3}\b)/g, "")
    .replace(/x(?=\s*[\d(])/gi, "*")
    .replace(/:/g, "/")
    .replace(new RegExp(`(?<=\\d)\\s*(?:${UNIT_WORDS})\\b(?:\\s*\\/\\s*(?:kg|h|hr|min|dl|dL|l|L|ml|mL|m2|m²|day|d))*`, "gi"), "")
    .replace(/\s+/g, "");
  if (!s || !/^[\d.+\-*/()]+$/.test(s)) return null;
  try {
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
