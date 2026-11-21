/* v3.42 · a recording is shrunk (16 kHz mono Opus) BEFORE the upload, because the upload is the slow part (23 MB = 160 s on ~1.1 Mbit/s).
   Pinned here: the Ogg writer is valid; mp3 / wav / m4a are cut on safe boundaries; the pipeline is bounded and never throws at the student;
   the transcription sends the packed file, falls back to the original when Google refuses it, and a file that is not clearly smaller is sent as is. */
import test from "node:test";
import assert from "node:assert/strict";
import * as P from "../src/lib/audiopack.js";
import * as A from "../src/lib/audio.js";

const MB = 1048576;
const TRANSCRIPT = "the nurse checks the aPTT, the therapeutic range is sixty to eighty seconds, and the dose is adjusted by the protocol.";

/* ogg: every page's CRC checks out, the granule of the last page is trimmed to the real length */
const crcOf = (u8) => { const t = []; for (let i = 0; i < 256; i++) { let r = i << 24; for (let k = 0; k < 8; k++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1; t[i] = r >>> 0; } let c = 0; for (const b of u8) c = ((c << 8) ^ t[((c >>> 24) & 255) ^ b]) >>> 0; return c; };
const pagesOf = (u8) => { const out = []; let p = 0; while (p < u8.length) { const n = u8[p + 26], len = 27 + n + u8.subarray(p + 27, p + 27 + n).reduce((a, b) => a + b, 0); out.push(u8.subarray(p, p + len)); p += len; } return out; };
test("Ogg Opus writer: valid pages (CRC), header + tags first, last page flagged and trimmed", async () => {
  const pk = Array.from({ length: 120 }, (_, i) => new Uint8Array([0x78, i, 1, 2, 3]));        // 0x78 = CELT 20 ms (960 samples at 48 kHz), code 0
  assert.equal(P.opusSamples48k(pk[0]), 960);
  const blob = P.oggOpusFile(pk, { inputSamples: 16000 * 2 });                                  // 2 s of input
  const pages = pagesOf(new Uint8Array(await blob.arrayBuffer()));
  assert.equal(pages.length, 2 + 3, "head + tags + 120 packets in pages of ≤ 50");
  for (const g of pages) { const c = new Uint8Array(g); const dv = new DataView(c.buffer); const want = dv.getUint32(22, true); dv.setUint32(22, 0, true); assert.equal(crcOf(c), want); }
  assert.equal(String.fromCharCode(...pages[0].subarray(0, 4)), "OggS");
  assert.equal(String.fromCharCode(...pages[0].subarray(28, 36)), "OpusHead");
  assert.equal(pages[0][5], 2, "first page is BOS");
  const last = pages.at(-1), dv = new DataView(last.buffer, last.byteOffset);
  assert.equal(last[5], 4, "last page is EOS");
  assert.equal(dv.getUint32(6, true), 312 + 2 * 48000, "granule = pre-skip + the real length, the encoder padding is cut");
});
test("opus packet length comes from the TOC byte (frame size and frame count)", () => {
  assert.equal(P.opusSamples48k(new Uint8Array([0x00])), 480);          // SILK 10 ms
  assert.equal(P.opusSamples48k(new Uint8Array([0x08])), 960);          // SILK 20 ms
  assert.equal(P.opusSamples48k(new Uint8Array([0x79])), 1920);         // CELT 20 ms, two frames
  assert.equal(P.opusSamples48k(new Uint8Array([0x7b, 3])), 2880);      // code 3, three frames
});

/* mp3: frames of MPEG-1 Layer III 128 kbps 44.1 kHz = 417 / 418 bytes */
const fakeMp3 = (frames, id3 = true) => {
  const out = []; if (id3) out.push(new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 20, ...new Array(20).fill(0)]));
  for (let i = 0; i < frames; i++) { const len = 417 + (i % 2 === 0 ? 0 : 0); const f = new Uint8Array(len); f.set([0xff, 0xfb, 0x90, 0x00], 0); f.fill(i & 127, 4); out.push(f); }
  return Buffer.concat(out);
};
test("mp3 is cut on frame boundaries only, skipping the ID3 tag; nothing is lost or repeated", () => {
  const m = fakeMp3(500), r = P.mp3Ranges(new Uint8Array(m), { pieceBytes: 20000, pieceSecs: 999 });
  assert.ok(r.length >= 10);
  assert.equal(r[0][0], 30, "starts after the ID3 tag");
  for (let i = 1; i < r.length; i++) assert.equal(r[i][0], r[i - 1][1], "pieces touch exactly");
  for (const [a] of r) assert.deepEqual([...m.subarray(a, a + 2)], [0xff, 0xfb], "every piece starts on a frame header");
  assert.equal(r.at(-1)[1], m.length);
  assert.equal(P.mp3Ranges(new Uint8Array(1000), {}), null, "not an mp3 → null");
});
test("wav is cut into pieces that each carry a valid header", () => {
  const n = 16000 * 2 * 50, u = new Uint8Array(44 + n), dv = new DataView(u.buffer);
  u.set([0x52, 0x49, 0x46, 0x46], 0); dv.setUint32(4, 36 + n, true); u.set([0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20], 8); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, 16000, true); dv.setUint32(28, 32000, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); u.set([0x64, 0x61, 0x74, 0x61], 36); dv.setUint32(40, n, true);
  const p = P.wavPieces(u, { pieceSecs: 20 });
  assert.equal(p.length, 3);
  assert.equal(new DataView(p[0].head.buffer).getUint32(40, true), 16000 * 2 * 20);
  assert.equal(p.reduce((s, x) => s + x.to - x.from, 0), n, "every sample is in exactly one piece");
  assert.equal(P.wavPieces(new Uint8Array(100), {}), null);
});
test("m4a: ADTS header carries the right profile / rate / channels / length", () => {
  const h = P.adtsHeader(100, { profile: 1, fi: 4, ch: 1 });
  assert.deepEqual([h[0], h[1] & 0xf0], [0xff, 0xf0]);
  assert.equal(h[2] >> 6, 1); assert.equal((h[2] >> 2) & 15, 4);
  assert.equal(((h[3] & 3) << 11) | (h[4] << 3) | (h[5] >> 5), 107);
});

/* the pipeline with a fake encoder / decoder */
const fakeEnv = (over = {}) => {
  const stats = { fed: 0, closed: 0 };
  class Enc {
    static async isConfigSupported(c) { return { supported: true, config: c }; }
    constructor(o) { this.o = o; this.q = 0; this.encodeQueueSize = 0; }
    configure(c) { stats.cfg = c; }
    encode(ad) { stats.fed += ad.numberOfFrames; for (let i = 0; i < Math.ceil(ad.numberOfFrames / 320); i++) { const b = new Uint8Array([0x78, 9, 9, 9]); this.o.output({ byteLength: 4, copyTo: (u) => u.set(b) }, {}); } }
    async flush() {} close() { stats.closed++; }
  }
  class Data { constructor(o) { Object.assign(this, o); } close() {} }
  const ctx = () => ({ decodeAudioData: async (ab) => { const n = 16000 * 30; return { sampleRate: 16000, numberOfChannels: 2, length: n, getChannelData: () => new Float32Array(n) }; }, close() { stats.ctxClosed = true; } });
  return { stats, deps: { Enc, Data, ctx, ...over } };
};
const bigMp3 = (mb) => new File([fakeMp3(Math.round((mb * MB) / 417))], "lecture.mp3", { type: "audio/mpeg" });
test("packAudio: pieces are decoded one by one, fed as 16 kHz mono, and the result is a smaller Ogg", async () => {
  const f = bigMp3(8), { stats, deps } = fakeEnv(), msgs = [];
  const r = await P.packAudio(f, { deps, onStatus: (m) => msgs.push(m) });
  assert.ok(r && r.blob.type === "audio/ogg" && r.after < r.before * 0.75, "smaller");
  assert.equal(stats.cfg.sampleRate, 16000); assert.equal(stats.cfg.numberOfChannels, 1); assert.equal(stats.cfg.bitrate, 32000);
  assert.ok(stats.fed > 16000 * 30 && stats.closed === 1 && stats.ctxClosed);
  assert.ok(msgs.length > 1 && /%/.test(msgs[0]), "progress is reported");
});
test("packAudio returns null (= send the original) for: small file, no WebCodecs, unsupported config, decode failure, already-compact result, odd format", async () => {
  assert.equal(await P.packAudio(new File([new Uint8Array(1 * MB)], "a.mp3"), { deps: fakeEnv().deps }), null, "small");
  assert.equal(await P.packAudio(bigMp3(8), { deps: { Enc: undefined, Data: undefined } }), null, "no WebCodecs");
  const e1 = fakeEnv(); e1.deps.Enc.isConfigSupported = async () => ({ supported: false });
  assert.equal(await P.packAudio(bigMp3(8), { deps: e1.deps }), null, "unsupported");
  const e2 = fakeEnv({ ctx: () => ({ decodeAudioData: async () => { throw new Error("bad"); }, close() {} }) });
  assert.equal(await P.packAudio(bigMp3(8), { deps: e2.deps }), null, "a piece that cannot be decoded: no half transcript, the original goes");
  assert.equal(await P.packAudio(new File([new Uint8Array(8 * MB)], "voice.ogg"), { deps: fakeEnv().deps }), null, "ogg is already compact");
  assert.equal(await P.packAudio(new File([new Uint8Array(30 * MB)], "x.flac"), { deps: fakeEnv().deps }), null, "cannot be cut and too big to decode whole");
  const e3 = fakeEnv(); e3.deps.Enc.prototype.encode = function (ad) { for (let i = 0; i < 4000; i++) this.o.output({ byteLength: 400, copyTo: (u) => u.fill(0x78) }, {}); };
  assert.equal(await P.packAudio(bigMp3(4), { deps: e3.deps }), null, "not clearly smaller");
});
test("packAudio: the student's cancel is the only thing that throws", async () => {
  const ac = new AbortController(); ac.abort();
  await assert.rejects(P.packAudio(bigMp3(8), { deps: fakeEnv().deps, signal: ac.signal }), { name: "AbortError" });
});

/* the transcription */
const LISTS = () => ({ fast: ["gemini-flash-latest"], pro: [] });
const mk = (packed, over = {}) => {
  const calls = { run: [], upload: [] }, cache = new Map();
  return { calls, deps: {
    cache: { get: async (k) => cache.get(k) || null, set: async (k, v) => { cache.set(k, v); } }, lists: LISTS, uploads: true,
    pack: async () => packed,
    run: async (a) => { calls.run.push(a); return { text: TRANSCRIPT }; },
    upload: async (a) => { calls.upload.push(a); a.onProgress && a.onProgress(a.blob.size, a.blob.size); return { fileUri: "https://g/files/x", mimeType: a.mimeType }; },
    toWav: async () => new Blob([new Uint8Array(2048)], { type: "audio/wav" }), ...over } };
};
const orig = () => new File([new Uint8Array(5 * MB).map((_, i) => i & 255)], "lecture.mp3", { type: "audio/mpeg" });
test("the PACKED file is what gets uploaded, with progress and a patient wait for Google to process it", async () => {
  const blob = new Blob([new Uint8Array(900000)], { type: "audio/ogg" }), { calls, deps } = mk({ blob, before: 5 * MB, after: 900000 }), msgs = [];
  const r = await A.transcribeAudio(orig(), { apiKey: "AIzaPACK000001", deps, onStatus: (m) => msgs.push(m) });
  assert.equal(r.via, "packed"); assert.equal(calls.upload.length, 1);
  assert.equal(calls.upload[0].blob, blob); assert.equal(calls.upload[0].mimeType, "audio/ogg"); assert.equal(calls.upload[0].activeWaitMs, 90000);
  assert.ok(msgs.some((m) => /100%/.test(m)) && msgs.some((m) => /اتصغّر/.test(m)));
});
test("no packing available → the original goes exactly as before", async () => {
  const f = orig(), { calls, deps } = mk(null);
  const r = await A.transcribeAudio(f, { apiKey: "AIzaPACK000002", deps });
  assert.equal(r.via, "native"); assert.equal(calls.upload[0].blob, f); assert.equal(calls.upload[0].mimeType, "audio/mp3");
});
test("Google refuses the packed format → the original is sent; a quota error is NOT mistaken for a format error", async () => {
  const blob = new Blob([new Uint8Array(900000)]), f = orig();
  let n = 0;
  const m1 = mk({ blob }, { run: async (a) => { if (++n === 1) throw Object.assign(new Error("Unsupported MIME type: audio/ogg"), { status: 400 }); return { text: TRANSCRIPT }; } });
  const r = await A.transcribeAudio(f, { apiKey: "AIzaPACK000003", deps: m1.deps });
  assert.equal(r.via, "native"); assert.equal(m1.deps && n, 2);
  const m2 = mk({ blob }, { run: async () => { throw Object.assign(new Error("quota exceeded, rate limit"), { status: 429 }); } });
  await assert.rejects(A.transcribeAudio(orig(), { apiKey: "AIzaPACK000004", deps: m2.deps }), /quota/);
});
