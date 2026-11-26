#!/usr/bin/env node
/*
 * Developer check: render every default poster and report problems.
 *
 *   node tools/sweep.js            every poster, four modes
 *   node tools/sweep.js 4          every 4th poster (quicker)
 *
 * Reports render errors, text that was cut off with an ellipsis, and how the
 * fit-to-letter scale is distributed.
 */
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

const step = Number(process.argv[2] || 1);
const modes = [
  { name: "normal", opts: {} },
  { name: "letter", opts: { fit: "letter" } },
  { name: "letter+plain", opts: { fit: "letter", plainTransfers: true } },
  { name: "landscape", opts: { fit: "letter", orientation: "landscape" } },
  { name: "letter+text+plain", opts: { fit: "letter", textSigns: true, plainTransfers: true } },
  { name: "letter+bw", opts: { fit: "letter", bw: true } },
];
const stat = modes.map(() => ({ n: 0, errors: 0, cutOff: new Map(), scales: {} }));
const t0 = Date.now();
let k = 0;
for (const st of pack.stops) {
  const rs = st.routes.filter((x) => !x.s).map((x) => x.n);
  if (!rs.length) continue;
  for (const cfg of A.build(ctx, st.code, rs, {})) {
    if (k++ % step) continue;
    modes.forEach((m, i) => {
      const s = stat[i];
      s.n++;
      try {
        const r = P.render(cfg, m.opts);
        const bin = (Math.floor(Math.min(1, r.info.scale) * 10) / 10).toFixed(1);
        s.scales[bin] = (s.scales[bin] || 0) + 1;
        for (const hit of r.svg.match(/>[^<>]*\u2026[^<>]*</g) || []) {
          const key = hit.replace(/#\d+/g, "#N");
          const o = s.cutOff.get(key) || { n: 0, stop: st.code };
          o.n++;
          s.cutOff.set(key, o);
        }
      } catch (e) {
        s.errors++;
        if (s.errors <= 3) console.log(`ERROR [${m.name}] stop ${st.code}: ${e.message}`);
      }
    });
  }
}
modes.forEach((m, i) => {
  const s = stat[i];
  console.log(`\n== ${m.name}: ${s.n} posters, ${s.errors} errors, ${s.cutOff.size} distinct cut-off texts`);
  console.log("   scale bins:", JSON.stringify(s.scales));
  for (const [text, o] of [...s.cutOff].sort((a, b) => b[1].n - a[1].n).slice(0, 12)) console.log(`   ${o.n} x  (e.g. stop ${o.stop})  ${text}`);
});
console.log(`\n${((Date.now() - t0) / 1000).toFixed(1)} s`);
