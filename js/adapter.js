/**
 * GTFS adapter: turns the bundled Metro data (pack.json.gz + served.json.gz,
 * both built from the GTFS feed by build-data.js) into poster configs for
 * poster-core.js.
 *
 *   const adapter = BKKAdapter.create(S);                  // S = served.js API
 *   const ctx = adapter.prepare(pack, served);             // once
 *   const posters = adapter.build(ctx, "0532", ["28"], opts);
 *
 * One call can return several posters: a stop that serves a route in two
 * directions, or on forks that are too long to fit one diagram, gets one
 * poster each. Routes that serve (nearly) the same stops from the chosen stop
 * are merged into a single poster with several route tiles.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else root.BKKAdapter = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Route colors (served.json carries the same values; this is the fallback).
  const ROUTE_HEX = {
    red: "#EE3325",
    green: "#80BC00",
    navy: "#333366",
    blue: "#2272B5",
    sky: "#46AAD1",
  };
  const ROUTE_GROUPS = {
    [ROUTE_HEX.red]: ["A", "A1", "A2"],
    [ROUTE_HEX.green]: ["B"],
    [ROUTE_HEX.navy]: ["C", "C1", "C2", "D", "D1", "D2", "F", "G", "H", "P", "R", "R1", "R2"],
    [ROUTE_HEX.blue]: ["E", "J", "O", "S", "80"],
    [ROUTE_HEX.sky]: ["L", "W", "28", "38", "55", "65", "75", "81", "82", "84"],
  };
  const COLOR_BY_ROUTE = {};
  for (const [hex, names] of Object.entries(ROUTE_GROUPS)) for (const n of names) COLOR_BY_ROUTE[n] = hex;

  function fallbackColor(name) {
    const n = String(name || "").toUpperCase();
    if (COLOR_BY_ROUTE[n]) return COLOR_BY_ROUTE[n];
    const base = n.replace(/\d+$/, "");
    if (COLOR_BY_ROUTE[base]) return COLOR_BY_ROUTE[base];
    return /^[A-Z]+/.test(n) ? ROUTE_HEX.navy : ROUTE_HEX.sky;
  }

  const DAY_ORDER = ["weekday", "mt", "fri", "daily", "sunthu", "frisat", "weekend", "sat", "sun"];
  const DAY_LABEL = {
    weekday: "Monday\u2013Friday",
    weekend: "Saturday\u2013Sunday",
    frisat: "Friday\u2013Saturday",
    mt: "Monday\u2013Thursday",
    sunthu: "Sunday\u2013Thursday",
    fri: "Friday",
    sat: "Saturday",
    sun: "Sunday",
    daily: "Daily",
  };

  /** How far (feet) a stop may be and still be listed as a "near" transfer. */
  const TRANSFER_FEET = 250;
  const low = (s) => String(s == null ? "" : s).toLowerCase();
  const normDest = (s) =>
    String(s || "")
      .replace(/[\u2708\uFE0E\uFE0F]/g, "")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, " ")
      .trim();

  function afterMidnight(h) {
    h = Number(h);
    return h >= 24 || (h >= 0 && h < 4);
  }
  function minuteOf(h, m) {
    h = Number(h);
    if (h < 4) h += 24;
    return h * 60 + (Number(m) || 0);
  }

  /** Routes whose time tables may share a band when their destination is the same. */
  const MERGE_BANDS = new Set(["28", "38"]);

  function formatFeedDate(ymd) {
    const s = String(ymd || "");
    return s.length === 8 ? `${s.slice(0, 4)}.${s.slice(4, 6)}.${s.slice(6, 8)}` : s;
  }

  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  /** "20260816" -> "August 16, 2026" */
  function longFeedDate(ymd) {
    const s = String(ymd || "");
    if (s.length !== 8) return s;
    return `${MONTHS[Number(s.slice(4, 6)) - 1] || ""} ${Number(s.slice(6, 8))}, ${s.slice(0, 4)}`;
  }

  function create(S) {
    const sign = (board) => S.ledParts(board).dest || String((board && board.dest) || "");
    const pretty = (board) => S.prettyDest(sign(board));

    function prepare(pack, served) {
      if (!served.clock && S.buildClockIndex) served.clock = S.buildClockIndex(pack.byCode);
      served.routeByName = S.routeMap(served);
      served.stopRoutes = served.stopRoutes || {};
      return { pack, served, byCode: pack.byCode || {}, routeByName: served.routeByName };
    }

    function routeColorOf(ctx, name) {
      const r = ctx.routeByName.get(String(name));
      return (r && r.c) || fallbackColor(name);
    }

    // ----------------------------------------------------------- grouping
    function groupStops(g) {
      const set = new Set();
      for (const inst of g.instances) for (const c of inst.remaining) set.add(c);
      return set;
    }

    /** Union-find over groups that serve (nearly) the same stops from here. */
    function clusterGroups(groups, opts) {
      const parent = groups.map((_, i) => i);
      const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
      if (opts.merge !== false) {
        const sets = groups.map(groupStops);
        // Jaccard similarity of the two stop lists (0.6 keeps A1+A2 and 28+38,
        // and keeps a short route from being swallowed by a long one).
        const threshold = opts.mergeThreshold == null ? 0.6 : opts.mergeThreshold;
        for (let i = 0; i < groups.length; i++) {
          for (let j = i + 1; j < groups.length; j++) {
            const a = groups[i];
            const b = groups[j];
            // Never merge two groups of one route: different directions, or
            // numbered variants such as A1 and A2, which keep their own posters.
            if (a.routeName === b.routeName) continue;
            let shared = 0;
            for (const c of sets[i]) if (sets[j].has(c)) shared++;
            const union = sets[i].size + sets[j].size - shared;
            if (shared < 2 || !union) continue;
            if (shared / union >= threshold) parent[find(j)] = find(i);
          }
        }
      }
      const out = new Map();
      groups.forEach((g, i) => {
        const k = find(i);
        if (!out.has(k)) out.set(k, []);
        out.get(k).push(g);
      });
      const maxRoutes = opts.maxMerged || 6;
      const clusters = [];
      for (const list of out.values()) {
        for (let i = 0; i < list.length; i += maxRoutes) clusters.push(list.slice(i, i + maxRoutes));
      }
      return clusters;
    }

    // ----------------------------------------------------------- timetables
    /** True when the stop's timetable has a heading for this trip's destination sign. */
    function canBoardHere(entry, inst) {
      const dest = normDest(inst.board && inst.board.dest);
      if (!dest) return true;
      const route = low(inst.r);
      const have = new Set();
      for (const part of entry.parts || []) {
        if (low(part.route && part.route.route_short_name) !== route) continue;
        for (const h of part.headings || []) have.add(normDest(h.board && h.board.dest));
      }
      if (!have.size || have.has(dest)) return true;
      // "X via Y" trips fold into a plain "X" heading
      const via = dest.indexOf(" VIA ");
      return via > 0 && have.has(dest.slice(0, via));
    }

    function headingsFor(ctx, stopCode, routeSet, poster, allGroups) {
      const entry = ctx.byCode[stopCode];
      const out = [];
      if (!entry) return out;
      const destSet = new Set(poster.boards.map((b) => normDest(b.dest)));
      const codes = new Set(poster.boards.map((b) => String(b.code || "").toUpperCase()));
      for (const part of entry.parts || []) {
        const rn = low(part.route && part.route.route_short_name);
        if (!routeSet.has(rn)) continue;
        for (const h of part.headings || []) {
          if (!destSet.has(normDest(h.board && h.board.dest))) continue;
          const code = String((h.board && h.board.code) || "").toUpperCase();
          // School runs (617, 618, ...) are separate trips: a poster lists only its own codes.
          const schoolRoute = ctx.routeByName.get(String(part.route.route_short_name));
          if (schoolRoute && schoolRoute.s && code && !codes.has(code)) continue;
          const variant = S.boardParts(code).variant;
          if (variant && !codes.has(code)) continue; // numbered trips that belong to another poster
          if (!variant) {
            // Unnumbered trips fold into the first numbered variant only.
            const numbered = allGroups.filter(
              (g) =>
                g.routeName === poster.firstRoute &&
                g.dirId === poster.firstDir &&
                S.boardParts(g.titleCode).variant
            );
            if (numbered.length) {
              const first = numbered
                .map((g) => g.titleCode)
                .sort(S.compareBoardCodes)[0];
              if (!poster.titleCodes.has(first)) continue;
            }
          }
          out.push(h);
        }
      }
      return out;
    }

    function blockLabel(col, deps) {
      let label = DAY_LABEL[col.key] || String(col.label || col.key || "").replace(/:$/, "");
      if (deps.length && deps.every((d) => afterMidnight(d.hh)) && !/night/i.test(label)) label += " Night";
      return label;
    }

    function buildDests(ctx, headings, posterHeading) {
      const by = new Map();
      for (const h of headings) {
        const dkey = normDest(h.board && h.board.dest);
        // Every route gets its own band, except the routes in MERGE_BANDS, which share
        // one band when they go to the same destination (28 + 38 to UW Hospital).
        const pool = MERGE_BANDS.has(String(h.routeShortName).toUpperCase()) ? "*" : h.routeShortName;
        const key = `${pool}|${dkey}`;
        let d = by.get(key);
        if (!d) {
          d = {
            key: dkey,
            title: pretty(h.board),
            sign: sign(h.board),
            direction: h.routeDirection || posterHeading || "",
            routes: [],
            codes: [],
            color: h.routeColor || routeColorOf(ctx, h.routeShortName),
            cols: new Map(),
            notes: [],
            trips: 0,
          };
          by.set(key, d);
        }
        if (!d.routes.includes(h.routeShortName)) d.routes.push(h.routeShortName);
        const bcode = String((h.board && h.board.code) || "").toUpperCase();
        if (bcode && !d.codes.includes(bcode)) d.codes.push(bcode);
        const note = headingNote(h);
        if (note && !d.notes.includes(note)) d.notes.push(note);
        for (const col of h.columns || []) {
          let c = d.cols.get(col.key);
          if (!c) d.cols.set(col.key, (c = { key: col.key, col, deps: new Map() }));
          for (const dep of col.deps || []) {
            const k = `${dep.hh}:${dep.mm}`;
            const prev = c.deps.get(k);
            if (!prev || (dep.noteStar && !prev.noteStar)) c.deps.set(k, dep);
          }
        }
      }
      const dests = [...by.values()].map((d) => {
        const cols = [...d.cols.values()].sort((a, b) => {
          const ia = DAY_ORDER.indexOf(a.key);
          const ib = DAY_ORDER.indexOf(b.key);
          return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
        });
        const blocks = cols.map((c) => {
          const deps = [...c.deps.values()].sort((a, b) => minuteOf(a.hh, a.mm) - minuteOf(b.hh, b.mm));
          return {
            label: blockLabel(c.col, deps),
            times: deps.map((x) => [Number(x.hh), Number(x.mm) || 0, x.noteStar ? 1 : 0]),
          };
        });
        // "Main" destination = the one with the most weekday trips.
        const wk = blocks.find((b) => /Monday/.test(b.label) && /Friday/.test(b.label));
        d.trips = wk ? wk.times.length : Math.max(0, ...blocks.map((b) => b.times.length));
        return {
          key: d.key,
          title: d.title,
          sign: d.sign,
          direction: d.direction,
          routes: d.routes,
          codes: d.codes,
          color: d.color,
          blocks,
          notes: d.notes,
          trips: d.trips,
        };
      });
      // busiest destination first; its routes stay together, in route order
      const busiest = new Map();
      for (const x of dests) busiest.set(x.key, Math.max(busiest.get(x.key) || 0, x.trips));
      dests.sort(
        (a, b) =>
          busiest.get(b.key) - busiest.get(a.key) ||
          (a.key < b.key ? -1 : a.key > b.key ? 1 : 0) ||
          S.compareBoardCodes(a.routes[0], b.routes[0])
      );
      return dests;
    }

    function headingNote(h) {
      const note = h && h.destNote;
      if (!note) return "";
      if (note.type === "terminus") {
        const code = String(note.stopCode || "");
        if (code === "2916" || code === "10004") return ""; // shown on the diagram instead
        return `${note.lead || ""}${note.stopName || ""} (Stop #${code}).`.trim();
      }
      if (note.type === "headsign" && note.headsign) {
        return `Underlined trips follow the same route but operate under the headsign ${note.headsign}.`;
      }
      return "";
    }

    // ----------------------------------------------------------- diagram
    function transfersFor(ctx, code, routeNames, clusterSet, boardsFor, opts, arrivals) {
      const same = new Map();
      const others = new Map();
      for (const rn of routeNames) {
        const x = S.transfersForStop(
          code,
          rn,
          opts.radius,
          ctx.served,
          // `fromSpans`: at a stop where the trips end, the check uses their arrival times
          { excludeSchool: !!opts.excludeSchool, fromSpans: arrivals ? arrivals.get(low(rn)) : null },
          boardsFor(rn)
        );
        for (const r of x.same) if (!clusterSet.has(low(r.n))) same.set(r.n, r);
        for (const o of x.others) {
          if (clusterSet.has(low(o.r.n))) continue;
          const prev = others.get(o.r.n);
          if (!prev || o.d < prev.d) others.set(o.r.n, o);
        }
      }
      const xfer = {
        same: [...same.values()].sort((a, b) => S.compareBoardCodes(a.n, b.n)),
        others: [...others.values()].sort((a, b) => a.d - b.d || S.compareBoardCodes(a.r.n, b.r.n)),
      };
      return S.transferGroups(xfer).map((g) => ({
        routes: g.routes.map((r) => ({ n: r.n, c: r.c || fallbackColor(r.n), t: r.t || "#FFFFFF" })),
        walk: g.code ? S.roundFeetUp10(g.d) : null,
        code: g.code ? String(g.code) : null,
      }));
    }

    function buildItems(ctx, poster, opts) {
      const geo = ctx.served.geo || {};
      const clusterSet = new Set(poster.routeNames.map(low));
      const items = [];
      const byCode = new Map();
      for (const row of poster.rows) {
        if (row.type === "stop") {
          const codes = row.alsoCodes && row.alsoCodes.length ? row.alsoCodes : [row.code];
          const it = {
            code: String(row.code),
            codes,
            min: S.displayMinute(row.minutes),
            name: (geo[codes[0]] && geo[codes[0]].n) || codes[0],
            id: codes[0],
            also: codes.slice(1).map((c) => ({ name: (geo[c] && geo[c].n) || c, id: c })),
            only: row.onlyBoards && row.onlyBoards.length ? row.onlyBoards : null,
            chips: [],
            note: "",
            xferCodes: row.xferCodes || codes,
          };
          if (row.departMinutes != null && S.displayMinute(row.departMinutes) !== it.min) {
            it.note = `Layover: departs ${S.displayMinute(row.departMinutes)}\u2019 from here`;
          }
          items.push(it);
          byCode.set(String(row.code), it);
          for (const c of codes) byCode.set(String(c), it);
        } else if (row.type === "end") {
          const it = byCode.get(String(row.at)) || items[items.length - 1];
          if (!it) continue;
          for (const b of row.boards || (row.board ? [row.board] : [])) {
            const s = sign(b);
            if (s && !it.chips.includes(s)) it.chips.push(s);
          }
          if (row.kind === "closeTerminus") {
            // The other stop is listed under this one ("or ..."), with when trips end there
            const when = String(row.eveningWhen || "on evenings and weekends").replace(/^on\s+/i, "");
            it.alsoWhen = `(${when.charAt(0).toUpperCase()}${when.slice(1)})`;
          }
        }
      }

      // Lanes: tagged runs that end in a terminal and are followed by more
      // stops are side branches; tagged runs that rejoin the line are marked
      // with a letter instead.
      const keyOf = (it) => (it.only ? it.only.map((b) => normDest(b.dest)).sort().join("|") : "");
      const markers = [];
      let i = 0;
      while (i < items.length) {
        const it = items[i];
        if (!it.only) {
          i++;
          continue;
        }
        const key = keyOf(it);
        let j = i;
        while (j + 1 < items.length && items[j + 1].only && keyOf(items[j + 1]) === key) j++;
        const tail = items[j];
        const tagged = new Set(it.only.map((b) => normDest(b.dest)));
        const ends = tail.chips.some((c) => tagged.has(normDest(c)));
        const more = j < items.length - 1;
        if (ends && more) {
          for (let k = i; k <= j; k++) items[k].lane = 1;
          items[i].spurStart = true;
        } else if (!ends && more && j > i) {
          // A branch that leaves the line and comes back: draw it in the side
          // lane and run it back into the main line.
          for (let k = i; k <= j; k++) items[k].lane = 1;
          items[i].spurStart = true;
          tail.rejoin = true;
        } else if (!ends) {
          let m = markers.find((x) => x.key === key);
          if (!m) {
            m = { key, letter: String.fromCharCode(97 + markers.length), signs: [...new Set(it.only.map(sign))], titles: [...new Set(it.only.map(pretty))] };
            markers.push(m);
          }
          for (let k = i; k <= j; k++) items[k].marker = m.letter;
        }
        i = j + 1;
      }

      // A rejoining branch leaves the line where the trips fork. Stops that only
      // the other branch serves (listed first because their minutes are larger)
      // move below it, and the branch minutes are squeezed so the column still
      // reads top to bottom: 37, 37, 37, 38 instead of 37, 38, 39, 40 before a 39.
      for (let a = 0; a < items.length; a++) {
        if (!items[a].spurStart || !items[a].lane) continue;
        let b = a;
        while (b + 1 < items.length && items[b + 1].lane && !items[b + 1].spurStart) b++;
        if (!items[b].rejoin) continue;
        let q = 0;
        while (a - q - 1 >= 0 && !items[a - q - 1].lane && items[a - q - 1].min > items[a].min) q++;
        if (!q) continue;
        const block = items.splice(a, b - a + 1);
        items.splice(a - q, 0, ...block);
        const lo = Math.max(block[0].min, items[a - q - 1] ? items[a - q - 1].min : 0);
        const nextMin = items[a - q + block.length].min;
        const hi = Math.max(lo, Math.min(block[block.length - 1].min, nextMin - 1));
        block.forEach((it, k) => (it.min = k === block.length - 1 ? hi : lo));
        a = a - q + block.length - 1;
      }

      // Long forks have no tags: the second branch simply starts over with a
      // smaller minute count. Find the stop it forks from (from the trips'
      // own stop lists) and move the branch before it into the side lane.
      for (let i = 1; i < items.length; i++) {
        const it = items[i];
        if (it.lane || it.spurStart || it.min >= items[i - 1].min - 1) continue;
        let parent = null;
        for (const inst of poster.insts) {
          const at = inst.remaining.indexOf(it.code);
          if (at >= 0) {
            parent = at === 0 ? String(poster.stopCode) : inst.remaining[at - 1];
            break;
          }
        }
        let f = parent == null ? -1 : items.findIndex((x) => x.code === parent);
        if (parent === String(poster.stopCode)) f = -1;
        let s = f + 1;
        while (s < i && items[s].lane) s++;
        if (s >= i) continue;
        for (let k = s; k < i; k++) items[k].lane = 1;
        items[s].spurStart = true;
        for (let k = s; k < i; k++) delete items[k].marker;
      }

      // Where the poster's trips only arrive (they end at this stop) there are no departures to
      // compare with, so the "is the other route still running?" check uses the arrival times:
      // the departures from the poster's stop plus each trip's ride time.
      const arrivalSpans = (code) => {
        const out = new Map();
        for (const rn of poster.routeNames) {
          const own = S.clockSpans(ctx.served.clock, code, rn, null);
          if (!ctx.served.clock || (own && own.length)) continue; // trips leave from here too
          const spans = [];
          for (const inst of poster.insts) {
            if (low(inst.r) !== low(rn)) continue;
            const at = inst.remaining.indexOf(String(code));
            if (at < 0) continue;
            const off = inst.minutes[at] || 0;
            // the departures at the poster's stop of the trips that end here (same sign)
            const dep = S.clockSpans(ctx.served.clock, poster.stopCode, rn, [inst.board]) || [];
            const sameSign = dep.filter((o) => normDest(o.dest) === normDest(inst.board && inst.board.dest));
            for (const o of sameSign.length ? sameSign : dep) {
              spans.push({ days: o.days, first: o.first + off, last: o.last + off });
            }
          }
          if (spans.length) out.set(low(rn), spans);
        }
        return out;
      };

      for (const it of items) {
        it.lane = it.lane || 0;
        it.terminal = it.chips.length > 0 && !it.rejoin;
        const boardsFor = () => it.only || poster.boards;
        const seen = new Map();
        for (const code of it.xferCodes) {
          for (const g of transfersFor(ctx, code, poster.routeNames, clusterSet, boardsFor, opts, arrivalSpans(code))) {
            const k = g.routes.map((r) => r.n).join(",") + "|" + (g.walk || "");
            if (!seen.has(k)) seen.set(k, g);
          }
        }
        it.groups = [...seen.values()];
        if (it.codes.length > 1) {
          // Two stops are shown as one (Junction / Junction at Park and Ride): a route
          // that serves either of them counts as being at this stop, not nearby.
          const own = new Set(it.codes.map(String));
          const hereRoutes = [];
          const rest = [];
          for (const g of it.groups) {
            if (g.walk == null || own.has(g.code)) {
              for (const r of g.routes) if (!hereRoutes.some((x) => x.n === r.n)) hereRoutes.push(r);
            } else rest.push(g);
          }
          const groups = [];
          if (hereRoutes.length) groups.push({ routes: hereRoutes, walk: null, code: null });
          for (const g of rest) {
            const routes = g.routes.filter((r) => !hereRoutes.some((x) => x.n === r.n));
            if (routes.length) groups.push({ ...g, routes });
          }
          it.groups = groups;
        }
        delete it.only;
        delete it.xferCodes;
        delete it.codes;
      }
      return { items, markers };
    }

    // ----------------------------------------------------------- public
    /**
     * @returns {Array} poster configs (see poster-core.js)
     */
    function build(ctx, stopCode, routeNames, opts) {
      opts = Object.assign({ excludeSchool: true, merge: true, radius: TRANSFER_FEET }, opts || {});
      const code = String(stopCode);
      const entry = ctx.byCode[code];
      if (!entry) throw new Error(`No data for stop ${code}.`);
      const want = new Set((routeNames || []).map(low));
      if (!want.size) throw new Error("Pick at least one route.");

      let instances = S.patternsForStop(ctx.served, code).filter((i) => want.has(low(i.r)));
      if (opts.excludeSchool) instances = instances.filter((i) => !(ctx.routeByName.get(i.r) || {}).s);
      // A trip that has no timetable heading at this stop cannot be boarded here (the lone
      // Eagle Heights run, B trips to Kennedy that only drop off): leave it out of the
      // diagram too, so it is not drawn as a destination.
      const boardableHere = instances.filter((i) => canBoardHere(entry, i));
      if (boardableHere.length) instances = boardableHere;
      if (!instances.length) {
        throw new Error(`No departures from stop ${code} on the selected route${want.size > 1 ? "s" : ""}.`);
      }
      const groups = S.posterKeyGroups(instances, ctx.routeByName);
      const clusters = clusterGroups(groups, opts);

      const stop = entry.stop || {};
      const geo = (ctx.served.geo && ctx.served.geo[code]) || {};
      const streetLabel = S.streetDirectionLabel({
        cardinal_direction: stop.cardinal_direction != null ? stop.cardinal_direction : geo.cd,
        primary_street: stop.primary_street || geo.street,
      });
      const feed = entry.feed || ctx.served.feed || {};
      const valid = `${formatFeedDate(feed.feed_start_date)} \u2013 ${formatFeedDate(feed.feed_end_date)}`;

      const posters = [];
      for (const cluster of clusters) {
        const first = cluster[0];
        const clusterInsts = cluster.flatMap((g) => g.instances);
        for (const insts of S.partitionPosters(clusterInsts)) {
          const merged = S.applyIgnoredTermini(
            S.applyCloseTermini(S.mergeInstances(insts), first.routeName),
            first.routeName
          );
          const rows = S.smoothMinuteOrder(merged.rows);
          if (!rows.some((r) => r.type === "stop")) continue;

          const boards = insts.map((i) => i.board).filter(Boolean);
          const routeNamesHere = [...new Set(insts.map((i) => i.r))].sort(S.compareBoardCodes);
          const titleCodes = new Set(
            cluster
              .filter((g) => insts.some((i) => g.instances.includes(i)))
              .map((g) => g.titleCode)
          );
          const poster = {
            rows,
            boards,
            routeNames: routeNamesHere,
            titleCodes,
            insts,
            stopCode: code,
            firstRoute: first.routeName,
            firstDir: first.dirId,
          };
          const heading = S.routeHeading(code, rows, ctx.served.geo || {}, "");
          const headings = headingsFor(ctx, code, new Set(routeNamesHere.map(low)), poster, groups);
          const dests = buildDests(ctx, headings, heading ? heading[0].toUpperCase() + heading.slice(1) : "");
          if (!dests.length) {
            // No timetable matched (rare data gap): fall back to the stop list's own signs.
            for (const b of boards) {
              const k = normDest(b.dest);
              if (!dests.some((d) => d.key === k)) {
                dests.push({
                  key: k,
                  title: pretty(b),
                  sign: sign(b),
                  direction: heading ? heading[0].toUpperCase() + heading.slice(1) : "",
                  routes: routeNamesHere,
                  color: routeColorOf(ctx, routeNamesHere[0]),
                  blocks: [],
                  notes: [],
                  trips: 0,
                });
              }
            }
          }
          const { items, markers } = buildItems(ctx, poster, opts);

          // How far each destination goes: the last stop where its sign ends.
          for (const dd of dests) {
            let reach = -1;
            items.forEach((it, k) => {
              if (it.chips.some((c) => normDest(c) === normDest(dd.sign))) reach = k;
            });
            dd.reach = reach;
          }
          // Two signs at one stop where one is "X via Y": show only the plain "X".
          for (const it of items) {
            if (it.chips.length < 2) continue;
            it.chips = it.chips.filter(
              (c) => !it.chips.some((o) => o !== c && normDest(c).startsWith(normDest(o) + " VIA "))
            );
          }
          // readable names of the same signs (used when headboard signs are switched off)
          for (const it of items) it.chipTitles = it.chips.map((c) => S.prettyDest(c));

          const tiles = [];
          for (const g of cluster) {
            if (!titleCodes.has(g.titleCode)) continue;
            if (tiles.some((t) => t.label === g.titleCode)) continue;
            tiles.push({ label: String(g.titleCode), color: routeColorOf(ctx, g.routeName), route: g.routeName });
          }
          // Trips with a plain code (R, going to Segoe) that run on a numbered poster (R1)
          // get their own tile, so both codes show in the header and on their band.
          for (const dd of dests) {
            for (const c of dd.codes || []) {
              if (tiles.some((t) => t.label === c)) continue;
              const rn = dd.routes[0];
              if (rn && c.toUpperCase().startsWith(String(rn).toUpperCase())) {
                tiles.push({ label: c, color: routeColorOf(ctx, rn), route: rn });
              }
            }
          }
          tiles.sort((a, b) => S.compareBoardCodes(a.label, b.label));
          for (const dd of dests) {
            dd.tiles = (dd.codes || []).filter((c) => tiles.some((t) => t.label === c));
          }

          const schoolRoute = (ctx.routeByName.get(String(first.routeName)) || {}).s;
          posters.push({
            // School runs with identical stop lists share one poster (merged below)
            _schoolKey: schoolRoute
              ? `${first.routeName}|${first.dirId}|${items.map((it) => `${it.id}:${it.lane}:${it.chips.join("/")}`).join(",")}`
              : null,
            routes: tiles,
            routeNames: routeNamesHere,
            stopName: stop.stop_name || geo.n || code,
            stopId: code,
            startsHere: insts.every((i) => i.before === 0),
            street: streetLabel ? `on ${streetLabel}` : "",
            direction: heading ? heading[0].toUpperCase() + heading.slice(1) : "",
            qr: entry.qrBits ? { bits: entry.qrBits, url: `https://metromap.cityofmadison.com/predictions/bystop/bustime:${code}` } : null,
            valid,
            validFrom: longFeedDate(feed.feed_start_date),
            validTo: longFeedDate(feed.feed_end_date),
            gtfs: feed.feed_version || (ctx.served.feed && ctx.served.feed.v) || "",
            dests,
            items,
            markers,
          });
        }
      }
      if (!posters.length) throw new Error(`No remaining stops from ${code} on the selected route.`);
      return mergeSchoolPosters(posters);
    }

    /** School runs (one code each) that serve the same stops become one poster. */
    function mergeSchoolPosters(list) {
      const out = [];
      const byKey = new Map();
      for (const p of list) {
        const key = p._schoolKey;
        delete p._schoolKey;
        const m = key ? byKey.get(key) : null;
        if (!m) {
          out.push(p);
          if (key) byKey.set(key, p);
          continue;
        }
        for (const t of p.routes) if (!m.routes.some((x) => x.label === t.label)) m.routes.push(t);
        m.routes.sort((a, b) => S.compareBoardCodes(a.label, b.label));
        for (const n of p.routeNames) if (!m.routeNames.includes(n)) m.routeNames.push(n);
        for (const pd of p.dests) {
          const md = m.dests.find((x) => x.key === pd.key && x.routes.join(",") === pd.routes.join(","));
          if (!md) {
            m.dests.push(pd);
            continue;
          }
          for (const c of pd.codes || []) if (!md.codes.includes(c)) md.codes.push(c);
          md.tiles = [...new Set([...(md.tiles || []), ...(pd.tiles || [])])].sort(S.compareBoardCodes);
          for (const n of pd.notes || []) if (!md.notes.includes(n)) md.notes.push(n);
          for (const pb of pd.blocks) {
            const mb = md.blocks.find((x) => x.label === pb.label);
            if (!mb) {
              md.blocks.push(pb);
              continue;
            }
            const seen = new Set(mb.times.map((t) => `${t[0]}:${t[1]}`));
            for (const t of pb.times) if (!seen.has(`${t[0]}:${t[1]}`)) mb.times.push(t);
            mb.times.sort((a, b) => minuteOf(a[0], a[1]) - minuteOf(b[0], b[1]));
          }
          const wk = md.blocks.find((b) => /Monday/.test(b.label) && /Friday/.test(b.label));
          md.trips = wk ? wk.times.length : Math.max(0, ...md.blocks.map((b) => b.times.length));
          md.reach = Math.max(md.reach, pd.reach);
        }
      }
      return out;
    }

    return { prepare, build, clusterGroups, fallbackColor };
  }

  return { create, fallbackColor };
});
