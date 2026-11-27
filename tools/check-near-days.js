#!/usr/bin/env node
/*
 * Developer helper: where do two day blocks of one destination differ by only a few trips?
 * (candidates for "one block with an asterisk"). Prints a summary per pair of day labels.
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
const MAXX = Number(process.argv[2] || 4);
const sum = new Map();
const seenDest = new Set();
for (const st of pack.stops) {
  const rs = st.routes.filter((x) => !x.s).map((x) => x.n);
  if (!rs.length) continue;
  for (const cfg of A.build(ctx, st.code, rs, {})) {
    for (const dd of cfg.dests) {
      const bl = dd.blocks;
      for (let i = 0; i < bl.length; i++) {
        for (let j = i + 1; j < bl.length; j++) {
          const a = new Set(bl[i].times.map((t) => `${t[0]}:${t[1]}`));
          const b = new Set(bl[j].times.map((t) => `${t[0]}:${t[1]}`));
          const x = [...a].filter((t) => !b.has(t)).length + [...b].filter((t) => !a.has(t)).length;
          const big = Math.max(a.size, b.size);
          const near = x > 0 && x <= Math.max(MAXX, big * 0.12);
          const k = `${bl[i].label} vs ${bl[j].label}`;
          const o = sum.get(k) || { all: 0, near: 0, routes: new Set(), ex: "" };
          o.all++;
          if (near) {
            o.near++;
            o.routes.add(dd.routes.join("/"));
            if (!o.ex) o.ex = `${st.code} ${dd.routes.join("/")} (${x} of ${big} differ)`;
          }
          sum.set(k, o);
        }
      }
    }
  }
}
for (const [k, o] of [...sum].sort()) if (o.near) console.log(`${k}: ${o.near}/${o.all} dests near-equal; routes ${[...o.routes].sort().join(" ")}; e.g. ${o.ex}`);
