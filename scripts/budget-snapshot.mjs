/* Prints the prompt budget of every task (system+user tokens estimate, output caps, requests). Used to freeze the v3.42 baseline and to compare v3.43 against it. */
import * as P from "../src/lib/prompts.js";
import { MODES, CHIPS } from "../src/lib/config.js";
import { estimateTokens } from "../src/lib/router.js";

const chips = CHIPS.map((c) => c.id).slice(0, 2);
const base = { history: [], extra: "", chips, words: 680 };
const tok = (p) => estimateTokens(p.system || "", [{ text: p.user || "" }], 0);
const out = { prompts: {}, modes: {} };
const add = (k, p) => { out.prompts[k] = { chars: (p.system || "").length + (p.user || "").length, tokens: tok(p) }; };
add("solve", P.buildSolvePrompt());
add("lessonA", P.buildLessonAPrompt(base));
add("lessonB", P.buildLessonBPrompt({ ...base, brief: "ANSWER: B\nTYPE: x" }));
add("lessonB_main", P.buildLessonBPrompt({ ...base, brief: "ANSWER: B\nTYPE: x", part: "main" }));
add("lessonB_traps", P.buildLessonBPrompt({ ...base, brief: "ANSWER: B\nTYPE: x", part: "traps" }));
add("lessonX", P.buildLessonPrompt({ ...base, brief: null }));
add("studyA", P.buildStudyAPrompt(base));
add("studyB", P.buildStudyBPrompt(base));
add("studyLesson", P.buildStudyLessonPrompt(base));
add("studyHead", P.buildStudyHeadPrompt(base));
add("studySlice", P.buildStudySlicePrompt({ ...base, topics: ["t1"], all: ["t1"], mustWords: [] }));
add("studyTail", P.buildStudyTailPrompt(base));
add("ocr", P.buildOcrPrompt());
add("words", P.buildWordsPrompt(chips));
for (const [id, m] of Object.entries(MODES)) out.modes[id] = { solveMaxOut: m.solve.maxOut, writeMaxOut: m.write.maxOut, writeAMaxOut: m.writeA.maxOut, solveBudget: m.solve.budget };
console.log(JSON.stringify(out, null, 1));
