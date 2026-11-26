#!/usr/bin/env node
/*
 * Developer helper: list posters whose tile labels match a pattern.
 *
 *   node tools/find-posters.js "^R"      posters with a tile starting with R
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
const re = new RegExp(process.argv[2] || ".");
const groups = new Map();
for (const st of pack.stops) {
  const rs = st.routes.filter((x) => !x.s).map((x) => x.n);
  if (!rs.length) continue;
  for (const cfg of A.build(ctx, st.code, rs, {})) {
    if (!cfg.routes.some((r) => re.test(r.label))) continue;
    const key =
      cfg.routes.map((r) => r.label).join("+") +
      " :: " +
      cfg.dests.map((d) => `${d.title || d.sign}[${(d.tiles || d.routes).join(",")}]`).join(" | ");
    const o = groups.get(key) || { n: 0, stop: st.code };
    o.n++;
    groups.set(key, o);
  }
}
for (const [k, v] of [...groups].sort()) console.log(`${v.n} x (e.g. stop ${v.stop})  ${k}`);
