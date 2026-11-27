#!/usr/bin/env node
/*
 * Developer helper: posters whose timetable has both "X" and "X via Y" for one route, and
 * whether the remaining stops of the two sets of trips are the same from that stop.
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
const norm = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
const seen = new Map();
for (const st of pack.stops) {
  const insts = S.patternsForStop(served, st.code).filter((i) => !(ctx.routeByName.get(i.r) || {}).s);
  const byKey = new Map();
  for (const i of insts) {
    const k = `${i.r}|${i.d}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(i);
  }
  for (const [k, list] of byKey) {
    const dests = [...new Set(list.map((i) => norm(i.board.dest)))];
    for (const plain of dests) {
      for (const via of dests) {
        if (!via.startsWith(plain + " VIA ")) continue;
        const a = list.filter((i) => norm(i.board.dest) === plain);
        const b = list.filter((i) => norm(i.board.dest) === via);
        const sa = new Set(a.map((i) => i.remaining.join(",")));
        const sb = new Set(b.map((i) => i.remaining.join(",")));
        const same = sa.size === 1 && sb.size === 1 && [...sa][0] === [...sb][0];
        const key = `${k.split("|")[0]}: ${plain} + ${via}  aligned=${same}`;
        const o = seen.get(key) || { n: 0, ex: [] };
        o.n++;
        if (o.ex.length < 6) o.ex.push(st.code);
        seen.set(key, o);
      }
    }
  }
}
for (const [k, v] of [...seen].sort()) console.log(`${v.n} x ${k}   e.g. ${v.ex.join(",")}`);
