/* Study ink on top of a picture: pen · highlighter · eraser · undo / redo (Ctrl+Z · Ctrl+Shift+Z · Ctrl+Y).

   • A stroke is stored as normalised points (0…1 of the picture) → it stays exactly in place at any screen size.
   • The eraser removes the whole stroke it touches (one touch = one stroke), and every action can be undone.
   • Ink is kept per picture in localStorage, shows on the small picture in the chat, and is merged into the PNG when saving.
   The ink layer is its own <canvas> over the picture: it never touches the rest of the app. */
import React, { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import Icon from "./Icon.jsx";

const LS = "clinix:ink:v1";
const COLORS = [
  { id: "red", c: "#E5352B", label: "أحمر" },
  { id: "blue", c: "#1E6FE0", label: "أزرق" },
  { id: "green", c: "#1F9D55", label: "أخضر" },
  { id: "black", c: "#14181F", label: "أسود" },
  { id: "hl", c: "#FFD426", label: "هايلايتر", hl: true },
];
const SIZES = [{ id: 0, w: 0.0032, d: 6 }, { id: 1, w: 0.0058, d: 10 }, { id: 2, w: 0.0105, d: 15 }];   // stroke width as a fraction of the picture width

/* ── storage (small, capped, never throws) ── */
export const inkKey = (src) => `${src.length}:${src.slice(-40)}`;
const readAll = () => { try { return JSON.parse(window.localStorage.getItem(LS)) || {}; } catch (e) { return {}; } };
export const loadInk = (key) => readAll()[key] || [];
function saveInk(key, strokes) {
  try {
    const all = readAll();
    delete all[key];
    if (strokes.length) all[key] = strokes.map((s) => ({ ...s, p: s.p.map(([x, y]) => [+x.toFixed(4), +y.toFixed(4)]) }));
    let keys = Object.keys(all);
    while (keys.length > 30 || JSON.stringify(all).length > 600000) { delete all[keys[0]]; keys = Object.keys(all); if (!keys.length) break; }
    window.localStorage.setItem(LS, JSON.stringify(all));
  } catch (e) { /* ignore */ }
}

/* ── drawing ── */
export function drawStrokes(ctx, strokes, W, H) {
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  for (const s of strokes) {
    if (!s.p.length) continue;
    ctx.globalAlpha = s.a || 1;
    ctx.strokeStyle = ctx.fillStyle = s.c;
    ctx.lineWidth = Math.max(1, s.w * W);
    ctx.beginPath();
    ctx.moveTo(s.p[0][0] * W, s.p[0][1] * H);
    if (s.p.length === 1) { ctx.arc(s.p[0][0] * W, s.p[0][1] * H, ctx.lineWidth / 2, 0, 6.2832); ctx.fill(); continue; }
    for (let i = 1; i < s.p.length - 1; i++) {                    // smooth: curve through the mid-points
      const mx = ((s.p[i][0] + s.p[i + 1][0]) / 2) * W, my = ((s.p[i][1] + s.p[i + 1][1]) / 2) * H;
      ctx.quadraticCurveTo(s.p[i][0] * W, s.p[i][1] * H, mx, my);
    }
    const l = s.p[s.p.length - 1];
    ctx.lineTo(l[0] * W, l[1] * H);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/* picture (PNG/JPG blob) + ink → PNG blob */
export async function inkOnBlob(blob, strokes) {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement("canvas");
  c.width = bmp.width; c.height = bmp.height;
  const x = c.getContext("2d");
  x.drawImage(bmp, 0, 0);
  drawStrokes(x, strokes, c.width, c.height);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("png"))), "image/png"));
}

/* distance from point to segment (pixels) */
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
const hits = (s, x, y, W, H, r) => {
  const rr = r + (s.w * W) / 2;
  if (s.p.length === 1) return Math.hypot(x - s.p[0][0] * W, y - s.p[0][1] * H) <= rr;
  for (let i = 1; i < s.p.length; i++) if (segDist(x, y, s.p[i - 1][0] * W, s.p[i - 1][1] * H, s.p[i][0] * W, s.p[i][1] * H) <= rr) return true;
  return false;
};

/* a canvas that exactly covers its parent and redraws on resize */
function useSizedCanvas(ref, draw) {
  useLayoutEffect(() => {
    const cv = ref.current; if (!cv) return undefined;
    const fit = () => {
      const r = cv.getBoundingClientRect(), d = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.round(r.width * d)), h = Math.max(1, Math.round(r.height * d));
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      draw();
    };
    fit();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : null;
    if (ro) ro.observe(cv);
    return () => ro && ro.disconnect();
  });                                                                  // runs after every render: cheap, keeps the pixels in sync with `draw`
}

/* read-only ink on the small picture in the chat */
export function StrokeLayer({ strokes }) {
  const ref = useRef(null);
  useSizedCanvas(ref, () => {
    const cv = ref.current; if (!cv) return;
    const x = cv.getContext("2d");
    x.clearRect(0, 0, cv.width, cv.height);
    drawStrokes(x, strokes, cv.width, cv.height);
  });
  if (!strokes.length) return null;
  return <canvas ref={ref} className="ink-static" aria-hidden="true" />;
}

/* ───────────── the full-screen viewer with the pen ───────────── */
export function Lightbox({ src, onClose, onSave }) {
  const key = inkKey(src);
  const [strokes, setStrokes] = useState(() => loadInk(key));
  const [tool, setTool] = useState("view");                  // view | pen | eraser
  const [color, setColor] = useState("red");
  const [size, setSize] = useState(1);
  const [, bump] = useState(0);
  const [ratio, setRatio] = useState(1.5);
  const S = useRef(strokes);                                 // always the latest list (pointer handlers must not see stale state)
  const undo = useRef([]), redo = useRef([]);
  const cur = useRef(null);                                  // stroke being drawn
  const erase = useRef(null);                                // strokes removed during the current eraser gesture
  const cvRef = useRef(null), ringRef = useRef(null), lastInk = useRef(0);

  const setList = (list) => { S.current = list; setStrokes(list); saveInk(key, list); };
  const paint = useCallback(() => {
    const cv = cvRef.current; if (!cv) return;
    const x = cv.getContext("2d");
    x.clearRect(0, 0, cv.width, cv.height);
    drawStrokes(x, cur.current ? [...S.current, cur.current] : S.current, cv.width, cv.height);
  }, []);
  useSizedCanvas(cvRef, paint);

  /* ── history ── */
  const doUndo = useCallback(() => {
    const a = undo.current.pop(); if (!a) return;
    if (a.t === "add") setList(S.current.filter((s) => s !== a.s));
    else if (a.t === "erase") { const l = [...S.current]; [...a.items].sort((p, q) => p.i - q.i).forEach(({ i, s }) => l.splice(Math.min(i, l.length), 0, s)); setList(l); }
    else if (a.t === "clear") setList(a.list);
    redo.current.push(a); bump((n) => n + 1);
  }, []);                                                    // eslint-disable-line react-hooks/exhaustive-deps
  const doRedo = useCallback(() => {
    const a = redo.current.pop(); if (!a) return;
    if (a.t === "add") setList([...S.current, a.s]);
    else if (a.t === "erase") setList(S.current.filter((s) => !a.items.some((it) => it.s === s)));
    else if (a.t === "clear") setList([]);
    undo.current.push(a); bump((n) => n + 1);
  }, []);                                                    // eslint-disable-line react-hooks/exhaustive-deps
  const clearAll = () => { if (!S.current.length) return; undo.current.push({ t: "clear", list: S.current }); redo.current = []; setList([]); };

  /* ── keyboard: Ctrl/⌘+Z undo · Ctrl/⌘+Shift+Z or Ctrl+Y redo · Esc close · P pen · E eraser ── */
  useEffect(() => {
    const k = (e) => {
      const mod = e.ctrlKey || e.metaKey, z = e.key.toLowerCase();
      if (mod && z === "z") { e.preventDefault(); e.stopImmediatePropagation(); e.shiftKey ? doRedo() : doUndo(); }
      else if (mod && z === "y") { e.preventDefault(); e.stopImmediatePropagation(); doRedo(); }
      else if (e.key === "Escape") onClose();
      else if (!mod && z === "p") setTool((t) => (t === "pen" ? "view" : "pen"));
      else if (!mod && z === "e") setTool((t) => (t === "eraser" ? "view" : "eraser"));
    };
    const prev = document.body.style.overflow;
    window.addEventListener("keydown", k, true);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", k, true); document.body.style.overflow = prev; };
  }, [onClose, doUndo, doRedo]);

  /* ── pointer ── */
  const pos = (e) => { const r = cvRef.current.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, W: r.width, H: r.height, px: e.clientX - r.left, py: e.clientY - r.top }; };
  const eraseAt = (e) => {
    const { px, py, W, H } = pos(e), r = 16, list = S.current, gone = [];
    list.forEach((s, i) => { if (hits(s, px, py, W, H, r)) gone.push({ i, s }); });
    if (!gone.length) return;
    erase.current = [...(erase.current || []), ...gone];
    setList(list.filter((s) => !gone.some((g) => g.s === s)));
    paint();
  };
  const ring = (e, on) => {
    const el = ringRef.current, st = cvRef.current && cvRef.current.parentElement.getBoundingClientRect();
    if (!el || !st) return;
    el.style.display = on ? "block" : "none";
    el.style.transform = `translate(${e.clientX - st.left - 16}px, ${e.clientY - st.top - 16}px)`;
  };
  const down = (e) => {
    if (tool === "view" || !e.isPrimary || e.button > 0) return;
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
    if (tool === "eraser") { erase.current = []; eraseAt(e); ring(e, true); return; }
    const { x, y } = pos(e), c = COLORS.find((q) => q.id === color), sz = SIZES[size];
    cur.current = { c: c.c, a: c.hl ? 0.38 : 1, w: c.hl ? sz.w * 3.2 : sz.w, p: [[x, y]] };
    paint();
  };
  const move = (e) => {
    if (tool === "view" || !e.isPrimary) return;
    if (tool === "eraser") { if (erase.current) { eraseAt(e); } ring(e, e.pointerType === "mouse" || !!erase.current); return; }
    if (!cur.current) return;
    const evs = e.nativeEvent.getCoalescedEvents ? e.nativeEvent.getCoalescedEvents() : [e.nativeEvent];
    const r = cvRef.current.getBoundingClientRect();
    for (const ev of (evs.length ? evs : [e.nativeEvent])) {
      const x = (ev.clientX - r.left) / r.width, y = (ev.clientY - r.top) / r.height, l = cur.current.p[cur.current.p.length - 1];
      if (Math.hypot((x - l[0]) * r.width, (y - l[1]) * r.height) > 1.2) cur.current.p.push([Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y))]);
    }
    paint();
  };
  const up = (e) => {
    if (tool === "view") return;
    lastInk.current = Date.now();
    if (tool === "eraser") {
      if (erase.current && erase.current.length) { undo.current.push({ t: "erase", items: erase.current }); redo.current = []; bump((n) => n + 1); }
      erase.current = null; if (e.pointerType !== "mouse") ring(e, false);
      return;
    }
    const s = cur.current; cur.current = null;
    if (s) { undo.current.push({ t: "add", s }); redo.current = []; setList([...S.current, s]); }
  };

  const stop = (e) => e.stopPropagation();
  const pen = tool === "pen", era = tool === "eraser", drawing = pen || era;
  const colObj = COLORS.find((q) => q.id === color);

  return createPortal(
    <div className="lightbox" role="dialog" aria-modal="true" aria-label="عرض الصورة" style={{ "--res": `${pen ? 164 : era ? 106 : 84}px` }} onPointerDown={stop}
      onClick={(e) => { e.stopPropagation(); if (Date.now() - lastInk.current > 400) onClose(); }}>
      <div className="lb-stage" style={{ "--ar": ratio }} onClick={stop}>
        <img src={src} alt="الصورة مكبّرة" draggable="false" onLoad={(e) => { const i = e.currentTarget; if (i.naturalWidth && i.naturalHeight) setRatio(i.naturalWidth / i.naturalHeight); }} />
        <canvas ref={cvRef} className="lb-ink" data-tool={tool} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
          onPointerLeave={(e) => { if (era && !erase.current) ring(e, false); }} onClick={stop} />
        <i ref={ringRef} className="lb-ring" aria-hidden="true" />
      </div>

      <div className="lightbox-bar" onClick={stop}>
        <button type="button" className="lightbox-btn" onClick={() => onSave(S.current)} aria-label="حفظ الصورة" title={strokes.length ? "حفظ الصورة بالكتابة عليها" : "حفظ الصورة"}><Icon name="download" size={20} /></button>
        <button type="button" className="lightbox-btn" onClick={onClose} aria-label="إغلاق" title="إغلاق (Esc)"><Icon name="x" size={20} /></button>
      </div>

      <div className="ink-bar" dir="rtl" onClick={stop} role="toolbar" aria-label="أدوات الكتابة على الصورة">
        {pen && (
          <div className="ink-row ink-opts">
            {COLORS.map((q) => (
              <button key={q.id} type="button" className="ink-color" data-on={color === q.id} data-hl={!!q.hl} style={{ "--c": q.c }} onClick={() => setColor(q.id)} aria-label={q.label} title={q.label} />
            ))}
            <span className="ink-sep" />
            {SIZES.map((z) => (
              <button key={z.id} type="button" className="ink-size" data-on={size === z.id} onClick={() => setSize(z.id)} aria-label={`سمك ${z.id + 1}`}>
                <i style={{ width: z.d, height: z.d, background: colObj.c, opacity: colObj.hl ? 0.55 : 1 }} />
              </button>
            ))}
          </div>
        )}
        <div className="ink-row">
          <button type="button" className="ink-btn" data-on={pen} aria-pressed={pen} onClick={() => setTool(pen ? "view" : "pen")} aria-label="قلم" title="قلم (P)"><Icon name="pencil" size={21} /></button>
          <button type="button" className="ink-btn" data-on={era} aria-pressed={era} onClick={() => setTool(era ? "view" : "eraser")} aria-label="ممحاة: لمسة على الخط تمسحه" title="ممحاة — لمسة على الخط تمسحه (E)"><Icon name="eraser" size={21} /></button>
          <span className="ink-sep" />
          <button type="button" className="ink-btn" disabled={!undo.current.length} onClick={doUndo} aria-label="تراجع" title="تراجع (Ctrl+Z)"><Icon name="undo" size={21} /></button>
          <button type="button" className="ink-btn" disabled={!redo.current.length} onClick={doRedo} aria-label="إعادة" title="إعادة (Ctrl+Shift+Z)"><Icon name="redo" size={21} /></button>
          <button type="button" className="ink-btn" disabled={!strokes.length} onClick={clearAll} aria-label="مسح كل الكتابة" title="مسح كل الكتابة (تقدر تتراجع)"><Icon name="trash" size={20} /></button>
        </div>
        {drawing && <small className="ink-hint">{pen ? "اكتب بإصبعك أو بالماوس · Ctrl+Z للتراجع" : "المس أي خط عشان يتمسح · Ctrl+Z للتراجع"}</small>}
      </div>
    </div>,
    document.body,
  );
}
