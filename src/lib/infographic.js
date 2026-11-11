/* Infographics, the reliable way.
   The model writes a tiny JSON (≈400–800 tokens → a few seconds). Everything visual is done HERE by code:
   8 layouts, real text measurement (canvas), automatic font search, equal spacing, nothing can overflow or overlap.

   v3.20
   • VARIETY: every picture gets a random LOOK — 8 colour palettes × 4 header styles × 3 card styles × 5 backgrounds
     (≈480 combinations, never the same palette twice in a row). The same content can be re-drawn in another look instantly
     (renderInfographicEx(spec, { avoid })) without asking the model again.
   • BILINGUAL: when the JSON carries Arabic fields (ha / ba / rootAr / tipAr / table va), the Arabic translation is drawn
     UNDER every English heading, bullet, table cell and the tip. Layout measures the extra lines, so nothing overflows. */

/* ───────────── looks ───────────── */
const mk = (a, b) => [a, b];
const PALETTES = {
  ocean: { dark: false, ink: "#0B2A30", accent: "#0E7C8F", bg: ["#EEF9FB", "#FFFFFF"], hdr: ["#0B2A30", "#0E7C8F"], sub: "#9FE3F7", card: "#FFFFFF", soft: "#EAF6F8", soft2: "#F4FAFB", line: "#D5E6EA", pat: "#0E7C8F",
    pal: { teal: mk("#0E7C8F", "#0A5F6E"), coral: mk("#E8664D", "#C94F38"), violet: mk("#6B5BD2", "#5442C9"), amber: mk("#F2B134", "#D99410"), green: mk("#2FA56B", "#228552"), sky: mk("#25A3DC", "#1B86B8") },
    tip: { fill: "#FFF4E0", stroke: "#F2B134", label: "#C07F0A", text: "#0B2A30" } },
  royal: { dark: false, ink: "#1B1B4B", accent: "#4F46E5", bg: ["#F1F0FF", "#FFFFFF"], hdr: ["#1E1B6B", "#6D4AE0"], sub: "#D6CCFF", card: "#FFFFFF", soft: "#ECE9FF", soft2: "#F6F5FF", line: "#DAD6F5", pat: "#4F46E5",
    pal: { teal: mk("#4F46E5", "#3F38C2"), coral: mk("#EF5B7A", "#CC4262"), violet: mk("#9B4DE0", "#7F36C2"), amber: mk("#F3AE2F", "#D98E0C"), green: mk("#2DA676", "#1F855C"), sky: mk("#2A9DE0", "#1A7FBD") },
    tip: { fill: "#FFF4E0", stroke: "#F3AE2F", label: "#B87408", text: "#1B1B4B" } },
  forest: { dark: false, ink: "#10302A", accent: "#0F766E", bg: ["#EFF8F3", "#FFFFFF"], hdr: ["#0B3B33", "#1C8C6E"], sub: "#B8F0DA", card: "#FFFFFF", soft: "#E3F4EC", soft2: "#F3FAF6", line: "#CFE6DB", pat: "#0F766E",
    pal: { teal: mk("#0F8A7A", "#0B6C60"), coral: mk("#E5654B", "#C44D36"), violet: mk("#7A5BD0", "#6244B5"), amber: mk("#EFAA2E", "#D58C0B"), green: mk("#43A047", "#2E7D32"), sky: mk("#2B9BD4", "#1C7DB0") },
    tip: { fill: "#FFF6E2", stroke: "#EFAA2E", label: "#B87408", text: "#10302A" } },
  sunrise: { dark: false, ink: "#3A1F12", accent: "#E2711D", bg: ["#FFF6EA", "#FFFFFF"], hdr: ["#5B1F2B", "#E2711D"], sub: "#FFE2BF", card: "#FFFFFF", soft: "#FFEEDA", soft2: "#FFF8EF", line: "#F1DCC3", pat: "#E2711D",
    pal: { teal: mk("#E2711D", "#BD5A0E"), coral: mk("#E0314F", "#BC2140"), violet: mk("#8E4FC4", "#753AA6"), amber: mk("#E9B80F", "#C79A05"), green: mk("#3B9D5B", "#2B7D45"), sky: mk("#3A8FCB", "#2B72A8") },
    tip: { fill: "#FFF3D6", stroke: "#E9B80F", label: "#A97A00", text: "#3A1F12" } },
  slate: { dark: false, ink: "#17212F", accent: "#334155", bg: ["#F2F5F9", "#FFFFFF"], hdr: ["#0F172A", "#3B4B63"], sub: "#C9D6EA", card: "#FFFFFF", soft: "#E8EDF4", soft2: "#F5F7FA", line: "#D5DCE6", pat: "#334155",
    pal: { teal: mk("#3B4B63", "#273449"), coral: mk("#E2554A", "#BF3F36"), violet: mk("#6366F1", "#4A4CD0"), amber: mk("#EDAA2B", "#CF8C0B"), green: mk("#2E9E6B", "#217F54"), sky: mk("#2E96D6", "#1F78B2") },
    tip: { fill: "#FFF5E0", stroke: "#EDAA2B", label: "#B07406", text: "#17212F" } },
  midnight: { dark: true, ink: "#E7EEF9", accent: "#2DD4BF", bg: ["#0B1220", "#122038"], hdr: ["#12315A", "#0E8C99"], sub: "#A8E8F4", card: "#16233A", soft: "#1B2C48", soft2: "#142038", line: "#2B3F63", pat: "#7DD3FC",
    pal: { teal: mk("#14B8A6", "#0D9488"), coral: mk("#FB7185", "#E11D48"), violet: mk("#A78BFA", "#7C3AED"), amber: mk("#FBBF24", "#D97706"), green: mk("#34D399", "#059669"), sky: mk("#38BDF8", "#0284C7") },
    tip: { fill: "#2A2210", stroke: "#FBBF24", label: "#FBBF24", text: "#F5EBD0" } },
  candy: { dark: false, ink: "#3B1A33", accent: "#DB2777", bg: ["#FFF0F7", "#FFFFFF"], hdr: ["#9D174D", "#E8559A"], sub: "#FFD5EA", card: "#FFFFFF", soft: "#FFE4F1", soft2: "#FFF4F9", line: "#F5D3E4", pat: "#DB2777",
    pal: { teal: mk("#E0479A", "#C02E7E"), coral: mk("#F0603F", "#D14826"), violet: mk("#8B5CF6", "#6D3FDB"), amber: mk("#F5B21A", "#D99606"), green: mk("#34B27B", "#248F5F"), sky: mk("#33A8E8", "#2088C4") },
    tip: { fill: "#FFF4DB", stroke: "#F5B21A", label: "#A97806", text: "#3B1A33" } },
  paper: { dark: false, ink: "#2B2418", accent: "#0F766E", bg: ["#FBF6E9", "#FFFDF7"], hdr: ["#3B2F1E", "#7A5C2E"], sub: "#F3E1B8", card: "#FFFEFA", soft: "#F4ECD6", soft2: "#FAF5E7", line: "#E6DAB8", pat: "#8A6D3B",
    pal: { teal: mk("#0F766E", "#0B5C56"), coral: mk("#D9523B", "#B63E2A"), violet: mk("#7C5AC7", "#6342AA"), amber: mk("#D99A1C", "#B87D08"), green: mk("#3F8F4E", "#2E7039"), sky: mk("#2F8FC0", "#217099") },
    tip: { fill: "#FFF1CC", stroke: "#D99A1C", label: "#9A6A05", text: "#2B2418" } },
};
const HEADERS = ["band", "flat", "left", "pill"];
const CARDS = ["outline", "tint", "clean"];
const PATTERNS = ["dots", "grid", "stripes", "circles", "none"];
const pick = (a) => a[Math.floor(Math.random() * a.length)];

let _last = null;       // the previous look, so two pictures in a row never share a palette
export function pickStyle(avoid) {
  const bad = (avoid && avoid.theme) || (_last && _last.theme);
  const theme = pick(Object.keys(PALETTES).filter((k) => k !== bad));
  const s = { theme, hdr: pick(HEADERS), card: pick(CARDS), pat: PALETTES[theme].dark ? pick(["dots", "grid", "circles"]) : pick(PATTERNS) };
  _last = s;
  return s;
}

/* current look (set at the start of every render) */
let TH = PALETTES.ocean, COL = TH.pal, STY = { theme: "ocean", hdr: "band", card: "outline", pat: "dots" }, RAD = 24;
const ORDER = ["teal", "coral", "violet", "amber", "green", "sky"];
const F = 'font-family="Arial,Helvetica,sans-serif"';
const AR = /[\u0600-\u06FF]/;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const str = (x, n) => String(x == null ? "" : x).replace(/\*\*|[`#]/g, "").replace(/\s+/g, " ").trim().slice(0, n);
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => { const A = hex(a), B = hex(b); return "#" + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, "0")).join(""); };
const kcol = (c) => (TH.dark ? COL[c][0] : COL[c][1]);                       // text colour that goes with a card colour
const fillOf = (c) => (STY.card === "tint" ? mix(COL[c][0], TH.card, TH.dark ? 0.8 : 0.9) : TH.card);
const afs = (fs) => Math.max(14, Math.round(fs * 0.86));                      // Arabic line under an English line

/* ───────────── prompt ───────────── */
const BASE_TYPES = `TYPES (pick the one that makes the topic easiest to remember):
cards    classification / overview / features of 2-6 things. {"type":"cards","icon":"🦠","title":"","ar":"","root":"parent concept (only for 2-4 items, drawn as a tree)","items":[{"h":"","e":"🔴","c":"coral","b":["Key: fact"]}],"tip":""}
steps    ordered process, 3-5 items (same item shape).
compare  exactly 2 items side by side (same item shape).
table    2-4 columns x 3-6 rows, e.g. hypo- vs hyper-: {"type":"table","icon":"","title":"","ar":"","cols":[{"h":"Hypothyroidism","c":"sky"},{"h":"Hyperthyroidism","c":"coral"}],"rows":[{"h":"Heart rate","v":["Slow","Fast"]}],"tip":""}
cycle    repeating loop, 3-6 items, at most ONE short bullet each.
mnemonic letters that spell a memory aid, 3-6 items: {"type":"mnemonic",...,"items":[{"l":"R","h":"Rescue","b":["Remove patient from danger"]}],"tip":""}
pyramid  priority / hierarchy, 3-5 items, FIRST item = top = highest priority; one short bullet each (e.g. ABC, Maslow, triage).
hub      one central idea with 3-6 surrounding aspects: root = the central idea, items = aspects (1-2 short bullets each).`;

const RULES = `CONTENT RULES
- English labels, spelled exactly right. "ar" = ONE short Arabic line (<= 45 chars) saying what the graphic shows; always give it.
- Accuracy is everything: use CONTEXT (the question and lesson) as the source of truth; add only facts you are certain of (normal lab ranges, doses, classic signs, standard NCLEX priorities). If unsure, leave it out. Never invent numbers, drugs or anatomy. No duplicates, no overlap between items.
- Bullets are "Key: fact" (the key is shown in bold), 2-7 words each, max 3 per item (2 when there are 5-6 items). Facts the student must remember, with numbers/units when relevant.
- title <= 40 chars. h <= 22 chars. e = ONE fitting emoji. icon = ONE emoji for the whole topic. c = teal coral violet amber green sky (colour carries meaning: coral danger/abnormal/high-risk, green safe/normal, amber caution, violet info, sky neutral, teal main).
- tip = ONE key NCLEX exam point (<= 12 words) or "".
- If the request is generic ("draw this", "make a diagram"), illustrate the main concept of the CONTEXT.`;

const BILINGUAL = `BILINGUAL MODE — the student wants the ARABIC TRANSLATION UNDER EVERY ENGLISH LINE. Add these Arabic fields (the layout engine prints each one directly under its English text):
- every item: "ha" = Arabic of "h" (<= 22 chars); "ba" = array with the Arabic of each bullet, SAME ORDER and SAME LENGTH as "b" (each <= 40 chars).
- cards/tree: "rootAr" = Arabic of "root". Every graphic: "tipAr" = Arabic of "tip" (<= 14 words) when tip is not empty.
- table: cols[].ha = Arabic of the column title; rows[].ha = Arabic of the row title; rows[].va = array with the Arabic of each value, same order and length as "v".
- The Arabic must be correct, natural medical Arabic that a nursing student uses. Keep numbers, units and lab abbreviations (mmHg, mg, ECG, K+, …) in Latin letters. No other scripts, no emoji inside Arabic.
- To leave room for two languages: at most 2 bullets per item (1 for pyramid, hub, cycle and mnemonic when there are 5 or more items); tables at most 3 columns and 5 rows; every English line short (<= 5 words).`;

export function infoSystem({ bilingual = false, avoidType = "" } = {}) {
  return `You are the world's best medical infographic designer. You make study graphics for an Arabic-speaking nursing student preparing for the NCLEX-RN. A layout engine draws what you describe (colours and looks are chosen by the engine, never by you), so you only choose the structure and write precise, correct content.
Reply with ONE JSON object only (no markdown, no comments).

${BASE_TYPES}

${RULES.replace('"ar" = ONE short Arabic line (<= 45 chars) saying what the graphic shows; always give it.', bilingual ? '"ar" = ONE short Arabic line (<= 45 chars) saying what the graphic shows; always give it. Other Arabic goes only into the bilingual fields below.' : '"ar" = ONE short Arabic line (<= 45 chars) saying what the graphic shows; always give it. No other Arabic.')}
${bilingual ? "\n" + BILINGUAL : ""}${avoidType ? `\n\nVARIETY: the previous graphic used the type "${avoidType}". Unless the content clearly fits only that type, choose a DIFFERENT type this time.` : ""}`;
}
export const INFO_SYSTEM = infoSystem();

export function parseInfo(text) {
  const s = String(text || ""), a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("no json");
  const body = s.slice(a, b + 1);
  try { return JSON.parse(body); }
  catch (e) { return JSON.parse(body.replace(/,\s*([}\]])/g, "$1")); }     // a trailing comma is the usual slip: repair it instead of asking the model again
}

/* ───────────── text measuring + wrapping (canvas gives exact widths; heuristic outside a browser) ───────────── */
let _c;
const ctx2d = () => { if (_c === undefined) { try { _c = document.createElement("canvas").getContext("2d"); } catch (e) { _c = null; } } return _c; };
const mw = (s, fs, bold) => {
  const c = ctx2d();
  if (c) { c.font = `${bold ? 800 : 500} ${fs}px Arial, Helvetica, sans-serif`; return c.measureText(s).width; }
  return String(s).length * fs * (bold ? 0.6 : 0.54);
};
function wrap(text, fs, maxW, bold) {
  const out = []; let line = "";
  for (const w of String(text).split(/\s+/).filter(Boolean)) {
    const t = line ? line + " " + w : w;
    if (line && mw(t, fs, bold) > maxW) { out.push(line); line = w; } else line = t;
  }
  if (line) out.push(line);
  return out.length ? out : [""];
}
/* bilingual headings stay on ONE line: the font shrinks (down to minFs) instead of silently cutting words off */
function oneLine(text, fs, W, bold, minFs = 15) {
  let f = fs;
  while (f > minFs && mw(text, f, bold) > W) f--;
  return { s: text, fs: f };
}
/* one <text>; if a single word is still too wide it is squeezed (never overflows) */
function T(x, y, s, fs, fill, o = {}) {
  const fit = o.maxW && mw(s, fs, o.b) > o.maxW ? ` textLength="${Math.floor(o.maxW)}" lengthAdjust="spacingAndGlyphs"` : "";
  const rtl = AR.test(s) ? ' direction="rtl" unicode-bidi="plaintext"' : "";
  return `<text x="${Math.round(x)}" y="${Math.round(y)}" font-size="${fs}" fill="${fill}" font-weight="${o.b ? 800 : 500}" text-anchor="${o.a || "middle"}" ${F}${rtl}${fit}${o.x || ""}>${esc(s)}</text>`;
}
/* Arabic line whose RIGHT edge sits at xr (centre-anchored on purpose: identical in every renderer, whatever "start/end" mean for RTL) */
function AT(xr, y, s, fs, fill, maxW, o = {}) {
  const w = Math.min(mw(s, fs, o.b), maxW || 1e9);
  return T(xr - w / 2, y, s, fs, fill, { maxW, b: o.b, x: o.x });
}
/* a vertical stack of centred lines ({s, fs, b, fill}) around cy */
function stack(cx, cy, lines, maxW) {
  const H = lines.reduce((a, l) => a + l.fs * 1.18, 0);
  let y = cy - H / 2, g = "";
  lines.forEach((l) => { g += T(cx, y + l.fs * 0.92, l.s, l.fs, l.fill, { b: l.b, maxW, x: l.x }); y += l.fs * 1.18; });
  return g;
}
/* "Key: detail" bullet → wrapped lines; the key (up to the colon) is drawn bold + coloured. `ar` = optional Arabic lines under it */
function bullet(text, fs, maxW, arText) {
  const t = String(text).replace(/\s+/g, " ").trim(), k = t.indexOf(": ");
  const key = k > 0 && k <= 28 ? k + 1 : 0, sp = mw(" ", fs), lines = [];
  let line = "", lw = 0, off = 0;
  for (const w of t.split(" ")) {
    const ww = mw(w, fs, off < key);                      // the key is bold → measure it bold
    if (line && lw + sp + ww > maxW) { lines.push(line); line = w; lw = ww; } else { lw = line ? lw + sp + ww : ww; line = line ? line + " " + w : w; }
    off += w.length + 1;
  }
  if (line) lines.push(line);
  const ar = arText ? wrap(arText, afs(fs), maxW).slice(0, 2) : [];
  return { key, lines, ar, fs, over: lines.some((l) => mw(l, fs, false) > maxW * 1.04 && !l.includes(" ")) };
}
const bh = (b, lh = 1.27) => b.lines.length * b.fs * lh + (b.ar.length ? b.ar.length * afs(b.fs) * 1.28 + 5 : 0);
/* English lines (left) + the Arabic lines under them (right-aligned at xr). returns the SVG */
function bulletSvg(x, y, b, fs, kc, lh = 1.27, maxW = 0, xr = 0) {
  let off = 0, g = "";
  b.lines.forEach((l, i) => {
    let body = esc(l);
    if (b.key > off) { const n = Math.min(b.key - off, l.length); body = `<tspan font-weight="800" fill="${kc}">${esc(l.slice(0, n))}</tspan>${esc(l.slice(n))}`; }
    g += `<text x="${Math.round(x)}" y="${Math.round(y + i * fs * lh)}" font-size="${fs}" fill="${TH.ink}" font-weight="500" text-anchor="start" ${F}${maxW && mw(l, fs, false) > maxW ? ` textLength="${Math.floor(maxW)}" lengthAdjust="spacingAndGlyphs"` : ""}>${body}</text>`;
    off += l.length + 1;
  });
  if (b.ar.length) {
    const f = afs(fs), right = xr || x + maxW;
    b.ar.forEach((l, i) => { g += AT(right, y + (b.lines.length - 1) * fs * lh + f * 1.2 + 4 + i * f * 1.28, l, f, kc, maxW || right - x, { b: 1 }); });
  }
  return g;
}
const SH = 'filter="url(#sh)"';

/* card frame in the current card style → svg for the card body (fill + outline) and the coloured heading strip */
function cardFrame(x, y, w, h, c, HEAD) {
  const main = COL[c][0], r = RAD;
  let g = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fillOf(c)}" ${SH}/>`;
  if (STY.card === "outline") g += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="none" stroke="${main}" stroke-width="3"/>`;
  else if (STY.card === "tint") g += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="none" stroke="${main}" stroke-opacity=".55" stroke-width="2"/>`;
  g += `<path d="M${x} ${y + HEAD}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + HEAD}Z" fill="${STY.card === "tint" ? main : `url(#g-${c})`}"/>`;
  return g;
}

/* ───────────── layout 1: card grid (cards · steps · compare · tree) ───────────── */
function cardGrid(items, o) {
  const bi = o.bi;
  const n = items.length, cols = o.cols || (n <= 4 ? n : 3), rows = Math.ceil(n / cols), gx = o.gap, gy = 22;
  const w = (1120 - gx * (cols - 1)) / cols, avail = o.bottom - o.top, rowH = (avail - gy * (rows - 1)) / rows;
  const R = rows > 1 ? 24 : 28, IC = 14 + R * 2 + 10, pad = 22, ind = 26, tw = w - IC - 12;
  /* bilingual: a heading that would have to be tiny on one line gets two lines at a readable size instead (and a taller strip) */
  const twoLine = bi && items.some((it) => oneLine(it.h, rows > 1 ? 26 : 30, tw, true, 15).fs < 19);
  const HEAD = (rows > 1 ? 68 : 80) + (bi ? 18 : 0) + (twoLine ? 34 : 0);
  const maxFs = rows > 1 ? 28 : n <= 2 ? 36 : 32, minFs = bi ? 17 : 20;
  const measure = (fs) => items.map((it) => {
    let hf = Math.min(fs + 2, rows > 1 ? 26 : 30), hl;
    if (twoLine) { hf = 20; hl = wrap(it.h, hf, tw, true).slice(0, 2); }
    else if (bi) { const o1 = oneLine(it.h, hf, tw, true, 15); hf = o1.fs; hl = [it.h]; } else hl = wrap(it.h, hf, tw, true).slice(0, 2);
    const haf = twoLine ? 16 : Math.round(hf * 0.78), hal = bi && it.ha ? [it.ha] : [];
    const bs = it.b.map((b, j) => bullet(b, fs, w - pad * 2 - ind, bi ? it.ba[j] : ""));
    return { hf, hl, haf, hal, bs, h: bs.some((b) => b.over) ? 1e9 : HEAD + 20 + bs.reduce((a, x) => a + bh(x), 0) + bs.length * 13 + 18 };
  });
  let m, fs;
  for (let t = 0; t < 5; t++) {
    for (fs = maxFs; fs >= minFs; fs--) { m = measure(fs); if (Math.max(...m.map((x) => x.h)) <= rowH) break; }
    if (Math.max(...m.map((x) => x.h)) <= rowH) break;
    items.forEach((it) => { if (it.b.length > 1) { it.b.pop(); it.ba.pop(); } });
  }
  const need = Math.max(...m.map((x) => x.h)), cardH = rows > 1 ? rowH : Math.min(rowH, need + 24);
  const y00 = o.top + (avail - (cardH * rows + gy * (rows - 1))) / 2;
  const cards = []; let g = "";
  items.forEach((it, i) => {
    const r = Math.floor(i / cols), c = i - r * cols, inRow = r === rows - 1 ? n - r * cols : cols;
    const x = 40 + (1120 - (inRow * w + (inRow - 1) * gx)) / 2 + c * (w + gx), y = y00 + r * (cardH + gy), cx = x + w / 2, dark = COL[it.c][1], k = m[i], main = COL[it.c][0];
    cards.push({ x, y, w, h: cardH, cx });
    g += cardFrame(x, y, w, cardH, it.c, HEAD);
    const icx = x + 14 + R, icy = y + HEAD / 2;
    if (o.badge === "steps") g += `<circle cx="${icx}" cy="${icy}" r="${R}" fill="#fff"/>` + T(icx, icy + R * 0.38, String(i + 1), Math.round(R * 1.1), dark, { b: 1 });
    else g += `<circle cx="${icx}" cy="${icy}" r="${R}" fill="#fff" fill-opacity=".22"/>` + T(icx, icy + R * 0.4, it.e || "●", Math.round(R * 1.15), "#fff");
    const hx = x + IC + tw / 2;
    if (bi) g += stack(hx, icy, [...k.hl.map((l) => ({ s: l, fs: k.hf, b: 1, fill: "#fff" })), ...k.hal.map((l) => ({ s: l, fs: k.haf, b: 1, fill: "#fff", x: ' fill-opacity=".92"' }))], tw);
    else k.hl.forEach((l, j) => { g += T(hx, icy - (k.hl.length - 1) * k.hf * 0.56 + k.hf * 0.36 + j * k.hf * 1.12, l, k.hf, "#fff", { b: 1, maxW: tw }); });
    let ty = y + HEAD + 16 + fs;
    k.bs.forEach((b) => {
      g += `<circle cx="${x + pad + 5}" cy="${Math.round(ty - fs * 0.3)}" r="5.5" fill="${main}"/>` + bulletSvg(x + pad + ind, ty, b, fs, TH.dark ? main : dark, 1.27, w - pad * 2 - ind, x + w - pad);
      ty += bh(b) + 13;
    });
    if (o.badge === "steps" && i < n - 1 && c < inRow - 1) { const ax = x + w + gx / 2, ay = y + cardH / 2; g += `<polygon points="${ax - 13},${ay - 20} ${ax + 13},${ay} ${ax - 13},${ay + 20}" fill="${TH.accent}"/>`; }
    if (o.badge === "vs" && i === 0) { const ax = x + w + gx / 2, ay = y + cardH / 2; g += `<circle cx="${ax}" cy="${ay}" r="32" fill="${TH.hdr[0]}"/>` + T(ax, ay + 9, "VS", 26, "#fff", { b: 1 }); }
  });
  return { g, cards };
}

/* ───────────── layout 2: table (compare many attributes) ───────────── */
function table(d, o) {
  const bi = o.bi;
  const nc0 = bi ? 3 : 4, nr0 = bi ? 5 : 6;
  const cols = (Array.isArray(d.cols) ? d.cols : []).slice(0, nc0).map((c, i) => ({ h: str(c && c.h, 24), ha: bi ? str(c && c.ha, 28) : "", c: c && COL[c.c] ? c.c : ORDER[i % 6] }));
  const nc = cols.length;
  const rows = (Array.isArray(d.rows) ? d.rows : []).slice(0, nr0).map((r) => ({
    h: str(r && r.h, 30), ha: bi ? str(r && r.ha, 34) : "",
    v: (Array.isArray(r && r.v) ? r.v : []).slice(0, nc).map((x) => str(x, 60)),
    va: bi ? (Array.isArray(r && r.va) ? r.va : []).slice(0, nc).map((x) => str(x, 70)) : [],
  }));
  if (nc < 2 || rows.length < 2) throw new Error("table");
  const LW = nc >= 4 ? 220 : 270, CW = (1120 - LW) / nc, avail = o.bottom - o.top, HH = bi ? 98 : 78, nr = rows.length;
  const rowH = Math.min(bi ? 132 : 122, (avail - HH) / nr);
  const blk = (en, ar, f, W, bold) => { const e = wrap(en, f, W, bold), a = bi && ar ? wrap(ar, afs(f), W).slice(0, 2) : []; return { e, a, h: e.length * f * 1.22 + (a.length ? a.length * afs(f) * 1.25 + 4 : 0) }; };
  let fs;
  const minFs = bi ? 16 : 20;
  for (fs = 30; fs >= minFs; fs--) {
    const hs = rows.map((r) => Math.max(blk(r.h, r.ha, fs, LW - 34, true).h, ...r.v.map((v, i) => blk(v, r.va[i], fs, CW - 28).h)));
    if (Math.max(...hs) + 24 <= rowH) break;
  }
  const H = HH + rowH * nr, y0 = o.top + (avail - H) / 2, hf = Math.min(fs + 2, 30);
  const lines = (cx, cy, b, f, fill, kc, W, anchor) => {          // English block (+ Arabic under it), centred on cy
    let y = cy - b.h / 2, g = "";
    b.e.forEach((l) => { y += f * 1.22; g += T(cx, y - f * 0.27, l, f, fill, { b: anchor === "start" || anchor === "hdr", a: anchor === "start" ? "start" : "middle", maxW: W }); });
    b.a.forEach((l) => { y += afs(f) * 1.25; g += (anchor === "start" ? AT(cx + W, y - afs(f) * 0.27 + 2, l, afs(f), kc, W, { b: 1 }) : T(cx, y - afs(f) * 0.27 + 2, l, afs(f), kc, { b: 1, maxW: W })); });
    return g;
  };
  let g = `<rect x="40" y="${y0}" width="1120" height="${H}" rx="24" fill="${TH.card}" ${SH}/><clipPath id="tc"><rect x="40" y="${y0}" width="1120" height="${H}" rx="24"/></clipPath><g clip-path="url(#tc)">`;
  g += `<rect x="40" y="${y0}" width="${LW}" height="${HH}" fill="${TH.soft}"/>`;
  cols.forEach((c, i) => {
    const x = 40 + LW + i * CW;
    g += `<rect x="${x}" y="${y0}" width="${CW}" height="${HH}" fill="url(#g-${c.c})"/>`;
    if (bi) { const a1 = oneLine(c.h, hf, CW - 24, true, 15), a2 = c.ha ? oneLine(c.ha, afs(hf), CW - 24, true, 13) : null; g += stack(x + CW / 2, y0 + HH / 2, [{ s: c.h, fs: a1.fs, b: 1, fill: "#fff" }, ...(a2 ? [{ s: c.ha, fs: a2.fs, b: 1, fill: "#fff", x: ' fill-opacity=".92"' }] : [])], CW - 24); }
    else { const hl = wrap(c.h, hf, CW - 24, true).slice(0, 2); hl.forEach((l, j) => { g += T(x + CW / 2, y0 + HH / 2 - (hl.length - 1) * hf * 0.56 + hf * 0.36 + j * hf * 1.12, l, hf, "#fff", { b: 1, maxW: CW - 24 }); }); }
  });
  rows.forEach((r, ri) => {
    const y = y0 + HH + ri * rowH, cy = y + rowH / 2;
    g += `<rect x="40" y="${y}" width="1120" height="${rowH}" fill="${ri % 2 ? TH.card : TH.soft2}"/><rect x="40" y="${y}" width="${LW}" height="${rowH}" fill="${TH.soft}" fill-opacity="${ri % 2 ? 0.55 : 0.9}"/>`;
    g += lines(58, cy, blk(r.h, r.ha, fs, LW - 34, true), fs, TH.ink, TH.accent, LW - 34, "start");
    r.v.forEach((v, ci) => { g += lines(40 + LW + ci * CW + CW / 2, cy, blk(v, r.va[ci], fs, CW - 28), fs, TH.ink, kcol(cols[ci].c), CW - 28, "mid"); });
  });
  for (let i = 0; i < nc; i++) g += `<line x1="${40 + LW + i * CW}" x2="${40 + LW + i * CW}" y1="${y0}" y2="${y0 + H}" stroke="${TH.line}" stroke-width="2"/>`;
  g += `</g><rect x="40" y="${y0}" width="1120" height="${H}" rx="24" fill="none" stroke="${TH.accent}" stroke-width="3"/>`;
  return g;
}

/* ───────────── layout 3: mnemonic (big letters) ───────────── */
function mnemonic(items, o) {
  const bi = o.bi;
  const n = items.length, cols = (bi ? n > 2 : n > 4) ? 2 : 1, rn = Math.ceil(n / cols), gap = 18, w = (1120 - gap * (cols - 1)) / cols, avail = o.bottom - o.top;
  const rowH = Math.min(bi ? 168 : 150, (avail - gap * (rn - 1)) / rn), tile = Math.min(rowH - 24, 120), tx = tile + 40, textW = w - tx - 22;
  const y0 = o.top + (avail - (rn * rowH + gap * (rn - 1))) / 2;
  let fs;
  const parts = (it, f) => ({
    hl: bi ? [it.h] : wrap(it.h, f + 4, textW, true).slice(0, 2),
    hal: bi && it.ha ? [it.ha] : [],
    bl: it.b.slice(0, bi ? 1 : 2).map((b, j) => bullet(b, f, textW, bi ? it.ba[j] : "")),
  });
  const height = (p, f) => p.hl.length * (f + 4) * 1.15 + p.hal.length * afs(f + 4) * 1.25 + p.bl.reduce((a, x) => a + bh(x, 1.25), 0) + 8;
  for (fs = 30; fs >= (bi ? 16 : 18); fs--) if (Math.max(...items.map((it) => height(parts(it, fs), fs))) <= rowH - 20) break;
  let g = "";
  items.forEach((it, i) => {
    const r = Math.floor(i / cols), c = i - r * cols, x = 40 + c * (w + gap), y = y0 + r * (rowH + gap), main = COL[it.c][0], dark = kcol(it.c), p = parts(it, fs);
    g += `<rect x="${x}" y="${y}" width="${w}" height="${rowH}" rx="${RAD}" fill="${fillOf(it.c)}" ${SH}/>`;
    if (STY.card !== "clean") g += `<rect x="${x}" y="${y}" width="${w}" height="${rowH}" rx="${RAD}" fill="none" stroke="${main}" stroke-opacity="${STY.card === "tint" ? 0.55 : 1}" stroke-width="${STY.card === "tint" ? 2 : 3}"/>`;
    const ty0 = y + (rowH - tile) / 2;
    g += `<rect x="${x + 12}" y="${ty0}" width="${tile}" height="${tile}" rx="20" fill="url(#g-${it.c})"/>` + T(x + 12 + tile / 2, ty0 + tile / 2 + tile * 0.22, (it.l || it.h[0] || "?").toUpperCase().slice(0, 2), Math.round(tile * 0.62), "#fff", { b: 1 });
    let ty = y + (rowH - height(p, fs)) / 2 + (fs + 4) * 0.95;
    p.hl.forEach((l) => { g += T(x + tx, ty, l, fs + 4, dark, { b: 1, a: "start", maxW: textW }); ty += (fs + 4) * 1.15; });
    p.hal.forEach((l) => { g += AT(x + tx + textW, ty - (fs + 4) * 0.1, l, afs(fs + 4), dark, textW, { b: 1 }); ty += afs(fs + 4) * 1.25; });
    ty += 4;
    p.bl.forEach((b) => { g += bulletSvg(x + tx, ty, b, fs, dark, 1.25, textW, x + tx + textW); ty += bh(b, 1.25); });
  });
  return g;
}

/* ───────────── layout 4: pyramid (priority / hierarchy) ───────────── */
function pyramid(items, o) {
  const bi = o.bi;
  const n = items.length, avail = o.bottom - o.top, gap = 6, lh = Math.min(bi ? 132 : 124, (avail - gap * (n - 1)) / n), H = lh * n + gap * (n - 1), y0 = o.top + (avail - H) / 2;
  const cx = 360, topHW = 110, botHW = 322, hw = (y) => topHW + ((botHW - topHW) * (y - y0)) / H;
  const take = bi ? 1 : 2;
  const side = (it, f) => ({ en: wrap(it.b.slice(0, take).join(". "), f, 430), ar: bi && it.ba.length ? wrap(it.ba.slice(0, take).join("، "), afs(f), 430).slice(0, 2) : [] });
  const sh = (s, f) => s.en.length * f * 1.25 + (s.ar.length ? s.ar.length * afs(f) * 1.25 + 4 : 0);
  let fs;
  for (fs = 28; fs >= (bi ? 16 : 18); fs--) if (Math.max(...items.map((it) => sh(side(it, fs), fs))) <= lh - 10) break;
  let g = "";
  items.forEach((it, i) => {
    const ya = y0 + i * (lh + gap), yb = ya + lh, ha = hw(ya), hb = hw(yb), ym = ya + lh / 2, main = COL[it.c][0], full = ha + hb - 36;
    g += `<polygon points="${cx - ha},${ya} ${cx + ha},${ya} ${cx + hb},${yb} ${cx - hb},${yb}" fill="url(#g-${it.c})" ${SH}/>`;
    let hf = 30, hl, hal = [];
    for (; hf >= 16; hf--) {
      hl = wrap(it.h, hf, full, true); hal = bi && it.ha ? wrap(it.ha, afs(hf), full).slice(0, 1) : [];
      if (hl.length <= (bi ? 1 : 2) && hl.length * hf * 1.12 + hal.length * afs(hf) * 1.15 <= lh - 12) break;
    }
    if (bi) g += stack(cx, ym, [...hl.map((l) => ({ s: l, fs: hf, b: 1, fill: "#fff" })), ...hal.map((l) => ({ s: l, fs: afs(hf), b: 1, fill: "#fff", x: ' fill-opacity=".92"' }))], full);
    else hl.forEach((l, j) => { g += T(cx, ym - (hl.length - 1) * hf * 0.56 + hf * 0.36 + j * hf * 1.12, l, hf, "#fff", { b: 1, maxW: full }); });
    g += `<line x1="${cx + (ha + hb) / 2 + 6}" y1="${ym}" x2="696" y2="${ym}" stroke="${main}" stroke-width="3" stroke-dasharray="6 7" stroke-linecap="round"/><rect x="700" y="${ya + 6}" width="7" height="${lh - 12}" rx="3.5" fill="${main}"/>`;
    const s = side(it, fs), tot = sh(s, fs);
    let yy = ym - tot / 2;
    s.en.forEach((l) => { yy += fs * 1.25; g += T(724, yy - fs * 0.3, l, fs, TH.ink, { a: "start", maxW: 436 }); });
    s.ar.forEach((l) => { yy += afs(fs) * 1.25 + (l === s.ar[0] ? 4 : 0); g += AT(1160, yy - afs(fs) * 0.3, l, afs(fs), kcol(it.c), 436, { b: 1 }); });
  });
  return g;
}

/* ───────────── layout 5: hub (one idea, several aspects) ───────────── */
function hub(items, root, rootAr, o) {
  const bi = o.bi;
  const n = items.length, avail = o.bottom - o.top, nw = n >= 5 ? 318 : 380;
  const take = bi ? 1 : 2;
  const measure = (fs) => items.map((it) => ({
    hl: bi ? [it.h] : wrap(it.h, fs + 4, nw - 30, true).slice(0, 2),
    hal: bi && it.ha ? [it.ha] : [],
    bs: it.b.slice(0, take).map((b, j) => bullet(b, fs, nw - 56, bi ? it.ba[j] : "")),
  }));
  const nodeH = (m, fs) => 26 + m.hl.length * (fs + 4) * 1.15 + m.hal.length * afs(fs + 4) * 1.25 + m.bs.reduce((a, x) => a + bh(x, 1.25), 0) + m.bs.length * 6;
  const cap = Math.min(bi ? 215 : 200, (avail - 110) / 2);
  let fs, m, nh;
  for (fs = 28; fs >= (bi ? 15 : 17); fs--) { m = measure(fs); nh = Math.max(90, ...m.map((x) => nodeH(x, fs))); if (nh <= cap) break; }
  const yT = o.top + nh / 2 + 2, yB = o.bottom - nh / 2 - 2, L = 40 + nw / 2, Rr = 1160 - nw / 2, half = nw / 2 + 28, cy = (yT + yB) / 2;
  const POS = { 3: [[600, yT], [L, yB], [Rr, yB]], 4: [[L, yT], [Rr, yT], [L, yB], [Rr, yB]], 5: [[L, yT], [600, yT], [Rr, yT], [600 - half, yB], [600 + half, yB]], 6: [[L, yT], [600, yT], [Rr, yT], [L, yB], [600, yB], [Rr, yB]] }[n];
  const rc = n === 4 ? 92 : Math.max(48, Math.min(92, (yB - yT - nh) / 2 - 8));
  let g = "";
  POS.forEach(([x, y], i) => { g += `<line x1="600" y1="${cy}" x2="${x.toFixed(0)}" y2="${y.toFixed(0)}" stroke="${COL[items[i].c][0]}" stroke-opacity=".55" stroke-width="5" stroke-linecap="round"/>`; });
  g += `<circle cx="600" cy="${cy}" r="${rc}" fill="url(#hg)" ${SH}/>`;
  let rf = 30, rl, ral = [];
  for (; rf >= 14; rf--) {
    rl = wrap(root, rf, rc * 1.55, true); ral = bi && rootAr ? wrap(rootAr, afs(rf), rc * 1.55).slice(0, 2) : [];
    if (rl.length <= 3 && rl.length * rf * 1.12 + ral.length * afs(rf) * 1.15 <= rc * 1.4) break;
  }
  g += stack(600, cy, [...rl.map((l) => ({ s: l, fs: rf, b: 1, fill: "#fff" })), ...ral.map((l) => ({ s: l, fs: afs(rf), b: 1, fill: "#fff", x: ' fill-opacity=".92"' }))], rc * 1.6);
  items.forEach((it, i) => {
    const [x, y] = POS[i], main = COL[it.c][0], dark = kcol(it.c), X = x - nw / 2, Y = y - nh / 2, k = m[i];
    g += `<rect x="${X.toFixed(0)}" y="${Y.toFixed(0)}" width="${nw}" height="${nh}" rx="22" fill="${fillOf(it.c)}" ${SH}/>`;
    if (STY.card !== "clean") g += `<rect x="${X.toFixed(0)}" y="${Y.toFixed(0)}" width="${nw}" height="${nh}" rx="22" fill="none" stroke="${main}" stroke-opacity="${STY.card === "tint" ? 0.55 : 1}" stroke-width="${STY.card === "tint" ? 2 : 3}"/>`;
    g += `<rect x="${(X + 14).toFixed(0)}" y="${(Y + 10).toFixed(0)}" width="${nw - 28}" height="6" rx="3" fill="${main}"/>`;
    let ty = Y + 20 + (fs + 4) * 0.95;
    k.hl.forEach((l) => { g += T(x, ty, (it.e && k.hl.length === 1 && mw(it.e + " " + l, fs + 4, true) <= nw - 30 ? it.e + " " : "") + l, fs + 4, dark, { b: 1, maxW: nw - 30 }); ty += (fs + 4) * 1.15; });
    k.hal.forEach((l) => { g += T(x, ty - (fs + 4) * 0.12, l, afs(fs + 4), dark, { b: 1, maxW: nw - 30 }); ty += afs(fs + 4) * 1.25; });
    ty += 2;
    k.bs.forEach((b) => { g += `<circle cx="${(X + 24).toFixed(0)}" cy="${Math.round(ty - fs * 0.3)}" r="4.5" fill="${main}"/>` + bulletSvg(X + 40, ty, b, fs, dark, 1.25, nw - 56, X + nw - 16); ty += bh(b, 1.25) + 6; });
  });
  return g;
}

/* ───────────── layout 6: cycle ───────────── */
function cycle(items, o) {
  const bi = o.bi;
  const n = items.length, cy = (o.top + o.bottom) / 2, nw = 320, nh = bi ? 120 : 108, ry = (o.bottom - o.top) / 2 - nh / 2 - 8, rx = 560 - nw / 2;
  const ang = (i) => -Math.PI / 2 + (2 * Math.PI * i) / n, d = ((2 * Math.PI) / n) * 0.3;
  const P = (a) => [600 + rx * Math.cos(a), cy + ry * Math.sin(a)];
  let g = "";
  for (let i = 0; i < n; i++) {
    const [x1, y1] = P(ang(i) + d), [x2, y2] = P(ang(i + 1) - d);
    g += `<path d="M${x1.toFixed(0)} ${y1.toFixed(0)}A${rx} ${ry} 0 0 1 ${x2.toFixed(0)} ${y2.toFixed(0)}" fill="none" stroke="${TH.accent}" stroke-width="5" stroke-linecap="round" marker-end="url(#ar)"/>`;
  }
  items.forEach((it, i) => {
    const [x, y] = P(ang(i)), hl = wrap((it.e && mw(it.e + " " + it.h, 28, true) <= nw - 30 ? it.e + " " : "") + it.h, 28, nw - 30, true).slice(0, bi ? 1 : 2);
    g += `<rect x="${(x - nw / 2).toFixed(0)}" y="${(y - nh / 2).toFixed(0)}" width="${nw}" height="${nh}" rx="28" fill="url(#g-${it.c})" ${SH}/>`;
    if (bi) {
      const full = (it.e ? it.e + " " : "") + it.h, a1 = oneLine(full, 28, nw - 30, true, 17), a2 = it.ha ? oneLine(it.ha, 24, nw - 30, true, 15) : null;
      g += stack(x, y, [{ s: full, fs: a1.fs, b: 1, fill: "#fff" }, ...(a2 ? [{ s: it.ha, fs: a2.fs, b: 1, fill: "#fff", x: ' fill-opacity=".92"' }] : [])], nw - 30);
      return;
    }
    const sub = hl.length === 1 && it.b[0] ? wrap(it.b[0].replace(/^[^:]{1,28}:\s*/, ""), 22, nw - 30)[0] : "";
    const lines = hl.length + (sub ? 0.75 : 0), top = y - (lines * 34) / 2 + 26;
    hl.forEach((l, j) => { g += T(x, top + j * 34, l, 28, "#fff", { b: 1, maxW: nw - 30 }); });
    if (sub) g += T(x, top + 34, sub, 22, "#fff", { x: ' fill-opacity=".92"', maxW: nw - 30 });
  });
  return g;
}

/* ───────────── background + header in the current look ───────────── */
function backdrop() {
  const p = TH.pat;
  let g = `<rect width="1200" height="800" fill="url(#bg)"/>`;
  if (STY.pat === "dots") g += `<rect width="1200" height="800" fill="url(#pt)"/>`;
  else if (STY.pat === "grid") g += `<rect width="1200" height="800" fill="url(#pt)"/>`;
  else if (STY.pat === "stripes") g += `<rect width="1200" height="800" fill="url(#pt)"/>`;
  else if (STY.pat === "circles") g += `<circle cx="1150" cy="760" r="230" fill="${p}" fill-opacity=".07"/><circle cx="60" cy="720" r="150" fill="${p}" fill-opacity=".06"/><circle cx="1010" cy="-20" r="130" fill="${p}" fill-opacity=".06"/>`;
  return g;
}
function patternDef() {
  const p = TH.pat, a = TH.dark ? 0.12 : 0.11;
  if (STY.pat === "dots") return `<pattern id="pt" width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.6" fill="${p}" fill-opacity="${a}"/></pattern>`;
  if (STY.pat === "grid") return `<pattern id="pt" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="${p}" stroke-opacity="${a}" stroke-width="1.2"/></pattern>`;
  if (STY.pat === "stripes") return `<pattern id="pt" width="26" height="26" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="9" height="26" fill="${p}" fill-opacity="${a * 0.7}"/></pattern>`;
  return "";
}
function header({ icon, title, tfs, sub }) {
  const H = TH.hdr, st = STY.hdr;
  let g = "", tx = 600, anchor = "middle", maxT = icon ? 920 : 1040, tcol = "#fff", scol = TH.sub;
  if (st === "band") {
    g += `<rect x="40" y="28" width="1120" height="112" rx="28" fill="url(#hg)" ${SH}/>`;
    if (icon) g += `<circle cx="108" cy="84" r="40" fill="#fff" fill-opacity=".16"/>` + T(108, 100, icon, 44, "#fff");
  } else if (st === "flat") {
    g += `<rect x="0" y="0" width="1200" height="148" fill="${H[0]}"/><rect x="0" y="144" width="1200" height="8" fill="${TH.accent}"/><rect x="0" y="144" width="1200" height="8" fill="url(#hg)" fill-opacity=".7"/>`;
    if (icon) g += `<circle cx="108" cy="76" r="40" fill="#fff" fill-opacity=".14"/>` + T(108, 92, icon, 44, "#fff");
  } else if (st === "left") {
    tcol = TH.dark ? "#FFFFFF" : TH.ink; scol = TH.dark ? TH.sub : mix(TH.ink, "#FFFFFF", 0.35); anchor = "start"; tx = icon ? 170 : 60; maxT = icon ? 980 : 1090;
    if (icon) g += `<circle cx="104" cy="82" r="44" fill="url(#hg)" ${SH}/>` + T(104, 98, icon, 44, "#fff");
    g += `<rect x="${tx}" y="138" width="170" height="7" rx="3.5" fill="${TH.accent}"/>`;
  } else {                                                // pill
    g += `<rect x="40" y="30" width="1120" height="108" rx="54" fill="${TH.card}" ${SH}/><rect x="40" y="30" width="1120" height="108" rx="54" fill="none" stroke="${TH.accent}" stroke-width="3"/>`;
    if (icon) g += `<circle cx="104" cy="84" r="40" fill="url(#hg)"/>` + T(104, 100, icon, 42, "#fff");
    tcol = TH.dark ? "#FFFFFF" : TH.hdr[0]; scol = TH.dark ? TH.sub : TH.accent; maxT = icon ? 900 : 1010;
  }
  const cx = anchor === "start" ? tx : st === "pill" || st === "band" || st === "flat" ? (icon ? 620 : 600) : tx;
  /* "start" means the RIGHT edge for Arabic (RTL) text, so left-aligned lines are placed by measuring and centring instead: same result everywhere */
  const put = (y, s, fs, fill, o) => (anchor === "start" ? T(cx + Math.min(mw(s, fs, o.b), o.maxW) / 2, y, s, fs, fill, { b: o.b, maxW: o.maxW }) : T(cx, y, s, fs, fill, o));
  g += put(sub ? 82 : 96, title, tfs, tcol, { b: 1, maxW: maxT });
  if (sub) g += put(122, sub, 26, scol, { maxW: maxT - 20 });
  return g;
}

/* ───────────── assembly ───────────── */
const ALIAS = { tree: "cards", overview: "cards", process: "steps", flow: "steps", timeline: "steps", vs: "compare", versus: "compare", loop: "cycle", matrix: "table", comparison: "table", mnemo: "mnemonic", map: "hub", concept: "hub", priority: "pyramid", triangle: "pyramid" };
const MAXN = { cards: 6, steps: 5, compare: 2, cycle: 6, mnemonic: 6, pyramid: 5, hub: 6 };
const hasAr = (d) => {
  const items = Array.isArray(d.items) ? d.items : [];
  return !!(d.rootAr || d.tipAr || items.some((it) => it && (it.ha || (Array.isArray(it.ba) && it.ba.length))) ||
    (Array.isArray(d.cols) && d.cols.some((c) => c && c.ha)) || (Array.isArray(d.rows) && d.rows.some((r) => r && (r.ha || (Array.isArray(r.va) && r.va.length)))));
};

/* → { svg, style, type, bilingual }.  opts.style = a look to reuse; opts.avoid = a look NOT to repeat (restyle) */
export function renderInfographicEx(d, opts = {}) {
  const style = opts.style && PALETTES[opts.style.theme] ? opts.style : pickStyle(opts.avoid);
  STY = style; TH = PALETTES[style.theme]; COL = TH.pal; RAD = style.card === "tint" ? 18 : style.card === "clean" ? 30 : 24;
  const bi = opts.bilingual != null ? !!opts.bilingual && hasAr(d) : hasAr(d);

  let type = String(d.type || "cards").toLowerCase(); type = ALIAS[type] || type;
  if (type !== "table" && !MAXN[type]) type = "cards";
  const root = str(d.root, 36), rootAr = bi ? str(d.rootAr, 40) : "";
  const items = type === "table" ? [] : (Array.isArray(d.items) ? d.items : []).slice(0, MAXN[type]).map((it, i) => {
    const b = Array.isArray(it && it.b) ? it.b : it && it.b ? [it.b] : [];
    const ba = Array.isArray(it && it.ba) ? it.ba : it && it.ba ? [it.ba] : [];
    const bb = b.map((x) => str(x, 80)), out = { h: str(it && it.h, 40), ha: bi ? str(it && it.ha, 44) : "", l: str(it && it.l, 2), e: str(it && it.e, 4), c: it && COL[it.c] ? it.c : ORDER[i % 6], b: [], ba: [] };
    bb.forEach((x, j) => { if (x && out.b.length < 4) { out.b.push(x); out.ba.push(bi ? str(ba[j], 90) : ""); } });
    return out;
  }).filter((it) => it.h);
  if (type !== "table" && (items.length < 2 || (type === "compare" && items.length !== 2) || (type === "hub" && (items.length < 3 || !root)) || ((type === "pyramid" || type === "cycle" || type === "mnemonic") && items.length < 3))) throw new Error("few items");
  if (type === "cards" && items.length > 4) items.forEach((it) => { it.b = it.b.slice(0, 2); it.ba = it.ba.slice(0, 2); });
  if (bi && items.length > 4) items.forEach((it) => { it.b = it.b.slice(0, 1); it.ba = it.ba.slice(0, 1); });
  const title = str(d.title, 60), icon = str(d.icon, 4), ar = str(d.ar, 60), sub = ar || str(d.subtitle, 80);
  let tfs = 48; while (tfs > 28 && mw(title, tfs, true) > (icon ? 900 : 1020)) tfs--;
  const tip = str(d.tip, 100), tipAr = bi && tip ? str(d.tipAr, 120) : "";
  const tipH = tipAr ? 104 : 80, tipY = 780 - tipH, bottom = tip ? tipY - 20 : 766, top = 160;
  const o = { top, bottom, bi };
  let body = "";
  if (type === "table") body = table(d, o);
  else if (type === "cycle") body = cycle(items, o);
  else if (type === "mnemonic") body = mnemonic(items, o);
  else if (type === "pyramid") body = pyramid(items, o);
  else if (type === "hub") body = hub(items, root, rootAr, o);
  else {
    const tree = type === "cards" && root && items.length <= 4;
    const r = cardGrid(items, { ...o, top: tree ? (bi && rootAr ? 282 : 262) : top, gap: type === "steps" ? 52 : type === "compare" ? 88 : 24, badge: type === "steps" ? "steps" : type === "compare" ? "vs" : null });
    if (tree) {
      const y0 = r.cards[0].y, xs = r.cards.map((c) => c.cx), ry = bi && rootAr ? 78 : 58;
      body += `<rect x="380" y="158" width="440" height="${ry}" rx="${ry / 2}" fill="url(#hg)" ${SH}/>`;
      body += bi && rootAr ? stack(600, 158 + ry / 2, [{ s: root, fs: 26, b: 1, fill: "#fff" }, { s: rootAr, fs: 22, b: 1, fill: "#fff", x: ' fill-opacity=".92"' }], 400) : T(600, 197, root, 28, "#fff", { b: 1, maxW: 400 });
      const jy = 158 + ry + 23;
      body += `<path d="M600 ${158 + ry}V${jy}M${xs[0]} ${y0}V${jy}H${xs[xs.length - 1]}V${y0}" stroke="${TH.accent}" stroke-width="4" fill="none" stroke-linejoin="round"/>`;
      xs.slice(1, -1).forEach((cx) => { body += `<path d="M${cx} ${jy}V${y0}" stroke="${TH.accent}" stroke-width="4" fill="none"/>`; });
    }
    body += r.g;
  }
  const defs = Object.entries(COL).map(([k, [a, b]]) => `<linearGradient id="g-${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`).join("");
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800" width="1200" height="800"><defs>${defs}` +
    `<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${TH.bg[0]}"/><stop offset="1" stop-color="${TH.bg[1]}"/></linearGradient>` +
    `<linearGradient id="hg" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${TH.hdr[0]}"/><stop offset="1" stop-color="${TH.hdr[1]}"/></linearGradient>` +
    patternDef() +
    `<filter id="sh" x="-10%" y="-10%" width="120%" height="125%"><feDropShadow dx="0" dy="6" stdDeviation="8" flood-color="${TH.dark ? "#000000" : TH.ink}" flood-opacity="${TH.dark ? 0.5 : 0.18}"/></filter>` +
    `<marker id="ar" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0 0L8 4L0 8z" fill="${TH.accent}"/></marker></defs>` +
    backdrop() + header({ icon, title, tfs, sub });
  svg += body;
  if (tip) {
    let f = tipAr ? 24 : 26; while (f > 20 && mw(tip, f, true) > 1050) f--;
    svg += `<rect x="40" y="${tipY}" width="1120" height="${tipH}" rx="24" fill="${TH.tip.fill}" stroke="${TH.tip.stroke}" stroke-width="3"/>` + T(600, tipY + 28, "NCLEX TIP", 20, TH.tip.label, { b: 1, x: ' letter-spacing="3"' }) + T(600, tipY + (tipAr ? 62 : 63), tip, f, TH.tip.text, { b: 1, maxW: 1060 });
    if (tipAr) svg += T(600, tipY + 92, tipAr, 22, TH.tip.label, { b: 1, maxW: 1060 });
  }
  svg += "</svg>";
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("svg");
  return { svg, style, type, bilingual: bi };
}

export const renderInfographic = (d, opts) => renderInfographicEx(d, opts).svg;
