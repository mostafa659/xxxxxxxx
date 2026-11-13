/* v3.41 · audio files: the recording is paid for ONCE (32 tokens per second of sound, per request that carries it).
   Promises pinned here:
   1. a recording becomes plain text when it is added; after that NO request (analysis, chat) carries the audio again;
   2. turning it into text is ONE request, no thinking, no racing second model, strong model first, the file sent untouched;
   3. the same recording is never paid for twice (cache);
   4. a refused format falls back to a browser conversion; other errors are not mistaken for format errors;
   5. silence / no speech is an honest error, never an empty lesson. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { installFetch, script, reset, log } from "./mockfetch.mjs";
import * as R from "../src/lib/router.js";
import * as Q from "../src/lib/quota.js";
import { setExtKeys, setEnginePrefs } from "../src/lib/providers.js";
import { getModelLists, runTask } from "../src/lib/gemini.js";
import { createAnalysis } from "../src/lib/analysis.js";
import { readFiles, sourceParts, isAudio } from "../src/lib/docs.js";
import { isAudioFile, mimeFor } from "../src/lib/audio-types.js";
import * as A from "../src/lib/audio.js";

installFetch();
/* browsers have FileReader (docs.js reads text files with it); plain Node does not */
globalThis.FileReader = globalThis.FileReader || class { readAsText(b) { b.text().then((t) => { this.result = t; this.onload && this.onload(); }, (e) => this.onerror && this.onerror(e)); } readAsDataURL(b) { b.arrayBuffer().then((ab) => { this.result = `data:${b.type};base64,${Buffer.from(ab).toString("base64")}`; this.onload && this.onload(); }); } readAsArrayBuffer(b) { b.arrayBuffer().then((ab) => { this.result = ab; this.onload && this.onload(); }); } };
const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
let KEY = "AIzaAUDIO000", seq = 0;
const G = (m) => `gemini:${m}`;
const fresh = () => {
  KEY = `AIzaAUDIO${String(++seq).padStart(6, "0")}`;
  reset(); R.__resetRouter(); window.localStorage.clear(); Q.__resetQuota(); Q.__setClock(null);
  setExtKeys({}); setEnginePrefs({ mode: "auto" });
};
const TRANSCRIPT = "HEPARINMARK-4417: the nurse checks the aPTT, the therapeutic range is sixty to eighty seconds, and the dose is adjusted by the protocol.";

/* a fake recording: `n` bytes of a recognisable pattern (so a request body that carries it can be found) */
const bytes = (n, seed = 7) => { const u = new Uint8Array(n); for (let i = 0; i < n; i++) u[i] = (i * 31 + seed * 17 + (i >> 8)) & 255; return u; };
const rec = (name, n = 4096, type = "", seed) => new File([bytes(n, seed)], name, { type });
const b64Mark = (file) => Buffer.from(bytes(file.size, file.__seed || 7)).toString("base64").slice(100, 160);

/* an in-memory cache + a fake network for the unit tests */
const memCache = () => { const m = new Map(); return { m, get: async (k) => m.get(k) || null, set: async (k, v) => { m.set(k, v); } }; };
const LISTS = () => ({ fast: ["gemini-flash-latest", "gemini-flash-lite-latest"], pro: ["gemini-pro-latest"] });
const mk = (over = {}) => {
  const calls = { run: [], upload: [], wav: 0 };
  const cache = memCache();
  const deps = {
    cache, lists: LISTS, uploads: true,
    run: async (args) => { calls.run.push(args); return { text: TRANSCRIPT, model: "gemini-flash-latest" }; },
    upload: async (a) => { calls.upload.push(a); return { fileUri: "https://g/files/abc", mimeType: a.mimeType }; },
    toWav: async () => { calls.wav++; return new Blob([bytes(2048, 3)], { type: "audio/wav" }); },
    ...over,
  };
  return { calls, cache, deps };
};

/* ── 1 · which files are recordings, and what Google is told ── */
test("recordings are recognised by type or extension; the MIME type sent is one Google lists", () => {
  assert.ok(isAudioFile(rec("lecture.mp3", 10, "audio/mpeg")) && isAudio(rec("x.m4a")) && isAudioFile(rec("voice.opus")));
  assert.ok(!isAudioFile(rec("page.pdf", 10, "application/pdf")) && !isAudioFile(rec("pic.png", 10, "image/png")) && !isAudioFile(rec("notes.docx")));
  assert.equal(mimeFor(rec("a.mp3")), "audio/mp3");
  assert.equal(mimeFor(rec("a.m4a")), "audio/aac", "m4a is AAC: sent as the listed audio/aac");
  assert.equal(mimeFor(rec("a.opus")), "audio/ogg");
  assert.equal(mimeFor(rec("noext", 10, "audio/mpeg")), "audio/mp3", "type only (no extension)");
  assert.equal(mimeFor(rec("a.webm")), null, "a format Google does not list is converted first");
  assert.equal(mimeFor(rec("a.amr")), null);
  assert.equal(mimeFor(rec("mystery", 10, "audio/x-unknown")), null);
});

/* ── 2 · the request itself ── */
test("ONE request: the recording untouched + a one-line instruction, no thinking, no racing second model, strong model first", async () => {
  const { calls, deps } = mk();
  const f = rec("lecture.mp3", 5000, "audio/mpeg");
  const r = await A.transcribeAudio(f, { apiKey: KEY, deps });
  assert.equal(calls.run.length, 1, "one request");
  const a = calls.run[0];
  assert.equal(a.task, "audio");
  assert.equal(a.noHedge, true, "a second model racing the first would pay for the same audio twice");
  assert.deepEqual(a.spec, { levels: ["minimal", "low"], budget: 0 }, "no thinking tokens");
  assert.equal(a.models[0], "gemini-flash-latest", "the strong Flash model first (every later answer stands on this text)");
  assert.ok(a.models.indexOf("gemini-flash-lite-latest") > 0, "Flash-Lite only as a fallback");
  assert.equal(a.parts.length, 2);
  assert.equal(a.parts[0].inlineData.mimeType, "audio/mp3");
  assert.equal(Buffer.from(a.parts[0].inlineData.data, "base64").length, 5000, "the file is sent as it is (no re-encoding, no cutting, no speed-up)");
  assert.equal(a.parts[1].text, A.AUDIO_USER);
  assert.ok(A.AUDIO_SYSTEM.length < 900, "the instruction is short: it is paid for on every try");
  assert.match(a.system, /Never translate/);
  assert.match(a.system, /No timestamps, no speaker labels/, "no extra output tokens for things the lesson does not use");
  assert.equal(r.text, TRANSCRIPT);
  assert.equal(r.cached, false);
});

test("a big recording goes up ONCE straight from the File (no base64 copy) and the request carries only a link", async () => {
  const { calls, deps } = mk();
  const f = rec("lecture.mp3", 700 * 1024, "audio/mpeg");
  await A.transcribeAudio(f, { apiKey: KEY, deps });
  assert.equal(calls.upload.length, 1);
  assert.ok(calls.upload[0].blob === f && !calls.upload[0].data, "uploaded from the File itself");
  assert.equal(calls.upload[0].mimeType, "audio/mp3");
  const p = calls.run[0].parts;
  assert.deepEqual(p[0], { fileData: { mimeType: "audio/mp3", fileUri: "https://g/files/abc" } });
  assert.ok(!JSON.stringify(p).includes("inlineData"));
  assert.equal(calls.run.length, 1);
});

test("the upload fails: a small file still goes inline, a big one stops with a message (and sends nothing)", async () => {
  const bad = { upload: async () => { throw new Error("net"); } };
  const small = mk(bad);
  const r = await A.transcribeAudio(rec("a.mp3", 400 * 1024, "audio/mpeg"), { apiKey: KEY, deps: small.deps });
  assert.equal(r.text, TRANSCRIPT);
  assert.ok(small.calls.run[0].parts[0].inlineData, "fell back to inline");
  const big = mk(bad);
  await assert.rejects(() => A.transcribeAudio(rec("b.mp3", 13 * 1024 * 1024, "audio/mpeg"), { apiKey: KEY, deps: big.deps }), /مقدرتش أرفع/);
  assert.equal(big.calls.run.length, 0);
});

test("silence-length timeouts grow with the recording (Google hears it first, then writes), and stay bounded", async () => {
  const s = mk(), l = mk();
  await A.transcribeAudio(rec("s.mp3", 100 * 1024, "audio/mpeg"), { apiKey: KEY, deps: s.deps });
  await A.transcribeAudio(rec("l.mp3", 40 * 1024 * 1024, "audio/mpeg", 9), { apiKey: KEY, deps: l.deps });
  assert.ok(s.calls.run[0].firstMs >= 60000);
  assert.ok(l.calls.run[0].firstMs > s.calls.run[0].firstMs && l.calls.run[0].firstMs <= 300000);
});

/* ── 3 · never paid twice ── */
test("the same recording added again costs NOTHING: the transcript comes from the cache", async () => {
  const { calls, deps } = mk();
  const f = rec("lecture.mp3", 5000, "audio/mpeg");
  const first = await A.transcribeAudio(f, { apiKey: KEY, deps });
  const again = await A.transcribeAudio(rec("renamed copy.mp3", 5000, "audio/mpeg"), { apiKey: KEY, deps });
  assert.equal(calls.run.length, 1, "no second request");
  assert.equal(again.cached, true);
  assert.equal(again.text, first.text);
  const other = await A.transcribeAudio(rec("lecture2.mp3", 5000, "audio/mpeg", 99), { apiKey: KEY, deps });
  assert.equal(calls.run.length, 2, "a different recording is a new request");
  assert.equal(other.cached, false);
});

/* ── 4 · safety nets ── */
test("Google refuses the format → converted in the browser and sent once more (and only then)", async () => {
  const s = mk({ run: async (args) => { s.calls.run.push(args); if (args.parts[0].inlineData.mimeType !== "audio/wav") throw Object.assign(new Error("Unsupported MIME type: audio/aac"), { status: 400 }); return { text: TRANSCRIPT }; } });
  const r = await A.transcribeAudio(rec("voice.m4a", 5000, "audio/mp4"), { apiKey: KEY, deps: s.deps });
  assert.equal(s.calls.run.length, 2);
  assert.equal(s.calls.wav, 1);
  assert.equal(s.calls.run[1].parts[0].inlineData.mimeType, "audio/wav");
  assert.equal(r.via, "wav");
  assert.equal(r.text, TRANSCRIPT);
});

test("a format Google does not list (webm / amr) is converted at once: one request, no wasted refusal", async () => {
  const { calls, deps } = mk();
  const r = await A.transcribeAudio(rec("note.webm", 5000, "audio/webm"), { apiKey: KEY, deps });
  assert.equal(calls.wav, 1);
  assert.equal(calls.run.length, 1);
  assert.equal(calls.run[0].parts[0].inlineData.mimeType, "audio/wav");
  assert.equal(r.via, "wav");
});

test("a bad key or a busy Google is NOT mistaken for a format problem (no conversion, no second request)", async () => {
  for (const e of [Object.assign(new Error("API key not valid. Please pass a valid API key."), { status: 400 }), Object.assign(new Error("quota exceeded for audio input"), { status: 429 }), Object.assign(new Error("Google is busy"), { status: 503 })]) {
    const s = mk({ run: async (a) => { s.calls.run.push(a); throw e; } });
    await assert.rejects(() => A.transcribeAudio(rec("a.mp3", 5000, "audio/mpeg"), { apiKey: KEY, deps: s.deps }), (x) => x === e);
    assert.equal(s.calls.run.length, 1);
    assert.equal(s.calls.wav, 0);
  }
  assert.ok(A.looksLikeFormatError(Object.assign(new Error("Unsupported MIME type"), { status: 400 })));
  assert.ok(!A.looksLikeFormatError(Object.assign(new Error("API key not valid"), { status: 400 })));
});

test("Google cannot use the uploaded link (another key, expired): repeated once, inline when the file is small", async () => {
  let n = 0;
  const s = mk({ run: async (a) => { s.calls.run.push(a); if (++n === 1) throw Object.assign(new Error("Permission denied on file files/abc"), { status: 403 }); return { text: TRANSCRIPT }; } });
  const f = rec("a.mp3", 400 * 1024, "audio/mpeg");     // uploaded (>= 300 KB) but small enough to travel inline
  const r = await A.transcribeAudio(f, { apiKey: KEY, deps: s.deps });
  assert.equal(r.text, TRANSCRIPT);
  assert.equal(s.calls.run.length, 2);
  assert.ok(s.calls.run[0].parts[0].fileData && s.calls.run[1].parts[0].inlineData);
});

test("no speech (silence, music, a heartbeat) is an honest error: nothing is cached and no empty lesson is made", async () => {
  for (const out of ["[NO_SPEECH]", "NO_SPEECH", "  ", "ok."]) {
    const s = mk({ run: async () => ({ text: out }) });
    await assert.rejects(() => A.transcribeAudio(rec("a.mp3", 5000, "audio/mpeg"), { apiKey: KEY, deps: s.deps }), /مفيش كلام مسموع/);
    assert.equal(s.cache.m.size, 0);
  }
});

test("no key / too big / empty file: a clear message and NOT ONE request", async () => {
  const s = mk();
  await assert.rejects(() => A.transcribeAudio(rec("a.mp3", 5000, "audio/mpeg"), { apiKey: "", deps: s.deps }), /مفتاح/);
  await assert.rejects(() => A.transcribeAudio(rec("a.mp3", 100, "audio/mpeg"), { apiKey: KEY, deps: s.deps }), /فاضي/);
  const huge = { size: A.MAX_AUDIO + 1, name: "h.mp3", type: "audio/mpeg", slice: () => ({ arrayBuffer: async () => new ArrayBuffer(0) }) };
  await assert.rejects(() => A.transcribeAudio(huge, { apiKey: KEY, deps: s.deps }), /كبير/);
  assert.equal(s.calls.run.length + s.calls.upload.length, 0);
});

test("the student stopping the work (abort) is passed through, never turned into a conversion or a retry", async () => {
  const s = mk({ run: async (a) => { s.calls.run.push(a); throw Object.assign(new Error("aborted"), { name: "AbortError" }); } });
  await assert.rejects(() => A.transcribeAudio(rec("a.m4a", 5000, "audio/mp4"), { apiKey: KEY, deps: s.deps }), (e) => e.name === "AbortError");
  assert.equal(s.calls.run.length, 1);
  assert.equal(s.calls.wav, 0);
});

/* ── 5 · the text that comes back ── */
test("cleanTranscript: strips fences / labels, keeps Arabic, and breaks a model loop (the same sentence again and again)", () => {
  assert.equal(A.cleanTranscript("```\nTranscript: Give heparin.\n\n\n\nCheck aPTT.\n```"), "Give heparin.\n\nCheck aPTT.");
  assert.equal(A.cleanTranscript("المريض بياخد Heparin كل 8 ساعات."), "المريض بياخد Heparin كل 8 ساعات.");
  const loop = "Check the pulse.\n" + "Then call the doctor now.\n".repeat(40);
  const out = A.cleanTranscript(loop).split("\n");
  assert.ok(out.length <= 4, `loop collapsed (${out.length} lines)`);
  const inline = A.cleanTranscript("Start here. " + "Please repeat the dose again. ".repeat(12) + "End here.");
  assert.ok(inline.length < 120 && inline.includes("Start here.") && inline.includes("End here."), inline);
  assert.equal(A.cleanTranscript("Yes.\nYes.\nNo."), "Yes.\nYes.\nNo.", "a real repetition of two is kept");
  assert.ok(A.hasSpeech(TRANSCRIPT) && !A.hasSpeech("[NO_SPEECH]") && !A.hasSpeech("hmm"));
});

test("fingerprint: same bytes → same id whatever the name; different bytes or size → different", async () => {
  const a = await A.fingerprint(rec("one.mp3", 200000)), b = await A.fingerprint(rec("two.mp3", 200000)), c = await A.fingerprint(rec("one.mp3", 200000, "", 5)), d = await A.fingerprint(rec("one.mp3", 200001));
  assert.equal(a, b); assert.notEqual(a, c); assert.notEqual(a, d);
});

test("browser conversion helpers: a valid 16 kHz mono 16-bit WAV, resampling keeps the length ratio", async () => {
  const wav = A.encodeWav(new Float32Array([0, 0.5, -0.5, 1, -1]), 16000);
  const dv = new DataView(await wav.arrayBuffer());
  assert.equal(String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)), "RIFF");
  assert.equal(dv.getUint32(24, true), 16000);
  assert.equal(dv.getUint16(22, true), 1, "mono");
  assert.equal(dv.getUint16(34, true), 16, "16-bit");
  assert.equal(wav.size, 44 + 10);
  assert.equal(dv.getInt16(44 + 6, true), 32767);
  assert.equal(dv.getInt16(44 + 8, true), -32768);
  const down = A.resampleLinear(new Float32Array(48000).fill(0.25), 48000, 16000);
  assert.equal(down.length, 16000);
  assert.ok(Math.abs(down[100] - 0.25) < 1e-6);
});

/* ── 6 · the engine: a second model must not race the recording ── */
test("through the real engine: a slow first word makes a normal request race a second model, an audio request does NOT (control experiment)", async () => {
  fresh();
  const was = { ...R.HEDGE_MS.audio }, floor = R.HEDGE_FLOOR_MS.v;
  R.HEDGE_MS.audio = { min: 60, max: 120 }; R.HEDGE_FLOOR_MS.v = 20;       // make the race start almost at once so the test is quick
  try {
    const lists = getModelLists(KEY), all = [...lists.fast, ...lists.pro];
    const count = async (noHedge) => {
      reset(); R.__resetRouter();                                                   // (reset also clears the scripts: they are set again each time)
      all.forEach((m) => script(G(m), { wait: 900, ok: TRANSCRIPT }));
      await runTask({ apiKey: KEY, task: "audio", models: all, system: "s", parts: [{ text: "x" }], spec: { levels: ["minimal"], budget: 0 }, maxOut: 500, firstMs: 20000, idleMs: 20000, noHedge });
      return log.filter((l) => l.lane !== "list").length;
    };
    const raced = await count(false);
    const single = await count(true);
    assert.ok(raced >= 2, `without noHedge the slow request is raced (${raced} requests)`);
    assert.equal(single, 1, "with noHedge the audio is sent exactly once");
  } finally { R.HEDGE_MS.audio = was; R.HEDGE_FLOOR_MS.v = floor; }
});

/* ── 7 · the whole point: after the text exists, no request carries the audio again ── */
test("adding a recording: ONE request carries the audio, the item is plain text, and a whole lesson analysis afterwards never sends the audio", async () => {
  fresh();
  const lists = getModelLists(KEY);
  [...lists.fast, ...lists.pro].forEach((m) => script(G(m), { ok: TRANSCRIPT }));
  const f = rec("pharmacology lecture.mp3", 60 * 1024, "audio/mpeg");
  const mark = Buffer.from(bytes(f.size, 7)).toString("base64").slice(40, 100);

  const status = [];
  const { items, errors } = await readFiles([f], [], { apiKey: KEY, onStatus: (m) => status.push(m) });
  assert.deepEqual(errors, []);
  assert.equal(items.length, 1);
  const it = items[0];
  assert.equal(it.t, "text");
  assert.equal(it.label, "AUDIO");
  assert.equal(it.audio, true);
  assert.equal(it.name, "pharmacology lecture.mp3");
  assert.ok(it.text.includes("HEPARINMARK-4417"));
  assert.ok(status.length > 0, "the student sees progress");
  const afterIntake = log.filter((l) => l.lane !== "list");
  assert.equal(afterIntake.length, 1, "exactly one request to turn the recording into text");
  assert.ok(JSON.stringify(afterIntake[0].body).includes(mark), "…and that one carries the audio");

  const doc = { kind: "bundle", name: it.name, items: [{ ...it, id: undefined }] };
  const parts = sourceParts(doc, null);
  assert.ok(!JSON.stringify(parts).includes("inlineData") && !JSON.stringify(parts).includes("fileData"), "the source is text now");
  assert.ok(JSON.stringify(parts).includes("HEPARINMARK-4417"));

  await new Promise((resolve) => {
    let n = 0; const fin = () => { if (++n >= 3) resolve(); };
    const a = createAnalysis({ kind: "lesson", history: [], dataUrl: null, doc, extra: "", chips: [], apiKey: KEY, modeId: "balanced", onUpdate() {}, onDone: fin, onError: fin, onNotice() {} });
    a.start();
    setTimeout(resolve, 6000);
  });
  const all = log.filter((l) => l.lane !== "list");
  assert.ok(all.length >= 4, `the analysis ran (${all.length} requests in total)`);
  assert.equal(all.filter((l) => JSON.stringify(l.body).includes(mark)).length, 1, "the audio was sent once in total, never by the analysis");
  assert.ok(all.slice(1).filter((l) => JSON.stringify(l.body).includes("HEPARINMARK-4417")).length >= 2, "every analysis request works from the text");
});

test("a recording that cannot be read does not block the other files: the error names the file", async () => {
  const { items, errors } = await readFiles([rec("notes.txt", 80, "text/plain"), rec("voice.mp3", 5000, "audio/mpeg")], [], { apiKey: "" });
  assert.equal(items.length, 1);
  assert.equal(items[0].t, "text");
  assert.equal(errors.length, 1);
  assert.match(errors[0], /voice\.mp3/);
  assert.match(errors[0], /مفتاح/);
});

/* ── 8 · the screens ── */
test("screens: the editor and the chat pass the key and show progress; analysing / sending waits for the transcript", () => {
  const ed = src("screens/Editor.jsx"), ch = src("components/ChatPanel.jsx"), sb = src("components/SourceBox.jsx");
  assert.ok(/readFiles\(list, cur, \{ apiKey/.test(ed) && /readingRef\.current\) return;\s*\/\/ v3\.41/.test(ed) && /!!reading \|\|/.test(ed));
  assert.ok(/readFiles\(arr, files, \{ apiKey/.test(ch) && /busy \|\| readingRef\.current\) return;/.test(ch));
  assert.ok(/busy = ""/.test(sb) && sb.includes("MP3") && sb.includes("i.audio"));
  assert.ok(!/ملفات الصوت والفيديو مش مدعومة/.test(src("lib/docs.js")), "audio is supported now");
  assert.match(src("lib/docs.js"), /ملفات الفيديو مش مدعومة/);
});
