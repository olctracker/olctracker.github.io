/* =========================================================
   OLC Database — Victim Logs (wallet linking only)
   Reads a pasted log with the same reader as My Logs and keeps
   only wallet ID ↔ IP pairs for Lookup. No amounts are saved.
   ========================================================= */
(() => {
"use strict";
const O = () => window.OLC;
const PAGES = (window.OLC_PAGES = window.OLC_PAGES || {});
const hidden = (ip) => !ip || /^x+\.x+\.x+\.x+$/i.test(ip);

// Wallet/IP pairs in the order they happened (oldest first), one per wallet+IP
function walletPairs(text) {
  const read = window.OLC_LOG_TEST.parseMyLog(text);
  const seen = new Set();
  return [...read.visits, ...read.attacks]
    .filter((e) => e.wallet)
    .sort((a, b) => a.at - b.at)
    .map((e) => ({ wallet: e.wallet, ip: hidden(e.ip) ? null : e.ip }))
    .filter((p) => { const k = p.wallet + "|" + p.ip; if (seen.has(k)) return false; seen.add(k); return true; });
}
window.OLC_VICTIM_TEST = { walletPairs };

// Every IP and wallet ID in a pasted log (hidden IPs left out)
function allKeys(text) {
  const read = window.OLC_LOG_TEST.parseMyLog(text);
  const keys = new Set();
  [...read.visits, ...read.attacks].forEach((e) => {
    if (!hidden(e.ip)) keys.add(e.ip);
    if (e.wallet) keys.add(e.wallet);
  });
  return [...keys];
}

PAGES.victim = async function pageVictim(main) {
  const { sb, S, esc, $, toast, btnBusy, fmtDate } = O();
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
      <p class="small muted" style="margin-top:0">Paste a log you viewed on another device. Only wallet IDs and their IPs are saved to Lookup. Crypto amounts are ignored.</p>
      <textarea class="input mono log-box" rows="8" placeholder="Paste the log here"></textarea>
      <div data-prev></div>
      <div class="row" style="gap:8px;margin-top:12px">
        <button class="btn grow" data-clear>Clear</button>
        <button class="btn primary grow" data-save disabled>Link wallets</button>
      </div>
    </div>`;

  const ta = $("textarea", main), prev = $("[data-prev]", main), save = $("[data-save]", main);
  let pairs = [];
  const show = () => {
    pairs = ta.value.trim() ? walletPairs(ta.value) : [];
    save.disabled = !pairs.length;
    prev.innerHTML = !ta.value.trim() ? "" : pairs.length ? `
      <div class="tiny mono muted" style="margin:10px 0 4px">${pairs.length} WALLET ID${pairs.length === 1 ? "" : "S"} FOUND</div>
      <ul class="list">${pairs.map((p) => `<li><span class="mono grow">${esc(p.wallet)}${delTag(p.wallet, p.ip)}</span>
        <span class="mono small ${p.ip ? "" : "muted"}">${p.ip ? esc(p.ip) : "IP hidden"}</span></li>`).join("")}</ul>`
      : `<div class="empty">No wallet IDs found in this paste.</div>`;
    if (ta.value.trim() && deleted.size) {
      const shown = new Set(pairs.flatMap((p) => [p.wallet, p.ip]));
      const extra = allKeys(ta.value).filter((k) => deleted.has(k) && !shown.has(k));
      if (extra.length) prev.innerHTML += `
        <div class="tiny mono muted" style="margin:12px 0 4px">PREVIOUSLY DELETED FROM YOUR TRACKER</div>
        <ul class="list">${extra.map((k) => `<li><span class="mono grow">${esc(k)}</span>${delTag(k)}</li>`).join("")}</ul>`;
    }
  };
  ta.addEventListener("input", show);
  $("[data-clear]", main).onclick = () => { ta.value = ""; show(); ta.focus(); };
  save.onclick = async () => {
    btnBusy(save, true, "Linking…");
    let ok = 0;
    for (const p of pairs) {
      const { error } = await sb.rpc("link_wallet", { p_wallet: p.wallet, p_ip: p.ip });
      if (!error) ok++;
    }
    btnBusy(save, false);
    toast(`Linked ${ok} wallet ID${ok === 1 ? "" : "s"} in Lookup`);
    ta.value = ""; show();
  };
};
})();
