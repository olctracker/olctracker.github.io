/* =========================================================
   OLC Database — crew data pages (stage 3)
   Lookup · Software · Target detail · Inactive spam list
   All values here are in-game Hack Ex 2 data entered by crew members.
   ========================================================= */
(() => {
"use strict";
const O = () => window.OLC;              // helpers from app.js (ready before any page renders)
const PAGES = (window.OLC_PAGES = window.OLC_PAGES || {});

/* ---------- the 10 tracked in-game programs (Keygen is never tracked) ---------- */
const PROGRAMS = [
  { key: "antivirus", name: "Antivirus" },
  { key: "spam", name: "Spam" },
  { key: "rootkit", name: "Rootkit" },
  { key: "firewall", name: "Firewall" },
  { key: "bypasser", name: "Bypasser" },
  { key: "password_cracker", name: "Password Cracker" },
  { key: "password_encryptor", name: "Password Encryptor" },
  { key: "proxy", name: "Proxy" },
  { key: "trace", name: "Trace" },
  { key: "siphon", name: "Siphon" }
];

/* ---------- small icons used on these pages ---------- */
const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const IC = {
  copy: svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 012-2h8"/>'),
  chev: svg('<path d="M9 6l6 6-6 6"/>'),
  back: svg('<path d="M15 6l-6 6 6 6"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  paste: svg('<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h3"/>'),
  keys: svg('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h.01M12 8h.01M16 8h.01M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="M21 21l-5-5"/>')
};

/* ---------- formatting helpers ---------- */
const isFullIp = (s) => {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(s || "").trim());
  return !!m && m.slice(1).every((n) => Number(n) <= 255);
};
const tidyIp = (s) => String(s || "").replace(/\s+/g, "").replace(/,/g, ".");
const tidyTerm = (s) => String(s || "").trim().replace(/[^A-Za-z0-9._-]/g, "");
const dash = (v) => (v === null || v === undefined || v === "" ? "—" : v);
const ipHref = (ip) => `#/ip/${encodeURIComponent(ip)}`;
function ipText(ip) {
  const e = O().esc;
  return isFullIp(ip) ? `<a class="mono" href="${ipHref(ip)}">${e(ip)}</a>` : `<span class="mono">${e(ip)}</span>`;
}
function badges(t) {
  const e = O().esc;
  if (!t) return `<span class="badge">not saved</span>`;
  let h = `<span class="badge st-${e(t.status)}">${e(t.status)}</span>`;
  if (t.scrambled) h += ` <span class="badge st-scr">scrambled</span>`;
  if (t.in_pool) h += ` <span class="badge st-pool">spam list</span>`;
  return h;
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); O().toast(`Copied ${text}`); return; } catch (e) {}
  const ta = document.createElement("textarea");
  ta.value = text; ta.style.cssText = "position:fixed;opacity:0";
  document.body.appendChild(ta); ta.select();
  try { document.execCommand("copy"); O().toast(`Copied ${text}`); } catch (e) { O().toast("Couldn't copy", true); }
  ta.remove();
}

/* ---------- software-screen paste reader ----------
   Finds each known program name, then the "LVL n" line that follows it.
   Ignores descriptions, +/- change numbers, repeated names and Keygen.
   Programs missing from the paste are simply not returned. */
function readSoftwarePaste(text) {
  const byName = new Map(PROGRAMS.map((p) => [p.name.toLowerCase(), p.key]));
  byName.set("keygen", null);                 // recognised, never stored
  const levels = {};
  let current;                                 // undefined = no program yet
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim().replace(/\s+/g, " ").toLowerCase();
    if (!line) continue;
    if (byName.has(line)) { current = byName.get(line); continue; }
    const inline = /^([a-z ]+?)\s*[:\-]?\s+lv?l?\.?\s*(\d{1,4})$/.exec(line);
    if (inline && byName.has(inline[1])) {
      const k = byName.get(inline[1]);
      if (k && !(k in levels)) levels[k] = Number(inline[2]);
      current = undefined;
      continue;
    }
    const lvl = /^lv?l?\.?\s*(\d{1,4})$/.exec(line);
    if (lvl) {
      if (current && !(current in levels)) levels[current] = Number(lvl[1]);
      current = undefined;
    }
  }
  return levels;
}
window.OLC_GAME_TEST = { readSoftwarePaste, isFullIp };

/* ---------- data actions ---------- */
async function upsertTarget(row) {
  const { error } = await O().sb.from("targets").upsert(row, { onConflict: "ip" });
  if (error) throw error;
}

async function askScrambled(ip) {
  const ok = await O().confirmBox({
    title: `Mark ${ip} as scrambled?`,
    body: "The player changed their in-game IP. It stays searchable with a Scrambled tag and is never blocked. Only a Mod can undo this.",
    ok: "Mark scrambled", danger: true
  });
  if (!ok) return false;
  try { await upsertTarget({ ip, scrambled: true }); O().toast("Marked scrambled"); return true; }
  catch (e) { O().toast(O().errMsg(e), true); return false; }
}

function askIncorrect(ip) {
  const { modal, esc, $, sb, toast, errMsg } = O();
  return new Promise((done) => {
    modal(`<h3>Flag ${esc(ip)} as incorrect?</h3>
      <p>A Mod will review it. Add a note about what looks wrong.</p>
      <textarea class="input" maxlength="300" placeholder="e.g. Firewall is 12 now, not 4"></textarea>
      <div class="btns" style="margin-top:12px"><button class="btn" data-no>Cancel</button><button class="btn danger" data-yes>Send flag</button></div>`,
    (w, close) => {
      $("[data-no]", w).onclick = () => { close(); done(false); };
      $("[data-yes]", w).onclick = async () => {
        const note = $("textarea", w).value.trim() || null;
        const { error } = await sb.from("flags").insert({ ip, kind: "incorrect", note });
        close();
        if (error) { toast(errMsg(error), true); return done(false); }
        toast("Flag sent to Mods"); done(true);
      };
    });
  });
}

/* ---------- keypad: steps through the 10 programs ----------
   Enter saves the typed number and moves on; Enter with nothing typed skips.
   Clear removes a level. Done (or reaching the end) saves everything. */
function keypadDialog(ip, target, startAt = 0) {
  const { modal, $, $$, toast, errMsg } = O();
  return new Promise((done) => {
    const changes = {};
    let i = startAt, typed = "";
    const shown = (k) => (k in changes ? changes[k] : target ? target[k] : null);
    modal(`<div class="kp">
        <div class="row"><div class="grow"><div class="tiny muted mono" data-step></div><h3 data-name style="margin:2px 0 0"></h3></div>
          <button class="btn sm primary" data-act="done">Done</button></div>
        <div class="kp-display"><span data-typed></span><span class="kp-cur" data-cur></span></div>
        <div class="kp-keys">
          ${[1,2,3,4,5,6,7,8,9].map((n) => `<button data-d="${n}">${n}</button>`).join("")}
          <button class="kp-alt" data-act="clear">Clear</button><button data-d="0">0</button><button class="kp-alt" data-act="del">⌫</button>
        </div>
        <div class="kp-nav"><button class="btn" data-act="prev">${IC.back} Back</button><button class="btn primary" data-act="next">Enter ${IC.chev}</button></div>
        <div class="kp-dots" data-dots></div>
      </div>`,
    (w, close) => {
      const paint = () => {
        const p = PROGRAMS[i], v = shown(p.key);
        $("[data-step]", w).textContent = `${ip} · ${i + 1} of ${PROGRAMS.length}`;
        $("[data-name]", w).textContent = p.name;
        $("[data-typed]", w).textContent = typed || (v === null || v === undefined ? "—" : String(v));
        $("[data-typed]", w).classList.toggle("dim", !typed);
        $("[data-cur]", w).textContent = typed ? `was ${dash(v)}` : (p.key in changes ? "changed" : "saved");
        $("[data-dots]", w).innerHTML = PROGRAMS.map((q, n) =>
          `<i class="${n === i ? "on" : ""} ${q.key in changes ? "set" : ""}"></i>`).join("");
      };
      const finish = async () => {
        document.removeEventListener("keydown", onKey);
        close();
        if (!Object.keys(changes).length) return done(false);
        try { await upsertTarget({ ip, ...changes }); toast("Software saved"); done(true); }
        catch (e) { toast(errMsg(e), true); done(false); }
      };
      const next = () => {
        if (typed) changes[PROGRAMS[i].key] = Number(typed);
        typed = "";
        if (i === PROGRAMS.length - 1) return finish();
        i++; paint();
      };
      const act = (a) => {
        if (a === "next") next();
        else if (a === "prev") { typed = ""; if (i > 0) i--; paint(); }
        else if (a === "del") { typed = typed.slice(0, -1); paint(); }
        else if (a === "clear") { typed = ""; changes[PROGRAMS[i].key] = null; next(); }
        else if (a === "done") { if (typed) changes[PROGRAMS[i].key] = Number(typed); finish(); }
      };
      const digit = (d) => { if (typed.length < 4) { typed = (typed + d).replace(/^0+(?=\d)/, ""); paint(); } };
      $$("[data-d]", w).forEach((b) => (b.onclick = () => digit(b.dataset.d)));
      $$("[data-act]", w).forEach((b) => (b.onclick = () => act(b.dataset.act)));
      const onKey = (e) => {
        if (/^\d$/.test(e.key)) digit(e.key);
        else if (e.key === "Enter") { e.preventDefault(); act("next"); }
        else if (e.key === "Backspace") act("del");
        else if (e.key === "Escape") act("done");
      };
      document.addEventListener("keydown", onKey);
      paint();
    }, { sticky: true });
  });
}

/* ---------- paste dialog with live preview ---------- */
function pasteDialog(ip, target) {
  const { modal, $, esc, toast, errMsg } = O();
  return new Promise((done) => {
    modal(`<h3>Paste software</h3>
      <p>Copy the player's software screen in the game and paste it here. Only the levels are kept.</p>
      <textarea class="input mono" rows="6" placeholder="Antivirus&#10;Scans and removes viruses…&#10;LVL 34&#10;…"></textarea>
      <div data-prev style="margin-top:12px"></div>
      <div class="btns" style="margin-top:12px"><button class="btn" data-no>Cancel</button><button class="btn primary" data-yes disabled>Save</button></div>`,
    (w, close) => {
      const ta = $("textarea", w);
      let found = {};
      const preview = () => {
        found = readSoftwarePaste(ta.value);
        const n = Object.keys(found).length;
        $("[data-yes]", w).disabled = !n;
        $("[data-prev]", w).innerHTML = !ta.value.trim() ? "" : `
          <div class="tiny mono muted" style="margin-bottom:6px">FOUND ${n} OF ${PROGRAMS.length}</div>
          <div class="sw-grid">${PROGRAMS.map((p) => {
            const has = p.key in found, old = target ? target[p.key] : null;
            return `<div class="sw-tile ${has ? "" : "miss"}"><span>${esc(p.name)}</span>
              <b>${has ? found[p.key] : dash(old)}</b><em>${has ? (old != null && old !== found[p.key] ? `was ${old}` : "new") : "kept"}</em></div>`;
          }).join("")}</div>`;
      };
      ta.addEventListener("input", preview);
      setTimeout(() => ta.focus(), 60);
      $("[data-no]", w).onclick = () => { close(); done(false); };
      $("[data-yes]", w).onclick = async () => {
        close();
        try { await upsertTarget({ ip, ...found }); toast(`Saved ${Object.keys(found).length} levels`); done(true); }
        catch (e) { toast(errMsg(e), true); done(false); }
      };
    });
  });
}

/* ---------- small number prompt (player level) ---------- */
function numberDialog(title, value) {
  const { modal, esc, $ } = O();
  return new Promise((done) => {
    modal(`<h3>${esc(title)}</h3>
      <input class="input" inputmode="numeric" pattern="[0-9]*" maxlength="4" value="${esc(value ?? "")}">
      <div class="err"></div>
      <div class="btns"><button class="btn" data-no>Cancel</button><button class="btn primary" data-yes>Save</button></div>`,
    (w, close) => {
      const inp = $("input", w);
      setTimeout(() => { inp.focus(); inp.select(); }, 60);
      $("[data-no]", w).onclick = () => { close(); done(undefined); };
      $("[data-yes]", w).onclick = () => {
        const v = inp.value.trim();
        if (v && !/^\d{1,4}$/.test(v)) { $(".err", w).textContent = "Numbers only"; return; }
        close(); done(v === "" ? null : Number(v));
      };
    });
  });
}

/* =========================================================
   TARGET PAGE  (#/ip/<ip>)
   ========================================================= */
PAGES.ip = async function pageTarget(main, ip) {
  const { sb, esc, $, $$, toast, errMsg, isMod, render, fmtDateTime } = O();
  ip = tidyIp(ip);
  if (!isFullIp(ip)) { main.innerHTML = `<div class="card"><div class="card-h">Target</div><p>That isn't a full IP.</p></div>`; return; }

  const [tR, curR, prevR] = await Promise.all([
    sb.from("targets").select("*").eq("ip", ip).maybeSingle(),
    sb.from("wallets").select("*").eq("ip", ip),
    sb.from("wallets").select("*").contains("previous_ips", [ip])
  ]);
  const t = tR.data, cur = curR.data || [], prev = prevR.data || [];
  const known = t ? PROGRAMS.filter((p) => t[p.key] !== null && t[p.key] !== undefined).length : 0;
  const mod = isMod();
  const canSetStatus = true;

  main.innerHTML = `
    <a class="back-link" href="javascript:history.back()">${IC.back} Back</a>

    <div class="card accent">
      <div class="row">
        <div class="grow"><div class="tiny mono muted">IP</div><div class="ip-big mono">${esc(ip)}</div></div>
        <button class="icon-btn" data-copy aria-label="Copy IP">${IC.copy}</button>
      </div>
      <div style="margin:8px 0 14px">${badges(t)}</div>
      <div class="stats">
        <button class="stat" data-edit-level><div class="k">Player level</div><div class="v">${dash(t?.player_level)}</div></button>
        <div class="stat"><div class="k">Firewall</div><div class="v">${dash(t?.firewall)}</div></div>
        <div class="stat"><div class="k">Software</div><div class="v">${known}/10</div></div>
      </div>
    </div>

    ${!t ? `<div class="card"><div class="card-h">Not saved yet</div>
      <p class="small muted" style="margin-top:0">This IP isn't in the crew database. Save it to start tracking.</p>
      <button class="btn primary block" data-add>${IC.plus} Save this IP</button></div>` : ""}

    ${t ? `<div class="card">
      <div class="card-h">Status</div>
      ${canSetStatus ? `<div class="seg" style="margin:0;grid-template-columns:1fr 1fr 1fr">
          ${["unknown", "active", "inactive"].map((s) => `<button data-status="${s}" class="${t.status === s ? "on" : ""}">${s[0].toUpperCase() + s.slice(1)}</button>`).join("")}</div>
`
        : `<div class="row"><span class="badge st-${esc(t.status)}">${esc(t.status)}</span><span class="small muted grow">Only Mods can change a known status. Wrong? Flag it below.</span></div>`}
    </div>` : ""}

    <div class="card">
      <div class="card-h">Software<span class="r">${known} of 10</span></div>
      <div class="sw-grid">${PROGRAMS.map((p, n) => `
        <button class="sw-tile ${t && t[p.key] != null ? "" : "miss"}" data-kp="${n}">
          <span>${esc(p.name)}</span><b>${dash(t?.[p.key])}</b></button>`).join("")}</div>
      <div class="row" style="margin-top:12px;gap:8px">
        <button class="btn grow" data-keypad>${IC.keys} Enter levels</button>
        <button class="btn primary grow" data-paste>${IC.paste} Paste</button>
      </div>
    </div>

    <div class="card">
      <div class="card-h">Wallet IDs</div>
      ${cur.length ? `<ul class="list">${cur.map((w) => `<li><span class="mono grow">${esc(w.wallet)}</span>
          <button class="icon-btn" data-copyw="${esc(w.wallet)}" aria-label="Copy wallet">${IC.copy}</button></li>`).join("")}</ul>`
        : `<div class="empty">No wallet linked to this IP yet.</div>`}
      ${prev.length ? `<div class="tiny mono muted" style="margin-top:12px">USED THIS IP BEFORE</div>
        <ul class="list">${prev.map((w) => `<li><span class="mono grow">${esc(w.wallet)}</span>
          <span class="small muted">now ${w.ip ? ipText(w.ip) : "hidden"}</span></li>`).join("")}</ul>` : ""}
    </div>

    ${t ? `<div class="card">
      <div class="card-h">Inactive spam list</div>
      ${t.in_pool
        ? `<div class="row"><span class="grow small">On the list${t.pool_added_by ? `, added by <b>${esc(t.pool_added_by)}</b>` : ""}.</span>
           ${mod ? `<button class="btn sm danger" data-pool="off">Remove</button>` : ""}</div>`
        : `<div class="row"><span class="grow small muted">Not on the list.</span><button class="btn sm primary" data-pool="on">Add to list</button></div>`}
    </div>` : ""}

    <div class="card">
      <div class="card-h">Report a problem</div>
      <div class="row" style="gap:8px">
        ${t?.scrambled ? "" : `<button class="btn grow" data-scr>Mark scrambled</button>`}
        <button class="btn danger grow" data-inc>Flag incorrect</button>
      </div>
      ${t?.scrambled ? `<div class="hint">Marked scrambled${t.scrambled_by ? ` by ${esc(t.scrambled_by)}` : ""}${t.scrambled_at ? `, ${fmtDateTime(t.scrambled_at)}` : ""}.</div>` : ""}
      ${t?.scrambled && mod ? `<button class="btn sm ghost" data-unscr style="margin-top:8px">Undo scrambled</button>` : ""}
    </div>

    ${t ? `<div class="modlog">
      <div class="tiny mono muted">LAST MODIFIED</div>
      ${PROGRAMS.filter((p) => t.sw_meta && t.sw_meta[p.key]).map((p) =>
        `<div>${esc(p.name)} — ${esc(t.sw_meta[p.key].by)}, ${fmtDateTime(t.sw_meta[p.key].at)}</div>`).join("") || `<div>No software entered yet.</div>`}
      <div>Added by ${esc(t.created_by || "—")}, ${fmtDateTime(t.created_at)} · updated by ${esc(t.updated_by || "—")}, ${fmtDateTime(t.updated_at)}</div>
    </div>` : ""}`;

  const refresh = () => render();
  $("[data-copy]", main).onclick = () => copy(ip);
  $$("[data-copyw]", main).forEach((b) => (b.onclick = () => copy(b.dataset.copyw)));
  $("[data-add]", main) && ($("[data-add]", main).onclick = () => addIp(ip));
  $("[data-edit-level]", main).onclick = async () => {
    const v = await numberDialog("Player level", t?.player_level);
    if (v === undefined) return;
    try { await upsertTarget({ ip, player_level: v }); toast("Level saved"); refresh(); } catch (e) { toast(errMsg(e), true); }
  };
  $$("[data-status]", main).forEach((b) => (b.onclick = async () => {
    try { await upsertTarget({ ip, status: b.dataset.status }); toast("Status saved"); refresh(); } catch (e) { toast(errMsg(e), true); }
  }));
  $$("[data-kp]", main).forEach((b) => (b.onclick = async () => { if (await keypadDialog(ip, t, Number(b.dataset.kp))) refresh(); }));
  $("[data-keypad]", main).onclick = async () => { if (await keypadDialog(ip, t, 0)) refresh(); };
  $("[data-paste]", main).onclick = async () => { if (await pasteDialog(ip, t)) refresh(); };
  $$("[data-pool]", main).forEach((b) => (b.onclick = async () => {
    try { await upsertTarget({ ip, in_pool: b.dataset.pool === "on" }); toast(b.dataset.pool === "on" ? "Added to spam list" : "Removed from spam list"); refresh(); }
    catch (e) { toast(errMsg(e), true); }
  }));
  $("[data-scr]", main) && ($("[data-scr]", main).onclick = async () => { if (await askScrambled(ip)) refresh(); });
  $("[data-unscr]", main) && ($("[data-unscr]", main).onclick = async () => {
    try { await upsertTarget({ ip, scrambled: false }); toast("Scrambled removed"); refresh(); } catch (e) { toast(errMsg(e), true); }
  });
  $("[data-inc]", main).onclick = () => askIncorrect(ip);
};

/* ---------- reusable list row for an IP ---------- */
function targetRow(t, extra = "") {
  const { esc } = O();
  return `<li class="tap" data-goto="${esc(t.ip)}">
    <div class="grow"><div class="mono ip-row">${esc(t.ip)}</div>
      <div class="tiny muted">LV ${dash(t.player_level)} · FW ${dash(t.firewall)}</div>${extra}</div>
    <div class="row-badges">${badges(t)}</div>${IC.chev}</li>`;
}
function bindRows(root) {
  O().$$("[data-goto]", root).forEach((li) => (li.onclick = () => O().go("ip/" + encodeURIComponent(li.dataset.goto))));
}

/* =========================================================
   SOFTWARE PAGE
   ========================================================= */
PAGES.software = async function pageSoftware(main) {
  const { sb, esc, $, toast, errMsg } = O();
  const last = (() => { try { return JSON.parse(sessionStorage.getItem("olc-sw-search") || "{}"); } catch (e) { return {}; } })();

  main.innerHTML = `
    <div class="card">
      <div class="card-h">Find software</div>
      <form data-search>
        <div class="row" style="gap:8px;align-items:flex-end">
          <label class="f grow" style="margin:0"><span>Program</span><select class="input" name="prog">
            <option value="all">All programs</option>
            ${PROGRAMS.map((p) => `<option value="${p.key}" ${last.prog === p.key ? "selected" : ""}>${esc(p.name)}</option>`).join("")}
          </select></label>
          <label class="f" style="margin:0;width:92px"><span>Level</span><input class="input" name="lvl" inputmode="numeric" pattern="[0-9]*" maxlength="4" value="${esc(last.lvl || "")}" placeholder="5"></label>
        </div>
        <button class="btn primary block" type="submit" style="margin-top:12px">${IC.search} Search</button>
      </form>
      <div class="hint">All programs ranks IPs by how many of their 10 programs are at that level.</div>
      <div data-results style="margin-top:12px"></div>
    </div>

    <div class="card">
      <div class="card-h">Open or add an IP</div>
      <form data-open class="row" style="gap:8px">
        <input class="input mono grow" name="ip" inputmode="decimal" autocomplete="off" placeholder="123.45.67.89">
        <button class="btn primary" type="submit">Open</button>
      </form>
      <button class="btn block ghost" data-add style="margin-top:10px">${IC.plus} Add IP</button>
    </div>

    <div class="card">
      <div class="card-h">Recently updated</div>
      <ul class="list" data-recent><li class="empty">Loading…</li></ul>
    </div>`;

  const results = $("[data-results]", main);
  const search = async (prog, lvl) => {
    sessionStorage.setItem("olc-sw-search", JSON.stringify({ prog, lvl }));
    results.innerHTML = `<div class="empty">Searching…</div>`;
    const n = Number(lvl);
    let q = sb.from("targets").select("*");
    q = prog === "all" ? q.or(PROGRAMS.map((p) => `${p.key}.eq.${n}`).join(",")) : q.eq(prog, n);
    const { data, error } = await q.limit(300);
    if (error) { results.innerHTML = `<div class="err">${esc(errMsg(error))}</div>`; return; }
    let rows = (data || []).map((t) => ({ t, hits: PROGRAMS.filter((p) => t[p.key] === n) }));
    rows.sort((a, b) => (a.t.scrambled - b.t.scrambled) || (b.hits.length - a.hits.length) ||
      ((a.t.status === "inactive" ? 0 : 1) - (b.t.status === "inactive" ? 0 : 1)));
    if (!rows.length) { results.innerHTML = `<div class="empty">No IPs with ${prog === "all" ? "any program" : esc(PROGRAMS.find((p) => p.key === prog).name)} at level ${n}.</div>`; return; }
    rows = rows.slice(0, 60);
    results.innerHTML = `<div class="tiny mono muted" style="margin-bottom:4px">${rows.length} RESULT${rows.length === 1 ? "" : "S"}</div>
      <ul class="list">${rows.map(({ t, hits }) => targetRow(t, prog === "all"
        ? `<div class="tiny"><b class="hit">${hits.length}/10 at LV ${n}</b> <span class="hits">· ${hits.map((h) => esc(h.name)).join(", ")}</span></div>` : "")).join("")}</ul>`;
    bindRows(results);
  };
  $("[data-search]", main).onsubmit = (e) => {
    e.preventDefault();
    const f = e.target;
    if (!/^\d{1,4}$/.test(f.lvl.value.trim())) return toast("Enter a level number", true);
    search(f.prog.value, f.lvl.value.trim());
  };
  if (last.prog && last.lvl) search(last.prog, last.lvl);

  $("[data-open]", main).onsubmit = (e) => {
    e.preventDefault();
    const ip = tidyIp(e.target.ip.value);
    if (!isFullIp(ip)) return toast("Enter a full IP like 123.45.67.89", true);
    O().go("ip/" + encodeURIComponent(ip));
  };
  $("[data-add]", main).onclick = () => addIp();

  const { data: recent } = await sb.from("targets").select("*").order("updated_at", { ascending: false }).limit(15);
  const ul = $("[data-recent]", main);
  if (!ul) return;
  ul.innerHTML = (recent || []).length ? recent.map((t) => targetRow(t)).join("") : `<li class="empty">Nothing saved yet.</li>`;
  bindRows(ul);
};

/* =========================================================
   LOOKUP PAGE — wallet IDs and IPs
   ========================================================= */
function walletCard(w, tmap) {
  const { esc, fmtDateTime } = O();
  const t = w.ip ? tmap[w.ip] : null;
  const prev = w.previous_ips || [];
  return `<div class="card wallet">
    <div class="row">
      <div class="grow"><div class="tiny mono muted">WALLET ID</div><div class="mono wallet-id">${esc(w.wallet)}</div></div>
      <button class="icon-btn" data-copy="${esc(w.wallet)}" aria-label="Copy wallet">${IC.copy}</button>
    </div>
    <div class="kv"><span>Current IP</span><div>${w.ip ? ipText(w.ip) : `<span class="muted">hidden (proxied)</span>`}</div></div>
    ${w.ip && isFullIp(w.ip) ? `<div class="kv"><span>Status</span><div>${badges(t)}</div></div>
      <div class="kv"><span>Level · FW</span><div class="mono">LV ${dash(t?.player_level)} · FW ${dash(t?.firewall)}</div></div>` : ""}
    ${prev.length ? `<details><summary>Previous IPs (${prev.length})</summary>
      <ul class="list">${prev.map((p) => `<li>${ipText(p)}</li>`).join("")}</ul></details>` : ""}
    ${w.ip && isFullIp(w.ip) ? `<div class="row" style="gap:8px;margin-top:12px">
      ${t?.scrambled ? "" : `<button class="btn sm" data-scr="${esc(w.ip)}">Mark IP scrambled</button>`}
      <a class="btn sm primary" href="${ipHref(w.ip)}">Open IP ${IC.chev}</a></div>` : ""}
    <div class="tiny muted" style="margin-top:10px">Updated by ${esc(w.updated_by || "—")}, ${fmtDateTime(w.updated_at)}</div>
  </div>`;
}

PAGES.lookup = async function pageLookup(main) {
  const { sb, esc, $, $$, render } = O();
  const saved = sessionStorage.getItem("olc-lookup") || "";
  main.innerHTML = `
    <form class="searchbar" data-form>
      ${IC.search}<input class="input" type="search" name="q" placeholder="Wallet ID or IP" autocomplete="off" autocapitalize="none" spellcheck="false" value="${esc(saved)}">
    </form>
    <button class="btn block ghost" data-add style="margin-bottom:14px">${IC.plus} Add IP</button>
    <div data-out></div>`;
  const out = $("[data-out]", main), input = $("input", main);

  const show = async (raw) => {
    const term = tidyTerm(raw);
    sessionStorage.setItem("olc-lookup", term);
    out.innerHTML = `<div class="loading" style="min-height:120px">Searching</div>`;
    let wallets = [], ips = [];
    if (!term) {
      wallets = (await sb.from("wallets").select("*").order("updated_at", { ascending: false }).limit(12)).data || [];
    } else {
      const looksIp = /^[\dxX.]+$/.test(term);
      const reqs = [sb.from("wallets").select("*").or(`wallet.ilike.*${term}*,ip.ilike.*${term}*`).limit(25)];
      if (isFullIp(term)) reqs.push(sb.from("wallets").select("*").contains("previous_ips", [term]).limit(25));
      if (looksIp) reqs.push(sb.from("targets").select("*").ilike("ip", `%${term}%`).limit(25));
      const res = await Promise.all(reqs);
      const seen = new Set();
      res.slice(0, isFullIp(term) ? 2 : 1).forEach((r) => (r.data || []).forEach((w) => { if (!seen.has(w.wallet)) { seen.add(w.wallet); wallets.push(w); } }));
      if (looksIp) ips = res[res.length - 1].data || [];
    }
    const full = [...new Set(wallets.map((w) => w.ip).filter(isFullIp))];
    const tmap = {};
    if (full.length) ((await sb.from("targets").select("*").in("ip", full)).data || []).forEach((t) => (tmap[t.ip] = t));

    out.innerHTML = `
      ${!term ? `<div class="page-title">Recently updated wallets</div>` : ""}
      ${wallets.map((w) => walletCard(w, tmap)).join("")}
      ${ips.length ? `<div class="card"><div class="card-h">IPs<span class="r">${ips.length}</span></div>
        <ul class="list">${ips.map((t) => targetRow(t)).join("")}</ul></div>` : ""}
      ${term && !wallets.length && !ips.length ? `<div class="card"><div class="empty">Nothing found for <span class="mono">${esc(term)}</span>.</div>
        ${isFullIp(term) ? `<button class="btn primary block" data-addthis>${IC.plus} Add ${esc(term)}</button>` : ""}</div>` : ""}
      ${!term && !wallets.length ? `<div class="card"><div class="empty">No wallets yet. They fill in as crew members paste logs (stage 4).</div></div>` : ""}`;
    $$("[data-copy]", out).forEach((b) => (b.onclick = () => copy(b.dataset.copy)));
    $$("[data-scr]", out).forEach((b) => (b.onclick = async () => { if (await askScrambled(b.dataset.scr)) show(input.value); }));
    bindRows(out);
    const addThis = $("[data-addthis]", out);
    if (addThis) addThis.onclick = () => addIp(term);
  };

  let timer;
  input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => show(input.value), 350); });
  $("[data-form]", main).onsubmit = (e) => { e.preventDefault(); clearTimeout(timer); input.blur(); show(input.value); };
  $("[data-add]", main).onclick = () => addIp();
  show(saved);
};

/* =========================================================
   SPAM PAGE — shared inactive spam list (slots arrive in stage 5)
   ========================================================= */
PAGES.spam = async function pageSpam(main) {
  const { sb, esc, $, $$, toast, errMsg, render } = O();
  const prefs = (() => { try { return JSON.parse(localStorage.getItem("olc-spam-filter") || "{}"); } catch (e) { return {}; } })();
  const f = { hideScr: prefs.hideScr !== false, lv25: !!prefs.lv25, inactiveOnly: prefs.inactiveOnly !== false };

  const { data, error } = await sb.from("targets").select("*").eq("in_pool", true).limit(1000);
  if (error) throw error;
  const all = (data || []).sort((a, b) =>
    ((a.firewall ?? 1e9) - (b.firewall ?? 1e9)) || ((b.player_level ?? 0) - (a.player_level ?? 0)));

  main.innerHTML = `
    <div data-slots><div class="loading" style="min-height:120px">Loading your slots</div></div>
    <div class="card">
      <div class="card-h">Add to inactive spam list</div>
      <form data-add>
        <label class="f"><span>IP</span><input class="input mono" name="ip" inputmode="decimal" autocomplete="off" placeholder="123.45.67.89"></label>
        <div class="row" style="gap:10px">
          <label class="f grow"><span>Firewall (FW)</span><input class="input" name="fw" inputmode="numeric" pattern="[0-9]*" maxlength="4" placeholder="4"></label>
          <label class="f grow"><span>Account level</span><input class="input" name="lv" inputmode="numeric" pattern="[0-9]*" maxlength="4" placeholder="30"></label>
        </div>
        <div class="err"></div>
        <button class="btn primary block" type="submit">${IC.plus} Add to list</button>
      </form>
    </div>

    <div class="card">
      <div class="card-h">Inactive spam list<span class="r" data-count></span></div>
      <div class="chips">
        <button class="chip ${f.inactiveOnly ? "on" : ""}" data-f="inactiveOnly">Inactive only</button>
        <button class="chip ${f.lv25 ? "on" : ""}" data-f="lv25">Level 25+</button>
        <button class="chip ${f.hideScr ? "on" : ""}" data-f="hideScr">Hide scrambled</button>
      </div>
      <div class="tiny muted" style="margin:8px 0 4px">Lowest firewall first.</div>
      <ul class="list" data-list></ul>
    </div>

`;

  const draw = () => {
    const rows = all.filter((t) => (!f.hideScr || !t.scrambled) && (!f.lv25 || (t.player_level ?? 0) >= 25)
      && (!f.inactiveOnly || t.status === "inactive"));
    $("[data-count]", main).textContent = `${rows.length} of ${all.length}`;
    $("[data-list]", main).innerHTML = rows.length
      ? rows.map((t) => `<li class="tap" data-goto="${esc(t.ip)}">
          <div class="fw-pill mono"><small>FW</small>${dash(t.firewall)}</div>
          <div class="grow"><div class="mono ip-row">${esc(t.ip)}</div>
            <div class="tiny muted">LV ${dash(t.player_level)}${t.pool_added_by ? ` · added by ${esc(t.pool_added_by)}` : ""}</div></div>
          ${t.status !== "inactive" || t.scrambled ? `<div class="row-badges">${badges({ ...t, in_pool: false })}</div>` : ""}
          <button class="icon-btn" data-copy="${esc(t.ip)}" aria-label="Copy IP">${IC.copy}</button></li>`).join("")
      : `<li class="empty">No IPs match these filters.</li>`;
    $$("[data-copy]", main).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); copy(b.dataset.copy); }));
    bindRows($("[data-list]", main));
  };
  $$("[data-f]", main).forEach((b) => (b.onclick = () => {
    f[b.dataset.f] = !f[b.dataset.f];
    b.classList.toggle("on", f[b.dataset.f]);
    try { localStorage.setItem("olc-spam-filter", JSON.stringify(f)); } catch (e) {}
    draw();
  }));
  draw();
  if (window.OLC_SLOTS) window.OLC_SLOTS.mountSpamSlots($("[data-slots]", main)).catch((e) => toast(errMsg(e), true));

  $("[data-add]", main).onsubmit = async (e) => {
    e.preventDefault();
    const form = e.target, err = $(".err", form);
    const ip = tidyIp(form.ip.value), fw = form.fw.value.trim(), lv = form.lv.value.trim();
    err.textContent = "";
    if (!isFullIp(ip)) return (err.textContent = "Enter a full IP like 123.45.67.89");
    if (!/^\d{1,4}$/.test(fw) || !/^\d{1,4}$/.test(lv)) return (err.textContent = "Firewall and account level must be numbers");
    try {
      await upsertTarget({ ip, status: "inactive", firewall: Number(fw), player_level: Number(lv), in_pool: true });
      const { data: t } = await sb.from("targets").select("status").eq("ip", ip).maybeSingle();
      toast(t && t.status === "active" ? "Added, but this IP is marked Active. Flag it if that's wrong." : "Added to spam list");
      render();
    } catch (ex) { err.textContent = errMsg(ex); }
  };
};

/* =========================================================
   ADD IP — one full screen  (#/add or #/add/<ip>)
   IP, wallet ID, status, player level and all 10 software
   levels, with a Paste option. If the IP is already saved, its
   known values are filled in and only changes are saved.
   ========================================================= */
const addIp = (ip) => O().go("add" + (ip ? "/" + encodeURIComponent(ip) : ""));

PAGES.add = async function pageAdd(main, prefill) {
  const { sb, esc, $, $$, toast, errMsg, isMod, btnBusy } = O();
  prefill = isFullIp(tidyIp(prefill)) ? tidyIp(prefill) : "";
  const numIn = (name, ph = "") =>
    `<input class="input mono" name="${name}" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off" placeholder="${ph}">`;

  main.innerHTML = `
    <a class="back-link" href="javascript:history.back()">${IC.back} Back</a>
    <form data-form autocomplete="off">
      <div class="card accent">
        <div class="card-h">Add IP</div>
        <label class="f"><span>IP</span><input class="input mono" name="ip" inputmode="decimal" placeholder="123.45.67.89" value="${esc(prefill)}"></label>
        <div data-known></div>
        <label class="f"><span>Wallet ID (optional)</span><input class="input mono" name="wallet" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="e.g. wasd...518c"></label>
        <div class="f"><span class="flabel">Status</span>
          <div class="seg" style="margin:0;grid-template-columns:1fr 1fr 1fr">
            <button type="button" data-st="unknown">Unknown</button><button type="button" data-st="active">Active</button><button type="button" data-st="inactive" class="on">Inactive</button></div>
          <div class="hint" data-st-hint></div></div>
        <label class="f" style="margin-top:12px"><span>Player level</span>${numIn("player_level", "e.g. 32")}</label>
      </div>

      <div class="card">
        <div class="card-h">Software<span class="r" data-swcount>0 of 10</span></div>
        <button type="button" class="btn block" data-paste style="margin-bottom:12px">${IC.paste} Paste software screen</button>
        <div data-pastebox hidden style="margin-bottom:12px">
          <textarea class="input mono" rows="5" placeholder="Antivirus&#10;Scans and removes viruses…&#10;LVL 34&#10;…"></textarea>
          <div class="tiny mono muted" data-pastemsg style="margin-top:6px"></div>
        </div>
        <div class="sw-form">${PROGRAMS.map((p) => `
          <label class="f" style="margin:0"><span>${esc(p.name)}</span>${numIn(p.key, "—")}</label>`).join("")}</div>
        <div class="hint">Leave a box empty if you don't know it.</div>
      </div>

      <div class="err" data-err></div>
      <button class="btn primary block" type="submit">${IC.plus} Save IP</button>
    </form>`;

  const f = $("[data-form]", main), errBox = $("[data-err]", main);
  let status = "inactive", existing = null, loadedFor = null;

  const setStatus = (s) => {
    status = s;
    $$("[data-st]", main).forEach((b) => b.classList.toggle("on", b.dataset.st === s));
  };
  const statusLocked = () => false;
  $$("[data-st]", main).forEach((b) => (b.onclick = () => { if (!statusLocked()) setStatus(b.dataset.st); }));

  const countSw = () => {
    const n = PROGRAMS.filter((p) => f[p.key].value.trim() !== "").length;
    $("[data-swcount]", main).textContent = `${n} of 10`;
  };
  PROGRAMS.forEach((p) => f[p.key].addEventListener("input", countSw));

  // If the IP is already saved, fill in what's known
  const checkIp = async () => {
    const ip = tidyIp(f.ip.value);
    const box = $("[data-known]", main);
    if (!isFullIp(ip)) { box.innerHTML = ""; existing = null; loadedFor = null; return; }
    if (ip === loadedFor) return;
    loadedFor = ip;
    const [tR, wR] = await Promise.all([
      sb.from("targets").select("*").eq("ip", ip).maybeSingle(),
      sb.from("wallets").select("wallet").eq("ip", ip).limit(3)
    ]);
    if (tidyIp(f.ip.value) !== ip) return;
    existing = tR.data || null;
    const ws = (wR.data || []).map((w) => w.wallet);
    if (existing) {
      ["player_level", ...PROGRAMS.map((p) => p.key)].forEach((k) => {
        if (f[k].value.trim() === "" && existing[k] != null) f[k].value = existing[k];
      });
      setStatus(existing.status || "unknown");
      if (!f.wallet.value.trim() && ws.length) f.wallet.value = ws[0];
      countSw();
    }
    box.innerHTML = existing
      ? `<div class="term small" style="margin:-4px 0 12px">&gt; Already saved. Known values are filled in; only changes are saved. <a href="${ipHref(ip)}">Open IP</a></div>`
      : "";
    $("[data-st-hint]", main).textContent = statusLocked() ? "Only a Mod can change a known status. Flag it on the IP page if it's wrong." : "";
  };
  f.ip.addEventListener("input", () => checkIp());
  if (prefill) checkIp(); else setTimeout(() => f.ip.focus(), 60);

  // Paste the software screen: fills the boxes
  const pbox = $("[data-pastebox]", main), pta = $("textarea", pbox);
  $("[data-paste]", main).onclick = () => { pbox.hidden = !pbox.hidden; if (!pbox.hidden) pta.focus(); };
  pta.addEventListener("input", () => {
    const found = readSoftwarePaste(pta.value);
    Object.entries(found).forEach(([k, v]) => (f[k].value = v));
    const n = Object.keys(found).length;
    $("[data-pastemsg]", main).textContent = pta.value.trim() ? `FILLED IN ${n} OF ${PROGRAMS.length}` : "";
    countSw();
  });

  f.onsubmit = async (e) => {
    e.preventDefault();
    errBox.textContent = "";
    const ip = tidyIp(f.ip.value);
    if (!isFullIp(ip)) return (errBox.textContent = "Enter a full IP like 123.45.67.89");
    if (loadedFor !== ip) await checkIp();
    const wallet = f.wallet.value.trim();
    if (wallet && /\s/.test(wallet)) return (errBox.textContent = "Wallet ID can't contain spaces");
    const row = { ip };
    for (const k of ["player_level", ...PROGRAMS.map((p) => p.key)]) {
      const v = f[k].value.trim();
      if (v === "") continue;
      if (!/^\d{1,4}$/.test(v)) return (errBox.textContent = "Levels must be numbers");
      if (!existing || Number(existing[k]) !== Number(v) || existing[k] == null) row[k] = Number(v);
    }
    if (!existing || (existing.status !== status && !statusLocked())) row.status = status;
    const btn = $("button[type=submit]", f);
    btnBusy(btn, true, "Saving…");
    try {
      if (!existing || Object.keys(row).length > 1) await upsertTarget(row);
      if (wallet) {
        const { error } = await sb.rpc("link_wallet", { p_wallet: wallet, p_ip: ip });
        if (error) throw error;
      }
      toast(existing ? "IP updated" : "IP saved");
      O().go("ip/" + encodeURIComponent(ip));
    } catch (ex) { btnBusy(btn, false); errBox.textContent = errMsg(ex); }
  };
};

/* shared with later page modules */
window.OLC_GAME = { IC, copy, isFullIp, ipText, badges, dash, tidyIp, PROGRAMS, upsertTarget, addIp };
})();
