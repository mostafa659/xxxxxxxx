import React, { useState, useMemo, useEffect } from "react";
import { createPortal } from "react-dom";
import Icon from "./Icon.jsx";

/* the pictures under a chat answer (lib/photos.js).
   Small thumbnails are loaded lazily, so they never slow the answer down; a photo whose link is broken is replaced by one of its
   spare candidates (or simply dropped); tapping a photo opens it big. Every photo shows its credit and a link to the original page. */

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return ""; } };

function Credit({ it }) {
  return (
    <span className="ph-credit" dir="auto">
      <a href={it.creditUrl || it.page} target="_blank" rel="noopener noreferrer" title="صاحب الصورة / الموقع">📷 {it.credit || hostOf(it.page)}</a>
      {it.page && <a className="ph-orig" href={it.page} target="_blank" rel="noopener noreferrer" title={`الصفحة الأصلية · ${hostOf(it.page)}`}>الأصل ↗</a>}
    </span>
  );
}

function Viewer({ it, onClose }) {
  useEffect(() => {
    const k = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return createPortal(
    <div className="ph-view" role="dialog" aria-modal="true" aria-label={it.why || it.title || "صورة"} onClick={onClose}>
      <figure onClick={(e) => e.stopPropagation()}>
        <img src={it.url || it.thumb} alt={it.title || it.why || ""} referrerPolicy="no-referrer"
          onError={(e) => { if (it.thumb && e.currentTarget.src !== it.thumb) e.currentTarget.src = it.thumb; }} />
        <figcaption>
          {it.why && <b dir="auto">{it.why}</b>}
          <Credit it={it} />
        </figcaption>
      </figure>
      <button type="button" className="iconbtn ph-x" onClick={onClose} aria-label="إغلاق"><Icon name="x" size={20} /></button>
    </div>,
    document.body,
  );
}

export default function PhotoStrip({ photos }) {
  const [bad, setBad] = useState(() => new Set());
  const [open, setOpen] = useState(null);
  const loading = photos.state === "loading";
  const shown = useMemo(() => {
    const used = new Set(), out = [];
    for (const it of photos.items || []) {
      const pick = [it, ...(it.alts || [])].find((c) => !bad.has(c.id) && !used.has(c.id));
      if (pick) { used.add(pick.id); out.push({ ...pick, why: it.why }); }
    }
    return out;
  }, [photos.items, bad]);
  const pending = loading ? Math.max(0, (photos.total || 0) - shown.length) : 0;
  if (!shown.length && !pending) return null;
  return (
    <div className="ph" role="group" aria-label="صور توضيحية">
      <div className="ph-row">
        {shown.map((it) => (
          <figure className="ph-card" key={it.id}>
            <button type="button" className="ph-img" onClick={() => setOpen(it)} aria-label={`كبّر: ${it.why || it.title || "صورة"}`}>
              <img src={it.thumb} alt={it.title || it.why || ""} loading="lazy" decoding="async" referrerPolicy="no-referrer"
                onError={() => setBad((s) => new Set(s).add(it.id))} />
            </button>
            <figcaption>
              {it.why && <b dir="auto">{it.why}</b>}
              <Credit it={it} />
            </figcaption>
          </figure>
        ))}
        {Array.from({ length: pending }, (_, i) => <div className="ph-card ph-skel" key={`s${i}`} aria-hidden="true" />)}
      </div>
      {open && <Viewer it={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
