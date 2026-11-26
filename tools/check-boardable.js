#!/usr/bin/env node
/*
 * Developer helper: find trip patterns that pass a stop (so the diagram draws them) but
 * have no timetable heading there, i.e. trips that cannot be boarded at that stop.
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
const low = (s) => String(s == null ? "" : s).toLowerCase();
const norm = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();

const seen = new Map();
for (const st of pack.stops) {
  const entry = ctx.byCode[st.code];
  if (!entry) continue;
  const insts = S.patternsForStop(ctx.served, st.code);
  for (const i of insts) {
    const rt = ctx.routeByName.get(i.r) || {};
    if (rt.s) continue;
    const have = new Set();
    for (const part of entry.parts || []) {
      if (low(part.route && part.route.route_short_name) !== low(i.r)) continue;
      for (const h of part.headings || []) have.add(norm(h.board && h.board.dest));
    }
    const d = norm(i.board && i.board.dest);
    if (have.has(d)) continue;
    const key = `${i.r} ${d} (has: ${[...have].join(" | ")})`;
    const o = seen.get(key) || { n: 0, ex: [] };
    o.n++;
    if (o.ex.length < 4) o.ex.push(st.code);
    seen.set(key, o);
  }
}
for (const [k, v] of [...seen].sort()) console.log(`${v.n} x ${k}   e.g. ${v.ex.join(",")}`);
