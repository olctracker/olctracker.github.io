/* =========================================================
   OLC Database — Import IPs (Admin only)
   Paste the game export (with its header row) from Google Sheets, Excel or a CSV.
   Columns are matched by header name in any order (case, spaces and
   underscores don't matter). Nothing saves until Import is tapped.
   - New IPs are saved as Unknown.
   - Saved IPs keep their status, except: a changed software level → Active.
   - Blank cells never erase saved values. Imports never touch the spam list.
   - Firewall and firewall_level must agree, or the row is skipped.
   - Rows still missing FW or level go to the Mods' review queue.
   - Crew devices are left out.
   ========================================================= */
(() => {
"use strict";
const O = () => window.OLC;
const G = () => window.OLC_GAME;
const PAGES = (window.OLC_PAGES = window.OLC_PAGES || {});

/* ---------- fields the import can fill ---------- */
const SW = [
  { key: "firewall", label: "Firewall", short: "FW", names: ["firewall", "fw"] },
  { key: "antivirus", label: "Antivirus", short: "AV", names: ["antivirus", "av"] },
  { key: "bypasser", label: "Bypasser", short: "BYP", names: ["bypasser", "bypass", "byp"] },
  { key: "password_cracker", label: "Password Cracker", short: "PC", names: ["passwordcracker", "cracker", "pc"] },
  { key: "password_encryptor", label: "Password Encryptor", short: "PE", names: ["passwordencryptor", "encryptor", "pe"] },
  { key: "proxy", label: "Proxy", short: "PRX", names: ["proxy", "prx"] },
  { key: "rootkit", label: "Rootkit", short: "RK", names: ["rootkit", "rk"] },
  { key: "siphon", label: "Siphon", short: "SIP", names: ["siphon", "sip"] },
  { key: "spam", label: "Spam", short: "SPM", names: ["spam", "spm"] },
  { key: "trace", label: "Trace", short: "TRC", names: ["trace", "trc"] }
];
const SW_KEYS = SW.map((s) => s.key);
const FIELDS = [
  { key: "ip", label: "IP", names: ["visibleip", "ip", "ipaddress"] },
  { key: "account_name", label: "Account name", names: ["username", "accountname", "account", "user"] },
  { key: "player_level", label: "Level", names: ["playerlevel", "level", "lvl", "lv"], num: 4 },
  { key: "reputation", label: "Reputation", names: ["reputation", "rep"], num: 12 },
  { key: "fw_check", label: "Firewall (check)", names: ["firewalllevel", "fwlevel"], num: 4 },
  { key: "crew_name", label: "Crew", names: ["crewname", "crew"] },
  { key: "crew_tag", label: "Crew tag", names: ["crewtag", "tag"] },
  ...SW.map((s) => ({ ...s, num: 4 }))
];
const FIELD = Object.fromEntries(FIELDS.map((f) => [f.key, f]));
const SAVE_KEYS = ["account_name", "player_level", "reputation", "crew_name", "crew_tag", ...SW_KEYS];

const norm = (s) => String(s ?? "").toLowerCase().replace(/[\s_\-]+/g, "");
const blank = (s) => s === "" || s === "-" || s === "—";

/* ---------- reading the paste ---------- */
function csvSplit(line, sep) {
  const out = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"' && cur === "") q = true;
    else if (c === sep) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}
function splitterFor(header) {
  if (header.includes("\t")) return (l) => l.split("\t");
  if (header.includes(",")) return (l) => csvSplit(l, ",");
  if (header.includes(";")) return (l) => csvSplit(l, ";");
  return (l) => [l];
}

/* which field each header fills: built-in names, then names saved by the Admin */
function mapHeaders(headers, aliases) {
  const used = new Set();
  return headers.map((h) => {
    const n = norm(h);
    const custom = aliases[n] && FIELD[aliases[n]] ? aliases[n] : null;
    const builtIn = FIELDS.find((f) => f.names.includes(n))?.key || null;
    let field = custom || builtIn;
    const dup = !!field && used.has(field);
    if (dup) field = null;
    if (field) used.add(field);
    return { h: String(h).trim(), n, field, custom: !!custom, dup };
  });
}

function readImport(text, aliases = {}) {
  const lines = String(text || "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return null;
  const split = splitterFor(lines[0]);
  const headers = split(lines[0]).map((c) => c.trim());
  if (headers.some((c) => G().isFullIp(G().tidyIp(c))))
    return { error: "The first line has an IP in it. Paste the header row too (username, visible_ip, …)." };
  const cols = mapHeaders(headers, aliases);
  const ipCol = cols.findIndex((c) => c.field === "ip");
  if (ipCol < 0) return { error: "No IP column found in the header row. Expected a column named visible_ip (or IP).", cols, headers };

  const first = lines[1] ? split(lines[1]).map((c) => c.trim()) : [];
  const rows = new Map(), bad = [];
  let dupes = 0;
  for (const line of lines.slice(1)) {
    const cells = split(line).map((c) => c.trim());
    const ip = G().tidyIp(cells[ipCol]);
    if (!G().isFullIp(ip)) { bad.push({ line: line.trim(), reason: blank(cells[ipCol] || "") ? "No IP" : `"${cells[ipCol]}" isn't a full IP` }); continue; }
    const vals = {}, problems = [];
    cols.forEach((c, i) => {
      if (!c.field || c.field === "ip") return;
      const raw = cells[i] ?? "";
      if (blank(raw)) return;
      const f = FIELD[c.field];
      if (f.num) {
        const s = raw.replace(/[,\s]/g, "");
        if (!/^\d+$/.test(s) || s.length > f.num) { problems.push(`${c.h} "${raw}" isn't a number`); return; }
        vals[c.field] = Number(s);
      } else vals[c.field] = raw;
    });
    if (vals.fw_check !== undefined) {
      if (vals.firewall !== undefined && vals.firewall !== vals.fw_check)
        problems.push(`Firewall ${vals.firewall} but firewall_level ${vals.fw_check}`);
      else vals.firewall = vals.fw_check;
      delete vals.fw_check;
    }
    if (rows.has(ip)) dupes++;
    rows.set(ip, { ip, vals, problems });
  }
  const found = new Set(cols.map((c) => c.field).filter(Boolean));
  const notFound = FIELDS.filter((f) => !found.has(f.key)).map((f) => f.key);
  return { cols, headers, first, rows: [...rows.values()], bad, dupes, notFound };
}
window.OLC_IMPORT_TEST = { readImport, mapHeaders, csvSplit };

const chunks = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;
const fmtN = (v) => (typeof v === "number" ? v.toLocaleString("en-US") : v);

/* ---------- compare with what's saved ---------- */
async function classify(read) {
  const { sb } = O();
  const good = read.rows.filter((r) => !r.problems.length);
  const crew = await G().crewSet(good.map((r) => r.ip));
  const saved = new Map();
  const cols = ["ip", "status", ...SAVE_KEYS].join(",");
  for (const c of chunks(good.filter((r) => !crew.has(r.ip)).map((r) => r.ip), 150)) {
    const { data, error } = await sb.from("targets").select(cols).in("ip", c);
    if (error) {
      if (/reputation|crew_tag/.test(error.message || "")) throw new Error("Run the v1.10 SQL file in Supabase first (adds reputation and crew tag).");
      throw error;
    }
    (data || []).forEach((t) => saved.set(t.ip, t));
  }
  const out = [];
  for (const r of read.rows) {
    if (r.problems.length) { out.push({ ...r, kind: "bad" }); continue; }
    if (crew.has(r.ip)) { out.push({ ...r, kind: "bad", problems: ["Crew device — left out"] }); continue; }
    const old = saved.get(r.ip) || null;
    let changes = {}, status = null, kind;
    if (!old) { kind = "new"; changes = { ...r.vals }; status = "unknown"; }
    else {
      for (const k of SAVE_KEYS) if (r.vals[k] !== undefined && String(r.vals[k]) !== String(old[k] ?? "")) changes[k] = r.vals[k];
      kind = Object.keys(changes).length ? "upd" : "same";
      const swChanged = SW_KEYS.some((k) => k in changes && old[k] !== null && old[k] !== undefined);
      if (swChanged && old.status !== "active") status = "active";
    }
    const missing = [];
    if ((r.vals.firewall ?? old?.firewall ?? null) === null) missing.push("FW");
    if ((r.vals.player_level ?? old?.player_level ?? null) === null) missing.push("level");
    out.push({ ...r, kind, old, changes, status, missing: kind === "same" ? [] : missing });
  }
  const bad = read.bad.map((b) => ({ ip: null, kind: "bad", problems: [b.reason], line: b.line }));
  return [...out, ...bad];
}

/* ---------- saving ---------- */
async function runImport(list, progress) {
  const { sb } = O();
  const todo = list.filter((r) => r.kind === "new" || r.kind === "upd");
  // rows with the same set of fields go together, so a blank cell never wipes a saved value
  const groups = new Map();
  for (const r of todo) {
    const row = { ip: r.ip, ...r.changes };
    if (r.status) row.status = r.status;
    const key = Object.keys(row).sort().join(",");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  let done = 0;
  for (const g of groups.values()) {
    for (const c of chunks(g, 400)) {
      const { error } = await sb.from("targets").upsert(c, { onConflict: "ip" });
      if (error) throw error;
      done += c.length;
      progress(`Importing ${done}/${todo.length}…`);
    }
  }
  // still missing FW or level → Mods' review queue (skip IPs that already have an open import flag)
  const incomplete = todo.filter((r) => r.missing.length);
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
  return {
    added: todo.filter((r) => r.kind === "new").length,
    updated: todo.filter((r) => r.kind === "upd").length,
    activated: todo.filter((r) => r.status === "active").length,
    flagged
  };
}

/* ---------- page ---------- */
PAGES.import = async function pageImport(main) {
  const { sb, esc, $, $$, toast, errMsg, confirmBox, btnBusy, isAdmin } = O();
  if (!isAdmin()) { main.innerHTML = `<div class="card"><div class="empty">Admin only.</div></div>`; return; }

  let aliases = {}, aliasesOk = true;
  {
    const { data, error } = await sb.from("app_settings").select("import_aliases").eq("id", 1).maybeSingle();
    if (error) aliasesOk = false; else aliases = data?.import_aliases || {};
  }
  let read = null, list = null, filter = "all", limit = 60, seq = 0, timer = null;

  main.innerHTML = `
    <div class="card">
      <div class="card-h">Paste from your sheet</div>
      <p class="small muted" style="margin-top:0">Copy the whole sheet <b>with the header row</b> and paste it here. Columns can be in any order.</p>
      <textarea class="input mono log-box" rows="6" placeholder="username&#9;visible_ip&#9;player_level&#9;reputation&#9;…"></textarea>
      <div class="hint">New IPs are saved as <b>Unknown</b>. Saved IPs keep their status unless a software level changes (then → <b>Active</b>). Blank cells never erase saved values. Nothing goes on the spam list.</div>
    </div>
    <div data-prev></div>`;
  const ta = $("textarea", main), prev = $("[data-prev]", main);

  function schedule() { clearTimeout(timer); timer = setTimeout(update, 350); }
  async function update() {
    const my = ++seq;
    read = ta.value.trim() ? readImport(ta.value, aliases) : null;
    list = null; limit = 60;
    if (!read) { prev.innerHTML = ""; return; }
    if (read.error) { draw(); return; }
    prev.innerHTML = colsCard() + `<div class="card"><div class="empty">Checking saved IPs…</div></div>`;
    wireCols();
    try { const l = await classify(read); if (my !== seq) return; list = l; draw(); }
    catch (e) { if (my !== seq) return; prev.innerHTML = colsCard() + `<div class="card warn"><div class="card-h">Can't preview</div><p class="small" style="margin:0">${esc(errMsg(e))}</p></div>`; wireCols(); }
  }

  /* column map */
  function colsCard() {
    if (!read?.cols) return "";
    const used = read.cols.filter((c) => c.field).length, ign = read.cols.filter((c) => !c.field);
    const taken = new Set(read.cols.map((c) => c.field).filter(Boolean));
    const open = ign.length || read.notFound.length || read.error;
    const rows = read.cols.map((c, i) => {
      const ex = read.first?.[i] ?? "";
      const editable = !c.field || c.custom;
      const right = editable
        ? `<select class="cm-sel ${c.field ? "" : "ign"}" data-n="${esc(c.n)}">
            <option value="">${c.dup ? "ignored (repeat)" : "ignored"}</option>
            ${FIELDS.filter((f) => f.key === c.field || !taken.has(f.key)).map((f) => `<option value="${f.key}" ${f.key === c.field ? "selected" : ""}>${esc(f.label)}</option>`).join("")}
          </select>`
        : `<span class="f">${esc(FIELD[c.field].label)}</span>`;
      const note = c.field === "fw_check" ? " · must match Firewall" : "";
      return `<div class="r"><span>${esc(c.h || "(blank)")}</span><span class="to">→</span>${right}${ex !== "" || note ? `<div class="ex">${esc(ex)}${note}</div>` : ""}</div>`;
    }).join("");
    return `<div class="card">
      <details ${open ? "open" : ""}><summary class="card-h" style="cursor:pointer;margin:0">Columns<span class="r">${used} used · ${ign.length} ignored</span></summary>
        <div class="cmap" style="margin-top:10px">${rows}</div>
        ${aliasesOk ? "" : `<div class="hint" style="color:var(--warn)">Run the v1.10 SQL file to save header names you pick here.</div>`}
      </details>
      ${ign.length || read.notFound.length ? `<div class="cm-lists">
        ${ign.length ? `<div class="l"><b class="muted">Columns ignored</b>${esc(ign.map((c) => c.h || "(blank)").join(", "))}</div>` : ""}
        ${read.notFound.length ? `<div class="l warn"><b>Expected but not found</b>${esc(read.notFound.map((k) => FIELD[k].label).join(", "))}${ign.length ? ` — renamed? Pick it from an ignored column above.` : ""}</div>` : ""}
      </div>` : ""}
    </div>`;
  }
  function wireCols() {
    $$(".cm-sel", prev).forEach((s) => (s.onchange = async () => {
      const n = s.dataset.n, v = s.value;
      const next = { ...aliases };
      if (v) next[n] = v; else delete next[n];
      aliases = next;
      if (aliasesOk) {
        const { error } = await sb.from("app_settings").update({ import_aliases: next }).eq("id", 1);
        if (error) toast(errMsg(error), true); else toast(v ? `"${s.closest(".r").firstElementChild.textContent}" → ${FIELD[v].label} saved` : "Header name removed");
      }
      update();
    }));
  }

  /* rows */
  const isProb = (r) => r.kind === "bad" || (r.missing && r.missing.length);
  function rowHtml(r) {
    if (r.kind === "bad") {
      const v = r.vals || {};
      return `<div class="ir bad">
        <div class="hd"><span class="ip">${esc(r.ip || "—")}</span><span class="badge pending">Skipped</span></div>
        ${r.ip ? who(r, v) : `<div class="who mono tiny">${esc((r.line || "").slice(0, 120))}</div>`}
        <div class="why">✕ ${esc(r.problems.join(" · "))}</div></div>`;
    }
    const v = { ...(r.old || {}), ...r.vals };
    const tag = r.kind === "new" ? `<span class="badge new">New</span>` : r.kind === "upd" ? `<span class="badge upd">Updated</span>` : `<span class="badge">No change</span>`;
    const st = r.kind === "new" ? `<span class="st">Unknown</span>`
      : r.status ? `<span class="st">${esc(r.old.status)} → <b style="color:var(--warn)">Active</b></span>`
      : `<span class="st">${esc(r.old.status)}</span>`;
    const cell = (k, label) => {
      const ch = r.kind === "upd" && k in r.changes;
      const old = r.old?.[k];
      return `<div class="${ch ? "chg" : ""}"><span>${label}</span> ${ch && old !== null && old !== undefined ? `<s>${esc(old)}</s> ` : ""}<b>${esc(G().dash(v[k]))}</b></div>`;
    };
    const miss = r.missing.length ? `<div class="why" style="color:var(--warn)">! No ${esc(r.missing.join(" or "))} — imported and sent to Mod Review.</div>` : "";
    return `<div class="ir ${miss ? "miss" : ""}">
      <div class="hd"><span class="ip">${esc(r.ip)}</span>${tag}${st}</div>
      ${who(r, v)}
      <div class="g">${cell("player_level", "LVL")}${SW.map((s) => cell(s.key, s.short)).join("")}</div>${miss}</div>`;
  }
  function who(r, v) {
    const ch = (k) => r.kind === "upd" && r.changes && k in r.changes;
    const show = (k, txt) => {
      if (!ch(k)) return esc(txt);
      const old = r.old?.[k];
      return `${old !== null && old !== undefined && old !== "" ? `<s>${esc(fmtN(old))}</s> ` : ""}<b class="w">${esc(txt)}</b>`;
    };
    const parts = [];
    parts.push(v.account_name ? show("account_name", v.account_name) : `<span class="muted">no name</span>`);
    if (v.crew_name || v.crew_tag) parts.push(`${v.crew_name ? show("crew_name", v.crew_name) : ""}${v.crew_tag ? ` ${ch("crew_tag") ? show("crew_tag", `[${v.crew_tag}]`) : esc(`[${v.crew_tag}]`)}` : ""}`);
    else parts.push(`<span class="muted">no crew</span>`);
    if (v.reputation !== undefined && v.reputation !== null) parts.push(`rep ${show("reputation", fmtN(v.reputation))}`);
    return `<div class="who">${parts.join(" · ")}</div>`;
  }

  function draw() {
    if (read?.error) {
      prev.innerHTML = colsCard() + `<div class="card warn"><div class="card-h">Can't import</div><p class="small" style="margin:0">${esc(read.error)}</p></div>`;
      wireCols();
      return;
    }
    const n = (k) => list.filter((r) => r.kind === k).length;
    const nNew = n("new"), nUpd = n("upd"), nSame = n("same"), nBad = n("bad");
    const nMiss = list.filter((r) => r.missing && r.missing.length).length;
    const nProb = list.filter(isProb).length;
    const pick = filter === "new" ? list.filter((r) => r.kind === "new")
      : filter === "chg" ? list.filter((r) => r.kind === "upd")
      : filter === "prob" ? list.filter(isProb) : list;
    const show = pick.slice(0, limit);
    const total = nNew + nUpd;
    const label = total
      ? `Import ${plural(total, "IP", "IPs")} (${[nNew && `${nNew} new`, nUpd && `${nUpd} updated`, nMiss && `${nMiss} to Mod Review`].filter(Boolean).join(", ")})`
      : "Nothing to import";
    prev.innerHTML = colsCard() + `
      <div class="t5">
        <div class="tile"><div class="k">New</div><div class="v gain">${nNew}</div></div>
        <div class="tile"><div class="k">Updated</div><div class="v" style="color:var(--warn)">${nUpd}</div></div>
        <div class="tile"><div class="k">Same</div><div class="v muted">${nSame}</div></div>
        <div class="tile"><div class="k">Missing</div><div class="v" style="color:var(--warn)">${nMiss}</div><div class="s">→ Mod Review</div></div>
        <div class="tile"><div class="k">Skipped</div><div class="v" style="color:var(--danger)">${nBad}</div><div class="s">not imported</div></div>
      </div>
      <div class="card">
        <div class="card-h">Rows<span class="r">${list.length}</span></div>
        <div class="chips" style="margin-bottom:6px">
          <button class="chip ${filter === "all" ? "on" : ""}" data-f="all">All</button>
          <button class="chip ${filter === "new" ? "on" : ""}" data-f="new">New ${nNew}</button>
          <button class="chip ${filter === "chg" ? "on" : ""}" data-f="chg">Changed ${nUpd}</button>
          <button class="chip ${filter === "prob" ? "on" : ""}" data-f="prob">Problems ${nProb}</button>
        </div>
        ${show.length ? show.map(rowHtml).join("") : `<div class="empty">Nothing here.</div>`}
        ${pick.length > show.length ? `<button class="btn ghost block sm" data-more style="margin-top:8px">Show more (${pick.length - show.length} left)</button>` : ""}
        ${read.dupes ? `<div class="hint">${plural(read.dupes, "repeated IP", "repeated IPs")} in the paste: the last row is used.</div>` : ""}
      </div>
      <button class="btn primary block" data-go ${total ? "" : "disabled"}>${esc(label)}</button>`;
    wireCols();
    $$("[data-f]", prev).forEach((b) => (b.onclick = () => { filter = b.dataset.f; limit = 60; draw(); }));
    const more = $("[data-more]", prev);
    if (more) more.onclick = () => { limit += 100; draw(); };
    const go = $("[data-go]", prev);
    if (go && total) go.onclick = () => doImport(go, label, nMiss);
  }

  async function doImport(btn, label, nMiss) {
    const act = list.filter((r) => r.status === "active").length;
    if (!(await confirmBox({
      title: label.replace(/^Import/, "Import") + "?",
      body: `New IPs are saved as Unknown.${act ? ` ${plural(act, "saved IP", "saved IPs")} change to Active (software level changed).` : ""}${nMiss ? ` ${nMiss} with missing FW or level go to Mod Review.` : ""} Skipped rows are not saved.`,
      ok: "Import"
    }))) return;
    btnBusy(btn, true, "Importing…");
    try {
      const r = await runImport(list, (t) => (btn.textContent = t));
      toast(`Imported ${r.added + r.updated}${r.flagged ? ` · ${r.flagged} sent to Mods` : ""}`);
      ta.value = ""; read = null; list = null;
      prev.innerHTML = `<div class="card"><div class="card-h">Done</div>
        <p class="small" style="margin:0">Added ${plural(r.added, "new IP", "new IPs")} and updated ${r.updated}.${r.activated ? ` ${plural(r.activated, "IP", "IPs")} marked Active.` : ""}${r.flagged ? ` ${plural(r.flagged, "IP was", "IPs were")} sent to Mod Review.` : ""}</p></div>`;
    } catch (e) { btnBusy(btn, false); toast(errMsg(e), true); }
  }

  ta.addEventListener("input", schedule);
};
})();
