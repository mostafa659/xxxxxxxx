/* ───────────── B9 · closed-book evidence cards for the solve prompt (v3.43) ─────────────
   ≤ ~120 tokens of KB cards, only when the stem's concepts match a KB fact with a HIGH score. Facts (ranges, rules), never the answer. Truncated from the END.
   OFF by default: noise can mislead models and gains shrink for strong ones, so it is switched on per profile only where the golden-set A/B shows a gain
   (none yet). The solve prompt was shortened by far more than this budget (see tests/budget.test.mjs). */
import { lookup } from "./kb/index.js";

const LS = "clinix:evidence";
export const evidenceOn = () => { try { return window.localStorage.getItem(LS) === "on"; } catch (e) { return false; } };
export const setEvidence = (on) => { try { window.localStorage.setItem(LS, on ? "on" : "off"); } catch (e) { /* ignore */ } };
export const MIN_SCORE = 6, MAX_CHARS = 360;      // ≈ 120 tokens at 3 chars per token

export function evidenceFor(stem, profile, { force = false } = {}) {
  if (!force && !evidenceOn()) return "";
  const hits = lookup(stem, profile, 3).filter((h) => h.score >= MIN_SCORE && ["range", "rule", "antidote", "pair", "relation"].includes(h.fact.kind));
  let out = "";
  for (const h of hits) {
    const f = h.fact, d = f.data || {};
    const line = f.kind === "range" ? `${d.analyte}: ${d.strata.map((s) => `${s.sex} ${s.low}–${s.high} ${d.si.unit}`).join("; ")} (varies by lab)` : f.kind === "pair" ? `${d.a}; ${d.b}` : f.kind === "relation" ? `${d.subject} ${d.relation}${d.object ? ": " + d.object : ""}` : d.text || f.topic;
    if ((out + line).length > MAX_CHARS) { out = (out + "\n- " + line).slice(0, MAX_CHARS); break; }
    out += (out ? "\n" : "") + "- " + line;
  }
  return out ? `REFERENCE (facts only, not the answer):\n${out}` : "";
}
