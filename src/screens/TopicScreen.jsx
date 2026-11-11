import React, { useState, useEffect, useMemo, useRef } from "react";
import Icon from "../components/Icon.jsx";
import { ConfirmButton } from "../components/ui.jsx";
import FontSizer from "../components/FontSizer.jsx";
import { useTextScale, scaleStyle } from "../lib/textscale.js";
import { RichText, WordList, Mixed } from "../components/rich.jsx";
import { orderTopicItems, topicSig, topicOverview } from "../lib/topics.js";
import { itemsFromSaved } from "../lib/docs.js";
import { wordLines, parseWord } from "../lib/parse.js";
import { fixText } from "../lib/text.js";
import { store } from "../lib/storage.js";
import { stampShort } from "../lib/time.js";

const fmtDate = (ts) => { try { return new Date(ts).toLocaleDateString("ar-EG", { day: "numeric", month: "short" }); } catch (e) { return ""; } };

/* a collapsible card, same look as the result sections of a question */
function Section({ cls, icon, title, sub, defaultOpen = true, tools, children, onOpen, scaleId }) {
  const [open, setOpen] = useState(defaultOpen);
  const [ts] = useTextScale(scaleId);   // this section's own text size only
  useEffect(() => { if (open && onOpen) onOpen(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section className={`sec ${cls}`} data-open={open}>
      <header className="sec-head">
        <button type="button" className="sec-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <span className="sec-ico"><Icon name={icon} size={21} /></span>
          <span className="sec-title"><h3>{title}</h3>{sub && <p>{sub}</p>}</span>
        </button>
        {open && scaleId && <div className="sec-tools"><FontSizer id={scaleId} label={`حجم خط ${title}`} /></div>}
        {open && tools}
        <button type="button" className="sec-chev" aria-expanded={open} aria-label={open ? `اقفل ${title}` : `افتح ${title}`} onClick={() => setOpen((o) => !o)}>
          <Icon name="chevron" size={20} />
        </button>
      </header>
      {open && <div className="sec-body ts-box" style={scaleStyle(ts)}>{children}</div>}
    </section>
  );
}

/* every file / picture / text of the topic, together (loaded only when the section is opened) */
function Gallery({ items, onOpen, active }) {
  const [rows, setRows] = useState(null);
  const sig = items.map((q) => `${q.id}:${q.updatedAt}`).join("|");
  useEffect(() => {
    if (!active) return undefined;
    let alive = true;
    (async () => {
      const out = [];
      for (const q of items) {
        const rec = await store.get(`clinix:img:${q.id}`);
        let list = rec ? itemsFromSaved(rec.data, rec.doc) : [];
        if (!list.length && q.thumb) list = [{ t: "image", url: q.thumb, name: q.title, label: "IMG" }];
        out.push({ q, list });
      }
      if (alive) setRows(out);
    })();
    return () => { alive = false; };
  }, [sig, active]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!rows) return <p className="topic-muted">بنحمّل الملفات…</p>;
  const total = rows.reduce((n, r) => n + r.list.length, 0);
  if (!total) return <p className="topic-muted">مفيش ملفات أو صور محفوظة في الموضوع ده.</p>;
  return (
    <div className="gal">
      {rows.filter((r) => r.list.length).map((r) => (
        <div key={r.q.id} className="gal-group">
          <button type="button" className="gal-title" onClick={() => onOpen(r.q.id)} dir="auto">
            <Icon name={r.q.kind === "lesson" ? "bookOpen" : "fileText"} size={14} /> {r.q.title}
          </button>
          <div className="gal-grid">
            {r.list.map((it, i) => (
              <button key={i} type="button" className="gal-tile" data-t={it.t} onClick={() => onOpen(r.q.id)} title={it.name}>
                {it.t === "image" ? <img src={it.url} alt={it.name || ""} loading="lazy" /> : (
                  <span className="gal-file"><b>{it.label || (it.t === "pdf" ? "PDF" : "TXT")}</b><small dir="auto">{it.name}</small></span>
                )}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function TopicScreen({ topic, questions, apiKey, onNeedKey, onOpen, onMove, onRename, onDelete, onSaveOverview, onAI }) {
  const items = useMemo(() => orderTopicItems(topic, questions), [topic, questions]);
  const lessons = items.filter((q) => q.kind === "lesson");
  const exams = items.filter((q) => q.kind !== "lesson");
  const sig = useMemo(() => topicSig(topic, questions), [topic, questions]);
  const stale = !!topic.overview && topic.overviewSig !== sig;

  /* rename */
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(topic.name);
  useEffect(() => { setName(topic.name); }, [topic.name]);
  const commitName = () => { setEditing(false); if (name.trim() && name.trim() !== topic.name) onRename(name.trim()); else setName(topic.name); };

  /* overview (streamed, saved when finished) */
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const ctl = useRef(null);
  useEffect(() => () => ctl.current?.abort(), []);
  const makeOverview = async () => {
    if (busy || !items.length) return;
    if (!apiKey) { onNeedKey(); return; }
    setErr(""); setBusy(true); setDraft("");
    const ctrl = new AbortController();
    ctl.current = ctrl;
    try {
      const out = await topicOverview({ apiKey, topic, items, signal: ctrl.signal, onText: (t) => setDraft(fixText(t)) });
      const text = fixText(out.text).trim();
      setDraft(null);
      onSaveOverview(text, sig);
    } catch (e) {
      if (e && e.name === "AbortError") setDraft(null);
      else { setErr((e && e.message) || "حصلت مشكلة. جرّب تاني."); setDraft(null); }
    } finally { setBusy(false); ctl.current = null; }
  };
  const shown = draft !== null ? draft : topic.overview;

  /* all the words of the topic, once each */
  const words = useMemo(() => {
    const seen = new Set();
    const out = [];
    items.forEach((q) => wordLines(q.new_words || "").forEach((l) => {
      const k = parseWord(l).term.toLowerCase();
      if (k && !seen.has(k)) { seen.add(k); out.push(l); }
    }));
    return out.join("\n");
  }, [items]);
  const wordCount = words ? words.split("\n").length : 0;
  const [galOpen, setGalOpen] = useState(false);

  const Row = ({ q, n }) => (
    <div className="card qcard trow" onClick={() => onOpen(q.id)} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(q.id); } }}>
      <span className="qthumb">{q.thumb ? <img src={q.thumb} alt="" loading="lazy" /> : <Icon name={q.kind === "lesson" ? "bookOpen" : "fileText"} size={26} />}</span>
      <span className="qbody">
        <h3 dir="auto"><i className="trow-n">{n}</i> {q.title}</h3>
        <span className="snip" dir="auto">{(q.original_question_text || "—").replace(/[#*>`]/g, "").replace(/\s+/g, " ")}</span>
        <span className="qfoot">
          {q.kind === "lesson" && <span className="pill pill-lesson" style={{ padding: "1px 10px" }}>شرح 📖</span>}
          <span className="pill pill-violet" style={{ padding: "1px 10px" }}>{wordLines(q.new_words).length} كلمة</span>
          <span title="وقت الحفظ">{stampShort(q.createdAt || q.updatedAt)}</span>
        </span>
      </span>
      <button type="button" className="iconbtn trow-move" aria-label="انقل لموضوع تاني" title="انقل لموضوع تاني" onClick={(e) => { e.stopPropagation(); onMove(q.id); }}><Icon name="folder" size={17} /></button>
    </div>
  );

  return (
    <div className="page topic-page">
      <section className="card topic-head">
        <span className="topic-emoji" aria-hidden="true">{topic.emoji || "📘"}</span>
        <div className="topic-info">
          {editing ? (
            <input className="input topic-name-in" autoFocus value={name} dir="auto" onChange={(e) => setName(e.target.value)} onBlur={commitName}
              onKeyDown={(e) => { if (e.key === "Enter") commitName(); if (e.key === "Escape") { setName(topic.name); setEditing(false); } }} />
          ) : (
            <h1 dir="auto">{topic.name} <button type="button" className="iconbtn topic-edit" onClick={() => setEditing(true)} aria-label="غيّر اسم الموضوع"><Icon name="pencil" size={14} /></button></h1>
          )}
          {topic.summary && <Mixed as="p" className="topic-sum" text={topic.summary} />}
          <div className="pills">
            {exams.length > 0 && <span className="pill"><Icon name="fileText" size={14} /> <b>{exams.length}</b> أسئلة</span>}
            {lessons.length > 0 && <span className="pill pill-lesson"><Icon name="bookOpen" size={14} /> <b>{lessons.length}</b> شرح</span>}
            <span className="pill pill-violet"><Icon name="library" size={14} /> <b>{wordCount}</b> كلمة</span>
          </div>
        </div>
        <div className="topic-actions">
          <button type="button" className="btn btn-teal btn-sm" onClick={() => onAI({ text: `اشرحلي موضوع «${topic.name}» وربطه بالأسئلة اللي ذاكرتها.`, send: false })}><b className="ai-mark ai-mark-sm">AI</b> اسأل عن الموضوع</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onAI({ text: `اعملي امتحان 10 أسئلة على ${topic.name}`, send: true, exam: true })}><Icon name="clipboard" size={16} /> امتحني فيه</button>
          <ConfirmButton onConfirm={onDelete} label="فكّ الموضوع" confirmLabel="تأكيد؟" iconOnly />
        </div>
      </section>

      <div className="results topic-results">
        <Section scaleId="topic:overview" cls="sec-teal" icon="brain" title="شرح الموضوع" sub="كل اللي ذاكرته في الموضوع ده، مترابط في مكان واحد"
          tools={shown && !busy ? <div className="sec-tools"><button type="button" className="iconbtn" onClick={makeOverview} aria-label="حدّث الشرح" title="حدّث الشرح"><Icon name="refresh" size={16} /></button></div> : null}>
          {busy && !shown && <p className="topic-muted"><span className="live" style={{ margin: 0 }}><i /><i /><i /></span> بيقرا الأسئلة والشروحات ويجمّعها…</p>}
          {shown ? <RichText text={shown} /> : !busy && (
            <div className="topic-gen">
              <p className="topic-muted">{items.length > 1 ? `اكتب شرح واحد بيربط ${items.length} حاجات ذاكرتها في الموضوع ده: الفكرة، القواعد، اللي اتكرر، ونقاط الحفظ.` : "اكتب شرح للموضوع من اللي ذاكرته."}</p>
              <button type="button" className="btn btn-teal" onClick={makeOverview}><Icon name="sparkles" size={18} /> اكتب شرح الموضوع</button>
            </div>
          )}
          {busy && (
            <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} onClick={() => ctl.current?.abort()}><Icon name="stop" size={15} /> إيقاف</button>
          )}
          {stale && !busy && (
            <p className="topic-stale"><Icon name="alert" size={15} /> الموضوع اتغيّر من آخر مرة اتكتب فيها الشرح. <button type="button" onClick={makeOverview}>حدّثه</button></p>
          )}
          {err && <p className="topic-err" role="alert">{err}</p>}
        </Section>

        {lessons.length > 0 && (
          <Section scaleId="topic:lessons" cls="sec-sky" icon="bookOpen" title="الشروحات والمواد" sub={`${lessons.length} ${lessons.length > 2 ? "مواد" : "مادة"} اتشرحت`}>
            <div className="trows">{lessons.map((q, i) => <Row key={q.id} q={q} n={i + 1} />)}</div>
          </Section>
        )}

        {exams.length > 0 && (
          <Section scaleId="topic:exams" cls="sec-violet" icon="fileText" title="الأسئلة" sub={`${exams.length} ${exams.length > 10 ? "سؤال" : "أسئلة"} في الموضوع`}>
            <div className="trows">{exams.map((q, i) => <Row key={q.id} q={q} n={i + 1} />)}</div>
          </Section>
        )}

        <Section cls="sec-coral" icon="imagePlus" title="الملفات والصور" sub="كل الملفات والصور اللي رفعتها للموضوع، مع بعض" defaultOpen={false} onOpen={() => setGalOpen(true)}>
          <Gallery items={items} onOpen={onOpen} active={galOpen} />
        </Section>

        {wordCount > 0 && (
          <Section scaleId="topic:words" cls="sec-violet" icon="library" title="كلمات الموضوع" sub={`${wordCount} كلمة من كل الأسئلة، من غير تكرار`} defaultOpen={false}>
            <WordList text={words} showCount={false} />
          </Section>
        )}
      </div>
    </div>
  );
}
