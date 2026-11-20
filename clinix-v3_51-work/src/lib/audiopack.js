/* ───────────── Shrink a recording BEFORE it is uploaded (v3.42) ─────────────
   The upload is the slow part, not Google: a 23 MB recording took 160 s on a ~1.1 Mbit/s uplink (typical ADSL / mobile in Egypt).
   Gemini turns every recording into 16 kHz mono speech anyway and charges 32 tokens per SECOND whatever the file size, so the extra bytes
   (stereo, 44.1 kHz, 128-320 kbps) are pure upload time: they carry nothing the model uses.

   So the file is re-encoded here, on the phone, to what speech needs: 16 kHz mono Opus at 32 kbps (wideband voice, Opus's "voip/voice" tuning),
   inside an Ogg file.  23 MB (≈ 24 min at 128 kbps) → about 5.5 MB: the same upload takes ~4× less.

   How it stays safe for the words (a nursing student's drug names and doses must survive):
   • 32 kbps wideband Opus is transparent for speech; the model would have downsampled to 16 kHz mono itself;
   • memory is bounded: the recording is decoded in pieces of ≤ 4 minutes (mp3 / wav / m4a are cut on frame boundaries), never all at once;
   • anything unusual (a format that cannot be cut, no WebCodecs, a piece that fails to decode, a result that is not clearly smaller) → `null`,
     and the caller uploads the ORIGINAL file exactly as before.  This module never throws a problem at the student.
   Needs WebCodecs `AudioEncoder` (Chrome / Android WebView / Edge / Electron; Safari 26+).  Without it nothing changes.
   Everything that touches the browser is injectable (`deps`), and the pure parts (Ogg writer, mp3 / wav / mp4 cutters) are exported and tested. */

const RATE = 16000;
export const PACK = {
  bitrate: 32000,                 // bits per second of the packed speech
  minBytes: 3 * 1024 * 1024,      // below this the upload is quick anyway (≈ 20 s at 1.1 Mbit/s): do not spend CPU
  maxBytes: 100 * 1024 * 1024,    // reading it for cutting must fit in memory
  pieceSecs: 240,                 // one decoded piece (bounds memory: 4 min of 44.1 kHz stereo ≈ 85 MB as float)
  pieceBytes: 3 * 1024 * 1024,
  wholeMax: 12 * 1024 * 1024,     // formats that cannot be cut (flac, aiff …) are decoded whole only up to this size
  minGain: 0.75,                  // the packed file must be at most 75 % of the original, else the original is sent
};

const ext = (n) => ((n || "").split(".").pop() || "").toLowerCase();
const abortError = () => Object.assign(new Error("abort"), { name: "AbortError" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── Ogg / Opus writer ── */
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) { let r = i << 24; for (let k = 0; k < 8; k++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1; t[i] = r >>> 0; }
  return t;
})();
const crc32 = (u8) => { let c = 0; for (let i = 0; i < u8.length; i++) c = ((c << 8) ^ CRC[((c >>> 24) & 0xff) ^ u8[i]]) >>> 0; return c >>> 0; };

/* samples (at 48 kHz, the unit Ogg Opus counts in) inside one Opus packet, from its TOC byte */
export function opusSamples48k(p) {
  if (!p || !p.length) return 0;
  const toc = p[0], cfg = toc >> 3, code = toc & 3;
  const ms = cfg < 12 ? [10, 20, 40, 60][cfg & 3] : cfg < 16 ? [10, 20][cfg & 1] : [2.5, 5, 10, 20][cfg & 3];
  const frames = code === 0 ? 1 : code === 3 ? (p[1] || 1) & 0x3f : 2;
  return Math.round(frames * ms * 48);
}

export function oggPage({ serial, seq, granule, flags, packets }) {
  const segs = [];
  for (const p of packets) { for (let n = p.length; n >= 255; n -= 255) segs.push(255); segs.push(p.length % 255); }
  if (segs.length > 255) throw new Error("ogg: too many segments");
  const dataLen = packets.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(27 + segs.length + dataLen), dv = new DataView(out.buffer);
  out.set([0x4f, 0x67, 0x67, 0x53, 0, flags], 0);                       // "OggS", version 0, header-type flags
  dv.setUint32(6, granule % 4294967296, true); dv.setUint32(10, Math.floor(granule / 4294967296), true);
  dv.setUint32(14, serial >>> 0, true); dv.setUint32(18, seq, true);
  out[26] = segs.length; out.set(segs, 27);
  let o = 27 + segs.length;
  for (const p of packets) { out.set(p, o); o += p.length; }
  dv.setUint32(22, crc32(out), true);
  return out;
}

export function opusHead(preSkip, inputRate = RATE, channels = 1) {
  const h = new Uint8Array(19), dv = new DataView(h.buffer);
  h.set([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64], 0);           // "OpusHead"
  h[8] = 1; h[9] = channels; dv.setUint16(10, preSkip, true); dv.setUint32(12, inputRate, true); dv.setInt16(16, 0, true); h[18] = 0;
  return h;
}

/* packets (Uint8Array[]) → one Ogg Opus file.  `inputSamples` (at 16 kHz) trims the encoder's padding off the end. */
export function oggOpusFile(packets, { head, inputSamples, serial = (Math.random() * 4294967295) >>> 0 } = {}) {
  const h = head && head.length >= 19 ? head : opusHead(312);
  const preSkip = new DataView(h.buffer, h.byteOffset, h.byteLength).getUint16(10, true);
  const tags = new Uint8Array(8 + 4 + 6 + 4), tv = new DataView(tags.buffer);
  tags.set([0x4f, 0x70, 0x75, 0x73, 0x54, 0x61, 0x67, 0x73], 0); tv.setUint32(8, 6, true); tags.set([0x63, 0x6c, 0x69, 0x6e, 0x69, 0x78], 12); tv.setUint32(18, 0, true);
  const pages = [oggPage({ serial, seq: 0, granule: 0, flags: 2, packets: [h] }), oggPage({ serial, seq: 1, granule: 0, flags: 0, packets: [tags] })];
  const total = packets.reduce((n, p) => n + opusSamples48k(p), 0);
  const end = Number.isFinite(inputSamples) ? Math.min(total, preSkip + Math.round(inputSamples * 3)) : total;   // 48000 / 16000 = 3
  let seq = 2, cum = 0;
  for (let i = 0; i < packets.length; i += 50) {
    const group = packets.slice(i, i + 50), last = i + 50 >= packets.length;
    for (const p of group) cum += opusSamples48k(p);
    pages.push(oggPage({ serial, seq: seq++, granule: last ? end : cum, flags: last ? 4 : 0, packets: group }));
  }
  return new Blob(pages, { type: "audio/ogg" });
}

/* ── cutters: where a recording may be split so each piece decodes on its own ── */

/* MP3 → [[from, to], …] byte ranges on frame boundaries (Layer II / III; null when nothing sensible is found) */
const MP3_BR = {
  "1-3": [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  "1-2": [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  "2-3": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  "2-2": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const MP3_SR = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
function mp3Header(u8, i) {
  if (i + 4 > u8.length || u8[i] !== 0xff || (u8[i + 1] & 0xe0) !== 0xe0) return null;
  const ver = (u8[i + 1] >> 3) & 3, layer = (u8[i + 1] >> 1) & 3, bi = u8[i + 2] >> 4, si = (u8[i + 2] >> 2) & 3, pad = (u8[i + 2] >> 1) & 1;
  if (ver === 1 || layer === 0 || layer === 3 || bi === 0 || bi === 15 || si === 3) return null;   // layer bits 3 = Layer I: not handled
  const L = layer === 1 ? 3 : 2, tbl = MP3_BR[`${ver === 3 ? 1 : 2}-${L}`], sr = MP3_SR[ver][si], br = tbl[bi] * 1000;
  const coef = L === 3 && ver !== 3 ? 72 : 144, len = Math.floor((coef * br) / sr) + pad;
  return { len, secs: (L === 3 && ver !== 3 ? 576 : 1152) / sr };
}
export function mp3Ranges(u8, { pieceBytes = PACK.pieceBytes, pieceSecs = PACK.pieceSecs } = {}) {
  let pos = 0;
  if (u8.length > 10 && u8[0] === 0x49 && u8[1] === 0x44 && u8[2] === 0x33) pos = 10 + ((u8[6] << 21) | (u8[7] << 14) | (u8[8] << 7) | u8[9]);
  const ranges = []; let from = -1, secs = 0, frames = 0, last = -1;
  while (pos + 4 <= u8.length) {
    const h = mp3Header(u8, pos);
    const ok = h && (pos + h.len === u8.length || pos + h.len > u8.length || mp3Header(u8, pos + h.len));
    if (!ok) { pos++; continue; }
    if (from < 0) from = pos;
    else if (pos - from >= pieceBytes || secs >= pieceSecs) { ranges.push([from, pos]); from = pos; secs = 0; }
    secs += h.secs; frames++; last = Math.min(u8.length, pos + h.len); pos += h.len;
  }
  if (from >= 0 && last > from) ranges.push([from, last]);
  return frames >= 10 ? ranges : null;
}

/* WAV → [{ head, from, to }] pieces of the PCM data, each needing its own 44-byte header (null when the header is not plain RIFF/WAVE) */
export function wavPieces(u8, { pieceSecs = PACK.pieceSecs } = {}) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), tag = (o) => String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);
  if (u8.length < 44 || tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
  let o = 12, fmt = null, data = null;
  while (o + 8 <= u8.length) {
    const id = tag(o), size = dv.getUint32(o + 4, true);
    if (id === "fmt ") fmt = { code: dv.getUint16(o + 8, true), ch: dv.getUint16(o + 10, true), rate: dv.getUint32(o + 12, true), align: dv.getUint16(o + 20, true), bits: dv.getUint16(o + 22, true) };
    if (id === "data") { data = { from: o + 8, to: Math.min(u8.length, o + 8 + size) }; break; }
    o += 8 + size + (size & 1);
  }
  if (!fmt || !data || !fmt.align || !fmt.rate || ![1, 3].includes(fmt.code)) return null;     // plain PCM / float only
  const step = Math.max(fmt.align, Math.floor(pieceSecs * fmt.rate) * fmt.align), out = [];
  for (let a = data.from; a < data.to; a += step) {
    const b = Math.min(data.to, a + step), n = b - a, h = new Uint8Array(44), hv = new DataView(h.buffer);
    h.set([0x52, 0x49, 0x46, 0x46], 0); hv.setUint32(4, 36 + n, true); h.set([0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20], 8);
    hv.setUint32(16, 16, true); hv.setUint16(20, fmt.code, true); hv.setUint16(22, fmt.ch, true); hv.setUint32(24, fmt.rate, true);
    hv.setUint32(28, fmt.rate * fmt.align, true); hv.setUint16(32, fmt.align, true); hv.setUint16(34, fmt.bits, true);
    h.set([0x64, 0x61, 0x74, 0x61], 36); hv.setUint32(40, n, true);
    out.push({ head: h, from: a, to: b });
  }
  return out.length ? out : null;
}

/* M4A / MP4 (AAC-LC, not fragmented) → { frames: [{ off, size }], rate, ch, profile } read from the moov box; null for anything else */
const FREQ = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
const u32 = (u, o) => ((u[o] << 24) | (u[o + 1] << 16) | (u[o + 2] << 8) | u[o + 3]) >>> 0;
const fourcc = (u, o) => String.fromCharCode(u[o], u[o + 1], u[o + 2], u[o + 3]);
function* boxes(u, from, to) {
  let o = from;
  while (o + 8 <= to) {
    let size = u32(u, o), hdr = 8;
    if (size === 1) { size = u32(u, o + 8) * 4294967296 + u32(u, o + 12); hdr = 16; } else if (size === 0) size = to - o;
    if (size < hdr || o + size > to) return;
    yield { type: fourcc(u, o + 4), s: o + hdr, e: o + size };
    o += size;
  }
}
const child = (u, b, type) => { for (const c of boxes(u, b.s, b.e)) if (c.type === type) return c; return null; };
function ascFromEsds(u, from, to) {
  let o = from + 4;                                    // version + flags
  const len = () => { let n = 0; for (let k = 0; k < 4 && o < to; k++) { const b = u[o++]; n = (n << 7) | (b & 0x7f); if (!(b & 0x80)) break; } return n; };
  while (o < to) {
    const tag = u[o++], n = len();
    if (tag === 3) { const fl = u[o + 2]; o += 3 + (fl & 0x80 ? 2 : 0) + (fl & 0x40 ? 1 + u[o + 3 + (fl & 0x80 ? 2 : 0)] : 0) + (fl & 0x20 ? 2 : 0); }
    else if (tag === 4) o += 13;
    else if (tag === 5) return u.subarray(o, o + n);
    else o += n;
  }
  return null;
}
export function parseMoov(u) {
  for (const top of boxes(u, 0, u.length)) {
    if (top.type !== "moov") continue;
    for (const trak of boxes(u, top.s, top.e)) {
      if (trak.type !== "trak") continue;
      const mdia = child(u, trak, "mdia"); if (!mdia) continue;
      const hdlr = child(u, mdia, "hdlr"); if (!hdlr || fourcc(u, hdlr.s + 8) !== "soun") continue;
      const minf = child(u, mdia, "minf"), stbl = minf && child(u, minf, "stbl"); if (!stbl) return null;
      const stsd = child(u, stbl, "stsd"), stsz = child(u, stbl, "stsz"), stsc = child(u, stbl, "stsc"), stco = child(u, stbl, "stco") || child(u, stbl, "co64");
      if (!stsd || !stsz || !stsc || !stco) return null;
      const mp4a = [...boxes(u, stsd.s + 8, stsd.e)].find((b) => b.type === "mp4a"); if (!mp4a) return null;
      let esds = -1; for (let i = mp4a.s + 20; i + 4 < mp4a.e; i++) if (fourcc(u, i) === "esds") { esds = i + 4; break; }
      const asc = esds > 0 ? ascFromEsds(u, esds, mp4a.e) : null; if (!asc || asc.length < 2) return null;
      const aot = asc[0] >> 3, fi = ((asc[0] & 7) << 1) | (asc[1] >> 7), ch = (asc[1] >> 3) & 15;
      if (aot < 1 || aot > 4 || fi > 12 || ch < 1 || ch > 7) return null;       // AAC-LC & friends only (HE-AAC / unknown → not cut)
      const fixed = u32(u, stsz.s + 4), n = u32(u, stsz.s + 8), sizes = new Uint32Array(n);
      for (let i = 0; i < n; i++) sizes[i] = fixed || u32(u, stsz.s + 12 + i * 4);
      const runs = [], rc = u32(u, stsc.s + 4);
      for (let i = 0; i < rc; i++) runs.push([u32(u, stsc.s + 8 + i * 12), u32(u, stsc.s + 12 + i * 12)]);
      const cc = u32(u, stco.s + 4), wide = stco.type === "co64", frames = [];
      let k = 0;
      for (let c = 0; c < cc && k < n; c++) {
        let per = runs[0][1]; for (const r of runs) if (r[0] <= c + 1) per = r[1];
        let off = wide ? u32(u, stco.s + 8 + c * 8) * 4294967296 + u32(u, stco.s + 12 + c * 8) : u32(u, stco.s + 8 + c * 4);
        for (let j = 0; j < per && k < n; j++, k++) { frames.push({ off, size: sizes[k] }); off += sizes[k]; }
      }
      return frames.length === n && n > 0 ? { frames, rate: FREQ[fi], ch, profile: aot - 1, fi } : null;
    }
  }
  return null;
}
export const adtsHeader = (size, { profile, fi, ch }) => {
  const L = size + 7;
  return new Uint8Array([0xff, 0xf1, (profile << 6) | (fi << 2) | ((ch >> 2) & 1), ((ch & 3) << 6) | ((L >> 11) & 3), (L >> 3) & 0xff, ((L & 7) << 5) | 0x1f, 0xfc]);
};
async function readMoov(file) {                       // top-level boxes are walked by their headers only: mdat (the audio) is never read here
  let pos = 0;
  while (pos + 8 <= file.size) {
    const h = new Uint8Array(await file.slice(pos, pos + 16).arrayBuffer());
    let size = u32(h, 0); const type = fourcc(h, 4);
    if (size === 1) size = u32(h, 8) * 4294967296 + u32(h, 12); else if (size === 0) size = file.size - pos;
    if (type === "moof") return null;                 // fragmented
    if (size < 8) return null;
    if (type === "moov") return size > 64 * 1024 * 1024 ? null : new Uint8Array(await file.slice(pos, pos + size).arrayBuffer());
    pos += size;
  }
  return null;
}

/* ── the decoding side ── */
function resample(data, from, to) {
  if (from === to) return data;
  const n = Math.max(1, Math.round((data.length * to) / from)), out = new Float32Array(n), k = from / to;
  for (let i = 0; i < n; i++) { const p = i * k, i0 = Math.floor(p), i1 = Math.min(data.length - 1, i0 + 1), f = p - i0; out[i] = data[i0] * (1 - f) + data[i1] * f; }
  return out;
}
const defaultCtx = () => {
  const AC = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
  if (!AC) return null;
  try { return new AC({ sampleRate: RATE }); } catch (e) { try { return new AC(); } catch (e2) { return null; } }
};
const decode = (ctx, ab) => new Promise((res, rej) => { try { const p = ctx.decodeAudioData(ab, res, rej); if (p && p.then) p.then(res, rej); } catch (e) { rej(e); } });
const toMono16k = (buf) => {
  const n = buf.length, ch = buf.numberOfChannels, mono = new Float32Array(n);
  for (let c = 0; c < ch; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) mono[i] += d[i] / ch; }
  return resample(mono, buf.sampleRate, RATE);
};

/* the pieces (lazy: each is read only when it is decoded) → [{ read: async () => ArrayBuffer }] or null when the file cannot be handled */
async function plan(file) {
  const e = ext(file.name), t = String(file.type || "").toLowerCase(), whole = [{ read: () => file.arrayBuffer() }];
  if (e === "mp3" || e === "mpga" || t === "audio/mpeg" || t === "audio/mp3") {
    const r = mp3Ranges(new Uint8Array(await file.arrayBuffer()));
    return r ? r.map(([a, b]) => ({ read: () => file.slice(a, b).arrayBuffer() })) : file.size <= PACK.wholeMax ? whole : null;
  }
  if (e === "wav" || e === "wave" || t === "audio/wav" || t === "audio/x-wav" || t === "audio/wave") {
    const u8 = new Uint8Array(await file.arrayBuffer()), p = wavPieces(u8);
    return p ? p.map(({ head, from, to }) => ({ read: async () => { const o = new Uint8Array(44 + to - from); o.set(head, 0); o.set(u8.subarray(from, to), 44); return o.buffer; } })) : file.size <= PACK.wholeMax ? whole : null;
  }
  if (e === "m4a" || e === "mp4" || e === "m4b" || t === "audio/mp4" || t === "audio/x-m4a" || t === "audio/m4a") {
    const moov = await readMoov(file), m = moov && parseMoov(moov);
    if (!m) return file.size <= PACK.wholeMax ? whole : null;
    const per = Math.max(1, Math.round((PACK.pieceSecs * m.rate) / 1024)), out = [];
    for (let i = 0; i < m.frames.length; i += per) {
      const fr = m.frames.slice(i, i + per), lo = fr[0].off, hi = fr[fr.length - 1].off + fr[fr.length - 1].size;
      out.push({ read: async () => {
        const src = new Uint8Array(await file.slice(lo, hi).arrayBuffer());
        let size = 0; for (const f of fr) size += f.size + 7;
        const o = new Uint8Array(size); let p = 0;
        for (const f of fr) { o.set(adtsHeader(f.size, m), p); p += 7; o.set(src.subarray(f.off - lo, f.off - lo + f.size), p); p += f.size; }
        return o.buffer;
      } });
    }
    return out;
  }
  if (["ogg", "oga", "opus", "weba", "webm", "amr", "3gp", "3ga", "wma", "caf"].includes(e)) return null;   // already compact, or not something this can cut
  return file.size <= PACK.wholeMax ? whole : null;                       // flac / aiff / unknown: only when small enough to decode whole
}

/* the recording → { blob, before, after, secs } as 16 kHz mono Ogg Opus; null = "send the original" (never throws, except for the student's own cancel) */
export async function packAudio(file, { signal, onStatus = () => {}, deps = {} } = {}) {
  const d = { Enc: globalThis.AudioEncoder, Data: globalThis.AudioData, ctx: defaultCtx, ...deps };
  try {
    if (!d.Enc || !d.Data || !file || file.size < PACK.minBytes || file.size > PACK.maxBytes) return null;
    const cfg = { codec: "opus", sampleRate: RATE, numberOfChannels: 1, bitrate: PACK.bitrate };
    let use = { ...cfg, opus: { application: "voip", signal: "voice", complexity: 5 } };
    if (d.Enc.isConfigSupported) {
      let s = await d.Enc.isConfigSupported(use).catch(() => null);
      if (!s || !s.supported) { use = cfg; s = await d.Enc.isConfigSupported(use).catch(() => null); }
      if (!s || !s.supported) return null;
    }
    const pieces = await plan(file);
    if (!pieces || !pieces.length) return null;
    const ctx = d.ctx();
    if (!ctx) return null;

    const packets = []; let head = null, failed = null, samples = 0;
    const enc = new d.Enc({
      output: (chunk, meta) => {
        const u = new Uint8Array(chunk.byteLength); chunk.copyTo(u); packets.push(u);
        const desc = meta && meta.decoderConfig && meta.decoderConfig.description;
        if (!head && desc) { const b = desc instanceof ArrayBuffer ? new Uint8Array(desc) : new Uint8Array(desc.buffer, desc.byteOffset, desc.byteLength); if (b.length >= 19 && b[0] === 0x4f) head = new Uint8Array(b); }
      },
      error: (e) => { failed = e || new Error("encoder"); },
    });
    enc.configure(use);
    try {
      for (let i = 0; i < pieces.length; i++) {
        if (signal && signal.aborted) throw abortError();
        onStatus(`بيصغّر الصوت قبل الرفع عشان يترفع أسرع… ${Math.round((i / pieces.length) * 100)}%`);
        const mono = toMono16k(await decode(ctx, await pieces[i].read()));
        for (let o = 0; o < mono.length; o += RATE) {
          if (failed) throw failed;
          while (enc.encodeQueueSize > 40) { await sleep(4); if (failed) throw failed; }
          const block = mono.subarray(o, Math.min(mono.length, o + RATE));
          const ad = new d.Data({ format: "f32", sampleRate: RATE, numberOfFrames: block.length, numberOfChannels: 1, timestamp: Math.round(((samples + o) * 1e6) / RATE), data: block });
          enc.encode(ad); ad.close();
        }
        samples += mono.length;
      }
      await enc.flush();
    } finally { try { enc.close(); } catch (e) { /* ignore */ } try { ctx.close(); } catch (e) { /* ignore */ } }
    if (failed || !packets.length) return null;

    const blob = oggOpusFile(packets, { head, inputSamples: samples });
    if (blob.size > file.size * PACK.minGain) return null;                // not clearly smaller (the original was already compact)
    return { blob, before: file.size, after: blob.size, secs: Math.round(samples / RATE) };
  } catch (e) {
    if (e && e.name === "AbortError") throw e;
    return null;
  }
}
