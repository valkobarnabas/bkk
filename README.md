# BKK-style stop posters for Madison Metro

Generates Budapest (BKK) style stop posters, a line diagram with ride times,
transfers with walking distances, and a departure table, for **any stop and
route combination** in the bundled GTFS data. The same JavaScript runs in the
browser (GitHub Pages, no server) and in Node (command line).

## Web

Publish the `bkk-github` folder with GitHub Pages (a `.nojekyll` file is
included). Open `index.html`, search for a stop (number or name), tick the
routes, and press *Generate poster*. Each poster can be printed / saved as PDF
(page size is set automatically), or downloaded as SVG or HTML. Links like
`index.html?stop=0532&route=28,38` open straight to a poster
(`&merge=0` and `&school=1` are also understood).

To try it locally: `python -m http.server` in this folder, then open
http://localhost:8000.

## Command line

```
node cli.js --stop 0532 --route 28
node cli.js --stop 0532 --route 28,38,80 --out posters --format svg,pdf
node cli.js --search "linden at babcock"
node cli.js --stop 0532 --routes          # list the routes at a stop
```

Options: `--letter` (force a US Letter page, see below), `--landscape` (letter, but landscape), `--plain-transfers` (list every transfer route with no "+" or walking distances, outline the ones not at the stop in black, and replace the walking row in the key with a boxed "near"; also a checkbox on the page), `--text-signs` (no headboard LED signs: destinations are plain text on the bands and each ending gets a note like "(Trips towards **Segoe** terminate here)"; also a checkbox on the page), `--bw` (a black-and-white design, see below; also a checkbox on the page), `--no-merge`, `--school`, `--format svg,html,pdf`, `--out DIR`,
`--cols N`, `--height PT`, `--data DIR`. PDF output uses headless Edge or Chrome
(set `BKK_BROWSER` to point at another browser). No npm packages are needed.

## How it works

| File | Job |
| --- | --- |
| `js/served.js` | Copy of the stops-served logic from `metrotransit-main` (patterns, transfers, close termini, minute ordering). |
| `js/adapter.js` | GTFS adapter. Turns a stop plus routes into a poster description: destinations (grouped by destination sign), day-type time blocks, stops after this one with minutes-from-here, nearby transfers (within 250 ft, distance rounded up to 10 ft), side branches and merge clusters. |
| `js/poster-core.js` | Renderer. Lays everything out and writes an SVG. Text is measured with the bundled font metrics, so the browser and Node produce identical layouts. |
| `js/search.js` | Stop search, taken from `hybrid.js`. |
| `js/app.js`, `index.html` | The web page. |
| `map.html`, `map.js` | Map of bus stops (Leaflet + OpenStreetMap, linked at the top right). Each stop's tooltip links to `index.html?stop=CODE`. |
| `cli.js` | Terminal wrapper. |

### What it handles

* **One, two, three or more destinations.** Each destination gets its own band (tinted with the route colour) and time blocks; the header shows the main destination large and the others beneath it.
* **Any number of stops.** Long routes split into several diagram columns without breaking a side branch. Stops that only some trips serve become a side-lane spur (when the branch ends in a terminal) or a lettered marker with a legend (when it rejoins).
* **Any amount of times.** The tables flow into one or two columns, and the page grows (taller, then wider) until everything fits at a comfortable size. Page sizes run from letter up to about 16 x 14 in.
* **US Letter only.** `--letter` (or the checkbox on the page) always outputs an 8.5 x 11 in sheet. It stays portrait (landscape is only used if a poster would have to shrink below 50% to stand upright, which never happens with the current data). The poster card always shows a "Rotate to landscape (N% instead of M%)" button (and the CLI always prints what `--landscape` would print at). Posters that do not fit at full size are shrunk, so type gets smaller. To keep that to a minimum the page is built with exactly the shape of the sheet: the diagram and time-table columns are squeezed (down to about 170 pt and 230 pt wide, never so far that an LED sign, the stop bar or a band heading would be cut off) and the tighter row spacing is used whenever it prints at least 3% larger. About 38% of posters print at full size, 74% at 90% or larger, and 90% at 80% or larger; the smallest (83-stop D hubs, route 80) print at about 63-70%. `node tools/sweep.js` renders every poster in every mode and reports errors, cut-off text and this distribution.
* **Trips you cannot board here.** A trip pattern with no time-table heading at the stop (the lone Eagle Heights run of the 84, B trips to Kennedy that only drop off) is left out of the diagram, so it is not drawn as a destination. A one-off plain "X" never replaces "X via Y" in the header.
* **Transfers only when service connects.** A route is listed as a transfer only if it is still running when this route's trips reach that stop (so an evening-only trip does not list a route that has stopped for the day). Near transfers are routes within 250 ft (`TRANSFER_FEET` in `js/adapter.js`).
* **School runs.** Each school run (617, 618, ...) keeps only its own times; runs that serve the same stops share one poster with all their codes as tiles.
* **Black and white.** `--bw` is a design of its own rather than the colours turned grey: every route is solid black with white lettering (routes are told apart by their letters), a near transfer is a white square with a dashed black border, the stop bar and header tiles are black, termini are bullseyes, LED text is white on black, the greys are darker, the bands and key get a black outline, the yellow box becomes white with a heavy border, and the mark in the QR code goes through a grey-scale filter. `node tools/check-bw.js` checks that a render contains no colour.
* **Long names.** Stop names wrap (after "at" when they can: "Junction at / Park And Ride"), then shrink; transfer rows wrap.
* **Route colours.** Taken from the data, with a fallback table for the colours you specified (red A, green B, navy C/D/F/G/H/P/R, blue E/J/O/S/80, light blue L/W/28/38/55/65/75/81/82/84).
* **Merging.** Routes at the stop are merged when their remaining stop sets overlap (Jaccard similarity of at least 0.6, at least two shared stops, at most six routes). Different directions of one route never merge, and neither do numbered variants such as A1 and A2, which each get their own poster. Use `--no-merge` or untick the box to get one poster per route.

### Data

`data/pack.json.gz` and `data/served.json.gz` are the files produced by
`metrotransit-main/build-data.js` for feed `S072_202608240858`
(valid 2026-08-16 to 2026-12-05). Replace them with a fresh build to update the
posters. The previous-calendar archive is not used.

### Fonts

`fonts/` holds subsets of Fira Sans (SIL OFL) and Share Tech Mono (SIL OFL). Rebuild them and `js/font-metrics.js` with `python tools/build-fonts.py`
(needs `fonttools` and `brotli`).

The older Python/reportlab generator (`other claude/poster_gen.py`) is untouched
and is no longer needed: it cannot run on a static page.

Merged posters keep one time band per route (D1, R1, 55, ...), labelled with the poster code. Only routes 28 and 38 share a band when they go to the same destination.
