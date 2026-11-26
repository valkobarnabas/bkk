#!/usr/bin/env node
/*
 * Developer helper: why does a transfer route (not) show at a stop?
 *
 *   node tools/debug-xfer.js 2175 F        transfers from route F at stop 2175, with the reasons
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
const code = process.argv[2];
const route = process.argv[3];
const here = (served.stopRoutes || {})[code] || [];
console.log("routes at stop (stopRoutes):", here.map((r) => r.n).join(","));
const inst = S.patternsForStop(served, code).filter((i) => String(i.r).toLowerCase() === String(route).toLowerCase());
const boards = inst.map((i) => i.board);
console.log("boards:", JSON.stringify(boards.map((b) => b.code + ":" + b.dest)));
for (const r of here) {
  const departs = S.routeDepartsFrom ? S.routeDepartsFrom(served, r.n, code) : "n/a";
  const ov = S.serviceOverlaps ? S.serviceOverlaps(served, route, code, r.n, code, boards) : "n/a";
  console.log(`  ${r.n}: departsFrom=${departs} overlaps=${ov} school=${!!r.s}`);
}
if (S.clockSpans || (ctx.served.clock && ctx.served.clock.get)) {
  const clock = ctx.served.clock;
  const byRoute = clock && clock.get(String(code));
  if (byRoute) for (const [rn, spans] of byRoute) console.log(`  spans ${rn}:`, JSON.stringify(spans));
}
const x = S.transfersForStop(code, route, 250, served, { excludeSchool: true }, boards);
console.log("same:", x.same.map((r) => r.n).join(","));
console.log("others:", x.others.map((o) => `${o.r.n}@${o.code}/${Math.round(o.d)}m`).join(" "));
