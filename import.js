/* =========================================================
   OLC Database — Import IPs (Admin only)
   Paste columns copied from Google Sheets or Excel: IP, FW, level.
   A header row (IP / FW / LVL) is fine and sets the column order.
   Choose Active or Inactive, check the preview, then import.
   - Inactive imports at level 25+ also go on the inactive spam list.
   - Rows missing FW or level are imported and sent to the
     Mods' review queue with a note saying what's missing.
   ========================================================= */
(() => {
"use strict";
const O = () => window.OLC;
const G = () => window.OLC_GAME;
const PAGES = (window.OLC_PAGES = window.OLC_PAGES || {});

/* ---------- reading the paste ---------- */
function splitRow(line) {
  if (line.includes("\t")) return line.split("\t");
  if (/[;,]/.test(line) && /\d\.\d/.test(line)) return line.split(/[;,]/);
  return line.trim().split(/\s+/);
}
const cell = (v) => String(v ?? "").trim();
const numOrNull = (v) => {
  const s = cell(v).replace(/,/g, "");
  if (s === "" || s === "-" || s === "—") return { v: null };
  return /^\d{1,4}$/.test(s) ? { v: Number(s) } : { v: null, bad: true };
};

function readImport(text) {
  const lines = String(text || "").split(/\r?\n/).filter((l) => l.trim());
  let col = { ip: 0, fw: 1, lv: 2 };
  const rows = new Map(), skipped = [];
  let dupes = 0, header = false;
  for (const line of lines) {
    const cells = splitRow(line).map(cell);
    const hasIp = cells.some((c) => G().isFullIp(G().tidyIp(c)));
    if (!hasIp && cells.some((c) => /^ip/i.test(c))) {          // header row
      const find = (re) => cells.findIndex((c) => re.test(c));
      const ip = find(/^ip/i), fw = find(/^(fw|firewall)/i), lv = find(/^(lv|lvl|level|acc|account|player)/i);
      if (ip >= 0) col = { ip, fw: fw >= 0 ? fw : -1, lv: lv >= 0 ? lv : -1 };
      header = true;
      continue;
    }
    const ip = G().tidyIp(cells[col.ip]);
    if (!G().isFullIp(ip)) { skipped.push(line.trim()); continue; }
    const fw = col.fw >= 0 ? numOrNull(cells[col.fw]) : { v: null };
    const lv = col.lv >= 0 ? numOrNull(cells[col.lv]) : { v: null };
    if (rows.has(ip)) dupes++;
    const missing = [];
    if (fw.v === null) missing.push(fw.bad ? "FW (not a number)" : "FW");
    if (lv.v === null) missing.push(lv.bad ? "level (not a number)" : "level");
    rows.set(ip, { ip, fw: fw.v, lv: lv.v, missing });
  }
  return { rows: [...rows.values()], skipped, dupes, header };
}
window.OLC_IMPORT_TEST = { readImport };

const chunks = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;

const POOL_MIN_LEVEL = 25;
const toPool = (r, status) => status === "inactive" && r.lv !== null && r.lv >= POOL_MIN_LEVEL;

/* ---------- saving ---------- */
async function runImport(rows, status, progress) {
  const { sb } = O();
  // crew devices are never targets: leave them out
  const all = rows.length;
  rows = await G().dropCrew(rows, (r) => [r.ip]);
  const crewSkipped = all - rows.length;
  // rows with the same known fields go together, so a blank cell never wipes a saved value
  const groups = new Map();
  for (const r of rows) {
    const row = { ip: r.ip, status };
    if (r.fw !== null) row.firewall = r.fw;
    if (r.lv !== null) row.player_level = r.lv;
    if (toPool(r, status)) row.in_pool = true;
    const key = Object.keys(row).join(",");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  let done = 0;
  for (const list of groups.values()) {
    for (const c of chunks(list, 400)) {
      const { error } = await sb.from("targets").upsert(c, { onConflict: "ip" });
      if (error) throw error;
      done += c.length;
      progress(`Importing ${done}/${rows.length}…`);
    }
  }
  // incomplete rows → Mods' review queue (skip IPs that already have an open import flag)
  const incomplete = rows.filter((r) => r.missing.length);
  let flagged = 0;
  for (const c of chunks(incomplete, 150)) {
    const { data: open } = await sb.from("flags").select("ip,note").eq("resolved", false).in("ip", c.map((r) => r.ip));
    const already = new Set((open || []).filter((f) => /^Imported/i.test(f.note || "")).map((f) => f.ip));
    const add = c.filter((r) => !already.has(r.ip)).map((r) => ({
      ip: r.ip, kind: "incorrect", note: `Imported without ${r.missing.join(" and ")}. Please add it.`
    }));
    if (add.length) {
      const { error } = await sb.from("flags").insert(add);
      if (error) throw error;
      flagged += add.length;
    }
  }
  return { imported: done, flagged, crewSkipped, pooled: rows.filter((r) => toPool(r, status)).length };
}

/* ---------- page ---------- */
PAGES.import = async function pageImport(main) {
  const { esc, $, $$, toast, errMsg, confirmBox, btnBusy, isAdmin } = O();
  if (!isAdmin()) { main.innerHTML = `<div class="card"><div class="empty">Admin only.</div></div>`; return; }
  let status = "inactive", read = null;

  main.innerHTML = `
    <div class="card">
      <div class="card-h">Paste from your sheet</div>
      <p class="small muted" style="margin-top:0">In Google Sheets, select the IP, FW and level columns (include the header row), tap <b>Copy</b>, then paste here.</p>
      <textarea class="input mono log-box" rows="7" placeholder="IP&#9;FW&#9;LVL&#10;76.176.81.120&#9;4&#9;32&#10;114.194.179.214&#9;6&#9;28"></textarea>
      <div class="f" style="margin-top:12px"><span class="flabel">Import as</span>
        <div class="seg" style="margin:0"><button type="button" data-st="active">Active</button><button type="button" data-st="inactive" class="on">Inactive</button></div>
        <div class="hint" data-st-hint>Inactive IPs at level 25+ also go on the inactive spam list.</div></div>
    </div>
    <div data-prev></div>`;

  const ta = $("textarea", main), prev = $("[data-prev]", main);
  $$("[data-st]", main).forEach((b) => (b.onclick = () => {
    status = b.dataset.st;
    $$("[data-st]", main).forEach((x) => x.classList.toggle("on", x === b));
    $("[data-st-hint]", main).textContent = status === "inactive" ? "Inactive IPs at level 25+ also go on the inactive spam list." : "Active IPs are saved but not added to the spam list.";
    draw();
  }));

  function draw() {
    read = ta.value.trim() ? readImport(ta.value) : null;
    if (!read) { prev.innerHTML = ""; return; }
    const { rows, skipped, dupes } = read;
    const miss = rows.filter((r) => r.missing.length);
    const show = rows.slice(0, 60);
    const pool = rows.filter((r) => toPool(r, status)).length;
    prev.innerHTML = `
      <div class="tiles">
        <div class="tile"><div class="k">Ready</div><div class="v gain">${rows.length - miss.length}</div><div class="s">complete rows</div></div>
        <div class="tile"><div class="k">Missing info</div><div class="v" style="color:var(--warn)">${miss.length}</div><div class="s">imported + sent to Mods</div></div>
      </div>
      <div class="card">
        <div class="card-h">Preview<span class="r">${plural(rows.length, "IP", "IPs")}</span></div>
        ${status === "inactive" && rows.length ? `<div class="small" style="margin:-4px 0 8px"><b class="gain">${pool}</b> <span class="muted">go on the spam list (level ${POOL_MIN_LEVEL}+)${rows.length - pool ? ` · ${rows.length - pool} don't` : ""}</span></div>` : ""}
        ${rows.length ? `
          <div class="imp-row h"><span>IP</span><span>FW</span><span>LVL</span></div>
          ${show.map((r) => `<div class="imp-row"><span>${esc(r.ip)}${toPool(r, status) ? ` <span class="badge st-pool">spam</span>` : ""}</span>
            <span class="${r.fw === null ? "miss" : ""}">${r.fw ?? "—"}</span>
            <span class="${r.lv === null ? "miss" : ""}">${r.lv ?? "—"}</span></div>`).join("")}
          ${rows.length > show.length ? `<div class="tiny muted" style="margin-top:6px">+${rows.length - show.length} more</div>` : ""}`
          : `<div class="empty">No IPs found. Check that the first column is the IP.</div>`}
        ${dupes ? `<div class="hint">${plural(dupes, "repeated IP", "repeated IPs")} in the paste: the last row is used.</div>` : ""}
        ${skipped.length ? `<details style="margin-top:10px"><summary class="small" style="color:var(--danger)">${plural(skipped.length, "row", "rows")} skipped (no valid IP)</summary>
          <div class="mono tiny muted" style="margin-top:6px;line-height:1.7">${skipped.slice(0, 30).map(esc).join("<br>")}</div></details>` : ""}
      </div>
      ${rows.length ? `<button class="btn primary block" data-go>Import ${plural(rows.length, "IP", "IPs")} as ${status === "inactive" ? "Inactive" : "Active"}</button>` : ""}`;
    const go = $("[data-go]", prev);
    if (go) go.onclick = () => doImport(go);
  }

  async function doImport(btn) {
    const rows = read.rows, miss = rows.filter((r) => r.missing.length).length;
    if (!(await confirmBox({
      title: `Import ${plural(rows.length, "IP", "IPs")} as ${status === "inactive" ? "Inactive" : "Active"}?`,
      body: `Saved IPs get this status and the FW/level from your sheet.${status === "inactive" ? ` ${read.rows.filter((r) => toPool(r, status)).length} at level ${POOL_MIN_LEVEL}+ also go on the inactive spam list.` : ""}${miss ? ` ${miss} with missing info go to the Mods' review queue.` : ""}`,
      ok: "Import"
    }))) return;
    btnBusy(btn, true, "Importing…");
    try {
      const r = await runImport(rows, status, (t) => (btn.textContent = t));
      toast(`Imported ${r.imported}${r.flagged ? ` · ${r.flagged} sent to Mods` : ""}${r.crewSkipped ? ` · ${r.crewSkipped} crew skipped` : ""}`);
      ta.value = "";
      prev.innerHTML = `<div class="card"><div class="card-h">Done</div>
        <p class="small" style="margin:0">Imported ${plural(r.imported, "IP", "IPs")} as ${status}.${status === "inactive" ? ` ${plural(r.pooled, "IP", "IPs")} added to the spam list (level ${POOL_MIN_LEVEL}+).` : ""}${r.flagged ? ` ${plural(r.flagged, "IP was", "IPs were")} sent to Mod Review.` : ""}${r.crewSkipped ? ` ${plural(r.crewSkipped, "crew device was", "crew devices were")} left out.` : ""}</p></div>`;
    } catch (e) { btnBusy(btn, false); toast(errMsg(e), true); }
  }

  ta.addEventListener("input", draw);
};
})();
