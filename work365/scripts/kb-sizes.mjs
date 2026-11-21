/* per-module bundle sizes (raw and gzip) — the modules are lazy chunks, never on the startup path */
import fs from "node:fs";
import zlib from "node:zlib";
const dir = new URL("../src/lib/kb/modules/", import.meta.url);
let total = 0;
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".js"))) {
  const b = fs.readFileSync(new URL(f, dir));
  const gz = zlib.gzipSync(b).length; total += b.length;
  console.log(`${f.padEnd(24)} ${String(b.length).padStart(7)} B raw  ${String(gz).padStart(6)} B gzip`);
}
console.log(`total raw ${total} B`);
