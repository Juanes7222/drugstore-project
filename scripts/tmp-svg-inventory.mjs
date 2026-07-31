// Temporary: inventory inline SVG blocks across the renderer for the icon refactor.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = "apps/pos-desktop/src";
const files = [];
(function walk(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    const s = statSync(p);
    if (s.isDirectory()) walk(p);
    else if (/\.(tsx|ts)$/.test(f)) files.push(p);
  }
})(root);

for (const f of files) {
  const c = readFileSync(f, "utf8");
  if (!c.includes("<svg")) continue;
  const re = /<svg[\s\S]*?<\/svg>/g;
  let m, i = 0;
  while ((m = re.exec(c))) {
    const svg = m[0].replace(/\s+/g, " ").trim();
    console.log("=== " + f + " #" + ++i + " ===");
    console.log(svg.slice(0, 1600));
    console.log();
  }
}
