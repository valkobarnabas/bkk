/**
 * Stop search, borrowed from metrotransit-main/hybrid.js: match by stop
 * number first, then by name (directional letters like N/S/E/W are ignored
 * for the loose match), then by street.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else root.BKKSearch = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DIR_WORD = /^(n|s|e|w|ne|nw|se|sw)$/;

  function norm(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function looseNorm(s) {
    return norm(s)
      .split(" ")
      .filter((w) => w && !DIR_WORD.test(w))
      .join(" ");
  }

  /** @param stops [{code, name, street, dir, routes}] (pack.stops) */
  function searchStops(stops, query, limit) {
    const raw = String(query || "").trim();
    if (!raw) return [];
    const max = limit || 12;
    const exact = stops.filter((s) => s.code === raw || s.code.replace(/^0+/, "") === raw.replace(/^0+/, ""));
    if (/^\d{3,5}$/.test(raw) && exact.length) return exact.slice(0, 8);
    const nq = norm(raw);
    const lq = looseNorm(raw);
    const scored = [];
    for (const s of stops) {
      const name = norm(s.name);
      const loose = looseNorm(s.name);
      const street = norm(s.street);
      const looseStreet = looseNorm(s.street);
      const code = s.code.toLowerCase();
      let score = 0;
      if (code === raw.toLowerCase()) score = 100;
      else if (code.startsWith(raw.toLowerCase())) score = 80;
      else if (name.startsWith(nq) || (lq && loose.startsWith(lq))) score = 60;
      else if (name.includes(nq) || (lq && loose.includes(lq))) score = 40;
      else if (street.includes(nq) || (lq && looseStreet.includes(lq))) score = 20;
      if (score) scored.push({ s, score });
    }
    scored.sort((a, b) => b.score - a.score || a.s.name.localeCompare(b.s.name));
    return scored.slice(0, max).map((x) => x.s);
  }

  function findStop(stops, code) {
    const raw = String(code || "").trim();
    if (!raw) return null;
    const bare = raw.replace(/^0+/, "");
    return (
      stops.find((s) => s.code === raw) ||
      stops.find((s) => s.code.replace(/^0+/, "") === bare) ||
      null
    );
  }

  return { searchStops, findStop, norm };
});
