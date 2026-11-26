#!/usr/bin/env node
/* Developer check: a black-and-white render must contain only grey/black/white colours. */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const root = path.join(__dirname, "..");
const S = require(path.join(root, "js/served.js"));
const A = require(path.join(root, "js/adapter.js")).create(S);
const P = require(path.join(root, "js/poster-core.js"));
const load = (f) => JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root, "data", f))));
const pack = load("pack.json.gz");
const ctx = A.prepare(pack, load("served.json.gz"));
const step = Number(process.argv[2] || 7);
const bad = new Map();
let n = 0;
let k = 0;
for (const st of pack.stops) {
  const rs = st.routes.filter((x) => !x.s).map((x) => x.n);
  if (!rs.length) continue;
  for (const cfg of A.build(ctx, st.code, rs, {})) {
    if (k++ % step) continue;
    for (const opts of [{ bw: true }, { bw: true, plainTransfers: true, textSigns: true }]) {
      n++;
      const svg = P.render(cfg, opts).svg;
      for (const m of svg.match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g) || []) {
        const h = m.length === 4 ? m.replace(/./g, "$&$&").replace("##", "#") : m;
        const v = h.slice(1).toLowerCase();
        const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16));
        if (r !== g || g !== b) bad.set(m, (bad.get(m) || 0) + 1);
      }
    }
  }
}
console.log(`${n} renders; non-grey colours:`, bad.size ? [...bad] : "none");
