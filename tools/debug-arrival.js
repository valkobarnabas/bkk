#!/usr/bin/env node
/*
 * Developer helper: arrival-time spans used for the transfer check at a terminal stop.
 *   node tools/debug-arrival.js 6894 F 2395
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const root = path.join(__dirname, "..");
const S = require(path.join(root, "js/served.js"));
const A = require(path.join(root, "js/adapter.js")).create(S);
const load = (f) => JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root, "data", f))));
const pack = load("pack.json.gz");
const served = load("served.json.gz");
const ctx = A.prepare(pack, served);
const [origin, route, code] = process.argv.slice(2);
const low = (s) => String(s).toLowerCase();
console.log("clock present:", !!served.clock);
console.log("own spans at", code, S.clockSpans(served.clock, code, route, null));
for (const inst of S.patternsForStop(served, origin).filter((i) => low(i.r) === low(route))) {
  const at = inst.remaining.indexOf(code);
  if (at < 0) continue;
  console.log("inst", JSON.stringify(inst.board), "offset", inst.minutes[at]);
  console.log("  origin spans", JSON.stringify(S.clockSpans(served.clock, origin, route, [inst.board])));
}
