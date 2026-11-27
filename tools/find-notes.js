#!/usr/bin/env node
/* Developer helper: list posters whose diagram has a layover note, and those with two-line stop names. */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const root = path.join(__dirname, "..");
const S = require(path.join(root, "js/served.js"));
const A = require(path.join(root, "js/adapter.js")).create(S);
const load = (f) => JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root, "data", f))));
const pack = load("pack.json.gz");
const ctx = A.prepare(pack, load("served.json.gz"));
let n = 0;
for (const st of pack.stops) {
  const rs = st.routes.filter((x) => !x.s).map((x) => x.n);
  if (!rs.length) continue;
  for (const cfg of A.build(ctx, st.code, rs, {})) {
    for (const it of cfg.items) {
      if (it.note && n++ < 12) console.log(st.code, rs.join("/"), "|", it.name, "|", it.note);
    }
  }
}
