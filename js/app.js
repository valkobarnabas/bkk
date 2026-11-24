/**
 * Browser UI: pick a stop, tick routes, get BKK-style posters.
 * Query string: ?stop=0532&route=28,38&merge=0&school=1
 */
(function () {
  "use strict";
  const S = window.MMTServed;
  const Adapter = window.BKKAdapter.create(S);
  const Search = window.BKKSearch;
  const Poster = window.BKKPoster;

  const $ = (id) => document.getElementById(id);
  const qEl = $("q"), resultsEl = $("results"), pickedEl = $("picked"), routesEl = $("routes");
  const noSchoolEl = $("noschool"), mergeEl = $("merge"), letterEl = $("letter"), plainEl = $("plain"), goEl = $("go"), errEl = $("err"), outEl = $("out");

  let pack = null, ctx = null, selected = null, logo = null;
  let posterCount = 0;

  const esc = (s) =>
    String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function showErr(msg) {
    errEl.hidden = !msg;
    errEl.textContent = msg || "";
  }

  // ------------------------------------------------------------ data
  async function loadGzip(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error("Could not load " + url);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const gz = bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
    const text = gz
      ? await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).text()
      : new TextDecoder().decode(bytes);
    return JSON.parse(text);
  }

  function blobToDataUri(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }

  async function loadLogo() {
    try {
      const res = await fetch("data/metrologo-mark.png");
      if (res.ok) logo = await blobToDataUri(await res.blob());
    } catch (e) {
      /* the QR code works without the mark */
    }
  }

  // Page-level @font-face so inline SVG text uses the same fonts the layout was measured with.
  function installFonts() {
    const st = document.createElement("style");
    st.textContent = Poster.fontFaceCss((f) => "fonts/" + f);
    document.head.appendChild(st);
  }

  let fontDataCss = null;
  async function embeddedFontCss() {
    if (fontDataCss) return fontDataCss;
    const files = Object.keys(Poster.METRICS).map((k) => Poster.METRICS[k].file);
    const uris = {};
    await Promise.all(
      files.map(async (f) => {
        const res = await fetch("fonts/" + f);
        uris[f] = await blobToDataUri(await res.blob());
      })
    );
    fontDataCss = Poster.fontFaceCss((f) => uris[f]);
    return fontDataCss;
  }

  // ------------------------------------------------------------ search / pick
  function pills(routes) {
    return routes
      .map((r) => `<span class="pill" style="background:${r.c};color:${r.t}">${esc(r.n)}</span>`)
      .join("");
  }

  function renderResults(list) {
    resultsEl.hidden = !list.length;
    resultsEl.innerHTML = list
      .map((s) => {
        const dir = s.dir ? `<span class="dir">${esc(s.dir)}</span>` : "";
        return `<button type="button" class="result" data-code="${esc(s.code)}">
          <div><span class="name">${esc(s.name)}</span><span class="code">#${esc(s.code)}</span></div>
          <div class="lines">${pills(s.routes)}${dir}</div></button>`;
      })
      .join("");
  }

  function visibleRoutes() {
    if (!selected) return [];
    return noSchoolEl.checked ? selected.routes.filter((r) => !r.s) : selected.routes;
  }
  const routeInputs = () => [...routesEl.querySelectorAll("input[data-route]")];
  const chosen = () => routeInputs().filter((i) => i.checked && !i.disabled).map((i) => i.dataset.route);

  function syncRouteChecks() {
    const vis = new Set(visibleRoutes().map((r) => r.n));
    let any = false;
    for (const input of routeInputs()) {
      const hidden = !vis.has(input.dataset.route);
      input.closest("label").classList.toggle("off", hidden);
      input.disabled = hidden;
      if (hidden) input.checked = false;
      else if (input.checked) any = true;
    }
    if (!any) {
      const first = routeInputs().find((i) => !i.disabled);
      if (first) first.checked = true;
    }
    goEl.disabled = chosen().length === 0;
  }

  function showPicked(stop) {
    selected = stop;
    pickedEl.hidden = false;
    resultsEl.hidden = true;
    qEl.value = `${stop.name}  #${stop.code}`;
    $("picked-name").textContent = stop.name;
    const street = [stop.dir, stop.street].filter(Boolean).join(" ");
    $("picked-meta").textContent = `Stop #${stop.code}${street ? ", " + street : ""}`;
    routesEl.innerHTML = stop.routes
      .map(
        (r) =>
          `<label><input type="checkbox" data-route="${esc(r.n)}" /> <span class="pill" style="background:${r.c};color:${r.t}">${esc(r.n)}</span>${r.s ? " extra" : ""}</label>`
      )
      .join("");
    syncRouteChecks();
    outEl.hidden = true;
    showErr("");
  }

  qEl.addEventListener("input", () => renderResults(Search.searchStops(pack.stops, qEl.value)));
  qEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const hit = Search.searchStops(pack.stops, qEl.value)[0];
      if (hit) showPicked(hit);
    }
  });
  qEl.addEventListener("focus", () => qEl.select());
  resultsEl.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-code]");
    if (!btn) return;
    const stop = Search.findStop(pack.stops, btn.dataset.code);
    if (stop) showPicked(stop);
  });
  routesEl.addEventListener("change", () => (goEl.disabled = chosen().length === 0));
  noSchoolEl.addEventListener("change", syncRouteChecks);

  // ------------------------------------------------------------ generate
  const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  const fitOpt = () => (letterEl.checked ? "letter" : undefined);
  const plainOpt = () => plainEl.checked;

  function addCard(cfg, firstRes) {
    const base = `${slug(cfg.routes.map((r) => r.label).join("-"))}-${cfg.stopId}`;
    const card = document.createElement("article");
    card.className = "poster-card";
    const label = cfg.routes.map((r) => r.label).join(" + ");
    card.innerHTML =
      `<div class="poster-bar"><span class="meta"></span>` +
      `<button type="button" data-act="rotate" hidden></button>` +
      `<button type="button" class="primary" data-act="print">Print / Save as PDF</button>` +
      `<button type="button" data-act="svg">Download SVG</button>` +
      `<button type="button" data-act="html">Download HTML</button></div>` +
      `<div class="poster-sheet"></div>`;
    const metaEl = card.querySelector(".meta");
    const sheetEl = card.querySelector(".poster-sheet");
    const rotateEl = card.querySelector('[data-act="rotate"]');
    let orientation; // undefined = portrait unless it cannot stand upright
    let curLandscape = false;

    const paint = (res) => {
      card.style.width = `min(100%, ${Math.round((res.width * 96) / 72)}px)`;
      const i = res.info;
      curLandscape = !!i.landscape;
      metaEl.textContent =
        `${label}, ${i.pageIn}${i.landscape ? " landscape" : ""}` +
        (i.scale < 0.999 ? `, shrunk to ${Math.round(i.scale * 100)}%` : "");
      sheetEl.innerHTML = res.svg;
      const svg = sheetEl.querySelector("svg");
      svg.removeAttribute("width");
      svg.removeAttribute("height");
      // Fit-to-letter: offer the other orientation when it would print larger
      const better = i.otherScale != null && i.otherScale > i.scale * 1.03;
      rotateEl.hidden = !better;
      if (better) {
        rotateEl.textContent = i.landscape
          ? `Rotate to portrait (${Math.round(i.otherScale * 100)}% instead of ${Math.round(i.scale * 100)}%)`
          : `Rotate to landscape (${Math.round(i.otherScale * 100)}% instead of ${Math.round(i.scale * 100)}%)`;
      }
    };
    const render = (extra) => Poster.render(cfg, Object.assign({ logo, fit: fitOpt(), orientation, plainTransfers: plainOpt() }, extra || {}));
    paint(firstRes);
    // a rotated poster keeps its choice, and always offers the way back
    const showRotateBack = (res) => {
      const i = res.info;
      if (i.landscape && i.otherScale != null) {
        rotateEl.hidden = false;
        rotateEl.textContent = `Back to portrait (${Math.round(i.otherScale * 100)}% instead of ${Math.round(i.scale * 100)}%)`;
      }
    };

    card.querySelector(".poster-bar").addEventListener("click", async (e) => {
      const act = e.target.dataset && e.target.dataset.act;
      if (!act) return;
      try {
        if (act === "rotate") {
          orientation = curLandscape ? "portrait" : "landscape";
          const res = render();
          paint(res);
          showRotateBack(res);
          return;
        }
        const css = await embeddedFontCss();
        const full = render({ fontCss: css });
        if (act === "svg") download(base + ".svg", full.svg, "image/svg+xml");
        else if (act === "html") download(base + ".html", Poster.htmlDocument(full, css), "text/html");
        else {
          const doc = Poster.htmlDocument(full, css).replace(
            "</body>",
            "<script>document.fonts.ready.then(function(){setTimeout(function(){window.print()},250)})<\/script></body>"
          );
          const url = URL.createObjectURL(new Blob([doc], { type: "text/html" }));
          const w = window.open(url, "_blank");
          if (!w) download(base + ".html", doc, "text/html");
          setTimeout(() => URL.revokeObjectURL(url), 60000);
        }
      } catch (err) {
        showErr(err.message || String(err));
      }
    });
    outEl.appendChild(card);
  }
  function generate() {
    showErr("");
    const names = chosen();
    if (!selected || !names.length) return;
    outEl.innerHTML = "";
    let posters;
    try {
      posters = Adapter.build(ctx, selected.code, names, {
        merge: mergeEl.checked,
        excludeSchool: noSchoolEl.checked,
      });
    } catch (err) {
      showErr(err.message || String(err));
      return;
    }
    let made = 0;
    for (const cfg of posters) {
      try {
        addCard(cfg, Poster.render(cfg, { logo, fit: fitOpt(), plainTransfers: plainOpt() }));
        made++;
      } catch (err) {
        showErr(`${cfg.routes.map((r) => r.label).join(" + ")}: ${err.message || err}`);
      }
    }
    outEl.hidden = !made;
    if (made) outEl.scrollIntoView({ behavior: "smooth", block: "start" });

    const p = new URLSearchParams();
    p.set("stop", selected.code);
    p.set("route", names.join(","));
    if (!mergeEl.checked) p.set("merge", "0");
    if (!noSchoolEl.checked) p.set("school", "1");
    if (letterEl.checked) p.set("letter", "1");
    if (plainEl.checked) p.set("plain", "1");
    history.replaceState(null, "", "?" + p.toString());
  }
  goEl.addEventListener("click", generate);

  function openFromQuery() {
    const params = new URLSearchParams(location.search);
    const code = params.get("stop");
    if (!code) return;
    const stop = Search.findStop(pack.stops, code);
    if (!stop) return showErr(`No timetable data for stop ${code}.`);
    if (params.get("merge") === "0") mergeEl.checked = false;
    if (params.get("school") === "1") noSchoolEl.checked = false;
    if (params.get("letter") === "1") letterEl.checked = true;
    if (params.get("plain") === "1") plainEl.checked = true;
    showPicked(stop);
    const route = params.get("route");
    if (route) {
      const want = new Set(route.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
      for (const input of routeInputs()) input.checked = want.has(input.dataset.route.toLowerCase());
      syncRouteChecks();
    }
    generate();
  }

  // ------------------------------------------------------------ boot
  showErr("Loading schedules\u2026");
  installFonts();
  Promise.all([loadGzip("data/pack.json.gz"), loadGzip("data/served.json.gz"), loadLogo()])
    .then(([p, served]) => {
      pack = p;
      ctx = Adapter.prepare(p, served);
      const f = served.feed;
      if (f) {
        const d = (s) => `${s.slice(0, 4)}.${s.slice(4, 6)}.${s.slice(6, 8)}`;
        $("foot-data").textContent = `Schedules from Madison Metro\u2019s public GTFS, valid ${d(f.feed_start_date)} \u2013 ${d(f.feed_end_date)}.`;
      }
      qEl.disabled = false;
      showErr("");
      openFromQuery();
      if (!selected) qEl.focus();
    })
    .catch((e) => showErr(e.message || String(e)));
})();
