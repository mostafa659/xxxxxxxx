import { NO_ECHO_RULE, SPELLING_RULE } from "./guard.js";

/* ───────────── Text hygiene — the "strange symbols" fix ─────────────
   What was happening: now and then the model drifts and drops a letter from ANOTHER script into the middle of an
   Arabic word (Devanagari, Thai, Cyrillic, Hebrew, CJK … or a rare Arabic-script letter such as ڭ ڤ ۼ). Cairo has no
   glyph for those, the browser falls back to some other font, the word's cursive joining breaks, and an orphan
   combining mark is drawn on a dotted circle (◌). That is the "ﬁ ◌ Π" garbage.

   The fix is an ALLOW-LIST, not a block-list. Everything the app shows is only ever:
     Arabic (the standard 28 letters + ة ى ء أ إ آ ؤ ئ), Latin, Greek (medical symbols: α β μ Δ …), digits, punctuation,
     math / arrows / super- and subscripts, emoji.
   Anything else is removed; rare Arabic-script letters are first mapped to the standard letter that sounds like them
   (ڭ → نج, ڤ → ف, پ → ب, چ → تش, گ → ج …). It runs on everything the AI writes AND on everything drawn on screen, so
   questions saved earlier are healed too. */

/* 1 ─ glyph-code characters → real letters */
const PRESENTATION = /[\uFB00-\uFB06\uFB50-\uFDFF\uFE70-\uFEFE]/g;   // ﬁ ﬂ … and Arabic presentation forms
const FULLWIDTH = /[\uFF01-\uFF5E]/g;                                  // ＡＢＣ１２３ → ABC123

/* 2 ─ invisible / junk */
const INVISIBLE = /[\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF\uFFFC\uFFFD\u25CC\uE000-\uF8FF\uFE00-\uFE0E]/g;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

/* 3 ─ harakat, Quranic marks, tatweel */
const MARKS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g;

/* 4 ─ rare Arabic-script letters → the standard letter(s) */
const MAP = {};
const add = (to, chars) => { for (const c of chars) MAP[c] = to; };
add("ب", "پٻټڀٮݐݑݒݔݕݖ"); add("ت", "ٹٺٿݓ"); add("ث", "ٽ");
add("ج", "ڃڄڇڿݘگڰڲڳڴ"); MAP["چ"] = "تش"; MAP["ژ"] = "ج"; MAP["ڨ"] = "ج";
add("ح", "ځڂڅݗ"); add("خ", "ڂ");
add("د", "ڈډڊڋڌڍڎڏڐ"); add("ذ", "ݙݚ"); add("ر", "ڑڒړڔڕږݛ"); add("ز", "ڗݫݬݮݯ");
add("س", "ڛݜݭ"); add("ش", "ڜ"); add("ص", "ڝ"); add("ض", "ڞ"); add("ط", "ڟ"); add("ع", "ݝݞݟ"); add("غ", "ڠݝ");
MAP["ڠ"] = "نج"; MAP["ڭ"] = "نج"; MAP["ݣ"] = "نج"; MAP["ڱ"] = "نج";
add("ف", "ڡڢڣڤڥڦݠݡ"); add("ق", "ڧٯ");
add("ك", "کڪګڬڮݢݤ"); add("ل", "ڵڶڷڸݪ"); add("م", "ݥݦ"); add("ن", "ڹںڻڼڽݧݨݩ");
add("ه", "ھہۂۿەۀ"); MAP["ۃ"] = "ة";
add("و", "ۆۇۈۉۊۋۏٶٷݸݹ"); add("ي", "یېۍێۑےۓٸݺݻݼݽݾݿ"); add("ا", "ٱٲٳٵ");
const LOOKALIKE_RE = new RegExp("[" + Object.keys(MAP).join("") + "]", "g");

/* 5 ─ digits */
const DIGITS = /[\u0660-\u0669\u06F0-\u06F9]/g;

/* 6 ─ scripts that must never appear (Cyrillic, Armenian, Hebrew, Syriac, Thaana, N'Ko, every Indic / South-East-Asian
       script, Georgian, Hangul Jamo, Ethiopic, Cherokee, Canadian Syllabics, Khmer, Mongolian, … CJK, Yi, Hangul, half-width) */
const FOREIGN = /[\u0400-\u058F\u0590-\u05FF\u0700-\u074F\u0780-\u07FF\u0800-\u0DFF\u0E00-\u109F\u10A0-\u139F\u13A0-\u13FF\u1400-\u18AF\u1900-\u1CFF\u2E80-\uA63F\uA640-\uA69F\uA800-\uABFF\uAC00-\uD7FF\uFF61-\uFFEF]/g;

/* 7 ─ Arabic-script block: keep only the standard letters and Arabic punctuation */
const ARABIC_BLOCK = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/g;
const ARABIC_OK = /[\u0621-\u063A\u0641-\u064A\u060C\u061B\u061F\u066A-\u066C]/;

/* 8 ─ a combining mark with nothing to attach to (start of a line / after a space or bracket) */
const ORPHAN_MARK = /(^|[\s(\[«"'،؛:.,;!?\-–—])[\u0300-\u036F\u1AB0-\u1AFF\u1DC0-\u1DFF\u20D0-\u20FF\uFE20-\uFE2F]+/gu;

/* 9 ─ Latin fragments glued INSIDE an Arabic word ("ك" + "ps" + "ولة", "كوش" + "ing") are the model's glitch, never a real word */
const AR = "\\u0621-\\u063A\\u0641-\\u064A";
const GLUE_MID = new RegExp(`([${AR}])[A-Za-z]{1,4}(?=[${AR}])`, "g");
const GLUE_END = new RegExp(`([${AR}])[a-z]{1,3}(?![A-Za-z0-9${AR}])`, "g");

export function fixText(s) {
  if (!s || typeof s !== "string") return s;
  if (!/[^\x20-\x7E\n\t]/.test(s)) return s;                  // plain ASCII → nothing to fix (fast path)
  return s
    .replace(CONTROL, "")
    .replace(PRESENTATION, (c) => c.normalize("NFKC"))
    .replace(FULLWIDTH, (c) => c.normalize("NFKC"))
    .replace(INVISIBLE, "")
    .replace(MARKS, "")
    .replace(LOOKALIKE_RE, (c) => MAP[c] || c)
    .replace(DIGITS, (d) => String(d.charCodeAt(0) & 15))
    .replace(FOREIGN, "")
    .replace(ARABIC_BLOCK, (c) => (ARABIC_OK.test(c) ? c : ""))
    .replace(GLUE_MID, "$1")
    .replace(GLUE_END, "$1")
    .replace(ORPHAN_MARK, "$1");
}

/* true when the RAW model output carries any of the glitches above → the stage is regenerated once */
export function looksGlitched(s) {
  if (typeof s !== "string" || !/[^\x20-\x7E\n\t]/.test(s)) return false;
  return [FOREIGN, GLUE_MID, GLUE_END, LOOKALIKE_RE].some((r) => new RegExp(r.source).test(s));
}

/* true when the text contained letters of a foreign script (used to warn the model on a retry) */
export const hasForeignScript = (s) => typeof s === "string" && new RegExp(FOREIGN.source).test(s);

/* the sentence added to every prompt that makes the model write Arabic */
export const ARABIC_RULE = `\nWRITING RULE (strict): write only in Arabic (standard letters only) and English (Latin letters). Never output a letter from any other script (no Hindi/Devanagari, Thai, Cyrillic, Hebrew, Chinese, Japanese, Korean …) and never use rare Arabic-script letters (ڭ ڤ پ چ گ ژ ۼ …). Spell foreign sounds with standard Arabic letters: ng → نج, v → ف, p → ب, ch → تش, g → ج. Never put Latin letters inside an Arabic word and never glue an Arabic word to an English one: every Arabic word is spelled completely in Arabic letters, every English word stays whole, and the two are separated by a space. Keep medical terms in English. ${SPELLING_RULE} ${NO_ECHO_RULE}`;
