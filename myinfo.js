/* =========================================================
   OLC Database — My Info (v1.8.0)
   My Device · Leveling Guide · Level History
   Private to each member: only you see your own device.
   ========================================================= */
(() => {
"use strict";
const O = () => window.OLC;
const G = () => window.OLC_GAME;
const PAGES = (window.OLC_PAGES = window.OLC_PAGES || {});

const CLASSES = [
  { key: "ghost", name: "Ghost" }, { key: "vector", name: "Vector" }, { key: "scythe", name: "Scythe" },
  { key: "cipher", name: "Cipher" }, { key: "apex", name: "Apex" }
];
const SPLIT_FROM = 6;                           // from R6 on, device and network can differ
const APEX_BYPASS = 3;
const clsName = (k) => (CLASSES.find((c) => c.key === k) || {}).name || "";
const appName = (k) => k === "keygen" ? "Keygen" : k === "player_level" ? "Player level"
  : (G().PROGRAMS.find((p) => p.key === k) || { name: k }).name;
const DAY = 86400000;
const days = (a, b) => (new Date(b) - new Date(a)) / DAY;
const fmtDays = (d) => (d < 10 ? (Math.round(d * 10) / 10) : Math.round(d)) + "d";

const missingDb = (e) => e && (/member_devices|device_runs|device_levels|device_reboot/i.test(e.message || "") ||
  ["PGRST202", "PGRST205", "42P01"].includes(e.code));
const needUpdate = `<div class="card warn"><div class="card-h">Database update needed</div>
  <p class="small" style="margin:0">My Info needs the latest database update. The Admin runs it once in Supabase (SQL Editor).</p></div>`;

/* ---------- load / save my device ---------- */
async function loadDevice() {
  const { sb, S } = O();
  const { data, error } = await sb.from("member_devices").select("*").eq("user_id", S.profile.id).maybeSingle();
  if (error) throw error;
  G().setMyDevice(data);
  return data;
}
async function saveDevice(changes) {
  const { sb, S } = O();
  const { data, error } = await sb.from("member_devices")
    .upsert({ user_id: S.profile.id, ...changes }, { onConflict: "user_id" }).select().single();
  if (error) throw error;
  G().setMyDevice(data);
  return data;
}
const bypassLimit = (d) => (d?.bypasser ?? 0) + (d?.device_class === "apex" ? APEX_BYPASS : 0);
function classPill(d) {
  const { esc } = O();
  if (!d?.device_class) return `<span class="cls-pill">No class · R${d?.reboots ?? 0}</span>`;
  const net = d.network_class && d.network_class !== d.device_class
    ? ` <span class="cls-pill sm cls-${esc(d.network_class)}">net ${esc(clsName(d.network_class))}</span>` : "";
  return `<span class="cls-pill cls-${esc(d.device_class)}">${esc(clsName(d.device_class))} · R${d.reboots}</span>${net}`;
}

/* ---------- small dialogs ---------- */
function numberAsk(title, value, hint = "") {
  const { modal, esc, $ } = O();
  return new Promise((done) => {
    modal(`<h3>${esc(title)}</h3>
      <form><input class="input mono" inputmode="numeric" pattern="[0-9]*" maxlength="4" value="${esc(value ?? "")}">
      ${hint ? `<div class="hint">${esc(hint)}</div>` : ""}<div class="err"></div>
      <div class="btns"><button class="btn" type="button" data-no>Cancel</button><button class="btn primary" type="submit">Save</button></div></form>`,
    (w, close) => {
      const inp = $("input", w);
      setTimeout(() => { inp.focus(); inp.select(); }, 60);
      $("[data-no]", w).onclick = () => { close(); done(undefined); };
      $("form", w).onsubmit = (e) => {
        e.preventDefault();
        const v = inp.value.trim();
        if (!/^\d{1,4}$/.test(v)) { $(".err", w).textContent = "Enter a number"; return; }
        close(); done(Number(v));
      };
    });
  });
}
function textAsk(title, value, { placeholder = "", mono = true, check } = {}) {
  const { modal, esc, $ } = O();
  return new Promise((done) => {
    modal(`<h3>${esc(title)}</h3>
      <form><input class="input ${mono ? "mono" : ""}" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="${esc(placeholder)}" value="${esc(value ?? "")}">
      <div class="hint">Leave empty to remove it.</div><div class="err"></div>
      <div class="btns"><button class="btn" type="button" data-no>Cancel</button><button class="btn primary" type="submit">Save</button></div></form>`,
    (w, close) => {
      const inp = $("input", w);
      setTimeout(() => { inp.focus(); inp.select(); }, 60);
      $("[data-no]", w).onclick = () => { close(); done(undefined); };
      $("form", w).onsubmit = (e) => {
        e.preventDefault();
        const v = inp.value.trim();
        const bad = v && check ? check(v) : "";
        if (bad) { $(".err", w).textContent = bad; return; }
        close(); done(v === "" ? null : v);
      };
    });
  });
}
const classRow = (attr, on) => `<div class="cls-row">${CLASSES.map((c) =>
  `<button type="button" class="cls-btn cls-${c.key} ${on === c.key ? "on" : ""}" ${attr}="${c.key}">${c.name}</button>`).join("")}</div>`;

/* Reboot: confirm + pick the class for the new run */
function rebootDialog(d) {
  const { modal, esc, $, $$ } = O();
  const next = d.reboots + 1, split = next >= SPLIT_FROM;
  return new Promise((done) => {
    let dev = d.device_class || null, net = d.network_class || d.device_class || null;
    modal(`<h3>Reboot to R${next}?</h3>
      <p>Closes run R${d.reboots}, resets your software and Keygen to the start and opens run R${next}. This can't be undone.</p>
      <div class="flabel">${split ? "Device class" : "Class"} for R${next}</div>${classRow("data-dev", dev)}
      ${split ? `<div class="flabel" style="margin-top:10px">Network class</div>${classRow("data-net", net)}` : ""}
      <div class="err"></div>
      <div class="btns"><button class="btn" data-no>Cancel</button><button class="btn danger" data-yes>Reboot</button></div>`,
    (w, close) => {
      const paint = () => {
        $$("[data-dev]", w).forEach((b) => b.classList.toggle("on", b.dataset.dev === dev));
        $$("[data-net]", w).forEach((b) => b.classList.toggle("on", b.dataset.net === net));
      };
      $$("[data-dev]", w).forEach((b) => (b.onclick = () => { dev = b.dataset.dev; paint(); }));
      $$("[data-net]", w).forEach((b) => (b.onclick = () => { net = b.dataset.net; paint(); }));
      $("[data-no]", w).onclick = () => { close(); done(null); };
      $("[data-yes]", w).onclick = () => {
        if (!dev || (split && !net)) { $(".err", w).textContent = "Pick the class" + (split ? "es" : ""); return; }
        close(); done({ dev, net: split ? net : dev });
      };
    }, { sticky: true });
  });
}

/* Paste the software screen (also reads Keygen) */
function pasteDialog(d) {
  const { modal, $, esc } = O();
  const list = [...G().PROGRAMS, { key: "keygen", name: "Keygen" }];
  return new Promise((done) => {
    modal(`<h3>Paste software screen</h3>
      <p>Copy your software screen in the game and paste it here. Keygen is read too.</p>
      <textarea class="input mono" rows="6" placeholder="Antivirus&#10;Scans and removes viruses…&#10;LVL 34&#10;…"></textarea>
      <div data-prev style="margin-top:12px"></div>
      <div class="btns" style="margin-top:12px"><button class="btn" data-no>Cancel</button><button class="btn primary" data-yes disabled>Save</button></div>`,
    (w, close) => {
      const ta = $("textarea", w);
      let found = {};
      ta.addEventListener("input", () => {
        found = G().readSoftwarePaste(ta.value, { keygen: true });
        const n = Object.keys(found).length;
        $("[data-yes]", w).disabled = !n;
        $("[data-prev]", w).innerHTML = !ta.value.trim() ? "" : `
          <div class="tiny mono muted" style="margin-bottom:6px">FOUND ${n} OF ${list.length}</div>
          <div class="sw-grid">${list.map((p) => {
            const has = p.key in found, old = d ? d[p.key] : null;
            return `<div class="sw-tile ${has ? "" : "miss"}"><span>${esc(p.name)}</span>
              <b>${has ? found[p.key] : G().dash(old)}</b><em>${has ? (old != null && old !== found[p.key] ? `was ${old}` : "new") : "kept"}</em></div>`;
          }).join("")}</div>`;
      });
      setTimeout(() => ta.focus(), 60);
      $("[data-no]", w).onclick = () => { close(); done(null); };
      $("[data-yes]", w).onclick = () => { close(); done(found); };
    });
  });
}

/* =========================================================
   MY DEVICE
   ========================================================= */
PAGES.device = async function pageDevice(main) {
  const { esc, $, $$, toast, errMsg, render } = O();
  const { IC, PROGRAMS, dash, isFullIp, tidyIp, copy } = G();
  let d;
  try { d = await loadDevice(); }
  catch (e) { main.innerHTML = missingDb(e) ? needUpdate : `<div class="card"><p>${esc(errMsg(e))}</p></div>`; return; }
  const r = d?.reboots ?? 0, split = r >= SPLIT_FROM;
  const foldOpen = (() => { try { return sessionStorage.getItem("olc-dev-fold") === "1"; } catch (e) { return false; } })();

  main.innerHTML = `
    <div class="card accent">
      <div class="row">
        <button class="grow ip-edit" data-ip><div class="tiny mono muted">MY IP · ONLY YOU SEE THIS</div>
          <div class="ip-big mono ${d?.ip ? "" : "muted"}">${d?.ip ? esc(d.ip) : "Tap to add"}</div></button>
        ${d?.ip ? `<button class="icon-btn" data-copy aria-label="Copy IP">${IC.copy}</button>` : ""}
      </div>
      <div style="margin:8px 0 14px">${classPill(d)}</div>
      <div class="stats">
        <button class="stat" data-num="player_level"><div class="k">Player level</div><div class="v">${dash(d?.player_level)}</div></button>
        <button class="stat" data-num="keygen"><div class="k">Keygen</div><div class="v">${dash(d?.keygen)}</div></button>
        <button class="stat" data-num="bypasser"><div class="k">Bypasser</div><div class="v">${dash(d?.bypasser)}${d?.device_class === "apex" ? ` <small class="plus">+${APEX_BYPASS}</small>` : ""}</div></button>
      </div>
    </div>

    <div class="card">
      <div class="card-h">My software<span class="r">tap to change</span></div>
      <button class="btn block" data-paste style="margin-bottom:12px">${IC.paste} Paste software screen</button>
      <div class="sw-grid big">${PROGRAMS.map((p) => `
        <button class="sw-tile ${d && d[p.key] != null ? "" : "miss"}" data-num="${p.key}"><span>${esc(p.name)}</span><b>${dash(d?.[p.key])}</b></button>`).join("")}</div>
    </div>

    <div class="card">
      <details class="fold" ${foldOpen ? "open" : ""}><summary>Reboot, class &amp; wallet</summary>
        <div class="flabel" style="margin-top:12px">Reboots done</div>
        <div class="stepper"><button class="btn" data-step="-1" ${r <= 0 ? "disabled" : ""}>−</button><b class="mono">R${r}</b><button class="btn" data-step="1">+</button></div>
        <div class="hint">For reboots before you used the app. Changing this doesn't reset anything.</div>

        <div class="flabel" style="margin-top:14px">${split ? "Device class" : "Class"}</div>
        ${classRow("data-dev", d?.device_class)}
        ${split ? `<div class="flabel" style="margin-top:10px">Network class</div>${classRow("data-net", d?.network_class || d?.device_class)}
          <div class="hint">From R${SPLIT_FROM} on, device and network can be different.</div>` : ""}

        <div class="flabel" style="margin-top:14px">Wallet ID</div>
        <button class="who-row wallet-row" data-wallet><span class="v mono ${d?.wallet ? "" : "muted"}">${d?.wallet ? esc(d.wallet) : "Add wallet ID"}</span>${IC.chev}</button>

        <button class="btn danger block" data-reboot style="margin-top:14px" ${(d?.player_level ?? 0) >= 50 ? "" : "disabled"}>Reboot…</button>
        <div class="hint">${(d?.player_level ?? 0) >= 50 ? `Closes run R${r}, resets your software and starts R${r + 1}.` : "Reboot needs player level 50."}</div>
      </details>
    </div>`;

  const save = async (changes, msg = "Saved") => {
    try { await saveDevice(changes); toast(msg); render(); }
    catch (e) { toast(missingDb(e) ? "Needs the latest database update (ask the Admin)" : errMsg(e), true); }
  };
  $("details", main).addEventListener("toggle", (e) => { try { sessionStorage.setItem("olc-dev-fold", e.target.open ? "1" : "0"); } catch (x) {} });
  $("[data-copy]", main) && ($("[data-copy]", main).onclick = () => copy(d.ip));
  $("[data-ip]", main).onclick = async () => {
    const v = await textAsk("My IP", d?.ip, { placeholder: "123.45.67.89",
      check: (s) => (isFullIp(tidyIp(s)) ? "" : "Enter a full IP like 123.45.67.89") });
    if (v !== undefined) save({ ip: v ? tidyIp(v) : null }, v ? "IP saved · hidden from the crew" : "IP removed");
  };
  $("[data-wallet]", main).onclick = async () => {
    const v = await textAsk("My wallet ID", d?.wallet, { placeholder: "e.g. wasd...518c",
      check: (s) => (/\s/.test(s) ? "Wallet ID can't contain spaces" : "") });
    if (v !== undefined) save({ wallet: v }, v ? "Wallet saved · hidden from the crew" : "Wallet removed");
  };
  $$("[data-num]", main).forEach((b) => (b.onclick = async () => {
    const k = b.dataset.num;
    const v = await numberAsk(appName(k), d?.[k]);
    if (v !== undefined) save({ [k]: v }, `${appName(k)} saved`);
  }));
  $("[data-paste]", main).onclick = async () => {
    const found = await pasteDialog(d);
    if (found) save(found, `Saved ${Object.keys(found).length} levels`);
  };
  $$("[data-step]", main).forEach((b) => (b.onclick = () => {
    const n = Math.max(0, r + Number(b.dataset.step));
    save({ reboots: n, ...(n < SPLIT_FROM && d?.device_class ? { network_class: d.device_class } : {}) }, `Reboots set to R${n}`);
  }));
  $$("[data-dev]", main).forEach((b) => (b.onclick = () =>
    save({ device_class: b.dataset.dev, ...(split ? {} : { network_class: b.dataset.dev }) }, `Class: ${clsName(b.dataset.dev)}`)));
  $$("[data-net]", main).forEach((b) => (b.onclick = () => save({ network_class: b.dataset.net }, `Network: ${clsName(b.dataset.net)}`)));
  $("[data-reboot]", main).onclick = async () => {
    const pick = await rebootDialog(d);
    if (!pick) return;
    const { data, error } = await O().sb.rpc("device_reboot", { p_device_class: pick.dev, p_network_class: pick.net });
    if (error) return toast(errMsg(error), true);
    toast(`Rebooted · run R${data} started`);
    await loadDevice().catch(() => {});
    render();
  };
};

/* =========================================================
   LEVELING GUIDE — firewall level only, no chances or estimates
   ========================================================= */
async function loadTargets() {
  const { sb } = O();
  const cols = ["ip", "firewall", "scrambled", ...G().PROGRAMS.map((p) => p.key)].join(",");
  const out = [];
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await sb.from("targets").select(cols).not("firewall", "is", null).eq("scrambled", false)
      .order("ip").range(from, from + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/* Builds the guide. Returns { cards, notFound, keygenWait, unknown } */
function buildGuide(d, targets) {
  const keygen = d.keygen, limit = bypassLimit(d);
  const plans = [], notFound = [], keygenWait = [], unknown = [];
  for (const p of G().PROGRAMS) {
    const mine = d[p.key];
    if (mine == null) { unknown.push(p); continue; }
    const goal = mine + 1;
    if (goal > keygen) { keygenWait.push(p); continue; }
    const cand = targets.filter((t) => t[p.key] != null && t[p.key] > mine && t[p.key] <= keygen);
    if (!cand.length) { notFound.push({ p, mine, goal }); continue; }
    // best = closest level up (exactly my next level if anyone has it), then lowest firewall
    const best = (list) => {
      if (!list.length) return null;
      const lvl = Math.min(...list.map((t) => t[p.key]));
      const atLvl = list.filter((t) => t[p.key] === lvl);
      const fw = Math.min(...atLvl.map((t) => t.firewall));
      return { lvl, fw, ties: atLvl.filter((t) => t.firewall === fw) };
    };
    const main = best(cand);
    const safer = main.fw > limit ? best(cand.filter((t) => t.firewall <= limit)) : null;
    plans.push({ p, mine, goal, main, safer });
  }
  // ties at the same firewall: prefer the IP that is also the pick for the most other apps
  const score = new Map();
  for (const pl of plans) for (const t of pl.main.ties) score.set(t.ip, (score.get(t.ip) || 0) + 1);
  const choose = (opt) => opt && { ...opt, t: [...opt.ties].sort((a, b) => (score.get(b.ip) || 0) - (score.get(a.ip) || 0) || a.ip.localeCompare(b.ip))[0] };
  const skips = (goal, lvl) => Array.from({ length: Math.max(0, lvl - goal) }, (_, i) => goal + i);
  const byIp = new Map();
  for (const pl of plans) {
    const m = choose(pl.main), s = choose(pl.safer);
    const row = { p: pl.p, mine: pl.mine, lvl: m.lvl, fw: m.fw, skip: skips(pl.goal, m.lvl),
      safer: s && { ip: s.t.ip, fw: s.fw, lvl: s.lvl, skip: skips(pl.goal, s.lvl) } };
    if (!byIp.has(m.t.ip)) byIp.set(m.t.ip, { ip: m.t.ip, fw: m.fw, rows: [] });
    byIp.get(m.t.ip).rows.push(row);
  }
  const cards = [...byIp.values()].sort((a, b) => b.rows.length - a.rows.length || a.fw - b.fw);
  return { cards, notFound, keygenWait, unknown, limit };
}

PAGES.leveling = async function pageLeveling(main) {
  const { esc, $$, toast, errMsg, render, modal, $ } = O();
  const { IC, copy } = G();
  let d;
  try { d = await loadDevice(); }
  catch (e) { main.innerHTML = missingDb(e) ? needUpdate : `<div class="card"><p>${esc(errMsg(e))}</p></div>`; return; }
  const missing = !d ? ["your software"] : [d.keygen == null && "Keygen", d.bypasser == null && "Bypasser"].filter(Boolean);
  if (missing.length) {
    main.innerHTML = `<div class="card"><div class="card-h">Set up My Device first</div>
      <p class="small muted" style="margin-top:0">The guide needs ${esc(missing.join(" and "))} from My Device.</p>
      <a class="btn primary block" href="#/device">Open My Device</a></div>`;
    return;
  }

  let targets = (await loadTargets()).filter((t) => t.ip !== d.ip && G().isFullIp(t.ip));
  targets = await G().dropCrew(targets, (t) => [t.ip]);
  const g = buildGuide(d, targets);
  const skipNote = (s) => s.length ? `<div class="skip">skips ${s.length} level${s.length === 1 ? "" : "s"} (${s.join(", ")})</div>` : "";

  main.innerHTML = `
    <div class="tiny muted" style="margin:0 4px 12px">Goal: each app +1, up to Keygen ${d.keygen}. Your Bypasser limit is
      <b class="mono">FW ${g.limit}</b>${d.device_class === "apex" ? " (Apex +3)" : ""}. Lowest firewall first.</div>
    ${g.cards.map((c) => `
      <div class="card guide">
        <div class="row">
          <div class="fw-pill mono ${c.fw > g.limit ? "over" : ""}"><small>FW</small>${c.fw}</div>
          <div class="grow"><a class="mono ip-row" href="#/ip/${encodeURIComponent(c.ip)}">${esc(c.ip)}</a>
            <div class="tiny muted">${c.rows.length} app${c.rows.length === 1 ? "" : "s"}</div></div>
          <button class="icon-btn" data-copy="${esc(c.ip)}" aria-label="Copy IP">${IC.copy}</button>
        </div>
        ${c.rows.map((r) => `
          <div class="g-row">
            <div class="grow"><b>${esc(r.p.name)}</b> <span class="mono">${r.mine} → <span class="to">${r.lvl}</span></span>${skipNote(r.skip)}</div>
            <button class="btn sm" data-done="${r.p.key}" aria-label="Done">${IC.check}</button>
          </div>
          ${r.safer ? `<div class="safer">
            <div class="grow"><span class="tiny mono muted">SAFER</span> <span class="mono">${esc(r.safer.ip)}</span>
              <span class="fw-mini mono">FW ${r.safer.fw}</span> <span class="mono">→ ${r.safer.lvl}</span>${skipNote(r.safer.skip)}</div>
            <button class="icon-btn" data-copy="${esc(r.safer.ip)}" aria-label="Copy IP">${IC.copy}</button>
          </div>` : ""}`).join("")}
      </div>`).join("")}
    ${!g.cards.length ? `<div class="card"><div class="empty">No saved IPs fit your next levels yet.</div></div>` : ""}
    ${g.notFound.length ? `<div class="card">
      <div class="card-h">Not found yet<span class="r">buy in store</span></div>
      <ul class="list">${g.notFound.map((n) => `<li><span class="grow">${esc(n.p.name)}</span><span class="mono muted">${n.mine} → ${n.goal}</span></li>`).join("")}</ul>
      <div class="hint">No saved IP has these levels (up to Keygen ${d.keygen}).</div></div>` : ""}
    ${g.keygenWait.length ? `<div class="card"><div class="card-h">Waiting on Keygen</div>
      <p class="small muted" style="margin:0">${esc(g.keygenWait.map((p) => p.name).join(", "))} ${g.keygenWait.length === 1 ? "is" : "are"} at your Keygen (${d.keygen}). Level Keygen first.</p></div>` : ""}
    ${g.unknown.length ? `<div class="card"><div class="card-h">Levels missing</div>
      <p class="small muted" style="margin:0">Add ${esc(g.unknown.map((p) => p.name).join(", "))} in <a href="#/device">My Device</a> to include ${g.unknown.length === 1 ? "it" : "them"}.</p></div>` : ""}`;

  $$("[data-copy]", main).forEach((b) => (b.onclick = () => copy(b.dataset.copy)));
  const rows = new Map(g.cards.flatMap((c) => c.rows.map((r) => [r.p.key, r])));
  $$("[data-done]", main).forEach((b) => (b.onclick = async () => {
    const r = rows.get(b.dataset.done);
    let lvl = r.lvl;
    if (r.safer && r.safer.lvl !== r.lvl) {
      lvl = await new Promise((done) => modal(`<h3>${esc(r.p.name)}: which level did you take?</h3>
        <button class="sheet-btn" data-l="${r.lvl}">Level ${r.lvl} <span class="muted small">· FW ${r.fw}</span></button>
        <button class="sheet-btn" data-l="${r.safer.lvl}">Level ${r.safer.lvl} <span class="muted small">· safer, FW ${r.safer.fw}</span></button>
        <button class="btn block" data-l="" style="margin-top:10px">Cancel</button>`,
        (w, close) => $$("[data-l]", w).forEach((x) => (x.onclick = () => { close(); done(x.dataset.l ? Number(x.dataset.l) : null); }))));
      if (lvl == null) return;
    }
    try { await saveDevice({ [r.p.key]: lvl }); toast(`${r.p.name} → ${lvl}`); render(); }
    catch (e) { toast(errMsg(e), true); }
  }));
};

/* =========================================================
   LEVEL HISTORY — one run per reboot
   ========================================================= */
PAGES.history = async function pageHistory(main, arg) {
  const { sb, S, esc, $, $$, toast, errMsg, render, fmtDate, confirmBox, go } = O();
  const uid = S.profile.id;
  const [rR, lR, dR] = await Promise.all([
    sb.from("device_runs").select("*").eq("user_id", uid).order("run", { ascending: false }),
    sb.from("device_levels").select("*").eq("user_id", uid).order("at", { ascending: true }).limit(10000),
    sb.from("member_devices").select("reboots").eq("user_id", uid).maybeSingle()
  ]);
  const err = rR.error || lR.error || dR.error;
  if (err) { main.innerHTML = missingDb(err) ? needUpdate : `<div class="card"><p>${esc(errMsg(err))}</p></div>`; return; }
  const runs = rR.data || [], levels = lR.data || [], cur = dR.data?.reboots;
  if (!runs.length) {
    main.innerHTML = `<div class="card"><div class="card-h">No history yet</div>
      <p class="small muted" style="margin-top:0">Save your device in My Device. Every level-up after that is recorded here, per reboot run.</p>
      <a class="btn primary block" href="#/device">Open My Device</a></div>`;
    return;
  }
  const now = new Date();
  const stat = (run) => {
    const end = run.ended_at ? new Date(run.ended_at) : now;
    const to50 = run.hit50_at ? days(run.started_at, run.hit50_at) : null;
    return { total: days(run.started_at, end), to50, perLvl: to50 != null ? to50 / 49 : null };
  };
  const sel = runs.find((x) => String(x.run) === String(arg)) || runs.find((x) => x.run === cur) || runs[0];
  const lv = levels.filter((x) => x.run === sel.run);
  const st = stat(sel);
  const pl = lv.filter((x) => x.app === "player_level");
  const gaps = pl.map((x, i) => ({ from: i ? pl[i - 1].level : null, to: x.level, d: days(i ? pl[i - 1].at : sel.started_at, x.at), first: !i }))
    .filter((x) => !x.first);                     // only gaps between recorded level-ups
  const maxGap = Math.max(0.1, ...gaps.map((x) => x.d));
  const pill = (r) => r.device_class ? `<span class="cls-pill sm cls-${esc(r.device_class)}">${esc(clsName(r.device_class))}</span>` : `<span class="muted">—</span>`;
  const dayKey = (t) => new Date(t).toDateString();
  const newest = [...lv].reverse();
  let shown = 40;

  main.innerHTML = `
    ${runs.length > 1 ? `<div class="card">
      <div class="card-h">Compare runs</div>
      <table class="cmp">
        <tr><th>Run</th><th>Class</th><th class="n">To 50</th><th class="n">Total</th><th class="n">Days/lvl</th></tr>
        ${runs.map((r) => { const s = stat(r); return `<tr class="${r.run === cur ? "cur" : ""}" data-run="${r.run}">
          <td>R${r.run}</td><td>${pill(r)}</td><td class="n">${s.to50 != null ? fmtDays(s.to50) : "—"}</td>
          <td class="n">${fmtDays(s.total)}${r.ended_at ? "" : "…"}</td><td class="n">${s.perLvl != null ? (Math.round(s.perLvl * 10) / 10) : "—"}</td></tr>`; }).join("")}
      </table>
      <div class="hint">Days/lvl = days per player level up to 50. Tap a run to open it.</div>
    </div>
    <div class="chips run-chips">${runs.map((r) => `<button class="chip ${r.run === sel.run ? "on" : ""}" data-run="${r.run}">R${r.run}${r.run === cur ? " · now" : ""}</button>`).join("")}</div>` : ""}

    <div class="card accent">
      <div class="row"><div class="card-h grow" style="margin:0">Run R${sel.run}</div>${pill(sel)}
        ${sel.network_class && sel.network_class !== sel.device_class ? `<span class="cls-pill sm cls-${esc(sel.network_class)}">net ${esc(clsName(sel.network_class))}</span>` : ""}</div>
      <div class="run-meta">
        <div>Started<b>${fmtDate(sel.started_at)}</b></div>
        <div>Reached 50<b class="${sel.hit50_at ? "" : "muted"}">${sel.hit50_at ? fmtDate(sel.hit50_at) : "not yet"}</b></div>
        <div>Rebooted<b class="${sel.ended_at ? "" : "muted"}">${sel.ended_at ? fmtDate(sel.ended_at) : "not yet"}</b></div>
        <div>Total<b>${Math.max(0, Math.round(st.total))} day${Math.round(st.total) === 1 ? "" : "s"}</b></div>
      </div>
      ${gaps.length ? `<div class="tiny mono muted" style="margin-bottom:6px">DAYS PER PLAYER LEVEL</div>
        <div class="dpl">${gaps.slice(-12).map((x) => `<span>${x.from != null ? `${x.from}→${x.to}` : `→${x.to}`}</span><i style="width:${Math.max(3, (x.d / maxGap) * 100)}%"></i><span>${fmtDays(x.d)}</span>`).join("")}</div>
        ${gaps.length > 12 ? `<div class="hint">Last 12 player levels.</div>` : ""}`
        : `<div class="tiny muted">Player level-ups in this run will show here.</div>`}
    </div>

    <div class="card">
      <div class="card-h">Level-ups<span class="r">newest first</span></div>
      <ul class="tl" data-tl></ul>
      <button class="btn block ghost" data-more style="margin-top:10px" hidden>Show older</button>
      <div class="hint">Tap an entry to remove it if it was a mistake.</div>
    </div>`;

  const today = new Date().toDateString();
  const drawTl = () => {
    let last = "", h = "";
    for (const x of newest.slice(0, shown)) {
      const k = dayKey(x.at);
      if (k !== last) { last = k; h += `<li class="day">${k === today ? "Today · " : ""}${esc(fmtDate(x.at))}</li>`; }
      const p = x.app === "player_level";
      h += `<li class="tap" data-del="${x.id}"><span class="${p ? "pl" : ""}">${esc(appName(x.app))}</span><span class="lv ${p ? "pl" : ""}">→ ${x.level}</span></li>`;
    }
    $("[data-tl]", main).innerHTML = h || `<li class="empty">No level-ups recorded in this run yet.</li>`;
    $("[data-more]", main).hidden = newest.length <= shown;
    $$("[data-del]", main).forEach((li) => (li.onclick = async () => {
      const x = levels.find((y) => String(y.id) === li.dataset.del);
      if (!(await confirmBox({ title: `Remove ${appName(x.app)} → ${x.level}?`, body: "Only removes it from your history. Your device isn't changed.", ok: "Remove", danger: true }))) return;
      const { error } = await sb.from("device_levels").delete().eq("id", x.id);
      if (error) return toast(errMsg(error), true);
      toast("Removed"); render();
    }));
  };
  drawTl();
  $("[data-more]", main).onclick = () => { shown += 60; drawTl(); };
  $$("[data-run]", main).forEach((b) => (b.onclick = () => go("history/" + b.dataset.run)));
};
})();
