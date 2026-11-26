#!/usr/bin/env node
/*
 * Developer helper: print what the adapter built for a stop.
 *
 *   node tools/inspect-poster.js 6842          every poster at stop 6842
 *   node tools/inspect-poster.js 6842 R        only routes named R there
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

const code = process.argv[2];
const stop = pack.stops.find((s) => String(s.code) === String(code) || String(s.code) === String(code).padStart(4, "0"));
if (!stop) throw new Error("no such stop " + code);
const names = process.argv[3] ? process.argv[3].split(",") : stop.routes.filter((x) => !x.s).map((x) => x.n);
for (const cfg of A.build(ctx, stop.code, names, { excludeSchool: !process.argv.includes("school") })) {
  console.log(`\nPOSTER ${cfg.routes.map((r) => r.label).join(" + ")}  (${cfg.stopName})`);
  console.log("  tiles:", cfg.routes.map((r) => `${r.label}[route=${r.route}]`).join(", "));
  for (const d of cfg.dests) {
    console.log(`  dest "${d.title}" sign="${d.sign}" dir=${d.direction} routes=${JSON.stringify(d.routes)} key=${d.key} blocks=${d.blocks.length} trips=${d.trips} reach=${d.reach}`);
  }
}
