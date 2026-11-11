/* v3.37 · "live shell" APK: the app window loads the newest web build from GitHub Pages instead of a copy packed inside the APK.
   Install this APK ONCE; after that every push is visible by just reopening the app.
   usage: CAP_SERVER_URL=https://<user>.github.io/<repo>/ node scripts/live-shell.mjs   (edits capacitor.config.json, run before `cap add android`) */
import fs from "node:fs";

const url = String(process.env.CAP_SERVER_URL || "").trim();
if (!/^https:\/\/[^/]+\//.test(url)) { console.error("CAP_SERVER_URL must be an https URL ending with /  (for example https://user.github.io/repo/)"); process.exit(1); }

const cfgPath = "capacitor.config.json";
const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
const host = new URL(url).host;
cfg.server = { url, cleartext: false, allowNavigation: [host] };
fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n");

/* the offline page shown only if the phone has no network at the very first launch */
fs.mkdirSync("dist", { recursive: true });
fs.writeFileSync("dist/index.html", `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:sans-serif;text-align:center;padding:40px"><h3>ClinixStudy</h3><p>محتاج نت عشان يفتح أحدث نسخة.</p><p><a href="${url}">حاول تاني</a></p></body></html>`);
console.log(`live shell → ${url}`);
