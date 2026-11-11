/* ───────────── Old-name data (v3.27) ─────────────
   The app used to be called NCLEX-RN and kept its small settings in localStorage under "nclex:…" keys (theme, text size, chat window size,
   engine choice, extra-engine keys …). They now live under "clinix:…". This file runs FIRST at start-up and copies every old key to its new
   name once, without overwriting anything that already exists under the new name and without deleting the old copy. */
(function migrateLocalStorage() {
  try {
    const ls = window.localStorage;
    if (!ls) return;
    const old = [];
    for (let i = 0; i < ls.length; i++) { const k = ls.key(i); if (k && k.startsWith("nclex:")) old.push(k); }
    for (const k of old) {
      const nk = `clinix:${k.slice(6)}`;
      if (ls.getItem(nk) === null) ls.setItem(nk, ls.getItem(k));
    }
  } catch (e) { /* storage blocked: nothing to move */ }
})();
export {};
