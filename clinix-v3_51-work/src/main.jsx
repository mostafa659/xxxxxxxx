import "./lib/legacy.js";
import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/cairo/400.css";
import "@fontsource/cairo/600.css";
import "@fontsource/cairo/700.css";
import "@fontsource/cairo/900.css";
import "./styles.css";
import App from "./App.jsx";
import { loadBoot } from "./lib/storage.js";
import { initVocab } from "./lib/vocab.js";
import { initMistakes } from "./lib/mistakes.js";
import { splashFailsafe } from "./lib/splash.js";
import { registerPWA } from "./lib/pwa.js";
import { retireManualModes } from "./lib/providers.js";

/* ───────── start-up ─────────
   The app is painted as soon as (a) the Cairo faces are loaded (local files, capped at 0.5 s) and (b) the saved data is read.
   Both happen in parallel while the launch splash (app icon on the brand teal) is still on screen; App.jsx then asks
   src/lib/splash.js to fade it out once the first real screen is drawn: no white frame, no spinner, no layout jump. */

splashFailsafe(5000);
registerPWA();

const FACES = ["400", "600", "700", "900"];
const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(r, ms))]);

async function fontsReady() {
  try {
    if (!document.fonts || !document.fonts.load) return;
    const jobs = [];
    FACES.forEach((w) => {
      jobs.push(document.fonts.load(`${w} 16px Cairo`, "ابتثجحخدذرزسشصضطظعغفقكلمنهوي"));
      jobs.push(document.fonts.load(`${w} 16px Cairo`, "AaBbCcDdEe0123456789"));
    });
    await withTimeout(Promise.all(jobs), 500); // the fonts ship inside the app (local), so this is normally instant; never hold the app hostage to it
  } catch (e) { /* fall back to system font */ }
}

try { retireManualModes(); } catch (e) { /* ignore */ }
const EMPTY_BOOT = { questions: [], words: [], apiKey: "", mode: null, goal: 5, perf: {}, topics: { list: [], pinned: [], auto: true }, vocab: {}, mistakes: [] };

async function start() {
  const [boot] = await Promise.all([
    withTimeout(loadBoot(), 1500).then((b) => b || EMPTY_BOOT).catch(() => EMPTY_BOOT),
    fontsReady(),
  ]);
  initVocab(boot.vocab);
  initMistakes(boot.mistakes);
  createRoot(document.getElementById("root")).render(<App boot={boot} />);
}

start();
