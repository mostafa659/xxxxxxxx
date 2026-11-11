import { Capacitor } from "@capacitor/core";
import { SplashScreen } from "@capacitor/splash-screen";

/* ───────── launch splash hand-off ─────────
   Android shows the native splash (app icon on the brand teal) the instant the app is tapped and, because
   capacitor.config.json sets `launchAutoHide: false`, keeps it up until we call hide() here.
   We call it only after the first real screen has painted, so the sequence is always:
       icon on teal  →  (quick fade)  →  the app, already drawn.
   No white frame, no half-loaded page, no spinner. */

const MIN_VISIBLE_MS = 1000;   // never let the splash flash by: it stays at least this long since the page started

let done = false;

export function hideSplash() {
  if (done) return;
  done = true;
  const native = Capacitor.isNativePlatform();
  // two frames = React's first commit has really reached the screen
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const wait = Math.max(0, MIN_VISIBLE_MS - performance.now());
    setTimeout(() => {
      const cover = document.getElementById("splash");
      if (native) {
        if (cover) cover.remove();                       // it is hidden under the native splash anyway
        SplashScreen.hide().catch(() => { /* nothing to hide */ });
      } else if (cover) {                                // browser / dev: fade the cover instead
        cover.classList.add("out");
        setTimeout(() => cover.remove(), 380);
      }
    }, wait);
  }));
}

/* safety net: whatever happens, the splash can never trap the person on the launch screen */
export function splashFailsafe(ms = 5000) {
  setTimeout(hideSplash, ms);
}
