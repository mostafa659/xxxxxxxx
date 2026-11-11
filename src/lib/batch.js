/* ───────────── Many questions in one upload ─────────────
   The student may upload screenshots / PDFs of SEVERAL questions at once and say in the note which ones he wants
   ("only questions 1, 7 and 8"). Two steps:

   1. detectQuestions  → ONE small request that looks at all the files, finds the questions, and keeps ONLY the ones the
                         note selects. Nothing else is analysed.
   2. runBatch         → every selected question goes through the normal full analysis on its OWN file(s) and is saved
                         as its own question, in the order the student sees them (a few at a time, saves one by one). */

import { getModelLists, runTask } from "./gemini.js";
import { createAnalysis } from "./analysis.js";
import { sourceParts, makeSource } from "./docs.js";

export const MAX_BATCH = 40;

const SYSTEM = `You are the intake clerk of the ClinixStudy app (a study app for the NCLEX-RN exam). The student uploaded files (screenshots, pages, PDFs or typed text) that may hold ONE or MANY exam questions, and wrote a note. Your only job: find the questions and decide which ones to analyse.

RULES
1. Count the real exam questions in the files, in reading order (file 1 first). A case study with several tabs / exhibits / screens that all belong to the same item is ONE question. Cover pages, answer keys, rationales and score screens are not questions.
2. If the student's note selects questions (by number, order or place: "7 and 8 and 1", "the first three", "question 5 to 9", "everything except 2", "the second image", Arabic or English, e.g. "السؤال السابع والثامن والاول"), return ONLY those questions and nothing else. Numbers mean the number printed on the question when it is visible, otherwise its position in reading order. If the note does not select anything, return ALL the questions.
3. For every returned question say in which file(s) it is (file numbers, 1-based, as in the given order; a typed text or PDF is one file).
4. Never invent a question. If the files hold no question, return an empty list.

OUTPUT: JSON only, no markdown fence:
{"total": <how many questions exist in all files>, "questions": [{"n": <number printed on it, or its position>, "files": [<file numbers>], "title": "<3 to 7 English words naming the clinical topic>", "start": "<the first 8 to 12 words of the question stem, copied exactly>"}]}`;

const parseJson = (t) => {
  const s = String(t || "").replace(/^```[a-z]*\n?|\n?```$/gim, "").trim();
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  return JSON.parse(a >= 0 && b > a ? s.slice(a, b + 1) : s);
};

export async function detectQuestions({ apiKey, items, note, signal }) {
  const src = makeSource(items);
  const lists = getModelLists(apiKey);
  const names = items.map((it, i) => `File ${i + 1}: ${it.name || it.label || ""}`).join("\n");
  const res = await runTask({
    apiKey, models: [...lists.fast, ...lists.pro], task: "batch:detect", system: SYSTEM,
    parts: [...sourceParts(src.doc, src.imageUrl), { text: `FILES (${items.length}):\n${names}\n\nSTUDENT'S NOTE: ${String(note || "").trim().slice(0, 600) || "(none: analyse every question)"}\n\nReturn the JSON now.` }],
    spec: { levels: ["medium", "low"], budget: 2048 }, maxOut: 6000, hedgeMs: 7000, firstMs: 60000, idleMs: 40000, signal, onText: () => {},
  });
  let data;
  try { data = parseJson(res.text); } catch (e) { throw Object.assign(new Error("ما قدرتش أقسّم الأسئلة. جرّب تاني."), { detail: "batch: bad json" }); }
  const n = items.length;
  const questions = (Array.isArray(data.questions) ? data.questions : []).slice(0, MAX_BATCH).map((q, i) => {
    const files = [...new Set((Array.isArray(q.files) ? q.files : [q.files]).map((x) => Math.round(+x)).filter((x) => x >= 1 && x <= n))];
    return {
      key: i + 1, n: q.n !== undefined && q.n !== null && String(q.n).trim() ? String(q.n).trim() : String(i + 1),
      files: files.length ? files : items.map((_, j) => j + 1),
      title: String(q.title || "").replace(/\s+/g, " ").trim().slice(0, 60),
      start: String(q.start || "").replace(/\s+/g, " ").trim().slice(0, 140),
    };
  });
  return { questions, total: Math.max(+data.total || 0, questions.length) };
}

/* the instruction that pins a full analysis to ONE question inside files that hold several */
export const focusNote = (q, note) =>
  `Work ONLY on question ${q.n}${q.start ? ` — it starts: «${q.start}»` : ""}. The files hold other questions too: ignore them completely, never mix them in.${note ? ` Student's note: ${String(note).trim().slice(0, 200)}` : ""}`.slice(0, 600);

/* run the full analysis for every selected question; `onState(list)` is called on every change.
   save(payload) → Promise<id>; saves are serialised so two questions never overwrite each other. */
export function runBatch({ apiKey, items, plan, note, chips, history, modeId, save, onState, onFatal, concurrency = 2 }) {
  const ctrl = new AbortController();
  const rows = plan.map((q) => ({ ...q, status: "wait", id: null, part: { ocr: "run", words: "run", reason: "run" }, err: null }));
  const push = () => onState(rows.map((r) => ({ ...r, part: { ...r.part } })));
  let chain = Promise.resolve();
  const saveSerial = (p) => { const r = chain.then(() => save(p)); chain = r.catch(() => {}); return r; };

  const one = (row) => new Promise((resolve) => {
    if (ctrl.signal.aborted) return resolve();
    const sub = makeSource(row.files.map((f) => items[f - 1]).filter(Boolean));
    const res = { original_question_text: "", new_words: "", explanation: "", tricks: "" };
    let an = null, finished = false;
    row.status = "run"; push();
    const check = async () => {
      if (finished || Object.values(row.part).includes("run")) return;
      finished = true;
      if (ctrl.signal.aborted) return resolve();
      try {
        const id = await saveSerial({
          id: null, kind: "question", title: row.title ? `س${row.n} · ${row.title}` : `س${row.n}`, imageUrl: sub.imageUrl, doc: sub.doc, imageChanged: true,
          instructions: note || "", chips, result: res, silent: true,
        });
        row.id = id; row.status = Object.values(row.part).includes("error") ? "partial" : "done";
      } catch (e) { row.status = "error"; row.err = "ماتحفظش"; }
      push(); resolve();
    };
    an = createAnalysis({
      kind: "question", history, dataUrl: sub.imageUrl, doc: sub.doc, extra: focusNote(row, note), chips, apiKey, modeId,
      onUpdate: (name, data) => { Object.entries(data).forEach(([k, v]) => { if (v !== null && v !== undefined) res[k] = v; }); },
      onDone: (name) => { row.part[name] = "done"; push(); check(); },
      onError: (name, err, partial) => {
        if (partial) Object.entries(partial).forEach(([k, v]) => { if (v !== null && v !== undefined) res[k] = v; });
        row.part[name] = "error"; row.err = err.message || "مشكلة"; push();
        if (err.fatal) { ctrl.abort(); an && an.cancel(); onFatal && onFatal(err); row.status = "error"; push(); finished = true; return resolve(); }
        check();
      },
    });
    ctrl.signal.addEventListener("abort", () => { an && an.cancel(); });
    an.start();
  });

  const done = (async () => {
    let next = 0;
    const worker = async () => { while (next < rows.length && !ctrl.signal.aborted) { const r = rows[next++]; await one(r); } };
    push();
    await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, worker));
    await chain;
  })();

  return { done, cancel() { ctrl.abort(); rows.forEach((r) => { if (r.status === "wait" || r.status === "run") r.status = "stopped"; }); push(); } };
}
