#!/usr/bin/env node
/**
 * Terminal version of the poster generator. Same code as the web page.
 *
 *   node cli.js --stop 0532 --route 28
 *   node cli.js --stop 0532 --route 28,38,80 --out posters --format svg,pdf
 *   node cli.js --search "linden at babcock"
 *   node cli.js --stop 0532 --routes          (list routes at a stop)
 *
 * Options
 *   --stop CODE        stop number (leading zeros optional)
 *   --route A,B        one or more routes; routes that serve the same stops
 *                      from this stop are merged into one poster
 *   --no-merge         one poster per route instead
 *   --school           include school-extra routes
 *   --letter           always output a US Letter page (portrait or landscape);
 *                      big posters are shrunk to fit, so the type gets smaller.
 *                      Stays portrait; the log says what --landscape would print at
 *   --landscape        like --letter, but on a landscape sheet
 *   --plain-transfers  list every transfer route once: no "+", no walking distances,
 *                      and no walking row in the key
 *   --text-signs       no headboard (LED) signs: destinations are plain text on the bands,
 *                      and where trips end a note says "(Trips towards X terminate here)"
 *   --bw               black-and-white design for B/W printing: solid black routes, near transfers
 *                      as white dashed boxes, white-on-black signs, darker greys, no colour at all
 *   --format LIST      svg (default), html, pdf  (pdf needs Edge or Chrome)
 *   --out DIR          output folder (default ./out)
 *   --cols N           force N diagram columns (1-3)
 *   --height PT        force the page height in points (792 = 11 in)
 *   --data DIR         folder holding pack.json.gz / served.json.gz
 *                      (default ./data; the previous calendar works too)
 */
"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { spawnSync } = require("child_process");

const S = require("./js/served.js");
const Adapter = require("./js/adapter.js");
const Poster = require("./js/poster-core.js");
const Search = require("./js/search.js");

function parseArgs(argv) {
  const a = { format: "svg", out: "out", merge: true, school: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const next = () => argv[++i];
    if (k === "--stop") a.stop = next();
    else if (k === "--route") a.route = next();
    else if (k === "--routes") a.listRoutes = true;
    else if (k === "--search") a.search = next();
    else if (k === "--no-merge") a.merge = false;
    else if (k === "--school") a.school = true;
    else if (k === "--letter") a.fit = "letter";
    else if (k === "--plain-transfers") a.plainTransfers = true;
    else if (k === "--text-signs") a.textSigns = true;
    else if (k === "--bw") a.bw = true;
    else if (k === "--landscape") (a.fit = "letter"), (a.orientation = "landscape");
    else if (k === "--format") a.format = next();
    else if (k === "--out") a.out = next();
    else if (k === "--cols") a.cols = next();
    else if (k === "--height") a.height = next();
    else if (k === "--data") a.data = next();
    else if (k === "-h" || k === "--help") a.help = true;
    else {
      console.error(`Unknown option ${k}`);
      a.help = true;
    }
  }
  return a;
}

function loadGz(file) {
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString("utf8"));
}

function findBrowser() {
  const list = [
    process.env.BKK_BROWSER,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/microsoft-edge",
  ].filter(Boolean);
  return list.find((p) => fs.existsSync(p)) || null;
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.stop && !args.search)) {
    console.log(fs.readFileSync(__filename, "utf8").split("*/")[0].replace(/^#!.*\n/, "").replace(/^\/\*\*?\n?/, ""));
    process.exit(args.help ? 0 : 1);
  }
  const dataDir = path.resolve(args.data || path.join(__dirname, "data"));
  const pack = loadGz(path.join(dataDir, "pack.json.gz"));
  const served = loadGz(path.join(dataDir, "served.json.gz"));
  const adapter = Adapter.create(S);
  const ctx = adapter.prepare(pack, served);

  if (args.search) {
    for (const s of Search.searchStops(pack.stops, args.search)) {
      console.log(`${s.code.padEnd(6)} ${s.name}  (${[s.dir, s.street].filter(Boolean).join(" ")})  routes: ${s.routes.map((r) => r.n).join(" ")}`);
    }
    return;
  }

  const stop = Search.findStop(pack.stops, args.stop);
  if (!stop) {
    console.error(`No stop ${args.stop}. Try --search "name".`);
    process.exit(1);
  }
  const school = (r) => r.s;
  const routes = stop.routes.filter((r) => args.school || !school(r)).map((r) => r.n);
  if (args.listRoutes && !args.route) {
    console.log(`${stop.name} #${stop.code}: ${routes.join(" ")}`);
    return;
  }
  const want = args.route ? args.route.split(/[,\s]+/).filter(Boolean) : routes.slice(0, 1);

  const posters = adapter.build(ctx, stop.code, want, { merge: args.merge, excludeSchool: !args.school });
  const formats = new Set(args.format.split(",").map((x) => x.trim().toLowerCase()));
  fs.mkdirSync(args.out, { recursive: true });

  const fontFile = (f) => `data:font/woff2;base64,${fs.readFileSync(path.join(__dirname, "fonts", f)).toString("base64")}`;
  const fontCss = Poster.fontFaceCss(fontFile);
  const logo = `data:image/png;base64,${fs.readFileSync(path.join(dataDir, "metrologo-mark.png")).toString("base64")}`;

  const browser = formats.has("pdf") ? findBrowser() : null;
  if (formats.has("pdf") && !browser) console.error("No Edge/Chrome found for PDF output (set BKK_BROWSER). Writing HTML instead.");

  posters.forEach((cfg, i) => {
    const res = Poster.render(cfg, { logo, fontCss, cols: args.cols, height: args.height, fit: args.fit, orientation: args.orientation, plainTransfers: args.plainTransfers, textSigns: args.textSigns, bw: args.bw });
    const base = path.join(
      args.out,
      `${slug(cfg.routes.map((r) => r.label).join("-"))}-${cfg.stopId}${posters.length > 1 ? "-" + (i + 1) : ""}`
    );
    const written = [];
    if (formats.has("svg")) {
      fs.writeFileSync(base + ".svg", res.svg);
      written.push(base + ".svg");
    }
    const needHtml = formats.has("html") || (formats.has("pdf") && !browser);
    if (needHtml || formats.has("pdf")) {
      const htmlPath = base + (formats.has("html") || !browser ? ".html" : ".tmp.html");
      fs.writeFileSync(htmlPath, Poster.htmlDocument(res, fontCss));
      if (formats.has("html") || !browser) written.push(htmlPath);
      if (formats.has("pdf") && browser) {
        const pdf = base + ".pdf";
        const r = spawnSync(
          browser,
          [
            "--headless=new",
            "--disable-gpu",
            "--no-pdf-header-footer",
            "--allow-file-access-from-files",
            `--print-to-pdf=${path.resolve(pdf)}`,
            "file:///" + path.resolve(htmlPath).replace(/\\/g, "/"),
          ],
          { encoding: "utf8" }
        );
        if (!fs.existsSync(pdf)) console.error("PDF failed:", r.stderr || r.error);
        else written.push(pdf);
        if (!formats.has("html")) fs.rmSync(htmlPath, { force: true });
      }
    }
    console.log(
      `${cfg.routes.map((r) => r.label).join(" + ")} at ${cfg.stopName} #${cfg.stopId}: ` +
        `${cfg.items.length} stops, ${cfg.dests.length} destination${cfg.dests.length === 1 ? "" : "s"}, ` +
        `page ${res.info.pageIn}${res.info.columns > 1 ? ` (${res.info.columns} columns)` : ""}` +
        `${res.info.scale < 0.999 ? `, shrunk to ${Math.round(res.info.scale * 100)}%` : ""}` +
        `${res.info.otherScale != null ? ` (${res.info.landscape ? "portrait" : "--landscape"} would print at ${Math.round(res.info.otherScale * 100)}%)` : ""} -> ${written.join(", ")}`
    );
  });
}

main();
