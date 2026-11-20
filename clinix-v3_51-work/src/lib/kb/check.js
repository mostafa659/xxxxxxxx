/* ───────────── KB check (v3.43 · F2) — contradictions, patches, labels, Reference Cards ─────────────
   Runs on the sentences accuracy.js produced. Synchronous, zero network.
   LABELS (what the student sees):
     verified    ✓  resolved by a KB fact whose source quote was verified AND whose review date has not passed  — the ONLY label memorize / saved-mistakes accept (plus plain source text)
     corrected   ⚠  the KB contradicted the sentence: it was replaced IN PLACE, the old text is kept (tap to see before → after)
     outdated    ⚠  matches a KB fact past its reviewBy date: "may be outdated"
     pending     ⚠  matches a KB fact whose source quote has not been verified yet ("reference — source check pending")
     scope       ⚠  a rule that belongs to another profession / country
     unverified  ؟  high-risk and the KB cannot resolve it (it also goes to the KB gap list); dose-class → "confirm with an official reference"
     plain          low-risk text, no badge */
import { loadedFacts, compiled, inScope, jurisdictionMismatch, factStatus, rulesIndex } from "./index.js";
import { matchSentence, padded } from "./rules.js";
import { HIGH_RISK, SAFETY_CRITICAL, norm, indexSource } from "../accuracy.js";
import { contradictionOf, rangeInfo, patientOf } from "./ranges.js";

export const LABEL_ICON = { verified: "✓", corrected: "⚠", outdated: "⚠", reference: "🔎", grounded: "📄", conflict: "⚠", scope: "⚠", uncertain: "⚠", unverified: "؟", plain: "" };
const CONFIRM_NOTE = "confirm with an official reference before clinical use";

const statusToLabel = (st) => (st === "verified" ? "verified" : st === "outdated" ? "outdated" : "reference");

/* compiled once: a regex built per sentence was the whole cost of the pass */
const RX = new Map();
const rx = (src, flags = "iu") => { const k = flags + src; let r = RX.get(k); if (r === undefined) { try { r = new RegExp(src, flags); } catch (e) { r = null; } RX.set(k, r); } return r; };
const NA = new Map();
const nalias = (a) => { let v = NA.get(a); if (v === undefined) { v = norm(a); NA.set(a, v); } return v; };

function supportFact(sentence) {
  for (const f of loadedFacts()) {
    for (const re of f.support || []) { const r = rx(re); if (r && r.test(sentence)) return f; }
  }
  return null;
}
function listFact(sentence, profile) {
  const ns = ` ${norm(sentence)} `;
  for (const f of loadedFacts()) {
    if (f.kind !== "list" || !inScope(f, profile)) continue;
    const topicHit = [...f.aliases.en, ...f.aliases.ar].some((a) => ns.includes(nalias(a)));
    if (!topicHit) continue;
    const items = f.data.items || [];
    const all = items.every((it) => [it.en, ...(it.aliases || []), it.ar].some((a) => a && ns.includes(nalias(a))));
    if (all) return f;
  }
  return null;
}
function ruleFact(sentence) {
  for (const f of loadedFacts()) {
    if (f.kind !== "rule" || !f.data || !f.data.triggers) continue;
    for (const re of f.data.triggers) { const r = rx(re); if (r && r.test(sentence)) return f; }
  }
  return null;
}

/* → the same items, labeled. patches = [{ id, before, after, fact }] ; gaps = unresolved high-risk sentences */
export function checkItems(items, { profile, now = Date.now(), patient, all = false, ground = null } = {}) {
  const patches = [], gaps = [], pats = compiled(), ridx = rulesIndex();
  for (const it of items) {
    const s = it.sentence;
    it.label = "plain"; it.note = ""; it.fact = null; it.text = null;
    const S = padded(s), T = S.trim().split(" "), Tset = new Set(T);
    /* «source vs reference» only when the student's source REALLY says this sentence (anchored + guards); a similar-looking sentence is just a correction */
    const fromSource = () => !!(ground && it.origin === "source" && ground(s).state === "grounded");
    // 1 ─ contradictions: a forbidden pattern (prefiltered by its fact's words) or a concept rule → patched in place, logged before → after
    const hit = pats.find((p) => inScope(p.fact, profile) && p.anchors.some((a) => Tset.has(a)) && p.re.test(s));
    const rh = ridx ? matchSentence(ridx, S, T) : [];
    const rconf = !hit && rh.find((h) => h.kind === "conflict");
    if (rconf) {
      it.text = rconf.fix; const fs1 = fromSource(); it.label = fs1 ? "conflict" : "corrected"; it.fact = rconf.rule.id; it.before = s; it.note = fs1 ? "your source says this, the reference says otherwise" : "reference — source check pending"; it.rule = rconf.rule.id;
      patches.push({ id: it.id, before: s, after: rconf.fix, fact: rconf.rule.id });
      continue;
    }
    if (hit) {
      const fs2 = fromSource(); it.text = hit.correction; it.label = fs2 ? "conflict" : "corrected"; it.fact = hit.fact.id; it.before = s;
      it.note = fs2 ? "your source says this, the reference says otherwise" : factStatus(hit.fact, now) === "verified" ? "" : "reference — source check pending";
      patches.push({ id: it.id, before: s, after: hit.correction, fact: hit.fact.id });
      continue;
    }
    // 2–4 only matter for the sentences the classifier calls high-risk (they decide ✓ / ⚠ / ؟); low-risk text keeps its plain label
    if (!all && !HIGH_RISK.has(it.kind)) continue;          // `all`: an exam item's KEY statement may be classified low-risk but a reference can still agree with it
    // 2 ─ lab value vs the range of the patient's sex / age stratum
    const ri = rangeInfo(s, patient, profile);             // once per sentence
    const rc = contradictionOf(ri);
    if (rc) {
      it.text = rc.text; it.label = "corrected"; it.fact = rc.info.fact.id; it.before = s; it.note = "reference range — varies by lab";
      patches.push({ id: it.id, before: s, after: rc.text, fact: rc.info.fact.id });
      continue;
    }
    if (ri && ri.noStratum) { it.label = "uncertain"; it.note = "no reference range for this age in the KB"; gaps.push(gap(it, "range-stratum")); continue; }
    // 3 ─ a rule that belongs to another profession or country
    const rf = ruleFact(s);
    if (rf) {
      it.fact = rf.id;
      if (!inScope(rf, profile)) { it.label = "scope"; it.note = `${(rf.scope.discipline || []).join("/")}-specific rule — not applied to your profile`; continue; }
      if (jurisdictionMismatch(rf, profile)) { it.label = "scope"; it.note = `${rf.scope.jurisdiction} rule — check your local regulation`; continue; }
      it.label = statusToLabel(factStatus(rf, now)); it.note = noteFor(rf, now); continue;
    }
    // 4 ─ the KB confirms it (a concept rule, a support pattern, or a complete list)
    const rs = rh.find((h) => h.kind === "support");
    if (rs) { it.fact = rs.rule.id; it.rule = rs.rule.id; it.label = "reference"; it.note = "reference — source check pending"; continue; }
    const sf = supportFact(s) || listFact(s, profile);
    if (sf) { it.fact = sf.id; const st = factStatus(sf, now); it.label = statusToLabel(st); it.note = noteFor(sf, now); continue; }
    // 5 ─ citation-first: the student's OWN source says it (anchored, numbers / polarity / acronyms agree) → «grounded»; the source says something else → «conflict»
    if (HIGH_RISK.has(it.kind)) {
      const g = ground && it.origin === "source" ? ground(s) : null;
      if (g && g.state === "grounded") {
        it.label = "grounded"; it.prov = g.prov; it.sourceSnippet = g.source;
        it.note = SAFETY_CRITICAL.has(it.kind) ? CONFIRM_NOTE : "";
        continue;
      }
      if (g && g.state === "contradiction") {
        it.label = "conflict"; it.prov = g.prov; it.sourceSnippet = g.source; it.note = `differs from your source (${g.why})`;
        gaps.push(gap(it, "source-" + g.why));
        continue;
      }
      it.label = "unverified";
      if (SAFETY_CRITICAL.has(it.kind)) it.note = CONFIRM_NOTE;
      gaps.push(gap(it, it.kind));
    }
  }
  /* MEMORIZE rule: ✓ verified by a verified reference; 📄 grounded in the student's own source (it IS their material) unless it is safety-critical (doses, contraindications:
     those need an official reference); plain low-risk text copied from the source. Never: reference-only ⚠, conflict, unverified. */
  for (const it of items) it.memorize = it.label === "verified" || (it.label === "grounded" && !SAFETY_CRITICAL.has(it.kind)) || (it.label === "plain" && it.origin === "source" && !HIGH_RISK.has(it.kind));
  return { patches, gaps };
}
const gap = (it, why) => ({ sentence: it.before || it.sentence, kind: it.kind, why });
const noteFor = (f, now) => { const st = factStatus(f, now); return st === "verified" ? `${f.version || ""}`.trim() : st === "outdated" ? `may be outdated — ${f.version || "reviewed"} · review date ${f.reviewBy}` : "reference — source check pending"; };

/* ── Reference Cards: a standard fact is shown from the KB, not generated by the model ──
   For a list fact whose topic the SOURCE mentions: the verified list, which items the source never covered ("not covered in the material"),
   and, if the source itself contradicts a forbidden pattern: "source says X, reference says Y". */
export function referenceCards(sourceText, { profile, now = Date.now(), max = 4 } = {}) {
  const cards = [], conflicts = [];
  if (!sourceText) return { cards, conflicts };
  const ns = norm(sourceText);
  const idx = indexSource(sourceText);
  for (const f of loadedFacts()) {
    if (!inScope(f, profile)) continue;
    for (const p of f.forbidden_patterns || []) {
      const re = rx(p.re, p.flags || "iu");
      if (!re) continue;
      const m = re.exec(sourceText);
      if (m) conflicts.push({ fact: f.id, source: m[0].slice(0, 160), reference: p.correction, status: factStatus(f, now) });
    }
    if (f.kind !== "list" && f.kind !== "pair") continue;
    const topicHit = [...f.aliases.en, ...f.aliases.ar].filter((a) => norm(a).length >= 4).some((a) => ns.includes(norm(a)));
    if (!topicHit) continue;
    if (f.kind === "list") {
      const items = (f.data.items || []).map((it) => ({ name: it.en, ar: it.ar, inSource: [it.en, ...(it.aliases || []), it.ar].some((a) => a && (idx.uni.has(norm(a)) || ns.includes(norm(a)))) }));
      cards.push({ id: f.id, title: f.topic, lines: items.map((i) => i.name + (i.ar ? ` · ${i.ar}` : "")), note: f.data.note || "", notCovered: items.filter((i) => !i.inSource).map((i) => i.name), status: factStatus(f, now), label: statusToLabel(factStatus(f, now)), source: f.source.url, version: f.version });
    } else {
      cards.push({ id: f.id, title: f.topic, lines: [f.data.a, f.data.b], note: "", notCovered: [], status: factStatus(f, now), label: statusToLabel(factStatus(f, now)), source: f.source.url, version: f.version });
    }
    if (cards.length >= max) break;
  }
  return { cards, conflicts };
}

/* is this mnemonic / framework known to the KB? (then it may stay even though the source never mentioned it) */
const WORD_RX = new Map();
const wordRx = (a) => { let r = WORD_RX.get(a); if (r === undefined) { const n = norm(a); r = n.length >= 3 ? new RegExp(`(?<![a-z\\u0621-\\u064A])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z\\u0621-\\u064A])`) : null; WORD_RX.set(a, r); } return r; };
export function knownToKb(sentence, profile) {
  const ns = ` ${norm(sentence)} `;
  return loadedFacts().some((f) => (f.kind === "framework" || f.kind === "mnemonic") && inScope(f, profile) && [...f.aliases.en, ...f.aliases.ar].some((a) => { const r = wordRx(a); return r && r.test(ns); }));
}
export { patientOf };
