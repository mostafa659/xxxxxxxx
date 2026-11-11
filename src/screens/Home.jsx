import React, { useMemo, useState, useEffect } from "react";
import Icon from "../components/Icon.jsx";
import { wordLines, studyStats } from "../lib/parse.js";
import { levelInfo, weekDays, heroMessage, pickWord } from "../lib/motivation.js";
import { WordCard } from "../components/rich.jsx";
import { assignedSet, topicOf, kindOf } from "../lib/topics.js";
import { prefs } from "../lib/storage.js";
import { stampShort } from "../lib/time.js";
import { useVocab, savedCount } from "../lib/vocab.js";
import { useMistakes, summarize } from "../lib/mistakes.js";

const fmtDate = (ts) => {
  try { return new Date(ts).toLocaleDateString("ar-EG", { day: "numeric", month: "short" }); }
  catch (e) { return ""; }
};

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return "لسه صاحي؟ ربنا يعينك 🌙";
  if (h < 12) return "صباح الخير ☀️";
  if (h < 18) return "أهلاً بيك 👋";
  return "مساء الخير 🌙";
}

const R = 36, C = 2 * Math.PI * R;

function QCard({ q, onOpen, topic }) {
  const n = wordLines(q.new_words).length;
  return (
    <button className="card qcard" onClick={() => onOpen(q.id)}>
      <span className="qthumb">
        {q.thumb ? <img src={q.thumb} alt="" loading="lazy" /> : <Icon name="fileText" size={26} />}
      </span>
      <span className="qbody">
        <h3>{q.title}</h3>
        <span className="snip" dir="auto">{(q.original_question_text || "—").replace(/[#*>`]/g, "").replace(/\s+/g, " ")}</span>
        <span className="qfoot">
          {q.kind === "lesson" && <span className="pill pill-lesson" style={{ padding: "1px 10px" }}>شرح 📖</span>}
          {topic && <span className="pill pill-topic" style={{ padding: "1px 10px" }} dir="auto">{topic.emoji} {topic.name}</span>}
          <span className="pill pill-violet" style={{ padding: "1px 10px" }}>{n} كلمة</span>
          <span title="وقت الحفظ">{stampShort(q.createdAt || q.updatedAt)}</span>
        </span>
      </span>
      <span className="qgo"><Icon name="back" size={18} /></span>
    </button>
  );
}

export default function Home({ questions, words, goal, onGoal, onAdd, onAddLesson, onWords, onOpen, topics, org, onOrganize, onAuto, onOpenTopic, onMove, onMistakes }) {
  const sorted = useMemo(() => [...questions].sort((a, b) => b.updatedAt - a.updatedAt), [questions]);
  const { map: vmap } = useVocab();
  const { list: mlist } = useMistakes();
  const msum = useMemo(() => summarize(mlist), [mlist]);
  const wordCount = useMemo(() => savedCount(vmap), [vmap]);
  const veryN = useMemo(() => Object.values(vmap).filter((e) => e.level === 2).length, [vmap]);
  const stats = useMemo(() => studyStats(questions, goal), [questions, goal]);
  const pct = Math.min(1, stats.today / Math.max(1, goal));
  const left = Math.max(0, goal - stats.today);
  const lv = useMemo(() => levelInfo(questions.length), [questions.length]);
  const week = useMemo(() => weekDays(questions), [questions]);
  const allLines = useMemo(() => Object.values(vmap).filter((e) => e.level > 0).map((e) => e.line), [vmap]);
  const [shift, setShift] = useState(0);
  const wod = useMemo(() => pickWord(allLines, shift), [allLines, shift]);

  /* ── topics: the AI keeps related questions / lessons / files together ── */
  const assigned = useMemo(() => assignedSet(topics), [topics]);
  const pinned = useMemo(() => new Set(topics.pinned), [topics.pinned]);
  /* v3.25: two sections, each with its own topics: الأسئلة (exam questions) and الشروحات (lessons / study material) */
  const [kindTab, setKindTab] = useState(() => (prefs.get("clinix:home:kind", "") === "lesson" ? "lesson" : "question"));
  const pickKind = (k) => { setKindTab(k); prefs.set("clinix:home:kind", k); };
  const nQ = useMemo(() => questions.filter((q) => kindOf(q) === "question").length, [questions]);
  const nL = questions.length - nQ;
  const kindItems = useMemo(() => sorted.filter((q) => kindOf(q) === kindTab), [sorted, kindTab]);
  const isLessons = kindTab === "lesson";
  const loose = useMemo(() => kindItems.filter((q) => !assigned.has(q.id)), [kindItems, assigned]);
  const waiting = useMemo(() => loose.filter((q) => !pinned.has(q.id)), [loose, pinned]);
  const topicList = useMemo(() => topics.list.filter((t) => t.kind === kindTab).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)), [topics.list, kindTab]);
  const byId = useMemo(() => new Map(questions.map((q) => [q.id, q])), [questions]);
  const [view, setView] = useState(() => prefs.get("clinix:home:view", "") || "");
  const mode = view === "all" || view === "topics" ? view : (topicList.length ? "topics" : "all");
  const pickView = (v) => { setView(v); prefs.set("clinix:home:view", v); };
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (!armed) return undefined; const t = setTimeout(() => setArmed(false), 3000); return () => clearTimeout(t); }, [armed]);
  const organizeClick = () => {
    if (org.busy) return;
    if (waiting.length) { onOrganize(false, kindTab); return; }
    if (!armed) { setArmed(true); return; }
    setArmed(false); onOrganize(true, kindTab);
  };

  /* the ring fills up when the screen opens (a small reward for looking at your progress) */
  const [shown, setShown] = useState(0);
  useEffect(() => { const id = requestAnimationFrame(() => setShown(pct)); return () => cancelAnimationFrame(id); }, [pct]);

  return (
    <div className="page page-wide home-in home-grid">
      <div className="home-side">
      <section className="hero">
        <p className="hello">{greeting()}</p>
        <h1>جاهز تحل سؤال النهاردة؟</h1>
        <p className="cheer">{heroMessage({ total: questions.length, today: stats.today, goal, streak: stats.streak })}</p>
      </section>

      <section className="card dash">
        <button type="button" className="goal" onClick={onGoal} aria-label="غيّر هدف اليوم">
          <div className="ring">
            <svg viewBox="0 0 84 84" aria-hidden="true">
              <circle className="ring-track" cx="42" cy="42" r={R} fill="none" strokeWidth="8" />
              <circle className="ring-val" cx="42" cy="42" r={R} fill="none" strokeWidth="8" strokeLinecap="round"
                strokeDasharray={C} strokeDashoffset={C * (1 - shown)} />
            </svg>
            <div className="ring-num"><div><b>{stats.today}/{goal}</b><span>النهاردة</span></div></div>
          </div>
          <div className="goal-info">
            <h3>{pct >= 1 ? "خلّصت هدف النهاردة 🎉" : "هدف النهاردة"} <Icon name="pencil" size={13} style={{ opacity: .45, verticalAlign: "middle" }} /></h3>
            <p>{pct >= 1 ? "كمّل لو لسه عندك طاقة" : `فاضل ${left} ${left <= 10 ? "أسئلة" : "سؤال"}`}</p>
            <div className="pills">
              <span className="pill pill-fire"><Icon name="flame" size={14} /> <b>{stats.streak}</b> يوم ورا بعض</span>
              <span className="pill pill-violet"><Icon name="library" size={14} /> <b>{wordCount}</b> كلمة محفوظة</span>
            </div>
          </div>
        </button>

        <div className="week" role="img" aria-label={`آخر 7 أيام: ${week.filter((d) => d.count).length} أيام فيها مذاكرة`}>
          {week.map((d) => (
            <div key={d.key} className="wd" data-done={d.count > 0} data-today={d.today}>
              <i>{d.count > 0 ? <Icon name="check" size={14} stroke={3} /> : null}</i>
              <span>{d.today ? "النهاردة" : d.label}</span>
            </div>
          ))}
        </div>

        <div className="level">
          <span className="lv-emoji" aria-hidden="true">{lv.emoji}</span>
          <div className="lv-body">
            <div className="lv-top"><b>مستوى {lv.level} · {lv.name}</b></div>
            <div className="lv-bar"><i style={{ width: `${Math.round(lv.pct * 100)}%` }} /></div>
            <small>{lv.next ? `فاضل ${lv.toNext} ${lv.toNext <= 10 ? "أسئلة" : "سؤال"} للمستوى الجاي: ${lv.next.name} ${lv.next.emoji}` : "وصلت لأعلى مستوى، فخور بيك 🏆"}</small>
          </div>
        </div>
      </section>

      <div className="cta-grid">
        <button onClick={onAdd} className="cta cta-main">
          <span>
            <b>أضف سؤالاً</b>
            <span className="sub">صوّر السؤال أو ارفع أي ملف أو الصق نصه، وسيبها على الذكاء الاصطناعي</span>
          </span>
          <span className="cta-ico"><Icon name="plus" size={28} stroke={3} /></span>
        </button>
        <button onClick={onAddLesson} className="cta cta-lesson">
          <span>
            <b>أضف شرحاً</b>
            <span className="sub">ارفع كتاب أو ملفات أو صور أو الصق نص، ويشرحه لك من الصفر</span>
          </span>
          <span className="cta-ico"><Icon name="bookOpen" size={26} /></span>
        </button>
        <button onClick={onMistakes} className="cta cta-alt cta-mist">
          <span>
            <b>غلطاتي</b>
            <span className="sub">{msum.total ? `${msum.open} محتاجة مراجعة · ${msum.done} متقنة${msum.weakest && msum.open ? ` · الأضعف: ${msum.weakest.name}` : ""}` : "أي سؤال تغلط فيه بيتحفظ هنا مترتّب حسب الموضوع"}</span>
          </span>
          <span className="cta-ico"><Icon name="bookX" size={26} /></span>
        </button>
        <button onClick={onWords} className="cta cta-alt">
          <span>
            <b>قاموس الكلمات</b>
            <span className="sub">{wordCount ? `${veryN} مهمة جدا · ${wordCount - veryN} مهمة` : "الكلمات اللي تصنّفها ⭐ أو ✓ بتتحفظ هنا"}</span>
          </span>
          <span className="cta-ico"><Icon name="bookOpen" size={26} /></span>
        </button>
      </div>

      {wod && (
        <section className="wod">
          <div className="wod-head">
            <h2>كلمة النهاردة ✨</h2>
            {allLines.length > 1 && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShift((n) => n + 1)}>
                <Icon name="refresh" size={15} /> كلمة تانية
              </button>
            )}
          </div>
          <WordCard line={wod} />
        </section>
      )}

      </div>

      <div className="home-main">
      <h2 className="h-sec">أسئلتك وشروحاتك المحفوظة <span>{sorted.length}</span></h2>

      <div className="kindtabs" role="tablist" aria-label="القسم">
        <button type="button" role="tab" aria-selected={!isLessons} data-on={!isLessons} data-k="question" onClick={() => pickKind("question")}>
          <Icon name="fileText" size={19} /> <b>الأسئلة</b> <small>{nQ}</small>
        </button>
        <button type="button" role="tab" aria-selected={isLessons} data-on={isLessons} data-k="lesson" onClick={() => pickKind("lesson")}>
          <Icon name="bookOpen" size={19} /> <b>الشروحات</b> <small>{nL}</small>
        </button>
      </div>

      {kindItems.length > 0 && (
        <div className="tabsbar">
          <div className="seg tabs" role="tablist" aria-label="طريقة العرض">
            <button type="button" role="tab" aria-selected={mode === "topics"} data-on={mode === "topics"} onClick={() => pickView("topics")}><Icon name="layers" size={16} /> حسب الموضوع {topicList.length > 0 && <small>{topicList.length}</small>}</button>
            <button type="button" role="tab" aria-selected={mode === "all"} data-on={mode === "all"} onClick={() => pickView("all")}><Icon name="list" size={16} /> الكل <small>{kindItems.length}</small></button>
          </div>
          <div className="org-row">
            <button type="button" className="btn btn-ghost btn-sm org-btn" onClick={organizeClick} disabled={org.busy} data-armed={armed}>
              <Icon name="sparkles" size={15} />
              {org.busy ? `بينظّم… ${org.done}/${org.total}` : waiting.length ? `نظّم الجديد (${waiting.length}) بالـ AI` : armed ? "تأكيد؟ هيعيد ترتيب كل المواضيع" : "أعد ترتيب الكل"}
            </button>
            <button type="button" className="org-auto" data-on={topics.auto} onClick={() => onAuto(!topics.auto)} aria-pressed={topics.auto} title="لما تحفظ سؤال جديد، الـ AI يحطه في موضوعه لوحده">
              <i /> تنظيم تلقائي
            </button>
          </div>
          {org.err && <p className="org-err" role="alert">{org.err}</p>}
        </div>
      )}

      {kindItems.length === 0 ? (
        isLessons ? (
          <div className="card empty">
            <span className="empty-ico"><Icon name="bookOpen" size={34} /></span>
            <b>لسه مفيش شروحات محفوظة</b>
            <p>ارفع كتاب أو ملفات أو صور أو الصق نص، وهيتشرح لك من الصفر ويتحفظ هنا، مرتّب في مواضيع.</p>
            <button onClick={onAddLesson} className="btn btn-teal" style={{ marginTop: 8 }}>أضف أول شرح</button>
          </div>
        ) : (
          <div className="card empty">
            <span className="empty-ico"><Icon name="heartPulse" size={34} /></span>
            <b>لسه مفيش أسئلة محفوظة</b>
            <p>ارفع أول سؤال وشوف التفصيص بنفسك. كل سؤال بتفهمه بيقرّبك من الرخصة 💙</p>
            <button onClick={onAdd} className="btn btn-teal" style={{ marginTop: 8 }}>أضف أول سؤال</button>
          </div>
        )
      ) : mode === "topics" ? (
        <>
          {topicList.length === 0 && (
            <div className="card empty topic-empty">
              <span className="empty-ico"><Icon name="layers" size={32} /></span>
              <b>{org.busy ? (isLessons ? "بنرتّب شروحاتك على حسب الموضوع…" : "بنرتّب أسئلتك على حسب الموضوع…") : "لسه ما اتنظّمتش المواضيع"}</b>
              <p>{isLessons ? "الـ AI بيجمّع الشروحات والملفات اللي عن نفس الموضوع في مكان واحد، علشان تتنقل بينها بسهولة." : "الـ AI بيجمّع الأسئلة اللي عن نفس الموضوع في مكان واحد، علشان تتنقل بينها بسهولة."}</p>
              {!org.busy && <button onClick={() => onOrganize(false, kindTab)} className="btn btn-teal" style={{ marginTop: 8 }}><Icon name="sparkles" size={18} /> {isLessons ? "نظّم شروحاتي" : "نظّم أسئلتي"}</button>}
            </div>
          )}
          {topicList.length > 0 && (
            <div className="tlist">
              {topicList.map((t) => {
                const its = t.qids.map((id) => byId.get(id)).filter(Boolean);
                const thumbs = its.filter((q) => q.thumb).slice(0, 3);
                return (
                  <button key={t.id} type="button" className="card tcard" onClick={() => onOpenTopic(t.id)}>
                    <span className="tc-emoji" aria-hidden="true">{t.emoji || "📘"}</span>
                    <span className="tc-body">
                      <h3 dir="auto">{t.name}</h3>
                      {t.summary && <span className="tc-sum" dir="auto">{t.summary}</span>}
                      <span className="qfoot">
                        {isLessons
                          ? <span className="pill pill-lesson" style={{ padding: "1px 10px" }}>{its.length} {its.length > 10 ? "شرح" : "شروحات"} 📖</span>
                          : <span className="pill" style={{ padding: "1px 10px" }}>{its.length} {its.length > 10 ? "سؤال" : "أسئلة"}</span>}
                        <span>{fmtDate(t.updatedAt)}</span>
                      </span>
                    </span>
                    {thumbs.length > 0 && <span className="tc-thumbs" aria-hidden="true">{thumbs.map((q) => <img key={q.id} src={q.thumb} alt="" loading="lazy" />)}</span>}
                    <span className="qgo"><Icon name="back" size={18} /></span>
                  </button>
                );
              })}
            </div>
          )}
          {loose.length > 0 && (
            <>
              <h3 className="h-sub">بدون موضوع <span>{loose.length}</span></h3>
              <div className="qlist">{loose.map((q) => <QCard key={q.id} q={q} onOpen={onOpen} />)}</div>
            </>
          )}
        </>
      ) : (
        <div className="qlist">
          {kindItems.map((q) => <QCard key={q.id} q={q} onOpen={onOpen} topic={topicOf(topics, q.id)} />)}
        </div>
      )}
      </div>
    </div>
  );
}
