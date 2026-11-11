import React, { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import Icon from "./Icon.jsx";
import { RichText } from "./rich.jsx";
import ExamCard from "./ExamCard.jsx";
import FontSizer, { ScaledBox } from "./FontSizer.jsx";
import WaitCard from "./WaitCard.jsx";
import Sources from "./Sources.jsx";
import PhotoStrip from "./PhotoStrip.jsx";
import { fetchPhotos, photosOn as readPhotosOn, setPhotosOn as savePhotosOn, configuredSources } from "../lib/photos.js";
import { getEnginePrefs, setEnginePrefs } from "../lib/providers.js";
import { Lightbox, StrokeLayer, inkKey, loadInk, inkOnBlob } from "./ImageInk.jsx";
import { askChat, REPLY_LEVELS, DEFAULT_LEVEL, levelOf } from "../lib/chat.js";
import { stripPending } from "../lib/chatflow.js";
import { makeExam, wantsExam } from "../lib/exam.js";
import { splitCites } from "../lib/library.js";
import { makePicture, restyle, WANTS_AR, WANTS_REDO, WANTS_RESTYLE, ENGINES, getEngine, setEngine } from "../lib/imagegen.js";
import { readFiles, sourceParts, MAX_ITEMS } from "../lib/docs.js";
import { fixText } from "../lib/text.js";
import { store, prefs } from "../lib/storage.js";
import { loadIndex, loadConv, saveConv, removeConv, newConvId, convTitle } from "../lib/chathist.js";
import { stampShort } from "../lib/time.js";
import { saveImageFile } from "../lib/imgfile.js";
import { useBank, imgId, saveImage, removeImage, GLOBAL_LESSON } from "../lib/imagebank.js";

const uid = () => Math.random().toString(36).slice(2, 10);

/* While an answer streams, the list re-renders on every chunk. A finished message's text does not change, so it is not re-drawn
   (before: every earlier answer was parsed and laid out again on every chunk → a long chat got sluggish on a phone). */
const Rich = React.memo(function Rich({ text }) { return <RichText text={text} />; });
const IMG_INTENT = /^\s*(ارسم|ارسمي|ارسملي|ارسم لي|اعمل(لي| لي)?\s+(صورة|رسم|رسمة)|صمم(لي| لي)?\s+(صورة|رسم)|generate\s+(an?\s+)?image|draw\b|illustrate\b|make\s+(me\s+)?(an?\s+)?(image|picture|diagram))/i;

/* "re-create the picture / put the Arabic under the English / another style" must be understood as a request about the LAST picture */
const IMG_WORD = /(صور[ةه]|الصور|رسم|انفو|إنفو|infographic|diagram|مخطط|image|picture)/i;
const IMG_AGAIN = /(اعد|أعد|اعيد|أعيد|إعادة|اعادة|من جديد)/;

/* quick-start chips. send:false → the text is put in the box so the student finishes the sentence */
const SUGGEST_Q = [
  { label: "اشرحلي أكتر", text: "اشرحلي السؤال ده بشكل أعمق وبالتفصيل، خطوة بخطوة.", send: true },
  { label: "ليه الباقي غلط؟", text: "ليه كل اختيار من الاختيارات التانية غلط؟ وإيه الكلمة اللي بتكشفه؟", send: true },
  { label: "أنا معترض ✋", text: "أنا معترض على الإجابة، لأن ", send: false },
  { label: "ربطه بأسئلتي 🔗", text: "في أسئلة أو شروحات تانية من اللي ذاكرتها قبل كده ليها علاقة بالسؤال ده؟ وضّحلي الرابط بينهم.", send: true },
  { label: "امتحني فيه ✅", text: "اعملي امتحان 5 أسئلة على نفس فكرة السؤال ده", send: true, exam: true },
  { label: "ارسملي صورة 🎨", text: "ارسملي رسم توضيحي بسيط للفكرة الأساسية في السؤال، بعناوين إنجليزي واضحة.", send: true, image: true },
  { label: "اديني مثال شبهه", text: "اديني حالة مشابهة بس بأرقام وسيناريو مختلف، وخليني أحلها.", send: true },
  { label: "لخّصها في سطرين", text: "لخّصلي القاعدة اللي لازم أحفظها من السؤال ده في سطرين.", send: true },
];
const SUGGEST_G = [
  { label: "اعملي امتحان من أسئلتي ✅", text: "اعملي امتحان 10 أسئلة من الأسئلة والشروحات اللي ذاكرتها", send: true, exam: true },
  { label: "امتحان على موضوع…", text: "اعملي امتحان 10 أسئلة على ", send: false, exam: true },
  { label: "اشرحلي موضوع…", text: "اشرحلي من الصفر: ", send: false },
  { label: "لخّصلي اللي ذاكرته 📚", text: "لخّصلي أهم الأفكار والتريكات في الأسئلة والشروحات اللي ذاكرتها، مجمّعة حسب الموضوع.", send: true },
  { label: "إيه اللي بيتكرر معايا؟ 🔗", text: "إيه الفخاخ والأفكار اللي بتتكرر في أسئلتي المحفوظة؟ وإزاي أتجنبها؟", send: true },
  { label: "مقارنة بين…", text: "قارنلي في جدول بسيط بين ", send: false },
  { label: "ارسملي مخطط 🎨", text: "ارسملي مخطط يوضح ", send: false, image: true },
  { label: "خطة مراجعة 🗓️", text: "اعملي لي خطة مراجعة لمدة أسبوع بناءً على اللي ذاكرته.", send: true },
];

/* messages go to storage without bulky data: only the newest pictures (within ~3 MB) keep their pixels */
function forStorage(messages) {
  let budget = 3_000_000;
  const keep = new Set();
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.img && m.img.data.length <= budget) { keep.add(m.id); budget -= m.img.data.length; }
  }
  return messages.filter((m) => m.role !== "ai" || m.text || m.img || m.exam || m.err).slice(-60).map(({ id, role, text, atts, img, via, exam, refs, isExam, gen, sources, searched, cached, photos }) => ({ id, role, text, via, exam, refs, isExam, gen, sources, searched, cached, photos: photos && photos.state === "done" && photos.items && photos.items.length ? { state: "done", items: photos.items } : undefined, atts: (atts || []).map(({ name, label, t }) => ({ name, label, t })), img: img && keep.has(id) ? img : undefined }));
}

function GenImage({ img, via, busy, onRestyle, onTranslate, bank }) {
  const [big, setBig] = useState(false);
  const src = `data:${img.mime};base64,${img.data}`;
  const [inkVer, setInkVer] = useState(0);                 // bump → re-read the ink after the viewer closes
  const ink = React.useMemo(() => loadInk(inkKey(src)), [src, inkVer]);   // eslint-disable-line react-hooks/exhaustive-deps
  /* the gallery: the student alone decides which pictures stay (nothing is kept automatically) */
  const bid = React.useMemo(() => imgId(img), [img.data]);   // eslint-disable-line react-hooks/exhaustive-deps
  const saved = useBank().some((e) => e.id === bid);
  const [keepMsg, setKeepMsg] = useState("");
  const [keepBusy, setKeepBusy] = useState(false);
  const toggleKeep = async () => {
    if (keepBusy) return;
    setKeepBusy(true);
    try {
      if (saved) await removeImage(bid);
      else {
        const id = await saveImage({ img, lessonId: bank && bank.lessonId, lessonTitle: bank && bank.lessonTitle, caption: bank && bank.caption });
        if (!id) { setKeepMsg("التخزين ممتلئ، ما قدرتش أحفظ الصورة"); setTimeout(() => setKeepMsg(""), 3800); }
      }
    } finally { setKeepBusy(false); }
  };
  const save = (strokes) => {
    const marks = Array.isArray(strokes) && strokes.length ? strokes : (strokes === undefined ? ink : []);
    return saveImageFile(img, marks);
  };
  return (
    <figure className="chat-gen">
      <div className="chat-gen-wrap">
        {/* tap the picture → it fills the screen */}
        <button type="button" className="chat-gen-zoom" onClick={() => setBig(true)} aria-label="تكبير الصورة على الشاشة كلها" title="دوس لتكبير الصورة">
          <img src={src} alt="صورة اتولّدت" />
          <StrokeLayer strokes={ink} />
          <span className="chat-gen-badge"><Icon name="maximize" size={15} /></span>
        </button>
        <button type="button" className="gen-keep" data-on={saved} aria-pressed={saved} disabled={keepBusy} onClick={toggleKeep}
          title={saved ? "محفوظة في معرض الصور (دوس عشان تشيلها)" : "احفظ الصورة في معرض الصور"}>
          <Icon name="bookmark" size={16} fill={saved ? "currentColor" : "none"} />
          <span>{saved ? "محفوظة" : "احفظ"}</span>
        </button>
      </div>
      <div className="chat-gen-foot">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => save()} title="ينزّل ملف الصورة على جهازك"><Icon name="download" size={16} /> تنزيل</button>
        {img.spec && onRestyle && <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onRestyle} title="نفس المحتوى بشكل وألوان مختلفة (فوري، من غير توكنز)">🎨 ستايل تاني</button>}
        {img.spec && !img.bilingual && onTranslate && <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onTranslate} title="يحط الترجمة العربي تحت كل سطر إنجليزي">🌐 ترجمة تحت الإنجليزي</button>}
        {via && <small>{via}</small>}
        {saved && <small className="gen-saved">✓ في المعرض{bank && bank.lessonId !== GLOBAL_LESSON && bank.lessonTitle ? ` · ${bank.lessonTitle}` : ""}</small>}
        {keepMsg && <small className="gen-warn">{keepMsg}</small>}
      </div>
      {big && <Lightbox src={src} onClose={() => { setBig(false); setInkVer((n) => n + 1); }} onSave={(strokes) => { save(strokes); setInkVer((n) => n + 1); }} />}
    </figure>
  );
}

/* ── floating-window size (the "AI" window): remembered, never bigger than the screen ── */
const MIN_W = 340, MIN_H = 380, MARGIN = 12;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const PRESETS = { s: { w: 380, h: 520, f: 0.5 }, m: { w: 480, h: 660, f: 0.72 }, l: { w: 760, h: 820, f: 0.92 } };
function readSize() {
  try { const r = JSON.parse(prefs.get("clinix:ai:size", "null")); if (r && Number.isFinite(r.w) && Number.isFinite(r.h)) return r; } catch (e) { /* default */ }
  return { w: PRESETS.m.w, h: PRESETS.m.h, full: false };
}
const useViewport = () => {
  const [vp, setVp] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const f = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);
  return vp;
};

/* Chat. Two looks, one brain:
     variant="drawer"  → the side panel of a question ("اسأل الـ AI")
     variant="window"  → the general "AI" window (floating, resizable; a bottom sheet on phones)
   Stays mounted (hidden) after the first open so an answer that is still streaming is never lost. */
export default function ChatPanel({
  open, onClose, apiKey, onNeedKey, ctx, chipIds = [], storeKey, variant = "drawer",
  library, onOpenItem, onOpenMistakes, title, subtitle, suggestions, placeholder, emptyTitle, emptyText, command,
}) {
  const win = variant === "window";
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [sure, setSure] = useState(false);
  const [files, setFiles] = useState([]);        // pending attachments for the next message
  const [imgMode, setImgMode] = useState(false); // next message → draw a picture
  const [examMode, setExamMode] = useState(false); // next message → build an exam
  const [engine, setEng] = useState(getEngine);   // diagram | gemini
  /* reply level: which model answers and how hard it thinks (lib/chat.js → REPLY_LEVELS). Remembered; applies to the NEXT message. */
  const [level, setLevel] = useState(() => { const v = prefs.get("clinix:chat:level", DEFAULT_LEVEL); return REPLY_LEVELS.some((l) => l.id === v) ? v : DEFAULT_LEVEL; });
  const pickLevel = (id) => { setLevel(id); prefs.set("clinix:chat:level", id); };
  /* Google Search before every answer (default ON): the answer is built from what is found and its sources are listed under it */
  const [search, setSearch] = useState(() => getEnginePrefs().search !== false);
  /* v3.29 · smart photos under the answer (lib/photos.js): the text is sent first, the photos arrive afterwards, only when the answer needs them */
  const [photoOn, setPhotoOn] = useState(readPhotosOn);
  const photoRef = useRef(photoOn);
  photoRef.current = photoOn;
  const photoCtl = useRef(new Set());
  const togglePhotos = () => { const v = !photoOn; setPhotoOn(v); savePhotosOn(v); if (v && !configuredSources().length) onNeedKey(); };
  const toggleSearch = () => { const v = !search; setSearch(v); setEnginePrefs({ search: v }); };
  const [wait, setWait] = useState("");
  const [stage, setStage] = useState(null);       // what a big answer is doing now: { kind: "plan" } | { kind: "write", n, done }
  const [note, setNote] = useState("");
  const [over, setOver] = useState(false);
  const [size, setSize] = useState(readSize);
  const [dw, setDw] = useState(() => { const n = parseInt(prefs.get("clinix:chat:dw", "0"), 10); return n >= MIN_W ? n : 0; });   // width of the question drawer (0 = default)
  const dwRef = useRef(dw);
  dwRef.current = dw;
  const vp = useViewport();
  const abortRef = useRef(null);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const fileRef = useRef(null);
  const stick = useRef(true);
  const dragRef = useRef(null);
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const libRef = useRef(library);
  libRef.current = library;
  /* which lesson a picture belongs to (the saved question this chat is attached to; the general AI window has none) */
  const lessonId = storeKey && storeKey !== "clinix:chat:global" ? storeKey.replace(/^clinix:chat:/, "") : GLOBAL_LESSON;
  const lessonTitle = lessonId === GLOBAL_LESSON ? "" : ((((library && library.questions) || []).find((x) => x.id === lessonId) || {}).title || "");

  /* ── conversations (v3.25) ──
     Every chat keeps a LIST of conversations (lib/chathist.js): the newest opens first, the history panel switches between them,
     starts a new one or deletes one. A conversation is created when its first message is sent, so there are never empty ones. */
  const [convs, setConvs] = useState([]);
  const [convId, setConvId] = useState(null);
  const [histOpen, setHistOpen] = useState(false);
  const [delId, setDelId] = useState(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const convIdRef = useRef(convId);
  convIdRef.current = convId;
  const loadedRef = useRef(null);          // the array that was just loaded from storage (not saved again until it changes)
  const chainRef = useRef(Promise.resolve());
  /* every write goes through one queue: a save can never land after the delete of the same conversation */
  const queue = (fn) => { const run = chainRef.current.then(fn, fn).catch(() => null); chainRef.current = run; return run; };

  useEffect(() => {
    if (!storeKey) return undefined;
    let alive = true;
    (async () => {
      const idx = await loadIndex(storeKey);
      if (!alive) return;
      setConvs(idx);
      if (idx.length && !messagesRef.current.length) {
        const msgs = await loadConv(storeKey, idx[0].id);
        if (alive && !messagesRef.current.length) { loadedRef.current = msgs; setConvId(idx[0].id); setMessages(msgs); }
      }
    })();
    return () => { alive = false; };
  }, [storeKey]);

  useEffect(() => { if (storeKey && messages.length && !convId) setConvId(newConvId()); }, [messages.length, convId, storeKey]);

  useEffect(() => {
    if (!storeKey || busy || !messages.length || !convId || messages === loadedRef.current) return undefined;
    const t = setTimeout(() => {
      const clean = forStorage(messages);
      if (clean.length) queue(() => saveConv(storeKey, convId, clean)).then((idx) => { if (idx) setConvs(idx); });
    }, 400);
    return () => clearTimeout(t);
  }, [messages, busy, storeKey, convId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (!open) { setHistOpen(false); setDelId(null); } }, [open]);

  useEffect(() => () => { abortRef.current?.abort(); photoCtl.current.forEach((c) => c.abort()); }, []);

  /* keep the newest text in view unless the student scrolled up to read */
  useEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages, open]);
  const onScroll = () => {
    const el = listRef.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
  };

  /* Android back button / browser back: closes the chat first instead of leaving the screen.
     (the floating window on a big screen is not modal → no history entry there) */
  const pushed = useRef(false);
  useEffect(() => {
    if (!open) return undefined;
    if (win && window.innerWidth > 700) return undefined;
    window.history.pushState(window.history.state, "");
    pushed.current = true;
    const onPop = () => { pushed.current = false; onClose(); };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      if (pushed.current) { pushed.current = false; window.history.back(); }   // closed with X / Esc: drop the entry we added
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return undefined;
    const t = setTimeout(() => inputRef.current?.focus(), 120);
    if (win) return () => clearTimeout(t);   // the window handles Esc itself (onKeyDown below)
    const esc = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => { clearTimeout(t); window.removeEventListener("keydown", esc); };
  }, [open, onClose, win]);

  const patch = (id, fn) => setMessages((cur) => cur.map((m) => (m.id === id ? fn(m) : m)));

  /* attachments */
  const addFiles = useCallback(async (list) => {
    const arr = [...(list || [])];
    if (!arr.length) return;
    const { items, errors } = await readFiles(arr, files);
    setFiles(items.slice(0, MAX_ITEMS));
    setNote(errors.length ? errors[0] : "");
  }, [files]);
  const onPick = (e) => { addFiles(e.target.files); e.target.value = ""; };
  const onPaste = (e) => {
    const fs = [...(e.clipboardData?.files || [])];
    if (fs.length) { e.preventDefault(); addFiles(fs); }
  };

  const send = useCallback(async (raw, opts = {}) => {
    const q = (raw ?? input).trim();
    if ((!q && !files.length) || busy) return;
    if (!apiKey) { onNeedKey(); return; }
    const base = opts.base || messages;
    const atts = opts.atts || files;
    /* the last picture the student has (its JSON is kept, so it can be changed, translated or re-styled) */
    const lastAiMsg = [...base].reverse().find((m) => m.role === "ai");
    const prevImgMsg = [...base].reverse().find((m) => m.role === "ai" && m.img && m.img.spec);
    const lastIsImg = !!(lastAiMsg && lastAiMsg.img);
    const fresh = IMG_INTENT.test(q) && !IMG_AGAIN.test(q);
    const follow = !!prevImgMsg && !fresh && ((IMG_WORD.test(q) && (WANTS_REDO.test(q) || WANTS_AR.test(q))) || (lastIsImg && q.length < 200 && (WANTS_AR.test(q) || WANTS_REDO.test(q))));
    const wantImage = opts.image ?? (imgMode || IMG_INTENT.test(q) || follow);
    const wantExam = !wantImage && (opts.exam ?? (examMode || wantsExam(q)));
    const userMsg = { id: uid(), role: "user", text: q || "(ملفات مرفقة)", atts: atts.map(({ name, label, t }) => ({ name, label, t })) };
    const ai = { id: uid(), role: "ai", text: "", gen: wantImage, isExam: wantExam, lvl: level, t0: Date.now() };
    const history = [...base, userMsg];
    setMessages([...history, ai]);
    setInput(""); setFiles([]); setNote(""); setImgMode(false); setExamMode(false); setStage(null); setBusy(true); stick.current = true;
    if (inputRef.current) inputRef.current.style.height = "auto";
    const ctrl = new AbortController();
    let flushRef = null;                         // paints the last streamed text (set when the answer starts streaming)
    abortRef.current = ctrl;
    const lib = libRef.current || {};
    try {
      if (wantImage) {
        const pv = prevImgMsg ? prevImgMsg.img : null;
        const justLook = !!pv && follow && WANTS_RESTYLE.test(q) && !WANTS_AR.test(q);
        let out;
        if (justLook) { const r = restyle(pv.spec, pv.style); out = { ...r, engine: "diagram", notes: [] }; }      // "غيّر الستايل" → instant
        else out = await makePicture({
          engine, apiKey, ctx, request: q, atts, signal: ctrl.signal,
          /* a follow-up works FROM the previous picture (keeps its content); a brand-new picture only avoids its look and layout type */
          prev: pv ? (follow ? { spec: pv.spec, style: pv.style, type: pv.spec.type } : { style: pv.style, type: pv.spec.type }) : null,
        });
        const via = `${{ diagram: "رسم توضيحي بالمفتاح المجاني", gemini: "Gemini" }[out.engine]}${justLook ? " · ستايل جديد" : ""}${out.notes.length ? " · " + out.notes[0] : ""}`;
        patch(ai.id, (m) => ({ ...m, img: { mime: out.mime, data: out.data, spec: out.spec, style: out.style, bilingual: out.bilingual }, text: justLook ? "غيّرتلك الشكل والألوان، المحتوى زي ما هو 🎨" : fixText(out.text || ""), via }));
      } else if (wantExam) {
        const here = ctx.kind === "global" ? "" : `${ctx.kind === "lesson" ? "STUDY MATERIAL" : "QUESTION"}: ${String(ctx.question || "").slice(0, 1800)}\nEXPLANATION: ${String(ctx.explanation || "").slice(0, 2200)}`;
        /* v3.20: the exam is written in parallel batches and every question appears the moment it is ready (no more minutes of dots).
           A progress update only brings new questions / title: whatever the student already answered is kept. */
        const out = await makeExam({
          apiKey, request: q, attach: atts, extra: here, questions: lib.questions || [], topics: lib.topics, focusId: lib.focusId, focusTopicId: lib.focusTopicId, signal: ctrl.signal,
          onStatus: (t) => setWait(t),
          onProgress: (ex) => patch(ai.id, (m) => ({
            ...m, text: m.text || ex.intro || "",
            exam: { ...ex, answers: (m.exam && m.exam.answers) || {}, cur: m.exam ? m.exam.cur : 0, done: m.exam ? m.exam.done : false, at: (m.exam && m.exam.at) || Date.now() },
          })),
        });
        patch(ai.id, (m) => ({
          ...m,
          exam: { ...out.exam, answers: (m.exam && m.exam.answers) || {}, cur: m.exam ? m.exam.cur : 0, done: m.exam ? m.exam.done : false },
          text: out.short
            ? `جهّزتلك ${out.exam.questions.length} أسئلة من ${out.requested} (باقي الأسئلة ما اتولّدتش، تقدر تطلب امتحان تاني). بالتوفيق! 💪`
            : (out.exam.intro || `جهّزتلك امتحان من ${out.exam.questions.length} ${out.exam.questions.length > 10 ? "سؤال" : "أسئلة"}. بالتوفيق! 💪`),
        }));
      } else {
        let codes = {};
        const paint = (raw2) => {
          const { text, cites, claims } = splitCites(raw2);
          const refs = cites.map((c) => (codes[c] ? { ...codes[c], code: c, claim: claims[c] || "" } : null)).filter(Boolean);
          patch(ai.id, (m) => ({ ...m, text: fixText(text), refs }));
        };
        /* v3.27: while an answer streams (up to 4 sections at once) the screen is repainted at most every 60 ms, not on every network chunk;
           the final text is always painted at once */
        let pendingRaw = null, tick = 0;
        const flush = () => { clearTimeout(tick); tick = 0; if (pendingRaw !== null) { const r = pendingRaw; pendingRaw = null; paint(r); } };
        const show = (raw2, now) => { pendingRaw = raw2; if (now) flush(); else if (!tick) tick = setTimeout(flush, 60); };
        flushRef = flush;
        const out = await askChat({
          apiKey, history, ctx, chipIds, attach: atts, library: lib, signal: ctrl.signal, level,
          onCodes: (c) => { codes = c; }, onStage: (st) => setStage(st),
          onText: show,
        });
        show(out.text, true);
        patch(ai.id, (m) => ({ ...m, sources: out.sources || null, searched: !!out.searchOn, cached: !!out.cached }));
        if (photoRef.current && out.text) runPhotos(ai.id, q, splitCites(out.text).text);
      }
    } catch (err) {
      if (flushRef) flushRef();                    // what was streamed last is painted before a stop / an error is recorded
      /* an exam that already has some questions keeps them (and stops "loading") when it is stopped or fails half-way */
      const keep = (m) => (m.exam ? { ...m, exam: { ...m.exam, loading: false, total: m.exam.questions.length } } : m.text ? { ...m, text: stripPending(m.text) } : m);
      if (err && err.name === "AbortError") patch(ai.id, (m) => ({ ...keep(m), stopped: true }));
      else patch(ai.id, (m) => ({ ...keep(m), err: (err && err.message) || "حصلت مشكلة. جرّب تاني." }));
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
      if (flushRef) flushRef();
      setWait(""); setStage(null); setBusy(false);
    }
  }, [input, files, busy, apiKey, messages, imgMode, examMode, engine, level, ctx, chipIds, onNeedKey]);

  /* runs after the text answer is complete; never blocks it. Any failure just means "no photos". */
  const runPhotos = (aiId, question, answer) => {
    const ctrl = new AbortController();
    photoCtl.current.add(ctrl);
    const merge = (p) => patch(aiId, (m) => ({ ...m, photos: p === null ? undefined : { ...(m.photos || {}), ...p } }));
    fetchPhotos({
      apiKey, question, answer, signal: ctrl.signal,
      ctxHint: ctx.kind === "global" ? "" : String(ctx.question || "").slice(0, 120),
      onStart: (n) => merge({ state: "loading", total: n, items: [] }),
      onUpdate: (items, o) => merge({ state: o && o.final ? "done" : "loading", items }),
    }).then((r) => merge(r.status === "done" ? { state: "done", items: r.items } : null))
      .catch(() => merge(null))
      .finally(() => photoCtl.current.delete(ctrl));
  };

  const stop = () => abortRef.current?.abort();

  const retry = (aiId) => {
    const i = messages.findIndex((m) => m.id === aiId);
    const user = i > 0 ? messages[i - 1] : null;
    if (user && user.role === "user") send(user.text, { base: messages.slice(0, i - 1), atts: [], image: messages[i].gen, exam: messages[i].isExam });
  };

  const resetComposer = () => {
    setInput(""); setFiles([]); setNote(""); setImgMode(false); setExamMode(false); setWait("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    stick.current = true;
  };
  /* write the conversation that is on screen (also while it is still being answered: only what exists is kept) */
  const flush = () => {
    const id = convIdRef.current, ms = messagesRef.current;
    if (!storeKey || !id || !ms.length || ms === loadedRef.current) return Promise.resolve();
    const clean = forStorage(ms);
    if (!clean.length) return Promise.resolve();
    return queue(() => saveConv(storeKey, id, clean)).then((idx) => { if (idx) setConvs(idx); });
  };
  const leave = async () => { abortRef.current?.abort(); photoCtl.current.forEach((c) => c.abort()); await flush(); };
  const newChatRef = useRef(null);
  const newChat = async (o) => {
    setHistOpen(false);
    const keep = o && o.keepFocus;
    if (!messagesRef.current.length) { if (!keep) setTimeout(() => inputRef.current?.focus(), 60); return; }
    await leave();
    loadedRef.current = null; messagesRef.current = []; convIdRef.current = null; setMessages([]); setConvId(null); resetComposer();
    if (!keep) setTimeout(() => inputRef.current?.focus(), 60);
  };
  newChatRef.current = newChat;
  const openConv = async (id) => {
    setHistOpen(false);
    if (id === convIdRef.current) return;
    await leave();
    const msgs = await loadConv(storeKey, id);
    loadedRef.current = msgs; setConvId(id); setMessages(msgs); resetComposer();
  };
  const deleteConv = async (id) => {
    setDelId(null);
    if (id === convIdRef.current) { abortRef.current?.abort(); loadedRef.current = null; setMessages([]); setConvId(null); resetComposer(); }
    const idx = await queue(() => removeConv(storeKey, id));
    if (idx) setConvs(idx);
  };
  const askDel = (id) => {
    if (delId !== id) { setDelId(id); setTimeout(() => setDelId((cur) => (cur === id ? null : cur)), 2500); return; }
    deleteConv(id);
  };
  const toggleHist = async () => {
    if (histOpen) { setHistOpen(false); return; }
    await flush();
    setHistOpen(true);
  };
  /* the trash in the header deletes the conversation on screen (after a second tap) */
  const clear = () => {
    if (!sure) { setSure(true); setTimeout(() => setSure(false), 2500); return; }
    setSure(false);
    const id = convIdRef.current;
    if (id) deleteConv(id); else { abortRef.current?.abort(); setMessages([]); resetComposer(); }
  };

  const onKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
  };

  const suggest = (s) => {
    if (s.send) send(s.text, { ...(s.image ? { image: true } : {}), ...(s.exam ? { exam: true } : {}) });
    else {
      setInput(s.text);
      if (s.image) setImgMode(true);
      if (s.exam) setExamMode(true);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  };

  /* another part of the app asks this chat to do something ("امتحني في الموضوع ده"): { id, text, send, exam }.
     v3.28: it always starts a NEW conversation (the old one stays in the history) instead of continuing the last one. */
  const sendRef = useRef(send);
  sendRef.current = send;
  const handled = useRef(null);
  useEffect(() => {
    if (!command || !open || handled.current === command.id) return;
    handled.current = command.id;
    setHistOpen(false);
    (async () => {
      const fresh = !!(storeKey && messagesRef.current.length);
      if (fresh) {
        await newChatRef.current({ keepFocus: true });                   // saves the open conversation, then clears the screen
        await new Promise((r) => setTimeout(r, 120));                    // let React redraw so `send` sees the empty chat and a finished (aborted) answer
      }
      if (command.send) sendRef.current(command.text, { base: [], ...(command.exam ? { exam: true } : {}) });
      else { setInput(command.text || ""); setExamMode(!!command.exam); setTimeout(() => inputRef.current?.focus(), 60); }
    })();
  }, [command, open]); // eslint-disable-line react-hooks/exhaustive-deps

  /* an exam card changed (answer picked, next question …) → saved with the message */
  /* same content, new look: instant, no model call */
  const restyleMsg = (id) => patch(id, (m) => {
    if (!m.img || !m.img.spec) return m;
    try { const r = restyle(m.img.spec, m.img.style); return { ...m, img: { ...m.img, mime: r.mime, data: r.data, style: r.style, bilingual: r.bilingual } }; } catch (e) { return m; }
  });
  /* the card's copy can be one render behind a question that just arrived: never let it shrink the list or re-open "loading" */
  const setExam = (id, exam) => patch(id, (m) => {
    const cur = m.exam;
    const questions = cur && cur.questions.length > exam.questions.length ? cur.questions : exam.questions;
    return { ...m, exam: { ...exam, questions, total: cur ? cur.total : exam.total, loading: cur ? cur.loading : exam.loading } };
  });

  /* «غلطاتي» from an exam card: same hand-over as a source chip (a modal chat closes first and its history entry is reused) */
  const openMistakes = () => {
    const modal = pushed.current;
    if (modal) { pushed.current = false; onClose(); }
    if (onOpenMistakes) onOpenMistakes(modal);
  };

  /* a source chip: open that saved question. Closing first when the chat is modal (drawer / phone sheet) and reusing its history entry. */
  const openItem = (id, claim) => {
    const modal = pushed.current;
    if (modal) { pushed.current = false; onClose(); }
    if (onOpenItem) onOpenItem(id, modal, claim ? { text: claim, nonce: Date.now() } : null);
  };

  /* ── window size ── */
  const mobile = vp.w <= 700;
  const maxW = Math.max(MIN_W, vp.w - MARGIN * 2), maxH = Math.max(MIN_H, vp.h - MARGIN * 2);
  const winStyle = !win ? (!mobile && dw ? { width: clamp(dw, MIN_W, maxW) } : undefined) : mobile
    ? { height: size.full ? vp.h : clamp(size.h > vp.h ? PRESETS.m.f * vp.h : size.h, 300, vp.h - 6) }
    : { width: size.full ? maxW : clamp(size.w, MIN_W, maxW), height: size.full ? maxH : clamp(size.h, MIN_H, maxH) };
  const persistSize = (z) => { setSize(z); prefs.set("clinix:ai:size", JSON.stringify(z)); };
  const preset = (k) => persistSize(mobile ? { w: size.w, h: Math.round(vp.h * PRESETS[k].f), full: false } : { w: PRESETS[k].w, h: PRESETS[k].h, full: false });
  const toggleFull = () => persistSize({ ...size, full: !size.full });
  const startDrag = (mode) => (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget.closest(".chat");
    const r = el.getBoundingClientRect();
    dragRef.current = { mode, x: e.clientX, y: e.clientY, w: r.width, h: r.height, rtl: getComputedStyle(el).direction === "rtl" };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const startDw = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget.closest(".chat");
    dragRef.current = { mode: "dw", x: e.clientX, w: el.getBoundingClientRect().width, rtl: getComputedStyle(el).direction === "rtl" };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const resetDw = () => { setDw(0); prefs.set("clinix:chat:dw", "0"); };
  const moveDrag = (e) => {
    const d = dragRef.current;
    if (!d) return;
    if (d.mode === "dw") { setDw(clamp(Math.round(d.w + (d.rtl ? e.clientX - d.x : d.x - e.clientX)), MIN_W, maxW)); return; }
    let w = d.w, h = d.h;
    if (d.mode.includes("h")) h = d.h + (d.y - e.clientY);                                  // the window hangs from the bottom: dragging UP makes it taller
    if (d.mode.includes("w")) w = d.w + (d.rtl ? e.clientX - d.x : d.x - e.clientX);         // the inner edge: toward the middle of the screen = wider
    setSize({ w: clamp(w, MIN_W, maxW), h: clamp(h, mobile ? 300 : MIN_H, mobile ? vp.h - 6 : maxH), full: false });
  };
  const endDrag = () => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    if (d.mode === "dw") prefs.set("clinix:chat:dw", String(dwRef.current));
    else prefs.set("clinix:ai:size", JSON.stringify(sizeRef.current));
  };
  const sizeKey = size.full ? "full" : null;

  const sugs = suggestions || (ctx.kind === "global" ? SUGGEST_G : SUGGEST_Q);
  const head = title || (ctx.kind === "global" ? "AI" : "اسأل الـ AI عن السؤال");
  const sub = subtitle || (ctx.kind === "global" ? "اشرح، امتحنّي، لخّص، ارسم — وبيشوف كل أسئلتك" : "اسأل، اعترض، ارفع ملفات، أو اطلب رسم");

  return (
    <aside className={`chat${win ? " chat-win" : ""}`} hidden={!open} aria-label={head} data-over={over} data-hist={histOpen} data-full={sizeKey} style={winStyle}
      onKeyDown={win ? (e) => { if (e.key === "Escape") onClose(); } : undefined}
      onDragOver={(e) => { if (e.dataTransfer?.types?.includes("Files")) { e.preventDefault(); setOver(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(false); }}
      onDrop={(e) => { if (e.dataTransfer?.files?.length) { e.preventDefault(); setOver(false); addFiles(e.dataTransfer.files); } }}>
      {!win && !mobile && (
        <div className="win-rs win-rs-s chat-dw" role="separator" aria-label="اسحب لتغيير عرض النافذة (دوسة مرتين = الحجم الأصلي)" title="اسحب لتغيير العرض · دوسة مرتين = الأصلي"
          onPointerDown={startDw} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onDoubleClick={resetDw} />
      )}
      {win && !size.full && (
        <>
          <div className="win-rs win-rs-t" role="separator" aria-label="اسحب لتغيير الطول" onPointerDown={startDrag("h")} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}><i /></div>
          {!mobile && <div className="win-rs win-rs-s" role="separator" aria-label="اسحب لتغيير العرض" onPointerDown={startDrag("w")} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} />}
          {!mobile && <div className="win-rs win-rs-c" role="separator" aria-label="اسحب لتغيير الحجم" onPointerDown={startDrag("hw")} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} />}
        </>
      )}
      <header className="chat-head" onDoubleClick={win ? toggleFull : undefined}>
        <span className="chat-ico">{ctx.kind === "global" ? <b className="ai-mark">AI</b> : <Icon name="chat" size={20} />}</span>
        <span className="chat-title"><b>{head}</b><small>{sub}</small></span>
        {win && (
          <span className="win-sizes" role="group" aria-label="حجم النافذة">
            {[["s", "ص", "صغير"], ["m", "م", "وسط"], ["l", "ك", "كبير"]].map(([k, ch, name]) => (
              <button key={k} type="button" title={`حجم ${name}`} aria-label={`حجم ${name}`} onClick={() => preset(k)}
                data-on={!size.full && (mobile ? Math.abs(size.h - vp.h * PRESETS[k].f) < 24 : size.w === PRESETS[k].w && size.h === PRESETS[k].h)}>{ch}</button>
            ))}
          </span>
        )}
        {win && (
          <button type="button" className="iconbtn" onClick={toggleFull} aria-label={size.full ? "تصغير النافذة" : "تكبير النافذة"} title={size.full ? "تصغير" : "ملء الشاشة"}>
            <Icon name={size.full ? "minimize" : "maximize"} size={17} />
          </button>
        )}
        {messages.length > 0 && (
          <button type="button" className="iconbtn chat-clear" data-sure={sure} onClick={clear} aria-label="احذف المحادثة دي" title="احذف المحادثة دي">
            {sure ? <span className="chat-sure">تأكيد؟</span> : <Icon name="trash" size={17} />}
          </button>
        )}
        <button type="button" className="iconbtn" onClick={onClose} aria-label="إغلاق"><Icon name="x" size={18} /></button>
      </header>

      {storeKey && (
        <div className="chat-bar">
          <button type="button" className="chat-bar-btn" data-on={histOpen} aria-pressed={histOpen} onClick={toggleHist} title="سجل المحادثات">
            <Icon name="clock" size={16} /> السجل{convs.length > 0 && <small>{convs.length}</small>}
          </button>
          <span className="chat-bar-title" dir="auto">{histOpen ? "سجل المحادثات" : ((convs.find((c) => c.id === convId) || {}).title || (messages.length ? convTitle(messages) : "محادثة جديدة"))}</span>
          <button type="button" className="chat-bar-btn chat-bar-new" onClick={() => newChat()} title="ابدأ محادثة جديدة (القديمة بتفضل في السجل)">
            <Icon name="plus" size={16} stroke={3} /> جديدة
          </button>
        </div>
      )}

      {histOpen && (
        <div className="chat-hist" role="list" aria-label="سجل المحادثات">
          <button type="button" className="btn btn-teal btn-sm chat-hist-new" onClick={() => newChat()}><Icon name="plus" size={16} stroke={3} /> محادثة جديدة</button>
          {convs.length === 0 && <p className="chat-hist-empty">لسه مفيش محادثات محفوظة. أول رسالة تبعتها هتتسجّل هنا.</p>}
          {convs.map((c) => (
            <div key={c.id} className="chat-hist-row" role="listitem" data-on={c.id === convId}>
              <button type="button" className="chat-hist-open" onClick={() => openConv(c.id)}>
                <b dir="auto">{c.title}</b>
                <small>{stampShort(c.updatedAt)} · {c.n} {c.n > 10 ? "رسالة" : "رسائل"}</small>
              </button>
              <button type="button" className="iconbtn chat-hist-del" data-sure={delId === c.id} onClick={() => askDel(c.id)}
                aria-label={delId === c.id ? "تأكيد حذف المحادثة" : `احذف المحادثة: ${c.title}`} title="احذف المحادثة دي">
                {delId === c.id ? <span className="chat-sure">تأكيد؟</span> : <Icon name="trash" size={16} />}
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="chat-list" ref={listRef} onScroll={onScroll}>
        {messages.length === 0 && (
          <div className="chat-empty">
            <span className="chat-empty-ico">{ctx.kind === "global" ? <b className="ai-mark ai-mark-lg">AI</b> : <Icon name="sparkles" size={30} />}</span>
            <b>{emptyTitle || (ctx.kind === "global" ? "أنا AI، مذاكرتك كلها في مكان واحد" : "عايز تفهم حاجة أكتر؟")}</b>
            <p>{emptyText || (ctx.kind === "global"
              ? "اطلب شرح أي موضوع من الصفر، أو امتحان تفاعلي (من أسئلتك المحفوظة أو من أي موضوع)، أو تلخيص وتريكات ومخططات. أنا شايف كل أسئلتك وشروحاتك اللي ذاكرتها، وتقدر ترفع صور وملفات."
              : "اسأل أي سؤال عن الاختيارات أو القاعدة أو الكلمات، أو اعترض لو شايف الإجابة غلط. شايف كمان باقي أسئلتك المحفوظة وبربطهم ببعض. تقدر ترفع صور وملفات، وتطلب امتحان أو رسمة.")}</p>
            <div className="chat-sugs">
              {sugs.map((s) => <button key={s.label} type="button" className="chat-sug" onClick={() => suggest(s)}>{s.label}</button>)}
            </div>
          </div>
        )}
        {messages.map((m, mi) => (
          <ScaledBox key={m.id} id={m.role === "user" ? `chat:me:${m.id}` : `chat:${m.id}`} className={`chat-msg ${m.role === "user" ? "me" : "bot"}`}>
            {m.role === "user" ? (
              <>
                {m.atts && m.atts.length > 0 && (
                  <div className="chat-atts">{m.atts.map((a, i) => <span key={i} className="chat-att"><Icon name="paperclip" size={12} /> {a.name}</span>)}</div>
                )}
                <p dir="auto">{m.text}</p>
              </>
            ) : (
              <>
                {m.img && <GenImage img={m.img} via={m.via} busy={busy} bank={{ lessonId, lessonTitle, caption: (m.img.spec && (m.img.spec.ar || m.img.spec.title)) || (messages[mi - 1] && messages[mi - 1].role === "user" ? messages[mi - 1].text : "") }} onRestyle={() => restyleMsg(m.id)} onTranslate={() => send("أعد إنشاء الصورة وحط تحت كل سطر إنجليزي الترجمة العربي", { image: true })} />}
                {(m.text || m.exam) && <div className="chat-fs"><FontSizer id={`chat:${m.id}`} label="حجم خط الرد" /></div>}
                {m.text && <Rich text={m.text} />}
                {m.role === "ai" && m.photos && <PhotoStrip photos={m.photos} />}
                {m.role === "ai" && m.text && <Sources sources={m.sources} searched={m.searched} text={m.text} busy={busy && mi === messages.length - 1} />}
                {m.role === "ai" && m.text && m.cached && !(busy && mi === messages.length - 1) && <div className="src-box src-none">⚡ دي إجابة محفوظة لنفس السؤال (من غير استهلاك توكنز). لو عايز إجابة جديدة اكتب السؤال بصيغة تانية.</div>}
                {/* a big answer shows each section as soon as it is ready; the waiting card stays under it until the last one is done */}
                {m.text && busy && mi === messages.length - 1 && stage && stage.kind === "write" && stage.done < stage.n && (
                  <WaitCard kind="text" level={m.lvl || "balanced"} stage={stage} since={m.t0} />
                )}
                {m.exam && <ExamCard exam={m.exam} busy={busy} onOpenMistakes={onOpenMistakes ? openMistakes : undefined} onChange={(ex) => setExam(m.id, ex)} onAsk={(t, o) => send(t, o)} />}
                {!m.text && !m.exam && !m.err && !m.stopped && !m.img && (
                  <WaitCard kind={m.gen ? "image" : m.isExam ? "exam" : "text"} level={m.lvl || "balanced"} stage={busy && mi === messages.length - 1 ? stage : null} label={m.gen || m.isExam ? wait : ""} since={m.t0} search={search} />
                )}
                {m.refs && m.refs.length > 0 && (
                  <div className="chat-refs">
                    <span><Icon name="link" size={13} /> المصادر (دوس تفتح وتتظلّل):</span>
                    {m.refs.map((r) => (
                      <button key={r.id} type="button" onClick={() => openItem(r.id, r.claim)} title="افتح وظلّل الجزء اللي الرد جاي منه" dir="auto">
                        <Icon name={r.kind === "lesson" ? "bookOpen" : "fileText"} size={12} /> {r.title}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
            {m.stopped && <small className="chat-note">اتوقّف الرد</small>}
            {m.err && (
              <div className="chat-err">
                <span>{m.err}</span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => retry(m.id)} disabled={busy}><Icon name="refresh" size={15} /> حاول تاني</button>
              </div>
            )}
          </ScaledBox>
        ))}
      </div>

      {(files.length > 0 || note) && (
        <div className="chat-pending">
          {files.map((f) => (
            <span key={f.id} className="chat-att chat-att-x">
              <Icon name={f.t === "image" ? "image" : "paperclip"} size={13} /> <span dir="auto">{f.name}</span>
              <button type="button" aria-label={`شيل ${f.name}`} onClick={() => setFiles((cur) => cur.filter((x) => x.id !== f.id))}><Icon name="x" size={12} /></button>
            </span>
          ))}
          {note && <small className="chat-note">{note}</small>}
        </div>
      )}

      {imgMode && (
        <div className="chat-engines" role="radiogroup" aria-label="طريقة الرسم">
          {ENGINES.map((e) => (
            <button key={e.id} type="button" role="radio" aria-checked={engine === e.id} data-on={engine === e.id} title={e.hint}
              onClick={() => { setEng(e.id); setEngine(e.id); }}>
              {e.label}<small>{e.hint}</small>
            </button>
          ))}
        </div>
      )}

      {!imgMode && !examMode && (
        <div className="chat-level">
          <div className="chat-level-head">
            <b>مستوى الرد</b>
            <small>{levelOf(level).wait}</small>
          </div>
          <div className="chat-level-seg" role="radiogroup" aria-label="مستوى الرد">
            {REPLY_LEVELS.map((l, i) => (
              <button key={l.id} type="button" role="radio" aria-checked={level === l.id} data-on={level === l.id} title={`${l.hint} · الوقت المتوقع: ${l.wait}`} onClick={() => pickLevel(l.id)}>
                {l.label}
                <span className="lv-dots" aria-hidden="true">{REPLY_LEVELS.map((_, j) => <i key={j} data-f={j <= i ? "1" : "0"} />)}</span>
              </button>
            ))}
          </div>
          <p className="chat-level-note">{levelOf(level).hint} كل ما زاد المستوى زادت الدقة وزاد وقت الانتظار.</p>
          <button type="button" className="chat-search" data-on={search} aria-pressed={search} onClick={toggleSearch}
            title={search ? "الرد بيتبني على نتايج بحث، ومصادره بتظهر تحته" : "الرد من غير بحث ولا مصادر"}>
            🔎 {search ? "بيبحث قبل ما يرد · المصادر تحت الرد" : "البحث مقفول · الرد من غير مصادر"}
          </button>
          <button type="button" className="chat-search" data-on={photoOn} aria-pressed={photoOn} onClick={togglePhotos}
            title={photoOn ? "لو الرد محتاج توضيح بصري بتظهر تحته صور (5 كحد أقصى) بعد ما النص يوصل" : "الرد نص بس، من غير صور"}>
            🖼️ {photoOn ? "صور توضيحية تلقائية · لما الرد يحتاجها" : "الصور مقفولة · الرد نص بس"}
          </button>
          {photoOn && !configuredSources().length && (
            <button type="button" className="chat-photos-hint" onClick={onNeedKey}>ضيف مفتاح مصدر صور واحد على الأقل (Google / Unsplash / Pexels) من 🔑</button>
          )}
        </div>
      )}

      <div className="chat-compose">
        <input ref={fileRef} type="file" multiple hidden onChange={onPick} />
        <button type="button" className="chat-tool" onClick={() => fileRef.current?.click()} aria-label="أرفق ملفات أو صور" title="أرفق ملفات أو صور"><Icon name="paperclip" size={19} /></button>
        <button type="button" className="chat-tool" data-on={imgMode} aria-pressed={imgMode} onClick={() => { setImgMode((v) => !v); setExamMode(false); }} aria-label="رسم صورة" title="الرسالة الجاية: ارسملي صورة"><Icon name="image" size={19} /></button>
        <button type="button" className="chat-tool" data-on={examMode} aria-pressed={examMode} onClick={() => { setExamMode((v) => !v); setImgMode(false); }} aria-label="امتحان" title="الرسالة الجاية: اعملي امتحان"><Icon name="clipboard" size={19} /></button>
        <textarea ref={inputRef} dir="auto" rows={1} value={input}
          placeholder={placeholder || (imgMode ? "وصف الرسم اللي عايزه… (Enter للرسم)" : examMode ? "موضوع الامتحان وعدد الأسئلة… مثلاً: 10 أسئلة على قصور القلب" : ctx.kind === "global" ? "اسأل أي حاجة في المذاكرة، أو اطلب امتحان… (Enter للإرسال)" : "اكتب سؤالك أو اعتراضك… (Enter للإرسال)")}
          onChange={(e) => { setInput(e.target.value); e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 150) + "px"; }}
          onKeyDown={onKey} onPaste={onPaste} />
        {busy
          ? <button type="button" className="chat-send stop" onClick={stop} aria-label="إيقاف"><Icon name="stop" size={18} /></button>
          : <button type="button" className="chat-send" onClick={() => send()} disabled={!input.trim() && !files.length} aria-label="إرسال"><Icon name={imgMode ? "image" : examMode ? "clipboard" : "send"} size={18} /></button>}
      </div>
    </aside>
  );
}
