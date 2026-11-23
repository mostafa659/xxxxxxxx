/* ───────────── lib/trust.js · the one entry point (v3.43) ─────────────
   verifyText(): F1 (deterministic layer) + F2 (KB check) on any AI text, Part A or Part B. Synchronous, zero network; the KB modules must already be loaded
   (ensureKb() is called when the profile is known, off the critical path). Returns everything the UI needs, including the stats the acceptance test prints. */
import { analyze, render, HIGH_RISK, indexSource } from "./accuracy.js";
import { buildSourceModel, locate, groundSentence } from "./provenance.js";
import { loadKb, kbReady } from "./kb/index.js";
import { checkItems, referenceCards, knownToKb } from "./kb/check.js";

/* loads the modules for the profile, then runs one throw-away pass so every regex is compiled BEFORE the first real result (off the critical path) */
export const ensureKb = (profile) => loadKb(profile).then((f) => {
  try { verifyText({ text: "- The liver makes bile. The stomach has 4 regions. Give 5 mg every 8 hours. Hemoglobin 12 g/dL is normal for a man. Delegate it to the UAP.", source: "warm up", profile, part: "A" }); } catch (e) { /* ignore */ }
  return f;
});

/* `sourceModel` (lib/provenance.js) is the ONE way a source reaches this pass, whatever it was: typed text, Word, audio, a PDF's text layer, an OCR transcript.
   `source` (a plain string) is still accepted and wrapped the same way. */
export function verifyText({ text, source = "", sourceModel = null, profile, part = "A", titles, patient, now = Date.now(), brief = "" } = {}) {
  const model = sourceModel || buildSourceModel({ items: source && source.trim() ? [{ t: "text", name: "source", text: source }] : [] });
  const clean = model.text;
  const idxText = part === "B" ? clean + "\n" + (brief || "") : clean;
  const res = analyze(text, { index: idxText.trim() ? indexSource(idxText) : null, part, titles, known: (s) => knownToKb(s, profile), locate: model.segments.length ? (s) => locate(model, s) : null });
  const { patches, gaps } = checkItems(res.items, { profile, now, patient, ground: part === "A" ? (c) => groundSentence(model, c) : null });
  /* the SOURCE itself against the KB, for every source type and both parts: "source says X, reference says Y" (the source is never silently rewritten) */
  const ref = referenceCards(clean, { profile, now });
  if (part === "B") ref.cards = [];
  const text2 = render(res);
  return { ...res, text: text2, patches, gaps, cards: ref.cards, conflicts: ref.conflicts, provenance: { ...model.summary, located: res.items.filter((i) => i.prov).length }, stats: stats(res, patches, gaps, ref) };
}

/* the numbers shown in the footer and printed by the acceptance test */
export function stats(res, patches, gaps, ref) {
  const hi = res.items.filter((i) => HIGH_RISK.has(i.kind));
  const by = (l) => res.items.filter((i) => i.label === l).length;
  const resolvedByKb = hi.filter((i) => ["verified", "corrected", "outdated", "reference", "scope", "conflict"].includes(i.label)).length;
  const groundedN = hi.filter((i) => i.label === "grounded").length;
  const labeledOnly = hi.filter((i) => ["unverified", "uncertain"].includes(i.label)).length;
  const unlabeled = hi.filter((i) => i.label === "plain" || !i.label).length;           // must be 0
  const pct = (n) => (hi.length ? Math.round((n / hi.length) * 1000) / 10 : 0);
  return {
    sentences: res.items.length, highRisk: hi.length,
    verified: by("verified"), grounded: by("grounded"), reference: by("reference"), corrected: by("corrected"), conflict: by("conflict"), outdated: by("outdated"), scope: by("scope"), unverified: by("unverified") + by("uncertain"),
    analogies: res.analogies.length, stripped: res.stripped.length, memoAids: res.memoAids.length, patches: patches.length, gaps: gaps.length,
    cards: ref.cards.length, conflicts: ref.conflicts.length,
    pctResolvedByKb: pct(resolvedByKb), pctGrounded: pct(groundedN), pctLabeledOnly: pct(labeledOnly), pctUnlabeled: pct(unlabeled), unlabeledHighRisk: unlabeled,
    memorizable: res.items.filter((i) => i.memorize).length,
  };
}

/* the sentences the student may save to "memorize" (✓ or plain source text only) */
export const memorizable = (res) => res.items.filter((i) => i.memorize).map((i) => (i.text != null ? i.text : i.sentence));

export { kbReady };
