/* =========================================================
   OLC Database — Crew Contributions
   Everyone sees the crew's contribution log and totals. Mods paste the
   game's crew activity log; each paste is lined up with what's already
   saved so nothing is counted twice:
   - entries already saved are skipped
   - a contribution that grew (the game merges 2,000 + 1,000 into 3,000
     when nobody else gave in between) updates the saved one
   - an older paste (copied before someone else's) adds nothing
   ========================================================= */
(function () {
const PAGES = (window.OLC_PAGES = window.OLC_PAGES || {});
const O = () => window.OLC;
const G = () => window.OLC_GAME;
const DAY_CAP = 50000;
const fmt = (x) => Number(x || 0).toLocaleString("en-US");
const short = (x) => {
  const a = Math.abs(Number(x || 0));
  return a >= 1e6 ? (a / 1e6).toFixed(a >= 1e7 ? 1 : 2).replace(/\.?0+$/, "") + "M" : a >= 1e4 ? Math.round(a / 1e3) + "K" : fmt(a);
};
const missing = (e) => /crew_contrib|schema cache|does not exist|42P01|PGRST20|could not find the function/i.test((e && (e.message || e.code)) || "");

/* ---------- reading the paste ---------- */
function amt(s) {
  const m = /^([\d,]*\.?\d+)\s*([KMB])?$/i.exec(String(s || "").trim());
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Math.round(n * ({ K: 1e3, M: 1e6, B: 1e9 }[(m[2] || "").toUpperCase()] || 1));
}
const MINUS = "[−–-]";
const AMT = "([\\d,]*\\.?\\d+\\s*[KMB]?)";

function classify(line) {
  let m;
  if ((m = new RegExp(`^(.+?) contributed \\+\\s*${AMT}$`, "i").exec(line))) return { kind: "contrib", name: m[1].trim(), amount: amt(m[2]) };
  if ((m = new RegExp(`^daily upkeep\\s*${MINUS}\\s*${AMT}$`, "i").exec(line))) return { kind: "upkeep", name: null, amount: -amt(m[1]) };
  if ((m = /^(.+?) powered (on|off) (.+?)(?:\s*·\s*toggled (\d+)\s*[×x])?$/i.exec(line))) return { kind: "power", name: m[1].trim(), amount: Number(m[4] || 1), base: `${m[2]} ${m[3]}`.toLowerCase() };
  if ((m = new RegExp(`^(.+?) upgraded (.+?)\\s*${MINUS}\\s*${AMT}$`, "i").exec(line))) return { kind: "upgrade", name: m[1].trim(), amount: -amt(m[3]) };
  if ((m = new RegExp(`^(.+?) (started|extended) (.+?)\\s*${MINUS}\\s*${AMT}$`, "i").exec(line))) return { kind: "surge", name: m[1].trim(), amount: -amt(m[4]) };
  if ((m = /^(.+?) (was removed from|was kicked from|joined|left|was added to|was promoted|was demoted|was invited to)\b/i.exec(line))) return { kind: "member", name: m[1].trim(), amount: null };
  m = new RegExp(`(\\+|${MINUS})\\s*${AMT}$`).exec(line);
  return { kind: "other", name: null, amount: m ? (m[1] === "+" ? 1 : -1) * amt(m[2]) : null };
}

const AGO = /^(?:(now|just now)|(\d+)\s*(s|sec|secs?|seconds?|m|min|mins?|minutes?|h|hr|hrs?|hours?|d|days?|w|wk|weeks?)\s*ago)$/i;
function agoOf(t) {
  const m = AGO.exec(t);
  if (!m) return null;
  if (m[1]) return { min: 0, prec: 1 };
  const n = Number(m[2]), u = m[3][0].toLowerCase();
  if (u === "s") return { min: 0, prec: 1 };
  if (u === "m") return { min: n, prec: 1 };
  if (u === "h") return { min: n * 60, prec: 60 };
  if (u === "d") return { min: n * 1440, prec: 1440 };
  return { min: n * 10080, prec: 10080 };
}

/** The game log, oldest first: [{kind,name,amount,line,at,prec,key}] */
function parseLog(text, now = Date.now()) {
  const lines = String(text || "").split(/\r?\n/).map((l) => l.trim().replace(/\s+/g, " ")).filter(Boolean);
  const out = [];
  for (const l of lines) {
    if (!/[\p{L}\p{N}]/u.test(l)) continue;                    // icons: + ↓ » ▲ ● ×
    const a = agoOf(l);
    if (a) { const e = out[out.length - 1]; if (e && e.at == null) { e.at = now - (a.min + (a.prec > 1 ? a.prec / 2 : 0)) * 60e3; e.prec = a.prec; } continue; }
    if (/^crew (activity|log)$/i.test(l)) continue;
    const c = classify(l);
    out.push({ ...c, line: l, at: null, prec: 1 });
  }
  const list = out.filter((e) => e.at != null);              // only lines with a time
  list.forEach((e) => (e.key = keyOf(e)));
  return { events: list.reverse(), skipped: out.length - list.length };
}
function keyOf(e) {
  const n = (e.name || "").toLowerCase();
  if (e.kind === "contrib") return `c|${n}`;
  if (e.kind === "upkeep") return "u";
  if (e.kind === "power") return `p|${n}|${e.base || e.line.replace(/\s*·\s*toggled.*$/i, "").toLowerCase()}`;
  return `${e.kind}|${e.line.toLowerCase()}`;
}
// Entries the game keeps adding to: a contribution (2,000 → 3,000 if nobody else gave),
// a power toggle count, and the day's upkeep (−8,515 → −12,801, moving up the log).
const GROWS = new Set(["contrib", "power", "upkeep"]);
const size = (e) => Math.abs(Number(e.amount || 0));

/* ---------- lining a paste up with what's saved ---------- */
// S: saved events, oldest first ({seq,kind,name,amount,line,at,prec,key}); P: the paste, oldest first.
function lineUp(S, P) {
  const lastOf = (arr, kind) => { for (let i = arr.length - 1; i >= 0; i--) if (arr[i].kind === kind) return i; return -1; };
  const near = (s, p) => Math.abs(s.at - p.at) <= (s.prec + p.prec) * 60e3 + 15 * 60e3;
  function match(s, p, sLast, pLast) {
    if (s.key !== p.key) return null;
    if (GROWS.has(s.kind)) {
      if (Number(s.amount) === Number(p.amount)) return near(s, p) ? "same" : null;
      if (sLast && size(p) > size(s)) return "grow";       // added to since it was saved
      if (pLast && size(p) < size(s)) return "stale";      // this paste was copied earlier
      return null;
    }
    return near(s, p) ? "same" : null;
  }
  function tryAlign(Sv) {
    const sLast = { contrib: lastOf(Sv, "contrib"), power: lastOf(Sv, "power"), upkeep: lastOf(Sv, "upkeep") };
    const pLast = { contrib: lastOf(P, "contrib"), power: lastOf(P, "power"), upkeep: lastOf(P, "upkeep") };
    let best = null;
    for (let d = Sv.length - 1; d > -P.length; d--) {               // P[0] sits at Sv[d]
      const from = Math.max(0, d), to = Math.min(Sv.length, d + P.length);
      if (to - from < 1) continue;
      let ok = true, ups = [], stale = 0;
      for (let si = from; si < to; si++) {
        const pi = si - d, s = Sv[si], p = P[pi];
        const r = match(s, p, si === sLast[s.kind], pi === pLast[p.kind]);
        if (!r) { ok = false; break; }
        if (r === "grow") ups.push({ s, p });
        if (r === "stale") stale++;
      }
      if (!ok) continue;
      const len = to - from;
      if (!best || len > best.len) best = { d, len, from, to, ups, stale };
    }
    return best;
  }
  if (!S.length) return { added: P, ups: [], known: 0, older: 0, mode: "first" };

  // 1. as is; 2. the newest saved contribution / power-on / upkeep moved up the log because it grew
  // (every combination of those, fewest moved first)
  const lasts = ["contrib", "power", "upkeep"].map((k) => lastOf(S, k)).filter((i) => i >= 0);
  const variants = [];
  for (let mask = 0; mask < 1 << lasts.length; mask++) {
    const out = lasts.filter((_, b) => mask & (1 << b));
    variants.push({ Sv: S.filter((_, j) => !out.includes(j)), moved: out.map((i) => S[i]), n: out.length });
  }
  variants.sort((a, b) => a.n - b.n);

  for (const v of variants) {
    const b = tryAlign(v.Sv);
    if (!b) continue;
    const reachesEnd = b.to === v.Sv.length;
    let added = reachesEnd ? P.slice(b.to - b.d) : [];
    const ups = b.ups.map((u) => ({ seq: u.s.seq, from: u.s.amount, e: u.p }));
    let okMoved = true;
    for (const mv of v.moved) {                      // must show up again, bigger, among the new lines
      const k = added.findIndex((e) => e.key === mv.key && size(e) > size(mv));
      if (k < 0 || !reachesEnd) { okMoved = false; break; }
      ups.push({ seq: mv.seq, from: mv.amount, e: added[k] });
      added = added.filter((_, j) => j !== k);
    }
    if (!okMoved) continue;
    return { added, ups, known: b.len, older: Math.max(0, -b.d), mode: reachesEnd ? "joined" : "old", stale: b.stale };
  }
  // No overlap at all: fine if the whole paste is newer than the saved log (a gap), else refuse.
  const lastS = S[S.length - 1];
  const oldestP = P[0];
  if (oldestP && oldestP.at - lastS.at >= -((oldestP.prec + lastS.prec) * 60e3)) return { added: P, ups: [], known: 0, older: 0, mode: "gap" };
  return { added: [], ups: [], known: 0, older: 0, mode: "nomatch" };
}

/* ---------- time helpers (game days reset 00:00 UTC, weeks start Monday) ---------- */
function startOf(period, now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (period === "day") return d.getTime();
  if (period === "week") return d.getTime() - ((d.getUTCDay() + 6) % 7) * 864e5;
  return -Infinity;
}
const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
function agoText(t, prec) {
  const m = Math.max(0, (Date.now() - t) / 60e3);
  const p = prec >= 1440 ? "~" : "";
  if (m < 1) return "now";
  if (m < 60) return `${p}${Math.round(m)}m ago`;
  if (m < 1440) return `${p}${Math.floor(m / 60)}h ago`;
  return `${p}${Math.floor(m / 1440)}d ago`;
}
const ICONS = { contrib: "+", upkeep: "↓", upgrade: "▲", surge: "»", power: "●", member: "×", other: "·" };

/* ---------- loading ---------- */
async function loadAll(sb, sinceMs) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    let q = sb.from("crew_contrib").select("seq,kind,name,amount,line,at_est,at_prec,paste_id").order("seq", { ascending: true }).range(from, from + 999);
    if (isFinite(sinceMs)) q = q.gte("at_est", new Date(sinceMs).toISOString());
    const { data, error } = await q;
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out.map(toEvent);
}
function toEvent(r) {
  const e = { seq: Number(r.seq), kind: r.kind, name: r.name, amount: r.amount == null ? null : Number(r.amount), line: r.line, at: new Date(r.at_est).getTime(), prec: Number(r.at_prec || 1), paste_id: r.paste_id };
  if (e.kind === "power") e.base = (/powered (on|off) (.+?)(?:\s*·|$)/i.exec(e.line) || []).slice(1).join(" ").toLowerCase();
  e.key = keyOf(e);
  return e;
}
async function loadTail(sb) {
  const { data, error } = await sb.from("crew_contrib").select("seq,kind,name,amount,line,at_est,at_prec").order("seq", { ascending: false }).limit(500);
  if (error) throw error;
  return (data || []).map(toEvent).sort((a, b) => a.seq - b.seq);
}

/* Over 50,000 in one game day for anyone (only for times known to the hour) */
function capWarnings(saved, plan) {
  const days = new Map();
  const add = (e, amount) => {
    if (e.kind !== "contrib" || e.prec > 60) return;
    const k = (e.name || "").toLowerCase() + "|" + dayKey(e.at);
    const v = days.get(k) || { name: e.name, day: dayKey(e.at), sum: 0, touched: false };
    v.sum += amount; days.set(k, v); return v;
  };
  const upd = new Map(plan.ups.map((u) => [u.seq, u.e.amount]));
  saved.forEach((e) => add(e, upd.has(e.seq) ? upd.get(e.seq) : e.amount));
  plan.added.forEach((e) => { const v = add(e, e.amount); if (v) v.touched = true; });
  plan.ups.forEach((u) => { const s = saved.find((x) => x.seq === u.seq); if (s && s.prec <= 60) { const v = days.get((s.name || "").toLowerCase() + "|" + dayKey(s.at)); if (v) v.touched = true; } });
  return [...days.values()].filter((v) => v.touched && v.sum > DAY_CAP);
}

/* ---------- crew roster (Mod Tools) ---------- */
// The game's crew member list: "LEADER", "OFFICERS (6)", "MEMBERS (17)", then for each
// member "badge", their name, their IP (often xxx'd) and "E2E". Only names are kept.
const IPISH = /^[\dx]{1,3}(\.[\dx]{1,3}){3}$/i;
function parseRoster(text) {
  const lines = String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out = [], seen = new Set();
  let rank = "member";
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i], low = l.toLowerCase();
    if (/^leaders?(\s*\(\d+\))?$/.test(low)) { rank = "leader"; continue; }
    if (/^officers?(\s*\(\d+\))?$/.test(low)) { rank = "officer"; continue; }
    if (/^members?(\s*\(\d+\))?$/.test(low)) { rank = "member"; continue; }
    if (/^(badge|e2e)$/i.test(l) || IPISH.test(l)) continue;
    if (!IPISH.test(lines[i + 1] || "")) continue;             // a name is always followed by its IP line
    if (l.length > 40 || seen.has(low)) continue;
    seen.add(low); out.push({ name: l, rank });
  }
  return out;
}
async function loadRoster(sb) {
  const { data, error } = await sb.rpc("crew_roster_list");
  if (error) return null;
  return data || [];
}
const RANK = { leader: "Leader", officer: "Officer", member: "Member" };

/** Mod Tools: paste the crew member list; collapsible list of everyone. */
window.OLC_CONTRIB_ROSTER = async function rosterCard(main) {
  const { sb, esc, $, toast, errMsg, btnBusy, render, fmtDateTime } = O();
  const card = document.createElement("div");
  card.className = "card";
  main.appendChild(card);
  const list = await loadRoster(sb);
  if (list === null) { card.innerHTML = `<div class="card-h">Crew members</div><p class="small muted" style="margin:0">Needs the v1.36 database update (Admin, in Supabase SQL Editor).</p>`; return; }
  const withAcct = list.filter((m) => m.has_profile).length;
  const updated = list.reduce((t, m) => (m.updated_at > t ? m.updated_at : t), "");
  card.innerHTML = `
    <div class="card-h">Crew members<span class="r">${list.length}</span></div>
    <p class="small muted" style="margin-top:0">Paste the crew's member list from the game so Contributions shows everyone, even members without an account here. Only names and rank are saved, never IPs.</p>
    <textarea class="input log-box" rows="4" data-roster placeholder="Paste the crew member list…"></textarea>
    <div data-rprev class="small" style="margin-top:8px"></div>
    <button class="btn primary block" data-rsave style="margin-top:8px" disabled>Replace member list</button>
    ${list.length ? `<details class="roster" style="margin-top:12px">
      <summary><b>${list.length} member${list.length === 1 ? "" : "s"}</b> <span class="muted small">· ${withAcct} on OLC Database${updated ? ` · updated ${fmtDateTime(updated)}` : ""}</span></summary>
      <ul class="list compact">${list.map((m) => `<li><span class="grow">${esc(m.name)}</span>
        ${m.rank !== "member" ? `<span class="badge">${RANK[m.rank] || esc(m.rank)}</span>` : ""}
        ${m.has_profile ? `<span class="badge on-olc">OLC</span>` : ""}</li>`).join("")}</ul>
    </details>` : `<div class="empty">No member list saved yet.</div>`}`;
  const ta = $("[data-roster]", card), prev = $("[data-rprev]", card), save = $("[data-rsave]", card);
  let found = [];
  ta.addEventListener("input", () => {
    found = parseRoster(ta.value);
    save.disabled = !found.length;
    if (!ta.value.trim()) { prev.innerHTML = ""; return; }
    if (!found.length) { prev.innerHTML = `<span class="err">No members found. Copy the whole list (LEADER, OFFICERS, MEMBERS).</span>`; return; }
    const was = new Set(list.map((m) => m.name.toLowerCase())), now = new Set(found.map((m) => m.name.toLowerCase()));
    const joined = found.filter((m) => !was.has(m.name.toLowerCase())).map((m) => m.name);
    const left = list.filter((m) => !now.has(m.name.toLowerCase())).map((m) => m.name);
    const c = (r) => found.filter((m) => m.rank === r).length;
    prev.innerHTML = `Found <b>${found.length}</b>: ${c("leader")} leader, ${c("officer")} officer${c("officer") === 1 ? "" : "s"}, ${c("member")} member${c("member") === 1 ? "" : "s"}.
      ${list.length && joined.length ? `<div>New: ${joined.map(esc).join(", ")}</div>` : ""}
      ${list.length && left.length ? `<div class="muted">No longer listed: ${left.map(esc).join(", ")}</div>` : ""}`;
  });
  save.onclick = async () => {
    btnBusy(save, true, "Saving…");
    const { error } = await sb.rpc("crew_roster_set", { p_list: found });
    if (error) { btnBusy(save, false); return toast(errMsg(error), true); }
    toast(`Saved ${found.length} crew members`);
    render();
  };
};

/* ---------- page ---------- */
PAGES.contrib = async function pageContrib(main) {
  const { sb, esc, $, $$, toast, errMsg, btnBusy, isMod, confirmBox, render, fmtDateTime } = O();
  const st = (() => { try { return JSON.parse(sessionStorage.getItem("olc-contrib") || "{}"); } catch (e) { return {}; } })();
  let period = st.period || "week", showAll = false;
  const keep = () => { try { sessionStorage.setItem("olc-contrib", JSON.stringify({ period })); } catch (e) {} };

  let all;
  try { all = await loadAll(sb, -Infinity); }
  catch (e) {
    if (missing(e)) { main.innerHTML = `<div class="card"><div class="card-h">Database update needed</div><p class="small" style="margin:0">Contributions need the v1.36 database update. The Admin runs it once in Supabase (SQL Editor).</p></div>`; return; }
    throw e;
  }
  const roster = (await loadRoster(sb)) || [];
  const { data: pastes } = await sb.from("crew_contrib_pastes").select("id,user_id,added,updated,created_at").order("id", { ascending: false }).limit(1);
  const lastPaste = (pastes || [])[0] || null;
  let pasterName = "";
  if (lastPaste?.user_id) pasterName = (await sb.from("profiles").select("username").eq("id", lastPaste.user_id).maybeSingle()).data?.username || "";
  let draft = "";
  try { draft = sessionStorage.getItem("olc-contrib-draft") || ""; } catch (e) {}

  const draw = () => {
    const from = startOf(period);
    const ev = all.filter((e) => e.at >= from);
    const sum = (k) => ev.filter((e) => k.includes(e.kind)).reduce((s, e) => s + Number(e.amount || 0), 0);
    const given = sum(["contrib"]), upkeep = -sum(["upkeep"]), spent = -sum(["upgrade", "surge"]);
    const people = new Map();
    ev.filter((e) => e.kind === "contrib").forEach((e) => {
      const k = (e.name || "").toLowerCase();
      const p = people.get(k) || { name: e.name, total: 0, n: 0, last: 0 };
      p.total += Number(e.amount || 0); p.n++; p.last = Math.max(p.last, e.at); people.set(k, p);
    });
    // Everyone on the crew roster (Mod Tools), plus anyone who gave but isn't on it any more
    const inCrew = new Map(roster.map((m) => [m.name.toLowerCase(), m]));
    roster.forEach((m) => { const k = m.name.toLowerCase(); if (!people.has(k)) people.set(k, { name: m.name, total: 0, n: 0, last: 0 }); });
    people.forEach((p, k) => { const r = inCrew.get(k); p.rank = r?.rank; p.acct = !!r?.has_profile; p.gone = roster.length > 0 && !r; });
    const ranked = [...people.values()].sort((a, b) => (a.gone - b.gone) || b.total - a.total || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    const gaveCount = ranked.filter((p) => p.total > 0).length;
    const pname = { day: "today", week: "this week", all: "all time" }[period];
    const recent = [...all].sort((a, b) => b.seq - a.seq);
    const shown = showAll ? recent : recent.slice(0, 40);

    main.innerHTML = `
      ${isMod() ? `<div class="card accent">
        <div class="card-h">Paste crew log<span class="r">mods</span></div>
        <p class="small muted" style="margin-top:0">Copy the crew activity log in the game and paste it here. Anything already saved is skipped, and a contribution that grew (2,000 → 3,000) is updated instead of counted again.</p>
        <textarea class="input log-box" rows="6" data-paste placeholder="Paste the crew activity log…">${esc(draft)}</textarea>
        <div data-prev style="margin-top:10px"></div>
        <button class="btn primary block" data-save style="margin-top:10px" disabled>Save</button>
        ${lastPaste ? `<div class="row" style="margin-top:10px;gap:8px"><span class="tiny muted grow">Last paste${pasterName ? ` by <b>${esc(pasterName)}</b>` : ""} · ${fmtDateTime(lastPaste.created_at)} · ${lastPaste.added} new${lastPaste.updated ? `, ${lastPaste.updated} grown` : ""}</span>
          <button class="btn sm ghost" data-undo>Undo it</button></div>` : ""}
      </div>` : ""}
      <div class="seg" style="grid-template-columns:repeat(3,1fr)">
        ${[["day", "Today"], ["week", "This week"], ["all", "All time"]].map(([k, l]) => `<button data-p="${k}" class="${period === k ? "on" : ""}">${l}</button>`).join("")}
      </div>
      <div class="tiles">
        <div class="tile big"><div class="k">Contributed ${pname}</div><div class="v gain">${fmt(given)}</div>
          <div class="s">${gaveCount} member${gaveCount === 1 ? "" : "s"}${roster.length ? ` of ${roster.length}` : ""} gave · game days reset 00:00 UTC, weeks start Monday</div></div>
        <div class="tile"><div class="k">Upkeep</div><div class="v">${short(upkeep)}</div></div>
        <div class="tile"><div class="k">Upgrades &amp; surges</div><div class="v">${short(spent)}</div></div>
      </div>
      <div class="card">
        <div class="card-h">Members<span class="r">${pname}</span></div>
        ${ranked.length ? `<ol class="rank">${ranked.map((p, i) => `
          <li><span class="rk mono">${i + 1}</span>
            <div class="grow"><b>${esc(p.name)}</b>${p.rank && p.rank !== "member" ? ` <span class="badge">${RANK[p.rank] || ""}</span>` : ""}${p.acct ? ` <span class="badge on-olc">OLC</span>` : ""}${p.gone ? ` <span class="badge">not in crew</span>` : ""}
              <div class="tiny muted">${p.n ? `${p.n} time${p.n === 1 ? "" : "s"} · last ${agoText(p.last, 1)}` : "Nothing yet"}</div>
              ${period === "day" ? `<div class="cap-bar"><span style="width:${Math.min(100, (p.total / DAY_CAP) * 100)}%"></span></div>` : ""}</div>
            <b class="mono ${p.total ? "gain" : "muted"}">${fmt(p.total)}${period === "day" ? `<span class="tiny muted"> / 50K</span>` : ""}</b></li>`).join("")}</ol>`
          : `<div class="empty">No contributions ${pname}.</div>`}
        ${!roster.length ? `<div class="hint">Only members who gave are listed. A mod can paste the crew member list in Mod Tools to list everyone.</div>` : ""}
        ${period !== "all" ? `<div class="hint">Times like "2d ago" are rounded by the game, so entries near midnight UTC can land on the next or previous day.</div>` : ""}
      </div>
      <div class="card">
        <div class="card-h">Crew log<span class="r">${fmt(all.length)} saved</span></div>
        ${shown.length ? `<ul class="list contrib-log">${shown.map((e) => `
          <li><span class="clog-ic k-${e.kind}">${ICONS[e.kind] || "·"}</span>
            <div class="grow" style="min-width:0"><div class="small">${esc(e.line)}</div><div class="tiny muted">${agoText(e.at, e.prec)}</div></div></li>`).join("")}</ul>
          ${recent.length > shown.length ? `<button class="btn ghost block" data-more style="margin-top:8px">Show all ${fmt(recent.length)}</button>` : ""}`
          : `<div class="empty">Nothing saved yet.${isMod() ? " Paste the crew log above." : " A mod pastes the crew log here."}</div>`}
      </div>`;

    $$("[data-p]", main).forEach((b) => (b.onclick = () => { period = b.dataset.p; keep(); draw(); }));
    const more = $("[data-more]", main); if (more) more.onclick = () => { showAll = true; draw(); };
    if (isMod()) bindPaste();
  };

  function bindPaste() {
    const ta = $("[data-paste]", main), prev = $("[data-prev]", main), save = $("[data-save]", main);
    let plan = null, expect = 0;
    let timer = null;
    const preview = async () => {
      const text = ta.value;
      try { sessionStorage.setItem("olc-contrib-draft", text); } catch (e) {}
      plan = null; save.disabled = true;
      if (!text.trim()) { prev.innerHTML = ""; return; }
      const { events } = parseLog(text);
      if (!events.length) { prev.innerHTML = `<div class="err">No crew log lines found. Copy the whole activity list (name, amount and "2h ago").</div>`; return; }
      let tail;
      try { tail = await loadTail(sb); } catch (e) { prev.innerHTML = `<div class="err">${esc(errMsg(e))}</div>`; return; }
      if (ta.value !== text) return;
      expect = tail.length ? tail[tail.length - 1].seq : 0;
      const p = lineUp(tail, events);
      const warn = capWarnings(all.filter((e) => e.kind === "contrib"), p);
      const msg = {
        first: `First paste: all ${p.added.length} entries will be saved.`,
        joined: `${p.known} already saved${p.older ? ` · ${p.older} older than the saved log (skipped)` : ""}.`,
        old: `Everything here is already saved. This paste is older than the last one.`,
        gap: `This doesn't connect to the saved log: nothing in it matches. Entries between the last paste and this one may be missing. Save only if that's OK.`,
        nomatch: `This doesn't line up with the saved log, so it isn't saved (it could count things twice). Copy the whole log from the very top and paste again. If it still won't line up, message the Admin.`
      }[p.mode];
      const contribNew = p.added.filter((e) => e.kind === "contrib").reduce((s, e) => s + e.amount, 0);
      const contribGrow = p.ups.reduce((s, u) => s + (u.e.amount - u.from), 0);
      prev.innerHTML = `
        <div class="${p.mode === "nomatch" || p.mode === "gap" ? "err" : "hint"}" style="margin-bottom:8px">${msg}</div>
        ${p.added.length || p.ups.length ? `<div class="small" style="margin-bottom:6px"><b>${p.added.length}</b> new${p.ups.length ? ` · <b>${p.ups.length}</b> grown` : ""} · <span class="gain">+${fmt(contribNew + contribGrow)}</span> contributed</div>` : ""}
        ${warn.length ? `<div class="err" style="margin-bottom:8px">Over 50,000 in one day: ${warn.map((w) => `<b>${esc(w.name)}</b> ${fmt(w.sum)} (${w.day})`).join(", ")}. Check this isn't counted twice.</div>` : ""}
        ${p.ups.length ? `<ul class="list compact">${p.ups.map((u) => `<li><span class="clog-ic k-${u.e.kind}">${ICONS[u.e.kind]}</span><span class="small grow">${esc(u.e.name)}: ${fmt(u.from)} → <b>${fmt(u.e.amount)}</b></span></li>`).join("")}</ul>` : ""}
        ${p.added.length ? `<ul class="list compact">${[...p.added].reverse().slice(0, 25).map((e) => `<li><span class="clog-ic k-${e.kind}">${ICONS[e.kind]}</span><span class="small grow">${esc(e.line)}</span><span class="tiny muted">${agoText(e.at, e.prec)}</span></li>`).join("")}</ul>
          ${p.added.length > 25 ? `<div class="tiny muted">…and ${p.added.length - 25} more</div>` : ""}` : ""}`;
      plan = p;
      save.disabled = !(p.added.length || p.ups.length) || p.mode === "nomatch";
      save.textContent = p.mode === "gap" ? "Save anyway" : "Save";
    };
    ta.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(preview, 250); });
    if (ta.value.trim()) preview();
    save.onclick = async () => {
      if (!plan) return;
      if (plan.mode === "gap" && !(await confirmBox({ title: "Save with a gap?", body: "Nothing in this paste matches the saved log, so anything between the two pastes is missing.", ok: "Save anyway" }))) return;
      btnBusy(save, true, "Saving…");
      const iso = (t) => new Date(t).toISOString();
      const { data, error } = await sb.rpc("crew_contrib_apply", {
        p_expect_seq: expect,
        p_new: plan.added.map((e) => ({ kind: e.kind, name: e.name || "", amount: e.amount, line: e.line, at_est: iso(e.at), at_prec: e.prec })),
        p_updates: plan.ups.map((u) => ({ seq: u.seq, amount: u.e.amount, line: u.e.line, at_est: iso(u.e.at), at_prec: u.e.prec }))
      });
      if (error) { btnBusy(save, false); return toast(missing(error) ? "The Admin needs to run the v1.36 database update first" : errMsg(error), true); }
      try { sessionStorage.removeItem("olc-contrib-draft"); } catch (e) {}
      toast(`Saved: ${data?.added ?? plan.added.length} new${(data?.updated ?? plan.ups.length) ? `, ${data?.updated ?? plan.ups.length} grown` : ""}`);
      render();
    };
    const undo = $("[data-undo]", main);
    if (undo) undo.onclick = async () => {
      if (!(await confirmBox({ title: "Undo the last paste?", body: `Removes the ${lastPaste.added} entr${lastPaste.added === 1 ? "y" : "ies"} it added${lastPaste.updated ? ` and puts ${lastPaste.updated} grown amount${lastPaste.updated === 1 ? "" : "s"} back` : ""}.`, ok: "Undo", danger: true }))) return;
      const { error } = await sb.rpc("crew_contrib_undo");
      if (error) return toast(errMsg(error), true);
      toast("Last paste undone");
      render();
    };
  }

  draw();
};

window.OLC_CONTRIB_TEST = { parseLog, lineUp, capWarnings, parseRoster };
})();
