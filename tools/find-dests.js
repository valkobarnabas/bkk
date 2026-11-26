#!/usr/bin/env node
/*
 * Developer helper: list posters that have a destination or diagram terminal matching a pattern.
 *
 *   node tools/find-dests.js "eagle heights"
 *
 * Prints, per distinct poster layout, one example stop plus the tiles, destinations and
 * the terminal chips of the diagram.
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
const re = new RegExp(process.argv[2] || ".", "i");
const groups = new Map();
for (const st of pack.stops) {
  const rs = st.routes.filter((x) => !x.s).map((x) => x.n);
  if (!rs.length) continue;
  for (const cfg of A.build(ctx, st.code, rs, {})) {
    const chips = cfg.items.flatMap((it) => it.chips || []);
    if (!cfg.dests.some((d) => re.test(d.sign) || re.test(d.title)) && !chips.some((c) => re.test(c))) continue;
    const key =
      cfg.routes.map((r) => r.label).join("+") +
      " :: " +
      cfg.dests.map((d) => `${d.title || d.sign}[${(d.tiles || d.routes).join(",")}]`).join(" | ") +
      " :: chips " +
      [...new Set(chips)].join(" | ");
    const o = groups.get(key) || { n: 0, stop: st.code, all: [] };
    o.n++;
    o.all.push(`${st.code} ${cfg.stopName}`);
    groups.set(key, o);
  }
}
const list = process.argv[3] === "stops";
for (const [k, v] of [...groups].sort()) {
  console.log(`${v.n} x (e.g. stop ${v.stop})  ${k}`);
  if (list) for (const s of v.all) console.log(`      ${s}`);
}
