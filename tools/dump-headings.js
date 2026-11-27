#!/usr/bin/env node
/*
 * Developer helper: the pack's own timetable headings at a stop for a route.
 *   node tools/dump-headings.js 0298 80
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const root = path.join(__dirname, "..");
const load = (f) => JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root, "data", f))));
const pack = load("pack.json.gz");
const [code, route] = process.argv.slice(2);
const entry = pack.byCode[code];
if (!entry) throw new Error("no stop " + code);
for (const part of entry.parts || []) {
  if (String(part.route && part.route.route_short_name).toLowerCase() !== String(route).toLowerCase()) continue;
  for (const h of part.headings || []) {
    const star = (h.columns || []).reduce((n, c) => n + (c.deps || []).filter((d) => d.noteStar).length, 0);
    console.log(
      `${h.board && h.board.code} ${h.board && h.board.dest} | dir=${h.routeDirection} destNote=${JSON.stringify(h.destNote || null)} stars=${star}`
    );
    for (const c of h.columns || []) console.log(`    ${c.key} (${(c.days || []).join(",")}) ${(c.deps || []).length} deps: ${(c.deps || []).slice(0, 4).map((d) => `${d.hh}:${d.mm}${d.noteStar ? "*" : ""}`).join(" ")}`);
  }
}
