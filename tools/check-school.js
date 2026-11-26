#!/usr/bin/env node
/*
 * Developer helper: school-route posters. Lists stops where one build gives two or more
 * posters that look alike (same destination titles and same stop list).
 *
 *   node tools/check-school.js          summary
 *   node tools/check-school.js -v       also print the examples
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
const verbose = process.argv.includes("-v");

const sig = (cfg) => cfg.dests.map((d) => d.title).sort().join("|") + " :: " + cfg.items.map((i) => i.id).join(",");
const sigNoTitle = (cfg) => cfg.items.map((i) => i.id).join(",");
let stopsChecked = 0;
let dupStops = 0;
let dupPosters = 0;
const examples = [];
for (const st of pack.stops) {
  const rs = st.routes.filter((x) => x.s).map((x) => x.n);
  for (const r of rs) {
    let cfgs;
    try {
      cfgs = A.build(ctx, st.code, [r], { excludeSchool: false });
    } catch (e) {
      continue;
    }
    stopsChecked++;
    const bySig = new Map();
    for (const c of cfgs) {
      const k = sig(c);
      bySig.set(k, (bySig.get(k) || []).concat(c));
    }
    const dups = [...bySig.values()].filter((l) => l.length > 1);
    // posters that differ only in timetable
    const byItems = new Map();
    for (const c of cfgs) byItems.set(sigNoTitle(c), (byItems.get(sigNoTitle(c)) || []).concat(c));
    const sameItems = [...byItems.values()].filter((l) => l.length > 1);
    if (dups.length || sameItems.length) {
      dupStops++;
      dupPosters += cfgs.length;
      if (examples.length < 400)
        examples.push(
          `${st.code} ${r}: ${cfgs.length} posters; identical=${dups.length} sameStops=${sameItems.length}  ` +
            cfgs.map((c) => `[${c.routes.map((t) => t.label).join("+")} -> ${c.dests.map((d) => d.title + "(" + d.trips + ")").join(" / ")}]`).join(" ")
        );
    }
  }
}
console.log({ stopsChecked, dupStops, dupPosters });
if (verbose) for (const e of examples) console.log(e);
else for (const e of examples.slice(0, 15)) console.log(e);
