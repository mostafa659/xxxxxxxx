/* v3.43.1 · Part A for PDFs and images: the SAME pipeline as for typed text. Real PDFs (made with reportlab / LibreOffice / qpdf; see tests/fixtures), the source model,
   provenance metadata attached at extraction time, equivalence across source types, and an end-to-end run of createAnalysis on a PDF and on a scanned PDF. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { extractPdfText, parseCMap, fixArabicOrder } from "../src/lib/pdftext.js";
import { buildSourceModel, segmentsFromText, sentencesOf, locate, provenanceOf } from "../src/lib/provenance.js";
import { readItem } from "../src/lib/docs.js";
import * as T from "../src/lib/trust.js";
import * as KB from "../src/lib/kb/index.js";
import { installFetch, script, reset, log } from "./mockfetch.mjs";
import * as R from "../src/lib/router.js";
import { setExtKeys, setEnginePrefs } from "../src/lib/providers.js";
import { createAnalysis } from "../src/lib/analysis.js";
import { getModelLists } from "../src/lib/gemini.js";

globalThis.FileReader ??= class {
  async _go(f, mode) { const buf = Buffer.from(await f.arrayBuffer()); this.result = mode === "url" ? `data:${f.type || "application/octet-stream"};base64,${buf.toString("base64")}` : mode === "text" ? buf.toString("utf8") : buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length); this.onload && this.onload(); }
  readAsDataURL(f) { this._go(f, "url"); } readAsText(f) { this._go(f, "text"); } readAsArrayBuffer(f) { this._go(f, "buf"); }
};
const fx = (n) => new Uint8Array(fs.readFileSync(new URL(`./fixtures/${n}.pdf`, import.meta.url)));
const GEN = { discipline: "general", exam: "", region: "" };
await KB.loadKb(GEN);
const words = (t) => new Set(t.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2));
const NOTES = ["digestive", "liver", "bile", "gallbladder", "stomach", "cardia", "fundus", "pylorus", "mnemonic", "cfbp", "hemoglobin"];

test("pdftext reads real PDFs: ASCII85+Flate streams, embedded TrueType (ToUnicode), compressed object streams — page by page", async () => {
  for (const n of ["text-helvetica", "text-ttf", "text-objstm"]) {
    const r = await extractPdfText(fx(n));
    assert.equal(r.ok, true, `${n}: ${r.reason}`);
    const w = words(r.text);
    for (const k of NOTES) assert.ok(w.has(k), `${n}: "${k}" missing`);
    assert.match(r.text, /Hemoglobin 13\.5 to 17\.5 g\/dL in adult men\./);
  }
  const two = await extractPdfText(fx("text-helvetica"));
  assert.equal(two.pages.length, 2);
  assert.match(two.pages[1].text, /^Page two: the small intestine/);
  assert.match((await extractPdfText(fx("text-ttf"))).text, /Naïve café – “quoted” text with symbols: ≥ 5 mg\/kg/, "ToUnicode maps non-ASCII glyphs");
});

test("pdftext reads Arabic from a LibreOffice PDF (visual order → logical order, word gaps kept), also from compressed object streams", async () => {
  for (const n of ["lo", "lo-objstm"]) {
    const r = await extractPdfText(fx(n));
    assert.equal(r.ok, true, n);
    assert.match(r.text, /الكبد بتصنع الصفراء والمرارة بتخزنها/, `${n}: ${r.text}`);
    assert.match(r.text, /The stomach has four regions: cardia, fundus, body and pylorus\./);
  }
  assert.equal(fixArabicOrder("hello world"), "hello world", "Latin text is never touched");
  assert.equal(fixArabicOrder("الكبد بتصنع الصفراء والمرارة"), "الكبد بتصنع الصفراء والمرارة", "logical order stays logical");
});

test("pdftext is honest about what it cannot read: scanned pages, junk, truncated files", async () => {
  const sc = await extractPdfText(fx("scanned"));
  assert.equal(sc.ok, false); assert.equal(sc.reason, "no-text-layer"); assert.equal(sc.text, "");
  assert.equal((await extractPdfText(new Uint8Array([1, 2, 3]))).reason, "not-a-pdf");
  const cut = fx("text-helvetica").slice(0, 400);
  assert.equal((await extractPdfText(cut)).ok, false);
  const m = parseCMap("1 begincodespacerange <0000> <FFFF> endcodespacerange 2 beginbfchar <0003> <0041> <0004> <00620063> endbfchar 1 beginbfrange <0010> <0012> <0061> endbfrange");
  assert.equal(m.bytes, 2); assert.equal(m.map.get(3), "A"); assert.equal(m.map.get(4), "bc"); assert.equal(m.map.get(0x11), "b");
});

test("provenance is attached AT EXTRACTION: readItem tags every source type; a PDF carries its text layer and page list; a scanned one is marked unread", async () => {
  const pdf = await readItem(new File([fx("text-objstm")], "notes.pdf", { type: "application/pdf" }));
  assert.equal(pdf.prov.sourceType, "pdf"); assert.equal(pdf.prov.extracted, true); assert.equal(pdf.prov.pages, 2);
  assert.ok(pdf.ptext.includes("terminal ileum")); assert.deepEqual(pdf.ppages.map((p) => p.index), [1, 2]);
  const scan = await readItem(new File([fx("scanned")], "scan.pdf", { type: "application/pdf" }));
  assert.equal(scan.prov.extracted, false); assert.equal(scan.prov.reason, "no-text-layer"); assert.equal(scan.ptext, undefined);
  const txt = await readItem(new File(["The liver makes bile. The gallbladder stores it for later use."], "a.txt", { type: "text/plain" }));
  assert.equal(txt.prov.sourceType, "text"); assert.equal(txt.prov.extracted, true);
  assert.equal(provenanceOf({ t: "image" }).reason, "needs-ocr");
  assert.equal(provenanceOf({ t: "text", audio: true, text: "x" }).sourceType, "audio");
});

test("the source model: pages and blocks are numbered, sentence boundaries are normalised, and missing text makes it STRICT", async () => {
  const pdf = await readItem(new File([fx("text-helvetica")], "n.pdf", { type: "application/pdf" }));
  const m = buildSourceModel({ items: [pdf] });
  assert.equal(m.strict, false); assert.deepEqual(m.types, ["pdf"]);
  assert.deepEqual([...new Set(m.segments.map((s) => s.page))], [1, 2]);
  assert.ok(m.segments.every((s, i) => s.index === i && s.sentences.length >= 1 && s.sourceType === "pdf"));
  const pv = locate(m, "Vitamin B12 is absorbed in the terminal ileum.");
  assert.equal(pv.sourceType, "pdf"); assert.equal(pv.page, 2);
  const ss = sentencesOf("The liver makes bile. The gallbladder stores it.");
  assert.deepEqual(ss.map((x) => x.text), ["The liver makes bile.", "The gallbladder stores it."]); assert.equal(ss[1].start, 22); assert.equal(ss[0].end, 21);
  assert.equal(buildSourceModel({ items: [{ t: "pdf", name: "s.pdf", prov: { extracted: false, reason: "no-text-layer" } }] }).strict, true);
  assert.equal(buildSourceModel({ items: [{ t: "image", name: "i" }] }).strict, true);
  assert.equal(buildSourceModel({ items: [{ t: "image", name: "i" }], extractions: [{ sourceType: "image", text: "The stomach has four regions. Cardia, fundus, body.", complete: true }] }).strict, false, "a full OCR transcript is the image's source text");
  const partial = buildSourceModel({ items: [{ t: "image", name: "i" }], extractions: [{ sourceType: "image", text: "short map of the file", complete: false }] });
  assert.equal(partial.strict, true, "a short map is only a partial stand-in"); assert.ok(partial.segments.length >= 1);
});

/* ───── the SAME pipeline, whatever the source ───── */
const SOURCE = "Digestive system lecture notes\nThe liver makes bile and the gallbladder stores and concentrates it.\nThe stomach has four regions: cardia, fundus, body and pylorus.\nRemember it with the mnemonic CFBP for every region.\nThe duodenum absorbs iron and calcium.";
const LESSON = `## 📚 الأساس
- The gallbladder secretes bile into the duodenum.
- Remember it with the mnemonic CFBP for every region.
- Use the 5-step framework A → B → C → D → E to solve every digestion question.
- Think of the stomach like a blender.
- The large intestine has 7 parts.
- المعدة بتهضم الأكل 1× وبعدين تفرغ
- The stomach has four regions: cardia, fundus, body and pylorus.`;
const run = (model) => T.verifyText({ text: LESSON, sourceModel: model, profile: GEN, part: "A" });
const sig = (r) => ({ text: r.text, labels: r.items.map((i) => `${i.kind}:${i.label}`), analogies: r.analogies.length, stripped: r.stripped.map((s) => s.kind), patches: r.patches.map((p) => p.fact) });

test("typed text, a PDF text layer and an OCR transcript give IDENTICAL cleanup, stripping and seeded-error patches", async () => {
  const asText = buildSourceModel({ items: [{ t: "text", id: "a", name: "n.txt", text: SOURCE }] });
  const asPdf = buildSourceModel({ items: [{ t: "pdf", id: "b", name: "n.pdf", ptext: SOURCE, ppages: [{ index: 1, text: SOURCE }], prov: { extracted: true } }] });
  const asImage = buildSourceModel({ items: [{ t: "image", id: "c", name: "i" }], extractions: [{ sourceType: "image", text: SOURCE, complete: true }] });
  const a = sig(run(asText)), b = sig(run(asPdf)), c = sig(run(asImage));
  assert.deepEqual(b, a, "PDF ≠ text"); assert.deepEqual(c, a, "image ≠ text");
  assert.ok(!a.text.includes("1×")); assert.ok(a.text.includes("The liver makes bile; the gallbladder stores and concentrates it"));   // the gallbladder line was patched with the KB statement
  assert.deepEqual(a.stripped, ["framework"], "the invented framework goes; the mnemonic CFBP IS in the source, so it stays");
  assert.equal(a.analogies, 1);
  assert.ok(a.patches.includes("dig.bile") && a.patches.includes("dig.large-intestine.parts"));
  assert.equal(run(asPdf).provenance.located > 0, true, "items know their page / block");
  assert.equal(run(asPdf).items.find((i) => /four regions/.test(i.sentence)).prov.sourceType, "pdf");
});

test("a scanned PDF / an unread image is STRICT: origin is unknown, so the invented mnemonic and framework are removed — never waved through", () => {
  for (const model of [buildSourceModel({ items: [{ t: "pdf", name: "s.pdf", prov: { extracted: false, reason: "no-text-layer" } }] }), buildSourceModel({ items: [{ t: "image", name: "i" }] })]) {
    const r = run(model);
    assert.equal(model.strict, true);
    assert.deepEqual(r.stripped.map((s) => s.kind).sort(), ["framework", "mnemonic"], "nothing passes through just because the source text is unknown");
    assert.equal(r.analogies.length, 1);
    assert.ok(r.items.some((i) => i.label === "corrected" && i.fact === "dig.bile"), "KB patches work without a source text");
    assert.ok(!r.text.includes("1×"));
    assert.ok(r.items.every((i) => i.origin !== "source"), "never labelled as coming from the source");
    assert.ok(r.items.every((i) => !i.memorize), "and never memorize-eligible without a ✓");
    assert.equal(r.stats.unlabeledHighRisk, 0);
  }
  /* the old code path: plain empty source string */
  const r = T.verifyText({ text: LESSON, source: "", profile: GEN, part: "A" });
  assert.equal(r.stripped.length, 2);
});

test("every seeded error is handled identically whether the source was text, a PDF or an image", async () => {
  const seeded = JSON.parse(fs.readFileSync(new URL("./golden/accuracy/seeded.json", import.meta.url), "utf8"));
  for (const c of seeded.filter((x) => !x.profile)) {
    const models = [buildSourceModel({ items: [{ t: "text", name: "t", text: c.source }] }),
      buildSourceModel({ items: [{ t: "pdf", name: "p", ptext: c.source, ppages: [{ index: 1, text: c.source }], prov: { extracted: true } }] }),
      buildSourceModel({ items: [{ t: "image", name: "i" }], extractions: [{ sourceType: "image", text: c.source, complete: true }] })];
    const outs = models.map((m) => T.verifyText({ text: c.text, sourceModel: m, profile: GEN, part: "A" }));
    assert.deepEqual(outs.map((o) => o.text), [outs[0].text, outs[0].text, outs[0].text], `${c.id}: text differs by source type`);
    assert.deepEqual(outs.map((o) => o.stats.unlabeledHighRisk), [0, 0, 0], c.id);
    if (c.expect === "corrected") for (const o of outs) assert.ok(o.text.includes(c.mustContain), c.id);
  }
});

test("the source itself is checked against the KB for every source type: «source says X, reference says Y»", async () => {
  const bad = "The large intestine has 7 parts. The liver makes bile.";
  for (const model of [buildSourceModel({ items: [{ t: "text", name: "t", text: bad }] }), buildSourceModel({ items: [{ t: "pdf", name: "p", ptext: bad, ppages: [{ index: 1, text: bad }], prov: { extracted: true } }] }), buildSourceModel({ items: [{ t: "image", name: "i" }], extractions: [{ sourceType: "image", text: bad, complete: true }] })]) {
    const r = T.verifyText({ text: "- The liver makes bile.", sourceModel: model, profile: GEN, part: "A" });
    assert.ok(r.conflicts.some((c) => /4 parts/.test(c.reference) && /7 parts/.test(c.source)));
  }
});

/* ───── end to end: createAnalysis on a lesson from a PDF ───── */
installFetch();
let KEY = "AIzaPRV", seq = 0;
const G = (m) => `gemini:${m}`;
const fresh = () => { KEY = `AIzaPRV${String(++seq).padStart(8, "0")}`; reset(); R.__resetRouter(); window.localStorage.clear(); setExtKeys({}); setEnginePrefs({ mode: "auto" }); };
const MODEL_OUT = `## 📚 الأساس
- The gallbladder secretes bile into the duodenum.
- Remember it with the mnemonic QQZZ for every region.
- Use the 5-step framework A → B → C → D → E to solve every digestion question.
- المعدة بتهضم الأكل 1× وبعدين تفرغ في الأمعاء الدقيقة عشان الامتصاص يبدأ
- ==🔗 مرتبط بسؤال «Digoxin tox…==`;
const MAP_OUT = "## 🗺️ الخريطة\n- **Digestive system** — 1× notes about the liver and the stomach\n- ==🔗 مرتبط بسؤال «Digoxin tox…==";
async function lessonOn(items) {
  fresh();
  const answer = (body) => (/short map of the material|study-material analyst/.test(JSON.stringify(body.systemInstruction || "")) && /under 170 words/.test(JSON.stringify(body.systemInstruction || "")) ? MAP_OUT : MODEL_OUT);
  for (const m of getModelLists(KEY).fast.concat(getModelLists(KEY).pro)) script(G(m), { ok: answer });
  const doc = { kind: "bundle", name: "n", items: items.map(({ id, ...rest }) => rest) };
  const out = { updates: [], trust: [] };
  await new Promise((resolve) => {
    const a = createAnalysis({ kind: "lesson", history: [], dataUrl: null, doc, extra: "", chips: [], apiKey: KEY, modeId: "balanced",
      onUpdate: (name, data, meta) => out.updates.push([name, data, meta]), onDone: (name) => { out[name] = true; if (out.reason) resolve(a); }, onError: (n, e) => { out.err = [n, e && e.message]; resolve(a); }, onNotice() {}, onTrust: (t) => out.trust.push(t) });
    a.start();
  });
  return out;
}
const finalReason = (o) => [...o.updates].reverse().find((u) => u[0] === "reason" && u[2] && u[2].final);

test("END TO END · a lesson from a PDF with a text layer: the output is cleaned, stripped, patched and labeled; no extra request", async () => {
  const pdf = await readItem(new File([fx("text-helvetica")], "notes.pdf", { type: "application/pdf" }));
  const o = await lessonOn([pdf]);
  assert.equal(o.err, undefined);
  const fin = finalReason(o);
  assert.ok(fin, "a final reason update arrived");
  const text = fin[1].explanation;
  assert.ok(!text.includes("1×")); assert.ok(!text.includes("Digoxin")); assert.ok(!/QQZZ/.test(text)); assert.ok(!/5-step framework/.test(text));
  assert.match(text, /The liver makes bile; the gallbladder stores and concentrates it/);
  const t = o.trust.find((x) => x.phase === "final");
  assert.ok(t, "trust arrived"); assert.equal(t.stats.unlabeledHighRisk, 0);
  assert.ok(t.stripped.length >= 2); assert.ok(t.patches.some((p) => p.fact === "dig.bile"));
});

test("END TO END · a lesson from a SCANNED PDF goes through the same pipeline in strict mode", async () => {
  const scan = await readItem(new File([fx("scanned")], "scan.pdf", { type: "application/pdf" }));
  const o = await lessonOn([scan]);
  assert.equal(o.err, undefined);
  const text = finalReason(o)[1].explanation;
  assert.ok(!text.includes("1×")); assert.ok(!/QQZZ/.test(text)); assert.ok(!/5-step framework/.test(text));
  assert.match(text, /The liver makes bile; the gallbladder stores/);
  const t = o.trust.find((x) => x.phase === "final");
  assert.equal(t.stats.unlabeledHighRisk, 0); assert.ok(t.stripped.length >= 2);
});

test("END TO END · the extraction stage output (the text shown from an image / the map of a file) is cleaned like every other text", async () => {
  const img = { t: "image", name: "p.jpg", url: "data:image/jpeg;base64,/9j/4AAQ", prov: { sourceType: "image", extracted: false, reason: "needs-ocr" } };
  const o = await lessonOn([img]);
  const ocr = [...o.updates].reverse().find((u) => u[0] === "ocr");
  assert.ok(ocr, "the extraction stage ran for this source");
  assert.ok(!ocr[1].original_question_text.includes("1×"), "residue is removed from extracted text too");
  assert.ok(!ocr[1].original_question_text.includes("Digoxin"));
});
