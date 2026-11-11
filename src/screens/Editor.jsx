import React, { useState, useEffect, useRef, useCallback, useMemo, memo } from "react";
import Icon from "../components/Icon.jsx";
import { AutoTextArea, ConfirmButton } from "../components/ui.jsx";
import { Monitor } from "../components/Progress.jsx";
import FontSizer from "../components/FontSizer.jsx";
import { useTextScale, scaleStyle } from "../lib/textscale.js";
import { RichText, QuestionView, WordList } from "../components/rich.jsx";
import { CHIPS, MODES, sectionsFor, EMPTY_RESULT } from "../lib/config.js";
import { createAnalysis, TASK_KEYS } from "../lib/analysis.js";
import { createTracker, restartTask, snapshot, feed, settle, expectedMs, fmtRemaining } from "../lib/progress.js";
import { readFiles, textItem, makeSource, itemsFromSaved, totalBytes, MAX_TOTAL } from "../lib/docs.js";
import ChatPanel from "../components/ChatPanel.jsx";
import SourceBox from "../components/SourceBox.jsx";
import { warmConnection } from "../lib/gemini.js";
import { store } from "../lib/storage.js";
import { stamp } from "../lib/time.js";
import { wordLines } from "../lib/parse.js";
import { detectQuestions, runBatch, focusNote } from "../lib/batch.js";
import { bestField } from "../lib/library.js";
import { flashPassage, clearFlash } from "../lib/highlight.js";
import { LinkCtx, useLinks } from "../lib/linkctx.js";
import { describe as describeLat } from "../lib/latency.js";
import { quotaNote } from "../lib/quota.js";

const TASK_OF = { original_question_text: "ocr", new_words: "words", explanation: "reason", tricks: "reason" };
const NULLS = { original_question_text: null, new_words: null, explanation: null, tricks: null };
const FLUSH_MS = 90; // streamed text is painted ~11×/s — smooth, and cheap for long explanations

/* ───────── one result card ───────── */

const Skeleton = ({ hint }) => (
  <div className="skel-wrap" aria-label="جاري التحضير">
    {hint && <p className="skel-hint"><span className="live" style={{ margin: 0 }}><i /><i /><i /></span>{hint}</p>}
    <div className="skel" style={{ width: "92%" }} />
    <div className="skel" style={{ width: "78%" }} />
    <div className="skel" style={{ width: "86%" }} />
    <div className="skel" style={{ width: "52%" }} />
  </div>
);

const ResultSection = memo(function ResultSection({ section, value, onChange, running, error, note, onRetry, defaultOpen, src, scaleId, forceOpen }) {
  const { key, title, sub, icon, rows, cls, ltr, wait } = section;
  const [ts] = useTextScale(scaleId);   // this card's own text size (see lib/textscale.js): no other card is touched
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(defaultOpen);
  const pending = value === null || value === undefined;
  const hasText = !pending && value.trim().length > 0;
  const canTool = !pending && !running && (hasText || editing);

  /* a section that starts working, or fails, opens by itself so nothing important stays hidden */
  useEffect(() => { if (running || error) setOpen(true); }, [running, !!error]); // eslint-disable-line react-hooks/exhaustive-deps
  /* opened from a chat answer: the section that holds the highlighted part must be open */
  useEffect(() => { if (forceOpen) setOpen(true); }, [forceOpen]);

  const copy = async () => {
    try { await navigator.clipboard.writeText(value || ""); setCopied(true); setTimeout(() => setCopied(false), 1400); }
    catch (e) { /* clipboard unavailable */ }
  };

  return (
    <section className={`sec ${cls}`} data-open={open} data-field={key}>
      <header className="sec-head">
        <button type="button" className="sec-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <span className="sec-ico"><Icon name={icon} size={21} /></span>
          <span className="sec-title">
            <h3>
              {title}
              {running && hasText && <span className="live" aria-label="بيتكتب دلوقتي"><i /><i /><i /></span>}
            </h3>
            <p>{sub}</p>
          </span>
        </button>
        {open && (!pending || canTool) && (
          <div className="sec-tools">
            {!pending && <FontSizer id={scaleId} label={`حجم خط ${title}`} />}
            {canTool && (
              <>
                <button className="iconbtn" onClick={() => setEditing((e) => !e)} aria-label={editing ? "تم" : `تعديل ${title}`}>
                  <Icon name={editing ? "check" : "pencil"} size={16} />
                </button>
                <button className="iconbtn" onClick={copy} aria-label={`نسخ ${title}`}>
                  <Icon name={copied ? "check" : "copy"} size={16} />
                </button>
              </>
            )}
          </div>
        )}
        <button type="button" className="sec-chev" aria-expanded={open} aria-label={open ? `اقفل ${title}` : `افتح ${title}`} onClick={() => setOpen((o) => !o)}>
          <Icon name="chevron" size={20} />
        </button>
      </header>
      {open && <div className="sec-body ts-box" style={scaleStyle(ts)}>
        {pending ? (
          <Skeleton hint={running ? wait : null} />
        ) : editing ? (
          <AutoTextArea value={value} onChange={(v) => onChange(key, v)} rows={rows} ltr={ltr} placeholder="اكتب أو عدّل هنا…" />
        ) : !hasText ? (
          !running && !error && <button onClick={() => setEditing(true)} className="btn btn-ghost" style={{ width: "100%" }}>فاضي. دوس هنا واكتب بنفسك</button>
        ) : key === "new_words" ? (
          <WordList text={value} warm={!running} src={src} onRemove={(l) => onChange(key, wordLines(value).filter((x) => x !== l).join("\n"))} />
        ) : key === "original_question_text" && !section.rich ? (
          <QuestionView text={value} />
        ) : (
          <RichText text={value} />
        )}
        {running && note && !error && <div className="sec-note" role="status"><i /> {note}</div>}
        {error && (
          <div className="sec-err" role="alert">
            <p>{error.message}</p>
            {error.detail && <small>{error.detail}</small>}
            <button className="btn btn-ghost btn-sm" onClick={() => onRetry(TASK_OF[key])}><Icon name="refresh" size={15} /> جرّب الجزء ده تاني</button>
          </div>
        )}
      </div>}
    </section>
  );
});

/* ───────── editor ───────── */


/* the list of questions found in one upload: one row each, in order, with live status and a button to open it */
const ST = { wait: "في الانتظار", run: "بيتحلل…", done: "اتحفظ ✅", partial: "اتحفظ (جزء ناقص)", error: "فشل", stopped: "اتوقف" };
function BatchPanel({ batch, onOpen, onStop, onClose }) {
  const { phase, rows, total } = batch;
  const finished = phase === "finished";
  const saved = rows.filter((r) => r.id).length;
  const live = phase === "run";
  return (
    <div className="card batch" role="status" aria-live="polite">
      {phase === "detect" && (
        <div className="batch-head"><b>بدوّر على الأسئلة في الملفات…</b><button type="button" className="btn btn-ghost btn-sm" onClick={onStop}>إلغاء</button></div>
      )}
      {phase === "none" && (
        <div className="batch-head"><b>ما لقيتش الأسئلة اللي حددتها في الملفات. راجع الملاحظة (أرقام الأسئلة) وجرّب تاني.</b><button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>تمام</button></div>
      )}
      {(live || finished) && (
        <>
          <div className="batch-head">
            <b>{finished ? `خلص: ${saved} من ${rows.length} اتحفظوا` : `بحلل ${rows.length} سؤال${total > rows.length ? ` من ${total} (المطلوبين بس)` : ""}`}</b>
            {live ? <button type="button" className="btn btn-ghost btn-sm" onClick={onStop}>إيقاف</button> : <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>إخفاء</button>}
          </div>
          <ol className="batch-list">
            {rows.map((r) => (
              <li key={r.key} data-st={r.status}>
                <span className="batch-n">{r.n}</span>
                <span className="batch-t" dir="auto"><b>{r.title || r.start || `سؤال ${r.n}`}</b>{r.err && r.status !== "done" ? <small>{r.err}</small> : null}</span>
                <span className="batch-s">{ST[r.status]}</span>
                {r.id && <button type="button" className="btn btn-ghost btn-sm" onClick={() => onOpen(r.id)}>افتح</button>}
              </li>
            ))}
          </ol>
          {finished && <small className="batch-foot">كل سؤال اتحفظ لوحده وهيتنظّم تلقائي في موضوعه (من «المواضيع»).</small>}
        </>
      )}
    </div>
  );
}

export default function Editor({ initial, history, kind: kindProp, boot, apiKey, perf, onLearn, onNeedKey, onSave, onDelete, nav, onNavTo, onOpenTopic, onMove, library, onOpenItem, highlight, onHighlightShown }) {
  const kind = initial?.kind || kindProp || "question";   // "question" (exam question) | "lesson" (study material → explanation)
  const isLesson = kind === "lesson";
  const sections = sectionsFor(kind);
  const [items, setItems] = useState([]);                 // everything the student gave: pictures, files, typed text
  const [title, setTitle] = useState(initial?.title || "");
  const [imageUrl, setImageUrl] = useState(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatEver, setChatEver] = useState(false);   // mounted after the first open → a streaming answer survives closing
  const [doc, setDoc] = useState(null);          // PDF / text source (null = a plain screenshot)
  const [instructions, setInstructions] = useState(initial?.instructions || "");
  const [chips, setChips] = useState(initial?.chips || []);
  const [moreOpen, setMoreOpen] = useState(false);
  const [mode, setMode] = useState(boot.mode && MODES[boot.mode] ? boot.mode : "balanced");
  const [result, setResult] = useState(initial ? {
    original_question_text: initial.original_question_text || "",
    new_words: initial.new_words || "",
    explanation: initial.explanation || "",
    tricks: initial.tricks || "",
  } : null);
  const [status, setStatus] = useState({});      // task → run | done | error | stopped
  const [errors, setErrors] = useState({});      // task → { message, detail }
  const [notes, setNotes] = useState({});        // task → calm "Google is busy, retrying" note (not an error)
  const [models, setModels] = useState({});
  const [error, setError] = useState(null);      // page-level message
  const [snap, setSnap] = useState(null);
  const [runId, setRunId] = useState(0);
  const [over, setOver] = useState(false);
  const [lastRun, setLastRun] = useState(null);  // { sec } of the last completed run
  const [timing, setTiming] = useState({});     // task → measured timings of the last run (shown under the result)

  const [batch, setBatch] = useState(null);   // many questions in one upload: { phase: "detect" | "run" | "none", rows, total, error }
  const batchRef = useRef(null);
  const fileRef = useRef(null);
  const resultRef = useRef(null);
  const an = useRef(null);
  const tracker = useRef(null);
  const prev = useRef(null);
  const buf = useRef({});
  const timer = useRef(0);
  const perfRef = useRef(perf);
  const modeRef = useRef(mode);
  perfRef.current = perf;
  modeRef.current = mode;

  const lib = useMemo(() => (library ? { ...library, focusId: initial?.id || null } : undefined), [library, initial?.id]);
  const running = Object.values(status).some((s) => s === "run");
  const canChat = !running && !!((result?.original_question_text || "").trim() || (result?.explanation || "").trim());
  const started = !!result;

  /* ── opened from a chat answer (v3.25): open the section that holds the part the answer came from, highlight that part, scroll to it.
     The highlight removes itself after 8 s (lib/highlight.js). */
  const [force, setForce] = useState(null);
  useEffect(() => {
    if (!highlight || !highlight.text || !result) return undefined;
    const field = bestField(result, highlight.text);
    const shown = () => { onHighlightShown && onHighlightShown(); };
    if (!field) { shown(); return undefined; }
    setForce({ key: field, n: highlight.nonce || Date.now() });
    let tries = 0, stop = false, t = 0;
    const attempt = () => {
      if (stop) return;
      if (flashPassage(field, highlight.text, highlight.ms ? { ms: highlight.ms } : {})) { shown(); return; }
      if (++tries < 14) t = setTimeout(attempt, 120); else shown();   // the section needs a moment to open and draw
    };
    t = setTimeout(attempt, 180);
    return () => { stop = true; clearTimeout(t); };
  }, [highlight && highlight.nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => clearFlash(), []);

  /* ── auto-save ──
     A finished analysis saves itself; later edits (text, title, instructions, picture) are saved a moment after you stop.
     The first save creates the question, every later save updates that same question (same id), so there are no copies. */
  const [savedId, setSavedId] = useState(initial?.id || null);
  const [imgRev, setImgRev] = useState(0);                                    // bumps only when the person changes / removes the picture
  const savedIdRef = useRef(initial?.id || null);
  const wsrc = useMemo(() => ({ qid: savedIdRef.current || initial?.id || null, title: (title || "").trim() || initial?.title || "" }), [savedId, title, initial?.id, initial?.title]); // eslint-disable-line react-hooks/exhaustive-deps
  const savedImgRev = useRef(initial ? 0 : -1);
  const lastSig = useRef(null);       // what is already stored; unchanged content is never re-saved
  const saveTimer = useRef(0);
  const pendingSave = useRef(false);
  const busy = useRef(false);
  const again = useRef(false);
  const autoOK = useRef(!!initial);   // a run the person stopped half-way is never saved by itself
  const gone = useRef(false);
  const savePromise = useRef(null);
  const latest = useRef(null);
  const sigNow = JSON.stringify([title, instructions, chips, result, imgRev]);
  latest.current = { title, imageUrl, doc, instructions, chips, result, imgRev, sig: sigNow, onSave };

  const persist = useCallback(() => {
    pendingSave.current = false;
    if (busy.current) { again.current = true; return savePromise.current; }
    busy.current = true;
    savePromise.current = (async () => {
      try {
        do {
          again.current = false;
          const L = latest.current;
          if (gone.current || !L.result || L.sig === lastSig.current) break;
          const id = await L.onSave({
            id: savedIdRef.current, kind, title: L.title, imageUrl: L.imageUrl, doc: L.doc, imageChanged: L.imgRev !== savedImgRev.current,
            instructions: L.instructions, chips: L.chips,
            result: Object.fromEntries(Object.entries(L.result).map(([k, v]) => [k, v ?? ""])),
          });
          if (id) { savedIdRef.current = id; setSavedId(id); }
          lastSig.current = L.sig;
          savedImgRev.current = L.imgRev;
          setError((cur) => (cur && cur.saveFail ? null : cur));   // a save that failed earlier has now gone through
        } while (again.current);
      } catch (err) {
        // nothing is shown while saving works; only a real failure speaks (and leaving the screen tries once more)
        pendingSave.current = true;
        setError({ msg: "السؤال ماتحفظش. اتأكد إن في مساحة فاضية على الموبايل وجرّب تعدّل أي حاجة أو ارجع تاني.", saveFail: true });
      } finally {
        busy.current = false;
      }
    })();
    return savePromise.current;
  }, []);

  /* ── housekeeping ── */
  useEffect(() => { warmConnection(apiKey); }, [apiKey]);
  useEffect(() => () => {
    an.current?.cancel(); clearTimeout(timer.current);
    clearTimeout(saveTimer.current);
    if (pendingSave.current && !gone.current) persist();   // leaving right after an edit: save it now
  }, [persist]);

  /* the app going to the background (or being switched away from) must not lose a pending edit either */
  useEffect(() => {
    const h = () => {
      if (document.visibilityState === "hidden" && pendingSave.current) { clearTimeout(saveTimer.current); persist(); }
    };
    document.addEventListener("visibilitychange", h);
    return () => document.removeEventListener("visibilitychange", h);
  }, [persist]);

  useEffect(() => {
    if (!initial?.id) return;
    let alive = true;
    store.get(`clinix:img:${initial.id}`).then((r) => { if (alive && r?.data) { setImageUrl(r.data); setDoc(r.doc || null); setItems(itemsFromSaved(r.data, r.doc)); } });
    return () => { alive = false; };
  }, [initial?.id]);

  const pickMode = (m) => { setMode(m); store.set("clinix:mode", m); };

  /* ── the source: pictures / files / typed text ── */
  const itemsRef = useRef([]);
  itemsRef.current = items;
  const applyItems = useCallback((next) => {
    const src = makeSource(next);
    setItems(next); setImageUrl(src.imageUrl); setDoc(src.doc); setImgRev((n) => n + 1);
  }, []);
  const addFiles = useCallback(async (files) => {
    const list = [...(files || [])];
    if (!list.length) return;
    const cur = itemsRef.current;
    const { items: next, errors } = await readFiles(list, cur);
    if (next.length !== cur.length) { applyItems(next); warmConnection(apiKey); }
    setError(errors.length ? { msg: errors.slice(0, 3).join("\n") } : null);
  }, [apiKey, applyItems]);
  const addText = useCallback((text) => {
    const next = [...itemsRef.current, textItem(text, isLesson ? "نص الشرح" : "نص السؤال")];
    if (totalBytes(next) > MAX_TOTAL) { setError({ msg: "الحجم الكلي كبير. شيل ملف أو اقصّ النص." }); return; }
    applyItems(next); setError(null); warmConnection(apiKey);
  }, [apiKey, applyItems, isLesson]);
  const removeItem = useCallback((id) => applyItems(itemsRef.current.filter((i) => i.id !== id)), [applyItems]);
  const clearItems = useCallback(() => applyItems([]), [applyItems]);

  useEffect(() => {
    const onPaste = (e) => {
      const cd = e.clipboardData;
      if (!cd) return;
      if (document.activeElement && document.activeElement.closest && document.activeElement.closest(".chat")) return;   // the chat handles its own pastes
      const files = [...(cd.files || [])];
      if (files.length) { e.preventDefault(); addFiles(files); return; }
      const t = cd.getData("text/plain");
      const el = document.activeElement;
      const editable = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (!editable && t && t.trim().length >= 20) { e.preventDefault(); addText(t); }   // Ctrl+V anywhere = paste the text as the source
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [addFiles, addText]);

  const toggleChip = (c) =>
    setChips((cur) => (cur.includes(c.id) ? cur.filter((x) => x !== c.id) : [...cur.filter((x) => x !== c.excludes), c.id]));

  /* ── progress clock (4×/s while anything is running) ── */
  useEffect(() => {
    if (!running || !tracker.current) return;
    const tick = () => setSnap(snapshot(tracker.current));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [running, runId]);

  useEffect(() => {
    if (runId && resultRef.current) {
      const t = setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
      return () => clearTimeout(t);
    }
  }, [runId]);

  /* ── streamed text → state (throttled) ── */
  const flush = useCallback(() => {
    clearTimeout(timer.current); timer.current = 0;
    const d = buf.current; buf.current = {};
    if (Object.keys(d).length) setResult((r) => ({ ...(r || EMPTY_RESULT), ...d }));
  }, []);
  const queue = useCallback((data, now) => {
    Object.assign(buf.current, data);
    if (now) flush();
    else if (!timer.current) timer.current = setTimeout(flush, FLUSH_MS);
  }, [flush]);

  /* ── the analysis ── */
  const onNotice = (name, x) => setNotes((n) => ({ ...n, [name]: `سيرفر Google زحمة دلوقتي، بنعيد المحاولة تلقائي${x.attempt ? ` (محاولة ${x.attempt} من ${x.max || 3})` : ""}… مفيش داعي تعمل حاجة` }));
  const clearNote = (name) => setNotes((n) => (n[name] ? { ...n, [name]: null } : n));
  const onUpdate = (name, data, meta) => {
    clearNote(name);
    feed(tracker.current, name, meta.chars);
    if (meta.model) setModels((m) => (m[name] === meta.model ? m : { ...m, [name]: meta.model }));
    queue(data, meta.final);
  };

  const onDone = (name, m) => {
    clearNote(name);
    setTiming((t) => ({ ...t, [name]: m }));
    settle(tracker.current, name, "done");
    setStatus((s) => ({ ...s, [name]: "done" }));
    setErrors((e) => { if (!e[name]) return e; const n = { ...e }; delete n[name]; return n; });
    onLearn(name, modeRef.current, m.ms, m.chars);
  };

  const fillMissing = (name, partial) => {
    flush();
    setResult((r) => {
      const n = { ...(r || EMPTY_RESULT), ...(partial || {}) };
      TASK_KEYS[name].forEach((k) => { if (n[k] === null || n[k] === undefined) n[k] = prev.current?.[k] ?? ""; });
      return n;
    });
  };

  const onError = (name, err, partial) => {
    clearNote(name);
    settle(tracker.current, name, "error");
    setStatus((s) => ({ ...s, [name]: "error" }));
    setErrors((e) => ({ ...e, [name]: { message: err.message || "حصلت مشكلة أثناء التحليل.", detail: err.detail } }));
    fillMissing(name, partial);
    if (err.fatal) onNeedKey();
  };

  const finish = (nextStatus) => {
    const vals = Object.values(nextStatus);
    if (tracker.current && vals.length && !vals.includes("run")) {
      const s = snapshot(tracker.current);
      setSnap(s);
      setLastRun({ sec: Math.round(s.elapsedSec), stopped: vals.includes("stopped") });
    }
  };
  useEffect(() => { if (started && !running) finish(status); }, [running]); // eslint-disable-line react-hooks/exhaustive-deps

  /* a finished run (even with a failed part, which "retry" later fixes in the same question) is saved; a stopped one is not */
  useEffect(() => {
    if (!started || running) return;
    const vals = Object.values(status);
    if (vals.length) autoOK.current = !vals.includes("stopped");
  }, [running]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (lastSig.current === null && initial) { lastSig.current = sigNow; return; }   // just opening a saved question is not an edit
    if (running || !autoOK.current || !result || sigNow === lastSig.current) return;
    pendingSave.current = true;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(persist, savedIdRef.current ? 900 : 250);
  }, [sigNow, running]); // eslint-disable-line react-hooks/exhaustive-deps

  const makeAnalysis = (hint) => createAnalysis({
    kind, history, dataUrl: imageUrl, doc, extra: hint ? `${hint}` : instructions, chips, apiKey, modeId: mode,
    onUpdate, onDone, onError, onNotice,
  });

  /* several files, or a note that picks questions → first find the questions (one small request), then analyse each one alone */
  const analyze = async () => {
    if (!items.length) { setError({ msg: isLesson ? "ارفع المادة أو الصق نصها الأول." : "ارفع السؤال (صورة أو ملف) أو اكتب نصه الأول." }); return; }
    if (!apiKey) { setError({ msg: "محتاج تحط مفتاح Gemini الأول. دوس على أيقونة 🔑 فوق." }); onNeedKey(); return; }
    if (isLesson || (items.length < 2 && !instructions.trim())) return analyzeOne();
    batchRef.current?.cancel && batchRef.current.cancel();
    const ctrl = new AbortController();
    batchRef.current = { cancel: () => ctrl.abort() };
    setError(null); setBatch({ phase: "detect", rows: [], total: 0 });
    try {
      const { questions, total } = await detectQuestions({ apiKey, items, note: instructions, signal: ctrl.signal });
      if (ctrl.signal.aborted) return;
      if (!questions.length) { setBatch({ phase: "none", rows: [], total }); return; }
      if (questions.length === 1 && total <= 1) { setBatch(null); batchRef.current = null; return analyzeOne(focusNote(questions[0], instructions)); }
      const run = runBatch({
        apiKey, items, plan: questions, note: instructions, chips, history, modeId: modeRef.current,
        save: (p) => onSave(p), onState: (rows) => setBatch({ phase: "run", rows, total }), onFatal: () => onNeedKey(),
      });
      batchRef.current = run;
      run.done.then(() => setBatch((b) => (b ? { ...b, phase: "finished" } : b)));
    } catch (err) {
      if (ctrl.signal.aborted) return;
      setBatch(null); batchRef.current = null;
      setError({ msg: err.message || "حصلت مشكلة أثناء تقسيم الأسئلة.", detail: err.detail });
      if (err.fatal) onNeedKey();
    }
  };

  const analyzeOne = (hint) => {
    an.current?.cancel();
    clearTimeout(timer.current); timer.current = 0; buf.current = {};
    clearTimeout(saveTimer.current); pendingSave.current = false; autoOK.current = false;
    prev.current = result;
    tracker.current = createTracker(mode, perfRef.current);
    setSnap(snapshot(tracker.current));
    setError(null); setErrors({}); setNotes({}); setModels({}); setLastRun(null); setTiming({});
    setResult({ ...NULLS });
    setStatus({ ocr: "run", words: "run", reason: "run" });
    an.current = makeAnalysis(hint);
    setRunId((n) => n + 1);
    an.current.start();
  };

  const retry = (name) => {
    if (!an.current || !tracker.current) return;
    restartTask(tracker.current, name, perfRef.current);
    TASK_KEYS[name].forEach((k) => { buf.current[k] = null; });
    flush();
    setErrors((e) => { const n = { ...e }; delete n[name]; return n; });
    setStatus((s) => ({ ...s, [name]: "run" }));
    setLastRun(null);
    an.current.retry(name);
  };

  const stop = () => {
    an.current?.cancel();
    autoOK.current = false;
    flush();
    setStatus((s) => {
      const n = { ...s };
      Object.keys(n).forEach((k) => { if (n[k] === "run") { n[k] = "stopped"; settle(tracker.current, k, "stopped"); } });
      return n;
    });
    setResult((r) => {
      const n = { ...(r || EMPTY_RESULT) };
      Object.keys(n).forEach((k) => { if (n[k] === null) n[k] = prev.current?.[k] ?? ""; });
      return n;
    });
  };

  const setField = useCallback((key, v) => setResult((r) => ({ ...(r || EMPTY_RESULT), [key]: v })), []);
  const removeQuestion = async () => {
    gone.current = true; clearTimeout(saveTimer.current); pendingSave.current = false;
    try { await savePromise.current; } catch (err) { /* nothing to wait for */ }
    onDelete(savedIdRef.current);
  };

  /* ── derived: the four monitor lamps ── */
  const has = (k) => !!result && result[k] !== null && result[k] !== undefined && result[k] !== "";
  const lamp = (task, live) => {
    const s = status[task];
    if (s === "error") return "error";
    if (s === "done") return "done";
    if (s === "run") return live ? "live" : "wait";
    return "wait";
  };
  const steps = [
    { id: "read", label: isLesson ? "قراءة المادة" : "قراءة السؤال", s: lamp("ocr", has("original_question_text")) },
    { id: "words", label: "الكلمات", s: lamp("words", has("new_words")) },
    { id: "explain", label: isLesson ? "الشرح" : "التفصيص", s: status.reason === "run" && result?.tricks != null ? "done" : lamp("reason", has("explanation")) },
    { id: "tricks", label: isLesson ? "نقاط الحفظ" : "التريكات", s: lamp("reason", result?.tricks != null && result.tricks !== "") },
  ];

  const usedModels = [...new Set(Object.values(models))].join(" + ");
  /* measured, not estimated: where the time really went in this run (helps to spot a slow model or network) */
  const sec1 = (ms) => `${(ms / 1000).toFixed(1)}ث`;
  const timingLine = [
    timing.ocr && `قراءة ${sec1(timing.ocr.ms)}`,
    timing.words && `كلمات ${sec1(timing.words.ms)}`,
    !isLesson && timing.reason?.stages && (timing.reason.stages.total !== undefined ? `حلّ ${timing.reason.stages.solve}ث · شرح وتريكات ${timing.reason.stages.total}ث` : `حلّ ${timing.reason.stages.solve}ث · أساس ${timing.reason.stages.a}ث · تفصيص ${timing.reason.stages.b}ث`),
  ].filter(Boolean).join(" · ");
  /* v3.32: the slowest stage, explained (latency.js): lost time (retries / 503 / timeouts) · waiting · thinking · writing. Only when there is something to explain. */
  const STAGE_AR = { ocr: "القراءة", words: "الكلمات", reason: isLesson ? "الشرح" : "التفصيص" };
  const slow = ["ocr", "words", "reason"].map((k) => ({ k, lat: timing[k] && timing[k].lat })).filter((x) => x.lat && x.lat.totalMs >= 15000).sort((a, b) => b.lat.totalMs - a.lat.totalMs)[0];
  const qNote = quotaNote(apiKey);          // v3.33: which models finished their free daily quota and when they come back (empty when everything is fine)
  const latLine = slow ? `أبطأ مرحلة (${STAGE_AR[slow.k]}): ${describeLat(slow.lat)}` : "";
  const errCount = Object.values(status).filter((s) => s === "error").length;

  /* link chips inside this question: tell the App which question the student is leaving (the saved id, even before the URL knows it) */
  const outerLinks = useLinks();
  const links = useMemo(() => (outerLinks ? { ...outerLinks, selfId: savedId || outerLinks.selfId, open: (q, claim) => outerLinks.open(q, claim, savedId || null) } : null), [outerLinks, savedId]);

  return (
    <LinkCtx.Provider value={links}>
    <div className="page">
      {nav ? (
        <div className="topic-nav" role="navigation" aria-label="التنقل داخل الموضوع">
          <button type="button" className="iconbtn" disabled={!nav.prev} onClick={() => onNavTo(nav.prev)} aria-label="السابق في الموضوع"><Icon name="chevRight" size={18} /></button>
          <button type="button" className="tn-mid" onClick={() => onOpenTopic(nav.topic.id)} dir="auto">
            <span className="tn-emoji">{nav.topic.emoji || "📘"}</span><b>{nav.topic.name}</b><small>{nav.index} / {nav.total}</small>
          </button>
          <button type="button" className="iconbtn" disabled={!nav.next} onClick={() => onNavTo(nav.next)} aria-label="التالي في الموضوع"><Icon name="chevLeft" size={18} /></button>
          <button type="button" className="iconbtn" onClick={() => onMove(initial.id)} aria-label="غيّر الموضوع" title="غيّر الموضوع"><Icon name="folder" size={17} /></button>
        </div>
      ) : initial?.id ? (
        <button type="button" className="topic-nav tn-none" onClick={() => onMove(initial.id)}><Icon name="folder" size={16} /> بدون موضوع — دوس لتحديد موضوع</button>
      ) : null}
      <div className="page-head">
        <h1>{savedId ? (isLesson ? "تعديل الشرح" : "تعديل السؤال") : (isLesson ? "شرح جديد" : "سؤال جديد")}</h1>
        {savedId && initial?.createdAt && <span className="saved-at" title="وقت الحفظ">🕒 {stamp(initial.createdAt)}</span>}
        {savedId && <ConfirmButton onConfirm={removeQuestion} label={isLesson ? "حذف الشرح" : "حذف السؤال"} />}
      </div>

      <div className="stack ed-grid">
        <aside className="ed-side">
        {/* 1 · the source: any files and/or typed text */}
        <SourceBox kind={kind} items={items} imageUrl={imageUrl} onFiles={addFiles} onText={addText} onRemove={removeItem} onClear={clearItems} />

        {/* the note: tells the AI WHICH questions / pages to work on, and any extra instruction */}
        <div>
          <label htmlFor="q-extra" className="label">ملاحظات للذكاء الاصطناعي <small style={{ opacity: .65 }}>(اختياري)</small></label>
          <textarea id="q-extra" dir="auto" rows={2} value={instructions} onChange={(e) => setInstructions(e.target.value)}
            className="input area" style={{ overflow: "auto" }}
            placeholder={isLesson ? "مثلاً: اشرح من صفحة 20 لـ 50 بس، أو الفصل التالت بس" : "مثلاً: حلّل السؤال 1 و7 و8 بس. من غير ملاحظة هيحلل كل الأسئلة المرفوعة"} />
        </div>

        {/* 2 · mode */}
        <div>
          <span className="label">وضع التحليل</span>
          <div className="modes" role="radiogroup" aria-label="وضع التحليل">
            {Object.values(MODES).map((m) => (
              <button key={m.id} type="button" role="radio" aria-checked={mode === m.id} data-on={mode === m.id}
                onClick={() => pickMode(m.id)} className="mode">
                <b>{m.label}</b>
                {m.sub ? <small>{m.sub}</small> : null}
              </button>
            ))}
          </div>
        </div>

        {/* 3 · optional */}
        <div>
          <button type="button" className="more-btn" aria-expanded={moreOpen} onClick={() => setMoreOpen((o) => !o)}>
            <span>عنوان وتعليمات إضافية <small style={{ opacity: .65 }}>(اختياري)</small></span>
            <Icon name="chevron" size={18} />
          </button>
          {moreOpen && (
            <div className="more-body">
              <label htmlFor="q-title" className="label">عنوان السؤال</label>
              <input id="q-title" value={title} onChange={(e) => setTitle(e.target.value)} className="input" dir="auto"
                placeholder="سيبه فاضي وهنسمّيه من نص السؤال" />
              <div className="chips">
                {CHIPS.map((c) => (
                  <button key={c.id} type="button" aria-pressed={chips.includes(c.id)} data-on={chips.includes(c.id)}
                    onClick={() => toggleChip(c)} className="chip">
                    {c.icon && <Icon name={c.icon} size={15} />}
                    {c.label}
                    {chips.includes(c.id) && <Icon name="check" size={14} />}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {!started && (
          <button onClick={analyze} disabled={!items.length || (batch && batch.phase !== "none")} className="btn btn-teal btn-go">
            <Icon name="sparkles" size={24} /> {isLesson ? "اشرحلي المادة" : "حلّل السؤال"}
          </button>
        )}

        {error && (
          <div role="alert" className="alert">
            <Icon name="alert" size={22} />
            <div style={{ minWidth: 0 }}>
              <b>{error.msg}</b>
              {error.detail && <small>{error.detail}</small>}
            </div>
          </div>
        )}

        </aside>

        {batch && <BatchPanel batch={batch} onOpen={onOpenItem} onStop={() => { batchRef.current?.cancel && batchRef.current.cancel(); if (batch.phase === "detect") setBatch(null); }} onClose={() => { setBatch(null); batchRef.current = null; }} />}

        {/* 4 · results */}
        {started && (
          <div ref={resultRef} className="results">
            {running && snap && <Monitor snap={snap} steps={steps} onStop={stop} />}
            {!running && lastRun && (
              <div className={`done-bar${errCount ? " warn" : ""}`}>
                <Icon name={errCount ? "alert" : "check"} size={18} />
                {errCount ? "خلص، بس جزء فيه مشكلة (تحت)" : lastRun.stopped ? "اتوقف التحليل قبل ما يخلص" : `خلص التحليل في ${lastRun.sec} ث`}
                {usedModels && <small>{usedModels}</small>}
                {timingLine && <small style={{ width: "100%", marginInlineStart: 0, direction: "rtl", textAlign: "start", opacity: .85 }}>⏱ {timingLine}</small>}
                {latLine && <small style={{ width: "100%", marginInlineStart: 0, direction: "rtl", textAlign: "start", opacity: .85 }}>🔎 {latLine}</small>}
                {qNote && <small style={{ width: "100%", marginInlineStart: 0, direction: "rtl", textAlign: "start", opacity: .85 }}>⏳ {qNote}</small>}
              </div>
            )}
            {sections.map((s) => {
              const task = TASK_OF[s.key];
              return (
                <ResultSection key={s.key} section={s} value={result[s.key]} onChange={setField}
                  running={status[task] === "run"} error={s.key === "tricks" ? null : errors[task]} note={notes[task]}
                  onRetry={retry} defaultOpen={!initial} forceOpen={force && force.key === s.key ? force.n : 0} src={wsrc} scaleId={`${isLesson ? "l" : "q"}:${s.key}`} />
              );
            })}
          </div>
        )}
      </div>

      {canChat && (
        <>
          {!chatOpen && (
            <button type="button" className="chat-fab" onClick={() => { setChatEver(true); setChatOpen(true); }} aria-label="دردش مع الـ AI عن السؤال">
              <Icon name="chat" size={24} /><span>اسأل الـ AI</span>
            </button>
          )}
          {chatEver && (
            <ChatPanel open={chatOpen} onClose={() => setChatOpen(false)} apiKey={apiKey} onNeedKey={onNeedKey}
              ctx={{ kind, question: result?.original_question_text, explanation: result?.explanation, tricks: result?.tricks, imageUrl, doc }}
              chipIds={chips} storeKey={savedId ? `clinix:chat:${savedId}` : null} library={lib} onOpenItem={onOpenItem} />
          )}
        </>
      )}
    </div>
    </LinkCtx.Provider>
  );
}
