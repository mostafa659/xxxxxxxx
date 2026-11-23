import test from "node:test";
import assert from "node:assert/strict";
import * as M from "../src/lib/mistakes.js";
import { mergeTopics } from "../src/lib/topics.js";
import { chunkText, backupName } from "../src/lib/backup.js";

const Q = (o = {}) => ({ type: "single", stem: "A client with heart failure has crackles. Which action is the priority?", options: ["Sit upright", "Give fluids", "Lay flat", "Walk"], correct: [0], rationale: "Upright eases breathing.", topic: "Heart failure", ...o });
const fresh = () => M.__setState([]);

test("mistakeId is stable for the same question and ignores case / punctuation", () => {
  assert.equal(M.mistakeId("Which action is first?"), M.mistakeId("  which ACTION is first "));
  assert.notEqual(M.mistakeId("Question A about potassium"), M.mistakeId("Question B about sodium"));
});

test("a wrong answer is saved once; the same question missed again only counts up", () => {
  fresh();
  assert.equal(M.recordAnswer(Q(), [1], { exam: "امتحان القلب" }), "new");
  assert.equal(M.__getState().list.length, 1);
  assert.equal(M.recordAnswer(Q(), [2], { exam: "امتحان القلب" }), "again");
  const [m] = M.__getState().list;
  assert.equal(M.__getState().list.length, 1);
  assert.equal(m.wrong, 2); assert.deepEqual(m.picked, [2]); assert.equal(m.cat, "cardio"); assert.equal(m.mastered, false);
});

test("a right answer to a question that was never wrong saves nothing", () => {
  fresh();
  assert.equal(M.recordAnswer(Q(), [0], { exam: "x" }), null);
  assert.equal(M.__getState().list.length, 0);
});

test("two right answers in a row master it; a wrong one breaks the streak", () => {
  fresh();
  M.recordAnswer(Q(), [1], {});
  assert.equal(M.recordAnswer(Q(), [0], { retry: true }), "fixed");
  assert.equal(M.recordAnswer(Q(), [1], { retry: true }), "again");           // streak back to 0
  assert.equal(M.__getState().list[0].streak, 0);
  M.recordAnswer(Q(), [0], { retry: true });
  assert.equal(M.recordAnswer(Q(), [0], { retry: true }), "mastered");
  const m = M.__getState().list[0];
  assert.equal(m.mastered, true); assert.equal(M.openCount(M.__getState().list), 0);
  M.recordAnswer(Q(), [3], {});                                                  // wrong again → back to review
  assert.equal(M.__getState().list[0].mastered, false);
});

test("multi-select: the whole set must match", () => {
  fresh();
  const q = Q({ type: "multi", stem: "Select all findings of hypokalemia in a client", options: ["a", "b", "c", "d", "e"], correct: [0, 2, 3], topic: "Potassium" });
  assert.equal(M.recordAnswer(q, [0, 2], {}), "new");
  assert.equal(M.recordAnswer(q, [3, 2, 0], {}), "fixed");
});

test("categories: topic first, then exam title, then question text", () => {
  assert.equal(M.categoryOf({ topic: "Digoxin toxicity" }), "pharm");
  assert.equal(M.categoryOf({ topic: "Heart failure" }), "cardio");
  assert.equal(M.categoryOf({ topic: "COPD" }), "resp");
  assert.equal(M.categoryOf({ topic: "Insulin therapy" }), "endo");
  assert.equal(M.categoryOf({ topic: "Hyperkalemia" }), "renal");
  assert.equal(M.categoryOf({ topic: "", exam: "امتحان قصور القلب" }), "cardio");
  assert.equal(M.categoryOf({ topic: "Delegation" }), "mgmt");
  assert.equal(M.categoryOf({ topic: "", exam: "", stem: "The nurse sets priorities for a mixed group of tasks" }), "other");   // weak words are ignored in the question text
  assert.equal(M.categoryOf({ topic: "Something odd" }), "other");
});

test("organizeMistakes: category → topic, most open mistakes first; 'Heart Failure' and 'heart failure' are one topic", () => {
  fresh();
  M.recordAnswer(Q({ stem: "Q1 heart failure crackles priority action nurse", topic: "Heart Failure" }), [1], { exam: "E" });
  M.recordAnswer(Q({ stem: "Q2 heart failure daily weight teaching nurse", topic: "heart failure" }), [1], { exam: "E" });
  M.recordAnswer(Q({ stem: "Q3 asthma wheezing albuterol nurse first", topic: "Asthma" }), [1], { exam: "E" });
  const g = M.organizeMistakes(M.__getState().list);
  assert.equal(g.length, 2);
  assert.equal(g[0].cat, "cardio"); assert.equal(g[0].topics.length, 1); assert.equal(g[0].topics[0].items.length, 2);
  assert.equal(g[1].cat, "resp");
  const s = M.summarize(M.__getState().list);
  assert.equal(s.open, 3); assert.equal(s.topics, 2); assert.equal(s.weakest.name.toLowerCase(), "heart failure");
});

test("filterList: status / category / search", () => {
  fresh();
  M.recordAnswer(Q({ stem: "Q1 heart failure crackles priority action nurse" }), [1], {});
  M.recordAnswer(Q({ stem: "Q3 asthma wheezing albuterol nurse first", topic: "Asthma" }), [1], {});
  M.setMastered(M.__getState().list.find((m) => m.topic === "Asthma").id, true);
  const L = M.__getState().list;
  assert.equal(M.filterList(L, { status: "open" }).length, 1);
  assert.equal(M.filterList(L, { status: "done" }).length, 1);
  assert.equal(M.filterList(L, { status: "all" }).length, 2);
  assert.equal(M.filterList(L, { status: "all", cat: "resp" }).length, 1);
  assert.equal(M.filterList(L, { status: "all", q: "ALBUTEROL" }).length, 1);
});

test("mergeMistakes: union by id, the newer one wins, counters keep the larger value", () => {
  const a = [{ id: "1", stem: "s", options: ["a"], correct: [0], wrong: 1, lastAt: 5, firstAt: 5 }, { id: "2", stem: "s2", options: ["a"], correct: [0], wrong: 1, lastAt: 1, firstAt: 1 }];
  const b = [{ id: "1", stem: "s", options: ["a"], correct: [0], wrong: 3, lastAt: 9, firstAt: 2, mastered: true }, { id: "bad" }];
  const r = M.mergeMistakes(a, b);
  assert.equal(r.length, 2);
  const one = r.find((x) => x.id === "1");
  assert.equal(one.wrong, 3); assert.equal(one.lastAt, 9); assert.equal(one.firstAt, 2); assert.equal(one.mastered, true);
});

test("mergeTopics: restored questions join existing topics, nothing is placed twice, unknown ids are dropped", () => {
  const cur = { list: [{ id: "t1", kind: "question", name: "Heart", qids: ["a"] }], pinned: [], auto: true };
  const inc = { list: [{ id: "t9", kind: "question", name: "heart", qids: ["a", "b", "zzz"] }, { id: "t2", kind: "lesson", name: "Renal", qids: ["c"] }], pinned: ["b", "zzz"], auto: false };
  const r = mergeTopics(cur, inc, new Set(["a", "b", "c"]));
  assert.deepEqual(r.list.find((t) => t.id === "t1").qids, ["a", "b"]);
  assert.deepEqual(r.list.find((t) => t.id === "t2").qids, ["c"]);
  assert.equal(r.list.length, 2); assert.deepEqual(r.pinned, ["b"]); assert.equal(r.auto, true);
  assert.equal(mergeTopics(null, inc, new Set(["a", "b", "c"])).list.length, 2);
});

test("backup: chunking never splits an emoji and loses nothing; file name is dated", () => {
  const text = "ab😀".repeat(1000) + "تمام";
  const parts = chunkText(text, 7);
  assert.equal(parts.join(""), text);
  for (const p of parts) assert.ok(!/[\ud800-\udbff]$/.test(p) && !/^[\udc00-\udfff]/.test(p));
  assert.match(backupName(new Date(2026, 10, 8, 14, 5)), /^clinixstudy-backup-2026-11-08-1405\.json$/);
});
