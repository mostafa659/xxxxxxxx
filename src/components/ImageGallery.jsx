/* معرض الصور: the pictures the student chose to keep, one section per lesson.
   Each card: tap = full screen (with the pen) · bookmark = take it out of the gallery · pencil = rename · arrow = save a file on the device. */
import React, { useMemo, useState, useRef, useEffect } from "react";
import Icon from "./Icon.jsx";
import { Lightbox, StrokeLayer, inkKey, loadInk } from "./ImageInk.jsx";
import { useBank, useBankPixels, removeImage, renameImage, GLOBAL_LESSON } from "../lib/imagebank.js";
import { saveImageFile } from "../lib/imgfile.js";

const fmtDate = (t) => {
  try { return new Date(t).toLocaleDateString("ar-EG", { day: "numeric", month: "short", year: "numeric" }); } catch (e) { return ""; }
};

function Card({ e }) {
  const rec = useBankPixels(e.id);
  const [big, setBig] = useState(false);
  const [sure, setSure] = useState(false);
  const [edit, setEdit] = useState(false);
  const [name, setName] = useState(e.caption);
  const [inkVer, setInkVer] = useState(0);
  const inRef = useRef(null);
  const src = rec ? `data:${rec.mime};base64,${rec.data}` : "";
  const ink = useMemo(() => (src ? loadInk(inkKey(src)) : []), [src, inkVer]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (edit) inRef.current?.focus(); }, [edit]);
  useEffect(() => { setName(e.caption); }, [e.caption]);
  useEffect(() => { if (!sure) return undefined; const t = setTimeout(() => setSure(false), 2600); return () => clearTimeout(t); }, [sure]);
  const commit = () => { setEdit(false); if (name.trim() && name.trim() !== e.caption) renameImage(e.id, name); else setName(e.caption); };

  return (
    <figure className="gal-card">
      <button type="button" className="gal-pic" onClick={() => rec && setBig(true)} aria-label={`تكبير: ${e.caption}`} disabled={!rec}>
        {rec ? <><img src={src} alt={e.caption} loading="lazy" /><StrokeLayer strokes={ink} /></> : <span className="gal-load" />}
      </button>
      <figcaption>
        {edit ? (
          <input ref={inRef} className="gal-edit" dir="auto" value={name} maxLength={90}
            onChange={(ev) => setName(ev.target.value)} onBlur={commit}
            onKeyDown={(ev) => { if (ev.key === "Enter") commit(); if (ev.key === "Escape") { setName(e.caption); setEdit(false); } }} />
        ) : <b dir="auto">{e.caption}</b>}
        <small>{fmtDate(e.createdAt)}</small>
      </figcaption>
      <div className="gal-acts">
        <button type="button" className="iconbtn" onClick={() => setEdit(true)} aria-label="تغيير الاسم" title="تغيير الاسم"><Icon name="pencil" size={16} /></button>
        <button type="button" className="iconbtn" disabled={!rec} onClick={() => rec && saveImageFile(rec, ink)} aria-label="حفظ ملف على الجهاز" title="حفظ ملف على الجهاز"><Icon name="download" size={16} /></button>
        <button type="button" className="iconbtn gal-un" data-sure={sure} onClick={() => (sure ? removeImage(e.id) : setSure(true))}
          aria-label="شيل من المعرض" title="شيل من المعرض">
          {sure ? <span>تأكيد؟</span> : <Icon name="bookmark" size={16} fill="currentColor" />}
        </button>
      </div>
      {big && rec && <Lightbox src={src} onClose={() => { setBig(false); setInkVer((n) => n + 1); }} onSave={(strokes) => { saveImageFile(rec, Array.isArray(strokes) ? strokes : ink); setInkVer((n) => n + 1); }} />}
    </figure>
  );
}

export default function ImageGallery({ questions = [], topics, onOpen }) {
  const bank = useBank();
  const [q, setQ] = useState("");
  const [shut, setShut] = useState({});          // collapsed lessons

  const groups = useMemo(() => {
    const byQ = new Map(questions.map((x) => [x.id, x]));
    const topicOf = (id) => {
      const t = topics && topics.list ? topics.list.find((tt) => (tt.qids || []).includes(id)) : null;
      return t ? t.name : "";
    };
    const needle = q.trim().toLowerCase();
    const map = new Map();
    for (const e of bank) {
      const live = byQ.get(e.lessonId);
      const title = e.lessonId === GLOBAL_LESSON ? "من شات AI العام" : (live && live.title) || e.lessonTitle || "درس محذوف";
      if (needle && !(`${e.caption} ${title}`.toLowerCase().includes(needle))) continue;
      if (!map.has(e.lessonId)) map.set(e.lessonId, { id: e.lessonId, title, topic: topicOf(e.lessonId), open: !!live, global: e.lessonId === GLOBAL_LESSON, items: [], last: 0 });
      const g = map.get(e.lessonId);
      g.items.push(e); g.last = Math.max(g.last, e.createdAt);
    }
    return [...map.values()].sort((a, b) => b.last - a.last);
  }, [bank, questions, topics, q]);

  return (
    <div className="page page-wide gal">
      <div className="gal-head">
        <span className="gal-ico"><Icon name="images" size={24} /></span>
        <div>
          <h1>معرض الصور</h1>
          <p>{bank.length ? `${bank.length} صورة محفوظة في ${new Set(bank.map((e) => e.lessonId)).size} درس` : "الصور اللي تختار تحفظها بتظهر هنا مرتبة حسب الدرس"}</p>
        </div>
      </div>

      {bank.length > 4 && (
        <div className="gal-search">
          <Icon name="search" size={18} />
          <input className="input" dir="auto" value={q} onChange={(e) => setQ(e.target.value)} placeholder="دوّر باسم الصورة أو الدرس…" aria-label="بحث في المعرض" />
        </div>
      )}

      {!bank.length && (
        <div className="card empty gal-empty">
          <span className="empty-ico"><Icon name="bookmark" size={30} /></span>
          <b>المعرض فاضي</b>
          <p>لما الـ AI يرسملك صورة، هتلاقي على الصورة أيقونة <b>احفظ</b> 🔖. اللي تدوس عليها بس هي اللي بتنزل هنا، وباقي الصور ما بتتحفظش.</p>
        </div>
      )}
      {!!bank.length && !groups.length && <div className="card empty"><b>مفيش نتيجة</b><p>جرّب كلمة تانية.</p></div>}

      {groups.map((g) => {
        const closed = !!shut[g.id];
        return (
          <section key={g.id} className="gal-group">
            <header className="gal-gh">
              <button type="button" className="gal-toggle" onClick={() => setShut((s) => ({ ...s, [g.id]: !s[g.id] }))} aria-expanded={!closed}>
                <Icon name={g.global ? "sparkles" : "folder"} size={19} />
                <span className="gal-gt"><b dir="auto">{g.title}</b>{g.topic && <small dir="auto">{g.topic}</small>}</span>
                <span className="pill">{g.items.length}</span>
                <Icon name="chevron" size={18} className="gal-chev" style={{ transform: closed ? "rotate(90deg)" : "none" }} />
              </button>
              {g.open && !g.global && <button type="button" className="btn btn-ghost btn-sm" onClick={() => onOpen(g.id)}>افتح الدرس</button>}
            </header>
            {!closed && <div className="gal-grid">{g.items.map((e) => <Card key={e.id} e={e} />)}</div>}
          </section>
        );
      })}
    </div>
  );
}
