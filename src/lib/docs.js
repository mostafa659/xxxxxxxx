/* ───────────── Sources: everything the student can give the app ─────────────
   images (several pages / screenshots) · PDF · Word (.docx) · PowerPoint (.pptx) · Excel (.xlsx) · EPUB books ·
   OpenDocument (.odt .odp .ods) · RTF · HTML · plain text / Markdown / CSV / JSON … · and TEXT TYPED OR PASTED directly.

   A source is a list of ITEMS:
     { id, t:"image", name, size, url }            JPEG data-URL (compressed)
     { id, t:"pdf",   name, size, data }           base64 (Gemini reads PDFs natively)
     { id, t:"text",  name, size, text, label }    text extracted here (Word, slides, books, typed text …)
   makeSource(items) turns them into what the rest of the app already understands:
     { imageUrl, doc }   imageUrl = the first picture, or a small "document tile" drawn on a canvas (preview + thumbnail)
                         doc      = null for a single plain picture, otherwise { kind:"bundle", name, items:[…] } */

import { fileToCompressedDataUrl } from "./image.js";

export const MAX_ITEMS = 12;
export const MAX_PDF = 10 * 1024 * 1024;
export const MAX_TOTAL = 14 * 1024 * 1024;     // all items together (they are sent with every request)
export const MAX_TEXT = 150000;                // characters per text item

const ext = (n) => ((n || "").split(".").pop() || "").toLowerCase();
const mb = (n) => Math.round((n / 1048576) * 10) / 10;
const uid = () => Math.random().toString(36).slice(2, 10);
const TEXT_EXT = ["txt", "text", "md", "markdown", "csv", "tsv", "json", "xml", "yaml", "yml", "log", "srt", "vtt", "tex", "ini", "rst"];

export const isImage = (f) => (f.type || "").startsWith("image/");
export const isPdf = (f) => f.type === "application/pdf" || ext(f.name) === "pdf";

function readAs(file, how) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error("تعذّر قراءة الملف."));
    r[how](file);
  });
}

/* ── minimal ZIP reader (docx / pptx / xlsx / epub / odt are all ZIPs) ── */
async function inflateRaw(u8) {
  if (typeof DecompressionStream === "undefined") throw new Error("الجهاز ده مش بيقدر يفتح الملف ده. صدّره PDF وارفعه.");
  const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function unzip(buf) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf);
  let e = buf.byteLength - 22;
  const lo = Math.max(0, e - 65557);
  while (e >= lo && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < lo) throw new Error("الملف تالف أو مش مضغوط صح.");
  const count = dv.getUint16(e + 10, true);
  let p = dv.getUint32(e + 16, true);
  const dec = new TextDecoder();
  const entries = {};
  for (let i = 0; i < count && dv.getUint32(p, true) === 0x02014b50; i++) {
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    entries[dec.decode(u8.subarray(p + 46, p + 46 + nlen))] = { method: dv.getUint16(p + 10, true), csize: dv.getUint32(p + 20, true), off: dv.getUint32(p + 42, true) };
    p += 46 + nlen + xlen + clen;
  }
  return {
    names: Object.keys(entries),
    async read(name) {
      const en = entries[name];
      if (!en) return null;
      const start = en.off + 30 + dv.getUint16(en.off + 26, true) + dv.getUint16(en.off + 28, true);
      const raw = u8.subarray(start, start + en.csize);
      if (en.method === 0) return raw;
      if (en.method === 8) return inflateRaw(raw);
      throw new Error("طريقة ضغط مش مدعومة.");
    },
    async text(name) { const b = await this.read(name); return b ? dec.decode(b) : null; },
  };
}

/* ── text extraction ── */
const xml = (s) => new DOMParser().parseFromString(s, "application/xml");

function xmlToText(src) {                       // Word <w:p>, PowerPoint <a:p>, OpenDocument <text:p> / <text:h>
  const out = [];
  const walk = (node, acc) => {
    for (const c of node.childNodes) {
      if (c.nodeType === 3) acc.s += c.nodeValue;
      else if (c.nodeType === 1) {
        const n = c.localName;
        if (n === "p" || n === "h") {
          const sub = { s: "" };
          walk(c, sub);
          if (sub.s.trim()) out.push(sub.s.replace(/\s+$/, ""));
        } else if (n === "tab") acc.s += "\t";
        else if (n === "br" || n === "cr" || n === "line-break") acc.s += "\n";
        else if (n === "s") acc.s += " ";
        else if (n !== "instrText" && n !== "delText") walk(c, acc);
      }
    }
  };
  walk(xml(src).documentElement, { s: "" });
  return out.join("\n");
}

function htmlToText(html) {
  const d = new DOMParser().parseFromString(String(html).replace(/<(br|\/p|\/div|\/h[1-6]|\/li|\/tr)\b[^>]*>/gi, "$&\n"), "text/html");
  d.querySelectorAll("script,style,nav,noscript").forEach((n) => n.remove());
  return (d.body ? d.body.textContent : "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function rtfToText(s) {
  return s.replace(/\\par[d]?/g, "\n").replace(/\\'([0-9a-f]{2})/gi, (m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\u(-?\d+)\??/g, (m, n) => String.fromCharCode(+n < 0 ? 65536 + +n : +n))
    .replace(/\{\\\*[^{}]*\}/g, "").replace(/\\[a-z]+-?\d* ?/gi, "").replace(/[{}]/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

const numSort = (a, b) => (+a.match(/(\d+)\.xml$/)?.[1] || 0) - (+b.match(/(\d+)\.xml$/)?.[1] || 0);

async function docxText(z) { return xmlToText((await z.text("word/document.xml")) || ""); }

async function pptxText(z) {
  const slides = z.names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort(numSort);
  const out = [];
  for (let i = 0; i < slides.length; i++) {
    out.push(`--- Slide ${i + 1} ---`, xmlToText(await z.text(slides[i])));
    const note = z.names.find((n) => n === `ppt/notesSlides/notesSlide${(slides[i].match(/(\d+)\.xml$/) || [])[1]}.xml`);
    if (note) { const t = xmlToText(await z.text(note)).trim(); if (t) out.push("Notes: " + t); }
  }
  return out.join("\n");
}

async function xlsxText(z) {
  const shared = [];
  const ss = await z.text("xl/sharedStrings.xml");
  if (ss) for (const si of xml(ss).getElementsByTagName("si")) shared.push([...si.getElementsByTagName("t")].map((t) => t.textContent).join(""));
  const sheets = z.names.filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort(numSort);
  const out = [];
  for (let i = 0; i < sheets.length; i++) {
    out.push(`--- Sheet ${i + 1} ---`);
    let rows = 0;
    for (const row of xml(await z.text(sheets[i])).getElementsByTagName("row")) {
      if (++rows > 3000) break;
      const cells = [...row.getElementsByTagName("c")].map((c) => {
        const v = c.getElementsByTagName("v")[0], is = c.getElementsByTagName("t")[0];
        if (c.getAttribute("t") === "s" && v) return shared[+v.textContent] || "";
        return (v ? v.textContent : is ? is.textContent : "");
      });
      if (cells.some((x) => String(x).trim())) out.push(cells.join(" | "));
    }
  }
  return out.join("\n");
}

async function epubText(z) {
  const container = await z.text("META-INF/container.xml");
  const opfPath = container && xml(container).getElementsByTagName("rootfile")[0]?.getAttribute("full-path");
  if (!opfPath) throw new Error("ملف الـ EPUB مش مفهوم.");
  const dir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";
  const opf = xml(await z.text(opfPath));
  const href = {};
  for (const it of opf.getElementsByTagName("item")) href[it.getAttribute("id")] = it.getAttribute("href");
  const files = [...opf.getElementsByTagName("itemref")].map((r) => href[r.getAttribute("idref")]).filter(Boolean);
  const out = [];
  let total = 0;
  for (const f of files) {
    const path = decodeURIComponent(dir + f);
    const html = await z.text(path);
    if (!html) continue;
    const t = htmlToText(html);
    if (t) { out.push(t); total += t.length; }
    if (total > MAX_TEXT) break;
  }
  return out.join("\n\n");
}

async function extractText(file) {
  const e = ext(file.name);
  if (["docx", "docm", "dotx", "pptx", "pptm", "xlsx", "xlsm", "epub", "odt", "odp", "ods"].includes(e)) {
    const z = await unzip(await readAs(file, "readAsArrayBuffer"));
    if (e.startsWith("doc") || e === "dotx") return { label: "DOCX", text: await docxText(z) };
    if (e.startsWith("ppt")) return { label: "PPTX", text: await pptxText(z) };
    if (e.startsWith("xls")) return { label: "XLSX", text: await xlsxText(z) };
    if (e === "epub") return { label: "EPUB", text: await epubText(z) };
    return { label: e.toUpperCase(), text: xmlToText((await z.text("content.xml")) || "") };
  }
  if (["html", "htm", "xhtml"].includes(e) || file.type === "text/html") return { label: "HTML", text: htmlToText(await readAs(file, "readAsText")) };
  if (e === "rtf") return { label: "RTF", text: rtfToText(await readAs(file, "readAsText")) };
  if (TEXT_EXT.includes(e) || (file.type || "").startsWith("text/") || file.type === "application/json") {
    return { label: e === "md" || e === "markdown" ? "MD" : e === "csv" ? "CSV" : "TXT", text: String(await readAs(file, "readAsText")) };
  }
  if (["doc", "ppt", "xls"].includes(e)) throw new Error("صيغة Office القديمة (." + e + ") مش مدعومة. احفظها " + (e === "doc" ? ".docx" : e === "ppt" ? ".pptx" : ".xlsx") + " أو PDF.");
  if ((file.type || "").startsWith("audio/") || (file.type || "").startsWith("video/")) throw new Error("ملفات الصوت والفيديو مش مدعومة حالياً.");
  // unknown type: accept it only if it really is readable text
  if (file.size <= 3 * 1048576) {
    const t = String(await readAs(file, "readAsText"));
    const bad = (t.slice(0, 4000).match(/[\u0000-\u0008\uFFFD]/g) || []).length;
    if (t.trim() && bad < 8) return { label: "TXT", text: t };
  }
  throw new Error("نوع الملف ده مش مدعوم. ارفع صورة أو PDF أو Word أو PowerPoint أو Excel أو EPUB أو ملف نصي.");
}

const clean = (t) => String(t).replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim();

/* ── one file → one item (throws a readable message) ── */
export async function readItem(file) {
  const id = uid();
  if (isImage(file)) {
    try { return { id, t: "image", name: file.name || "صورة", size: file.size, label: "IMG", url: await fileToCompressedDataUrl(file) }; }
    catch (e) { throw new Error("الصورة دي مش مقروءة (" + (ext(file.name) || "غير معروفة") + "). جرّب JPG أو PNG."); }
  }
  if (isPdf(file)) {
    if (file.size > MAX_PDF) throw new Error(`ملف الـ PDF كبير (${mb(file.size)} ميجا) والحد ${mb(MAX_PDF)} ميجا. قسّمه أو ارفع الصفحات المطلوبة بس.`);
    const data = String(await readAs(file, "readAsDataURL")).split(",")[1] || "";
    if (!data) throw new Error("ملف الـ PDF فاضي أو تالف.");
    return { id, t: "pdf", name: file.name, size: file.size, label: "PDF", data };
  }
  const { label, text } = await extractText(file);
  const t = clean(text);
  if (!t) throw new Error("مفيش نص مقروء جوه الملف ده.");
  return { id, t: "text", name: file.name, size: file.size, label, text: t.slice(0, MAX_TEXT), truncated: t.length > MAX_TEXT };
}

/* ── many files → { items, errors } (a bad file never blocks the good ones) ── */
export async function readFiles(files, current = []) {
  const items = [...current];
  const errors = [];
  for (const f of [...files]) {
    if (items.length >= MAX_ITEMS) { errors.push(`الحد الأقصى ${MAX_ITEMS} ملفات في المرة.`); break; }
    try { items.push(await readItem(f)); } catch (e) { errors.push(`${f.name || "ملف"}: ${e.message}`); }
  }
  const over = totalBytes(items) > MAX_TOTAL;
  if (over) errors.push(`الحجم الكلي كبير (${mb(totalBytes(items))} ميجا) والحد ${mb(MAX_TOTAL)} ميجا. شيل ملف أو اتنين.`);
  return { items: over ? current : items, errors };
}

export const textItem = (text, name = "نص مكتوب") => {
  const t = clean(text);
  return { id: uid(), t: "text", name, size: t.length, label: "TXT", text: t.slice(0, MAX_TEXT), truncated: t.length > MAX_TEXT, typed: true };
};

export function totalBytes(items) {
  return items.reduce((n, i) => n + (i.t === "image" ? i.url.length * 0.75 : i.t === "pdf" ? i.data.length * 0.75 : i.text.length * 2), 0);
}

/* ── the little "document tile" (preview + saved-question thumbnail) ── */
function docThumb(label, name) {
  const W = 720, H = 480;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d");
  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#1CA3BE"); bg.addColorStop(1, "#0E7C8F");
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  g.fillStyle = "#ffffff";
  g.beginPath();
  if (g.roundRect) g.roundRect(W / 2 - 150, 50, 300, 380, 22); else g.rect(W / 2 - 150, 50, 300, 380);
  g.fill();
  g.fillStyle = "#D8EEF2";
  [0, 1, 2, 3, 4].forEach((i) => g.fillRect(W / 2 - 110, 200 + i * 30, i === 4 ? 120 : 220, 12));
  g.textAlign = "center";
  g.fillStyle = "#0E7C8F";
  g.font = `900 ${label.length > 3 ? 62 : 78}px Cairo, 'Segoe UI', Tahoma, sans-serif`;
  g.fillText(label, W / 2, 150);
  g.fillStyle = "#0B2A30";
  g.font = "700 24px Cairo, 'Segoe UI', Tahoma, sans-serif";
  let t = name || "";
  while (t.length > 3 && g.measureText(t).width > 270) t = t.slice(0, -2);
  if (t !== name) t = t.replace(/\s+$/, "") + "…";
  g.fillText(t, W / 2, 396);
  return c.toDataURL("image/jpeg", 0.8);
}

/* items → { imageUrl, doc } */
export function makeSource(items) {
  if (!items.length) return { imageUrl: null, doc: null };
  if (items.length === 1 && items[0].t === "image") return { imageUrl: items[0].url, doc: null };
  const firstImg = items.find((i) => i.t === "image");
  const label = items.length > 1 ? String(items.length) : items[0].label || "TXT";
  const name = items.length === 1 ? items[0].name : `${items.length} ملفات`;
  return {
    imageUrl: firstImg ? firstImg.url : docThumb(label, name),
    doc: { kind: "bundle", name, items: items.map(({ id, ...rest }) => rest) },
  };
}

/* saved record → items (also understands the earlier single-pdf / single-text format) */
export function itemsFromSaved(imageUrl, doc) {
  if (!doc) return imageUrl ? [{ id: uid(), t: "image", name: "صورة", label: "IMG", size: 0, url: imageUrl }] : [];
  if (doc.kind === "bundle") return (doc.items || []).map((i) => ({ ...i, id: uid() }));
  if (doc.kind === "pdf") return [{ id: uid(), t: "pdf", name: doc.name, size: doc.size || 0, label: "PDF", data: doc.data }];
  if (doc.kind === "text") return [{ id: uid(), t: "text", name: doc.name, size: doc.size || 0, label: "TXT", text: doc.text }];
  return [];
}

/* the part(s) of every Gemini request that carry the source */
export function sourceParts(doc, dataUrl) {
  if (!doc) return [{ inlineData: { mimeType: "image/jpeg", data: (dataUrl || "").split(",")[1] } }];
  const items = itemsFromSaved(null, doc);
  const many = items.length > 1;
  return items.flatMap((it, i) => {
    const head = many ? [{ text: `[File ${i + 1} of ${items.length}: ${it.name || ""}]` }] : [];
    if (it.t === "image") return [...head, { inlineData: { mimeType: "image/jpeg", data: it.url.split(",")[1] } }];
    if (it.t === "pdf") return [...head, { inlineData: { mimeType: "application/pdf", data: it.data } }];
    return [{ text: `<document name="${String(it.name || "").replace(/"/g, "'")}">\n${it.text}\n</document>` }];
  });
}

/* prepended to every prompt: the prompts talk about "the image"; this says what the model really received */
export function sourceNote(doc, extra, kind = "question") {
  if (!doc) {
    const f = String(extra || "").trim();
    /* one screenshot picked out of a batch: the pin to ONE question must reach every request (OCR, words, solve, lessons) */
    return f.startsWith("Work ONLY on question") ? `SOURCE NOTE: ${f}\n\n` : "";
  }
  const n = itemsFromSaved(null, doc).length;
  const files = n > 1 ? `${n} files (screenshots, pages, PDFs or text, in the given order)` : "one file (a PDF or a text document)";
  const t = String(extra || "").trim().slice(0, 600);
  if (kind === "lesson") {
    const scope = t
      ? ` SCOPE — OBEY STRICTLY: the student's note says: «${t}». If it limits the material (pages, a page range, chapters, sections, headings, files, images or topics: "pages 20 to 50", "chapter 3 only", "the second file"), study, summarise, explain and list words ONLY from that part and COMPLETELY IGNORE everything else in the files, even if it looks important. Page numbers mean the page numbers printed on the pages when visible, otherwise the order of the pages in the file. If the note is only a style request (e.g. "focus on drugs"), use the whole material and follow the request.`
      : "";
    return `SOURCE NOTE: the study material is ${files}, not a single screenshot. Treat everything given as ONE body of study material, in order. Wherever the instructions say "image" or "screenshot", read it as this material.${scope}\n\n`;
  }
  const pick = t
    ? `The student's note (it may name the question number or page to use) is: «${t}». Follow it if it points to a question; otherwise use the first complete question.`
    : "Use the first complete question.";
  return `SOURCE NOTE: the question comes from ${files} instead of one screenshot. Wherever the instructions say "image", "screenshot" or "photo", read it as these files. If several files are pages / tabs / exhibits of the SAME question or case study, combine them into that one question. The files may also contain several different questions, cover pages, rationales or answer keys: work on exactly ONE question and never mix questions. ${pick}\n\n`;
}
