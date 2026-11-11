/* Test bootstrap: lets the app's modules run in plain Node (no Vite, no phone).
   • "@capacitor/core" → a tiny stub (never native)
   • window.localStorage → an in-memory Storage */
import { register } from "node:module";
register("./loader.mjs", import.meta.url);

const mem = new Map();
globalThis.window = globalThis.window || {};
window.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)); },
  removeItem: (k) => { mem.delete(k); },
  clear: () => mem.clear(),
};
window.dispatchEvent = () => true;
globalThis.Event = globalThis.Event || class Event { constructor(t) { this.type = t; } };
