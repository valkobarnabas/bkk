/**
 * BKK-style stop poster renderer.
 *
 *   const { svg, width, height, info } = BKKPoster.render(cfg, { logo: dataUri });
 *
 * `cfg` comes from adapter.js (see the object it returns). The renderer
 * measures text with the bundled Fira Sans metrics, searches for the smallest
 * page that fits the stop diagram and the time boxes, and returns one SVG.
 * Coordinates inside this file follow the old reportlab layout: the origin is
 * the bottom-left corner of the page, y grows upward. The Doc helper flips
 * them when it writes SVG.
 *
 * Works in Node and in the browser (no DOM access).
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory(require("./font-metrics.js"));
  else root.BKKPoster = factory(root.BKK_FONT_METRICS);
})(typeof globalThis !== "undefined" ? globalThis : this, function (METRICS) {
  "use strict";

  // ------------------------------------------------------------ constants
  const MBLUE = "#2272B5";
  const NAVY = "#333366";
  const NAVY_DARK = "#1d1b45";
  const BAR_BG = "#131747"; // stop bar background
  const BAR_BG_DIM = "#090a26"; // ... for navy routes
  const AMBER = "#f5a623";
  const LED_BG = "#0c0c0c";
  const PM_FILL = "#d6d6d6";
  const INK = "#111111";
  const GREY = "#666666";
  const DGREY = "#444444";
  const YELLOW = "#ffd200";
  const WHITE = "#ffffff";
  const BLACK = "#000000";

  const DASH_LEN = 1.8; // "continues" dashes on the route line
  const DASH_PITCH = 2.8;
  const PORTRAIT_MIN = 0.5; // fit-to-letter stays upright unless it must shrink below this
  const LETTER_W = 612; // US Letter, points
  const LETTER_H = 792;
  const M = 28; // page margin
  const COL_W0 = 238; // diagram column width (default)
  const RW0 = 294; // time-table column width (default)
  const COL_PITCH0 = () => COL_W0 + 16;
  let COL_W = COL_W0; // current widths: see setGeo()
  let COL_PITCH = COL_W + 16;
  let RW = RW0;
  const LINE_REL = 34; // route line x, relative to the column
  const SPUR_REL = LINE_REL + 26;
  const FOOT_TOP = M + 2 + 64; // top of the footer boxes
  const DIAG_BOTTOM = FOOT_TOP + 18; // lowest y a diagram row may reach

  const WALK_PATHS = [
    "M9.5 1.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0M6.44 3.752A.75.75 0 0 1 7 3.5h1.445c.742 0 1.32.643 1.243 1.38l-.43 4.083a1.8 1.8 0 0 1-.088.395l-.318.906.213.242a.8.8 0 0 1 .114.175l2 4.25a.75.75 0 1 1-1.357.638l-1.956-4.154-1.68-1.921A.75.75 0 0 1 6 8.96l.138-2.613-.435.489-.464 2.786a.75.75 0 1 1-1.48-.246l.5-3a.75.75 0 0 1 .18-.375l2-2.25Z",
    "M6.25 11.745v-1.418l1.204 1.375.261.524a.8.8 0 0 1-.12.231l-2.5 3.25a.75.75 0 1 1-1.19-.914zm4.22-4.215-.494-.494.205-1.843.006-.067 1.124 1.124h1.44a.75.75 0 0 1 0 1.5H11a.75.75 0 0 1-.531-.22Z",
  ];

  // ------------------------------------------------------------ text metrics
  function sw(text, font, size) {
    const m = METRICS[font];
    let w = 0;
    for (const ch of String(text)) {
      const a = m.adv[ch.codePointAt(0)];
      w += a == null ? m.def : a;
    }
    return (w * size) / m.upm;
  }

  function ledWidth(text, fs = 6.2, track = 0.55) {
    let w = 0;
    for (const ch of String(text)) w += sw(ch, "LED", fs) + track;
    return w - track + 8;
  }

  /** Shrink (then truncate) an LED sign so it fits `maxW`. */
  function fitLed(text, maxW, fs, track, minFs) {
    let f = fs;
    while (ledWidth(text, f, track) > maxW && f > minFs) f = Math.round((f - 0.2) * 10) / 10;
    let t = String(text);
    while (ledWidth(t, f, track) > maxW && t.length > 3) t = t.slice(0, -2);
    if (t !== text) t = t.replace(/\s+$/, "") + "\u2026";
    return { text: t, fs: f };
  }

  function wrapText(text, font, size, maxW, maxLines) {
    const words = String(text).split(/\s+/).filter(Boolean);
    const lines = [];
    let cur = "";
    for (const w of words) {
      const t = cur ? cur + " " + w : w;
      if (!cur || sw(t, font, size) <= maxW) cur = t;
      else {
        lines.push(cur);
        cur = w;
      }
    }
    if (cur) lines.push(cur);
    if (maxLines && lines.length > maxLines) {
      const keep = lines.slice(0, maxLines);
      keep[maxLines - 1] = ellipsize(lines.slice(maxLines - 1).join(" "), font, size, maxW);
      return keep;
    }
    return lines;
  }

  /** Stop names: when a name must wrap, break right after "at" ("Junction at / Park And Ride")
   *  instead of mid-way through the cross street, as long as that costs no extra lines. */
  function wrapName(text, font, size, maxW, maxLines) {
    const plain = wrapText(text, font, size, maxW, maxLines);
    if (plain.length < 2) return plain;
    const words = String(text).split(/\s+/).filter(Boolean);
    // try each "at" (first one first), keeping the first break that fits
    for (let i = 1; i < words.length - 1; i++) {
      if (!/^at$/i.test(words[i])) continue;
      const head = words.slice(0, i + 1).join(" ");
      if (sw(head, font, size) > maxW) continue;
      const rest = wrapText(words.slice(i + 1).join(" "), font, size, maxW);
      const cand = [head, ...rest];
      if (cand.length <= plain.length) return maxLines && cand.length > maxLines ? plain : cand;
    }
    return plain;
  }

  function ellipsize(text, font, size, maxW) {
    let t = String(text);
    if (sw(t, font, size) <= maxW) return t;
    while (t.length > 1 && sw(t + "\u2026", font, size) > maxW) t = t.slice(0, -1);
    return t.replace(/\s+$/, "") + "\u2026";
  }

  // ------------------------------------------------------------ colors
  function hexToRgb(hex) {
    const h = String(hex || NAVY).replace("#", "");
    const v = h.length === 3 ? h.replace(/./g, "$&$&") : h.padEnd(6, "0");
    return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
  }
  function rgbToHex(r, g, b) {
    return "#" + [r, g, b].map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0")).join("");
  }
  /** Light tint of a route color: `a` is the share of the route color (0..1). */
  function tint(hex, a) {
    const [r, g, b] = hexToRgb(hex);
    return rgbToHex(255 - (255 - r) * a, 255 - (255 - g) * a, 255 - (255 - b) * a);
  }

  function norm(hex) {
    return String(hex || "").toLowerCase();
  }

  // ------------------------------------------------------------ SVG writer
  const FONT_CLASS = { "F-Reg": "fr", "F-Med": "fm", "F-Semi": "fs", "F-Bold": "fb", "F-Ital": "fi", LED: "led" };
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const n2 = (v) => Math.round(v * 100) / 100;

  class Doc {
    constructor(w, h) {
      this.w = w;
      this.h = h;
      this.out = [];
    }
    Y(y) {
      return n2(this.h - y);
    }
    attrs(o) {
      let s = "";
      s += ` fill="${o.fill || "none"}"`;
      if (o.stroke) s += ` stroke="${o.stroke}" stroke-width="${o.sw == null ? 1 : o.sw}"`;
      if (o.cap) s += ` stroke-linecap="${o.cap}"`;
      if (o.dash) s += ` stroke-dasharray="${o.dash}"`;
      return s;
    }
    rect(x, y, w, h, o = {}) {
      const r = o.r ? ` rx="${o.r}"` : "";
      this.out.push(`<rect x="${n2(x)}" y="${this.Y(y + h)}" width="${n2(w)}" height="${n2(h)}"${r}${this.attrs(o)}/>`);
    }
    circle(cx, cy, r, o = {}) {
      this.out.push(`<circle cx="${n2(cx)}" cy="${this.Y(cy)}" r="${n2(r)}"${this.attrs(o)}/>`);
    }
    line(x1, y1, x2, y2, o = {}) {
      this.out.push(
        `<line x1="${n2(x1)}" y1="${this.Y(y1)}" x2="${n2(x2)}" y2="${this.Y(y2)}"${this.attrs({ ...o, fill: "none" })}/>`
      );
    }
    /** cmds: ["M",x,y] ["L",x,y] ["C",x1,y1,x2,y2,x,y] ["Z"], in page coordinates */
    path(cmds, o = {}) {
      let d = "";
      for (const c of cmds) {
        d += c[0];
        for (let i = 1; i < c.length; i += 2) d += `${n2(c[i])} ${this.Y(c[i + 1])} `;
      }
      this.out.push(`<path d="${d.trim()}"${this.attrs(o)}/>`);
    }
    text(x, y, str, font, size, fill, o = {}) {
      if (str === "" || str == null) return;
      const anchor = o.anchor ? ` text-anchor="${o.anchor}"` : "";
      const sp = o.spacing ? ` letter-spacing="${o.spacing}"` : "";
      this.out.push(
        `<text class="${FONT_CLASS[font]}" x="${n2(x)}" y="${this.Y(y)}" font-size="${size}" fill="${fill}"${anchor}${sp}>${esc(str)}</text>`
      );
    }
    raw(s) {
      this.out.push(s);
    }
  }

  // ------------------------------------------------------------ primitives
  const NEAR_PAD = 0.55; // outline of a "near" transfer sits this far outside the square
  const NEAR_DASH = "2.1 1.15";
  const badgeW = (label, fs = 7.6) => Math.max(sw(label, "F-Bold", fs) + 4.4, 11.5);

  function badge(d, x, y, r, h = 10.5, fs = 7.6) {
    const label = r.n;
    const w = badgeW(label, fs);
    // plain-transfers mode: a dashed black outline, just outside the square (so it
    // shows up on navy routes too), marks routes that are not at this stop
    if (r.near) d.rect(x - NEAR_PAD, y - h / 2 - NEAR_PAD, w + 2 * NEAR_PAD, h + 2 * NEAR_PAD, { stroke: BLACK, sw: 0.95, dash: NEAR_DASH });
    d.rect(x, y - h / 2, w, h, { fill: r.c });
    d.text(x + w / 2, y - fs * 0.35, label, "F-Bold", fs, r.t || WHITE, { anchor: "middle" });
    return x + w + 1.8;
  }

  function walker(d, x, y, s, col) {
    const k = s / 16;
    const top = d.Y(y + s);
    d.raw(
      `<g transform="translate(${n2(x)} ${top}) scale(${n2(k * 1000) / 1000})" fill="${col}">` +
        WALK_PATHS.map((p) => `<path d="${p}"/>`).join("") +
        "</g>"
    );
  }

  function ledChip(d, x, y, text, h = 11, fs = 6.2, track = 0.55) {
    const w = ledWidth(text, fs, track);
    d.rect(x, y - h / 2, w, h, { fill: LED_BG, r: 2 });
    d.text(x + 4, y - fs * 0.34, text, "LED", fs, AMBER, { spacing: track });
    return x + w;
  }

  function triangleRight(d, x, y, h, col) {
    d.path([["M", x, y - h / 2], ["L", x, y + h / 2], ["L", x + h * 0.9, y], ["Z"]], { fill: col });
  }

  // Transfer row layout: groups of route badges, "+" between groups, and a
  // walking distance after groups that are not at this stop. Wraps lines.
  function groupWidth(g) {
    let w = 0;
    for (const r of g.routes) w += badgeW(r.n) + 1.8;
    if (g.walk) w += 11.2 + sw(`${g.walk} ft`, "F-Reg", 6.6) + 3;
    return w;
  }

  function layoutTransfers(groups, x0, xmax) {
    const lines = [[]];
    let x = x0;
    const cur = () => lines[lines.length - 1];
    const wrap = () => {
      lines.push([]);
      x = x0;
    };
    groups.forEach((g, gi) => {
      const gw = groupWidth(g);
      const plus = gi > 0 ? 8.5 : 0;
      if (gi > 0 && x > x0 && x + plus + gw > xmax) wrap();
      if (gi > 0) {
        cur().push({ t: "plus", x });
        x += plus;
      }
      g.routes.forEach((r, ri) => {
        const bw = badgeW(r.n) + 1.8 + (r.near ? 1.2 : 0);
        const last = ri === g.routes.length - 1;
        const need = bw + (last && g.walk ? 11.2 + sw(`${g.walk} ft`, "F-Reg", 6.6) + 3 : 0);
        const gap = r.gap && x > x0 ? 5 : 0; // plain mode: space between at-stop and nearby routes
        if (x > x0 && x + gap + need > xmax) wrap();
        else x += gap;
        cur().push({ t: "badge", x, r });
        x += bw;
      });
      if (g.walk) {
        cur().push({ t: "walk", x, ft: g.walk });
        x += 11.2 + sw(`${g.walk} ft`, "F-Reg", 6.6) + 3;
      }
    });
    return { lines, endX: x };
  }

  function drawTransferLine(d, items, y) {
    for (const it of items) {
      if (it.t === "plus") {
        d.text(it.x + 0.5, y - 2.8, "+", "F-Bold", 8, DGREY);
      } else if (it.t === "badge") {
        badge(d, it.x, y, it.r);
      } else {
        walker(d, it.x + 0.6, y - 4.9, 9.8, DGREY);
        d.text(it.x + 11.2, y - 2.3, `${it.ft} ft`, "F-Reg", 6.6, DGREY);
      }
    }
  }

  // ------------------------------------------------------------ time labels
  const isRoll = (h) => h >= 24 || h < 4;
  function fmtTime(h, m) {
    const h24 = ((h % 24) + 24) % 24;
    return { label: `${h24 % 12 || 12}:${String(m).padStart(2, "0")}`, pm: h24 >= 12 && !isRoll(h), roll: isRoll(h) };
  }

  // ------------------------------------------------------------ item measuring
  const NAME_FS = 10;
  const NAME_PITCH = 11.5;
  const XFER_PITCH = 12.5;
  const ALSO_GAP = 3.2; // extra space between a boxed terminus and its "or ..." stop

  /**
   * Work out what one stop needs: wrapped name lines, transfer lines, LED
   * chips, notes, and how far below the dot the content reaches. All x values
   * are relative to the column.
   */
  function measureItem(it, isFinal) {
    const lane = it.lane ? SPUR_REL : LINE_REL;
    const nx = lane + 14;
    const xmax = COL_W - 2;
    const font = isFinal && !it.lane ? "F-Bold" : "F-Semi";
    const idTxt = `#${it.id}`;
    let idW = sw(idTxt, "F-Reg", 7) + 4;
    if (it.marker) idW += 11;

    let fs = NAME_FS;
    let lines = wrapName(it.name, font, fs, xmax - nx - idW);
    while ((lines.length > 2 || lines.some((l) => sw(l, font, fs) > xmax - nx - idW)) && fs > 8.5) {
      fs -= 0.5;
      lines = wrapName(it.name, font, fs, xmax - nx - idW);
    }
    if (lines.length > 3) lines = wrapName(it.name, font, fs, xmax - nx - idW, 3);
    lines = lines.map((l) => ellipsize(l, font, fs, xmax - nx - (l === lines[lines.length - 1] ? idW : 0)));

    const also = [];
    for (const a of it.also || []) {
      // wraps onto a second line rather than being cut off; the id follows the last line
      const room = xmax - nx - sw(`#${a.id}`, "F-Reg", 6.4) - 4;
      const ls = wrapName(`or ${a.name}`, "F-Semi", 8.6, room, 2);
      ls.forEach((text, li) => also.push({ text, id: li === ls.length - 1 ? a.id : null }));
    }
    // when trips end at the other stop: small italic lines right under it (3/4 line each)
    let nameLines = lines.length + also.length + (also.length ? ALSO_GAP / NAME_PITCH : 0);
    if (also.length && it.alsoWhen) {
      for (const l of wrapText(it.alsoWhen, "F-Ital", 7, xmax - nx, 2)) {
        also.push({ text: l, sub: true });
        nameLines += 0.72;
      }
    }

    // transfers, then chips
    const xf = it.groups && it.groups.length ? layoutTransfers(it.groups, nx, xmax) : null;
    let k = nameLines - 1; // index of the last occupied line, in name-line units
    const L = { lane, nx, font, fs, lines, also, idTxt, xf, chips: [], noteLines: [], nameLines };
    let bottom = 9 + NAME_PITCH * (nameLines - 1);
    let yOff = 15 + NAME_PITCH * (nameLines - 1); // center of the first transfer/chip line
    let used = 0; // lines used below the name
    let endX = nx - 6;
    if (xf) {
      used = xf.lines.length;
      endX = xf.endX;
      bottom = yOff + XFER_PITCH * (used - 1) + 5.4;
    }
    let curLine = xf ? used - 1 : -1; // transfer line index the chips continue on
    let cx = xf ? endX : nx - 6;
    for (const sign of it.chips || []) {
      const cw = ledWidth(sign);
      if (curLine < 0 || cx + 6 + cw > xmax) {
        curLine += 1;
        cx = nx - 6;
      }
      L.chips.push({ sign, x: cx + 6, line: curLine, w: cw });
      cx = cx + 6 + cw;
      bottom = Math.max(bottom, yOff + XFER_PITCH * curLine + 5.9);
    }
    L.yOff = yOff;
    if (it.note) {
      L.noteLines = wrapText(it.note, "F-Ital", 6.6, xmax - nx, 3);
      const first = Math.max(bottom, 9 + NAME_PITCH * (nameLines - 1)) + 3;
      L.noteY = first + 3.8;
      bottom = first + L.noteLines.length * 8.6;
    }
    L.bottom = bottom;
    L.need = Math.max(24, bottom + 15.7);
    L.minNeed = L.need - 7;
    return L;
  }

  // ------------------------------------------------------------ header
  function headerLayout(cfg, W) {
    const n = cfg.routes.length;
    const qx = W - M - 62;
    const tiles = [];
    let right;
    const tileFs = (label, w, h, max) => {
      let f = max;
      while (sw(label, "F-Bold", f) > w - 10 && f > 9) f -= 1;
      return f;
    };
    if (n <= 3) {
      const w = Math.min(82, (196 - 6 * (n - 1)) / n);
      for (let i = 0; i < n; i++) {
        const t = cfg.routes[i];
        tiles.push({ t, x: M + i * (w + 6), y: 0, w, h: 58, fs: tileFs(t.label, w, 58, 42), r: 9 });
      }
      right = M + n * w + (n - 1) * 6;
    } else {
      const perRow = Math.ceil(n / 2);
      const w = Math.min(56, (196 - 5 * (perRow - 1)) / perRow);
      cfg.routes.forEach((t, i) => {
        const row = Math.floor(i / perRow);
        const col = i % perRow;
        tiles.push({ t, x: M + col * (w + 5), y: row * 31, w, h: 27, fs: tileFs(t.label, w, 27, 21), r: 5 });
      });
      right = M + perRow * w + (perRow - 1) * 5;
    }
    const dx = right + 12;
    const textX = dx + 24;
    const maxW = qx - 14 - textX;
    // Header carets run from the destination that goes farthest to the nearest
    // (ties keep the busiest first).
    const sorted = cfg.dests
      .filter((x) => x.title)
      .map((x, i) => ({ x, i }))
      .sort((a, b) => (b.x.reach == null ? -1 : b.x.reach) - (a.x.reach == null ? -1 : a.x.reach) || a.i - b.i)
      .map((o) => o.x);
    // One caret per destination name (bands are split by route, titles repeat),
    // and "X via Y" is dropped when plain "X" is also listed.
    const names = new Set(sorted.map((x) => x.title.toLowerCase()));
    const seenTitles = new Set();
    const dests = sorted.filter((x) => {
      const t = x.title.toLowerCase();
      const viaOfOther = [...names].some((o) => o !== t && t.startsWith(o + " via "));
      if (viaOfOther || seenTitles.has(t)) return false;
      seenTitles.add(t);
      return true;
    });
    const main = dests[0] ? dests[0].title : cfg.stopName;
    const extras = dests.slice(1).map((x) => x.title);
    return { tiles, dx, textX, maxW, main, extras, qx };
  }

  function drawHeader(d, cfg, W, HB, RC) {
    const hl = headerLayout(cfg, W);
    for (const tl of hl.tiles) {
      d.rect(tl.x, HB + (tl.h === 27 ? 31 - tl.y : 0), tl.w, tl.h, { fill: tl.t.color, r: tl.r });
      const by = HB + (tl.h === 27 ? 31 - tl.y : 0);
      d.text(tl.x + tl.w / 2, by + tl.h / 2 - tl.fs * 0.35, tl.t.label, "F-Bold", tl.fs, tl.t.textColor || WHITE, {
        anchor: "middle",
      });
    }
    // extras: one per line (up to 3), otherwise packed into two lines
    let lines = [];
    const k = hl.extras.length;
    if (k <= 3) lines = hl.extras.slice();
    else {
      const sep = "  \u00B7  ";
      let cur = "";
      let shown = 0;
      for (let i = 0; i < k; i++) {
        const t = cur ? cur + sep + hl.extras[i] : hl.extras[i];
        if (!cur || sw(t, "F-Semi", 11.5) <= hl.maxW) {
          cur = t;
          shown = i + 1;
        } else {
          lines.push(cur);
          cur = hl.extras[i];
          shown = i + 1;
          if (lines.length === 2) {
            cur = "";
            shown = i;
            break;
          }
        }
      }
      if (cur && lines.length < 2) lines.push(cur);
      if (shown < k) lines[lines.length - 1] = ellipsize(lines[lines.length - 1] + `  \u00B7  +${k - shown} more`, "F-Semi", 11.5, hl.maxW);
    }
    lines = lines.slice(0, 3);
    const nl = lines.length;
    const xf = nl >= 3 ? 10.5 : nl === 2 ? 12 : 13;
    const pitch = nl >= 3 ? 11.6 : nl === 2 ? 15.5 : 0;

    // main title
    let titleFs = nl === 0 ? 29 : nl === 1 ? 29 : nl === 2 ? 26 : 20;
    const minFs = nl === 0 ? 20 : 17;
    let tl = [hl.main];
    while (sw(hl.main, "F-Bold", titleFs) > hl.maxW && titleFs > minFs) titleFs -= 0.5;
    if (sw(hl.main, "F-Bold", titleFs) > hl.maxW) {
      if (nl === 0) {
        // two-line title
        let f = 24;
        tl = wrapText(hl.main, "F-Bold", f, hl.maxW);
        while (tl.length > 2 && f > 14) {
          f -= 0.5;
          tl = wrapText(hl.main, "F-Bold", f, hl.maxW);
        }
        titleFs = f;
      }
      tl = tl.map((x) => ellipsize(x, "F-Bold", titleFs, hl.maxW));
    }
    let baseY;
    if (nl === 0) baseY = HB + 29 - titleFs * 0.35;
    else baseY = nl === 1 ? HB + 32 : nl === 2 ? HB + 37 : HB + 41.5;
    triangleRight(d, hl.dx, nl === 0 ? HB + 29 : nl >= 3 ? HB + 47.5 : HB + 40 + (nl === 1 ? 0 : 3), nl >= 3 ? 18 : 20, BLACK);
    if (tl.length === 2) {
      d.text(hl.textX, HB + 36, tl[0], "F-Bold", titleFs, BLACK);
      d.text(hl.textX, HB + 36 - titleFs * 1.08, tl[1], "F-Bold", titleFs, BLACK);
    } else {
      d.text(hl.textX, baseY, tl[0], "F-Bold", titleFs, BLACK);
    }
    lines.forEach((txt, i) => {
      const y = HB + (nl >= 3 ? 4.5 : 5.5) + (nl - 1 - i) * pitch;
      triangleRight(d, hl.dx + 3, y + (nl >= 3 ? 3.7 : 4.5), nl >= 3 ? 9 : 10, DGREY);
      d.text(hl.textX, y, ellipsize(txt, "F-Semi", xf, hl.maxW), "F-Semi", xf, "#222222");
    });
    return hl;
  }

  // ------------------------------------------------------------ QR
  function drawQr(d, cfg, hl, HB, logo) {
    if (!cfg.qr || !cfg.qr.bits) return;
    const bits = cfg.qr.bits;
    const n = Math.round(Math.sqrt(bits.length));
    const dim = n + 2;
    const qs = 62;
    const x = hl.qx;
    const y = HB - 2;
    let path = "";
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) if (bits[r * n + c] === "1") path += `M${c + 1} ${r + 1}h1v1h-1z`;
    }
    const k = qs / dim;
    const top = d.Y(y + qs);
    let g = `<g transform="translate(${n2(x)} ${top}) scale(${Math.round(k * 10000) / 10000})" shape-rendering="crispEdges">`;
    g += `<rect width="${dim}" height="${dim}" fill="#fff"/><path d="${path}" fill="${INK}"/>`;
    if (logo) {
      const lw = dim * 0.28;
      const o = (dim - lw) / 2;
      g += `<circle cx="${dim / 2}" cy="${dim / 2}" r="${n2(lw * 0.56)}" fill="#fff"/><image href="${logo}" x="${n2(o)}" y="${n2(o)}" width="${n2(lw)}" height="${n2(lw)}"/>`;
    }
    g += "</g>";
    d.raw(g);
    d.text(x + qs / 2, HB - 10, "LIVE DEPARTURES", "F-Bold", 4.8, INK, { anchor: "middle" });
  }

  // ------------------------------------------------------------ time tables
  const BAND_H = 26;
  const BAND_GAP = 6;
  const DAY_H = 23;
  const BGAP = 8;
  const DGAP = 16;
  let TCOL_PITCH = RW + 16;

  function legendHeight(cfg) {
    return (cfg.plainTransfers ? 70 : 92) + 17 * (cfg.markers ? cfg.markers.length : 0);
  }

  function noteLinesFor(dest) {
    const out = [];
    for (const n of dest.notes || []) for (const l of wrapText(n, "F-Ital", 7.2, RW - 2, 3)) out.push(l);
    return out;
  }

  const blockH = (b, cols, bh, gap) => {
    const rws = Math.ceil(b.times.length / cols) || 1;
    return DAY_H + rws * bh + (rws - 1) * gap;
  };

  /**
   * Flow destination bands, day blocks and the legend into `tcols` table
   * columns. A block is never split; when a destination continues in the
   * next column its band is drawn again. Returns null if it does not fit.
   */
  function flowTables(cfg, tcols, cols, bh, gap, avail, legH) {
    const dests = cfg.dests.filter((x) => x.blocks.length);
    const units = [];
    dests.forEach((dest, di) => {
      const nl = noteLinesFor(dest).length;
      dest.blocks.forEach((b, bi) => {
        const last = bi === dest.blocks.length - 1;
        units.push({
          kind: bi === 0 ? "head" : "block",
          dest,
          block: b,
          notes: last ? noteLinesFor(dest) : null,
          h: blockH(b, cols, bh, gap) + (last && nl ? 4 + nl * 8.8 : 0),
          newDest: bi === 0 && di > 0,
        });
      });
    });
    units.push({ kind: "legend", h: legH });
    const heightOf = (u) => u.h + (u.kind === "head" ? BAND_H + BAND_GAP : 0);

    const attempt = (soft) => {
      const out = [{ units: [], h: 0 }];
      for (const u of units) {
        let col = out[out.length - 1];
        const limit = u.kind === "legend" ? avail : Math.min(soft, avail);
        let gapBefore = 0;
        const needGap = () => {
          if (!col.units.length) return 0;
          if (u.kind === "legend") return 12;
          return u.newDest ? DGAP : u.kind === "block" ? BGAP : 0;
        };
        let hu = heightOf(u);
        gapBefore = needGap();
        if (col.h + gapBefore + hu > limit && col.units.length) {
          if (out.length >= tcols) return null;
          out.push({ units: [], h: 0 });
          col = out[out.length - 1];
          gapBefore = 0;
        }
        let repeat = false;
        if (u.kind === "block" && !col.units.length) {
          repeat = true;
          hu += BAND_H + BAND_GAP;
        }
        if (col.h + gapBefore + hu > avail) return null;
        col.units.push({ ...u, gapBefore, repeat });
        col.h += gapBefore + hu;
      }
      return out;
    };
    let total = 0;
    for (const u of units) total += heightOf(u) + 10;
    for (let soft = total / tcols; soft <= avail + 10; soft += 10) {
      const r = attempt(soft);
      if (r) return r;
    }
    return null;
  }

  function fitTables(cfg, avail, minFs, tcols) {
    const dests = cfg.dests.filter((x) => x.blocks.length);
    const legH = legendHeight(cfg) + 12;
    if (!dests.length) {
      const columns = flowTables(cfg, 1, 5, 35, 6, avail, legH);
      return columns ? { cols: 5, fs: 17, gap: 6, bw: (RW - 24) / 5, bh: 35, columns } : null;
    }
    let best = null;
    for (const cols of [5, 6, 7, 8]) {
      for (let f2 = 34; f2 >= minFs * 2; f2--) {
        const fsz = f2 / 2;
        const gap = fsz >= 16 ? 6 : fsz >= 13 ? 4 : 3;
        const bw = (RW - (cols - 1) * gap) / cols;
        const labelW = sw("12:39", "F-Bold", fsz);
        if (labelW + 9 > bw) continue;
        const bh = Math.round(fsz * 2);
        const columns = flowTables(cfg, tcols, cols, bh, gap, avail, legH);
        if (columns) {
          const cand = [fsz - 0.5 * (cols - 5), -cols];
          if (!best || cand[0] > best.cand[0] || (cand[0] === best.cand[0] && cand[1] > best.cand[1])) {
            best = { cand, cols, fs: fsz, gap, bw, bh };
          }
          break;
        }
      }
    }
    if (!best) return null;
    let { cols, fs, gap, bw, bh } = best;
    let columns = flowTables(cfg, tcols, cols, bh, gap, avail, legH);
    while (bh < fs * 2.4) {
      const more = flowTables(cfg, tcols, cols, bh + 1, gap, avail, legH);
      if (!more) break;
      bh += 1;
      columns = more;
    }
    return { cols, fs, gap, bw, bh, columns };
  }

  // ------------------------------------------------------------ diagram planning
  function gapsFor(items, Ls) {
    const gapC = [];
    const gapMin = [];
    for (let i = 0; i < items.length; i++) {
      const spur = items[i + 1] && items[i + 1].spurStart;
      gapC.push(Ls[i].need + (spur ? 12 : 0));
      gapMin.push(Ls[i].minNeed + (spur ? 8 : 0));
    }
    return { gapC, gapMin };
  }

  function allowedBreak(items, i) {
    return i > 0 && !items[i].lane;
  }

  /**
   * Split the stops into `ncols` columns (never inside a side branch).
   * Returns null if they do not fit. tau = 0 packs rows at their tightest
   * spacing, tau = 1 at their comfortable spacing.
   */
  function splitColumns(items, Ls, ncols, firstTop, otherTop, tau) {
    const { gapC, gapMin } = gapsFor(items, Ls);
    const gap = gapC.map((c, i) => gapMin[i] + tau * (c - gapMin[i]));
    const n = items.length;
    const pre = [0];
    for (let i = 0; i < n; i++) pre.push(pre[i] + (i < n - 1 ? gap[i] : 0));
    const top = (c) => (c === 0 ? firstTop : otherTop);
    // room between the first row's dot and the lowest row's dot of a column
    const room = (c, e) => top(c) - (DIAG_BOTTOM + Ls[e].bottom);
    const span = (s, e) => pre[e] - pre[s]; // gaps between rows s..e

    const attempt = (soft) => {
      const cols = [];
      let s = 0;
      for (let c = 0; c < ncols; c++) {
        if (c === ncols - 1 || s >= n) {
          if (s < n) {
            if (span(s, n - 1) > room(c, n - 1)) return null;
            cols.push({ s, e: n - 1 });
          }
          s = n;
          break;
        }
        let e = s;
        while (e + 1 < n && span(s, e + 1) <= Math.min(soft, room(c, e + 1))) e++;
        if (e < n - 1) {
          let b = e + 1;
          while (b > s && !allowedBreak(items, b)) b--;
          if (b <= s) return null;
          e = b - 1;
        }
        if (span(s, e) > room(c, e)) return null;
        cols.push({ s, e });
        s = e + 1;
      }
      return s >= n ? cols : null;
    };

    const total = pre[n];
    let cols = null;
    for (let soft = Math.max(total / ncols, 40); soft <= total + 400 && !cols; soft += 10) cols = attempt(soft);
    if (!cols) return null;
    return cols.map((col, c) => {
      let sc = 0;
      let sm = 0;
      for (let m = col.s; m < col.e; m++) {
        sc += gapC[m];
        sm += gapMin[m];
      }
      return { ...col, A: room(c, col.e), sc, sm };
    });
  }

  function placeRows(items, Ls, col, c, firstTop) {
    const { gapC, gapMin } = gapsFor(items, Ls);
    const ys = [];
    const { s, e, A, sc, sm } = col;
    let scale = 1;
    let t = 1;
    if (A >= sc) scale = sc > 0 ? Math.min(A / sc, 1.08) : 1;
    else t = sc - sm > 0 ? Math.max(0, (A - sm) / (sc - sm)) : 0;
    let y = firstTop;
    for (let i = s; i <= e; i++) {
      ys.push(y);
      if (i < e) {
        const g = A >= sc ? gapC[i] * scale : gapMin[i] + t * (gapC[i] - gapMin[i]);
        y -= g;
      }
    }
    return ys;
  }

  // ------------------------------------------------------------ planning
  function pageSize(dcols, tcols, H) {
    return { W: M + dcols * COL_PITCH + tcols * TCOL_PITCH - 16 + 8 + M, H };
  }

  function stopBar(cfg) {
    const avail = COL_W - (LINE_REL + 14) - 8;
    let fs = 13;
    while (sw(cfg.stopName, "F-Bold", fs) > avail && fs > 10.5) fs -= 0.5;
    if (sw(cfg.stopName, "F-Bold", fs) <= avail) return { fs, lines: [cfg.stopName], h: 40 };
    let f = 11.5;
    let lines = wrapName(cfg.stopName, "F-Bold", f, avail);
    while (lines.length > 2 && f > 9) {
      f -= 0.5;
      lines = wrapName(cfg.stopName, "F-Bold", f, avail);
    }
    lines = lines.slice(0, 2).map((l) => ellipsize(l, "F-Bold", f, avail));
    return { fs: f, lines, h: lines.length > 1 ? 52 : 40 };
  }

  /** Pick the smallest page where the diagram and the time boxes both fit. */
  /**
   * Option "plainTransfers": every transfer route is listed once, with no "+"
   * between groups and no walking distances; the key loses its walking row.
   */
  function withOptions(cfg, opts) {
    if (!opts.plainTransfers || cfg.plainTransfers) return cfg;
    const items = cfg.items.map((it) => {
      if (!it.groups || !it.groups.length) return it;
      const here = new Set();
      for (const g of it.groups) if (!g.walk) for (const r of g.routes) here.add(r.n);
      const seen = new Set();
      const routes = [];
      for (const g of it.groups) {
        for (const r of g.routes) if (!seen.has(r.n)) (seen.add(r.n), routes.push(here.has(r.n) ? r : { ...r, near: true }));
      }
      // routes at the stop first, then the outlined nearby ones with a little space before them
      const atStop = routes.filter((r) => !r.near);
      const nearby = routes.filter((r) => r.near);
      if (atStop.length && nearby.length) nearby[0] = { ...nearby[0], gap: true };
      routes.length = 0;
      routes.push(...atStop, ...nearby);
      return { ...it, groups: [{ routes }] };
    });
    return { ...cfg, items, plainTransfers: true };
  }

  // Column widths are fixed at their defaults, except when a poster is fitted
  // onto a letter sheet: then the columns are squeezed (or stretched a little)
  // so the page has exactly the shape of the sheet.
  function setGeo(g) {
    COL_W = g ? g.colW : COL_W0;
    RW = g ? g.rw : RW0;
    COL_PITCH = COL_W + 16;
    TCOL_PITCH = RW + 16;
  }

  const FIT_LIMITS = { colMin: 168, colMax: 260, rwMin: 200, rwMax: 340 };
  /** Column widths that fill a page `Wb` wide with nc diagram and tc table columns. */
  function fitGeo(Wb, nc, tc, lim) {
    const sum = Wb - 2 * M + 24 - 16 * (nc + tc); // nc * colW + tc * rw
    const f = sum / (nc * COL_W0 + tc * RW0);
    let colW = COL_W0 * f;
    let rw = RW0 * f;
    if (colW < lim.colMin) {
      colW = lim.colMin;
      rw = (sum - nc * colW) / tc;
    }
    if (rw < lim.rwMin) {
      rw = lim.rwMin;
      colW = (sum - tc * rw) / nc;
    }
    if (colW < lim.colMin - 0.01 || rw < lim.rwMin - 0.01) return null;
    return { colW: Math.min(colW, lim.colMax), rw: Math.min(rw, lim.rwMax) };
  }

  /** Narrowest table column that still holds the key without overflowing. */
  function legendMinWidth(cfg) {
    const R = 8.4;
    let w = 10 + sw("Key:", "F-Bold", 9.5) + 8 + 36 + 8 + 36 + 10;
    if (cfg.dests.some((x) => x.blocks.some((b) => b.times.some((t) => t[2])))) w += 8 + 40 + 6 + sw("see note", "F-Reg", 7.6);
    const rows = [10 + 52 + sw("Minutes of ride time from this stop", "F-Reg", R) + 10];
    if (cfg.plainTransfers) {
      rows.push(10 + 52 + sw("Transfer to routes at or", "F-Reg", R) + 4 + sw("near", "F-Reg", R) + 6 + 4 + sw("the listed stop", "F-Reg", R) + 10);
    } else {
      rows.push(10 + 52 + sw("Transfer to other routes at the listed stop", "F-Reg", R) + 10);
      rows.push(10 + 52 + sw("Walk to nearby transfer opportunity", "F-Reg", R) + 10);
    }
    return Math.ceil(Math.max(w, ...rows));
  }

  /**
   * Narrowest columns that show this poster's text without cutting it off:
   * LED signs in the diagram, the stop bar's "Stop #..., on ..." line, and the
   * heading + LED sign of each destination band.
   */
  function textNeeds(cfg) {
    let col = 0;
    for (const it of cfg.items) {
      const nx = (it.lane ? SPUR_REL : LINE_REL) + 14;
      for (const s of it.chips || []) col = Math.max(col, nx - 6 + ledWidth(s) + 2);
    }
    const sub = `Stop #${cfg.stopId}${cfg.street ? ", " + cfg.street : ""}`;
    col = Math.max(col, LINE_REL + 14 + 8 + sw(sub, "F-Reg", 6.6));
    let rw = 0;
    for (const dest of cfg.dests) {
      if (!dest.blocks.length) continue;
      const lab = dest.direction ? `${dest.direction} towards` : "Towards";
      let tiles = 0;
      if (cfg.routes.length > 1) {
        for (const rn of dest.tiles && dest.tiles.length ? dest.tiles : dest.routes) {
          const tile = cfg.routes.find((t) => t.label === rn) || cfg.routes.find((t) => t.route === rn);
          tiles += badgeW(tile ? tile.label : rn, 7.8) + 1.8;
        }
        tiles += 3;
      }
      rw = Math.max(rw, 10 + tiles + sw(lab, "F-Bold", 12) + 8 + ledWidth(dest.sign, 6.4, 0.5) + 8);
    }
    return { col: Math.ceil(col), rw: Math.ceil(rw) };
  }

  const TIGHT_GAIN = 1.03; // the tighter tier must print at least this much larger to be used

  function plan(cfg, opts) {
    opts = opts || {};
    cfg = withOptions(cfg, opts);
    const items = cfg.items;
    const legH = legendHeight(cfg);

    // row measurements depend on the diagram column width only
    const measured = new Map();
    const measure = (colW) => {
      let m = measured.get(colW);
      if (!m) {
        setGeo({ colW, rw: RW0 });
        m = { Ls: items.map((it, i) => measureItem(it, i === items.length - 1)), bar: stopBar(cfg) };
        measured.set(colW, m);
      }
      return m;
    };

    const dChoices = opts.cols && opts.cols !== "auto" ? [Number(opts.cols)] : [1, 2, 3];
    const tChoices = opts.tcols && opts.tcols !== "auto" ? [Number(opts.tcols)] : [1, 2];
    const fitLetter = opts.fit === "letter";
    const lim = Object.assign({}, FIT_LIMITS, opts.fitLimits || {});
    {
      const need = textNeeds(cfg);
      lim.rwMin = Math.max(lim.rwMin, legendMinWidth(cfg), need.rw);
      lim.colMin = Math.max(lim.colMin, need.col);
      lim.colMax = Math.max(lim.colMax, lim.colMin);
      lim.rwMax = Math.max(lim.rwMax, lim.rwMin);
    }

    const tiers = [
      { tau: 0.55, minFs: 11 },
      { tau: 0, minFs: 9 },
    ];
    const attempt = (cand, tier) => {
      const { nc, tc, H, geo } = cand;
      const { Ls, bar } = measure(geo ? geo.colW : COL_W0);
      setGeo(geo || null);
      const HB = H - M - 58;
      const barTop = HB - 18;
      const firstTop = barTop - bar.h - 16;
      const otherTop = barTop - 38;
      const availTables = barTop - (FOOT_TOP + 12);
      const tab = fitTables(cfg, availTables, tier.minFs, tc);
      if (!tab) return null;
      const cols = splitColumns(items, Ls, nc, firstTop, otherTop, tier.tau);
      if (!cols) return null;
      return { ...cand, HB, barTop, firstTop, otherTop, Ls, bar, tab, cols, legH, tier };
    };

    let best;
    if (fitLetter) {
      // For a target scale s the page is exactly 612/s x 792/s (or rotated).
      // Find the largest s that still fits, by bisection, then take the layout
      // whose columns are closest to their normal widths.
      const fitOn = (land, tier) => {
        const PW = land ? LETTER_H : LETTER_W;
        const PH = land ? LETTER_W : LETTER_H;
        const solve = (s) => {
          const Wb = PW / s;
          const H = PH / s;
          let top = null;
          for (const nc of dChoices)
            for (const tc of tChoices) {
              const geo = fitGeo(Wb, nc, tc, lim);
              if (!geo) continue;
              const W = Math.min(Wb, M + nc * (geo.colW + 16) + tc * (geo.rw + 16) - 16 + 8 + M);
              const got = attempt({ nc, tc, H, W, geo, land, area: W * H, scale: Math.min(1, PW / W, PH / H) }, tier);
              if (!got) continue;
              got.q = Math.min(geo.colW / COL_W0, geo.rw / RW0);
              if (!top || got.q > top.q) top = got;
            }
          return top;
        };
        const full = solve(1);
        if (full) return full;
        let lo = 0.4;
        let hi = 1;
        let loSol = solve(lo);
        if (!loSol) return null;
        for (let i = 0; i < 8; i++) {
          const mid = (lo + hi) / 2;
          const sol = solve(mid);
          if (sol) (lo = mid), (loSol = sol);
          else hi = mid;
        }
        return loSol;
      };
      const pick = (land) => {
        const a = fitOn(land, tiers[0]);
        const b = fitOn(land, tiers[1]);
        if (a && b) return b.scale > a.scale * (opts.tightGain || TIGHT_GAIN) ? b : a;
        return a || b;
      };
      const portrait = opts.orientation === "landscape" ? null : pick(false);
      let landscape = null;
      const needLand = opts.orientation === "landscape" || !portrait || portrait.scale < 0.97;
      if (needLand) landscape = pick(true);
      if (opts.orientation === "landscape") best = landscape;
      else {
        best = portrait;
        if ((!best || best.scale < PORTRAIT_MIN) && landscape && (!best || landscape.scale > best.scale)) best = landscape;
      }
      // what the other orientation would print at (the page offers a rotate button)
      let other = best && best.land ? (opts.orientation === "landscape" ? pick(false) : portrait || pick(false)) : landscape;
      if (best) best = { ...best, altScale: other ? other.scale : null };
    } else {
      const cands = [];
      const heights = [];
      if (opts.height && opts.height !== "auto") heights.push(Number(opts.height));
      else for (let h = 792; h <= 1728; h += 36) heights.push(h);
      // normal widths, unless some text would not fit them (long LED signs)
      const need = textNeeds(cfg);
      const wide = need.col > COL_W0 || need.rw > RW0;
      const geo = wide ? { colW: Math.max(COL_W0, need.col), rw: Math.max(RW0, need.rw) } : null;
      for (const nc of dChoices)
        for (const tc of tChoices)
          for (const H of heights) {
            const W = M + nc * ((geo ? geo.colW : COL_W0) + 16) + tc * ((geo ? geo.rw : RW0) + 16) - 16 + 8 + M;
            // Very tall, narrow pages are penalised so a wider page wins once the
            // aspect ratio gets silly (e.g. 8.5 x 24 in vs 12.8 x 14 in).
            const cost = W * H * (1 + Math.max(0, H / W - 1.7) * 0.6);
            cands.push({ nc, tc, H, W, geo, area: W * H, cost });
          }
      // cheapest page first; on a tie prefer the narrower page
      cands.sort((a, b) => a.cost - b.cost || a.W - b.W);
      for (const tier of tiers) {
        for (const cand of cands) {
          const got = attempt(cand, tier);
          if (got) {
            best = got;
            break;
          }
        }
        if (best) break;
      }
    }
    if (!best) throw new Error("This stop has too much information to fit on one poster.");
    setGeo(best.geo || null);
    return best;
  }

  // ------------------------------------------------------------ drawing
  function drawDiagram(d, cfg, P, RC, BAR) {
    const items = cfg.items;
    const { Ls, bar, HB, barTop } = P;
    P.cols.forEach((col, c) => {
      const ox = M + c * COL_PITCH;
      const LX = ox + LINE_REL;
      const SX = ox + SPUR_REL;
      const X1 = ox + COL_W;
      const firstTop = c === 0 ? P.firstTop : P.otherTop;
      const ys = placeRows(items, Ls, col, c, firstTop);
      const rows = [];
      for (let i = col.s; i <= col.e; i++) rows.push({ it: items[i], L: Ls[i], y: ys[i - col.s], i });

      let yStart;
      if (c === 0) {
        d.rect(ox, barTop - bar.h, COL_W, bar.h, { fill: BAR, r: 3 });
        yStart = barTop - bar.h / 2; // the stop dot sits in the middle of the bar
      } else {
        yStart = barTop - 22;
      }
      // continuation dashes: the line carries on from earlier stops (not drawn
      // when every trip starts at this stop) and into the next column
      const dashes = (yFirst, color) => {
        for (let k = 0; k < 3; k++) {
          const yt = yFirst - k * DASH_PITCH;
          d.line(LX, yt, LX, yt - DASH_LEN, { stroke: color, sw: 2.8 });
        }
      };
      // top dashes sit right against whatever the line starts with (the stop dot, or the line)
      const topGap = DASH_PITCH - DASH_LEN;
      if (c > 0) dashes(yStart + topGap + DASH_LEN + 2 * DASH_PITCH, RC);
      if (c === 0) {
        d.text(ox + LINE_REL + 14, barTop - (bar.lines.length > 1 ? 15 : 17), bar.lines[0], "F-Bold", bar.fs, WHITE);
        if (bar.lines.length > 1) d.text(ox + LINE_REL + 14, barTop - 15 - bar.fs * 1.15, bar.lines[1], "F-Bold", bar.fs, WHITE);
        let sub = `Stop #${cfg.stopId}${cfg.street ? ", " + cfg.street : ""}`;
        let sf = 7.8;
        while (sw(sub, "F-Reg", sf) > COL_W - (LINE_REL + 14) - 8 && sf > 6.2) sf -= 0.2;
        sub = ellipsize(sub, "F-Reg", sf, COL_W - (LINE_REL + 14) - 8);
        d.text(ox + LINE_REL + 14, barTop - bar.h + 10, sub, "F-Reg", sf, WHITE);
      }

      const mainRows = rows.filter((r) => !r.it.lane);
      let lastMainY = mainRows.length ? mainRows[mainRows.length - 1].y : yStart;
      let endsAtRow = mainRows.length > 0;

      // side branches (some run out and rejoin the main line)
      const spurs = [];
      for (let k = 0; k < rows.length; k++) {
        if (!rows[k].it.spurStart) continue;
        let e = k;
        while (e + 1 < rows.length && rows[e + 1].it.lane && !rows[e + 1].it.spurStart) e++;
        const yPrev = k > 0 ? rows[k - 1].y : yStart;
        const gap = yPrev - rows[k].y;
        const y1 = yPrev - Math.max(8, Math.min(24, gap * 0.5));
        const sp = { k, e, y1, join: null };
        if (rows[e].it.rejoin) {
          const yE = rows[e].y;
          const nxt = rows[e + 1];
          const room = nxt ? yE - nxt.y : 40;
          const len = Math.max(10, Math.min(20, room * 0.6));
          sp.join = yE - len;
          if (sp.join < lastMainY) endsAtRow = false;
          lastMainY = Math.min(lastMainY, sp.join);
        }
        spurs.push(sp);
      }

      d.line(LX, yStart, LX, lastMainY, { stroke: RC, sw: 5 });
      if (c === 0) {
        // In the stop bar the line comes in from above as heavy dashes (unless
        // every trip starts here) and leaves through the bottom of the bar.
        const inBar = RC;
        d.line(LX, yStart, LX, barTop - bar.h, { stroke: inBar, sw: 5 });
        if (!cfg.startsHere) {
          // dashes up to the top of the bar, the last one poking out a little
          const half = bar.h / 2;
          const starts = [];
          for (let o = 7.4; o < half; o += 8.2) starts.push(o);
          const shift = half + 3 - (starts[starts.length - 1] + 5.2);
          for (const o of starts) {
            const y0 = yStart + o + shift;
            d.line(LX, y0, LX, y0 + 5.2, { stroke: inBar, sw: 5 });
          }
        }
      }
      if (c < P.cols.length - 1) dashes(lastMainY - (endsAtRow ? 5.6 : 0) - (DASH_PITCH - DASH_LEN), RC);

      for (const sp of spurs) {
        const pts = [
          ["M", LX, sp.y1],
          ["C", LX, sp.y1 - 8, SX, sp.y1 - 3, SX, sp.y1 - 14],
          ["L", SX, rows[sp.e].y],
        ];
        if (sp.join != null) {
          const yE = rows[sp.e].y;
          const len = yE - sp.join;
          pts.push(["C", SX, yE - len * 0.55, LX, yE - len * 0.45, LX, sp.join]);
        }
        d.path(pts, { stroke: RC, sw: 5 });
      }

      // first-stop dot (this stop)
      if (c === 0) {
        d.circle(LX, yStart, 5.2, { fill: WHITE });
        d.circle(LX, yStart, 2.6, { fill: RC });
      }

      const finalIdx = items.length - 1;
      for (const r of rows) {
        const { it, L, y } = r;
        const lx = it.lane ? SX : LX;
        if (it.terminal) {
          d.circle(lx, y, 6.4, { fill: AMBER });
          d.circle(lx, y, 4.4, { fill: LED_BG });
        } else {
          d.circle(lx, y, 5.6, { fill: RC });
          d.circle(lx, y, 3.6, { fill: WHITE });
        }
        if (it.lane) d.text(SX - 9, y - 3.2, `${it.min}\u2019`, "F-Semi", 9, INK, { anchor: "end" });
        else d.text(LX - 12, y - 3.6, `${it.min}\u2019`, "F-Semi", 10.5, INK, { anchor: "end" });

        // name lines
        let ly = y - 3.4;
        // Termini: white name on a black box, so it is clear the route stops here
        const boxed = !!it.terminal;
        const padX = boxed ? 4 : 0;
        if (boxed) {
          const wMax = Math.max(...L.lines.map((ln) => sw(ln, L.font, L.fs)));
          const top = ly + L.fs * 0.86 + 2.2;
          const bot = ly - (L.lines.length - 1) * NAME_PITCH - L.fs * 0.26 - 2.2;
          d.rect(ox + L.nx - padX, bot, wMax + 2 * padX, top - bot, { fill: BLACK, r: 2 });
        }
        L.lines.forEach((ln, li) => {
          d.text(ox + L.nx, ly, ln, L.font, L.fs, boxed ? WHITE : INK);
          if (li === L.lines.length - 1) {
            const nw = sw(ln, L.font, L.fs);
            const wBox = boxed ? Math.max(...L.lines.map((l2) => sw(l2, L.font, L.fs))) + padX : nw;
            d.text(ox + L.nx + wBox + 4, ly, L.idTxt, "F-Reg", 7, GREY);
            if (it.marker) {
              const mx = ox + L.nx + wBox + 4 + sw(L.idTxt, "F-Reg", 7) + 7;
              d.circle(mx, ly + 2.6, 4.3, { fill: DGREY });
              d.text(mx, ly + 0.2, it.marker, "F-Bold", 6.4, WHITE, { anchor: "middle" });
            }
          }
          ly -= NAME_PITCH;
        });
        if (L.also.length) ly -= ALSO_GAP; // clear of the black terminus box
        for (const a of L.also) {
          if (a.sub) {
            d.text(ox + L.nx, ly + 1.5, a.text, "F-Ital", 7, GREY);
            ly -= NAME_PITCH * 0.72;
            continue;
          }
          d.text(ox + L.nx, ly, a.text, "F-Semi", 8.6, DGREY);
          if (a.id != null) d.text(ox + L.nx + sw(a.text, "F-Semi", 8.6) + 4, ly, `#${a.id}`, "F-Reg", 6.4, GREY);
          ly -= NAME_PITCH;
        }
        // transfers
        if (L.xf) {
          L.xf.lines.forEach((items2, k) => {
            const yy = y - L.yOff - XFER_PITCH * k;
            drawTransferLine(d, items2.map((p) => ({ ...p, x: p.x + ox })), yy);
          });
        }
        for (const ch of L.chips) {
          const yy = y - L.yOff - XFER_PITCH * ch.line;
          ledChip(d, ox + ch.x, yy, ch.sign);
        }
        if (L.noteLines.length) {
          L.noteLines.forEach((ln, k) => {
            d.text(ox + L.nx, y - L.noteY - k * 8.6, ln, "F-Ital", 6.6, GREY);
          });
        }
      }
    });
  }

  function drawBand(d, cfg, dest, x, y, w, RX1) {
    // light tint of the route color, "towards" label, amber destination sign
    d.rect(x, y - BAND_H, w, BAND_H, { fill: tint(dest.color, 0.16), r: 3 });
    let bx = x + 10;
    if (cfg.routes.length > 1) {
      for (const rn of dest.tiles && dest.tiles.length ? dest.tiles : dest.routes) {
        // the square carries the trips' own code (R1, R, D2), not just the route letter
        const tile = cfg.routes.find((t) => t.label === rn) || cfg.routes.find((t) => t.route === rn);
        bx = badge(d, bx, y - BAND_H / 2, { n: tile ? tile.label : rn, c: tile ? tile.color : dest.color }, 11, 7.8);
      }
      bx += 3;
    }
    const lab = dest.direction ? `${dest.direction} towards` : "Towards";
    d.text(bx, y - BAND_H / 2 - 4.1, lab, "F-Bold", 12, INK);
    const cx0 = bx + sw(lab, "F-Bold", 12) + 8;
    const fl = fitLed(dest.sign, x + w - 8 - cx0, 10.4, 0.5, 6.4);
    ledChip(d, cx0, y - BAND_H / 2, fl.text, 16, fl.fs, 0.5);
  }

  /** Draws the table columns; returns {legendTop, legendX} for the legend unit. */
  function drawTables(d, cfg, P, RX0, TOP) {
    const { fs: BFS, gap: GAP, bw: BW, bh: BH, cols: COLS } = P.tab;
    let legend = null;
    P.tab.columns.forEach((col, k) => {
      const x0 = RX0 + k * TCOL_PITCH;
      const x1 = x0 + RW;
      let y = TOP;
      for (const u of col.units) {
        y -= u.gapBefore;
        if (u.kind === "legend") {
          // The key sits at the bottom of the page, just above the footer.
          legend = { x: x0, top: Math.min(y, FOOT_TOP + 12 + P.legH) };
          y -= u.h;
          continue;
        }
        if (u.kind === "head" || u.repeat) {
          drawBand(d, cfg, u.dest, x0, y, RW, x1);
          y -= BAND_H + BAND_GAP;
        }
        const b = u.block;
        d.text(x0, y - 12, b.label, "F-Bold", 10.5, INK);
        d.line(x0, y - 16.5, x1, y - 16.5, { stroke: INK, sw: 0.9 });
        y -= DAY_H;
        b.times.forEach((t, i) => {
          const c = i % COLS;
          const row = Math.floor(i / COLS);
          const x = x0 + c * (BW + GAP);
          const yBot = y - (row + 1) * BH - row * GAP;
          const f = fmtTime(t[0], t[1]);
          const font = f.pm ? "F-Bold" : "F-Med";
          d.rect(x, yBot, BW, BH, { fill: f.pm ? PM_FILL : WHITE, stroke: INK, sw: 1 });
          const lw = sw(f.label, font, BFS);
          const sufW = 0;
          const tx = x + BW / 2 - sufW / 2;
          const base = yBot + BH / 2 - BFS * 0.34;
          d.text(tx, base, f.label, font, BFS, INK, { anchor: "middle" });
          if (t[2]) d.line(tx - lw / 2, base - 2.4, tx + lw / 2, base - 2.4, { stroke: INK, sw: 1.1 });
        });
        const rws = Math.ceil(b.times.length / COLS) || 1;
        y -= rws * BH + (rws - 1) * GAP;
        if (u.notes && u.notes.length) {
          y -= 4;
          u.notes.forEach((ln, i) => d.text(x0, y - 6.4 - i * 8.8, ln, "F-Ital", 7.2, DGREY));
          y -= u.notes.length * 8.8;
        }
      }
    });
    return legend;
  }

  function drawLegend(d, cfg, RX0, RWd, lgTop, legH) {
    d.rect(RX0, lgTop - legH, RWd, legH, { fill: "#f3f1ed", r: 4 });
    const lx = RX0 + 10;
    let ly = lgTop - 17;
    const kw = 36;
    const kh = 18;
    d.text(lx, ly - 3.4, "Key:", "F-Bold", 9.5, INK);
    d.line(lx, ly - 6.2, lx + sw("Key:", "F-Bold", 9.5), ly - 6.2, { stroke: INK, sw: 0.9 });
    let kx = lx + sw("Key:", "F-Bold", 9.5) + 8;
    d.rect(kx, ly - kh / 2, kw, kh, { fill: WHITE, stroke: INK, sw: 1 });
    d.text(kx + kw / 2, ly - 3.6, "AM", "F-Med", 10.5, INK, { anchor: "middle" });
    let px = kx + kw + 8;
    d.rect(px, ly - kh / 2, kw, kh, { fill: PM_FILL, stroke: INK, sw: 1 });
    d.text(px + kw / 2, ly - 3.6, "PM", "F-Bold", 10.5, INK, { anchor: "middle" });
    const anyStar = cfg.dests.some((x) => x.blocks.some((b) => b.times.some((t) => t[2])));
    if (anyStar) {
      const rx = px + kw + 8;
      d.rect(rx, ly - kh / 2, 40, kh, { fill: WHITE, stroke: INK, sw: 1 });
      d.text(rx + 20, ly - 3.6, "6:05", "F-Med", 10.5, INK, { anchor: "middle" });
      const w1 = sw("6:05", "F-Med", 10.5);
      d.line(rx + 20 - w1 / 2, ly - 6.1, rx + 20 + w1 / 2, ly - 6.1, { stroke: INK, sw: 1.1 });
      d.text(rx + 46, ly - 3, "see note", "F-Reg", 7.6, INK);
    }
    const ly3 = ly - 22;
    d.text(lx + 1, ly3 - 3.8, "15\u2019", "F-Semi", 11, INK);
    d.text(lx + 52, ly3 - 3.0, "Minutes of ride time from this stop", "F-Reg", 8.4, INK);
    const ly4 = ly3 - 22;
    let bx = lx;
    for (const r of [
      { n: "A", c: "#EE3325" },
      { n: "B", c: "#80BC00" },
      // plain mode: F stands for a near transfer (dashed outline), set apart from A and B
      ...(cfg.plainTransfers ? [{ n: "F", c: NAVY, near: true, gap: true }] : [{ n: "F", c: NAVY }]),
    ]) {
      if (r.gap) bx += 4;
      bx = badge(d, bx, ly4, r, 11, 7.8) + (r.near ? 1.2 : 0);
    }
    const tx0 = lx + 52;
    if (cfg.plainTransfers) {
      // "near" sits in a black box, like the outlined badges on the stops
      const a = "Transfer to routes at or";
      const nx0 = tx0 + sw(a, "F-Reg", 8.4) + 4;
      const nw = sw("near", "F-Reg", 8.4) + 6;
      d.text(tx0, ly4 - 3.0, a, "F-Reg", 8.4, INK);
      d.rect(nx0, ly4 - 6.6, nw, 11.4, { stroke: BLACK, sw: 0.95, dash: NEAR_DASH });
      d.text(nx0 + 3, ly4 - 3.0, "near", "F-Reg", 8.4, INK);
      d.text(nx0 + nw + 4, ly4 - 3.0, "the listed stop", "F-Reg", 8.4, INK);
    } else d.text(tx0, ly4 - 3.0, "Transfer to other routes at the listed stop", "F-Reg", 8.4, INK);
    const ly5 = ly4 - 22;
    if (!cfg.plainTransfers) {
      drawTransferLine(d, layoutTransfers([{ routes: [{ n: "R", c: NAVY }], walk: 200 }], lx, 999).lines[0], ly5);
      d.text(tx0, ly5 - 3.0, "Walk to nearby transfer opportunity", "F-Reg", 8.4, INK);
    }
    let my = cfg.plainTransfers ? ly4 : ly5;
    for (const m of cfg.markers || []) {
      my -= 17;
      d.circle(lx + 7, my + 2.6, 4.6, { fill: DGREY });
      d.text(lx + 7, my + 0.1, m.letter, "F-Bold", 6.8, WHITE, { anchor: "middle" });
      d.text(tx0, my - 0.4, "Only trips towards", "F-Reg", 8.4, INK);
      const sx = tx0 + sw("Only trips towards", "F-Reg", 8.4) + 5;
      const fl = fitLed(m.signs.join(" / "), RX0 + RWd - 8 - sx, 6.2, 0.55, 4.6);
      ledChip(d, sx, my + 2.4, fl.text, 11, fl.fs, 0.55);
    }
  }

  function drawFooter(d, cfg, RC, RX0, RWd0, W) {
    const FB = M + 2;
    // The navy box is at least as wide as its text needs; when the diagram
    // columns are narrow it grows into the space under the next column, and
    // the right-hand block (yellow box, validity, disclaimer) starts after it.
    const F1 = "City of Madison Metro Transit";
    const F2 = "cityofmadison.com/metro";
    const F3 = "(608) 266-4466  |  mymetrobus@cityofmadison.com";
    const need = Math.max(sw(F1, "F-Bold", 9.5), sw(F2, "F-Bold", 15.5), sw(F3, "F-Reg", 8.4)) + 24;
    const room = Math.max(COL_W, RX0 - M - 16);
    const footW = Math.max(COL_W, Math.min(Math.ceil(need), room));
    const k = Math.min(1, (footW - 24) / (need - 24));
    d.rect(M, FB, footW, 64, { fill: RC, r: 3 });
    d.text(M + 12, FB + 48, F1, "F-Bold", 9.5 * k, WHITE);
    d.text(M + 12, FB + 28, F2, "F-Bold", 15.5 * k, WHITE);
    d.text(M + 12, FB + 11, F3, "F-Reg", 8.4 * k, WHITE);

    const xr = Math.min(RX0, M + footW + 16);
    const RWd = RX0 + RWd0 - xr;
    const RX1 = RX0;
    RX0 = xr;

    const ybh = 27;
    const yby = FB + 64 - ybh;
    d.rect(RX0, yby, RWd, ybh, { fill: YELLOW, r: 3 });
    d.circle(RX0 + 15, yby + ybh / 2, 8, { stroke: INK, sw: 1.8 });
    d.text(RX0 + 15, yby + ybh / 2 - 4.3, "!", "F-Bold", 12, INK, { anchor: "middle" });
    const t1 = "Check for detours and holidays";
    const t2 = "cityofmadison.com/metro";
    if (31 + sw(t1, "F-Bold", 10.5) + 5 + sw(t2, "F-Ital", 8.5) + 8 <= RWd) {
      d.text(RX0 + 31, yby + 9.5, t1, "F-Bold", 10.5, INK);
      d.text(RX0 + 31 + sw(t1, "F-Bold", 10.5) + 5, yby + 9.6, t2, "F-Ital", 8.5, INK);
    } else {
      // narrow box: the address goes on a second line
      d.text(RX0 + 31, yby + 15.2, t1, "F-Bold", 10.5, INK);
      d.text(RX0 + 31, yby + 4.6, t2, "F-Ital", 8.5, INK);
    }
    void RX1;

    // Validity line: dates in bold
    const VFS = 7.2;
    let vx = RX0;
    const vy = FB + 21;
    const piece = (txt, font) => {
      d.text(vx, vy, txt, font, VFS, "#333333");
      vx += sw(txt, font, VFS);
    };
    if (cfg.validFrom && cfg.validTo) {
      piece("Valid from ", "F-Ital");
      piece(cfg.validFrom, "F-Bold");
      piece(" until ", "F-Ital");
      piece(cfg.validTo, "F-Bold");
      piece(".", "F-Ital");
    } else {
      piece(`Valid ${cfg.valid}.`, "F-Bold");
    }
    // Disclaimer: two fixed lines at one shared size
    const dLines = [
      "This is a citizen-made poster intended to improve accessibility, not an official Metro Transit bulletin.",
      "The departures shown are provided for information only. Please arrive at your stop 5 minutes ahead of schedule.",
    ];
    let dfs = 6.4;
    while (Math.max(...dLines.map((l) => sw(l, "F-Reg", dfs))) > RWd && dfs > 4.8) dfs = Math.round((dfs - 0.1) * 10) / 10;
    dLines.forEach((ln, k) => d.text(RX0, FB + 12 - k * (dfs + 2), ln, "F-Reg", dfs, "#333333"));

    const x = W - 13;
    const y = d.Y(FB + 4);
    d.raw(
      `<text class="fr" transform="translate(${x} ${y}) rotate(-90)" font-size="6" fill="${GREY}">${esc(
        `Source: Metro Transit GTFS ${cfg.gtfs}`
      )}</text>`
    );
  }

  // ------------------------------------------------------------ fonts / document
  const FAMILY = { LED: "BKKMono", other: "BKKFira" };

  function fontFaceCss(resolve) {
    return Object.keys(METRICS)
      .map((k) => {
        const m = METRICS[k];
        const fam = k === "LED" ? FAMILY.LED : FAMILY.other;
        return `@font-face{font-family:${fam};font-weight:${m.weight};font-style:${m.style};src:url(${resolve(
          m.file
        )}) format("woff2");}`;
      })
      .join("");
  }

  const CLASS_CSS =
    "svg.bkk text{font-kerning:none;font-variant-ligatures:none;text-rendering:geometricPrecision;white-space:pre}" +
    ".fr{font-family:BKKFira,'Fira Sans','Segoe UI',Arial,sans-serif;font-weight:400}" +
    ".fm{font-family:BKKFira,'Fira Sans','Segoe UI',Arial,sans-serif;font-weight:500}" +
    ".fs{font-family:BKKFira,'Fira Sans','Segoe UI',Arial,sans-serif;font-weight:600}" +
    ".fb{font-family:BKKFira,'Fira Sans','Segoe UI',Arial,sans-serif;font-weight:700}" +
    ".fi{font-family:BKKFira,'Fira Sans','Segoe UI',Arial,sans-serif;font-weight:400;font-style:italic}" +
    ".led{font-family:BKKMono,'Share Tech Mono',Consolas,monospace;font-weight:400}";

  // ------------------------------------------------------------ public render
  function render(cfg, opts) {
    opts = opts || {};
    cfg = withOptions(cfg, opts);
    const P = plan(cfg, opts);
    const { W, H, HB } = P;
    const d = new Doc(W, H);
    const RC = cfg.routes[0] ? cfg.routes[0].color : NAVY;
    // navy routes get a dimmer bar so their line still shows against it
    const BAR = norm(RC) === norm(NAVY) ? BAR_BG_DIM : BAR_BG;

    d.rect(0, 0, W, H, { fill: WHITE });
    const hl = drawHeader(d, cfg, W, HB, RC);
    drawQr(d, cfg, hl, HB, opts.logo);
    drawDiagram(d, cfg, P, RC, BAR);

    const RX0 = M + P.cols.length * COL_PITCH;
    const RWall = P.tc * TCOL_PITCH - 16;
    const legend = drawTables(d, cfg, P, RX0, HB - 18);
    if (legend) drawLegend(d, cfg, legend.x, RW, legend.top, P.legH);
    drawFooter(d, cfg, RC, RX0, RWall, W);

    const title = `Route ${cfg.routes.map((r) => r.label).join(", ")} \u2013 ${cfg.stopName} (Stop #${cfg.stopId}) timetable`;
    const style = `<style>${opts.fontCss || ""}${CLASS_CSS}</style>`;
    // Fit-to-letter: the same poster, shrunk onto a letter sheet (portrait or landscape).
    const fit = opts.fit === "letter";
    const PW = fit ? (P.land ? LETTER_H : LETTER_W) : W;
    const PH = fit ? (P.land ? LETTER_W : LETTER_H) : H;
    const sc = fit ? Math.min(1, PW / W, PH / H) : 1;
    const body = fit
      ? `<rect width="${PW}" height="${PH}" fill="#fff"/><g transform="translate(${n2((PW - W * sc) / 2)} ${n2(
          (PH - H * sc) / 2
        )}) scale(${sc})">${d.out.join("")}</g>`
      : d.out.join("");
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" class="bkk" width="${PW}pt" height="${PH}pt" viewBox="0 0 ${PW} ${PH}">` +
      `<title>${esc(title)}</title>${style}${body}</svg>`;
    return {
      svg,
      width: PW,
      height: PH,
      title,
      info: {
        columns: P.cols.length,
        scale: sc,
        landscape: !!(fit && P.land),
        otherScale: fit && P.altScale != null ? Math.min(1, P.altScale) : null, // scale if rotated
        timeFont: Math.round(P.tab.fs * sc * 10) / 10, // printed size of the departure times, pt
        pageIn: `${(PW / 72).toFixed(1)} x ${(PH / 72).toFixed(1)} in`,
        tableColumns: P.tc,
        timeBoxes: { columns: P.tab.cols, font: P.tab.fs },
        comfortable: P.tier.tau > 0,
      },
    };
  }

  /** Whole HTML page around the SVG, sized for printing / Save as PDF. */
  function htmlDocument(result, fontCssText) {
    const { svg, width, height, title } = result;
    return (
      `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>` +
      `<style>${fontCssText || ""}@page{size:${width}pt ${height}pt;margin:0}html,body{margin:0;padding:0;background:#fff}` +
      `svg.bkk{display:block}</style></head><body>${svg}</body></html>`
    );
  }

  return { render, plan, htmlDocument, fontFaceCss, sw, tint, METRICS };
});
