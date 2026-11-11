/* ───────────── Pictures in the chat ─────────────
   Google does NOT give image generation to free API keys, so the default engine is the infographic:

     diagram  the free TEXT model writes a tiny JSON, our own code lays it out (see infographic.js). Fast, tidy, words spelled right.
     gemini   Google's Nano Banana models — only works when the API key has billing enabled.

   Order:  diagram → [diagram]   gemini → [gemini, diagram]
   (The free "real picture" engine, Pollinations/FLUX, was removed: slow, unreliable and the pictures were not good enough.) */

import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { getModelLists, runTask, generateImage } from "./gemini.js";
import { sourceParts } from "./docs.js";
import { fixText } from "./text.js";
import { infoSystem, parseInfo, renderInfographicEx } from "./infographic.js";
import { imagePrompt } from "./chat.js";

export const ENGINES = [
  { id: "diagram", label: "رسم توضيحي", hint: "دقيق وبعناوين صح · مجاني" },
  { id: "gemini", label: "Gemini 💳", hint: "أعلى جودة · بيحتاج Billing" },
];
const LABEL = { diagram: "رسم توضيحي", gemini: "Gemini" };
const LS_ENGINE = "clinix:imgengine";
const LS_BLOCK = "clinix:imgblock:gemini";

export const getEngine = () => { try { const e = window.localStorage.getItem(LS_ENGINE); return ENGINES.some((x) => x.id === e) ? e : "diagram"; } catch (e) { return "diagram"; } };
export const setEngine = (id) => { try { window.localStorage.setItem(LS_ENGINE, id); } catch (e) { /* ignore */ } };

const abortError = () => Object.assign(new Error("aborted"), { name: "AbortError" });
const cap = (s, n) => ((s || "").length > n ? (s || "").slice(0, n) + "…" : (s || ""));
const toB64 = (str) => btoa(unescape(encodeURIComponent(str)));

/* ── SVG: clean it, make sure it is well-formed, never let it run anything ── */
export function cleanSvg(raw) {
  let s = String(raw || "").replace(/^\s*```[a-z]*\s*/i, "").replace(/```\s*$/i, "").trim();
  const a = s.indexOf("<svg"), b = s.lastIndexOf("</svg>");
  if (a < 0 || b < 0) throw new Error("الموديل ما رجّعش رسم صالح.");
  s = fixText(s.slice(a, b + 6))
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "")
    .replace(/<image\b[^>]*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, "")
    .replace(/\s(?:xlink:)?href\s*=\s*("|')(?!#)[^"']*\1/gi, "")
    .replace(/@import[^;]*;/gi, "")
    .replace(/url\(\s*(['"]?)(?!#)[^)]*\)/gi, "none");
  if (!/xmlns\s*=/.test(s.slice(0, 400))) s = s.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
  const doc = new DOMParser().parseFromString(s, "image/svg+xml");
  const bad = doc.getElementsByTagName("parsererror")[0];
  if (bad) throw Object.assign(new Error("الرسم طلع بصيغة غلط."), { svgError: String(bad.textContent || "").slice(0, 160) });
  return s;
}

const DIAGRAM_SYSTEM = `You are a top information designer. You make beautiful, cheerful, perfectly organised educational infographics for an Arabic-speaking nursing student preparing for the NCLEX-RN.

OUTPUT: ONE self-contained SVG and NOTHING else (no markdown, no comments). It starts with <svg and ends with </svg>.

TECH (the SVG is shown inside an <img>): xmlns="http://www.w3.org/2000/svg", viewBox="0 0 1200 800" (900 900 for a cycle). No px width/height. No <script>, <foreignObject>, <image>, external URL, @import or web font. font-family="Arial, Helvetica, sans-serif". Keep the code SHORT: one <style> block with reusable classes, integers only, <use> for repeated shapes, gradients and one soft-shadow filter (feGaussianBlur) inside <defs>.
Palette: ink #0B2A30, teal #0E7C8F, sky #25A3DC, coral #E8664D, amber #F2B134, violet #6B5BD2, green #2FA56B, soft #EAF6F8 / #FFF4E0. Background: a very light gradient (#F4FBFC to #FFFFFF).

LAYOUT (this is what makes it look professional):
1. Plan a grid first: 40px margins, equal gaps. Header band (rounded, dark teal gradient, y 30-130) with the English title in white (48px bold) and a short subtitle in sky blue (26px).
2. Under it ONE clear structure: tree (root on top, 3-4 cards joined by elbow connectors) | numbered steps left to right with chevron arrows | cycle on a circle | 2-column compare with a "VS" badge | cause-to-effect chain | mnemonic letter cards.
3. Cards: equal size, rounded 24, white fill, a coloured header strip (about 64px) with white heading text, soft shadow. At most 4 bullets per card, each 1 to 5 words.
4. TEXT SIZE: headings 32, body 28, NEVER below 26. At most about 60 words in total. If it does not fit, cut words, never shrink the font. Roughly 14px per character at 28px: split long labels into short lines with separate <text> elements and make sure each line fits inside its card.
5. Fill the canvas: the content uses at least 85% of the width and height, no big empty areas, nothing overlapping, everything centred on its card (text-anchor="middle").
6. One simple icon per card: a coloured circle with a symbol, or one emoji (48px) in the header. Colour carries meaning: coral danger/abnormal, green safe/normal, amber caution, violet info, sky neutral, teal main.
7. If there is a key exam point, finish with a rounded "NCLEX Tip" strip (fill #FFF4E0, 26px text, one short sentence).

Labels are in ENGLISH, spelled exactly right. Arabic only if the student asks (direction="rtl", text-anchor="middle"). Medical accuracy first: never invent values, anatomy or drugs.
Before you output, check silently: well-formed XML, every tag closed, every text inside its card and the canvas.`;

/* what the student's sentence asks for */
export const WANTS_AR = /(ترجم|ترجمة|الترجمه|بالعربي|بالعربى|عربي تحت|تحت\s*ال(ا|إ|أ)?نجليز|تحته|تحتها|بلغتين|ثنائي اللغ|translation|bilingual|arabic)/i;
export const WANTS_REDO = /(اعد|أعد|اعيد|أعيد|إعادة|اعادة|من جديد|تاني|مرة تانية|عدّل|عدل|غيّر|غير|بدّل|بدل|زوّد|زود|ضيف|أضف|اضف|احذف|شيل|redo|again|regenerate|modify|change|add|remove)/i;
export const WANTS_RESTYLE = /^\s*(غيّر|غير|بدّل|بدل|عايز|اعمل)?\s*(ال)?(ستايل|شكل|الشكل|الالوان|الألوان|التصميم|الثيم|style|theme|colors?|look)\b/i;

/* the JSON is cached, not the drawing: the same request again is instant AND comes out in a new look */
const INFO_CACHE = new Map();
const toSvg = (spec, opts) => { const r = renderInfographicEx(spec, opts); return { mime: "image/svg+xml", data: toB64(r.svg), text: "", spec, style: r.style, bilingual: r.bilingual }; };

/* re-draw an existing infographic in another look (no model call) */
export function restyle(spec, avoidStyle) { return toSvg(spec, { avoid: avoidStyle }); }

async function runDiagram({ apiKey, ctx, request, atts, signal, prev, bilingual }) {
  const lists = getModelLists(apiKey);
  const refs = atts && atts.length ? sourceParts({ kind: "bundle", items: atts }, null) : [];
  /* fast path: tiny JSON from the model + our own layout engine (seconds, always tidy, never overflows). Same request again → instant (cache). */
  const prevSpec = prev && prev.spec;
  const bi = bilingual != null ? !!bilingual : WANTS_AR.test(request);
  const redo = !!prevSpec;                                   // "re-create it / add the translation / change …" → work FROM the previous graphic
  const ckey = `${request.trim().toLowerCase()}|${cap(ctx.question, 300)}|${bi ? "ar" : "en"}`;
  if (!redo && INFO_CACHE.has(ckey)) return toSvg(INFO_CACHE.get(ckey), { avoid: prev && prev.style });
  const prevJson = redo ? JSON.stringify(prevSpec).slice(0, 6000) : "";
  const redoNote = redo
    ? `\n\nPREVIOUS INFOGRAPHIC (JSON) — the student wants a changed version of THIS graphic:\n${prevJson}\nKeep the same topic, type, items and facts. Apply ONLY what the request asks for${bi ? " (here: add the Arabic translation under every English line, using the bilingual fields)" : ""}; do not drop content. Return the complete new JSON.`
    : "";
  let bad = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const j = await runTask({
        apiKey, task: "lesson:diagram", signal, models: [...lists.fast, ...lists.pro],
        system: infoSystem({ bilingual: bi, avoidType: !redo && prev && prev.type ? prev.type : "" }) + (bad ? `\n\nYour previous reply could not be drawn (${bad}). Reply again with a valid JSON object that follows the rules.` : ""),
        parts: [...refs, { text: `CONTEXT — the question and lesson he is studying:\n${cap(ctx.question, 2000)}\n${cap(ctx.explanation, 3500)}\n\nSTUDENT REQUEST: ${request}${redoNote}` }],
        spec: { levels: ["low", "minimal"], budget: 512 }, maxOut: bi ? 6000 : 3500, hedgeMs: 6000, firstMs: 30000, idleMs: 25000,
      });
      const spec = parseInfo(j.text);
      const res = toSvg(spec, { avoid: prev && prev.style, bilingual: bi });
      if (bi && !res.bilingual) throw new Error("no arabic fields");        // asked for a translation but the JSON had none → ask again
      if (!redo) { if (INFO_CACHE.size > 24) INFO_CACHE.delete(INFO_CACHE.keys().next().value); INFO_CACHE.set(ckey, spec); }
      return res;
    } catch (e) { if (e && e.name === "AbortError") throw e; bad = String((e && e.message) || "invalid").slice(0, 80); }
  }
  /* last resort: free-form SVG written by the model (slower, less tidy) */
  let last = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const out = await runTask({
      apiKey, task: "lesson:diagram", signal, models: [...lists.fast, ...lists.pro],
      system: DIAGRAM_SYSTEM + (last ? `\n\nYour previous SVG was not valid XML (${last}). Output a corrected, well-formed SVG.` : ""),
      parts: [...refs, { text: `CONTEXT — the question and lesson he is studying:\n${cap(ctx.question, 1800)}\n${cap(ctx.explanation, 1800)}\n\nSTUDENT REQUEST: ${request}\n\nDraw it as one SVG.` }],
      spec: { levels: ["minimal", "low"], budget: 0 }, maxOut: 9000, hedgeMs: 15000, firstMs: 60000, idleMs: 45000,
    });
    try { return { mime: "image/svg+xml", data: toB64(cleanSvg(out.text)), text: "" }; }
    catch (e) { last = e.svgError || e.message; if (attempt) throw e; }
  }
  throw new Error("الرسم ما طلعش صح. جرّب توصفه بشكل تاني.");
}

/* ── Google's own model (only with billing) ── */
async function runGemini({ apiKey, ctx, request, atts, signal }) {
  try { if (+window.localStorage.getItem(LS_BLOCK) > Date.now()) throw Object.assign(new Error("الباقة المجانية مش بتدعم رسم الصور في Gemini."), { skip: true }); } catch (e) { if (e.skip) throw e; }
  const refs = atts && atts.length ? sourceParts({ kind: "bundle", items: atts }, null) : [];
  try {
    const out = await generateImage({ apiKey, prompt: imagePrompt(ctx, request), parts: refs, signal });
    return { mime: out.mime, data: out.data, text: out.text || "" };
  } catch (e) {
    if (e && e.billing) { try { window.localStorage.setItem(LS_BLOCK, String(Date.now() + 6 * 3600e3)); } catch (x) { /* ignore */ } }
    throw e;
  }
}

const RUN = { diagram: runDiagram, gemini: runGemini };

/* → { mime, data, text, engine, notes[] }   notes = what was tried and failed on the way */
export async function makePicture({ engine, apiKey, ctx, request, atts = [], signal, onStatus, prev = null, bilingual }) {
  const order = engine === "gemini" ? ["gemini", "diagram"] : ["diagram"];
  const notes = [];
  for (let i = 0; i < order.length; i++) {
    const e = order[i];
    if (signal && signal.aborted) throw abortError();
    try {
      onStatus && onStatus(e);
      const r = await RUN[e]({ apiKey, ctx, request, atts, signal, onStatus, prev, bilingual });
      return { ...r, engine: e, notes };
    } catch (err) {
      if (err && err.name === "AbortError") throw err;
      if (i === order.length - 1) throw err;
      notes.push(`${LABEL[e]}: ${(err && err.message) || "فشل"}`);
    }
  }
  throw new Error("معرفتش أرسم الصورة.");
}
