#!/usr/bin/env node
/* Developer helper: every poster with a High Crossing spur, and whether the spur follows East Springs. */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const root = path.join(__dirname, "..");
const S = require(path.join(root, "js/served.js"));
const A = require(path.join(root, "js/adapter.js")).create(S);
const load = (f) => JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root, "data", f))));
const pack = load("pack.json.gz");
const ctx = A.prepare(pack, load("served.json.gz"));
let spurs = 0, before = 0, equal = 0;
for (const st of pack.stops) {
  const rs = st.routes.filter((x) => !x.s && /^A/i.test(x.n)).map((x) => x.n);
  if (!rs.length) continue;
  for (const cfg of A.build(ctx, st.code, rs, {})) {
    const its = cfg.items;
    const es = its.findIndex((i) => /^East Springs$/i.test(i.name) && !i.lane);
    const sp = its.map((i, k) => (i.lane && /^High Crossing/i.test(i.name) ? k : -1)).filter((k) => k >= 0);
    if (!sp.length) continue;
    spurs++;
    const mins = sp.map((k) => its[k].min).join(",");
    if (es >= 0 && sp[0] < es) {
      before++;
      console.log("BEFORE", st.code, cfg.routes.map((r) => r.label).join("/"), cfg.direction, "mins", mins, "es", its[es].min);
    } else if (es >= 0) {
      if (sp.some((k) => its[k].min < its[es].min)) console.log("EARLIER MIN", st.code, mins, "es", its[es].min);
      else if (its[sp[0]].min === its[es].min) equal++;
      console.log("ok", st.code, cfg.direction, "es", its[es].min, "spur", mins);
    }
  }
}
console.log({ spurs, before, equal });
