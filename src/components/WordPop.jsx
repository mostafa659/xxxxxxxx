import React, { useState, useEffect, useRef } from "react";
import { SpeakBtn, ClassifyBar } from "./rich.jsx";
import { translateWord, cachedMeaning, translateSentence, cachedSentence, MAX_SENTENCE } from "../lib/wordtr.js";
import { speakable } from "../lib/speech.js";

const ISW = (c) => /[A-Za-z'’-]/.test(c || "");

/* the English word under a screen point (works for mouse double-click and touch double-tap) */
function wordAt(x, y) {
  let node = null, off = 0;
  if (document.caretPositionFromPoint) { const p = document.caretPositionFromPoint(x, y); node = p && p.offsetNode; off = p ? p.offset : 0; }
  else if (document.caretRangeFromPoint) { const r = document.caretRangeFromPoint(x, y); node = r && r.startContainer; off = r ? r.startOffset : 0; }
  if (!node || node.nodeType !== 3) return null;
  const t = node.nodeValue;
  let a = off, b = off;
  if (!ISW(t[a]) && ISW(t[a - 1])) { a--; b--; }
  while (a > 0 && ISW(t[a - 1])) a--;
  while (b < t.length && ISW(t[b])) b++;
  const raw = t.slice(a, b);
  const lead = raw.length - raw.replace(/^[-'’]+/, "").length;
  const word = raw.replace(/^[-'’]+|[-'’]+$/g, "");
  if (!/^[A-Za-z][A-Za-z'’-]+$/.test(word)) return null;
  const range = document.createRange();
  range.setStart(node, a + lead); range.setEnd(node, a + lead + word.length);
  const rect = range.getBoundingClientRect();
  if (!rect.width) return null;
  const block = node.parentElement && node.parentElement.closest("p,li,div,td,span");
  return { word, rect, context: (block ? block.textContent : t).slice(0, 300) };
}

/* the English sentence the student has SELECTED (two words or more). One word is the double-click's job. */
const NO_HOST = "input,textarea,select,button,[contenteditable='true'],.wordpop";
function sentenceFromSelection() {
  const sel = typeof window !== "undefined" && window.getSelection ? window.getSelection() : null;
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const ae = document.activeElement;
  if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return null;
  const range = sel.getRangeAt(0);
  const c = range.commonAncestorContainer;
  const host = c && c.nodeType === 1 ? c : c && c.parentElement;
  if (!host || (host.closest && host.closest(NO_HOST))) return null;
  const raw = sel.toString();
  const latin = (raw.match(/[A-Za-z]/g) || []).length;
  const arabic = (raw.match(/[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/g) || []).length;
  if (latin < 3 || latin < arabic) return null;                        // only English text is translated
  const text = speakable(raw).replace(/^[\s\-—–•·:;,*]+|[\s\-—–•·:;,*]+$/g, "").trim();
  if ((text.match(/[A-Za-z][A-Za-z'’-]*/g) || []).length < 2) return null;
  let rect = range.getBoundingClientRect();
  if (!rect || !rect.width) { const rs = range.getClientRects(); rect = rs && rs[0]; }
  if (!rect || !rect.width) return null;
  return { text: text.slice(0, MAX_SENTENCE), rect };
}

const isTouch = () => { try { return window.matchMedia("(pointer: coarse)").matches; } catch (e) { return false; } };

/* Double-click (or double-tap) an English WORD → bubble with the speaker + the Arabic meaning.
   Select a SENTENCE (drag, or long-press on the phone) → the same bubble with its Arabic translation + speaker.
   Both translations come from Google Translate only: no Gemini tokens are spent on them. */
export default function WordPop() {
  const [pop, setPop] = useState(null);       // { kind: "word"|"sentence", word|text, context, x, y, below }
  const [meaning, setMeaning] = useState("");
  const [state, setState] = useState("idle"); // idle | load | err
  const [why, setWhy] = useState("");          // what went wrong (tooltip + console, for debugging)
  const [tick, setTick] = useState(0);        // retry
  const ref = useRef(null);
  const tap = useRef({ t: 0, x: 0, y: 0 });
  const openedAt = useRef(0);

  useEffect(() => {
    const blocked = (el) => el && el.closest && el.closest("input,textarea,button,select,[contenteditable='true'],.wordpop");
    const place = (rect, sentence) => {
      const half = Math.min(sentence ? 190 : 170, (window.innerWidth - 20) / 2) + 6;
      const cx = Math.min(Math.max(rect.left + rect.width / 2, half), window.innerWidth - half);
      if (!sentence) {
        const below = rect.top < 96;
        return { x: cx, y: below ? rect.bottom + 8 : rect.top - 8, below };
      }
      /* a selection has the system's own handles / copy toolbar on a phone: keep the bubble clear of them */
      const touch = isTouch();
      const room = window.innerHeight - rect.bottom;
      const below = room > 210 || rect.top < 150;
      return { x: cx, y: below ? rect.bottom + (touch ? 34 : 10) : rect.top - (touch ? 58 : 10), below };
    };

    const openWord = (x, y, target) => {
      if (blocked(target)) return;
      const w = wordAt(x, y);
      if (!w) return;
      openedAt.current = performance.now();
      setPop({ kind: "word", word: w.word, context: w.context, ...place(w.rect, false) });
    };
    const onDbl = (e) => openWord(e.clientX, e.clientY, e.target);

    let mouseDown = false, timer = null;
    const check = () => {
      if (mouseDown) return;
      if (performance.now() - openedAt.current < 700) return;       // the word bubble was just opened by a double-click
      const s = sentenceFromSelection();
      if (!s) return;
      setPop((p) => (p && p.kind === "sentence" && p.text === s.text ? p : { kind: "sentence", text: s.text, ...place(s.rect, true) }));
    };
    const schedule = (ms) => { clearTimeout(timer); timer = setTimeout(check, ms); };

    const onUp = (e) => {
      if (e.pointerType === "mouse") { mouseDown = false; schedule(260); return; }
      if (e.pointerType !== "touch") return;
      const now = performance.now(), p = tap.current;                // touch: two quick taps in the same spot
      if (now - p.t < 320 && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 28) { tap.current = { t: 0, x: 0, y: 0 }; openWord(e.clientX, e.clientY, e.target); }
      else tap.current = { t: now, x: e.clientX, y: e.clientY };
    };
    const onDown = (e) => {
      if (e.pointerType === "mouse") mouseDown = true;
      if (!(e.target && e.target.closest && e.target.closest(".wordpop"))) setPop(null);
    };
    const onCancel = () => { mouseDown = false; };
    const onSel = () => schedule(650);                               // waits until the selection (or its handles) stop moving
    const onScroll = (e) => { if (e.target && e.target.closest && e.target.closest(".wordpop")) return; setPop(null); };
    const esc = (e) => { if (e.key === "Escape") setPop(null); };

    document.addEventListener("dblclick", onDbl);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onCancel);
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("selectionchange", onSel);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("keydown", esc);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("dblclick", onDbl);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onCancel);
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("selectionchange", onSel);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("keydown", esc);
    };
  }, []);

  const subject = pop ? (pop.kind === "word" ? pop.word : pop.text) : null;
  useEffect(() => {
    if (!pop) return undefined;
    const word = pop.kind === "word";
    const hit = word ? cachedMeaning(pop.word) : cachedSentence(pop.text);
    if (hit) { setMeaning(hit); setState("idle"); return undefined; }
    setMeaning(""); setState("load"); setWhy("");
    const ctrl = new AbortController();
    const job = word ? translateWord({ word: pop.word, signal: ctrl.signal }) : translateSentence({ text: pop.text, signal: ctrl.signal });
    job.then((m) => { if (!ctrl.signal.aborted) { setMeaning(m); setState(m ? "idle" : "err"); } })
      .catch((e) => { if (!ctrl.signal.aborted) { setState("err"); setWhy((e && (e.detail || e.message)) || ""); try { console.warn("[translate]", e && (e.detail || e.message)); } catch (x) { /* ignore */ } } });
    return () => ctrl.abort();
  }, [pop && pop.kind, subject, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!pop) return null;
  const sentence = pop.kind === "sentence";
  const failText = sentence ? "مقدرتش أترجم الجملة دلوقتي" : "مقدرتش أترجمها دلوقتي";
  return (
    <div ref={ref} className={`wordpop${sentence ? " wordpop-s" : ""}`} data-below={pop.below} style={{ left: pop.x, top: pop.y }} role="dialog"
      aria-label={sentence ? "ترجمة الجملة" : `معنى ${pop.word}`}>
      <div className="wordpop-head">
        <div className="wordpop-body">
          {!sentence && <bdi dir="ltr" className="wordpop-word">{pop.word}</bdi>}
          <span className="wordpop-mean" data-s={state} title={state === "err" ? why : undefined}>
            {state === "load" ? "بنترجم…" : state === "err" ? failText : meaning}
          </span>
          {state === "err" && <button type="button" className="wordpop-retry" onClick={() => setTick((t) => t + 1)}>جرّب تاني</button>}
        </div>
        <SpeakBtn text={sentence ? pop.text : pop.word} label={sentence ? "اسمع الجملة" : `اسمع نطق ${pop.word}`} />
      </div>
      {/* any word you look up can be saved to the dictionary right here (sentences are not saved as words) */}
      {!sentence && state === "idle" && meaning && <ClassifyBar term={pop.word} line={`${pop.word} — ${meaning}`} src={null} />}
      {!sentence && state === "err" && <ClassifyBar term={pop.word} line={pop.word} src={null} />}
    </div>
  );
}
