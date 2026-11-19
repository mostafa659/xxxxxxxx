/* ───────────── lib/pdftext.js · the text layer of a PDF, read ON THE DEVICE (v3.43) ─────────────
   Zero network, zero tokens. Gemini still receives the PDF natively; this only gives CODE a copy of what the PDF says, page by page, so that the Part A
   accuracy layer (origin by overlap, analogy / mnemonic / framework stripping, KB conflicts) works for PDFs exactly as it does for pasted text.
   What it reads:  Flate streams · classic objects and /ObjStm object streams · the page tree (order, inherited /Resources) · text operators
                   (BT/ET, Tf, Tj, TJ, ', ", Td, TD, Tm, T*) · /ToUnicode CMaps (bfchar, bfrange, 1- or 2-byte codes) · NFKC (Arabic presentation forms).
   What it does NOT read (reported, never guessed):  scanned pages (no text operators), fonts without a ToUnicode map and 2-byte codes (shown as garbage → confidence
   drops), encrypted files, forms drawn as XObjects. A result below the confidence bar is `ok:false` and the caller falls back to STRICT mode (origin unknown). */

const dec = new TextDecoder("latin1");
const CP1252 = { 0x80: "€", 0x82: "‚", 0x83: "ƒ", 0x84: "„", 0x85: "…", 0x86: "†", 0x87: "‡", 0x88: "ˆ", 0x89: "‰", 0x8a: "Š", 0x8b: "‹", 0x8c: "Œ", 0x8e: "Ž", 0x91: "‘", 0x92: "’", 0x93: "“", 0x94: "”", 0x95: "•", 0x96: "–", 0x97: "—", 0x98: "˜", 0x99: "™", 0x9a: "š", 0x9b: "›", 0x9c: "œ", 0x9e: "ž", 0x9f: "Ÿ" };

export function b64ToBytes(b64) {
  const bin = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const latin1 = (bytes) => { let s = ""; for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768)); return s; };

async function inflate(bytes) {
  for (const fmt of ["deflate", "deflate-raw"]) {
    try {
      const ds = new DecompressionStream(fmt);
      const buf = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
      return new Uint8Array(buf);
    } catch (e) { /* try the next wrapper (some producers write raw deflate) */ }
  }
  return null;
}

/* a balanced << … >> that follows /Key in `s` ("" when none) */
function dictAfter(s, key) {
  const k = s.indexOf(key);
  if (k < 0) return "";
  let i = s.indexOf("<<", k);
  if (i < 0 || i - k > 40) return "";
  let depth = 0;
  for (let j = i; j < s.length - 1; j++) {
    if (s[j] === "<" && s[j + 1] === "<") { depth++; j++; } else if (s[j] === ">" && s[j + 1] === ">") { depth--; j++; if (!depth) return s.slice(i, j + 1); }
  }
  return "";
}
const refOf = (s, key) => { const m = new RegExp(`${key}\\s+(\\d+)\\s+\\d+\\s+R`).exec(s); return m ? parseInt(m[1], 10) : 0; };
const refsIn = (s) => [...String(s).matchAll(/(\d+)\s+\d+\s+R/g)].map((m) => parseInt(m[1], 10));

/* ── parse every object (and the contents of /ObjStm streams) ── */
async function readObjects(bytes, deadline) {
  const s = latin1(bytes);
  const objs = new Map();
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  let m;
  while ((m = re.exec(s))) {
    const id = parseInt(m[1], 10), from = m.index + m[0].length;
    const end = s.indexOf("endobj", from);
    if (end < 0) break;
    const body = s.slice(from, end);
    const si = body.indexOf("stream");
    let dict = body, raw = null;
    if (si >= 0 && /<<[\s\S]*>>\s*stream/.test(body.slice(0, si + 6))) {
      dict = body.slice(0, si);
      let a = from + si + 6;
      if (s[a] === "\r") a++;
      if (s[a] === "\n") a++;
      let b = s.indexOf("endstream", a);
      if (b < 0) b = end;
      if (s[b - 1] === "\n") b--;
      if (s[b - 1] === "\r") b--;
      raw = bytes.subarray(a, b);
    }
    objs.set(id, { dict, raw, decoded: undefined });
    re.lastIndex = end + 6;
    if (Date.now() > deadline) break;
  }
  return objs;
}
function ascii85(bytes) {
  const t = latin1(bytes).replace(/\s+/g, "").replace(/^<~/, "");
  const end = t.indexOf("~>");
  const src = end >= 0 ? t.slice(0, end) : t;
  const out = [];
  let grp = [];
  for (const ch of src) {
    if (ch === "z" && !grp.length) { out.push(0, 0, 0, 0); continue; }
    const v = ch.charCodeAt(0) - 33;
    if (v < 0 || v > 84) return null;
    grp.push(v);
    if (grp.length === 5) { let n = 0; for (const g of grp) n = n * 85 + g; out.push((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255); grp = []; }
  }
  if (grp.length > 1) { const k = grp.length; while (grp.length < 5) grp.push(84); let n = 0; for (const g of grp) n = n * 85 + g; const b4 = [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]; out.push(...b4.slice(0, k - 1)); }
  return Uint8Array.from(out);
}
function asciiHex(bytes) {
  const h = latin1(bytes).replace(/\s+/g, "").replace(/>.*$/, "");
  const out = []; for (let i = 0; i < h.length; i += 2) out.push(parseInt(h.slice(i, i + 2).padEnd(2, "0"), 16));
  return Uint8Array.from(out);
}
/* /Filter /A or [/A /B …] applied in order; a filter this file does not read (LZW, DCT, …) → null (reported, never guessed) */
async function decoded(o) {
  if (!o || !o.raw) return null;
  if (o.decoded !== undefined) return o.decoded;
  const fm = /\/Filter\s*(\[[^\]]*\]|\/[A-Za-z0-9]+)/.exec(o.dict);
  let bytes = o.raw;
  if (fm) {
    for (const f of [...fm[1].matchAll(/\/([A-Za-z0-9]+)/g)].map((x) => x[1])) {
      if (!bytes) break;
      if (f === "FlateDecode" || f === "Fl") bytes = await inflate(bytes);
      else if (f === "ASCII85Decode" || f === "A85") bytes = ascii85(bytes);
      else if (f === "ASCIIHexDecode" || f === "AHx") bytes = asciiHex(bytes);
      else bytes = null;
    }
  }
  o.decoded = bytes;
  return bytes;
}
async function expandObjStm(objs, deadline) {
  for (const [, o] of [...objs]) {
    if (!/\/Type\s*\/ObjStm/.test(o.dict) || Date.now() > deadline) continue;
    const bytes = await decoded(o);
    if (!bytes) continue;
    const n = parseInt((/\/N\s+(\d+)/.exec(o.dict) || [])[1] || "0", 10), first = parseInt((/\/First\s+(\d+)/.exec(o.dict) || [])[1] || "0", 10);
    const t = latin1(bytes);
    const head = t.slice(0, first).trim().split(/\s+/).map(Number);
    for (let i = 0; i < n; i++) {
      const id = head[i * 2], off = head[i * 2 + 1];
      const nextOff = i + 1 < n ? head[(i + 1) * 2 + 1] : t.length - first;
      if (Number.isFinite(id) && Number.isFinite(off) && !objs.has(id)) objs.set(id, { dict: t.slice(first + off, first + nextOff), raw: null, decoded: null });
    }
  }
}

/* ── /ToUnicode ── */
const hexU = (h) => { let out = ""; for (let i = 0; i + 3 < h.length + 1; i += 4) { const c = parseInt(h.slice(i, i + 4), 16); if (Number.isFinite(c)) out += String.fromCharCode(c); } return out; };
export function parseCMap(text) {
  const map = new Map();
  let bytes = 0;
  for (const m of text.matchAll(/begincodespacerange([\s\S]*?)endcodespacerange/g)) { const h = /<([0-9A-Fa-f]+)>/.exec(m[1]); if (h) bytes = Math.max(bytes, h[1].length / 2); }
  for (const m of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) for (const p of m[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) map.set(parseInt(p[1], 16), hexU(p[2]));
  for (const m of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const p of m[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(\[[^\]]*\]|<[0-9A-Fa-f]+>)/g)) {
      const lo = parseInt(p[1], 16), hi = parseInt(p[2], 16);
      if (hi - lo > 65535) continue;
      if (p[3][0] === "[") { const arr = [...p[3].matchAll(/<([0-9A-Fa-f]+)>/g)].map((x) => hexU(x[1])); for (let c = lo; c <= hi && c - lo < arr.length; c++) map.set(c, arr[c - lo]); }
      else { const base = hexU(p[3].slice(1, -1)); for (let c = lo; c <= hi; c++) map.set(c, base.slice(0, -1) + String.fromCharCode(base.charCodeAt(base.length - 1) + (c - lo))); }
    }
  }
  return { map, bytes: bytes || (map.size && Math.max(...[...map.keys()].slice(0, 200)) > 255 ? 2 : 1) };
}

async function fontsOf(objs, res) {
  const fonts = new Map();
  let fd = dictAfter(res, "/Font");
  if (!fd) { const r = refOf(res, "/Font"); if (r && objs.get(r)) fd = objs.get(r).dict; }
  for (const m of fd.matchAll(/\/([^\s/<>[\]()]+)\s+(\d+)\s+\d+\s+R/g)) {
    const fo = objs.get(parseInt(m[2], 10));
    if (!fo) continue;
    const info = { type0: /\/Subtype\s*\/Type0/.test(fo.dict), cmap: null };
    const tu = refOf(fo.dict, "/ToUnicode");
    if (tu) { const b = await decoded(objs.get(tu)); if (b) info.cmap = parseCMap(latin1(b)); }
    fonts.set(m[1], info);
  }
  return fonts;
}

/* ── content stream → text ── */
function tokenize(src) {
  const out = [];
  let i = 0;
  const n = src.length;
  const ws = /[\s\0]/;
  while (i < n) {
    const c = src[i];
    if (ws.test(c)) { i++; continue; }
    if (c === "%") { while (i < n && src[i] !== "\n" && src[i] !== "\r") i++; continue; }
    if (c === "(") {
      let depth = 1, j = i + 1, buf = [];
      while (j < n && depth) {
        const d = src[j];
        if (d === "\\") {
          const e = src[j + 1];
          if (/[0-7]/.test(e)) { let o = e, k = j + 2; while (k < j + 4 && /[0-7]/.test(src[k])) o += src[k++]; buf.push(parseInt(o, 8) & 255); j = k; continue; }
          const map = { n: 10, r: 13, t: 9, b: 8, f: 12, "(": 40, ")": 41, "\\": 92 };
          if (e in map) buf.push(map[e]); else if (e === "\n" || e === "\r") { /* line continuation */ } else buf.push(e.charCodeAt(0));
          j += 2; continue;
        }
        if (d === "(") depth++;
        if (d === ")") { depth--; if (!depth) break; }
        buf.push(d.charCodeAt(0) & 255); j++;
      }
      out.push({ t: "str", v: Uint8Array.from(buf) }); i = j + 1; continue;
    }
    if (c === "<" && src[i + 1] !== "<") {
      const j = src.indexOf(">", i);
      const hex = src.slice(i + 1, j < 0 ? n : j).replace(/\s+/g, "");
      const b = []; for (let k = 0; k < hex.length; k += 2) b.push(parseInt(hex.slice(k, k + 2).padEnd(2, "0"), 16));
      out.push({ t: "str", v: Uint8Array.from(b) }); i = (j < 0 ? n : j) + 1; continue;
    }
    if (c === "[") { out.push({ t: "[" }); i++; continue; }
    if (c === "]") { out.push({ t: "]" }); i++; continue; }
    if (c === "<" || c === ">") { i += src[i + 1] === c ? 2 : 1; continue; }
    if (c === "/") { let j = i + 1; while (j < n && !/[\s/[\]()<>%]/.test(src[j])) j++; out.push({ t: "name", v: src.slice(i + 1, j) }); i = j; continue; }
    let j = i; while (j < n && !/[\s/[\]()<>%]/.test(src[j])) j++;
    const w = src.slice(i, j); i = j;
    out.push(/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(w) ? { t: "num", v: parseFloat(w) } : { t: "op", v: w });
  }
  return out;
}

function showBytes(bytes, font) {
  let s = "";
  if (font && font.cmap && font.cmap.map.size) {
    const w = font.cmap.bytes === 2 ? 2 : 1;
    for (let i = 0; i + w <= bytes.length; i += w) { const code = w === 2 ? (bytes[i] << 8) | bytes[i + 1] : bytes[i]; const u = font.cmap.map.get(code); s += u != null ? u : (w === 1 && code >= 32 && code < 127 ? String.fromCharCode(code) : "\uFFFD"); }
    return s;
  }
  if (font && font.type0) return "\uFFFD".repeat(bytes.length >> 1);                   // glyph ids without a ToUnicode map: unreadable, say so
  for (const b of bytes) s += b >= 0x80 && b <= 0x9f ? (CP1252[b] || "\uFFFD") : String.fromCharCode(b);
  return s;
}

function contentText(src, fonts) {
  const toks = tokenize(src);
  let font = null, out = "", stack = [], arr = null, y = null;
  const nl = () => { if (out && !out.endsWith("\n")) out += "\n"; };
  for (const t of toks) {
    if (t.t === "[") { arr = []; continue; }
    if (t.t === "]") { stack.push({ t: "arr", v: arr || [] }); arr = null; continue; }
    if (t.t !== "op") { (arr || stack).push(t); continue; }
    const op = t.v, a = stack;
    if (op === "Tf") { const nm = a.find((x) => x.t === "name"); font = nm ? fonts.get(nm.v) || null : null; }
    else if (op === "Tj") { const s = a[a.length - 1]; if (s && s.t === "str") out += showBytes(s.v, font); }
    else if (op === "'" || op === '"') { nl(); const s = a[a.length - 1]; if (s && s.t === "str") out += showBytes(s.v, font); }
    else if (op === "TJ") { const r = a[a.length - 1]; if (r && r.t === "arr") for (const x of r.v) { if (x.t === "str") out += showBytes(x.v, font); else if (x.t === "num" && x.v < -180 && out && !out.endsWith(" ") && !out.endsWith("\n")) out += " "; } }
    else if (op === "Td" || op === "TD") { const ty = a.length >= 1 ? a[a.length - 1].v : 0, tx = a.length >= 2 ? a[a.length - 2].v : 0; if (Math.abs(ty) > 0.5) nl(); else if (tx > 0 && out && !/[\s]$/.test(out)) out += " "; }
    else if (op === "Tm") { const f = a.length >= 6 ? a[a.length - 1].v : null; if (f != null) { if (y != null && Math.abs(f - y) > 1) nl(); else if (y != null && out && !/\s$/.test(out)) out += " "; y = f; } }
    else if (op === "T*") nl();
    else if (op === "BT") { y = null; if (out && !/\s$/.test(out)) out += " "; }
    else if (op === "ET") nl();
    stack = []; arr = null;
  }
  return out;
}

/* page order from the page tree (falls back to object order) */
function pageList(objs) {
  const pages = [];
  const root = [...objs.entries()].find(([, o]) => /\/Type\s*\/Catalog/.test(o.dict));
  const walk = (id, inh, seen) => {
    const o = objs.get(id);
    if (!o || seen.has(id)) return;
    seen.add(id);
    const res = dictAfter(o.dict, "/Resources") || (refOf(o.dict, "/Resources") && objs.get(refOf(o.dict, "/Resources")) ? objs.get(refOf(o.dict, "/Resources")).dict : "") || inh;
    if (/\/Kids\s*\[/.test(o.dict)) { for (const k of refsIn(/\/Kids\s*\[([^\]]*)\]/.exec(o.dict)[1])) walk(k, res, seen); }
    else if (/\/Type\s*\/Page\b(?!s)/.test(o.dict) || /\/Contents/.test(o.dict)) pages.push({ id, dict: o.dict, res });
  };
  const pagesRef = root ? refOf(root[1].dict, "/Pages") : 0;
  if (pagesRef) walk(pagesRef, "", new Set());
  if (!pages.length) for (const [id, o] of objs) if (/\/Type\s*\/Page\b(?!s)/.test(o.dict)) pages.push({ id, dict: o.dict, res: dictAfter(o.dict, "/Resources") });
  return pages;
}

const GARBAGE = /\uFFFD/g;
/* Most producers store Arabic in VISUAL order (left to right on the page), i.e. each run reversed. Decide for the whole document by evidence (an Arabic word
   starts with «ال» far more often than it ends with «لا»), then reverse every Arabic run. Latin runs, digits and line order are untouched. */
const AR_RUN = /[\u0600-\u06FF\u0750-\u077F]+(?:[ \u00A0]+[\u0600-\u06FF\u0750-\u077F]+)*/g;
export function fixArabicOrder(text) {
  const runs = text.match(AR_RUN);
  if (!runs || runs.join("").length < 12) return text;
  const words = runs.join(" ").split(/\s+/);
  const fwd = words.filter((w) => /^(?:و|ب|ل|ف|ك)?ال/.test(w)).length;
  const rev = words.filter((w) => /لا(?:[\u064B-\u0652])?$/.test(w) && w.length > 3).length + words.filter((w) => /^[\u0621-\u064A]*ل[او]$/.test(w) && false).length;
  const revStart = words.filter((w) => /(?:ال)$/.test(w) && w.length > 3).length;
  if (fwd >= Math.max(2, rev + revStart)) return text;                    // logical order already
  return text.replace(AR_RUN, (r) => [...r].reverse().join(""));
}
const normText = (t) => t.normalize("NFKC").replace(/[ \t]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

/* → { ok, confidence, reason, pages:[{ index (1-based), text }], text }.  maxMs bounds the work (it runs while the student adds the file). */
export async function extractPdfText(input, { maxMs = 2500, minChars = 80 } = {}) {
  const fail = (reason, extra = {}) => ({ ok: false, confidence: 0, reason, pages: [], text: "", ...extra });
  try {
    const bytes = typeof input === "string" ? b64ToBytes(input) : input;
    if (!bytes || bytes.length < 20 || latin1(bytes.subarray(0, 5)) !== "%PDF-") return fail("not-a-pdf");
    const deadline = Date.now() + maxMs;
    const objs = await readObjects(bytes, deadline);
    if ([...objs.values()].some((o) => /\/Encrypt\b/.test(o.dict))) return fail("encrypted");
    await expandObjStm(objs, deadline);
    if (/\/Encrypt\s/.test(latin1(bytes.subarray(Math.max(0, bytes.length - 2048))))) return fail("encrypted");
    const pages = [];
    let partial = false;
    for (const pg of pageList(objs)) {
      if (Date.now() > deadline) { partial = true; break; }
      const fonts = await fontsOf(objs, pg.res || "");
      const cdict = /\/Contents\s*(\[[^\]]*\]|\d+\s+\d+\s+R)/.exec(pg.dict);
      let ids = cdict ? refsIn(cdict[1]) : [];
      if (ids.length === 1 && objs.get(ids[0]) && !objs.get(ids[0]).raw && /^\s*\[/.test(objs.get(ids[0]).dict)) ids = refsIn(objs.get(ids[0]).dict);
      let src = "";
      for (const id of ids) { const b = await decoded(objs.get(id)); if (b) src += latin1(b) + "\n"; }
      pages.push({ index: pages.length + 1, text: normText(contentText(src, fonts)) });
    }
    const ar = fixArabicOrder(pages.map((p) => p.text).join("\u0001"));
    ar.split("\u0001").forEach((t, i) => { if (pages[i]) pages[i].text = t; });
    const text = pages.map((p) => p.text).filter(Boolean).join("\n\n");
    if (!pages.length) return fail("no-pages");
    if (text.length < minChars) return fail("no-text-layer", { pages, scanned: true });          // scanned / image-only: the model is the only reader
    const bad = (text.match(GARBAGE) || []).length / text.length;
    const wordy = text.split(/\s+/).filter((w) => /[\p{L}\p{N}]{2,}/u.test(w)).length / Math.max(1, text.split(/\s+/).length);
    const confidence = Math.max(0, Math.min(1, (1 - bad * 6) * (0.4 + wordy * 0.6)));
    return { ok: confidence >= 0.7, confidence: Math.round(confidence * 100) / 100, reason: confidence >= 0.7 ? (partial ? "partial" : "") : "low-confidence", partial, pages, text };
  } catch (e) { return fail("error"); }
}
