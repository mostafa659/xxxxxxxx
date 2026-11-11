import { syncUsageKey } from "./lib/usage.js";
import React, { useState, useEffect, useRef, useCallback } from "react";
import Icon from "./components/Icon.jsx";
import BackupModal from "./components/BackupModal.jsx";
import { Brand, Toast, KeyModal, Confetti } from "./components/ui.jsx";
import Home from "./screens/Home.jsx";
import WordsScreen from "./screens/WordsScreen.jsx";
import Editor from "./screens/Editor.jsx";
import WordPop from "./components/WordPop.jsx";
import TopicScreen from "./screens/TopicScreen.jsx";
import ChatPanel from "./components/ChatPanel.jsx";
import ImageGallery from "./components/ImageGallery.jsx";
import MistakesScreen from "./screens/MistakesScreen.jsx";
import { useMistakes, openCount, loadMistakes } from "./lib/mistakes.js";
import { useBank } from "./lib/imagebank.js";
import MoveModal from "./components/MoveModal.jsx";
import { removeWord, vocabKey } from "./lib/vocab.js";
import { applyOps, assignedSet, dropItem, moveItem, navFor, organize, renameTopic, dropTopic, splitByKind, kindOf } from "./lib/topics.js";
import { removeAllConvs } from "./lib/chathist.js";
import { store, prefs } from "./lib/storage.js";
import { ENV_KEY, warmUp, warmConnection, currentApiKey } from "./lib/gemini.js";
import * as Ring from "./lib/keyring.js";
import { GATEWAY_URL } from "./lib/config.js";
import { resizeDataUrl } from "./lib/image.js";
import { wordLines, parseWord, studyStats } from "./lib/parse.js";
import { saveCheer } from "./lib/motivation.js";
import { learn } from "./lib/progress.js";
import { setSpeechKey, stopSpeaking } from "./lib/speech.js";
import { setTranslateKey } from "./lib/wordtr.js";
import { GOALS } from "./lib/config.js";
import { hideSplash } from "./lib/splash.js";
import { LinkCtx, LINK_HL_MS } from "./lib/linkctx.js";
import { clearFlash } from "./lib/highlight.js";

const AI_CTX = { kind: "global", question: "", explanation: "" };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* a compact digest of the saved questions: the model links the new question to them, inside the sentence it belongs to */
const historyFor = (questions, currentId) => (questions || [])
  .filter((q) => q && q.id !== currentId && q.title)
  .slice(0, 120)
  .map((q) => ({
    title: String(q.title).replace(/[«»=*\n]/g, " ").replace(/\s+/g, " ").trim().slice(0, 70),
    terms: wordLines(q.new_words || "").slice(0, 8).map((l) => parseWord(l).term.replace(/[*=«»]/g, "").trim()).filter(Boolean),
  }))
  .filter((h) => h.title);
const lessonTitle = (text) => {
  const line = String(text || "").split("\n").map((l) => l.replace(/^[#>\-*\s]+/, "").replace(/\*\*/g, "").trim())
    .find((l) => l && !/^(📖|🗂|⏱|المادة بتتكلم|أهم الأجزاء|نوع المادة|What is this|Main parts|Type of)/u.test(l));
  return line ? (line.length > 60 ? line.slice(0, 58) + "…" : line) : "شرح جديد";
};
const titleFrom = (text) => {
  const first = (text || "").split("\n").map((l) => l.trim()).find(Boolean) || "";
  if (!first) return "سؤال بدون عنوان";
  return first.length > 56 ? first.slice(0, 54).trimEnd() + "…" : first;
};

/* Signature. Fixed in the bottom-left corner, never takes a click, never moves or resizes anything (pointer-events:none, out of the layout flow). */
function Credit() {
  return (
    <div className="credit" role="note" aria-label="BY / MOSTAFA HAMMAD WITH AI" dir="ltr">
      <span className="credit-dim">BY /</span>
      <b>MOSTAFA HAMMAD</b>
      <span className="credit-dim">WITH AI</span>
    </div>
  );
}

export default function App({ boot }) {
  const [questions, setQuestions] = useState(boot.questions);
  const [words, setWords] = useState(boot.words);
  const [view, setView] = useState({ name: "home" });
  const [toast, setToast] = useState("");
  /* v3.32: behind the gateway the app's "key" is the gateway's access code; an old Google key saved on the device must not be sent there (it would be refused) */
  /* v3.34: the keys live in the key ring (any number, any company); the app's "apiKey" is the first Google key of the ring (the old single key becomes its first entry) */
  const [apiKey, setApiKey] = useState(() => (GATEWAY_URL ? ENV_KEY : currentApiKey(boot.apiKey)));
  const [goal, setGoal] = useState(boot.goal);
  const [perf, setPerf] = useState(boot.perf);
  /* v3.25: questions and explanations have their own topics. Topics saved by an older version are sorted by kind once (a mixed topic is split in two). */
  const [topics, setTopics] = useState(() => {
    const t = splitByKind(boot.topics, boot.questions);
    if (t !== boot.topics) store.set("clinix:topics", t);
    return t;
  });
  const [org, setOrg] = useState({ busy: false, done: 0, total: 0, err: "" });
  const [aiOpen, setAiOpen] = useState(false);
  const [aiEver, setAiEver] = useState(false);
  const [aiCmd, setAiCmd] = useState(null);
  const [moveFor, setMoveFor] = useState(null);
  const [showKey, setShowKey] = useState(false);
  const [burst, setBurst] = useState(0);
  const burstTimer = useRef(null);
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || "light");
  const toastTimer = useRef(null);
  const perfRef = useRef(perf);
  perfRef.current = perf;
  /* always-current copies of the lists: auto-save can fire twice before React re-renders, and must never see a stale list */
  const qRef = useRef(questions);
  const wRef = useRef(words);
  qRef.current = questions;
  wRef.current = words;
  const tRef = useRef(topics);
  tRef.current = topics;
  const [showBackup, setShowBackup] = useState(false);
  const galleryCount = useBank().length;
  const mistakeCount = openCount(useMistakes().list);
  useEffect(() => { loadMistakes(); }, []);
  const keyRef = useRef(apiKey);
  keyRef.current = apiKey;
  const orgCtl = useRef(null);
  const tried = useRef(new Set());     // items the AI already looked at this session (so it never loops)
  const failUntil = useRef(0);

  /* every topic change goes through here: applied to the newest state, then saved */
  const commitTopics = (fn) => {
    const next = fn(tRef.current);
    tRef.current = next;
    setTopics(next);
    store.set("clinix:topics", next);
    return next;
  };
  const validIds = () => new Set(qRef.current.map((q) => q.id));

  /* the AI puts every question / lesson that has no topic yet into one (existing or new) */
  const runOrganize = async (full = false, manual = false, kind = null) => {   // kind: only the questions, or only the explanations (null = both)
    if (orgCtl.current) return;
    if (!keyRef.current) { if (manual) setShowKey(true); return; }
    let st = tRef.current;
    if (full) st = commitTopics((cur) => applyOps(cur, [{ type: "reset", kind }], validIds()));
    const done = assignedSet(st), pin = new Set(st.pinned);
    const todo = qRef.current.filter((q) => (!kind || kindOf(q) === kind) && !done.has(q.id) && !pin.has(q.id) && (manual || !tried.current.has(q.id)));
    if (!todo.length) { if (manual) say(kind === "lesson" ? "كل شروحاتك متنظّمة ✅" : "كل أسئلتك متنظّمة ✅"); return; }
    const ctrl = new AbortController();
    orgCtl.current = ctrl;
    setOrg({ busy: true, done: 0, total: todo.length, err: "" });
    try {
      await organize({
        apiKey: keyRef.current, todo, state: st, signal: ctrl.signal,
        apply: (ops) => commitTopics((cur) => applyOps(cur, ops, validIds())),
        onProgress: (d, t) => setOrg((o) => ({ ...o, done: d, total: t })),
      });
      todo.forEach((q) => tried.current.add(q.id));
      if (manual) say(kind === "lesson" ? "اتنظّمت الشروحات في مواضيع ✅" : kind === "question" ? "اتنظّمت الأسئلة في مواضيع ✅" : "اتنظّم كل حاجة في مواضيع ✅");
      setOrg({ busy: false, done: 0, total: 0, err: "" });
    } catch (e) {
      if (e && e.name === "AbortError") setOrg({ busy: false, done: 0, total: 0, err: "" });
      else { failUntil.current = Date.now() + 120000; setOrg({ busy: false, done: 0, total: 0, err: (e && e.message) || "التنظيم فشل. جرّب تاني." }); }
    } finally { orgCtl.current = null; }
  };
  const runRef = useRef(runOrganize);
  runRef.current = runOrganize;

  /* automatic: a few seconds after the last change, anything without a topic is organised in ONE request */
  useEffect(() => {
    if (!apiKey || !topics.auto || view.name === "edit") return undefined;   // never while a question is open: items pile up and go in ONE request
    const done = assignedSet(topics), pin = new Set(topics.pinned);
    if (!questions.some((q) => !done.has(q.id) && !pin.has(q.id) && !tried.current.has(q.id))) return undefined;
    const t = setTimeout(() => runRef.current(false, false), Math.max(15000, failUntil.current - Date.now()));
    return () => clearTimeout(t);
  }, [questions, topics, apiKey, view.name]);

  /* the launch splash (native icon screen + the cover in index.html) is handed over to the app after the first real paint */
  useEffect(() => { hideSplash(); }, []);

  /* warm the network while the user is still choosing a picture */
  useEffect(() => { syncUsageKey(apiKey); warmUp(apiKey); warmConnection(apiKey); }, [apiKey]);

  /* history-aware navigation so the Android back button works */
  useEffect(() => {
    window.history.replaceState({ v: { name: "home" } }, "");
    const onPop = (e) => setView((e.state && e.state.v) || { name: "home" });
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    prefs.set("clinix:theme", next);
    const m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute("content", next === "dark" ? "#0A1120" : "#F3F7FB");
  };

  const say = (msg, ms = 2800) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), ms);
  };

  const celebrate = () => {
    setBurst(Date.now());
    clearTimeout(burstTimer.current);
    burstTimer.current = setTimeout(() => setBurst(0), 2600);
  };

  /* pronunciation: key for Gemini voice, error toast, and silence when the screen changes */
  const sayRef = useRef(say);
  sayRef.current = say;
  useEffect(() => { setSpeechKey(apiKey); setTranslateKey(apiKey); }, [apiKey]);
  useEffect(() => {
    const h = (e) => sayRef.current(e.detail);
    window.addEventListener("clinix:speech-error", h);
    return () => window.removeEventListener("clinix:speech-error", h);
  }, []);
  useEffect(() => { stopSpeaking(); }, [view]);

  /* a chat answer opened a saved item with a part to highlight: once the editor has shown it, the highlight is dropped from the history entry
     (going back to this screen later does not flash it again) */
  const viewRef = useRef(view);
  viewRef.current = view;
  const consumeHl = useCallback(() => {
    const v = viewRef.current;
    if (v && v.hl) window.history.replaceState({ v: { ...v, hl: null } }, "");
  }, []);

  const go = (v, replace = false) => {
    if (replace) window.history.replaceState({ v }, "");
    else window.history.pushState({ v }, "");
    setView(v);
    window.scrollTo({ top: 0 });
  };
  const back = () => window.history.back();

  /* a key was added / moved / removed in the 🔑 window */
  const onKeysChanged = async () => {
    if (GATEWAY_URL) return;
    const k = currentApiKey("");
    syncUsageKey(k || ENV_KEY);                          // a new first key starts a fresh usage counter
    setApiKey(k);
    await store.set("clinix:apikey", Ring.keysOf("gemini")[0] || "");   // mirrored so an older build (and the next start) sees the same first key; "" when there is none
  };

  const cycleGoal = async () => {
    const next = GOALS[(Math.max(0, GOALS.indexOf(goal)) + 1) % GOALS.length];
    setGoal(next);
    await store.set("clinix:goal", next);
  };

  const onLearn = useCallback((task, modeId, ms, chars) => {
    const next = learn(perfRef.current, task, modeId, ms, chars);
    perfRef.current = next;
    setPerf(next);
    store.set("clinix:perf", next);
  }, []);

  /* Auto-save, called by the editor (it never navigates away).
     `id` is empty only for the very first save of a new question; after that the editor keeps sending the same id,
     so every later save updates that one question instead of creating a copy. */
  const saveQuestion = async ({ id: knownId, kind, title, imageUrl, doc, imageChanged, instructions, chips, result, silent }) => {
    const id = knownId || uid();
    const existing = qRef.current.find((q) => q.id === id) || null;
    const now = Date.now();
    let thumb = existing?.thumb || null;
    if (!existing || imageChanged) {
      if (imageUrl) {
        try { thumb = await resizeDataUrl(imageUrl, 360, 0.6); } catch (e) { /* keep old thumb */ }
        const ok = await store.set(`clinix:img:${id}`, { data: imageUrl, doc: doc || null });
        if (!ok) say("الصورة كبيرة والتخزين ممتلئ، اتحفظ النص بس");
      } else {
        await store.del(`clinix:img:${id}`);
        thumb = null;
      }
    }
    const q = {
      id, kind: kind || "question", title: title.trim() || (kind === "lesson" ? lessonTitle(result.original_question_text) : titleFrom(result.original_question_text)), ...result, instructions, chips,
      thumb, createdAt: existing?.createdAt || now, updatedAt: now,
    };
    const prevQ = qRef.current;
    const nextQ = existing ? prevQ.map((x) => (x.id === id ? q : x)) : [q, ...prevQ];

    /* new words are NOT added to the dictionary any more: the student classifies each one (⭐ / ✓) and only those are saved (lib/vocab.js).
       Words saved by older versions stay in `words` until classified or cleared. */
    const lines = wordLines(result.new_words);
    const nextW = wRef.current;

    /* a new question: tell the person how far they are (goal / streak / level) and celebrate the big moments */
    const statsOf = (qs) => ({ ...studyStats(qs, goal), total: qs.length });
    const cheer = existing || silent ? { confetti: false, msg: "" } : saveCheer(statsOf(prevQ), statsOf(nextQ), goal);

    qRef.current = nextQ; wRef.current = nextW;
    setQuestions(nextQ); setWords(nextW);
    await Promise.all([store.set("clinix:questions", nextQ), store.set("clinix:words", nextW)]);
    if (!existing && !silent) {   // only the first save speaks; later silent updates (edits) don't pop a message each time
      const base = lines.length ? `اتحفظ تلقائي ✅ عندك ${lines.length} كلمة جديدة، صنّف المهم منها ⭐` : "اتحفظ السؤال تلقائي ✅";
      if (cheer.confetti) celebrate();
      say(cheer.msg ? `اتحفظ ✅ ${cheer.msg}` : base, cheer.confetti ? 4200 : 3200);
    }
    return id;
  };

  const deleteQuestion = async (id) => {
    const nextQ = qRef.current.filter((q) => q.id !== id);
    const nextW = wRef.current.filter((w) => w.qid !== id);
    qRef.current = nextQ; wRef.current = nextW;
    setQuestions(nextQ); setWords(nextW);
    commitTopics((cur) => dropItem(cur, id));
    await Promise.all([store.set("clinix:questions", nextQ), store.set("clinix:words", nextW), store.del(`clinix:img:${id}`), removeAllConvs(`clinix:chat:${id}`)]);
    say("اتحذف السؤال");
    back();
  };

  /* delete a word from the dictionary: its classification AND any copy still waiting in the old unclassified list */
  const deleteWord = async (term) => {
    removeWord(term);
    const k = vocabKey(term);
    const nextW = wRef.current
      .map((w) => ({ ...w, text: wordLines(w.text).filter((l) => vocabKey(parseWord(l).term) !== k).join("\n") }))
      .filter((w) => w.text.trim());
    wRef.current = nextW; setWords(nextW);
    await store.set("clinix:words", nextW);
    say("اتحذفت الكلمة");
  };

  const clearLegacyWords = async () => {
    wRef.current = []; setWords([]);
    await store.set("clinix:words", []);
    say("اتمسحت الكلمات القديمة");
  };

  /* a yellow link chip was tapped: open the earlier question (highlight 20 s) and remember where to come back to.
     `fromId` = the question the student is leaving (the Editor knows it even before the URL does). */
  const openLinked = (target, claim, fromId) => {
    const cur = viewRef.current;
    const selfId = fromId || (cur.name === "edit" ? cur.id : null);
    const from = selfId ? qRef.current.find((x) => x.id === selfId) : null;
    const y = window.scrollY;
    if (selfId && cur.name === "edit") window.history.replaceState({ v: { ...cur, id: selfId, hl: null } }, "");   // coming back reopens THIS question (also one that was saved a moment ago)
    go({ name: "edit", id: target.id, hl: { text: claim, nonce: Date.now(), ms: LINK_HL_MS }, ...(selfId ? { ret: { id: selfId, y, title: (from && from.title) || "" } } : {}) });
  };
  /* "عد للسؤال الأصلي": one step back in the history (the original question is the entry before this one), then its scroll position */
  const returnToOrigin = () => {
    const r = viewRef.current && viewRef.current.ret;
    if (!r) return;
    clearFlash();
    window.history.back();
    const fix = () => window.scrollTo({ top: r.y });
    setTimeout(() => {
      const v = viewRef.current;
      if (!(v && v.name === "edit" && v.id === r.id)) go({ name: "edit", id: r.id }, true);   // the history did not land on it → open it directly
      setTimeout(fix, 60);
    }, 260);
    setTimeout(fix, 500);
  };
  const linkCtx = React.useMemo(() => ({ questions, selfId: view.name === "edit" ? view.id || null : null, open: openLinked }), [questions, view]); // eslint-disable-line react-hooks/exhaustive-deps

  const openItem = (id, replace, hl) => go({ name: "edit", id, ...(hl && hl.text ? { hl } : {}) }, !!replace);
  const openAI = (cmd) => {
    setAiEver(true); setAiOpen(true);
    if (cmd) setAiCmd({ ...cmd, id: Date.now() });
  };
  const moveTo = (qid, target) => { commitTopics((cur) => moveItem(cur, qid, target, kindOf(qRef.current.find((q) => q.id === qid)))); setMoveFor(null); say(target ? "اتنقل للموضوع ✅" : "اتشال من الموضوع"); };
  const topicView = view.name === "topic" ? topics.list.find((t) => t.id === view.id) : null;
  const libraryObj = { questions, topics };
  const moveQ = moveFor ? questions.find((q) => q.id === moveFor) : null;

  const editing = view.name === "edit" && view.id ? questions.find((q) => q.id === view.id) : null;

  return (
    <LinkCtx.Provider value={linkCtx}>
    <div className="app" dir="rtl" data-sub={view.name !== "home"}>
      <div className="paper" aria-hidden="true" />

      <header className="topbar">
        <div className="topbar-in">
          <div className="tb-side tb-start">
            {view.name !== "home" && (
              <button onClick={back} aria-label="رجوع" className="iconbtn iconbtn-solid"><Icon name="back" size={20} /></button>
            )}
            <Brand onClick={() => go({ name: "home" }, true)} />
          </div>
          <div className="tb-side tb-end">
            <button type="button" onClick={() => (aiOpen ? setAiOpen(false) : openAI())} aria-label="AI — مساعد المذاكرة" aria-pressed={aiOpen} className="ai-btn" data-on={aiOpen}>
              <Icon name="sparkles" size={17} /><span>AI</span>
            </button>
            <button onClick={() => (view.name === "gallery" ? back() : go({ name: "gallery" }))} aria-label="معرض الصور" title="معرض الصور" className="iconbtn iconbtn-badge" data-on={view.name === "gallery"}>
              <Icon name="images" size={19} />{galleryCount > 0 && <i>{galleryCount > 99 ? "99+" : galleryCount}</i>}
            </button>
            <button onClick={() => (view.name === "mistakes" ? back() : go({ name: "mistakes" }))} aria-label="غلطاتي" title="غلطاتي" className="iconbtn iconbtn-badge iconbtn-mist" data-on={view.name === "mistakes"}>
              <Icon name="bookX" size={19} />{mistakeCount > 0 && <i>{mistakeCount > 99 ? "99+" : mistakeCount}</i>}
            </button>
            <button onClick={toggleTheme} aria-label={theme === "dark" ? "الوضع النهاري" : "الوضع الليلي"} className="iconbtn">
              <Icon name={theme === "dark" ? "sun" : "moon"} size={19} />
            </button>
            <button onClick={() => setShowBackup(true)} aria-label="نسخة احتياطية" className="iconbtn"><Icon name="save" size={19} /></button>
            <button onClick={() => setShowKey(true)} aria-label="مفاتيح الـ API" data-missing={!apiKey} className="iconbtn">
              <Icon name="key" size={19} />
            </button>
          </div>
        </div>
      </header>

      <main>
        {view.name === "home" ? (
          <Home questions={questions} words={words} goal={goal} onGoal={cycleGoal}
            onAdd={() => go({ name: "edit", kind: "question" })} onAddLesson={() => go({ name: "edit", kind: "lesson" })} onWords={() => go({ name: "words" })}
            onOpen={(id) => go({ name: "edit", id })}
            topics={topics} org={org} onOrganize={(full, kind) => runOrganize(full, true, kind)} onAuto={(v) => commitTopics((c) => ({ ...c, auto: v }))}
            onOpenTopic={(id) => go({ name: "topic", id })} onMistakes={() => go({ name: "mistakes" })} />
        ) : view.name === "topic" ? (
          topicView ? (
            <TopicScreen key={topicView.id} topic={topicView} questions={questions} apiKey={apiKey} onNeedKey={() => setShowKey(true)}
              onOpen={(id) => go({ name: "edit", id })} onMove={setMoveFor} onAI={openAI}
              onRename={(name) => commitTopics((c) => renameTopic(c, topicView.id, { name }))}
              onDelete={() => { commitTopics((c) => dropTopic(c, topicView.id)); say("اتفكّ الموضوع، والأسئلة رجعت من غير موضوع"); back(); }}
              onSaveOverview={(text, sig) => commitTopics((c) => renameTopic(c, topicView.id, { overview: text, overviewSig: sig }))} />
          ) : <div className="page"><div className="card empty"><b>الموضوع ده مش موجود</b><button className="btn btn-teal" onClick={() => go({ name: "home" }, true)}>الرئيسية</button></div></div>
        ) : view.name === "mistakes" ? (
          <MistakesScreen onAsk={(text, o) => openAI({ text, send: true, ...(o || {}) })} onHome={() => go({ name: "home" }, true)} />
        ) : view.name === "gallery" ? (
          <ImageGallery questions={questions} topics={topics} onOpen={(id) => go({ name: "edit", id })} />
        ) : view.name === "words" ? (
          <WordsScreen words={words} onOpen={(id) => go({ name: "edit", id })} onClearLegacy={clearLegacyWords} onDeleteWord={deleteWord} />
        ) : (
          <Editor key={`${view.id || "new"}-${view.kind || ""}`} initial={editing} kind={view.kind} history={historyFor(questions, view.id)} boot={boot} apiKey={apiKey} perf={perf} onLearn={onLearn}
            onNeedKey={() => setShowKey(true)} onSave={saveQuestion} onDelete={deleteQuestion}
            nav={view.id ? navFor(topics, questions, view.id) : null} onNavTo={(id) => go({ name: "edit", id }, true)}
            onOpenTopic={(id) => go({ name: "topic", id })} onMove={setMoveFor} library={libraryObj} onOpenItem={openItem}
            highlight={view.hl || null} onHighlightShown={consumeHl} />
        )}
      </main>

      {aiEver && (
        <ChatPanel variant="window" open={aiOpen} onClose={() => setAiOpen(false)} apiKey={apiKey} onNeedKey={() => setShowKey(true)}
          ctx={AI_CTX} chipIds={[]} storeKey="clinix:chat:global" command={aiCmd} onOpenItem={openItem}
          onOpenMistakes={(replace) => go({ name: "mistakes" }, !!replace)}
          library={{ questions, topics, focusId: view.name === "edit" ? view.id : null, focusTopicId: view.name === "topic" ? view.id : null }} />
      )}
      {moveQ && <MoveModal title={moveQ.title} topics={{ ...topics, list: topics.list.filter((t) => t.kind === kindOf(moveQ)) }} kind={kindOf(moveQ)} currentId={(topics.list.find((t) => t.qids.includes(moveQ.id)) || {}).id} onPick={(t) => moveTo(moveQ.id, t)} onClose={() => setMoveFor(null)} />}
      <WordPop />
      {showBackup && <BackupModal onClose={() => setShowBackup(false)} />}
      {showKey && <KeyModal hasEnv={!!ENV_KEY} onKeysChanged={onKeysChanged} onClose={() => setShowKey(false)} />}
      {view.name === "edit" && view.ret && (
        <div className="ret-bar">
          <button type="button" className="ret-btn" onClick={returnToOrigin} title={view.ret.title || undefined}>
            <Icon name="back" size={16} stroke={2.6} /> عد للسؤال الأصلي
          </button>
        </div>
      )}
      <Toast msg={toast} />
      <Credit />
      {burst > 0 && <Confetti key={burst} />}
    </div>
    </LinkCtx.Provider>
  );
}
