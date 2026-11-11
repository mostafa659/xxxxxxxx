import React, { useState, useMemo } from "react";
import Icon from "../components/Icon.jsx";
import { ConfirmButton } from "../components/ui.jsx";
import { WordCard } from "../components/rich.jsx";
import { wordLines, parseWord } from "../lib/parse.js";
import { useVocab, listLevel, vocabKey, dueWords } from "../lib/vocab.js";
import ReviewModal from "../components/ReviewModal.jsx";
import FontSizer, { ScaledBox } from "../components/FontSizer.jsx";

/* The dictionary holds ONLY the words you classified:
     ⭐ مهمة جدا window · ✓ مهمة window.
   Words saved by older versions (before classification existed) wait in a third window until you classify or clear them. */
export default function WordsScreen({ words, onOpen, onClearLegacy, onDeleteWord }) {
  const { map } = useVocab();
  const [tab, setTab] = useState("2");
  const [q, setQ] = useState("");
  const [copied, setCopied] = useState(false);
  const [review, setReview] = useState(false);
  const due = dueWords(map).length;
  const needle = q.trim().toLowerCase();

  const very = useMemo(() => listLevel(map, 2), [map]);
  const imp = useMemo(() => listLevel(map, 1), [map]);
  const legacy = useMemo(() => {
    const seen = new Set();
    const out = [];
    [...words].sort((a, b) => b.updatedAt - a.updatedAt).forEach((w) => wordLines(w.text).forEach((line) => {
      const k = vocabKey(parseWord(line).term);
      if (!k || seen.has(k) || map[k]) return;     // already classified (any level, including "not important")
      seen.add(k);
      out.push({ key: k, term: parseWord(line).term, line, qid: w.qid, title: w.title });
    }));
    return out.sort((a, b) => a.term.localeCompare(b.term));
  }, [words, map]);

  const active = tab === "2" ? very : tab === "1" ? imp : legacy;
  const list = active.filter((e) => !needle || e.line.toLowerCase().includes(needle));

  const copyAll = async () => {
    try { await navigator.clipboard.writeText(list.map((e) => e.line).join("\n")); setCopied(true); setTimeout(() => setCopied(false), 1400); }
    catch (e) { /* clipboard unavailable */ }
  };

  const empty = tab === "2"
    ? ["مفيش كلمات «مهمة جدا» لسه", "دوس ⭐ تحت أي كلمة في أي سؤال، أو دوس مرتين على أي كلمة إنجليزي وصنّفها."]
    : tab === "1"
      ? ["مفيش كلمات «مهمة» لسه", "دوس ✓ تحت أي كلمة تعوز تحفظها. الكلمات اللي مش مصنّفة ما بتتحفظش في القاموس."]
      : ["مفيش كلمات قديمة غير مصنّفة", ""];

  return (
    <div className="page page-wide sec-violet">
      <div className="page-head">
        <h1>قاموس الكلمات</h1>
        <FontSizer id="words:dict" label="حجم خط القاموس" />
        <button onClick={() => setReview(true)} className="btn btn-teal btn-sm" disabled={!very.length && !imp.length}>
          <Icon name="refresh" size={16} /> راجع {due ? `(${due})` : ""}
        </button>
        <button onClick={copyAll} className="btn btn-ghost btn-sm" disabled={!list.length}>
          <Icon name={copied ? "check" : "copy"} size={16} /> نسخ {tab === "2" ? "المهمة جدا" : tab === "1" ? "المهمة" : "الكل"}
        </button>
      </div>

      <div className="dict-tabs" role="tablist" aria-label="نوافذ القاموس" style={legacy.length ? { gridTemplateColumns: "1fr 1fr 1fr" } : undefined}>
        <button type="button" role="tab" aria-selected={tab === "2"} className="dict-tab" data-l="2" data-on={tab === "2"} onClick={() => setTab("2")}>
          <b>{very.length}</b><small>⭐ مهمة جدا</small>
        </button>
        <button type="button" role="tab" aria-selected={tab === "1"} className="dict-tab" data-l="1" data-on={tab === "1"} onClick={() => setTab("1")}>
          <b>{imp.length}</b><small>✓ مهمة</small>
        </button>
        {legacy.length > 0 && (
          <button type="button" role="tab" aria-selected={tab === "0"} className="dict-tab" data-l="0" data-on={tab === "0"} onClick={() => setTab("0")}>
            <b>{legacy.length}</b><small>قديمة غير مصنّفة</small>
          </button>
        )}
      </div>

      <div className="search">
        <Icon name="search" size={18} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="دوّر على كلمة…" className="input" dir="auto" />
      </div>

      {tab === "0" && legacy.length > 0 && (
        <div className="qdetail-actions" style={{ marginTop: 12 }}>
          <p className="words-count" style={{ flex: 1 }}>كلمات اتحفظت قبل ما التصنيف يتضاف. صنّف اللي يهمك، وامسح الباقي.</p>
          <ConfirmButton label="امسح القديمة" confirmLabel="تأكيد المسح؟" onConfirm={onClearLegacy} />
        </div>
      )}

      {list.length === 0 ? (
        <div className="card empty" style={{ marginTop: 14 }}>
          <span className="empty-ico"><Icon name="library" size={32} /></span>
          <b>{needle ? "مفيش نتائج." : empty[0]}</b>
          {!needle && empty[1] && <p>{empty[1]}</p>}
        </div>
      ) : (
        <ScaledBox id="words:dict" className="wlist" style={{ marginTop: 14 }}>
          {list.map((e, i) => (
            <div key={e.key || e.term}>
              <WordCard onDelete={() => onDeleteWord(e.term)} line={e.line} src={{ qid: e.qid, title: e.title }} ahead={list.slice(i + 1, i + 2).map((y) => y.term).join("\n")} />
              {e.qid && <button type="button" className="dict-src" onClick={() => onOpen(e.qid)} dir="auto">من: {e.title || "السؤال"}</button>}
            </div>
          ))}
        </ScaledBox>
      )}
    {review && <ReviewModal onClose={() => setReview(false)} />}
    </div>
  );
}
