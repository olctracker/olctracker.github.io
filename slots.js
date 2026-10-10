/* =========================================================
   OLC Database — stage 5: my spam slots + my siphon list
   Both lists are private to each member.
   ========================================================= */
(() => {
"use strict";
const O = () => window.OLC;
const G = () => window.OLC_GAME;
const PAGES = (window.OLC_PAGES = window.OLC_PAGES || {});
const MAX_SLOTS = 64;
const HIGH_RATE = 100;            // current top earning per hour

/* ---------- reading a pasted spam or siphon list ----------
   Each entry starts with an IP line; the lines after it give the level,
   rate or percent, amount, and age. Works for both lists:
     76.176.81.120 / LV.3 / 27/hr / 1,027 earned / 1d
     114.194.179.214 / LV.3 / 1.5% / 65 siphoned / 1d ago            */
function readSlotList(text) {
  const out = [];
  const byIp = new Map();
  let cur = null;
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let m;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(line)) {
      cur = byIp.get(line);
      if (!cur) { cur = { ip: line, level: null, per_hour: null, pct: null, amount: null, age: null }; byIp.set(line, cur); out.push(cur); }
      continue;
    }
    if (!cur) continue;
    if ((m = /^lv?l?\.?\s*(\d{1,3})$/i.exec(line))) cur.level = Number(m[1]);
    else if ((m = /^([\d,]+)\s*\/\s*hr$/i.exec(line))) cur.per_hour = Number(m[1].replace(/,/g, ""));
    else if ((m = /^([\d.]+)\s*%$/.exec(line))) cur.pct = Number(m[1]);
    else if ((m = /^([\d,]+)\s+(earned|siphoned)$/i.exec(line))) cur.amount = Number(m[1].replace(/,/g, ""));
    else if ((m = /^(\d+\s*[smhdw])(\s*ago)?$/i.exec(line))) cur.age = m[1].replace(/\s+/g, "");
  }
  return out;
}

// "1d" / "3h" / "45m" -> hours, for sorting and day/week filtering
function ageHours(age) {
  const m = /^(\d+)([smhdw])$/i.exec(age || "");
  if (!m) return null;
  return Number(m[1]) * ({ s: 1 / 3600, m: 1 / 60, h: 1, d: 24, w: 168 }[m[2].toLowerCase()]);
}

window.OLC_SLOT_TEST = { readSlotList, ageHours };

const fmt = (n) => (n === null || n === undefined ? "—" : Math.round(Number(n)).toLocaleString("en-US"));

/* ---------- missing slots: ask what happened to each ---------- */
function askMissing(ips) {
  const { modal, esc, $, $$ } = O();
  return new Promise((done) => {
    const choice = Object.fromEntries(ips.map((ip) => [ip, "keep"]));
    modal(`<h3>${ips.length} slot${ips.length === 1 ? "" : "s"} missing from this paste</h3>
      <p>Tell us what happened to each. If you only copied part of your list, keep them.</p>
      <div class="chips" style="margin-bottom:10px">
        <button class="chip" data-all="mine">All: I removed</button>
        <button class="chip" data-all="target">All: target removed</button>
        <button class="chip on" data-all="keep">All: still there</button>
      </div>
      <ul class="list miss-list">${ips.map((ip) => `
        <li><span class="mono grow">${esc(ip)}</span>
          <select class="input sm-select" data-ip="${esc(ip)}">
            <option value="keep">Still there</option>
            <option value="mine">I removed it</option>
            <option value="target">Target removed it</option>
          </select></li>`).join("")}</ul>
      <div class="hint">"Target removed it" sends the IP to Mods to check if the player is active again.</div>
      <div class="btns" style="margin-top:12px"><button class="btn" data-no>Cancel</button><button class="btn primary" data-yes>Save</button></div>`,
    (w, close) => {
      const sync = () => $$("[data-ip]", w).forEach((s) => (s.value = choice[s.dataset.ip]));
      $$("[data-ip]", w).forEach((s) => (s.onchange = () => { choice[s.dataset.ip] = s.value; $$("[data-all]", w).forEach((c) => c.classList.remove("on")); }));
      $$("[data-all]", w).forEach((b) => (b.onclick = () => {
        ips.forEach((ip) => (choice[ip] = b.dataset.all)); sync();
        $$("[data-all]", w).forEach((c) => c.classList.toggle("on", c === b));
      }));
      $("[data-no]", w).onclick = () => { close(); done(null); };
      $("[data-yes]", w).onclick = () => { close(); done(choice); };
    }, { sticky: true });
  });
}

/* ---------- saving a pasted spam list ---------- */
async function saveSpam(list, previous) {
  const { sb, S, isMod } = O();
  const uid = S.profile.id;
  const now = new Date().toISOString();
  const newIps = new Set(list.map((x) => x.ip));
  const missing = previous.filter((p) => !newIps.has(p.ip)).map((p) => p.ip);
  let decisions = {};
  if (missing.length) {
    decisions = await askMissing(missing);
    if (!decisions) return null;             // cancelled
  }
  const res = { saved: list.length, removed: 0, reported: 0, kept: 0, high: 0 };
  for (const ip of missing) {
    const d = decisions[ip];
    if (d === "keep") { res.kept++; continue; }
    await sb.from("spam_slots").delete().eq("user_id", uid).eq("ip", ip);
    res.removed++;
    if (d === "target") { await sb.rpc("report_spam_removed", { p_ip: ip }); res.reported++; }
  }
  if (list.length) {
    const rows = list.map((x) => ({ user_id: uid, ip: x.ip, level: x.level, per_hour: x.per_hour, earned: x.amount, age: x.age, updated_at: now }));
    const { error } = await sb.from("spam_slots").upsert(rows, { onConflict: "user_id,ip" });
    if (error) throw error;
  }
  const high = list.filter((x) => (x.per_hour || 0) >= HIGH_RATE);
  if (high.length) {
    await sb.rpc("report_possible_spam", { p_ips: high.map((x) => x.ip), p_rates: high.map((x) => x.per_hour) });
    res.high = high.length;
  }
  res.modActive = isMod() && res.reported;
  return res;
}

/* ---------- suggestions: 10 lowest-firewall inactive IPs, level 25+ ---------- */
async function loadSuggestions(mine) {
  const { sb } = O();
  const { data } = await sb.from("targets").select("ip,firewall,player_level,pool_added_by")
    .eq("in_pool", true).eq("status", "inactive").eq("scrambled", false).gte("player_level", 25)
    .order("firewall", { ascending: true, nullsFirst: false }).limit(10 + mine.size + 20);
  return (data || []).filter((t) => !mine.has(t.ip))
    .sort((x, y) => (x.firewall ?? 1e9) - (y.firewall ?? 1e9) || (y.player_level ?? 0) - (x.player_level ?? 0))
    .slice(0, 10);
}

/* ---------- the "My spam slots" section on the Spam page ---------- */
async function mountSpamSlots(box) {
  const { sb, S, esc, $, $$, toast, errMsg, confirmBox } = O();
  const uid = S.profile.id;
  const { data: slots } = await sb.from("spam_slots").select("*").eq("user_id", uid);
  const mine = (slots || []).sort((a, b) => (b.per_hour || 0) - (a.per_hour || 0));
  const open = MAX_SLOTS - mine.length;
  const perHour = mine.reduce((s, x) => s + (x.per_hour || 0), 0);
  const sugg = open > 0 ? await loadSuggestions(new Set(mine.map((x) => x.ip))) : [];

  box.innerHTML = `
    <div class="card">
      <div class="card-h">My spam slots<span class="r">${mine.length}/${MAX_SLOTS}</span></div>
      <div class="slot-bar"><i style="width:${Math.min(100, (mine.length / MAX_SLOTS) * 100)}%"></i></div>
      <div class="row small muted" style="margin:6px 0 12px"><span class="grow">${fmt(perHour)}/hr total</span><span>${open > 0 ? `${open} open` : "full"}</span></div>
      <textarea class="input mono log-box" rows="5" placeholder="Paste your spam list from the game&#10;76.176.81.120&#10;LV.3&#10;27/hr&#10;1,027 earned&#10;1d"></textarea>
      <div data-prev></div>
      <button class="btn primary block" data-save disabled style="margin-top:10px">Save spam list</button>
    </div>

    ${open > 0 ? `<div class="card">
      <div class="card-h">Suggestions<span class="r">${open} open slot${open === 1 ? "" : "s"}</span></div>
      <div class="tiny muted" style="margin:-4px 0 6px">Inactive, level 25+, lowest firewall first.</div>
      ${sugg.length ? `<ul class="list">${sugg.map((t) => `
        <li><div class="fw-pill mono"><small>FW</small>${t.firewall ?? "—"}</div>
          <div class="grow"><a class="mono ip-row" href="#/ip/${encodeURIComponent(t.ip)}">${esc(t.ip)}</a><div class="tiny muted">LV ${t.player_level ?? "—"}</div></div>
          <button class="icon-btn" data-copy="${esc(t.ip)}" aria-label="Copy">${G().IC.copy}</button>
          <button class="btn sm" data-flag="${esc(t.ip)}">Flag</button></li>`).join("")}</ul>`
        : `<div class="empty">No suggestions. Add inactive IPs (level 25+) to the list below.</div>`}
    </div>` : ""}

    ${mine.length ? `<div class="card">
      <div class="card-h">Current slots</div>
      <ul class="list">${mine.map((x) => `
        <li><div class="grow"><span class="mono ip-row">${esc(x.ip)}</span>
          <div class="tiny muted">LV ${x.level ?? "—"} · ${fmt(x.earned)} earned · ${esc(x.age || "—")}</div></div>
          <b class="mono ${(x.per_hour || 0) >= HIGH_RATE ? "gain" : ""}">${fmt(x.per_hour)}/hr</b></li>`).join("")}</ul>
      <button class="btn danger block" data-reboot style="margin-top:12px">Reset spam slots</button>
    </div>` : ""}`;

  const ta = $("textarea", box), prev = $("[data-prev]", box), save = $("[data-save]", box);
  let parsed = [];
  ta.addEventListener("input", () => {
    parsed = readSlotList(ta.value);
    save.disabled = !parsed.length;
    const high = parsed.filter((x) => (x.per_hour || 0) >= HIGH_RATE).length;
    const gone = mine.filter((m) => !parsed.some((p) => p.ip === m.ip)).length;
    prev.innerHTML = !ta.value.trim() ? "" : `<div class="tiny mono muted" style="margin-top:8px">
      FOUND ${parsed.length} SLOT${parsed.length === 1 ? "" : "S"}${high ? ` · ${high} AT ${HIGH_RATE}/HR` : ""}${gone && parsed.length ? ` · ${gone} MISSING FROM LAST TIME` : ""}${parsed.length > MAX_SLOTS ? ` · MORE THAN ${MAX_SLOTS}?` : ""}</div>`;
  });
  save.onclick = async () => {
    O().btnBusy(save, true, "Saving…");
    try {
      const r = await saveSpam(parsed, mine);
      if (!r) { O().btnBusy(save, false); return; }
      toast(`Saved ${r.saved} slots${r.removed ? ` · ${r.removed} removed` : ""}${r.reported ? (r.modActive ? ` · ${r.reported} set Active` : ` · ${r.reported} sent to Mods`) : ""}${r.high ? ` · ${r.high} at ${HIGH_RATE}/hr reported` : ""}`);
      mountSpamSlots(box);
    } catch (e) { toast(errMsg(e), true); O().btnBusy(save, false); }
  };
  $$("[data-copy]", box).forEach((b) => (b.onclick = () => G().copy(b.dataset.copy)));
  $$("[data-flag]", box).forEach((b) => (b.onclick = () => flagSuggestion(b.dataset.flag, () => mountSpamSlots(box))));
  $("[data-reboot]", box) && ($("[data-reboot]", box).onclick = async () => {
    if (!(await confirmBox({ title: "Reset your spam slots?", body: "Clears your saved spam list only. Siphon and crypto are untouched.", ok: "Reset", danger: true }))) return;
    const { error } = await sb.rpc("reboot", { p_category: "spam" });
    if (error) return toast(errMsg(error), true);
    toast("Spam slots cleared"); mountSpamSlots(box);
  });
}

/* Flag a suggestion: scrambled (just tagged) or incorrect (goes to Mods) */
function flagSuggestion(ip, after) {
  const { modal, esc, $, sb, toast, errMsg } = O();
  modal(`<h3>Flag ${esc(ip)}</h3>
    <button class="sheet-btn" data-k="scr">Scrambled — player changed IP</button>
    <button class="sheet-btn danger" data-k="inc">Incorrect — info is wrong</button>
    <button class="btn block" data-k="x" style="margin-top:10px">Cancel</button>`,
  (w, close) => {
    $("[data-k=x]", w).onclick = close;
    $("[data-k=scr]", w).onclick = async () => {
      close();
      if (!(await O().confirmBox({ title: `Mark ${ip} as scrambled?`, body: "It leaves the suggestions but stays searchable. It's never blocked.", ok: "Mark scrambled", danger: true }))) return;
      const { error } = await sb.from("targets").upsert({ ip, scrambled: true }, { onConflict: "ip" });
      if (error) return toast(errMsg(error), true);
      toast("Marked scrambled"); after();
    };
    $("[data-k=inc]", w).onclick = async () => {
      close();
      if (!(await O().confirmBox({ title: `Flag ${ip} as incorrect?`, body: "A Mod will check it.", ok: "Send flag", danger: true }))) return;
      const { error } = await sb.from("flags").insert({ ip, kind: "incorrect", note: "Flagged from spam suggestions" });
      if (error) return toast(errMsg(error), true);
      toast("Flag sent to Mods"); after();
    };
  });
}
window.OLC_SLOTS = { mountSpamSlots };

/* =========================================================
   SIPHON PAGE — my siphon list, kept for reference
   New pastes update matching IPs and add new ones; older
   entries stay until you remove them or reset.
   ========================================================= */
PAGES.siphon = async function pageSiphon(main) {
  const { sb, S, esc, $, $$, toast, errMsg, confirmBox, render, fmtDate } = O();
  const uid = S.profile.id;
  const { data } = await sb.from("siphon_slots").select("*").eq("user_id", uid);
  const list = (data || []).sort((a, b) => (Number(b.siphoned) || 0) - (Number(a.siphoned) || 0));
  const total = list.reduce((s, x) => s + (Number(x.siphoned) || 0), 0);

  main.innerHTML = `
    <div class="tiles">
      <div class="tile big"><div class="k">Total siphoned</div><div class="v gain">${fmt(total)}</div><div class="s">${list.length} IP${list.length === 1 ? "" : "s"} on your list</div></div>
    </div>

    <div class="card">
      <div class="card-h">Paste siphon list</div>
      <textarea class="input mono log-box" rows="5" placeholder="Paste your siphon list from the game&#10;114.194.179.214&#10;LV.3&#10;1.5%&#10;65 siphoned&#10;1d ago"></textarea>
      <div data-prev></div>
      <button class="btn primary block" data-save disabled style="margin-top:10px">Save siphon list</button>
    </div>

    <div class="card">
      <div class="card-h">My siphons<span class="r">highest first</span></div>
      ${list.length ? `<ul class="list">${list.map((x) => `
        <li><div class="lv-pill mono"><small>LV</small>${x.level ?? "—"}</div>
          <div class="grow"><span class="mono ip-row">${esc(x.ip)}</span>
            <div class="tiny muted">${x.pct != null ? `${Number(x.pct)}%` : "—"} · ${esc(x.age ? x.age + " ago" : "—")} · ${fmtDate(x.updated_at)}</div></div>
          <b class="mono gain">${fmt(x.siphoned)}</b>
          <button class="icon-btn" data-del="${esc(x.ip)}" aria-label="Remove">×</button></li>`).join("")}</ul>`
        : `<div class="empty">Nothing saved yet. Paste your siphon list above.</div>`}
    </div>

    ${list.length ? `<div class="card danger-zone">
      <div class="card-h">Reset</div>
      <p class="small muted" style="margin-top:0">Clears your siphon list only. Spam and crypto are untouched.</p>
      <button class="btn danger block" data-reboot>Reset siphon list</button>
    </div>` : ""}`;

  const ta = $("textarea", main), prev = $("[data-prev]", main), save = $("[data-save]", main);
  let parsed = [];
  ta.addEventListener("input", () => {
    parsed = readSlotList(ta.value);
    save.disabled = !parsed.length;
    const sum = parsed.reduce((s, x) => s + (x.amount || 0), 0);
    prev.innerHTML = !ta.value.trim() ? "" : `<div class="tiny mono muted" style="margin-top:8px">FOUND ${parsed.length} ENTR${parsed.length === 1 ? "Y" : "IES"} · ${fmt(sum)} SIPHONED</div>`;
  });
  save.onclick = async () => {
    O().btnBusy(save, true, "Saving…");
    const now = new Date().toISOString();
    const rows = parsed.map((x) => ({ user_id: uid, ip: x.ip, level: x.level, pct: x.pct, siphoned: x.amount, age: x.age, updated_at: now }));
    const { error } = await sb.from("siphon_slots").upsert(rows, { onConflict: "user_id,ip" });
    if (error) { O().btnBusy(save, false); return toast(errMsg(error), true); }
    toast(`Saved ${rows.length} siphon entr${rows.length === 1 ? "y" : "ies"}`);
    render();
  };
  $$("[data-del]", main).forEach((b) => (b.onclick = async () => {
    if (!(await confirmBox({ title: `Remove ${b.dataset.del}?`, body: "Removes it from your siphon list.", ok: "Remove", danger: true }))) return;
    const { error } = await sb.from("siphon_slots").delete().eq("user_id", uid).eq("ip", b.dataset.del);
    if (error) return toast(errMsg(error), true);
    render();
  }));
  $("[data-reboot]", main) && ($("[data-reboot]", main).onclick = async () => {
    if (!(await confirmBox({ title: "Reset your siphon list?", body: "Clears your saved siphon list only.", ok: "Reset", danger: true }))) return;
    const { error } = await sb.rpc("reboot", { p_category: "siphon" });
    if (error) return toast(errMsg(error), true);
    toast("Siphon list cleared"); render();
  });
};

})();
