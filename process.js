/* =========================================================
   OLC Database — Process List, Process Leads, My Process Leads
   Paste the process list from a device you're in. Only IPs are kept:
   - an IP is good if at least one of its processes is DONE or FAILED
   - an IP whose processes are all INVALIDATED has scrambled: skipped
   - hidden IPs (18.xxx…) and 0.0.0.0 (their own scans) are skipped
   - crew devices are left out
   There is no game time in a process list, so these leads are kept
   apart from Log Leads. Visiting an IP (My Logs) hides it, like Log Leads.
   ========================================================= */
(() => {
"use strict";
const O = () => window.OLC;
const G = () => window.OLC_GAME;
const PAGES = (window.OLC_PAGES = window.OLC_PAGES || {});

const fmt = (n) => Math.round(Number(n) || 0).toLocaleString("en-US");
const ago = (d) => {
  if (!d) return "—";
  const s = Math.max(0, (Date.now() - new Date(d)) / 1000);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};
const plural = (n, a, b) => `${fmt(n)} ${n === 1 ? a : b}`;
const missingFn = (e) => e && (e.code === "PGRST202" || /could not find the function/i.test(e.message || ""));
const needUpdate = () => `
  <div class="card warn"><div class="card-h">Database update needed</div>
    <p class="small" style="margin:0">This page needs the latest database update. The Admin runs it once in Supabase (SQL Editor).</p></div>`;

/* ---------- reading the paste ----------
   Each process: "<Name> Lv.N", a state line, optional "UL:"/"DL:" + item, then the IP. */
const TITLE = /^(.+?)\s+lv\.?\s*\d+$/i;
const IPISH = /^[\dx]{1,3}(\.[\dx]{1,3}){3}$/i;
function readProcesses(text) {
  const procs = [];
  let cur = null, wantItem = false;
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const t = TITLE.exec(line);
    if (t) { cur = { name: t[1].trim(), state: null, item: null }; wantItem = false; continue; }
    if (!cur) continue;
    if (IPISH.test(line)) {
      if (cur.state) procs.push({ ...cur, ip: line.toLowerCase() });
      cur = null; wantItem = false; continue;
    }
    if (/^(ul|dl):?$/i.test(line)) { wantItem = true; continue; }
    if (wantItem) { cur.item = line; wantItem = false; continue; }
    if (!cur.state) {
      const s = line.toUpperCase();
      cur.state = s === "DONE" ? "done" : s === "FAILED" ? "failed" : s === "INVALIDATED" ? "invalid" : "other";
    }
  }
  // one entry per IP
  const by = new Map();
  for (const p of procs) {
    const e = by.get(p.ip) || { ip: p.ip, done: 0, failed: 0, invalid: 0, other: 0, kinds: [] };
    e[p.state]++;
    const k = p.item ? `${p.name} ${p.item}` : p.name;
    if (!e.kinds.includes(k)) e.kinds.push(k);
    by.set(p.ip, e);
  }
  const good = [], skipped = [];
  for (const e of by.values()) {
    if (e.ip === "0.0.0.0") continue;                                   // their own scans
    if (/x/i.test(e.ip) || !G().isFullIp(e.ip)) { skipped.push({ ...e, why: "hidden", note: "Not a full IP" }); continue; }
    if (e.done + e.failed > 0) good.push(e);
    else if (e.invalid) skipped.push({ ...e, why: "scrambled", note: "Every process invalidated" });
    else skipped.push({ ...e, why: "unfinished", note: "No finished process" });
  }
  return { procs: procs.length, good, skipped };
}
window.OLC_PROCESS_TEST = { readProcesses };

function counts(e) {
  return [e.done && `${e.done} done`, e.failed && `${e.failed} failed`, e.invalid && `${e.invalid} invalidated`].filter(Boolean).join(" · ");
}

/* =========================================================
   PROCESS LIST (paste)
   ========================================================= */
PAGES.process = async function pageProcess(main) {
  const { sb, esc, $, toast, errMsg, btnBusy } = O();
  main.innerHTML = `
    <div class="card">
      <div class="card-h">Paste a process list</div>
      <p class="small muted" style="margin-top:0">Copy the process list from the device you're in and paste it here. Full IPs with a <b>DONE</b> or <b>FAILED</b> process go to <a href="#/pleads">Process Leads</a> (shared) and <a href="#/myleads">My Process Leads</a>. Scrambled (invalidated) and hidden IPs are skipped.</p>
      <textarea class="input mono log-box" rows="8" placeholder="Upload Lv.13&#10;DONE&#10;UL:&#10;Siphon&#10;15.108.173.181"></textarea>
    </div>
    <div data-prev></div>`;
  const ta = $("textarea", main), prev = $("[data-prev]", main);
  let good = [], timer = null, seq = 0;

  const row = (e, bad) => `<div class="pl-row"><span class="ip">${esc(e.ip)}</span>
    <span class="small ${bad ? "st-bad" : "st-ok"}">${esc(bad ? e.why : counts(e))}</span>
    <div class="d">${esc(bad ? e.note : e.kinds.join(" · "))}</div></div>`;

  async function draw() {
    const my = ++seq;
    if (!ta.value.trim()) { prev.innerHTML = ""; good = []; return; }
    const r = readProcesses(ta.value);
    // crew devices are never targets
    const crew = await G().crewSet(r.good.map((e) => e.ip));
    if (my !== seq) return;
    good = r.good.filter((e) => !crew.has(e.ip));
    const skipped = [...r.skipped, ...r.good.filter((e) => crew.has(e.ip)).map((e) => ({ ...e, why: "crew", note: G().CREW_MSG }))];
    if (!r.procs) {
      prev.innerHTML = `<div class="card"><div class="empty">No processes found. Paste the list as copied from the game.</div></div>`;
      return;
    }
    prev.innerHTML = `
      <div class="tiles">
        <div class="tile"><div class="k">IPs found</div><div class="v gain">${good.length}</div><div class="s">go to leads</div></div>
        <div class="tile"><div class="k">Skipped</div><div class="v" style="color:var(--danger)">${skipped.length}</div><div class="s">scrambled or hidden</div></div>
      </div>
      <div class="card">
        <div class="card-h">IPs found<span class="r">${good.length}</span></div>
        ${good.length ? good.map((e) => row(e, false)).join("") : `<div class="empty">No good IPs in this list.</div>`}
        ${skipped.length ? `<details style="margin-top:10px"><summary class="small" style="color:var(--danger)">${plural(skipped.length, "skipped", "skipped")}</summary>
          ${skipped.map((e) => row(e, true)).join("")}</details>` : ""}
        <div class="hint">0.0.0.0 (their own antivirus scans) is always ignored. Crew devices are left out.</div>
      </div>
      <div class="row" style="gap:8px"><button class="btn grow" data-clear>Clear</button>
        <button class="btn primary grow" data-save ${good.length ? "" : "disabled"}>Save ${plural(good.length, "IP", "IPs")}</button></div>`;
    $("[data-clear]", prev).onclick = () => { ta.value = ""; draw(); };
    $("[data-save]", prev).onclick = (ev) => save(ev.currentTarget);
  }

  async function save(btn) {
    if (!good.length) return;
    btnBusy(btn, true, "Saving…");
    const { data, error } = await sb.rpc("ingest_processes", { p_ips: good.map((e) => e.ip) });
    if (error) {
      btnBusy(btn, false);
      toast(missingFn(error) ? "Needs the latest database update (ask the Admin)" : errMsg(error), true);
      return;
    }
    toast(`Saved ${plural(data ?? good.length, "IP", "IPs")}`);
    ta.value = ""; good = [];
    prev.innerHTML = `<div class="card"><div class="card-h">Saved</div>
      <p class="small" style="margin:0">${plural(data ?? 0, "IP", "IPs")} added. See them in <a href="#/pleads">Process Leads</a> and <a href="#/myleads">My Process Leads</a>.</p></div>`;
  }

  ta.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(draw, 250); });
};

/* =========================================================
   shared list page (Process Leads / My Process Leads)
   ========================================================= */
function leadList(main, { all, tileK, tileS, emptyText, sub, storeKey }) {
  const { esc, $, $$ } = O();
  let q = "", shown = 100;
  try { q = sessionStorage.getItem(storeKey) || ""; } catch (e) {}
  main.innerHTML = `
    <div class="tiles"><div class="tile big"><div class="k">${tileK}</div><div class="v gain">${fmt(all.length)}</div>
      <div class="s">${tileS}</div></div></div>
    <div class="searchbar">${G().IC.search}<input class="input" type="search" placeholder="Filter by IP" autocomplete="off" autocapitalize="none" spellcheck="false" value="${esc(q)}"></div>
    <div class="card"><div data-out></div></div>`;
  const out = $("[data-out]", main), inp = $("input", main);
  const draw = () => {
    const t = q.trim().toLowerCase();
    const list = t ? all.filter((l) => l.ip.includes(t)) : all;
    out.innerHTML = list.length ? `
      <div class="card-h">${t ? `${list.length} match${list.length === 1 ? "" : "es"}` : "Newest first"}</div>
      <ul class="list">${list.slice(0, shown).map((l) => `
        <li><div class="grow">${G().ipText(l.ip)}<div class="tiny muted">${sub(l)}</div></div>
          <button class="icon-btn" data-copy="${esc(l.ip)}" aria-label="Copy IP">${G().IC.copy}</button>
          <a class="icon-btn" href="#/ip/${encodeURIComponent(l.ip)}" aria-label="Open IP">${G().IC.chev}</a></li>`).join("")}</ul>
      ${list.length > shown ? `<button class="btn block" data-more style="margin-top:10px">Show more (${fmt(list.length - shown)} left)</button>` : ""}`
      : `<div class="empty">${t ? "No IPs match that." : emptyText}</div>`;
    $$("[data-copy]", out).forEach((b) => (b.onclick = () => G().copy(b.dataset.copy)));
    const more = $("[data-more]", out);
    if (more) more.onclick = () => { shown += 100; draw(); };
  };
  inp.addEventListener("input", () => {
    q = inp.value; shown = 100;
    try { sessionStorage.setItem(storeKey, q); } catch (e) {}
    draw();
  });
  draw();
}

/* PROCESS LEADS: everyone's finds, no names */
PAGES.pleads = async function pageProcessLeads(main) {
  const { esc, errMsg } = O();
  const { data, error } = await O().sb.rpc("list_process_leads");
  if (error) { main.innerHTML = missingFn(error) ? needUpdate() : `<div class="card"><div class="card-h">Error</div><p>${esc(errMsg(error))}</p></div>`; return; }
  leadList(main, {
    all: data || [], storeKey: "olc-pleads-q",
    tileK: "Process leads for you",
    tileS: "IPs from process lists the crew pasted. No game time, so these are kept apart from Log Leads. IPs you've visited are left out.",
    emptyText: "No process leads yet. Paste one in Process List.",
    sub: (l) => `found ${fmt(l.times_found)}× · pasted ${ago(l.last_found)}`
  });
};

/* MY PROCESS LEADS: only what I pasted */
PAGES.myleads = async function pageMyProcessLeads(main) {
  const { esc, errMsg } = O();
  const { data, error } = await O().sb.rpc("list_my_process_leads");
  if (error) { main.innerHTML = missingFn(error) ? needUpdate() : `<div class="card"><div class="card-h">Error</div><p>${esc(errMsg(error))}</p></div>`; return; }
  leadList(main, {
    all: data || [], storeKey: "olc-myleads-q",
    tileK: "Found by you",
    tileS: "IPs from process lists <b>you</b> pasted. Only you see this list. IPs you've visited are left out.",
    emptyText: "Nothing yet. Paste a process list in Process List.",
    sub: (l) => `pasted ${ago(l.last_found)}${Number(l.others) ? ` · also found by ${plural(Number(l.others), "crewmate", "crewmates")}` : ""}`
  });
};
})();
