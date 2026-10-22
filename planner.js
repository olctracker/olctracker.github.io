/* =========================================================
   OLC Database — Reboot Planner and Direct Reboot Planner (Admin)
   Plans every app from a fresh reboot up to a goal level, one level
   at a time, using saved IPs (not scrambled, firewall known, no crew).
   - Reboot Planner: each step from the lowest-firewall IP that has it.
   - Direct: only IPs with firewall <= your bypass level; the fewest
     IPs that cover the route (most steps first, firewall breaks ties).
   Bypass side: the IPs (check = bypassed). Download side: level by
   level (check = downloaded). Checked lines move to Complete.
   The plan is saved; Rebuild makes fresh picks. New IPs that fill a
   "skip" step can be added without rebuilding.
   ========================================================= */
(() => {
"use strict";
const O = () => window.OLC;
const G = () => window.OLC_GAME;
const PAGES = (window.OLC_PAGES = window.OLC_PAGES || {});

// short name, and the level a reboot leaves it at (route starts one above)
const APPS = [
  ["firewall", "FW", 1], ["bypasser", "BP", 1], ["password_cracker", "PC", 1], ["password_encryptor", "PE", 1],
  ["antivirus", "AV", 0], ["rootkit", "RK", 0], ["spam", "SP", 0], ["siphon", "SI", 0], ["proxy", "PR", 0], ["trace", "TR", 0]
];
const SHORT = Object.fromEntries(APPS.map(([k, s]) => [k, s]));
const ORDER = Object.fromEntries(APPS.map(([k], i) => [k, i]));
const sk = (k, l) => `${k}:${l}`;

/* ---------- the route ---------- */
function allSteps(goal) {
  const out = [];
  for (const [k, , start] of APPS) for (let l = start + 1; l <= goal; l++) out.push({ k, l });
  return out;
}

// Reboot Planner: lowest firewall per step; ties go to the IP used for the most steps
function planLowestFw(steps, targets) {
  const best = steps.map((s) => {
    const c = targets.filter((t) => t[s.k] === s.l);
    if (!c.length) return [];
    const fw = Math.min(...c.map((t) => t.firewall));
    return c.filter((t) => t.firewall === fw);
  });
  const use = new Map();
  best.forEach((ties) => ties.forEach((t) => use.set(t.ip, (use.get(t.ip) || 0) + 1)));
  return steps.map((s, i) => {
    const t = [...best[i]].sort((a, b) => (use.get(b.ip) || 0) - (use.get(a.ip) || 0) || a.ip.localeCompare(b.ip))[0];
    return { ...s, ip: t ? t.ip : null, fw: t ? t.firewall : null };
  });
}

// Direct: fewest IPs (greedy: most remaining steps first, lower firewall breaks ties),
// then drop any IP whose steps the others already cover. Each step uses the lowest-FW chosen IP.
function planFewest(steps, targets, bypass) {
  const pool = targets.filter((t) => t.firewall <= bypass);
  const need = new Set(steps.map((s) => sk(s.k, s.l)));
  const covers = new Map();
  for (const t of pool) {
    const c = APPS.map(([k]) => sk(k, t[k])).filter((key) => need.has(key));
    if (c.length) covers.set(t.ip, { t, c });
  }
  const left = new Set([...need].filter((key) => [...covers.values()].some((x) => x.c.includes(key))));
  const chosen = [];
  while (left.size) {
    let pick = null, n = 0;
    for (const x of covers.values()) {
      const m = x.c.filter((key) => left.has(key)).length;
      if (m > n || (m === n && m > 0 && (x.t.firewall < pick.t.firewall || (x.t.firewall === pick.t.firewall && x.t.ip < pick.t.ip)))) { pick = x; n = m; }
    }
    if (!pick) break;
    chosen.push(pick);
    pick.c.forEach((key) => left.delete(key));
  }
  // remove IPs that turned out not to be needed
  for (let i = chosen.length - 1; i >= 0; i--) {
    const others = chosen.filter((_, j) => j !== i);
    if (chosen[i].c.every((key) => others.some((o) => o.c.includes(key)))) chosen.splice(i, 1);
  }
  return steps.map((s) => {
    const key = sk(s.k, s.l);
    const t = chosen.filter((x) => x.c.includes(key)).map((x) => x.t)
      .sort((a, b) => a.firewall - b.firewall || a.ip.localeCompare(b.ip))[0];
    return { ...s, ip: t ? t.ip : null, fw: t ? t.firewall : null };
  });
}
window.OLC_PLANNER_TEST = { allSteps, planLowestFw, planFewest };

function makePlan(kind, goal, bypass, targets) {
  const steps = allSteps(goal);
  return { steps: kind === "direct" ? planFewest(steps, targets, bypass) : planLowestFw(steps, targets) };
}
// IPs in the plan, lowest firewall first, each with the steps taken from it
function ipList(plan) {
  const by = new Map();
  for (const s of plan.steps) if (s.ip) {
    if (!by.has(s.ip)) by.set(s.ip, { ip: s.ip, fw: s.fw, steps: [] });
    by.get(s.ip).steps.push(s);
  }
  return [...by.values()].sort((a, b) => a.fw - b.fw || b.steps.length - a.steps.length || a.ip.localeCompare(b.ip));
}
// New saved IPs that fill skipped steps (only those, nothing else changes)
function fillers(kind, plan, bypass, targets) {
  const gaps = plan.steps.filter((s) => !s.ip);
  if (!gaps.length) return [];
  const filled = kind === "direct" ? planFewest(gaps, targets, bypass) : planLowestFw(gaps, targets);
  return filled.filter((s) => s.ip);
}

/* ---------- data ---------- */
async function loadTargets() {
  const { sb } = O();
  const cols = ["ip", "firewall", ...APPS.map((a) => a[0])].join(",");
  const out = [];
  for (let from = 0; from < 50000; from += 1000) {
    const { data, error } = await sb.from("targets").select(cols).eq("scrambled", false).not("firewall", "is", null)
      .order("ip").range(from, from + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  const mine = await G().myDevice().catch(() => null);
  return G().dropCrew(out.filter((t) => G().isFullIp(t.ip) && (!mine || t.ip !== mine.ip)), (t) => [t.ip]);
}

/* ---------- page ---------- */
function plannerPage(kind) {
  return async function (main) {
    const { sb, S, esc, $, $$, toast, errMsg, confirmBox, isAdmin, fmtDate, btnBusy } = O();
    if (!isAdmin()) { main.innerHTML = `<div class="card"><div class="empty">Admin only.</div></div>`; return; }
    const direct = kind === "direct";
    const uid = S.profile.id;
    const [planR, targets] = await Promise.all([
      sb.from("reboot_plans").select("*").eq("user_id", uid).eq("kind", kind).maybeSingle(),
      loadTargets()
    ]);
    if (planR.error) {
      main.innerHTML = /reboot_plans|relation|schema/i.test(planR.error.message || "")
        ? `<div class="card warn"><div class="card-h">Database update needed</div><p class="small" style="margin:0">Run the v1.20 SQL file in Supabase first.</p></div>`
        : `<div class="card"><div class="card-h">Error</div><p>${esc(errMsg(planR.error))}</p></div>`;
      return;
    }
    let row = planR.data;
    let st = {};
    try { st = JSON.parse(sessionStorage.getItem("olc-plan-" + kind) || "{}"); } catch (e) {}
    let side = st.side === "dl" ? "dl" : "bp";
    const keep = () => { try { sessionStorage.setItem("olc-plan-" + kind, JSON.stringify({ side })); } catch (e) {} };
    const tByIp = new Map(targets.map((t) => [t.ip, t]));

    const inputs = (goal, bypass) => `
      <div class="row" style="gap:8px;align-items:flex-end">
        ${direct ? `<label class="f grow" style="margin:0"><span>Bypass level</span><input class="input mono" name="bypass" inputmode="numeric" pattern="[0-9]*" maxlength="2" value="${bypass ?? ""}" placeholder="22"></label>` : ""}
        <label class="f grow" style="margin:0"><span>Goal app level</span><input class="input mono" name="goal" inputmode="numeric" pattern="[0-9]*" maxlength="2" value="${goal ?? ""}" placeholder="21"></label>
        ${row ? `<button class="btn" type="submit" style="min-height:48px">Rebuild</button>` : ""}
      </div>`;
    const readInputs = (f) => {
      const goal = Number(f.goal.value), bypass = direct ? Number(f.bypass.value) : null;
      if (!(goal >= 2 && goal <= 60)) { toast("Goal must be 2 to 60", true); return null; }
      if (direct && !(bypass >= 1 && bypass <= 99)) { toast("Enter your bypass level", true); return null; }
      return { goal, bypass };
    };
    const save = async (patch) => {
      const { error } = await sb.from("reboot_plans").upsert({ user_id: uid, kind, ...patch, updated_at: new Date().toISOString() }, { onConflict: "user_id,kind" });
      if (error) throw error;
    };

    // first time: no plan yet
    if (!row) {
      main.innerHTML = `<form class="card" data-make>
        <div class="card-h">Make a plan</div>
        <p class="small muted" style="margin-top:0">${direct
          ? "Plans every app from a fresh reboot up to your goal, one level at a time, using as few IPs as possible within your bypass level."
          : "Plans every app from a fresh reboot up to your goal, one level at a time, from the lowest-firewall IP that has each level."} Saved to your account; Rebuild any time for fresh picks.</p>
        ${inputs(null, null)}
        <button class="btn primary block" type="submit" style="margin-top:12px">Make plan</button></form>`;
      $("[data-make]", main).onsubmit = async (e) => {
        e.preventDefault();
        const v = readInputs(e.target);
        if (!v) return;
        const btn = $("button[type=submit]", e.target);
        btnBusy(btn, true, "Planning…");
        try { await save({ goal: v.goal, bypass: v.bypass, plan: makePlan(kind, v.goal, v.bypass, targets), bypass_done: [], dl_done: [] }); O().render(); }
        catch (err) { btnBusy(btn, false); toast(errMsg(err), true); }
      };
      return;
    }

    const draw = () => {
      const plan = row.plan || { steps: [] };
      const ips = ipList(plan);
      const bpDone = new Set(row.bypass_done || []), dlDone = new Set(row.dl_done || []);
      const fill = fillers(kind, plan, row.bypass, targets);
      const fillIps = new Set(fill.map((s) => s.ip));
      const gaps = plan.steps.filter((s) => !s.ip).length;
      const other = direct ? ipList({ steps: planLowestFw(plan.steps.map(({ k, l }) => ({ k, l })), targets) }).length : null;
      const stepTxt = (list) => list.slice().sort((a, b) => ORDER[a.k] - ORDER[b.k] || a.l - b.l).map((s) => `${SHORT[s.k]} ${s.l}`).join(" · ");
      const copyBtn = (ip) => `<button class="icon-btn" data-copy="${esc(ip)}" aria-label="Copy IP">${G().IC.copy}</button>`;
      const ck = (attr, on) => `<button class="ck ${on ? "on" : ""}" ${attr} aria-label="${on ? "Uncheck" : "Check"}">${on ? G().IC.check : ""}</button>`;
      const scr = (ip) => (tByIp.has(ip) ? "" : ` <span class="badge st-scr">gone</span>`);

      const ipRow = (x, on) => `<div class="rp-row ${on ? "done" : ""}">
        <div class="fw-pill mono"><small>FW</small>${x.fw}</div>
        <div class="grow"><div class="rp-ip">${esc(x.ip)}${scr(x.ip)}</div><div class="rp-apps">${direct ? `${x.steps.length} step${x.steps.length === 1 ? "" : "s"} · ` : ""}${stepTxt(x.steps)}</div></div>
        ${on ? "" : copyBtn(x.ip)}${ck(`data-bp="${esc(x.ip)}"`, on)}</div>`;
      const dlRow = (s, on) => `<div class="rp-row ${on ? "done" : ""}"><span class="app">${SHORT[s.k]}</span>
        <div class="grow">${s.ip ? `<div class="rp-ip">${esc(s.ip)}${scr(s.ip)}</div>` : `<div class="skipline">Skip · no IP has ${SHORT[s.k]} ${s.l}</div>`}</div>
        ${s.ip && !on ? copyBtn(s.ip) : ""}${ck(`data-dl="${sk(s.k, s.l)}"`, on)}</div>`;
      const byLevel = (list, done) => {
        const lv = [...new Set(list.map((s) => s.l))].sort((a, b) => a - b);
        return lv.map((l) => `<div class="lvl-h ${done ? "muted" : ""}">Level ${l}</div>${list.filter((s) => s.l === l)
          .sort((a, b) => ORDER[a.k] - ORDER[b.k]).map((s) => dlRow(s, done)).join("")}`).join("");
      };

      const todoIps = ips.filter((x) => !bpDone.has(x.ip)), doneIps = ips.filter((x) => bpDone.has(x.ip));
      const todoDl = plan.steps.filter((s) => !dlDone.has(sk(s.k, s.l))), doneDl = plan.steps.filter((s) => dlDone.has(sk(s.k, s.l)));
      const nextLv = todoDl.length ? Math.min(...todoDl.map((s) => s.l)) : null;

      main.innerHTML = `
        <form class="card" data-rebuild>
          <div class="card-h">Plan<span class="r">saved ${esc(fmtDate(row.updated_at))}</span></div>
          ${inputs(row.goal, row.bypass)}
          <div class="hint">Every app, one level at a time, from a fresh reboot. ${direct ? "Fewest IPs within your bypass level." : "Lowest firewall first."} Rebuild keeps your checkmarks.</div>
        </form>
        ${fill.length ? `<div class="banner"><div class="grow small"><b>${fillIps.size} new IP${fillIps.size === 1 ? "" : "s"}</b> fill${fillIps.size === 1 ? "s" : ""} ${fill.length} missing step${fill.length === 1 ? "" : "s"}.</div>
          <button class="btn sm primary" data-fill>Add to plan</button></div>` : ""}
        ${direct ? `<div class="tiles">
          <div class="tile"><div class="k">IPs to bypass</div><div class="v gain">${ips.length}</div><div class="s">Reboot Planner: ${other}</div></div>
          <div class="tile"><div class="k">Steps covered</div><div class="v">${plan.steps.length - gaps}<small class="muted" style="font-size:14px">/${plan.steps.length}</small></div><div class="s">${gaps ? `${gaps} have no IP` : "all covered"}</div></div>
        </div>` : ""}
        <div class="seg"><button data-side="bp" class="${side === "bp" ? "on" : ""}">Bypass · ${ips.length}</button><button data-side="dl" class="${side === "dl" ? "on" : ""}">Download · ${plan.steps.length}</button></div>
        ${side === "bp" ? `
          <div class="statline">${ips.length} IPs · ${doneIps.length} bypassed${gaps ? ` · ${gaps} step${gaps === 1 ? " has" : "s have"} no IP` : ""}</div>
          <div class="card"><div class="card-h">To bypass<span class="r">lowest FW first</span></div>
            ${todoIps.length ? todoIps.map((x) => ipRow(x, false)).join("") : `<div class="empty">All bypassed.</div>`}</div>
          ${doneIps.length ? `<div class="card"><div class="card-h">Complete<span class="r">${doneIps.length}</span></div>
            ${doneIps.map((x) => ipRow(x, true)).join("")}<div class="hint">Uncheck to move it back up.</div></div>` : ""}`
        : `
          <div class="statline">${doneDl.length} of ${plan.steps.length} downloaded${nextLv ? ` · next: Level ${nextLv}` : " · done"}</div>
          <div class="card"><div class="card-h">To download<span class="r">level by level</span></div>
            ${todoDl.length ? byLevel(todoDl, false) : `<div class="empty">All downloaded.</div>`}</div>
          ${doneDl.length ? `<div class="card"><div class="card-h">Complete<span class="r">${doneDl.length}</span></div>
            ${byLevel(doneDl, true)}<div class="hint">Uncheck to move it back up.</div></div>` : ""}`}`;

      $$("[data-copy]", main).forEach((b) => (b.onclick = () => G().copy(b.dataset.copy)));
      $$("[data-side]", main).forEach((b) => (b.onclick = () => { side = b.dataset.side; keep(); draw(); }));
      const toggle = async (field, key) => {
        const set = new Set(row[field] || []);
        set.has(key) ? set.delete(key) : set.add(key);
        const prev = row[field];
        row = { ...row, [field]: [...set] };
        draw();
        try { await save({ goal: row.goal, bypass: row.bypass, plan: row.plan, [field]: row[field] }); }
        catch (err) { row = { ...row, [field]: prev }; draw(); toast(errMsg(err), true); }
      };
      $$("[data-bp]", main).forEach((b) => (b.onclick = () => toggle("bypass_done", b.dataset.bp)));
      $$("[data-dl]", main).forEach((b) => (b.onclick = () => toggle("dl_done", b.dataset.dl)));
      const fb = $("[data-fill]", main);
      if (fb) fb.onclick = async () => {
        const map = new Map(fill.map((s) => [sk(s.k, s.l), s]));
        const plan2 = { ...plan, steps: plan.steps.map((s) => map.get(sk(s.k, s.l)) || s) };
        try { await save({ goal: row.goal, bypass: row.bypass, plan: plan2 }); row = { ...row, plan: plan2, updated_at: new Date().toISOString() }; toast(`Added ${fill.length} step${fill.length === 1 ? "" : "s"}`); draw(); }
        catch (err) { toast(errMsg(err), true); }
      };
      $("[data-rebuild]", main).onsubmit = async (e) => {
        e.preventDefault();
        const v = readInputs(e.target);
        if (!v) return;
        if (!(await confirmBox({ title: "Rebuild the plan?", body: "Makes fresh picks from all saved IPs. Your checkmarks stay on any IPs and levels that are still in the new plan.", ok: "Rebuild" }))) return;
        const plan2 = makePlan(kind, v.goal, v.bypass, targets);
        try { await save({ goal: v.goal, bypass: v.bypass, plan: plan2 }); row = { ...row, goal: v.goal, bypass: v.bypass, plan: plan2, updated_at: new Date().toISOString() }; toast("Plan rebuilt"); draw(); }
        catch (err) { toast(errMsg(err), true); }
      };
    };
    draw();
  };
}
PAGES.rplan = plannerPage("fw");
PAGES.dplan = plannerPage("direct");
})();
