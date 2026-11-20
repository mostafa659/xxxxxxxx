/* ───────────── lib/provenance.js · where every word of the source came from (v3.43) ─────────────
   ONE source model for EVERY kind of source — typed text, Word / PowerPoint / Excel / EPUB, audio transcripts, PDFs, screenshots. Attached at EXTRACTION time:
     sourceType   'text' | 'audio' | 'pdf' | 'image'
     page         PDF page (1-based) · block = paragraph inside it · index = running segment number over the whole source
     sentences    normalised sentence boundaries (cleanResidue, then the same splitter the accuracy layer uses on the output)
   The Part A pipeline (origin by overlap, analogy / mnemonic / framework stripping, KB conflicts, reference cards) reads ONLY this model, so a PDF or a screenshot
   goes through exactly the code a pasted text goes through. Where a PDF or image has NO readable text (scanned, or an image before its OCR arrived) the model is
   `strict`: origin stays UNKNOWN (never "source"), so invented mnemonics / frameworks are removed and nothing is memorize-eligible without a ✓. There is no bypass. */
import { cleanResidue, splitText, indexSource, tokens, anchorsOf } from "./accuracy.js";

/* light stemming for grounding only: absorbs = absorb, nodes = node (anchors on both sides go through the same function) */
const stem = (w) => (w.length > 4 && w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us") && !w.endsWith("is") ? w.slice(0, -1) : w);
const anchorsStem = (toks) => anchorsOf(toks).map(stem);

export const SOURCE_TYPES = ["text", "audio", "pdf", "image", "lesson"];

/* text → [{ text, start, end }] — sentence boundaries by the accuracy layer's own splitter */
export function sentencesOf(text) {
  const out = [];
  let off = 0;
  for (const L of splitText(text)) {
    let at = off + L.prefix.length;
    for (const s of L.sentences) {
      const i = text.indexOf(s, at);
      const start = i < 0 ? at : i;
      out.push({ text: s, start, end: start + s.length });
      at = start + s.length;
    }
    off += L.raw.length + 1;
  }
  return out;
}

/* paragraphs (blank-line separated; very long ones cut at ~900 chars on a sentence end) */
function blocksOf(text) {
  const blocks = [];
  for (const para of String(text).split(/\n\s*\n+/)) {
    const t = para.trim();
    if (!t) continue;
    if (t.length <= 1200) { blocks.push(t); continue; }
    let cur = "";
    for (const s of sentencesOf(t).map((x) => x.text)) { if (cur.length + s.length > 900 && cur) { blocks.push(cur); cur = ""; } cur += (cur ? " " : "") + s; }
    if (cur) blocks.push(cur);
  }
  return blocks;
}

/* → segments [{ sourceType, itemId, name, page, block, index, text, sentences }] */
export function segmentsFromText(text, { sourceType = "text", itemId = "", name = "", page = 0, startIndex = 0 } = {}) {
  const clean = cleanResidue(text);
  return blocksOf(clean).map((t, i) => ({ sourceType, itemId, name, page, block: i + 1, index: startIndex + i, text: t, sentences: sentencesOf(t) }));
}

/* the extraction attached to ONE item at the moment it is read (docs.js calls this): { sourceType, extracted, pages, chars, confidence, reason } + the text */
export function provenanceOf(item, extraction) {
  const sourceType = item.t === "pdf" ? "pdf" : item.t === "image" ? "image" : item.audio ? "audio" : "text";
  if (item.t === "pdf") {
    const ex = extraction || {};
    return { sourceType, extracted: !!ex.ok, pages: (ex.pages || []).length, chars: (ex.text || "").length, confidence: ex.confidence || 0, reason: ex.reason || (ex.ok ? "" : "no-text-layer") };
  }
  if (item.t === "image") return { sourceType, extracted: false, pages: 0, chars: 0, confidence: 0, reason: "needs-ocr" };
  return { sourceType, extracted: true, pages: 0, chars: (item.text || "").length, confidence: 1, reason: "" };
}

/* items (+ the text the extraction STAGE produced for images / unreadable PDFs) → the source model */
export function buildSourceModel({ items = [], extractions = [] } = {}) {
  const segments = [];
  let missing = [];
  let idx = 0;
  const push = (segs) => { for (const s of segs) { s.index = idx++; segments.push(s); } };
  for (const it of items) {
    if (it.t === "text") push(segmentsFromText(it.text || "", { sourceType: it.lesson ? "lesson" : it.audio ? "audio" : "text", itemId: it.id || "", name: it.name || "" }));
    else if (it.t === "pdf") {
      if (it.ptext && it.prov && it.prov.extracted) {
        const pages = Array.isArray(it.ppages) && it.ppages.length ? it.ppages : [{ index: 1, text: it.ptext }];
        for (const pg of pages) push(segmentsFromText(pg.text || "", { sourceType: "pdf", itemId: it.id || "", name: it.name || "", page: pg.index }));
      } else missing.push({ itemId: it.id || "", name: it.name || "", sourceType: "pdf", reason: (it.prov && it.prov.reason) || "no-text-layer" });
    } else if (it.t === "image") missing.push({ itemId: it.id || "", name: it.name || "", sourceType: "image", reason: "needs-ocr" });
  }
  /* the extraction stage (OCR of a screenshot, the model's reading of a scanned PDF) fills what the device could not read */
  const stageType = missing.some((m) => m.sourceType === "pdf") && !missing.some((m) => m.sourceType === "image") ? "pdf" : "image";
  /* the stage text is MODEL-written: it is used ONLY to fill a gap, never added next to real source text (a hallucinated line in a map must not become "source") */
  for (const ex of extractions) {
    if (!missing.length) break;
    const t = cleanResidue(ex.text || "");
    if (!t.trim()) continue;
    const segs = segmentsFromText(t, { sourceType: ex.sourceType || stageType, name: ex.name || "extraction" });
    if (!ex.complete) for (const g of segs) g.partial = true;        // model-written map / brief: usable as a stand-in index, NEVER as something a claim can be grounded in
    push(segs);
    ex.used = true;
    if (ex.complete) missing = [];            // a full transcript (the OCR of a question) is the source text of those files; a short MAP of a study file is only a partial stand-in: strict stays
  }
  const filled = extractions.some((e) => e.used);
  const text = segments.map((s) => s.text).join("\n\n");
  const types = [...new Set(segments.map((s) => s.sourceType))];
  /* strict = some PDF / image has no text of its own, and what the stage read is only a partial stand-in (or nothing) */
  const stillMissing = missing.length > 0;
  return {
    segments, text, types, missing: stillMissing ? missing : [], strict: stillMissing || !text.trim(), stageFilled: filled,
    summary: { types, segments: segments.length, chars: text.length, missing: missing.map((m) => `${m.sourceType}:${m.reason}`), strict: stillMissing || !text.trim() },
  };
}

/* which segment does a sentence come from? (best anchor-word overlap; null when nothing matches) */
export function locate(model, sentence) {
  if (!model || !model.segments.length) return null;
  const toks = tokens(sentence).filter((w) => w.length >= 4 || /^[0-9]/.test(w));
  if (toks.length < 2) return null;
  let best = null, bestN = 0;
  for (const seg of model.segments) {
    if (!seg._uni) Object.defineProperty(seg, "_uni", { value: indexSource(seg.text).uni, enumerable: false });
    let n = 0;
    for (const w of toks) if (seg._uni.has(w)) n++;
    if (n > bestN) { bestN = n; best = seg; }
  }
  if (!best || bestN < Math.max(2, Math.ceil(toks.length * 0.5))) return null;
  return { sourceType: best.sourceType, page: best.page || undefined, block: best.block, index: best.index, name: best.name };
}

/* ───────────── citation-first grounding (v3.44) ─────────────
   groundSentence(model, claim) → { state: "grounded" | "contradiction" | "none", prov, source, why }
   A claim is GROUNDED when one source sentence (or two adjacent ones) contains ≥ 75 % of its anchor words AND passes three guards:
     numbers     every number in the claim is in that source sentence          (else: a CONTRADICTION when the overlap is otherwise high)
     polarity    the claim and the source sentence agree on negation            (else: a CONTRADICTION)
     acronyms    every ALL-CAPS token of the claim is in the source sentence    (else: not grounded: the acronym is the invention)
   Model-written extraction text (partial segments) is never searched. Built once per model (inverted index word → sentence ids). */
const NEGW = new Set(["not", "no", "never", "cannot", "without", "none", "neither", "nor", "isnt", "arent", "dont", "doesnt", "wont", "cant", "shouldnt", "wasnt", "werent", "hasnt", "havent", "didnt", "لا", "مش", "ليس", "غير", "مفيش", "بدون"]);
const numsOf = (s) => new Set((String(s).match(/\d+(?:[.,]\d+)?/g) || []).map((x) => parseFloat(x.replace(",", "."))));
const capsOf = (s) => (String(s).match(/\b[A-Z]{2,}\b/g) || []).map((x) => x.toLowerCase());
const hasNeg = (toks) => toks.some((w) => NEGW.has(w));          // an explicit list: «nutrient», «patient», «present» end in -nt and are not negations

function sentenceIndex(model) {
  if (model._si) return model._si;
  const sents = [], inv = new Map(), seen = new Set();
  const add = (text, seg) => {
    if (seen.has(text)) return;                                   // a sentence repeated in the source is indexed once
    seen.add(text);
    const toks = tokens(text), anc = anchorsStem(toks);
    if (anc.length < 2) return;
    const id = sents.length;
    sents.push({ text, seg, uni: new Set(toks.map(stem)), anc: new Set(anc), nums: numsOf(text), neg: hasNeg(toks) });
    for (const w of new Set(anc)) { let a = inv.get(w); if (!a) inv.set(w, (a = [])); a.push(id); }
  };
  for (const seg of model.segments) {
    if (seg.partial) continue;
    const ss = seg.sentences.map((x) => x.text);
    ss.forEach((t, i) => { add(t, seg); if (i + 1 < ss.length) add(`${t} ${ss[i + 1]}`, seg); });
  }
  Object.defineProperty(model, "_si", { value: { sents, inv }, enumerable: false });
  return model._si;
}

export function groundSentence(model, claim, { minCover = 0.75 } = {}) {
  const none = { state: "none" };
  if (!model || !model.segments || !model.segments.length) return none;
  if (!model._gc) Object.defineProperty(model, "_gc", { value: new Map(), enumerable: false });
  const ck = `${minCover}|${claim}`;
  if (model._gc.has(ck)) return model._gc.get(ck);                 // the same claim is judged once
  const out = groundUncached(model, claim, minCover);
  model._gc.set(ck, out);
  return out;
}

function groundUncached(model, claim, minCover) {
  const none = { state: "none" };
  const ctoks = tokens(claim), anc = [...new Set(anchorsStem(ctoks))];
  if (anc.length < 3) return none;
  const { sents, inv } = sentenceIndex(model);
  const count = new Map();
  for (const w of anc) { const ids = inv.get(w) || []; if (ids.length > 400) continue; for (const id of ids) count.set(id, (count.get(id) || 0) + 1); }     // a word in > 400 sentences carries no information
  const need = Math.max(2, Math.ceil(anc.length * 0.6));
  let best = null, bestScore = 0;
  for (const [id, n] of count) {
    if (n < need) continue;
    const sc = n / anc.length;
    if (sc > bestScore || (sc === bestScore && best && sents[id].text.length < best.text.length)) { bestScore = sc; best = sents[id]; }
  }
  if (!best || bestScore < minCover) return none;
  const prov = { sourceType: best.seg.sourceType, page: best.seg.page || undefined, block: best.seg.block, index: best.seg.index, name: best.seg.name };
  const base = { prov, source: best.text.slice(0, 220), score: Math.round(bestScore * 100) / 100 };
  for (const c of capsOf(claim)) if (!best.uni.has(stem(c))) return none;                     // the acronym IS the claim
  const cn = numsOf(claim);
  for (const x of cn) if (!best.nums.has(x)) return { state: "contradiction", why: "number", ...base };
  if (hasNeg(ctoks) !== best.neg) return { state: "contradiction", why: "polarity", ...base };
  return { state: "grounded", ...base };
}

/* the label the student sees for a location: «p. 3» / «page 3 · notes.pdf» … */
export function provLabel(prov, lang = "ar") {
  if (!prov) return "";
  const where = prov.page ? (lang === "en" ? `p. ${prov.page}` : `ص ${prov.page}`) : prov.block ? (lang === "en" ? `section ${prov.block}` : `فقرة ${prov.block}`) : "";
  const kind = { pdf: lang === "en" ? "your PDF" : "الـ PDF بتاعك", image: lang === "en" ? "your image" : "صورتك", audio: lang === "en" ? "your recording" : "تسجيلك", lesson: lang === "en" ? "your saved lesson" : "درسك المحفوظ", text: lang === "en" ? "your notes" : "ملاحظاتك" }[prov.sourceType] || (lang === "en" ? "your source" : "مصدرك");
  return `${kind}${where ? " · " + where : ""}`;
}
