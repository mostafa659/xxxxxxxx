/* v3.41 · which files are recordings. A tiny module with no imports on purpose: docs.js (used by every screen) can ask "is this audio?"
   without loading the transcription engine; the engine (audio.js) is only fetched when a recording is really added. */
const ext = (n) => ((n || "").split(".").pop() || "").toLowerCase();

/* extension → the MIME type Google accepts for it. `null` = Google does not list that format: such a file goes through the browser's WAV conversion at once.
   (m4a is AAC audio in an MP4 box: it travels as audio/aac, the listed type; if Google still refuses it, the WAV conversion catches it.) */
export const AUDIO_MIME = {
  mp3: "audio/mp3", mpga: "audio/mp3", wav: "audio/wav", wave: "audio/wav", aac: "audio/aac", m4a: "audio/aac",
  ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg", flac: "audio/flac", aif: "audio/aiff", aiff: "audio/aiff",
  weba: null, webm: null, amr: null, wma: null, "3gp": null, "3ga": null, caf: null,
};
export const TYPE_MIME = {
  "audio/mpeg": "audio/mp3", "audio/mp3": "audio/mp3", "audio/wav": "audio/wav", "audio/x-wav": "audio/wav", "audio/wave": "audio/wav",
  "audio/aac": "audio/aac", "audio/mp4": "audio/aac", "audio/x-m4a": "audio/aac", "audio/m4a": "audio/aac",
  "audio/ogg": "audio/ogg", "audio/opus": "audio/ogg", "audio/flac": "audio/flac", "audio/x-flac": "audio/flac",
  "audio/aiff": "audio/aiff", "audio/x-aiff": "audio/aiff",
};

export const isAudioFile = (f) => !!f && ((f.type || "").startsWith("audio/") || Object.prototype.hasOwnProperty.call(AUDIO_MIME, ext(f.name)));

/* the MIME type to send for a file, or null when it must be converted first */
export function mimeFor(file) {
  const byExt = AUDIO_MIME[ext(file && file.name)];
  if (byExt) return byExt;
  if (byExt === null) return null;
  return TYPE_MIME[String((file && file.type) || "").toLowerCase()] || null;
}
