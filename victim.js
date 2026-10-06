/* =========================================================
   OLC Database — Victim Logs
   Reads a pasted log with the same reader as My Logs.
   - Every full IP in it (the victim's targets and attackers) is
     saved to the shared Leads list.
   - Wallet ID ↔ IP pairs are linked in Lookup.
   No crypto amounts are saved.
   ========================================================= */
(() => {
"use strict";
const O = () => window.OLC;
const PAGES = (window.OLC_PAGES = window.OLC_PAGES || {});
const hidden = (ip) => !ip || /^x+\.x+\.x+\.x+$/i.test(ip);
const fullIp = (ip) => !!ip && window.OLC_GAME.isFullIp(ip);

// Wallet/IP pairs in the order they happened (oldest first), one per wallet+IP
function walletPairs(read) {
  const seen = new Set();
  return [...read.visits, ...read.attacks]
    .filter((e) => e.wallet)
    .sort((a, b) => a.at - b.at)
    .map((e) => ({ wallet: e.wallet, ip: hidden(e.ip) ? null : e.ip }))
    .filter((p) => { const k = p.wallet + "|" + p.ip; if (seen.has(k)) return false; seen.add(k); return true; });
}

// One lead event per log line that names a full IP (no amounts)
function leadEvents(read) {
  return [...read.visits, ...read.attacks]
    .filter((e) => fullIp(e.ip))
    .map((e) => ({ hash: "vic:" + e.hash, ip: e.ip, wallet: e.wallet || null, at: e.at.toISOString() }));
}

// The IPs in a paste, with how often each shows up and when last
function leadIps(events) {
  const m = new Map();
  for (const e of events) {
    const x = m.get(e.ip) || { ip: e.ip, n: 0, last: e.at, wallet: null };
    x.n++; if (e.at > x.last) x.last = e.at; x.wallet = e.wallet || x.wallet;
    m.set(e.ip, x);
  }
  return [...m.values()].sort((a, b) => (b.last > a.last ? 1 : -1));
}
window.OLC_VICTIM_TEST = {
  walletPairs: (t) => walletPairs(window.OLC_LOG_TEST.parseMyLog(t)),
  leadEvents: (t) => leadEvents(window.OLC_LOG_TEST.parseMyLog(t))
};

// Every IP and wallet ID in a pasted log (hidden IPs left out)
function allKeys(read) {
  const keys = new Set();
  [...read.visits, ...read.attacks].forEach((e) => {
    if (!hidden(e.ip)) keys.add(e.ip);
    if (e.wallet) keys.add(e.wallet);
  });
  return [...keys];
}

PAGES.victim = async function pageVictim(main) {
  const { sb, S, esc, $, toast, btnBusy, fmtDate, errMsg } = O();
  // targets I deleted from my Crypto tracker
  const { data: dels } = await sb.from("target_deletions").select("target_key,deleted_at").eq("user_id", S.profile.id);
  const deleted = new Map((dels || []).map((d) => [d.target_key, d.deleted_at]));
  const delTag = (...keys) => {
    const k = keys.find((x) => x && deleted.has(x));
    return k ? ` <span class="badge del">deleted ${fmtDate(deleted.get(k))}</span>` : "";
  };
  main.innerHTML = `
    <div class="card">
      <div class="card-h">Victim log</div>
      <p class="small muted" style="margin-top:0">Paste a log you viewed on another device. IPs go to <a href="#/leads">Leads</a> and wallet IDs are linked in Lookup. Crypto amounts are ignored.</p>
      <textarea class="input mono log-box" rows="8" placeholder="Paste the log here"></textarea>
      <div data-prev></div>
      <div class="row" style="gap:8px;margin-top:12px">
        <button class="btn grow" data-clear>Clear</button>
        <button class="btn primary grow" data-save disabled>Save</button>
      </div>
    </div>`;

  const ta = $("textarea", main), prev = $("[data-prev]", main), save = $("[data-save]", main);
  let pairs = [], events = [];
  const show = () => {
    const text = ta.value.trim();
    const read = text ? window.OLC_LOG_TEST.parseMyLog(text) : null;
    pairs = read ? walletPairs(read) : [];
    events = read ? leadEvents(read) : [];
    const ips = leadIps(events);
    save.disabled = !pairs.length && !events.length;
    if (!text) { prev.innerHTML = ""; return; }
    let h = "";
    h += ips.length ? `
      <div class="tiny mono muted" style="margin:10px 0 4px">${ips.length} IP${ips.length === 1 ? "" : "S"} FOUND</div>
      <ul class="list">${ips.slice(0, 30).map((x) => `<li><span class="mono grow">${esc(x.ip)}${delTag(x.ip, x.wallet)}</span>
        <span class="small muted">${x.n}×</span></li>`).join("")}</ul>
      ${ips.length > 30 ? `<div class="tiny muted">+${ips.length - 30} more</div>` : ""}` : "";
    h += pairs.length ? `
      <div class="tiny mono muted" style="margin:12px 0 4px">${pairs.length} WALLET ID${pairs.length === 1 ? "" : "S"} FOUND</div>
      <ul class="list">${pairs.map((p) => `<li><span class="mono grow">${esc(p.wallet)}${delTag(p.wallet, p.ip)}</span>
        <span class="mono small ${p.ip ? "" : "muted"}">${p.ip ? esc(p.ip) : "IP hidden"}</span></li>`).join("")}</ul>` : "";
    if (!h) h = `<div class="empty">No IPs or wallet IDs found in this paste.</div>`;
    if (deleted.size) {
      const shown = new Set([...ips.flatMap((x) => [x.ip, x.wallet]), ...pairs.flatMap((p) => [p.wallet, p.ip])]);
      const extra = allKeys(read).filter((k) => deleted.has(k) && !shown.has(k));
      if (extra.length) h += `
        <div class="tiny mono muted" style="margin:12px 0 4px">PREVIOUSLY DELETED FROM YOUR TRACKER</div>
        <ul class="list">${extra.map((k) => `<li><span class="mono grow">${esc(k)}</span>${delTag(k)}</li>`).join("")}</ul>`;
    }
    prev.innerHTML = h;
  };
  ta.addEventListener("input", show);
  $("[data-clear]", main).onclick = () => { ta.value = ""; show(); ta.focus(); };
  save.onclick = async () => {
    btnBusy(save, true, "Saving…");
    let linked = 0, added = 0, leadErr = null;
    for (const p of pairs) {
      const { error } = await sb.rpc("link_wallet", { p_wallet: p.wallet, p_ip: p.ip });
      if (!error) linked++;
    }
    for (let i = 0; i < events.length && !leadErr; i += 300) {
      const { data, error } = await sb.rpc("ingest_leads", { p_events: events.slice(i, i + 300) });
      if (error) leadErr = error; else added += Number(data) || 0;
    }
    btnBusy(save, false);
    const ipCount = leadIps(events).length;
    const parts = [];
    if (ipCount) parts.push(leadErr ? null : `${ipCount} IP${ipCount === 1 ? "" : "s"} in Leads${added ? "" : " (already saved)"}`);
    if (pairs.length) parts.push(`linked ${linked} wallet ID${linked === 1 ? "" : "s"}`);
    toast(parts.filter(Boolean).join(" · ") || "Saved");
    if (leadErr) toast(`Leads not saved: ${errMsg(leadErr)}`, true);
    ta.value = ""; show();
  };
};
})();
