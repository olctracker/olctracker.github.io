/* =========================================================
   OLC Database — Last Reboot
   Rebooting on My Device saves your best targets from that run:
   crypto top 50 for the last 7 days and the whole run, and your
   siphon top 50. Only you can see your own. The Crypto and Siphon
   trackers are not reset by a reboot.
   ========================================================= */
(() => {
"use strict";
const O = () => window.OLC;
const G = () => window.OLC_GAME;
const PAGES = (window.OLC_PAGES = window.OLC_PAGES || {});

const fmt = (n) => Math.round(Number(n) || 0).toLocaleString("en-US");
const missingTable = (e) => e && (e.code === "42P01" || e.code === "PGRST205" || /reboot_snapshots/i.test(e.message || ""));

PAGES.reboot = async function pageReboot(main) {
  const { sb, S, esc, $, $$, errMsg, fmtDate } = O();
  const { data, error } = await sb.from("reboot_snapshots").select("*").eq("user_id", S.profile.id)
    .order("run", { ascending: false }).limit(10);
  if (error) {
    main.innerHTML = missingTable(error)
      ? `<div class="card warn"><div class="card-h">Database update needed</div><p class="small" style="margin:0">This page needs the latest database update. The Admin runs it once in Supabase (SQL Editor).</p></div>`
      : `<div class="card"><div class="card-h">Error</div><p>${esc(errMsg(error))}</p></div>`;
    return;
  }
  const snaps = data || [];
  if (!snaps.length) {
    main.innerHTML = `<div class="card"><div class="card-h">Last Reboot</div>
      <p class="small muted" style="margin:0">Nothing saved yet. The next time you reboot on <a href="#/device">My Device</a>, your top crypto targets (last 7 days and the whole run) and your top siphons are saved here, so you can find them again.</p></div>`;
    return;
  }

  let st = {};
  try { st = JSON.parse(sessionStorage.getItem("olc-reboot") || "{}"); } catch (e) {}
  let tab = st.tab || "week", run = snaps.some((s) => s.run === st.run) ? st.run : snaps[0].run, shown = 20;
  const keep = () => { try { sessionStorage.setItem("olc-reboot", JSON.stringify({ tab, run })); } catch (e) {} };

  // who is on those IPs now (names, and where a wallet's IP is today)
  const ips = new Set(), wallets = new Set();
  for (const s of snaps) {
    for (const e of [...(s.crypto_run || []), ...(s.crypto_week || [])]) {
      if (e.kind === "ip") ips.add(e.key); else wallets.add(e.key);
      if (e.wallet) wallets.add(e.wallet);
    }
    (s.siphon || []).forEach((e) => ips.add(e.ip));
  }
  const wIp = {};
  const wl = [...wallets];
  for (let i = 0; i < wl.length; i += 150) {
    const { data: w } = await sb.from("wallets").select("wallet,ip").in("wallet", wl.slice(i, i + 150));
    (w || []).forEach((x) => { wIp[x.wallet] = x.ip; if (x.ip && G().isFullIp(x.ip)) ips.add(x.ip); });
  }
  const tmap = {};
  const il = [...ips];
  for (let i = 0; i < il.length; i += 150) {
    const { data: t } = await sb.from("targets").select("ip,account_name,crew_name").in("ip", il.slice(i, i + 150));
    (t || []).forEach((x) => (tmap[x.ip] = x));
  }
  const who = (ip) => { const t = tmap[ip]; return t ? [t.account_name, t.crew_name].filter(Boolean).map(esc).join(" · ") : ""; };

  function cryptoRow(e, i) {
    let head, sub;
    if (e.kind === "ip") {
      head = G().ipText(e.key);
      const now = e.wallet && wIp[e.wallet];
      sub = [who(e.key), now && now !== e.key ? `wallet now on ${esc(now)}` : ""].filter(Boolean).join(" · ");
    } else {
      const now = wIp[e.key];
      head = `<span class="mono">${esc(e.key)}</span> <span class="badge">no IP</span>`;
      sub = now ? `IP now ${G().isFullIp(now) ? G().ipText(now) : esc(now)}${who(now) ? " · " + who(now) : ""}` : "wallet · IP not known";
    }
    return `<li><span class="rk">${i + 1}</span><div class="grow">${head}${sub ? `<div class="tiny muted">${sub}</div>` : ""}</div>
      <div class="rt"><b class="gain">${fmt(e.total)}</b><div class="tiny muted">${fmt(e.visits)} visit${Number(e.visits) === 1 ? "" : "s"}</div></div>
      <button class="icon-btn" data-copy="${esc(e.kind === "ip" ? e.key : (wIp[e.key] && G().isFullIp(wIp[e.key]) ? wIp[e.key] : e.key))}" aria-label="Copy">${G().IC.copy}</button></li>`;
  }
  function siphonRow(e, i) {
    return `<li><span class="rk">${i + 1}</span><div class="grow">${G().ipText(e.ip)}
        <div class="tiny muted">${[who(e.ip), e.level != null ? `LV ${esc(e.level)}` : "", e.pct != null ? `${esc(e.pct)}%` : ""].filter(Boolean).join(" · ")}</div></div>
      <div class="rt"><b class="gain">${fmt(e.siphoned)}</b><div class="tiny muted">siphoned</div></div>
      <button class="icon-btn" data-copy="${esc(e.ip)}" aria-label="Copy">${G().IC.copy}</button></li>`;
  }

  function draw() {
    const s = snaps.find((x) => x.run === run) || snaps[0];
    const list = tab === "week" ? s.crypto_week || [] : tab === "run" ? s.crypto_run || [] : s.siphon || [];
    const title = tab === "week" ? "Top 50 · last 7 days" : tab === "run" ? "Top 50 · whole run" : "Top 50 siphons";
    main.innerHTML = `
      ${snaps.length > 1 ? `<div class="chips" style="margin-bottom:12px">${snaps.map((x) =>
        `<button class="chip ${x.run === s.run ? "on" : ""}" data-run="${x.run}">R${x.run}</button>`).join("")}</div>` : ""}
      <div class="tiles"><div class="tile big"><div class="k">Run R${s.run} · rebooted ${esc(fmtDate(s.rebooted_at))}</div>
        <div class="v gain">${fmt(tab === "week" ? s.week_total : s.run_total)}</div>
        <div class="s">${tab === "week" ? "Stolen in the last 7 days before the reboot." : "Stolen that run."} Saved when you rebooted on My Device.</div></div></div>
      <div class="seg" style="grid-template-columns:repeat(3,1fr)">
        ${[["week", "Last week"], ["run", "Whole run"], ["siphon", "Siphon"]].map(([k, l]) => `<button data-tab="${k}" class="${tab === k ? "on" : ""}">${l}</button>`).join("")}
      </div>
      <div class="card">
        <div class="card-h">${title}<span class="r">${tab === "siphon" ? "siphoned" : "total · visits"}</span></div>
        ${list.length ? `<ul class="list rb-list">${list.slice(0, shown).map(tab === "siphon" ? siphonRow : cryptoRow).join("")}</ul>
          ${list.length > shown ? `<button class="btn block ghost sm" data-more style="margin-top:8px">Show all ${list.length}</button>` : ""}`
          : `<div class="empty">Nothing saved for this one.</div>`}
      </div>`;
    $$("[data-tab]", main).forEach((b) => (b.onclick = () => { tab = b.dataset.tab; shown = 20; keep(); draw(); }));
    $$("[data-run]", main).forEach((b) => (b.onclick = () => { run = Number(b.dataset.run); shown = 20; keep(); draw(); }));
    $$("[data-copy]", main).forEach((b) => (b.onclick = () => G().copy(b.dataset.copy)));
    const more = $("[data-more]", main);
    if (more) more.onclick = () => { shown = 50; draw(); };
  }
  draw();
};
})();
