import React, { memo, useMemo, useEffect, useState } from "react";
import Icon from "./Icon.jsx";
import { hasArabic, wordLines, parseWord } from "../lib/parse.js";
import { speak, warm, cycleSpeed, useSpeechState, useSpeed } from "../lib/speech.js";
import { fixText } from "../lib/text.js";
import { layout, dirFor } from "../lib/emphasis.js";
import { useLinks, findLinked, titleOf } from "../lib/linkctx.js";
import { useVocab, setLevel, removeWord, vocabKey } from "../lib/vocab.js";

/* ───────── pronunciation button (American male voice, see lib/speech.js) ───────── */

export function SpeakBtn({ text, label = "اسمع النطق", ahead }) {
  const st = useSpeechState(text);
  const sp = useSpeed();
  return (
    <span className="speak-wrap">
      <button type="button" className="speak" data-s={st} aria-pressed={st === "play"}
        aria-label={st === "idle" ? label : "إيقاف الصوت"}
        onClick={() => speak(text)}>   {/* one request per tap, never "ahead": nothing is fetched for words you do not play */}
        <Icon name="volume" size={18} />
      </button>
      {/* small speed control right under the speaker: 0.5× → 0.75× → 1× → 1.25× (applies to every speaker) */}
      <button type="button" className="speed" aria-label={`سرعة الصوت ${sp} مرة. دوس لتغييرها`} onClick={cycleSpeed}>
        <Icon name="gauge" size={11} /><span>{sp}×</span>
      </button>
    </span>
  );
}

/* ───────── inline: **bold** + Latin runs isolated as LTR so Arabic/English mix correctly ───────── */

/* ───────── strip LaTeX / markup leftovers the model sometimes emits ($K^+$, \\rightarrow …) ───────── */
const SUP = { "0":"⁰","1":"¹","2":"²","3":"³","4":"⁴","5":"⁵","6":"⁶","7":"⁷","8":"⁸","9":"⁹","+":"⁺","-":"⁻","−":"⁻","n":"ⁿ" };
const SUB = { "0":"₀","1":"₁","2":"₂","3":"₃","4":"₄","5":"₅","6":"₆","7":"₇","8":"₈","9":"₉","+":"₊","-":"₋" };
const mapChars = (s, tbl) => { let o = ""; for (const c of s) { if (!(c in tbl)) return null; o += tbl[c]; } return o; };
const ARROWS = { rightarrow: "→", to: "→", leftarrow: "←", uparrow: "↑", downarrow: "↓", geq: "≥", ge: "≥", leq: "≤", le: "≤", approx: "≈", times: "×", pm: "±", neq: "≠", degree: "°" };

export function cleanMath(s) {
  if (!s || !/[$\\^_`]/.test(s)) return s;
  return s
    .replace(/\$\$?([^$\n]{1,80}?)\$\$?/g, "$1")
    .replace(/\\(?:text|mathrm|mathbf|textbf|mathit)\{([^}]*)\}/g, "$1")
    .replace(/\\([A-Za-z]+)/g, (m, w) => ARROWS[w.toLowerCase()] || "")
    .replace(/\\([%&#_$])/g, "$1")
    .replace(/\^\{?([0-9+\-−n]{1,4})\}?/g, (m, g) => mapChars(g, SUP) ?? m)
    .replace(/([A-Za-z\)])_\{?([0-9+\-]{1,3})\}?/g, (m, a, g) => a + (mapChars(g, SUB) ?? "_" + g))
    .replace(/[`$]/g, "");
}

/* a piece of text with its emphasis: **bold** (key term). The ==link== chips are handled by <LinkChip> below. */
const Piece = ({ part }) => {
  let n = part.text;
  if (part.bold) n = <strong className="kw">{n}</strong>;
  return n;
};

const Nodes = ({ nodes }) => nodes.map((nd, i) => nd.run
  ? <bdi key={i} dir="ltr" className="en">{nd.parts.map((p, k) => <Piece key={k} part={p} />)}</bdi>
  : <React.Fragment key={i}>{nd.parts.map((p, k) => <Piece key={k} part={p} />)}</React.Fragment>);

/* the small yellow chip "🔗 مرتبط بسؤال «…»": one element per clause. When the earlier question exists it is a button:
   open it, highlight the matching part for 20 s, and offer a way back (App.jsx openLinked). */
function LinkChip({ seg }) {
  const L = useLinks();
  const ref = React.useRef(null);
  const q = L ? findLinked(L.questions, seg, L.selfId) : null;
  const clean = String(seg).replace(/^\s*🔗\s*/u, "").replace(/==/g, "").trim();
  const nodes = layout(cleanMath(fixText(clean)));
  const act = (e) => {
    e.preventDefault(); e.stopPropagation();
    if (!q || !L) return;
    const el = ref.current;
    const block = el && (el.closest(".li, .num, .tip, .trans, .quote") || el.closest("p, h4"));
    const mine = el ? el.textContent : "";
    const around = block ? (block.textContent || "").replace(mine, " ") : "";
    L.open(q, `${around} ${titleOf(seg)}`.replace(/\s+/g, " ").trim());
  };
  return (
    <mark ref={ref} className="link-chip" data-live={q ? "1" : undefined}
      {...(q ? { role: "button", tabIndex: 0, title: `افتح السؤال المرتبط: ${q.title}`, onClick: act, onKeyDown: (e) => { if (e.key === "Enter" || e.key === " ") act(e); } } : {})}>
      <span className="link-chip-ico" aria-hidden="true"><Icon name="link" size={11} stroke={2.4} /></span>
      <Nodes nodes={nodes} />
    </mark>
  );
}

export function Inline({ text }) {
  let src = cleanMath(fixText(text || ""));
  if ((src.match(/==/g) || []).length % 2) src = src.replace(/==(?![\s\S]*==)/, "");   // an unmatched marker is noise
  if (!src.includes("==")) return <Nodes nodes={layout(src)} />;
  return (
    <>
      {src.split("==").map((seg, i) => {
        if (!seg) return null;
        return i % 2 ? <LinkChip key={i} seg={seg} /> : <Nodes key={i} nodes={layout(seg)} />;
      })}
    </>
  );
}

/* a short mixed Arabic/English text (a topic summary, a weak-point name) with the same English isolation and punctuation handling as the lessons */
export function Mixed({ text, as: Tag = "span", className }) {
  const t = fixText(text || "");
  return <Tag dir={dirFor(t)} className={className ? `mixed ${className}` : "mixed"}><Inline text={t} /></Tag>;
}

/* ───────── rich text (explanation + tricks) ───────── */

const dirOf = dirFor;

function parseBlocks(text) {
  const out = [];
  fixText(text || "").split("\n").map((l) => l.trim()).filter(Boolean).forEach((l) => {
    let m;
    if ((m = l.match(/^#{1,3}\s+(.*)$/))) out.push({ t: "h", s: m[1] });
    else if ((m = l.match(/^[-•*]\s+(.*)$/))) {
      const ok = /✅/.test(m[1]), no = /❌/.test(m[1]);
      out.push({ t: "li", s: m[1], v: ok && !no ? "ok" : no && !ok ? "no" : null });
    }
    else if ((m = l.match(/^(\d{1,2})[.)]\s+(.*)$/))) out.push({ t: "num", n: m[1], s: m[2] });
    else if ((m = l.match(/^>\s?(.*)$/))) out.push({ t: "quote", s: m[1] });
    else if (/^💡/.test(l)) out.push({ t: "tip", s: l });
    else if (out.length && out[out.length - 1].t === "quote" && hasArabic(l)) out.push({ t: "trans", s: l });
    else out.push({ t: "p", s: l });
  });
  return out;
}

/* a bullet written as  Term — meaning — meaning  is shown as a short title line + one line per part (easier to scan, no long mixed Arabic/English line) */
function splitLi(s) {
  const segs = String(s || "").split(/\s[—–]\s/).map((x) => x.trim()).filter(Boolean);
  if (segs.length < 2 || segs[0].length > 80) return null;
  return { head: segs[0], rest: segs.slice(1) };
}

function Block({ b }) {
  switch (b.t) {
    case "h":
      return <h4><i /><span><Inline text={b.s} /></span></h4>;
    case "li": {
      const sp = splitLi(b.s);
      if (!sp) return <div className="li" dir={dirOf(b.s)} data-v={b.v || undefined}><em /><p><Inline text={b.s} /></p></div>;
      /* "Term — meaning — Arabic gloss" → the term on its own line, every part after it on its own calmer line */
      return (
        <div className="li" dir={dirOf(b.s)} data-v={b.v || undefined}><em />
          <div className="li-body">
            <p className="li-head" dir={dirOf(sp.head)}><Inline text={sp.head} /></p>
            {sp.rest.map((r, i) => <p key={i} className="li-sub" dir={dirOf(r)}><Inline text={r} /></p>)}
          </div>
        </div>
      );
    }
    case "num":
      return <div className="num" dir={dirOf(b.s)}><b>{b.n}</b><p><Inline text={b.s} /></p></div>;
    case "quote":
      return <div className="quote"><span><Inline text={b.s} /></span><SpeakBtn text={b.s} label="اسمع الجملة" /></div>;
    case "tip":
      return <p className="tip" dir={dirOf(b.s)}><Inline text={b.s} /></p>;
    case "trans":
      return <p className="trans"><Inline text={b.s} /></p>;
    default:
      return <p dir={dirOf(b.s)}><Inline text={b.s} /></p>;
  }
}
const BlockMemo = memo(Block, (a, b) => a.b.t === b.b.t && a.b.s === b.b.s && a.b.v === b.b.v && a.b.n === b.b.n);

export const RichText = memo(function RichText({ text }) {
  const blocks = useMemo(() => parseBlocks(text), [text]);
  const dir = hasArabic(text) ? "rtl" : "ltr";
  return (
    <div dir={dir} className="rt">
      {blocks.map((b, i) => <BlockMemo key={i} b={b} />)}
    </div>
  );
});

/* ───────── the question itself (always LTR English) ───────── */

export const QuestionView = memo(function QuestionView({ text }) {
  const lines = useMemo(() => fixText(text || "").split("\n").map((l) => l.trim()).filter(Boolean), [text]);
  return (
    <div dir="ltr" className="qv">
      {lines.map((l, i) => {
        const m = i > 0 ? l.match(/^\(?([A-H])[).]\s*(.+)$/) : null;
        if (m) return <div key={i} className="opt"><b>{m[1]}</b><p>{m[2]}</p></div>;
        return <p key={i} className="stem" style={i === 0 ? { fontWeight: 600 } : undefined}>{l}</p>;
      })}
    </div>
  );
});

/* ───────── vocabulary ───────── */

/* classify a word: ⭐ very important · ✓ important (both are saved in the dictionary) · ✕ not important (never saved, card is dimmed) */
export function ClassifyBar({ term, line, src, level }) {
  const { map } = useVocab();
  const lv = level !== undefined ? level : (map[vocabKey(term)] || {}).level || 0;
  const btn = (l, icon, label, tip) => (
    <button type="button" className="cls" data-l={l} data-on={lv === l} aria-pressed={lv === l} title={tip}
      onClick={() => setLevel(term, line, l, src)}>
      <Icon name={icon} size={14} stroke={2.4} fill={icon === "star" && lv === l ? "currentColor" : "none"} /> <span>{label}</span>
    </button>
  );
  return (
    <div className="cls-bar" role="group" aria-label="تصنيف الكلمة">
      {btn(2, "star", "مهمة جدا", "مهمة جدا: تتحفظ في القاموس (نافذة المهمة جدا)")}
      {btn(1, "check", "مهمة", "مهمة: تتحفظ في القاموس (نافذة المهمة)")}
      {btn(-1, "x", "مش مهمة", "مش مهمة: ما تتحفظش في القاموس")}
    </div>
  );
}

/* two-tap delete: first tap asks, second tap deletes (the word also leaves the dictionary) */
function DelBtn({ onDelete }) {
  const [ask, setAsk] = useState(false);
  useEffect(() => { if (!ask) return undefined; const t = setTimeout(() => setAsk(false), 3000); return () => clearTimeout(t); }, [ask]);
  return (
    <button type="button" className="word-del" data-ask={ask} aria-label={ask ? "تأكيد حذف الكلمة" : "حذف الكلمة"} title="حذف الكلمة"
      onClick={() => { if (ask) onDelete(); else setAsk(true); }}>
      <Icon name="trash" size={15} /> {ask && <span>تأكيد الحذف؟</span>}
    </button>
  );
}

export const WordCard = memo(function WordCard({ line, ahead, src, noClassify, onDelete }) {
  const { term, meaning, note } = parseWord(line);
  const { map } = useVocab();
  const lv = (map[vocabKey(term)] || {}).level || 0;
  const dir = hasArabic(meaning + note) ? "rtl" : "ltr";
  return (
    <div dir={dir} className="word" data-lv={lv}>
      <div className="word-top">
        <bdi dir="ltr" className="word-term">{cleanMath(term)}</bdi>
        <SpeakBtn text={cleanMath(term)} ahead={ahead} />
        {onDelete && <DelBtn onDelete={onDelete} />}
      </div>
      {meaning && <p className="word-mean"><Inline text={meaning} /></p>}
      {note && <p className="word-note"><Inline text={note} /></p>}
      {!noClassify && <ClassifyBar term={cleanMath(term)} line={line} src={src} level={lv} />}
    </div>
  );
});

const termOf = (l) => cleanMath(parseWord(l).term);

export function WordList({ text, showCount = true, warm = false, src, onRemove }) {
  const lines = useMemo(() => wordLines(text), [text]);
  const { map } = useVocab();
  const [f, setF] = useState("all");   // all | new | 2 | 1 | -1
  const lvOf = (l) => (map[vocabKey(parseWord(l).term)] || {}).level || 0;
  const counts = { 2: 0, 1: 0, "-1": 0, new: 0 };
  lines.forEach((l) => { const v = lvOf(l); if (v) counts[v] += 1; else counts.new += 1; });
  const shown = lines.filter((l) => f === "all" || (f === "new" ? !lvOf(l) : lvOf(l) === +f));
  /* the shown words are loaded quietly in the background (free Google US voice, 2 at a time, remembered on the device), so a tap on a speaker is instant.
     With the male Gemini voice nothing is fetched ahead (it has a daily quota): see warm() in lib/speech.js */
  const warmKey = shown.map((l) => parseWord(l).term).join("\u0001");
  useEffect(() => {
    const id = setTimeout(() => warm(warmKey.split("\u0001")), 400);
    return () => clearTimeout(id);
  }, [warmKey]);
  return (
    <div>
      {showCount && lines.length > 0 && (
        <div className="words-filter" role="tablist" aria-label="فلتر الكلمات">
          {[["all", `الكل ${lines.length}`], ["new", `لسه ${counts.new}`], ["2", `⭐ ${counts[2]}`], ["1", `✓ ${counts[1]}`], ["-1", `✕ ${counts["-1"]}`]].map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={f === k} data-on={f === k} onClick={() => setF(k)}>{label}</button>
          ))}
        </div>
      )}
      <div className="words">
        {shown.map((l, i) => <WordCard key={l} line={l} src={src} onDelete={onRemove ? () => { removeWord(parseWord(l).term); onRemove(l); } : undefined} ahead={shown.slice(i + 1, i + 2).map(termOf).join("\n")} />)}
      </div>
      {showCount && lines.length > 0 && shown.length === 0 && <p className="words-count">مفيش كلمات في الفلتر ده.</p>}
    </div>
  );
}
