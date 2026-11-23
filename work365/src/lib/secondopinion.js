/* ───────────── B7 · second opinion — USER-INITIATED ONLY (v3.43) ─────────────
   Never automatic, never the same model, never "are you sure?". On the student's tap: ONE request to a DIFFERENT model with the option order SHUFFLED
   (the model's answer letter is mapped back), scored by the probability of the answer token, not by free text. Agreement upgrades the tier by one step (never
   past MEDIUM while the profile is uncalibrated); disagreement shows both views and marks the item unresolved. */
import { normLogprobs, answerConfidence } from "./solvecheck.js";

export function shuffleMap(letters, seed = Date.now()) {
  let x = (seed >>> 0) || 1;
  const rnd = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
  const shown = [...letters];
  for (let i = shown.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [shown[i], shown[j]] = [shown[j], shown[i]]; }
  // original letter → letter shown in the shuffled prompt
  const toShown = Object.fromEntries(letters.map((l, i) => [l, shown[i]]));
  const toOrig = Object.fromEntries(Object.entries(toShown).map(([o, s]) => [s, o]));
  return { toShown, toOrig };
}

/* the model's reply in shuffled letters → { letter (original), p } */
export function readSecond({ text, logprobs }, map, validShown) {
  const m = /ANSWER\s*:\s*([A-H])/i.exec(text || "");
  const conf = answerConfidence(normLogprobs(logprobs), validShown);
  const shown = conf && conf.per[0] ? conf.per[0].letter : m ? m[1].toUpperCase() : "";
  if (!shown || !map.toOrig[shown]) return null;
  return { letter: map.toOrig[shown], p: conf ? conf.per[0].p : null };
}

/* verdict on the pair of opinions */
export function compareOpinions(first, second, { calibrated = false } = {}) {
  if (!second) return { status: "failed", tier: first.tier };
  const same = first.letters.length === 1 && first.letters[0] === second.letter;
  if (same) { const up = first.tier === "LOW" ? "MEDIUM" : "HIGH"; return { status: "agree", tier: !calibrated && up === "HIGH" ? "MEDIUM" : up }; }
  return { status: "disagree", tier: "LOW", views: [first.letters.join(","), second.letter] };
}
