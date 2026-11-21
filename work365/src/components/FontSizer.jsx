import React, { useState, useEffect, useRef } from "react";
import Icon from "./Icon.jsx";
import { useTextScale, scaleStyle } from "../lib/textscale.js";

/* The "Aa" button of ONE block of text.
   Tap it → a small bar with  A−  ·  100%  ·  A+ . The percentage resets that block to its normal size.
   It changes only the block that owns this `id` (see lib/textscale.js): no other block, and nothing else on the screen. */
export default function FontSizer({ id, label = "حجم الخط", className = "" }) {
  const [scale, api] = useTextScale(id);
  const [open, setOpen] = useState(false);
  const [align, setAlign] = useState("left");   // which edge of the button the bar hangs from, so it never leaves the screen
  const box = useRef(null);

  /* the bar closes when you tap anywhere else or press Esc */
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away, true); document.removeEventListener("keydown", esc); };
  }, [open]);

  const pct = Math.round(scale * 100);
  const stop = (e) => e.stopPropagation();   // the control may sit inside a clickable card: never trigger the card
  return (
    <span className={`fs ${className}`} ref={box} data-changed={scale !== 1} data-open={open} onClick={stop}>
      <button type="button" className="iconbtn fs-btn" aria-label={`${label} (${pct}%)`} title={label} aria-expanded={open} onClick={() => {
          if (!open && box.current) { const r = box.current.getBoundingClientRect(); setAlign(window.innerWidth - r.left >= 190 ? "left" : "right"); }
          setOpen((o) => !o);
        }}>
        <Icon name="textSize" size={18} />
      </button>
      {open && (
        <span className="fs-pop" data-align={align} role="group" aria-label={label}>
          <button type="button" className="fs-step" onClick={api.dec} disabled={!api.canDec} aria-label="صغّر الخط">A−</button>
          <button type="button" className="fs-val" onClick={api.reset} disabled={scale === 1} title="رجّع الحجم الأصلي" aria-label={`الحجم ${pct} بالمية. دوس لإرجاعه للأصلي`}>{pct}%</button>
          <button type="button" className="fs-step fs-plus" onClick={api.inc} disabled={!api.canInc} aria-label="كبّر الخط">A+</button>
        </span>
      )}
    </span>
  );
}

/* A wrapper whose text size is that of block `id` (use it where a hook cannot be called, e.g. inside a .map()). */
export function ScaledBox({ id, className = "", style, children, ...rest }) {
  const [ts] = useTextScale(id);
  return <div className={`ts-box ${className}`} style={{ ...(style || {}), ...(scaleStyle(ts) || {}) }} {...rest}>{children}</div>;
}
