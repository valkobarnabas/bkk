#!/usr/bin/env node
/* Developer helper: print the diagram rows near a name pattern for posters of a route.
 *   node tools/show-spur.js A "High Crossing" [stopCode]
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const root = path.join(__dirname, "..");
const S = require(path.join(root, "js/served.js"));
const A = require(path.join(root, "js/adapter.js")).create(S);
const load = (f) => JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root, "data", f))));
const pack = load("pack.json.gz");
const ctx = A.prepare(pack, load("served.json.gz"));
const route = process.argv[2] || "A";
const re = new RegExp(process.argv[3] || "High Crossing", "i");
const only = process.argv[4];
let n = 0;
for (const st of pack.stops) {
  if (only && st.code !== only) continue;
  const rs = st.routes.filter((x) => !x.s && x.n.toUpperCase().startsWith(route.toUpperCase())).map((x) => x.n);
  if (!rs.length) continue;
  for (const cfg of A.build(ctx, st.code, rs, {})) {
    if (!cfg.items.some((i) => re.test(i.name))) continue;
    n++;
    if (!only && n > 40) continue;
    console.log(`== ${st.code} ${cfg.stopName} | ${cfg.routes.map((r) => r.label)} | ${cfg.direction}`);
    cfg.items.forEach((it, k) => {
      console.log(`  ${String(k).padStart(2)} ${String(it.min).padStart(3)}' ${it.name} #${it.id} lane=${it.lane ? 1 : 0}${it.spurStart ? " spurStart" : ""}${it.rejoin ? " rejoin" : ""}${it.only ? " only=" + it.only : ""}${it.marker ? " marker=" + it.marker : ""}`);
    });
  }
}
console.log("posters with match:", n);
