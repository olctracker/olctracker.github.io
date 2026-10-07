/* =========================================================
   OLC Database — stage 4: My Logs + Crypto tracker
   Reads the player's own in-game Hack Ex 2 log and keeps
   private crypto stats. Game days run on UTC.
   ========================================================= */
(() => {
"use strict";
const O = () => window.OLC;
const G = () => window.OLC_GAME;
const PAGES = (window.OLC_PAGES = window.OLC_PAGES || {});

/* ---------- reading one log line ---------- */
const LINE = /^\[(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})\]\s*(.+)$/;
const fullyHidden = (ip) => /^x+\.x+\.x+\.x+$/i.test(ip || "");
const num = (s) => Number(String(s).replace(/,/g, ""));

// Game log timestamps have no year. Use this year unless that lands in the future.
function stampToDate(mo, d, h, mi, now) {
  let y = now.getUTCFullYear();
  let t = Date.UTC(y, mo - 1, d, h, mi);
  if (t > now.getTime() + 2 * 86400e3) t = Date.UTC(y - 1, mo - 1, d, h, mi);
  return new Date(t);
}

function readLine(raw) {
  const m = LINE.exec(raw.trim());
  if (!m) return null;
  const text = m[5].replace(/\s*\[[A-Z]+\]\s*$/, "").trim();   // drop tags like [TRACED]
  let r;
  if ((r = /^Accessed device at (\S+?)\.{0,3}$/i.exec(text))) return { m, kind: "visit", ip: r[1] };
  if ((r = /^Device accessed from (\S+?)\.{0,3}$/i.exec(text))) return { m, kind: "attacked", ip: r[1] };
  if ((r = /^Stole ([\d,]+) Crypto from (\S+)$/i.exec(text))) return { m, kind: "stole", amount: num(r[1]), wallet: r[2] };
  if ((r = /^([\d,]+) Crypto transferred to (\S+)$/i.exec(text))) return { m, kind: "lost", amount: num(r[1]), wallet: r[2] };
  if (/^Cracking password on /i.test(text)) return { m, kind: "crack" };
  return { m, kind: "other" };
}

/* ---------- reading a whole pasted log ----------
   Newest line is on top, so read bottom-up (oldest first).
   - "Accessed device at" = I visited that IP. A theft line right after it
     belongs to that visit.
   - Visiting the same IP again with nothing done in between is one visit.
   - "Device accessed from" = someone hit me; a "transferred to" line right
     after it is what they took.
   Each event gets a stable id (hash) so pasting overlapping logs never
   counts anything twice. */
function parseMyLog(text, now = new Date()) {
  const lines = String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const seen = {};
  const recs = [];
  for (const l of lines) {
    const r = readLine(l);
    if (!r) continue;
    const key = l.replace(/\s+/g, " ");
    seen[key] = (seen[key] || 0) + 1;
    r.hash = key + "#" + seen[key];
    const [, mo, d, h, mi] = r.m;
    r.at = stampToDate(+mo, +d, +h, +mi, now);
    recs.push(r);
  }
  recs.reverse();                                   // oldest first

  const visits = [], attacks = [];
  let open = null, lastAttack = null, unmatched = 0;
  for (const r of recs) {
    if (r.kind === "visit") {
      const repeat = open && open.ip === r.ip && !fullyHidden(r.ip) && open.stolen === 0;
      if (repeat) { open.repeats++; continue; }
      open = { ip: r.ip, wallet: null, stolen: 0, at: r.at, hash: r.hash, theftHash: null, repeats: 0 };
      visits.push(open);
    } else if (r.kind === "stole") {
      if (open && open.stolen === 0) { open.stolen = r.amount; open.wallet = r.wallet; open.theftHash = r.hash; }
      else { unmatched++; visits.push({ ip: null, wallet: r.wallet, stolen: r.amount, at: r.at, hash: r.hash, theftHash: r.hash, orphan: true, repeats: 0 }); }
    } else if (r.kind === "attacked") {
      lastAttack = { ip: r.ip, wallet: null, amount: 0, at: r.at, hash: r.hash };
      attacks.push(lastAttack);
    } else if (r.kind === "lost") {
      if (lastAttack && lastAttack.amount === 0) { lastAttack.amount = r.amount; lastAttack.wallet = r.wallet; }
      else { attacks.push({ ip: null, wallet: r.wallet, amount: r.amount, at: r.at, hash: r.hash }); }
    }
  }
  return { visits, attacks, lines: recs.length, unmatched };
}

/* ---------- crypto stats (pure) ----------
   Groups visits by target: full IP when known (directly or via the wallet's
   saved IP), otherwise the wallet ID, otherwise the partial IP. */
function targetKey(v, walletIp) {
  const known = v.wallet && walletIp[v.wallet];
  if (v.ip && !/x/i.test(v.ip)) return { key: v.ip, kind: "ip" };
  if (known && !/x/i.test(known)) return { key: known, kind: "ip" };
  if (v.wallet) return { key: v.wallet, kind: "wallet", partial: v.ip && !fullyHidden(v.ip) ? v.ip : known || null };
  if (v.ip && !fullyHidden(v.ip)) return { key: v.ip, kind: "partial" };
  return null;
}

function periodStart(period, now = new Date()) {
  const d0 = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (period === "day") return d0;
  if (period === "week") return d0 - ((now.getUTCDay() + 6) % 7) * 86400e3;   // Monday 00:00 UTC
  return -Infinity;
}

function cryptoStats(visits, losses, walletIp, period, now = new Date()) {
  const from = periodStart(period, now);
  const inP = (x) => new Date(x.at).getTime() >= from;
  const groups = new Map();
  let stolen = 0, proxied = 0, count = 0;
  for (const v of visits) {
    const amt = Number(v.stolen) || 0;
    if (inP(v)) { stolen += amt; count++; if (!v.ip || fullyHidden(v.ip)) proxied += amt; }
    const k = targetKey(v, walletIp);
    if (!k) continue;
    let g = groups.get(k.key);
    if (!g) { g = { ...k, ips: new Set(), wallets: new Set(), all: [], total: 0, visits: 0 }; groups.set(k.key, g); }
    if (v.ip) g.ips.add(v.ip);
    if (v.wallet) g.wallets.add(v.wallet);
    g.all.push(v);
    if (inP(v)) { g.total += amt; g.visits++; }
    if (!g.partial && k.partial) g.partial = k.partial;
  }
  const targets = [...groups.values()].map((g) => {
    g.all.sort((a, b) => new Date(a.at) - new Date(b.at));
    const allTotal = g.all.reduce((s, v) => s + (Number(v.stolen) || 0), 0);
    return { ...g, ips: [...g.ips], wallets: [...g.wallets], allVisits: g.all.length, avg: g.all.length ? allTotal / g.all.length : 0, last: g.all[g.all.length - 1]?.at };
  });
  let lost = 0, hits = 0;
  const attackers = new Map();
  for (const l of losses) {
    if (!inP(l)) continue;
    lost += Number(l.amount) || 0; hits++;
    const key = l.attacker_ip && !fullyHidden(l.attacker_ip) ? l.attacker_ip : l.wallet || "hidden";
    const a = attackers.get(key) || { key, wallet: l.wallet, times: 0, total: 0 };
    a.times++; a.total += Number(l.amount) || 0; a.wallet = a.wallet || l.wallet;
    attackers.set(key, a);
  }
  return { stolen, proxied, count, lost, hits, targets, attackers: [...attackers.values()].sort((a, b) => b.total - a.total) };
}

// Targets whose last N visits add up to less than the amount (skips targets with fewer than N visits)
function cleanupList(targets, n, amount) {
  return targets.filter((t) => t.all.length >= n)
    .map((t) => ({ t, sum: t.all.slice(-n).reduce((s, v) => s + (Number(v.stolen) || 0), 0) }))
    .filter((x) => x.sum < amount)
    .sort((a, b) => a.sum - b.sum);
}

window.OLC_LOG_TEST = { parseMyLog, cryptoStats, cleanupList, periodStart };

/* ---------- loading every row (the database returns 1,000 at a time) ---------- */
async function fetchAll(build) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) return out;
  }
}
const chunks = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

/* ---------- saving a parsed log ---------- */
async function saveParsed(p) {
  const { sb, S } = O();
  const uid = S.profile.id;
  const reset = S.profile.crypto_reset_at ? new Date(S.profile.crypto_reset_at).getTime() : -Infinity;
  const { data: dels } = await sb.from("target_deletions").select("*").eq("user_id", uid);
  const deleted = new Map((dels || []).map((d) => [d.target_key, new Date(d.deleted_at).getTime()]));
  const blocked = (e, ...keys) => keys.some((k) => k && deleted.has(k) && e.at.getTime() < deleted.get(k));

  const res = { visits: 0, thefts: 0, stolen: 0, attacks: 0, lost: 0, skipped: 0, wallets: 0 };
  let visits = p.visits.filter((v) => v.at.getTime() >= reset && !blocked(v, v.ip, v.wallet));
  let attacks = p.attacks.filter((a) => a.at.getTime() >= reset);
  res.skipped += p.visits.length - visits.length + p.attacks.length - attacks.length;

  // what's already saved
  const have = new Map();
  for (const c of chunks(visits.map((v) => v.hash), 150)) {
    const { data } = await sb.from("visits").select("id,hash,stolen,ip,at").eq("user_id", uid).in("hash", c);
    (data || []).forEach((r) => have.set(r.hash, r));
  }
  const { data: latest } = await sb.from("visits").select("id,ip,stolen,at,hash").eq("user_id", uid)
    .order("at", { ascending: false }).limit(1);
  let tail = latest && latest[0];

  const inserts = [], updates = [];
  for (const v of visits) {
    const old = have.get(v.hash);
    if (old) {
      if (Number(old.stolen) === 0 && v.stolen > 0) updates.push({ id: old.id, stolen: v.stolen, wallet: v.wallet });
      else res.skipped++;
      continue;
    }
    // same target again right after the last saved visit, with nothing done in between
    if (tail && !inserts.length && tail.ip === v.ip && v.ip && !fullyHidden(v.ip)
        && Number(tail.stolen) === 0 && v.at >= new Date(tail.at)) {
      if (v.stolen > 0) updates.push({ id: tail.id, stolen: v.stolen, wallet: v.wallet });
      else res.skipped++;
      tail = null;
      continue;
    }
    inserts.push({ user_id: uid, ip: v.ip, wallet: v.wallet, stolen: v.stolen, at: v.at.toISOString(), hash: v.hash });
  }
  for (const c of chunks(inserts, 500)) {
    const { error } = await sb.from("visits").upsert(c, { onConflict: "user_id,hash", ignoreDuplicates: true });
    if (error) throw error;
  }
  for (const u of updates) {
    const { error } = await sb.from("visits").update({ stolen: u.stolen, wallet: u.wallet }).eq("id", u.id);
    if (error) throw error;
  }
  res.visits = inserts.length;
  res.thefts = inserts.filter((v) => v.stolen > 0).length + updates.length;
  res.stolen = inserts.reduce((s, v) => s + v.stolen, 0) + updates.reduce((s, u) => s + u.stolen, 0);

  // attacks on me
  const haveL = new Map();
  for (const c of chunks(attacks.map((a) => a.hash), 150)) {
    const { data } = await sb.from("losses").select("id,hash,amount").eq("user_id", uid).in("hash", c);
    (data || []).forEach((r) => haveL.set(r.hash, r));
  }
  const newL = [], leadEvents = [];
  for (const a of attacks) {
    const old = haveL.get(a.hash);
    if (old) {
      if (Number(old.amount) === 0 && a.amount > 0) {
        await sb.from("losses").update({ amount: a.amount, wallet: a.wallet }).eq("id", old.id);
        res.lost += a.amount;
      } else res.skipped++;
      continue;
    }
    newL.push({ user_id: uid, attacker_ip: a.ip, wallet: a.wallet, amount: a.amount, at: a.at.toISOString(), hash: a.hash });
    if (a.ip && !fullyHidden(a.ip)) leadEvents.push({ hash: `me:${uid}:${a.hash}`, ip: a.ip, wallet: a.wallet, at: a.at.toISOString() });
  }
  for (const c of chunks(newL, 500)) {
    const { error } = await sb.from("losses").upsert(c, { onConflict: "user_id,hash", ignoreDuplicates: true });
    if (error) throw error;
  }
  res.attacks = newL.length;
  res.lost += newL.reduce((s, a) => s + a.amount, 0);

  // wallet ↔ IP pairs, oldest first so the newest IP ends up current
  const pairs = [...p.visits, ...p.attacks].filter((e) => e.wallet)
    .sort((a, b) => a.at - b.at).map((e) => [e.wallet, e.ip || null]);
  const done = new Set();
  for (const [w, ip] of pairs) {
    const k = w + "|" + ip;
    if (done.has(k)) continue;
    done.add(k);
    const { error } = await sb.rpc("link_wallet", { p_wallet: w, p_ip: ip });
    if (!error) res.wallets++;
  }
  // people who hit me become leads too (IPs only, no amounts)
  if (leadEvents.length) await sb.rpc("ingest_leads", { p_events: leadEvents });
  return res;
}

const fmt = (n) => Math.round(Number(n) || 0).toLocaleString("en-US");
const ago = (d) => {
  const s = (Date.now() - new Date(d)) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};
const gameTime = (d) => new Date(d).toISOString().slice(5, 16).replace("T", " ");

/* =========================================================
   MY LOGS PAGE
   ========================================================= */
PAGES.logs = async function pageLogs(main) {
  const { sb, S, esc, $, toast, errMsg } = O();
  main.innerHTML = `
    <div class="card">
      <div class="card-h">Paste your log</div>
      <p class="small muted" style="margin-top:0">In the game, copy your own log and paste it here. Overlapping pastes are fine: nothing is counted twice.</p>
      <textarea class="input mono log-box" rows="8" placeholder="[10-5 14:21] Stole 1,770 Crypto from wasd...518c&#10;[10-5 14:21] Accessed device at 217.142.211.154"></textarea>
      <div data-preview></div>
      <div class="row" style="gap:8px;margin-top:12px">
        <button class="btn grow" data-clear>Clear</button>
        <button class="btn primary grow" data-save disabled>Save log</button>
      </div>
    </div>
    <div class="card">
      <div class="card-h">Recent activity</div>
      <ul class="list" data-recent><li class="empty">Loading…</li></ul>
    </div>`;

  const ta = $("textarea", main), prev = $("[data-preview]", main), save = $("[data-save]", main);
  let parsed = null;
  const show = () => {
    parsed = ta.value.trim() ? parseMyLog(ta.value) : null;
    save.disabled = !parsed || (!parsed.visits.length && !parsed.attacks.length);
    if (!parsed) { prev.innerHTML = ""; return; }
    const v = parsed.visits, a = parsed.attacks;
    const stolen = v.reduce((s, x) => s + x.stolen, 0), prox = v.filter((x) => !x.ip || fullyHidden(x.ip)).reduce((s, x) => s + x.stolen, 0);
    const lost = a.reduce((s, x) => s + x.amount, 0);
    prev.innerHTML = `
      <div class="preview">
        <div class="pv"><b>${v.length}</b><span>visits</span></div>
        <div class="pv"><b>${fmt(stolen)}</b><span>stolen</span></div>
        <div class="pv"><b>${fmt(prox)}</b><span>proxied</span></div>
        <div class="pv bad"><b>${fmt(lost)}</b><span>lost · ${a.length} hit${a.length === 1 ? "" : "s"}</span></div>
      </div>
      ${!parsed.lines ? `<div class="err">No log lines found. Lines should start like [10-5 14:21].</div>` : ""}
      <ul class="list events">${[...v.map((x) => ({ ...x, t: "v" })), ...a.map((x) => ({ ...x, t: "a" }))]
        .sort((x, y) => y.at - x.at).slice(0, 12).map((e) => e.t === "v"
          ? `<li><span class="ev-t mono">${gameTime(e.at)}</span><span class="grow"><span class="mono">${esc(e.ip || "?")}</span>${e.wallet ? ` <span class="muted small">${esc(e.wallet)}</span>` : ""}${e.repeats ? ` <span class="badge">×${e.repeats + 1}</span>` : ""}</span><b class="${e.stolen ? "gain" : "muted"}">${e.stolen ? "+" + fmt(e.stolen) : "empty"}</b></li>`
          : `<li><span class="ev-t mono">${gameTime(e.at)}</span><span class="grow"><span class="mono">${esc(e.ip || "?")}</span> <span class="muted small">hit you</span></span><b class="loss">${e.amount ? "−" + fmt(e.amount) : "0"}</b></li>`).join("")}</ul>`;
  };
  ta.addEventListener("input", show);
  $("[data-clear]", main).onclick = () => { ta.value = ""; show(); ta.focus(); };
  save.onclick = async () => {
    if (!parsed) return;
    O().btnBusy(save, true, "Saving…");
    try {
      const r = await saveParsed(parsed);
      ta.value = ""; show();
      toast(`Saved ${r.visits} visit${r.visits === 1 ? "" : "s"} · +${fmt(r.stolen)} · ${r.attacks} hit${r.attacks === 1 ? "" : "s"}${r.skipped ? ` · ${r.skipped} already saved` : ""}`);
      loadRecent();
    } catch (e) { toast(errMsg(e), true); }
    finally { O().btnBusy(save, false); }
  };

  async function loadRecent() {
    const [vR, lR] = await Promise.all([
      sb.from("visits").select("*").eq("user_id", S.profile.id).order("at", { ascending: false }).limit(15),
      sb.from("losses").select("*").eq("user_id", S.profile.id).order("at", { ascending: false }).limit(15)
    ]);
    const rows = [...(vR.data || []).map((x) => ({ ...x, t: "v" })), ...(lR.data || []).map((x) => ({ ...x, t: "a" }))]
      .sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 20);
    const ul = $("[data-recent]", main);
    if (!ul) return;
    ul.innerHTML = rows.length ? rows.map((e) => e.t === "v"
      ? `<li><span class="ev-t mono">${ago(e.at)}</span><span class="grow">${e.ip ? G().ipText(e.ip) : `<span class="muted">hidden</span>`}${e.wallet ? ` <span class="muted small mono">${esc(e.wallet)}</span>` : ""}</span><b class="${Number(e.stolen) ? "gain" : "muted"}">${Number(e.stolen) ? "+" + fmt(e.stolen) : "empty"}</b></li>`
      : `<li><span class="ev-t mono">${ago(e.at)}</span><span class="grow">${e.attacker_ip ? G().ipText(e.attacker_ip) : `<span class="muted">hidden</span>`} <span class="muted small">hit you</span></span><b class="loss">${Number(e.amount) ? "−" + fmt(e.amount) : "0"}</b></li>`).join("")
      : `<li class="empty">Nothing saved yet. Paste your log above.</li>`;
  }
  loadRecent();
};

/* =========================================================
   CRYPTO TRACKER (private to each member)
   ========================================================= */
const label = (t) => t.kind === "ip"
  ? `<span class="mono">${O().esc(t.key)}</span>`
  : t.kind === "wallet"
    ? `<span class="mono">${O().esc(t.key)}</span>${t.partial ? ` <span class="muted tiny mono">${O().esc(t.partial)}</span>` : ` <span class="badge">no IP</span>`}`
    : `<span class="mono">${O().esc(t.key)}</span> <span class="badge">partial</span>`;

async function deleteTarget(t) {
  const { sb, confirmBox, toast, errMsg } = O();
  const name = t.key;
  if (!(await confirmBox({ title: `Delete ${name} from your stats?`,
    body: "Removes your visits and crypto for this target. Its IP and wallet stay in Lookup. Older log lines for it won't be counted again.",
    ok: "Delete", danger: true }))) return false;
  const ips = t.kind === "wallet" ? [] : [t.key];
  const wallets = t.wallets || [];
  const { error } = await sb.rpc("delete_my_target", { p_key: t.key, p_ips: ips, p_wallets: wallets });
  if (error) { toast(errMsg(error), true); return false; }
  for (const w of wallets) if (w !== t.key) await sb.rpc("delete_my_target", { p_key: w, p_ips: [], p_wallets: [w] });
  toast("Deleted from your stats");
  return true;
}

function targetSheet(t, onChange) {
  const { modal, $, esc } = O();
  modal(`<h3>${label(t)}</h3>
    <p class="small">${fmt(t.allVisits)} visit${t.allVisits === 1 ? "" : "s"} · avg ${fmt(t.avg)} per visit${t.last ? ` · last ${ago(t.last)}` : ""}</p>
    ${t.wallets.length ? `<p class="tiny muted mono" style="margin-top:-8px">${t.wallets.map(esc).join(", ")}</p>` : ""}
    ${t.kind === "ip" ? `<button class="sheet-btn" data-a="open">Open IP</button>` : ""}
    <button class="sheet-btn" data-a="copy">Copy ${t.kind === "wallet" ? "wallet ID" : "IP"}</button>
    <button class="sheet-btn danger" data-a="del">Delete from my stats</button>
    <button class="btn block" data-a="x" style="margin-top:10px">Close</button>`,
  (w, close) => {
    $("[data-a=x]", w).onclick = close;
    $("[data-a=copy]", w).onclick = () => { close(); G().copy(t.key); };
    $("[data-a=open]", w) && ($("[data-a=open]", w).onclick = () => { close(); O().go("ip/" + encodeURIComponent(t.key)); });
    $("[data-a=del]", w).onclick = async () => { close(); if (await deleteTarget(t)) onChange(); };
  });
}

PAGES.crypto = async function pageCrypto(main) {
  const { sb, S, esc, $, $$, toast, errMsg, confirmBox, render } = O();
  const uid = S.profile.id;
  const st = (() => { try { return JSON.parse(sessionStorage.getItem("olc-crypto") || "{}"); } catch (e) { return {}; } })();
  let period = st.period || "day", sort = st.sort || "total";
  const keep = () => sessionStorage.setItem("olc-crypto", JSON.stringify({ period, sort }));
  // Cleanup checker numbers are saved to the member's account (this device too, as a backup)
  const savedClean = (() => { try { return JSON.parse(localStorage.getItem("olc-cleanup-" + uid) || "{}"); } catch (e) { return {}; } })();
  st.n = S.profile.cleanup_visits || savedClean.n || 10;
  st.amt = S.profile.cleanup_amount || savedClean.amt || 5000;
  const saveClean = (n, amt) => {
    try { localStorage.setItem("olc-cleanup-" + uid, JSON.stringify({ n, amt })); } catch (e) {}
    if (n === S.profile.cleanup_visits && amt === S.profile.cleanup_amount) return;
    S.profile.cleanup_visits = n; S.profile.cleanup_amount = amt;
    sb.rpc("set_cleanup_defaults", { p_visits: n, p_amount: amt }).then(() => {}, () => {});
  };

  const [visits, losses] = await Promise.all([
    fetchAll(() => sb.from("visits").select("ip,wallet,stolen,at").eq("user_id", uid).order("at")),
    fetchAll(() => sb.from("losses").select("attacker_ip,wallet,amount,at").eq("user_id", uid).order("at"))
  ]);
  const ws = [...new Set(visits.map((v) => v.wallet).filter(Boolean))];
  const walletIp = {};
  for (const c of chunks(ws, 150)) {
    const { data } = await sb.from("wallets").select("wallet,ip").in("wallet", c);
    (data || []).forEach((w) => (walletIp[w.wallet] = w.ip));
  }

  const draw = () => {
    const s = cryptoStats(visits, losses, walletIp, period);
    const ranked = s.targets.filter((t) => period === "all" || t.visits > 0)
      .sort((a, b) => sort === "avg" ? b.avg - a.avg : b.total - a.total).slice(0, 25);
    const pname = { day: "today", week: "this week", all: "all time" }[period];
    main.innerHTML = `
      <div class="seg" style="grid-template-columns:repeat(3,1fr)">
        ${[["day", "Today"], ["week", "This week"], ["all", "All time"]].map(([k, l]) => `<button data-p="${k}" class="${period === k ? "on" : ""}">${l}</button>`).join("")}
      </div>
      <div class="tiles">
        <div class="tile big"><div class="k">Stolen ${pname}</div><div class="v gain">${fmt(s.stolen)}</div><div class="s">${fmt(s.count)} visit${s.count === 1 ? "" : "s"}</div></div>
        <div class="tile"><div class="k">Proxied</div><div class="v">${fmt(s.proxied)}</div><div class="s">hidden IPs</div></div>
        <div class="tile"><div class="k">Stolen from me</div><div class="v loss">${fmt(s.lost)}</div><div class="s">${fmt(s.hits)} hit${s.hits === 1 ? "" : "s"}</div></div>
      </div>
      <div class="tiny muted" style="margin:-4px 4px 14px">Game days reset at 00:00 UTC. Weeks start Monday.</div>

      <div class="card">
        <div class="card-h">Top 25<span class="r">${pname}</span></div>
        <div class="chips" style="margin-bottom:6px">
          <button class="chip ${sort === "total" ? "on" : ""}" data-s="total">By total</button>
          <button class="chip ${sort === "avg" ? "on" : ""}" data-s="avg">By average</button>
        </div>
        ${ranked.length ? `<ol class="rank">${ranked.map((t, i) => `
          <li data-t="${i}"><span class="rk mono">${i + 1}</span>
            <div class="grow">${label(t)}<div class="tiny muted">${fmt(t.visits)} visit${t.visits === 1 ? "" : "s"} ${pname} · avg ${fmt(t.avg)}</div></div>
            <b class="mono ${sort === "avg" ? "" : "gain"}">${fmt(sort === "avg" ? t.avg : t.total)}</b></li>`).join("")}</ol>`
          : `<div class="empty">No visits ${pname}. Paste your log in My Logs.</div>`}
      </div>

      <div class="card">
        <div class="card-h">Stolen from me<span class="r">${pname}</span></div>
        ${s.attackers.length ? `<ul class="list">${s.attackers.slice(0, 15).map((a) => `
          <li><div class="grow">${/^\d+\.\d+\.\d+\.\d+$/.test(a.key) ? G().ipText(a.key) : `<span class="mono">${esc(a.key)}</span>`}
            ${a.wallet && a.wallet !== a.key ? `<div class="tiny muted mono">${esc(a.wallet)}</div>` : ""}</div>
            <span class="small muted">${a.times}×</span><b class="mono loss">${fmt(a.total)}</b></li>`).join("")}</ul>`
          : `<div class="empty">Nobody took anything ${pname}.</div>`}
      </div>

      <div class="card">
        <div class="card-h">Cleanup checker</div>
        <p class="small muted" style="margin-top:0">Find targets that haven't paid off: less than the amount in total across their last visits. Your numbers are saved for next time.</p>
        <form data-clean class="row" style="gap:8px;align-items:flex-end">
          <label class="f grow" style="margin:0"><span>Last visits</span><input class="input" name="n" inputmode="numeric" pattern="[0-9]*" maxlength="3" value="${esc(st.n)}"></label>
          <label class="f grow" style="margin:0"><span>Crypto</span><input class="input" name="amt" inputmode="numeric" pattern="[0-9]*" maxlength="9" value="${esc(st.amt)}"></label>
          <button class="btn primary" type="submit" style="min-height:48px">Check</button>
        </form>
        <div data-cleanout style="margin-top:12px"></div>
      </div>

      <div class="card danger-zone">
        <div class="card-h">Reboot</div>
        <p class="small muted" style="margin-top:0">Rebooting in the game? This clears your crypto history only. Spam and Siphon are untouched.</p>
        <button class="btn danger block" data-reboot>Reboot crypto tracker</button>
      </div>`;

    $$("[data-p]", main).forEach((b) => (b.onclick = () => { period = b.dataset.p; keep(); draw(); }));
    $$("[data-s]", main).forEach((b) => (b.onclick = () => { sort = b.dataset.s; keep(); draw(); }));
    $$("[data-t]", main).forEach((li) => (li.onclick = () => targetSheet(ranked[Number(li.dataset.t)], render)));

    const cleanOut = $("[data-cleanout]", main);
    const runClean = (n, amt) => {
      const list = cleanupList(s.targets, n, amt);
      cleanOut.innerHTML = list.length ? `
        <div class="tiny mono muted" style="margin-bottom:4px">${list.length} TARGET${list.length === 1 ? "" : "S"} UNDER ${fmt(amt)} IN LAST ${n} VISITS</div>
        <ul class="list">${list.map(({ t, sum }, i) => `
          <li><div class="grow">${label(t)}<div class="tiny muted">last ${n}: ${fmt(sum)} · avg ${fmt(t.avg)}</div></div>
            <button class="btn sm danger" data-del="${i}">Delete</button></li>`).join("")}</ul>`
        : s.targets.some((t) => t.all.length >= n)
          ? `<div class="empty">Every target with ${n}+ visits made at least ${fmt(amt)}.</div>`
          : `<div class="empty">No target has ${n} visits yet. Try a smaller number.</div>`;
      $$("[data-del]", cleanOut).forEach((b) => (b.onclick = async () => { if (await deleteTarget(list[Number(b.dataset.del)].t)) render(); }));
    };
    $("[data-clean]", main).onsubmit = (e) => {
      e.preventDefault();
      const n = Number(e.target.n.value), amt = Number(e.target.amt.value);
      if (!(n >= 1) || !(amt >= 1)) return toast("Enter visits and an amount", true);
      st.n = n; st.amt = amt; saveClean(n, amt);
      runClean(n, amt);
    };
    runClean(Number(st.n), Number(st.amt));

    $("[data-reboot]", main).onclick = async () => {
      if (!(await confirmBox({ title: "Reboot your crypto tracker?",
        body: "All your visits, crypto totals and stolen-from-me history are cleared. Older log lines won't be counted again. This can't be undone.",
        ok: "Reboot", danger: true }))) return;
      const { error } = await sb.rpc("reboot", { p_category: "crypto" });
      if (error) return toast(errMsg(error), true);
      S.profile.crypto_reset_at = new Date().toISOString();
      toast("Crypto tracker rebooted");
      render();
    };
  };
  draw();
};

})();
