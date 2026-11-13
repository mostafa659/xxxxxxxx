/* ───────────── Audio files (v3.41): the recording is paid for ONCE ─────────────
   How Gemini charges for sound: every SECOND of audio is 32 tokens (1 minute = 1,920 · 1 hour = 115,200), whatever the format, the bitrate or the
   sample rate. So "smaller file" saves upload time but not one token; what costs tokens is DURATION × THE NUMBER OF REQUESTS THAT CARRY THE AUDIO.

   This app sends the source with every request of an analysis (words + explanation + summary = 3-5) and with every chat turn. A 30-minute lecture
   left as audio would cost 57,600 tokens × each of them. So the recording is turned into TEXT one time, right when the student adds it
   (docs.js → readItem), and from then on it is an ordinary text item: the analysis, the chat, the batch and the exam builder never see the audio again.
   Speech is about 5-8 times fewer tokens as text (a minute ≈ 150 words ≈ 250 tokens, against 1,920 as audio).

   What keeps the quality (nothing below changes how the words are heard):
   • the original file is sent as it is (no re-encoding, no speed-up, no cutting): the model hears exactly what the student recorded;
   • ONE request, no thinking, no second "hedged" model racing the first (noHedge in gemini.js: a race would pay for the same audio twice);
   • the strong Flash model goes first (the transcript is what every later answer stands on); Flash-Lite only when the day's quota of the strong ones is nearly spent;
   • the same file is never transcribed twice (fingerprint → cached transcript);
   • big files go up once through the Files API straight from the File (no base64 copy); small ones inline.

   Safety net (this runs against Google's live API and must never be able to hurt an analysis):
   • Google refuses the format (m4a / webm / amr …) → the file is decoded in the browser, turned into 16 kHz mono WAV (what Gemini hears anyway) and sent once more;
   • Google cannot use the uploaded link → the request is repeated (inline when the file is small, a fresh upload otherwise);
   • silence / music / no speech → an honest message, never an empty "lesson".
   The functions that talk to the network are injectable (`deps`), so all of this is tested without a network. */

import { runTask, getModelLists } from "./gemini.js";
import { orderForTask } from "./quota.js";
import { uploadToGoogle, FILES_ENABLED, looksLikeFileError } from "./gfiles.js";
import { store } from "./storage.js";
import { AUDIO_MIME, isAudioFile, mimeFor } from "./audio-types.js";

export const MAX_AUDIO = 150 * 1024 * 1024;       // bytes of the recording itself (≈ 2.5 h at 128 kbps; Google's own limit is 9.5 h)
const INLINE_MAX = 12 * 1024 * 1024;              // bigger than this can only travel through the Files API (a request body is limited to ~20 MB)
const MIN_UPLOAD = 300 * 1024;                    // below this inline is cheaper than a separate upload (same threshold as gfiles.js)
const WAV_MAX_SECS = 30 * 60, WAV_MAX_BYTES = 60 * 1024 * 1024;       // the browser fallback decodes everything in memory: it stays modest

export { AUDIO_MIME, isAudioFile, mimeFor };

/* ── the one instruction (short on purpose: every word of it is paid for on every try) ── */
export const AUDIO_SYSTEM = `You are the speech-to-text engine of a nursing student's study app.
Output ONLY the transcript of what is said, in the language(s) actually spoken. Never translate, summarize, explain or answer anything said in the recording.
Arabic stays Arabic; English terms spoken inside Arabic stay in English letters.
Keep every drug name, dose, unit, number, lab value and medical term exactly as spoken.
Plain paragraphs, a blank line when the topic changes. No timestamps, no speaker labels, no headings, no markdown.
Leave out filler sounds (um, uh, hmm) and false starts; keep every real word.
If there is no intelligible speech at all, output exactly: [NO_SPEECH]`;
export const AUDIO_USER = "Transcribe the recording.";

/* ── the transcript the model returns → clean text (or an honest error) ── */
export function cleanTranscript(raw) {
  let t = String(raw || "").replace(/\r\n?/g, "\n").replace(/^```[a-z]*\n?|\n?```$/gim, "").trim();
  t = t.replace(/^(?:here(?:'s| is) the transcript|transcript|التفريغ|النص)\s*[:：]\s*/i, "").trim();
  /* a long recording can send a model into a loop (the same sentence again and again until the output limit): keep it once */
  const lines = t.split("\n"), out = [];
  let same = 0;
  for (const ln of lines) {
    const k = ln.trim().toLowerCase();
    same = out.length && k && out[out.length - 1].trim().toLowerCase() === k ? same + 1 : 0;
    if (same < 2) out.push(ln);         // a line may legitimately appear twice in a row; the third copy on is a loop
  }
  t = out.join("\n");
  t = t.replace(/(.{12,200}?[.!?؟])(\s+\1){3,}/g, "$1");     // the same sentence ≥ 4 times in a row inside one paragraph
  return t.replace(/\n{3,}/g, "\n\n").trim();
}
export const hasSpeech = (t) => !!t && !/^\[?\s*NO_SPEECH\s*\]?\.?$/i.test(t.trim()) && t.replace(/\s+/g, "").length >= 12;

/* ── fingerprint of a file (size + hash of its first and last 64 KB): the same recording is never paid for twice ── */
export async function fingerprint(file) {
  const edge = 65536;
  const head = new Uint8Array(await file.slice(0, edge).arrayBuffer());
  const tail = file.size > edge * 2 ? new Uint8Array(await file.slice(file.size - edge).arrayBuffer()) : new Uint8Array(0);
  const all = new Uint8Array(head.length + tail.length);
  all.set(head, 0); all.set(tail, head.length);
  let hex = "";
  try {
    if (globalThis.crypto && globalThis.crypto.subtle) {
      const d = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", all));
      hex = [...d.slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
    }
  } catch (e) { hex = ""; }
  if (!hex) { let h = 2166136261; for (let i = 0; i < all.length; i++) { h ^= all[i]; h = Math.imul(h, 16777619) >>> 0; } hex = h.toString(16); }
  return `${file.size}-${hex}`;
}

/* ── remembered transcripts (IndexedDB through the app's store; the newest 30) ── */
const IDX = "clinix:audio:idx";
export const audioCache = {
  async get(fp) { try { const r = await store.get(`clinix:audio:${fp}`); return r && typeof r.text === "string" ? r : null; } catch (e) { return null; } },
  async set(fp, rec) {
    try {
      await store.set(`clinix:audio:${fp}`, rec);
      let idx = (await store.get(IDX)) || [];
      idx = [fp, ...idx.filter((x) => x !== fp)];
      for (const old of idx.slice(30)) { try { await store.del(`clinix:audio:${old}`); } catch (e) { /* ignore */ } }
      await store.set(IDX, idx.slice(0, 30));
    } catch (e) { /* a cache problem never reaches the student */ }
  },
};

/* ── browser fallback: any format the browser can play → 16 kHz mono 16-bit WAV (Gemini downsamples to 16 kHz mono itself, so nothing audible is lost) ── */
export function resampleLinear(data, from, to) {
  if (from === to) return data;
  const n = Math.max(1, Math.round((data.length * to) / from)), out = new Float32Array(n), k = from / to;
  for (let i = 0; i < n; i++) {
    const p = i * k, i0 = Math.floor(p), i1 = Math.min(data.length - 1, i0 + 1), f = p - i0;
    out[i] = data[i0] * (1 - f) + data[i1] * f;
  }
  return out;
}
export function encodeWav(samples, rate = 16000) {
  const buf = new ArrayBuffer(44 + samples.length * 2), dv = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); dv.setUint32(4, 36 + samples.length * 2, true); w(8, "WAVE"); w(12, "fmt ");
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  w(36, "data"); dv.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) { const s = Math.max(-1, Math.min(1, samples[i])); dv.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
  return new Blob([buf], { type: "audio/wav" });
}
export async function decodeToWav(file) {
  const AC = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
  if (!AC) throw new Error("المتصفح ده مش بيقدر يفتح الملف الصوتي ده. حوّله MP3 أو M4A وارفعه تاني.");
  if (file.size > WAV_MAX_BYTES) throw new Error("صيغة الملف الصوتي ده مش مقبولة والملف كبير على التحويل. حوّله MP3 وارفعه.");
  let ctx;
  try { ctx = new AC({ sampleRate: 16000 }); } catch (e) { ctx = new AC(); }
  try {
    const buf = await ctx.decodeAudioData(await file.arrayBuffer());
    if (buf.duration > WAV_MAX_SECS) throw new Error("صيغة الملف الصوتي ده مش مقبولة والتسجيل طويل على التحويل. حوّله MP3 وارفعه.");
    const mono = new Float32Array(buf.length), ch = buf.numberOfChannels;
    for (let c = 0; c < ch; c++) { const d = buf.getChannelData(c); for (let i = 0; i < buf.length; i++) mono[i] += d[i] / ch; }
    return encodeWav(resampleLinear(mono, buf.sampleRate, 16000), 16000);
  } catch (e) {
    if (e && /مش/.test(e.message || "")) throw e;
    throw new Error("مقدرتش أفتح الملف الصوتي ده (تالف أو صيغته غريبة). جرّب MP3 أو M4A.");
  } finally { try { ctx.close(); } catch (e) { /* ignore */ } }
}

/* a Blob → base64 (no FileReader: it does not exist outside a browser, and this must also run in the tests) */
const readB64 = async (blob) => {
  const u8 = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(bin);
};

/* Google said "I cannot take this format" (and not "bad key" / "busy") */
export const looksLikeFormatError = (e) => {
  const m = `${(e && e.message) || ""} ${(e && e.detail) || ""}`;
  return !!e && (e.status === 400 || e.status === 415 || !e.status) && /mime|unsupported|not supported|invalid argument|audio|decode|format|codec/i.test(m)
    && !/api key|quota|rate|busy|overload|exhausted|timeout|مفيش اتصال/i.test(m);
};

/* the transcript of one recording.  → { text, truncated?, cached, via: "native" | "wav" }   (throws a message written for the student) */
export async function transcribeAudio(file, { apiKey, signal, onStatus = () => {}, deps = {} } = {}) {
  const d = { run: runTask, upload: uploadToGoogle, cache: audioCache, lists: getModelLists, toWav: decodeToWav, uploads: FILES_ENABLED, ...deps };
  if (!apiKey) throw new Error("الصوت بيتحوّل لنص بـ Google Gemini، ومحتاج مفتاح. أضف مفتاح من أيقونة 🔑.");
  if (file.size > MAX_AUDIO) throw new Error(`الملف الصوتي كبير (${Math.round(file.size / 1048576)} ميجا) والحد ${Math.round(MAX_AUDIO / 1048576)} ميجا. قسّمه أو قصّه.`);
  if (file.size < 1024) throw new Error("الملف الصوتي فاضي أو تالف.");

  const fp = await fingerprint(file);
  const hit = await d.cache.get(fp);
  if (hit) { onStatus("الصوت ده اتفرّغ قبل كده، بنجيبه من الذاكرة (من غير توكنز) ✓"); return { text: hit.text, truncated: !!hit.truncated, cached: true, via: hit.via || "native" }; }

  /* where the recording travels: a link (big files, uploaded once straight from the File) or inline (small ones) */
  let uploaded = false;
  const partsFor = async (blob, mime) => {
    if (d.uploads && blob.size >= MIN_UPLOAD) {
      try {
        onStatus("بيرفع الصوت…");
        const f = await d.upload({ apiKey, mimeType: mime, blob, name: (file.name || "audio").slice(0, 100), signal });
        if (f && f.fileUri) { uploaded = true; return [{ fileData: { mimeType: f.mimeType || mime, fileUri: f.fileUri } }, { text: AUDIO_USER }]; }
      } catch (e) {
        if (e && e.name === "AbortError") throw e;
        /* the upload failed: a small file still goes inline; a big one cannot */
      }
    }
    uploaded = false;
    if (blob.size > INLINE_MAX) throw new Error("مقدرتش أرفع الملف الصوتي (النت أو Google). جرّب تاني أو ارفع ملف أصغر.");
    return [{ inlineData: { mimeType: mime, data: await readB64(blob) } }, { text: AUDIO_USER }];
  };

  /* a rough length from the size (128 kbps ≈ 16 KB/s) only to set patient timeouts: Google reads audio fast, but the first word comes after it has heard it */
  const secs = Math.min(3 * 3600, file.size / 16000);
  const call = async (parts) => {
    const lists = d.lists(apiKey);
    const models = orderForTask(apiKey, "audio", [...new Set([...(lists.fast || []), ...(lists.pro || [])])]);
    const r = await d.run({
      apiKey, task: "audio", models, system: AUDIO_SYSTEM, parts,
      spec: { levels: ["minimal", "low"], budget: 0 }, maxOut: 60000,
      firstMs: Math.round(Math.min(300000, 60000 + secs * 100)), idleMs: 90000,
      noHedge: true, signal,
      onText: (full) => onStatus(`بيفرّغ الصوت… (${String(full || "").length} حرف)`),
    });
    return r && typeof r === "object" ? r.text : r;
  };

  const attempt = async (blob, mime, via) => {
    let parts = await partsFor(blob, mime);
    let raw;
    try { raw = await call(parts); }
    catch (e) {
      if (e && e.name === "AbortError") throw e;
      if (uploaded && looksLikeFileError(e)) {      // Google cannot use the link (another key, expired): once more, inline when it fits, otherwise a fresh upload
        parts = blob.size <= INLINE_MAX ? [{ inlineData: { mimeType: mime, data: await readB64(blob) } }, { text: AUDIO_USER }] : await partsFor(blob, mime);
        raw = await call(parts);
      } else throw e;
    }
    return { raw, via };
  };

  const native = mimeFor(file);
  let res;
  if (native) {
    try { res = await attempt(file, native, "native"); }
    catch (e) {
      if (!(e && e.name !== "AbortError" && looksLikeFormatError(e))) throw e;
      onStatus("بيجهّز الصوت بصيغة تانية…");
      res = await attempt(await d.toWav(file), "audio/wav", "wav");
    }
  } else {
    onStatus("بيجهّز الصوت…");
    res = await attempt(await d.toWav(file), "audio/wav", "wav");
  }

  const text = cleanTranscript(res.raw);
  if (!hasSpeech(text)) throw new Error("مفيش كلام مسموع في الملف الصوتي ده (أو الصوت مش واضح). التطبيق بيفرّغ الكلام بس، مش الأصوات زي نبض القلب أو الموسيقى.");
  const rec = { text, via: res.via, at: Date.now() };
  await d.cache.set(fp, rec);
  return { text, cached: false, via: res.via };
}
