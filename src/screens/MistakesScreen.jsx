import React, { useMemo, useState } from "react";
import Icon from "../components/Icon.jsx";
import { RichText, Mixed } from "../components/rich.jsx";
import { stampShort } from "../lib/time.js";
import {
  useMistakes, filterList, organizeMistakes, summarize, catInfo, recordAnswer, setMastered, removeMistake, clearMastered, MASTER_AT,
} from "../lib/mistakes.js";

/* «غلطاتي» — every exam question the student got wrong, organised: category → topic → question.
   Nothing here costs a Gemini request except the two AI buttons (explain / new exam on the topic). */

const L = "ABCDEF";
const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const same = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
const plural = (n, one, few) => (n > 10 ? one : few);

/* ───────────── re-practice (a short quiz made of the wrong questions) ───────────── */
function Practice({ items, title, onClose, onAsk }) {
  const deck = useMemo(() => shuffle(items).map((m) => ({ m, order: shuffle(m.options.map((_, i) => i)) })), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [i, setI] = useState(0);
  const [sel, setSel] = useState([]);
  const [checked, setChecked] = useState(false);
  const [res, setRes] = useState([]);           // [{ id, ok }]
  const [fresh, setFresh] = useState({});       // id → "mastered"
  const cur = deck[i];

  if (!cur) {
    const ok = res.filter((r) => r.ok).length;
    const bad = deck.filter(({ m }) => res.some((r) => r.id === m.id && !r.ok)).map((d) => d.m);
    const newly = Object.values(fresh).filter((v) => v === "mastered").length;
    const pct = Math.round((ok / Math.max(1, deck.length)) * 100);
    return (
      <div className="modal-bg" onClick={onClose}>
        <div className="card modal mpr" role="dialog" aria-modal="true" aria-label="نتيجة التدريب" onClick={(e) => e.stopPropagation()}>
          <div className="modal-head"><h2>خلصت التدريب 🎯</h2><button type="button" className="iconbtn" onClick={onClose} aria-label="إغلاق"><Icon name="x" size={18} /></button></div>
          <div className="exam-score" data-lv={pct >= 70 ? "hi" : pct >= 50 ? "mid" : "lo"}>
            <div className="exam-ring"><b>{ok}<i>/{deck.length}</i></b><span>{pct}%</span></div>
            <p>{pct >= 85 ? "ممتاز! غلطاتك بتتصلّح 🏆" : pct >= 60 ? "كويس، كمّل لحد ما تثبّتها 💪" : "عادي، الغلط هو اللي بيعلّم. جرّب تاني 💙"}</p>
          </div>
          {newly > 0 && <p className="mpr-note">🌟 اتقنت {newly} {plural(newly, "سؤال", "أسئلة")} ({MASTER_AT} إجابات صح ورا بعض)، واتنقلت لتبويب «اتقنتها».</p>}
          <div className="exam-actions">
            {bad.length > 0 && <button type="button" className="btn btn-teal btn-sm" onClick={() => { onClose({ again: bad }); }}>كرّر اللي غلطت فيه ({bad.length})</button>}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onClose()}>رجوع لغلطاتي</button>
          </div>
        </div>
      </div>
    );
  }

  const { m, order } = cur;
  const opts = order.map((o) => m.options[o]);
  const key = order.map((o, now) => (m.correct.includes(o) ? now : -1)).filter((n) => n >= 0);
  const multi = m.type === "multi";
  const right = checked && same(sel, key);
  const pick = (k) => { if (checked) return; setSel(multi ? (sel.includes(k) ? sel.filter((x) => x !== k) : [...sel, k]) : [k]); };
  const confirm = () => {
    if (!sel.length || checked) return;
    const out = recordAnswer(m, sel.map((k) => order[k]), { exam: m.exam, retry: true });
    setChecked(true);
    setRes((r) => [...r, { id: m.id, ok: same(sel, key) }]);
    if (out === "mastered") setFresh((f) => ({ ...f, [m.id]: "mastered" }));
  };
  const next = () => { setI(i + 1); setSel([]); setChecked(false); };

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="card modal mpr" role="dialog" aria-modal="true" aria-label="تدريب على الغلطات" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2 dir="auto">{title}</h2>
          <small className="mpr-count">{i + 1} / {deck.length}</small>
          <button type="button" className="iconbtn" onClick={() => onClose()} aria-label="إغلاق"><Icon name="x" size={18} /></button>
        </div>
        <div className="exam-bar" aria-hidden="true"><i style={{ width: `${Math.round(((checked ? i + 1 : i) / deck.length) * 100)}%` }} /></div>
        <div className="exam-q" dir="ltr" style={{ marginTop: 12 }}>
          {m.topic && <span className="exam-tag">{m.topic}</span>}
          <p className="exam-stem">{m.stem}</p>
          {multi && <p className="exam-hintline">Select all that apply — اختار كل الإجابات الصح</p>}
        </div>
        <div className="exam-opts" role={multi ? "group" : "radiogroup"} dir="ltr" style={{ marginTop: 10 }}>
          {opts.map((o, k) => {
            const on = sel.includes(k), isKey = key.includes(k);
            const st = checked ? (isKey ? (on ? "ok" : "miss") : on ? "no" : "idle") : on ? "on" : "idle";
            return (
              <button key={k} type="button" className="exam-opt" data-s={st} role={multi ? "checkbox" : "radio"} aria-checked={on} onClick={() => pick(k)} disabled={checked}>
                <i className={multi ? "sq" : ""}>{checked && isKey ? <Icon name="check" size={14} stroke={3} /> : checked && on ? <Icon name="x" size={14} stroke={3} /> : L[k]}</i>
                <span>{o}</span>
              </button>
            );
          })}
        </div>
        {checked && (
          <div className="exam-why" data-ok={right} style={{ marginTop: 10 }}>
            <b>{right ? "✅ صح!" : "❌ لسه غلط"}</b>
            {m.rationale && <RichText text={m.rationale} />}
            {right && <small className="exam-saved">{fresh[m.id] === "mastered" ? "🌟 اتقنت السؤال ده" : `إجابة صح ${Math.min(MASTER_AT, (m.streak || 0) + 1)} من ${MASTER_AT} لحد ما يتحسب متقن`}</small>}
          </div>
        )}
        <div className="exam-nav" style={{ marginTop: 12 }}>
          {!checked
            ? <button type="button" className="btn btn-teal btn-sm exam-go" disabled={!sel.length} onClick={confirm}>تأكيد الإجابة</button>
            : <button type="button" className="btn btn-teal btn-sm exam-go" onClick={next}>{i === deck.length - 1 ? "شوف النتيجة" : "التالي"}</button>}
        </div>
      </div>
    </div>
  );
}

/* ───────────── one saved question ───────────── */
function Item({ m, onAsk }) {
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  return (
    <div className="mitem" data-done={!!m.mastered}>
      <button type="button" className="mitem-top" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="mitem-mark" aria-hidden="true">{m.mastered ? <Icon name="check" size={14} stroke={3} /> : <Icon name="x" size={14} stroke={3} />}</span>
        <span className="mitem-stem" dir="ltr">{m.stem}</span>
        <span className="mitem-meta">
          {(m.wrong || 1) > 1 && <span className="pill mpill-rep">غلطت ×{m.wrong}</span>}
          {m.mastered ? <span className="pill mpill-ok">متقنة 🌟</span> : (m.streak || 0) > 0 && <span className="pill mpill-prog">{m.streak}/{MASTER_AT} صح</span>}
          <small>{stampShort(m.lastAt)}</small>
        </span>
        <span className="mitem-chev" data-open={open}><Icon name="chevron" size={18} /></span>
      </button>
      {open && (
        <div className="mitem-body">
          <div className="exam-opts" dir="ltr">
            {m.options.map((o, k) => {
              const key = m.correct.includes(k), mine = (m.picked || []).includes(k);
              return (
                <div key={k} className="exam-opt mopt" data-s={key ? (mine ? "ok" : "miss") : mine ? "no" : "idle"}>
                  <i className={m.type === "multi" ? "sq" : ""}>{key ? <Icon name="check" size={14} stroke={3} /> : mine ? <Icon name="x" size={14} stroke={3} /> : L[k]}</i>
                  <span>{o}</span>
                  {mine && !key && <small className="mopt-tag">إجابتك</small>}
                  {key && <small className="mopt-tag mopt-ok">الصح</small>}
                </div>
              );
            })}
          </div>
          {m.rationale && <div className="mrat"><b>ليه؟</b><RichText text={m.rationale} /></div>}
          <small className="mitem-foot">من «{m.exam || "امتحان"}» · أول غلطة {stampShort(m.firstAt)}</small>
          <div className="mitem-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onAsk(`اشرحلي السؤال ده بالتفصيل، وليه كل اختيار صح أو غلط، واديني القاعدة اللي أحفظها:\n${m.stem}\n${m.options.map((o, j) => `${L[j]}) ${o}`).join("\n")}\nالإجابة الصح: ${m.correct.map((j) => L[j]).join(", ")}\nإجابتي: ${(m.picked || []).map((j) => L[j]).join(", ") || "—"}`)}><Icon name="sparkles" size={15} /> اشرحلي</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMastered(m.id, !m.mastered)}>{m.mastered ? "رجّعها للمراجعة" : "اتقنتها ✓"}</button>
            <button type="button" className="btn btn-ghost btn-sm mdel" data-armed={armed} onClick={() => { if (armed) removeMistake(m.id); else { setArmed(true); setTimeout(() => setArmed(false), 2500); } }}><Icon name="trash" size={15} /> {armed ? "تأكيد الحذف؟" : "حذف"}</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ───────────── the screen ───────────── */
export default function MistakesScreen({ onAsk, onHome }) {
  const { list } = useMistakes();
  const [status, setStatus] = useState("open");
  const [cat, setCat] = useState("");
  const [q, setQ] = useState("");
  const [openT, setOpenT] = useState(() => new Set());
  const [practice, setPractice] = useState(null);   // { items, title }
  const [armedClear, setArmedClear] = useState(false);

  const sum = useMemo(() => summarize(list), [list]);
  const counts = useMemo(() => ({ open: sum.open, done: sum.done, all: sum.total }), [sum]);
  const byStatus = useMemo(() => filterList(list, { status, q }), [list, status, q]);
  const catChips = useMemo(() => {
    const m = new Map();
    byStatus.forEach((x) => m.set(x.cat, (m.get(x.cat) || 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [byStatus]);
  const shown = useMemo(() => (cat ? byStatus.filter((x) => x.cat === cat) : byStatus), [byStatus, cat]);
  const groups = useMemo(() => organizeMistakes(shown), [shown]);
  const activeCat = cat && !catChips.some(([c]) => c === cat) ? "" : cat;

  const tk = (c, k) => `${c}:${k}`;
  const toggle = (id) => setOpenT((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allKeys = groups.flatMap((g) => g.topics.map((t) => tk(g.cat, t.key)));
  const allOpen = allKeys.length > 0 && allKeys.every((k) => openT.has(k));

  const openItems = (items) => items.filter((m) => !m.mastered);
  const start = (items, title) => { const arr = items.length ? items : []; if (arr.length) setPractice({ items: arr.slice(0, 25), title }); };
  const onClosePractice = (r) => {
    const again = r && r.again;
    setPractice(again ? { items: again, title: "كرّر اللي غلطت فيه" } : null);
  };

  /* nothing saved yet */
  if (!list.length) {
    return (
      <div className="page">
        <div className="page-head"><h1>غلطاتي</h1></div>
        <div className="card empty">
          <span className="empty-ico"><Icon name="bookX" size={34} /></span>
          <b>لسه مفيش غلطات محفوظة 🎉</b>
          <p>أي سؤال بتغلط فيه وإنت بتحل امتحان داخل التطبيق بيتحفظ هنا لوحده، ومترتّب حسب الموضوع، علشان تراجعه وتتدرّب عليه لحد ما تتقنه.</p>
          <button type="button" className="btn btn-teal" style={{ marginTop: 8 }} onClick={() => onAsk("اعملي امتحان 10 أسئلة NCLEX متنوعة", { exam: true })}><Icon name="clipboard" size={18} /> ابدأ امتحان</button>
          {onHome && <button type="button" className="btn btn-ghost" onClick={onHome}>الرئيسية</button>}
        </div>
      </div>
    );
  }

  return (
    <div className="page mist">
      <div className="page-head">
        <div>
          <h1>غلطاتي</h1>
          <p className="mist-sub">الأسئلة اللي غلطت فيها، مترتّبة حسب المجال والموضوع</p>
        </div>
      </div>

      <div className="mstats" role="group" aria-label="ملخص">
        <div className="mstat" data-k="open"><b>{sum.open}</b><span>محتاجة مراجعة</span></div>
        <div className="mstat" data-k="done"><b>{sum.done}</b><span>اتقنتها</span></div>
        <div className="mstat" data-k="topics"><b>{sum.topics}</b><span>{plural(sum.topics, "موضوع", "مواضيع")}</span></div>
      </div>
      {sum.total > 0 && (
        <div className="mprog" aria-hidden="true"><i style={{ width: `${Math.round((sum.done / sum.total) * 100)}%` }} /></div>
      )}

      {sum.weakest && sum.open > 0 && (
        <p className="mweak"><Icon name="target" size={16} /> أضعف نقطة عندك دلوقتي: <b><Mixed text={sum.weakest.name} /></b>{sum.repeated > 0 && <span> · {sum.repeated} {plural(sum.repeated, "سؤال", "أسئلة")} اتكرر فيهم الغلط</span>}</p>
      )}

      <div className="mcta">
        <button type="button" className="btn btn-teal" disabled={!sum.open} onClick={() => start(openItems(list), "تدريب على كل غلطاتي")}><Icon name="zap" size={18} /> تدرّب على غلطاتك ({Math.min(25, sum.open)})</button>
        {sum.open > 0 && <button type="button" className="btn btn-ghost" onClick={() => start(openItems(list).filter((m) => (m.wrong || 0) > 1), "الغلطات المتكررة")} disabled={!sum.repeated}><Icon name="flame" size={17} /> المتكررة ({sum.repeated})</button>}
      </div>

      <div className="mtools">
        <div className="seg tabs" role="tablist" aria-label="الحالة">
          {[["open", "محتاجة مراجعة"], ["done", "اتقنتها"], ["all", "الكل"]].map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={status === id} data-on={status === id} onClick={() => setStatus(id)}>{label} <small>{counts[id]}</small></button>
          ))}
        </div>
        <label className="msearch">
          <Icon name="search" size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="دوّر في غلطاتك…" dir="auto" aria-label="بحث" />
          {q && <button type="button" onClick={() => setQ("")} aria-label="مسح البحث"><Icon name="x" size={14} /></button>}
        </label>
      </div>

      {catChips.length > 1 && (
        <div className="mchips" role="tablist" aria-label="المجال">
          <button type="button" role="tab" aria-selected={!activeCat} data-on={!activeCat} onClick={() => setCat("")}>الكل <small>{byStatus.length}</small></button>
          {catChips.map(([id, n]) => { const c = catInfo(id); return (
            <button key={id} type="button" role="tab" aria-selected={activeCat === id} data-on={activeCat === id} onClick={() => setCat(activeCat === id ? "" : id)}>{c.emoji} {c.name} <small>{n}</small></button>
          ); })}
        </div>
      )}

      {allKeys.length > 1 && (
        <div className="mfold"><button type="button" className="linkbtn" onClick={() => setOpenT(allOpen ? new Set() : new Set(allKeys))}>{allOpen ? "طيّ كل المواضيع" : "فتح كل المواضيع"}</button></div>
      )}

      {groups.length === 0 ? (
        <div className="card empty"><b>{status === "done" ? "لسه ما اتقنتش أسئلة" : status === "open" ? "مفيش غلطات محتاجة مراجعة 🎉" : "مفيش نتائج"}</b><p>{status === "done" ? "اتدرّب على غلطاتك، وكل سؤال تجاوبه صح " + MASTER_AT + " مرات ورا بعض بيتنقل هنا." : q ? "جرّب كلمة تانية." : "كمّل مذاكرة وامتحانات."}</p></div>
      ) : groups.map((g) => {
        const c = catInfo(g.cat);
        return (
          <section key={g.cat} className="mcat">
            <h2 className="mcat-h"><span aria-hidden="true">{c.emoji}</span> {c.name} <small>{g.open > 0 ? `${g.open} محتاجة مراجعة` : "كلها متقنة ✓"}</small></h2>
            <div className="mtopics">
              {g.topics.map((t) => {
                const id = tk(g.cat, t.key), isOpen = openT.has(id);
                const pct = Math.round((t.done / Math.max(1, t.items.length)) * 100);
                return (
                  <div key={id} className="card mtopic" data-open={isOpen}>
                    <div className="mtopic-top">
                      <button type="button" className="mtopic-btn" aria-expanded={isOpen} onClick={() => toggle(id)}>
                        <span className="mtopic-name" dir="auto">{t.name}</span>
                        <span className="mtopic-count"><b>{t.items.length}</b> {plural(t.items.length, "سؤال", "أسئلة")}{t.done > 0 && <> · <span className="mtopic-done">{t.done} متقن</span></>}</span>
                        <span className="mtopic-bar" aria-hidden="true"><i style={{ width: `${pct}%` }} /></span>
                      </button>
                      {t.open > 0 && <button type="button" className="btn btn-ghost btn-sm mtopic-go" onClick={() => start(openItems(t.items), t.name)} title="تدرّب على الموضوع ده"><Icon name="zap" size={15} /> تدرّب</button>}
                      <button type="button" className="mtopic-chev" data-open={isOpen} aria-label={isOpen ? "طيّ" : "فتح"} onClick={() => toggle(id)}><Icon name="chevron" size={18} /></button>
                    </div>
                    {isOpen && (
                      <div className="mtopic-body">
                        {t.items.map((m) => <Item key={m.id} m={m} onAsk={onAsk} />)}
                        <div className="mtopic-foot">
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onAsk(`اعملي امتحان 5 أسئلة جديدة على ${t.name} وركّز على النقط اللي بغلط فيها`, { exam: true })}><Icon name="clipboard" size={15} /> امتحان جديد على الموضوع</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      {sum.done > 0 && (
        <div className="mfoot">
          <button type="button" className="btn btn-ghost btn-sm mdel" data-armed={armedClear} onClick={() => { if (armedClear) { clearMastered(); setArmedClear(false); } else { setArmedClear(true); setTimeout(() => setArmedClear(false), 2500); } }}>
            <Icon name="trash" size={15} /> {armedClear ? `تأكيد: مسح ${sum.done} متقنة؟` : "مسح الأسئلة المتقنة"}
          </button>
        </div>
      )}

      {practice && <Practice key={practice.title + practice.items.length + practice.items[0].id} items={practice.items} title={practice.title} onClose={onClosePractice} onAsk={onAsk} />}
    </div>
  );
}
