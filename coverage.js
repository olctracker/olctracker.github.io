/* =========================================================
   OLC Database — Software Coverage (Mods and Admin)
   For each program and level 1–25: is there at least one saved,
   not-scrambled IP with that program at exactly that level?
   Green = yes, red = missing. Read live from saved IPs every time.
   ========================================================= */
(() => {
"use strict";
const O = () => window.OLC;
const G = () => window.OLC_GAME;
const PAGES = (window.OLC_PAGES = window.OLC_PAGES || {});

const MAX_LV = 25;
const ROWS = [
  ["antivirus", "AV"], ["bypasser", "BP"], ["firewall", "FW"], ["password_cracker", "PC"], ["password_encryptor", "PE"],
  ["proxy", "PR"], ["rootkit", "RK"], ["siphon", "SI"], ["spam", "SP"], ["trace", "TR"]
];

async function loadAll() {
  const { sb } = O();
  const cols = ["ip", "status", "player_level", "firewall", "account_name", "crew_name", ...ROWS.map((r) => r[0])].join(",");
  const out = [];
  for (let from = 0; from < 50000; from += 1000) {
    const { data, error } = await sb.from("targets").select(cols).eq("scrambled", false).order("ip").range(from, from + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return G().dropCrew(out, (t) => [t.ip]);
}

PAGES.coverage = async function pageCoverage(main) {
  const { esc, isMod } = O();
  if (!isMod()) { main.innerHTML = `<div class="card"><div class="empty">Mods only.</div></div>`; return; }
  const targets = await loadAll();

  // who has each program at each level
  const hits = {};
  for (const [k] of ROWS) hits[k] = Array.from({ length: MAX_LV + 1 }, () => []);
  for (const t of targets) for (const [k] of ROWS) {
    const v = t[k];
    if (Number.isInteger(v) && v >= 1 && v <= MAX_LV) hits[k][v].push(t);
  }
  const total = ROWS.length * MAX_LV;
  const have = ROWS.reduce((n, [k]) => n + hits[k].slice(1).filter((a) => a.length).length, 0);
  const lvls = Array.from({ length: MAX_LV }, (_, i) => i + 1);

  main.innerHTML = `
    <div class="tiles">
      <div class="tile"><div class="k">Have</div><div class="v gain">${have}</div><div class="s">of ${total} squares</div></div>
      <div class="tile"><div class="k">Missing</div><div class="v" style="color:var(--danger)">${total - have}</div><div class="s">no IP at that level</div></div>
    </div>
    <div class="card">
      <div class="card-h">Levels 1–${MAX_LV}<span class="r">${targets.length} IPs</span></div>
      <div class="cov">
        <div class="cov-row cov-head"><span>LV</span>${ROWS.map(([k, s]) => `<b title="${esc(G().PROGRAMS.find((p) => p.key === k)?.name || k)}">${s}</b>`).join("")}</div>
        ${lvls.map((l) => `<div class="cov-row"><span class="lv">${l}</span>${ROWS.map(([k, s]) =>
          `<div class="cov-c ${hits[k][l].length ? "on" : "off"}" title="${s} ${l}: ${hits[k][l].length ? "have" : "missing"}"></div>`).join("")}</div>`).join("")}
        <div class="cov-row cov-foot"><span>Have</span>${ROWS.map(([k]) => `<i>${hits[k].slice(1).filter((a) => a.length).length}</i>`).join("")}</div>
      </div>
      <div class="cov-key"><span><i class="on"></i> have</span><span><i class="off"></i> missing</span><span class="muted">Green: at least one saved IP has it. Scrambled IPs don't count.</span></div>
    </div>
    <div class="card"><div class="card-h">Export</div>
      <div class="row" style="gap:8px">
        <button class="btn grow" data-img>Save as image</button>
        <button class="btn grow" data-txt>Copy missing list</button>
      </div>
      <div class="hint">The image is the chart as it is now. The list is the missing levels for each program, ready to paste.</div></div>
    <div class="card"><div class="card-h">Short names</div>
      <div class="small muted" style="line-height:1.8">${ROWS.map(([k, s]) => `<b class="mono" style="color:var(--text)">${s}</b> ${esc(G().PROGRAMS.find((p) => p.key === k)?.name || k)}`).join(" · ")}</div></div>`;

  const { $, toast } = O();
  const missingText = () => {
    const lines = ROWS.map(([k, s]) => {
      const miss = lvls.filter((l) => !hits[k][l].length);
      return `${s}: ${miss.length ? miss.join(", ") : "all"}`;
    });
    return `Missing software (levels 1-${MAX_LV}, ${total - have} of ${total}):\n${lines.join("\n")}`;
  };
  $("[data-txt]", main).onclick = () => G().copy(missingText());
  $("[data-img]", main).onclick = async () => {
    try {
      const blob = await chartImage(hits, lvls, have, total);
      const file = new File([blob], "software-coverage.png", { type: "image/png" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: "Software coverage" }); return; }
        catch (e) { if (e && e.name === "AbortError") return; }
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "software-coverage.png";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast("Image saved");
    } catch (e) { toast("Couldn't make the image", true); }
  };
};

/* Draw the chart on a canvas (PNG), using the current theme's colors */
function chartImage(hits, lvls, have, total) {
  const css = getComputedStyle(document.documentElement);
  const col = (v, d) => (css.getPropertyValue(v).trim() || d);
  const bg = col("--panel", "#0c1811"), text = col("--text", "#d6f5e2"), dim = col("--dim", "#7fa391");
  const on = col("--accent", "#34f08a"), off = col("--danger", "#ff5c6c");
  const cell = 34, gap = 6, left = 54, top = 92, pad = 24;
  const w = left + ROWS.length * (cell + gap) + pad;
  const h = top + lvls.length * (cell + gap) + 80;
  const c = document.createElement("canvas");
  const scale = 2;
  c.width = w * scale; c.height = h * scale;
  const g = c.getContext("2d");
  g.scale(scale, scale);
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.fillStyle = text; g.font = "700 18px 'JetBrains Mono', monospace"; g.textBaseline = "middle";
  g.fillText("SOFTWARE COVERAGE", pad, 30);
  g.fillStyle = dim; g.font = "500 13px 'JetBrains Mono', monospace";
  g.fillText(`Have ${have} of ${total} · ${new Date().toLocaleDateString()}`, pad, 54);
  g.textAlign = "center"; g.font = "700 13px 'JetBrains Mono', monospace"; g.fillStyle = text;
  ROWS.forEach(([, s], i) => g.fillText(s, left + i * (cell + gap) + cell / 2, top - 16));
  lvls.forEach((l, r) => {
    const y = top + r * (cell + gap);
    g.textAlign = "right"; g.fillStyle = dim; g.font = "600 13px 'JetBrains Mono', monospace";
    g.fillText(String(l), left - 12, y + cell / 2);
    ROWS.forEach(([k], i) => {
      const x = left + i * (cell + gap);
      g.fillStyle = hits[k][l].length ? on : off;
      g.globalAlpha = hits[k][l].length ? 1 : 0.75;
      g.beginPath();
      if (g.roundRect) g.roundRect(x, y, cell, cell, 6); else g.rect(x, y, cell, cell);
      g.fill(); g.globalAlpha = 1;
    });
  });
  const fy = top + lvls.length * (cell + gap) + 20;
  g.textAlign = "left"; g.fillStyle = dim; g.font = "500 12px Inter, sans-serif";
  g.fillText("Green: at least one saved IP has it · Red: missing", pad, fy);
  g.fillText("Scrambled IPs don't count", pad, fy + 18);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("no image"))), "image/png"));
}
})();
