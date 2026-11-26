#!/usr/bin/env node
/*
 * Developer helper: stops (and their routes) around a stop.   node tools/near-stops.js 10070 [feet]
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const root = path.join(__dirname, "..");
const S = require(path.join(root, "js/served.js"));
const served = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root, "data", "served.json.gz"))));
const code = process.argv[2];
const maxFt = Number(process.argv[3] || 700);
const geo = served.geo || {};
const o = geo[code];
const rows = [];
for (const [c, g] of Object.entries(geo)) {
  const ft = S.metersToFeet(S.distM(o, g));
  if (ft <= maxFt) rows.push({ c, ft, n: g.n, dir: g.dir, r: ((served.stopRoutes || {})[c] || []).map((r) => r.n).join(",") });
}
rows.sort((a, b) => a.ft - b.ft);
for (const r of rows) console.log(`${String(Math.round(r.ft)).padStart(5)} ft  ${r.c}  ${r.n} ${r.dir || ""}  [${r.r}]`);
