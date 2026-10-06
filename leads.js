/* =========================================================
   OLC Database — stage 6 + 7: Leads and Server Top 25
   Leads: IPs found in victim logs the crew pasted, minus every
   target already in your own Crypto tracker. No amounts.
   Server Top 25 (Admin only): best crypto targets and siphon
   entries across all members.
   ========================================================= */
(() => {
"use strict";
const O = () => window.OLC;
const G = () => window.OLC_GAME;
const PAGES = (window.OLC_PAGES = window.OLC_PAGES || {});

const fmt = (n) => (n === null || n === undefined ? "—" : Math.round(Number(n)).toLocaleString("en-US"));
const ago = (d) => {
  if (!d) return "—";
  const s = Math.max(0, (Date.now() - new Date(d)) / 1000);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};
const missingFn = (e) => e && (e.code === "PGRST202" || /could not find the function/i.test(e.message || ""));
const needUpdate = () => `
  <div class="card warn">
    <div class="card-h">Database update needed</div>
    <p class="small" style="margin:0">This page needs the latest database update. The Admin runs it once in Supabase (SQL Editor).</p>
  </div>`;

/* =========================================================
   LEADS
   ========================================================= */
PAGES.leads = async function pageLeads(main) {
  const { sb, esc, $, $$, errMsg } = O();
  const { data, error } = await sb.rpc("list_leads");
  if (error) { main.innerHTML = missingFn(error) ? needUpdate() : `<div class="card"><div class="card-h">Error</div><p>${esc(errMsg(error))}</p></div>`; return; }
  const all = data || [];
  let q = "", shown = 100;
  try { q = sessionStorage.getItem("olc-leads-q") || ""; } catch (e) {}

  main.innerHTML = `
    <div class="tiles">
      <div class="tile big"><div class="k">Leads for you</div><div class="v gain">${fmt(all.length)}</div>
        <div class="s">From victim logs the crew pasted. IPs in your Crypto tracker are left out.</div></div>
    </div>
    <div class="searchbar">${G().IC.search}<input class="input" type="search" placeholder="Filter by IP or wallet ID" autocomplete="off" autocapitalize="none" spellcheck="false" value="${esc(q)}"></div>
    <div class="card"><div data-out></div></div>`;

  const out = $("[data-out]", main), inp = $("input", main);
  const draw = () => {
    const t = q.trim().toLowerCase();
    const list = t ? all.filter((l) => l.ip.includes(t) || (l.wallet || "").toLowerCase().includes(t)) : all;
    out.innerHTML = list.length ? `
      <div class="card-h">${t ? `${list.length} match${list.length === 1 ? "" : "es"}` : "Newest first"}<span class="r">seen · last</span></div>
      <ul class="list">${list.slice(0, shown).map((l) => `
        <li><div class="grow">${G().ipText(l.ip)}
            ${l.wallet ? `<div class="tiny muted mono">${esc(l.wallet)}</div>` : ""}
            <div class="tiny muted">seen ${fmt(l.times_seen)}× · last ${ago(l.last_seen)}</div></div>
          <button class="icon-btn" data-copy="${esc(l.ip)}" aria-label="Copy IP">${G().IC.copy}</button>
          <a class="icon-btn" href="#/ip/${encodeURIComponent(l.ip)}" aria-label="Open IP">${G().IC.chev}</a></li>`).join("")}</ul>
      ${list.length > shown ? `<button class="btn block" data-more style="margin-top:10px">Show more (${fmt(list.length - shown)} left)</button>` : ""}`
      : `<div class="empty">${t ? "No leads match that." : "No leads yet. Paste a victim log in Victim Logs to add some."}</div>`;
    $$("[data-copy]", out).forEach((b) => (b.onclick = () => G().copy(b.dataset.copy)));
    const more = $("[data-more]", out);
    if (more) more.onclick = () => { shown += 100; draw(); };
  };
  inp.addEventListener("input", () => {
    q = inp.value; shown = 100;
    try { sessionStorage.setItem("olc-leads-q", q); } catch (e) {}
    draw();
  });
  draw();
};

/* =========================================================
   SERVER TOP 25 (Admin only)
   ========================================================= */
// Siphon "age" (e.g. 3d) is measured from when the list was pasted.
function ageHours(age) {
  const m = /^(\d+)([smhdw])$/i.exec(age || "");
  return m ? Number(m[1]) * ({ s: 1 / 3600, m: 1 / 60, h: 1, d: 24, w: 168 }[m[2].toLowerCase()]) : null;
}
function periodStart(period) {
  const t = window.OLC_LOG_TEST && window.OLC_LOG_TEST.periodStart;
  return t ? t(period) : -Infinity;
}

PAGES.top = async function pageTop(main) {
  const { sb, S, esc, $, $$, errMsg, modal, isAdmin } = O();
  if (!isAdmin()) { main.innerHTML = `<div class="card"><div class="empty">Admin only.</div></div>`; return; }
  const st = (() => { try { return JSON.parse(sessionStorage.getItem("olc-top") || "{}"); } catch (e) { return {}; } })();
  let tab = st.tab || "crypto", period = st.period || "day", sort = st.sort || "total", ssort = st.ssort || "amount";
  const keep = () => { try { sessionStorage.setItem("olc-top", JSON.stringify({ tab, period, sort, ssort })); } catch (e) {} };
  const cache = {};
  let siphon = null;

  const head = () => `
    <div class="seg">
      <button data-tab="crypto" class="${tab === "crypto" ? "on" : ""}">Crypto</button>
      <button data-tab="siphon" class="${tab === "siphon" ? "on" : ""}">Siphon</button>
    </div>
    <div class="seg" style="grid-template-columns:repeat(3,1fr)">
      ${[["day", "Today"], ["week", "This week"], ["all", "All time"]].map(([k, l]) => `<button data-p="${k}" class="${period === k ? "on" : ""}">${l}</button>`).join("")}
    </div>`;
  const pname = () => ({ day: "today", week: "this week", all: "all time" }[period]);
  const bind = () => {
    $$("[data-tab]", main).forEach((b) => (b.onclick = () => { tab = b.dataset.tab; keep(); draw(); }));
    $$("[data-p]", main).forEach((b) => (b.onclick = () => { period = b.dataset.p; keep(); draw(); }));
  };
  const fail = (e) => { main.innerHTML = head() + (missingFn(e) ? needUpdate() : `<div class="card"><div class="card-h">Error</div><p>${esc(errMsg(e))}</p></div>`); bind(); };

  async function drawCrypto() {
    const key = period + "|" + sort;
    if (!cache[key]) {
      main.innerHTML = head() + `<div class="loading">Loading</div>`; bind();
      const { data, error } = await sb.rpc("server_top_crypto", { p_period: period, p_sort: sort });
      if (error) return fail(error);
      cache[key] = data || [];
    }
    if (tab !== "crypto" || key !== period + "|" + sort) return;
    const rows = cache[key];
    const sum = rows.reduce((s, r) => s + Number(r.total || 0), 0);
    const name = (r) => r.kind === "ip" ? G().ipText(r.target) : `<span class="mono">${esc(r.target)}</span> <span class="badge">no IP</span>`;
    const who = (r) => {
      const e = r.earners || [];
      const top = e.slice(0, 2).map((x) => `${esc(x.user)} ${fmt(x.total)}`).join(" · ");
      return top + (e.length > 2 ? ` · +${e.length - 2} more` : "");
    };
    main.innerHTML = head() + `
      <div class="tiles">
        <div class="tile big"><div class="k">Top 25 total ${pname()}</div><div class="v gain">${fmt(sum)}</div>
          <div class="s">All members · game days reset 00:00 UTC, weeks start Monday</div></div>
      </div>
      <div class="card">
        <div class="card-h">Top targets<span class="r">${pname()}</span></div>
        <div class="chips" style="margin-bottom:6px">
          <button class="chip ${sort === "total" ? "on" : ""}" data-s="total">By total</button>
          <button class="chip ${sort === "avg" ? "on" : ""}" data-s="avg">By average</button>
        </div>
        ${rows.length ? `<ol class="rank">${rows.map((r, i) => `
          <li data-r="${i}" class="tap"><span class="rk mono">${i + 1}</span>
            <div class="grow">${name(r)}
              <div class="tiny muted">${fmt(r.visit_count)} visit${Number(r.visit_count) === 1 ? "" : "s"} · avg ${fmt(r.avg_per_visit)}</div>
              <div class="tiny muted">by ${who(r)}</div></div>
            <b class="mono ${sort === "avg" ? "" : "gain"}">${fmt(sort === "avg" ? r.avg_per_visit : r.total)}</b></li>`).join("")}</ol>`
          : `<div class="empty">No crypto logged by anyone ${pname()}.</div>`}
      </div>`;
    bind();
    $$("[data-s]", main).forEach((b) => (b.onclick = () => { sort = b.dataset.s; keep(); draw(); }));
    $$("[data-r]", main).forEach((li) => (li.onclick = (ev) => {
      if (ev.target.closest("a")) return;
      const r = rows[Number(li.dataset.r)];
      modal(`<h3 class="mono">${esc(r.target)}</h3>
        <p class="small">${fmt(r.total)} total · ${fmt(r.visit_count)} visits · avg ${fmt(r.avg_per_visit)} · last ${ago(r.last_at)}</p>
        <div class="tiny mono muted" style="margin-bottom:4px">WHO EARNED IT ${pname().toUpperCase()}</div>
        <ul class="list">${(r.earners || []).map((x) => `<li><span class="grow">${esc(x.user)}</span>
          <span class="small muted">${fmt(x.visits)}×</span><b class="mono gain">${fmt(x.total)}</b></li>`).join("")}</ul>
        ${r.kind === "ip" ? `<button class="sheet-btn" data-a="open" style="margin-top:10px">Open IP</button>` : ""}
        <button class="sheet-btn" data-a="copy">Copy ${r.kind === "ip" ? "IP" : "wallet ID"}</button>
        <button class="btn block" data-a="x" style="margin-top:10px">Close</button>`,
      (w, close) => {
        $("[data-a=x]", w).onclick = close;
        $("[data-a=copy]", w).onclick = () => { close(); G().copy(r.target); };
        $("[data-a=open]", w) && ($("[data-a=open]", w).onclick = () => { close(); O().go("ip/" + encodeURIComponent(r.target)); });
      });
    }));
  }

  async function drawSiphon() {
    if (!siphon) {
      main.innerHTML = head() + `<div class="loading">Loading</div>`; bind();
      const { data, error } = await sb.rpc("server_siphon");
      if (error) return fail(error);
      siphon = (data || []).map((x) => {
        const h = ageHours(x.age);
        return { ...x, placed: h === null ? null : new Date(x.updated_at).getTime() - h * 3600e3 };
      });
    }
    if (tab !== "siphon") return;
    const from = periodStart(period);
    const rows = siphon.filter((x) => period === "all" || (x.placed !== null && x.placed >= from))
      .sort((a, b) => ssort === "pct" ? (Number(b.pct) || 0) - (Number(a.pct) || 0) || (Number(b.siphoned) || 0) - (Number(a.siphoned) || 0)
        : (Number(b.siphoned) || 0) - (Number(a.siphoned) || 0))
      .slice(0, 25);
    const sum = rows.reduce((s, x) => s + (Number(x.siphoned) || 0), 0);
    main.innerHTML = head() + `
      <div class="tiles">
        <div class="tile big"><div class="k">Top 25 siphoned ${pname()}</div><div class="v gain">${fmt(sum)}</div>
          <div class="s">All members' siphon lists${period === "all" ? "" : " · by each entry's age"}</div></div>
      </div>
      <div class="card">
        <div class="card-h">Top siphon entries<span class="r">${pname()}</span></div>
        <div class="chips" style="margin-bottom:6px">
          <button class="chip ${ssort === "amount" ? "on" : ""}" data-ss="amount">By amount</button>
          <button class="chip ${ssort === "pct" ? "on" : ""}" data-ss="pct">By %</button>
        </div>
        ${rows.length ? `<ol class="rank">${rows.map((x, i) => `
          <li><span class="rk mono">${i + 1}</span>
            <div class="grow">${G().ipText(x.ip)}
              <div class="tiny muted">LV ${x.level ?? "—"} · ${x.pct != null ? Number(x.pct) + "%" : "—"} · ${esc(x.age ? x.age + " ago" : "—")}</div>
              <div class="tiny muted">by ${esc(x.username)}</div></div>
            <button class="icon-btn" data-copy="${esc(x.ip)}" aria-label="Copy IP">${G().IC.copy}</button>
            <b class="mono gain">${ssort === "pct" ? (x.pct != null ? Number(x.pct) + "%" : "—") : fmt(x.siphoned)}</b></li>`).join("")}</ol>`
          : `<div class="empty">No siphon entries ${pname()}.</div>`}
      </div>`;
    bind();
    $$("[data-ss]", main).forEach((b) => (b.onclick = () => { ssort = b.dataset.ss; keep(); draw(); }));
    $$("[data-copy]", main).forEach((b) => (b.onclick = () => G().copy(b.dataset.copy)));
  }

  const draw = () => (tab === "siphon" ? drawSiphon() : drawCrypto());
  await draw();
};

})();
