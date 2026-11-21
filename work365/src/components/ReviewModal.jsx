import React, { useState, useMemo } from "react";
import Icon from "./Icon.jsx";
import { SpeakBtn } from "./rich.jsx";
import { parseWord } from "../lib/parse.js";
import { reviewWord, dueWords, useVocab } from "../lib/vocab.js";
import FontSizer from "./FontSizer.jsx";
import { useTextScale, scaleStyle } from "../lib/textscale.js";

/* flashcards of the words you saved: see the word, try to recall, reveal, say "عرفتها" or "لسه". Costs no Gemini request. */
export default function ReviewModal({ onClose }) {
  const { map } = useVocab();
  const [ts] = useTextScale("words:review");
  const deck = useMemo(() => dueWords(map).slice(0, 30), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [i, setI] = useState(0);
  const [show, setShow] = useState(false);
  const [got, setGot] = useState(0);
  const cur = deck[i];
  const { meaning, note } = cur ? parseWord(cur.line) : {};
  const answer = (ok) => { reviewWord(cur.term, ok); if (ok) setGot((n) => n + 1); setShow(false); setI((n) => n + 1); };
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="card modal review ts-box" style={scaleStyle(ts)} role="dialog" aria-modal="true" aria-label="مراجعة الكلمات" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h2>مراجعة الكلمات</h2><FontSizer id="words:review" label="حجم خط المراجعة" /><button type="button" className="iconbtn" onClick={onClose} aria-label="إغلاق"><Icon name="x" size={18} /></button></div>
        {!deck.length ? (
          <p className="review-done">مفيش كلمات مستحقة للمراجعة دلوقتي 🎉 ارجع بعدين، أو صنّف كلمات جديدة.</p>
        ) : !cur ? (
          <p className="review-done">خلصت المراجعة ✅ عرفت {got} من {deck.length}. اللي مش عارفها هترجعلك قريب.</p>
        ) : (
          <>
            <small className="review-count">{i + 1} / {deck.length} · {cur.level === 2 ? "⭐ مهمة جدا" : "✓ مهمة"}</small>
            <div className="review-word" dir="ltr"><bdi>{cur.term}</bdi><SpeakBtn text={cur.term} /></div>
            {show ? (
              <div className="review-ans" dir="auto">
                <p>{meaning}</p>{note && <small>{note}</small>}
                <div className="review-btns">
                  <button type="button" className="btn btn-ghost" onClick={() => answer(false)}>لسه</button>
                  <button type="button" className="btn btn-teal" onClick={() => answer(true)}>عرفتها ✓</button>
                </div>
              </div>
            ) : (
              <button type="button" className="btn btn-teal btn-go" onClick={() => setShow(true)}>أظهر المعنى</button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
