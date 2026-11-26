#!/usr/bin/env node
/*
 * Developer helper: find stops by name.   node tools/find-stop.js "allen at marshall"
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const root = path.join(__dirname, "..");
const served = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root, "data", "served.json.gz"))));
const re = new RegExp(process.argv[2] || ".", "i");
const routes = new Map((served.stops || []).map((s) => [s.code, (s.routes || []).map((r) => r.n).join(",")]));
for (const [code, g] of Object.entries(served.geo || {})) {
  if (re.test(g.n || "")) console.log(`${code}  ${g.n}  [${routes.get(code) || ""}]  ${g.dir || ""}  ${g.lat},${g.lon}`);
}
