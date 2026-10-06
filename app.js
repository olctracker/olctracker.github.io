/* =========================================================
   OLC Database — app
   ========================================================= */
(() => {
"use strict";

const CFG = window.OLC_CONFIG;
const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
});

/* ---------------- state ---------------- */
const S = {
  session: null,
  profile: null,
  settings: { app_name: "OLC Database", motd: "" },
  route: "home",
  pendingCount: 0,
  installPrompt: null,
  clockTimer: null
};

/* ---------------- helpers ---------------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const emailFor = (u) => `${u.trim().toLowerCase()}@${CFG.emailDomain}`;
const pwFor = (pin) => `olc#${pin}#pin`;
const isMod = () => S.profile && ["mod", "admin"].includes(S.profile.role);
const isAdmin = () => S.profile && S.profile.role === "admin";
const fmtDate = (d) => new Date(d).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
const fmtDateTime = (d) => new Date(d).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const logo = () => S.settings.logo_url || "icon-512.png";
const errMsg = (e) => (e && (e.message || e.error_description)) || "Something went wrong";

function timeLeft(to) {
  let s = Math.max(0, Math.floor((new Date(to) - Date.now()) / 1000));
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

function toast(msg, bad = false) {
  const t = document.createElement("div");
  t.className = "toast" + (bad ? " bad" : "");
  t.textContent = msg;
  $("#toasts").appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

function modal(html, onMount, opts = {}) {
  const wrap = document.createElement("div");
  wrap.className = "modal-wrap";
  wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  const close = () => wrap.remove();
  if (!opts.sticky) wrap.addEventListener("click", (e) => { if (e.target === wrap) close(); });
  document.body.appendChild(wrap);
  onMount && onMount(wrap, close);
  return close;
}

function confirmBox({ title, body = "", ok = "Confirm", danger = false }) {
  return new Promise((resolve) => {
    modal(`<h3>${esc(title)}</h3>${body ? `<p>${esc(body)}</p>` : ""}
      <div class="btns"><button class="btn" data-no>Cancel</button>
      <button class="btn ${danger ? "danger" : "primary"}" data-yes>${esc(ok)}</button></div>`,
      (w, close) => {
        $("[data-no]", w).onclick = () => { close(); resolve(false); };
        $("[data-yes]", w).onclick = () => { close(); resolve(true); };
      });
  });
}

function pinBox(title, body) {
  return new Promise((resolve) => {
    modal(`<h3>${esc(title)}</h3><p>${esc(body)}</p>
      <input class="input pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off" placeholder="••••">
      <div class="err"></div>
      <div class="btns"><button class="btn" data-no>Cancel</button><button class="btn primary" data-yes>Save</button></div>`,
      (w, close) => {
        const inp = $("input", w);
        setTimeout(() => inp.focus(), 50);
        $("[data-no]", w).onclick = () => { close(); resolve(null); };
        $("[data-yes]", w).onclick = () => {
          if (!/^\d{4}$/.test(inp.value)) { $(".err", w).textContent = "PIN must be 4 digits"; return; }
          close(); resolve(inp.value);
        };
      });
  });
}

function btnBusy(btn, busy, label) {
  if (!btn) return;
  if (busy) { btn.dataset.label = btn.innerHTML; btn.disabled = true; btn.textContent = label || "Working…"; }
  else { btn.disabled = false; btn.innerHTML = btn.dataset.label || btn.innerHTML; }
}

/* ---------------- icons ---------------- */
const I = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICON = {
  menu: I('<path d="M4 6h16M4 12h16M4 18h16"/>'),
  home: I('<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>'),
  log: I('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>'),
  victim: I('<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/><path d="M17 3l4 4M21 3l-4 4"/>'),
  crypto: I('<circle cx="12" cy="12" r="9"/><path d="M9 8h4.5a2 2 0 010 4H9h5a2 2 0 010 4H9V8zM11 6v2M11 16v2"/>'),
  lookup: I('<circle cx="11" cy="11" r="7"/><path d="M21 21l-5-5"/>'),
  software: I('<rect x="3" y="4" width="18" height="14" rx="2"/><path d="M7 9l3 2.5L7 14M12 14h5"/><path d="M8 21h8"/>'),
  spam: I('<path d="M4 7l8 6 8-6"/><rect x="3" y="5" width="18" height="14" rx="2"/>'),
  siphon: I('<path d="M12 3v8"/><path d="M8 7l4 4 4-4"/><path d="M5 14c0 4 3 7 7 7s7-3 7-7"/>'),
  leads: I('<path d="M12 21s-7-6.5-7-11a7 7 0 0114 0c0 4.5-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>'),
  mod: I('<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z"/><path d="M9 12l2 2 4-4"/>'),
  top: I('<path d="M8 21h8M12 17v4"/><path d="M7 4h10v5a5 5 0 01-10 0V4z"/><path d="M17 6h3v2a3 3 0 01-3 3M7 6H4v2a3 3 0 003 3"/>'),
  settings: I('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-1.8-.3 1.6 1.6 0 00-1 1.5V21a2 2 0 01-4 0v-.1a1.6 1.6 0 00-1-1.5 1.6 1.6 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00.3-1.8 1.6 1.6 0 00-1.5-1H3a2 2 0 010-4h.1a1.6 1.6 0 001.5-1 1.6 1.6 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.8.3H9a1.6 1.6 0 001-1.5V3a2 2 0 014 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8V9a1.6 1.6 0 001.5 1H21a2 2 0 010 4h-.1a1.6 1.6 0 00-1.5 1z"/>'),
  dots: I('<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>'),
  plus: I('<path d="M12 5v14M5 12h14"/>'),
  x: I('<path d="M6 6l12 12M18 6L6 18"/>'),
  check: I('<path d="M5 12l5 5 9-10"/>'),
  download: I('<path d="M12 4v11M7 10l5 5 5-5"/><path d="M5 20h14"/>'),
  build: I('<path d="M14 6l4 4M3 21l3-1 11-11-2-2L4 18l-1 3z"/>')
};

/* ---------------- routes ---------------- */
const NAV = [
  { sec: "Main" },
  { id: "home", label: "Home", icon: "home" },
  { sec: "Logs" },
  { id: "logs", label: "My Logs", icon: "log" },
  { id: "victim", label: "Victim Logs", icon: "victim" },
  { sec: "Tracking" },
  { id: "crypto", label: "Crypto", icon: "crypto" },
  { id: "lookup", label: "Lookup", icon: "lookup" },
  { id: "software", label: "Software", icon: "software" },
  { id: "spam", label: "Spam", icon: "spam" },
  { id: "siphon", label: "Siphon", icon: "siphon" },
  { id: "leads", label: "Leads", icon: "leads", soon: 6 },
  { sec: "Crew", modOnly: true },
  { id: "mod", label: "Mod Tools", icon: "mod", modOnly: true },
  { id: "top", label: "Server Top 25", icon: "top", adminOnly: true, soon: 7 },
  { sec: "You" },
  { id: "settings", label: "Settings", icon: "settings" }
];

const SOON_TEXT = {
  logs: ["Paste your own log", "Records visits, thefts, and who hit you", "Pairs IPs with wallet IDs automatically"],
  victim: ["Paste a victim's log", "Finds their targets and attackers", "Feeds the shared Leads list"],
  crypto: ["Today, this week, all time", "Your top 25 targets by total or average", "Cleanup checker for weak targets", "Proxied bucket and crypto stolen from you"],
  lookup: ["Search any wallet ID or IP", "Current and previous 5 IPs", "Flag scrambled or incorrect"],
  software: ["Paste or keypad entry for 10 programs", "Search a program at a level", "Search All at a level, best matches first"],
  spam: ["Paste your 64 spam slots", "Missing-slot check", "10 lowest-firewall suggestions", "Inactive spam list"],
  siphon: ["Paste your siphon list", "Level, %, amount and age per IP"],
  leads: ["IPs found in victim logs", "Amounts stolen both ways", "Copy, mark scrambled, or remove"],
  top: ["Top 25 across all members", "Crypto and siphon, day / week / all time"]
};

function go(route) {
  if (location.hash !== "#/" + route) location.hash = "#/" + route;
  else render();
}

function routeFromHash() {
  const parts = (location.hash.replace(/^#\/?/, "") || "home").split("?")[0].split("/");
  const r = parts[0];
  S.arg = parts[1] ? decodeURIComponent(parts[1]) : null;
  if (r === "ip" && S.arg) return "ip";
  const item = NAV.find((n) => n.id === r);
  if (!item) return "home";
  if (item.modOnly && !isMod()) return "home";
  if (item.adminOnly && !isAdmin()) return "home";
  return r;
}

/* ---------------- theme ---------------- */
const THEMES = [
  { id: "green", name: "Terminal Green", c: ["#050a07", "#34f08a", "#d6f5e2"] },
  { id: "amber", name: "Amber", c: ["#0a0703", "#ffb43d", "#ffe8c2"] },
  { id: "blue", name: "Cyber Blue", c: ["#04070f", "#33d6ff", "#dbe9ff"] },
  { id: "red", name: "Red Alert", c: ["#0b0405", "#ff4458", "#ffe0e2"] },
  { id: "light", name: "Light", c: ["#f3f6f4", "#0f9d58", "#0f2219"] }
];
function applyTheme(id) {
  const t = THEMES.find((x) => x.id === id) ? id : "green";
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem("olc-theme", t); } catch (e) {}
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = THEMES.find((x) => x.id === t).c[0];
}

/* ---------------- data ---------------- */
async function loadSettings() {
  const { data } = await sb.from("app_settings").select("*").eq("id", 1).maybeSingle();
  if (data) S.settings = data;
  document.title = S.settings.app_name;
}
async function loadProfile() {
  const uid = S.session?.user?.id;
  if (!uid) { S.profile = null; return; }
  const { data } = await sb.from("profiles").select("*").eq("id", uid).maybeSingle();
  S.profile = data || null;
  if (S.profile) applyTheme(S.profile.theme);
}
async function loadPendingCount() {
  if (!isMod()) { S.pendingCount = 0; return; }
  const [a, b] = await Promise.all([
    sb.from("profiles").select("id", { count: "exact", head: true }).eq("approved", false),
    sb.from("flags").select("id", { count: "exact", head: true }).eq("resolved", false)
  ]);
  S.pendingCount = (a.count || 0) + (b.count || 0);
}

/* =========================================================
   AUTH SCREENS
   ========================================================= */
function renderAuth(mode = "login", msg = "") {
  stopClock();
  document.body.innerHTML = `
  <div class="auth">
    <div class="hero">
      <img src="${esc(logo())}" alt="">
      <h1>${esc(S.settings.app_name)}<span class="cur">_</span></h1>
      <div class="sub">Crew tracker for Hack Ex 2</div>
    </div>
    <div class="seg">
      <button data-mode="login" class="${mode === "login" ? "on" : ""}">Log in</button>
      <button data-mode="signup" class="${mode === "signup" ? "on" : ""}">Create account</button>
    </div>
    <form class="card" id="authForm" autocomplete="on">
      ${mode === "signup" ? `<div class="term">&gt; New accounts need approval from a <b>Mod</b> or the <b>Admin</b> before they can see crew data.</div>` : ""}
      <label class="f"><span>Username</span>
        <input class="input" name="u" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" maxlength="20" required></label>
      <label class="f"><span>4-digit PIN</span>
        <input class="input pin" name="p" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4"
          autocomplete="${mode === "signup" ? "new-password" : "current-password"}" placeholder="••••" required></label>
      ${mode === "signup" ? `<label class="f"><span>Confirm PIN</span>
        <input class="input pin" name="p2" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="new-password" placeholder="••••" required></label>` : ""}
      <div class="err" id="authErr">${esc(msg)}</div>
      <button class="btn primary block" type="submit">${mode === "signup" ? "Create account" : "Log in"}</button>
      ${mode === "signup" ? `<div class="hint">3–20 characters: letters, numbers, dot, dash, underscore.</div>` : `<div class="hint">You'll stay logged in on this device until you log out.</div>`}
    </form>
    <div id="toasts" class="toasts"></div>
  </div>`;
  $$("[data-mode]").forEach((b) => (b.onclick = () => renderAuth(b.dataset.mode)));
  $("#authForm").onsubmit = (e) => { e.preventDefault(); mode === "signup" ? doSignup(e.target) : doLogin(e.target); };
}

async function doLogin(f) {
  const u = f.u.value.trim(), p = f.p.value, err = $("#authErr"), btn = $("button[type=submit]", f);
  err.textContent = "";
  if (!u) return (err.textContent = "Enter your username");
  if (!/^\d{4}$/.test(p)) return (err.textContent = "PIN must be 4 digits");
  btnBusy(btn, true, "Logging in…");
  try {
    const { data: locked } = await sb.rpc("login_check", { p_username: u });
    if (locked > 0) { err.textContent = `Too many wrong PINs. Try again in ${Math.ceil(locked / 60)} min.`; return; }
    const { data, error } = await sb.auth.signInWithPassword({ email: emailFor(u), password: pwFor(p) });
    if (error) {
      const { data: left } = await sb.rpc("login_failed", { p_username: u });
      err.textContent = left > 0 ? `Wrong username or PIN. ${left} ${left === 1 ? "try" : "tries"} left.` : "Too many wrong PINs. Locked for 15 minutes.";
      return;
    }
    S.session = data.session;
    sb.rpc("login_ok");
    await enter();
  } catch (e) { err.textContent = errMsg(e); }
  finally { btnBusy(btn, false); }
}

async function doSignup(f) {
  const u = f.u.value.trim(), p = f.p.value, p2 = f.p2.value, err = $("#authErr"), btn = $("button[type=submit]", f);
  err.textContent = "";
  if (!/^[A-Za-z0-9_.-]{3,20}$/.test(u)) return (err.textContent = "Username must be 3–20 letters, numbers, dot, dash or underscore");
  if (!/^\d{4}$/.test(p)) return (err.textContent = "PIN must be 4 digits");
  if (p !== p2) return (err.textContent = "PINs don't match");
  btnBusy(btn, true, "Creating…");
  try {
    const { error } = await sb.rpc("signup", { p_username: u, p_pin: p });
    if (error) { err.textContent = errMsg(error); return; }
    const { data, error: e2 } = await sb.auth.signInWithPassword({ email: emailFor(u), password: pwFor(p) });
    if (e2) { renderAuth("login", "Account created. Log in to continue."); return; }
    S.session = data.session;
    await enter();
  } catch (e) { err.textContent = errMsg(e); }
  finally { btnBusy(btn, false); }
}

function renderPending() {
  stopClock();
  document.body.innerHTML = `
  <div class="auth">
    <div class="hero"><img src="${esc(logo())}" alt=""><h1>Awaiting approval<span class="cur">_</span></h1></div>
    <div class="card">
      <div class="term">&gt; Account <b>${esc(S.profile.username)}</b> created.<br>&gt; A Mod or the Admin needs to approve it.<br>&gt; Status: <b>PENDING</b></div>
      <p class="muted small" style="margin-top:0">Let a Mod know you've signed up. Once approved, tap Check again.</p>
      <button class="btn primary block" id="recheck">Check again</button>
      <button class="btn ghost block" id="out" style="margin-top:8px">Log out</button>
    </div>
    <div id="toasts" class="toasts"></div>
  </div>`;
  $("#recheck").onclick = async () => {
    await loadProfile();
    if (S.profile?.approved) enter(); else toast("Still pending");
  };
  $("#out").onclick = logout;
}

async function logout() {
  await sb.auth.signOut();
  S.session = null; S.profile = null;
  renderAuth("login");
}

/* =========================================================
   SHELL
   ========================================================= */
async function enter() {
  await loadProfile();
  if (!S.profile) { await sb.auth.signOut(); renderAuth("login", "Account not found. It may have been deleted."); return; }
  if (!S.profile.approved) { renderPending(); return; }
  await loadSettings();
  buildShell();
  render();
}

function buildShell() {
  document.body.innerHTML = `
  <header class="topbar">
    <button class="icon-btn" id="menuBtn" aria-label="Menu">${ICON.menu}</button>
    <div class="topbar-title"><div class="t1" id="pageTitle"></div><div class="t2" id="appName"></div></div>
    <img class="topbar-logo" src="${esc(logo())}" alt="">
  </header>
  <div class="scrim" id="scrim"></div>
  <nav class="drawer" id="drawer" aria-label="Menu">
    <div class="drawer-head">
      <img src="${esc(logo())}" alt="">
      <div><div class="n" id="drawerName"></div><div class="u">${esc(S.profile.username)} · <span class="badge ${S.profile.role}">${S.profile.role}</span></div></div>
    </div>
    <div class="nav" id="nav"></div>
    <div class="drawer-foot">v${esc(CFG.version)} · game time UTC</div>
  </nav>
  <main id="main"></main>
  <div id="toasts" class="toasts"></div>`;
  $("#menuBtn").onclick = openDrawer;
  $("#scrim").onclick = closeDrawer;
  let sx = null;
  $("#drawer").addEventListener("touchstart", (e) => (sx = e.touches[0].clientX), { passive: true });
  $("#drawer").addEventListener("touchend", (e) => { if (sx !== null && sx - e.changedTouches[0].clientX > 60) closeDrawer(); sx = null; });
}

function renderNav() {
  const items = NAV.filter((n) => !(n.modOnly && !isMod()) && !(n.adminOnly && !isAdmin()));
  $("#nav").innerHTML = items.map((n) => n.sec
    ? `<div class="nav-sec">${esc(n.sec)}</div>`
    : `<a href="#/${n.id}" class="${(S.route === "ip" ? "lookup" : S.route) === n.id ? "active" : ""}">${ICON[n.icon]}<span>${esc(n.label)}</span>
        ${n.id === "mod" && S.pendingCount ? `<span class="count">${S.pendingCount}</span>` : n.soon ? `<span class="soon">SOON</span>` : ""}</a>`
  ).join("");
  $$("#nav a").forEach((a) => (a.onclick = closeDrawer));
  $("#drawerName").textContent = S.settings.app_name;
  $("#appName").textContent = S.settings.app_name;
}
function openDrawer() { $("#drawer").classList.add("open"); $("#scrim").classList.add("open"); }
function closeDrawer() { $("#drawer")?.classList.remove("open"); $("#scrim")?.classList.remove("open"); }

async function render() {
  if (!S.profile?.approved || !$("#main")) return;
  S.route = routeFromHash();
  stopClock();
  const item = S.route === "ip" ? { id: "ip", label: "Target" } : NAV.find((n) => n.id === S.route);
  $("#pageTitle").textContent = item.label;
  loadPendingCount().then(renderNav);
  renderNav();
  const main = $("#main");
  main.innerHTML = `<div class="loading">Loading</div>`;
  window.scrollTo(0, 0);
  try {
    if (S.route === "home") await pageHome(main);
    else if (S.route === "settings") await pageSettings(main);
    else if (S.route === "mod") await pageMod(main);
    else if (window.OLC_PAGES && window.OLC_PAGES[S.route]) await window.OLC_PAGES[S.route](main, S.arg);
    else pageSoon(main, item);
  } catch (e) {
    main.innerHTML = `<div class="card"><div class="card-h">Error</div><p>${esc(errMsg(e))}</p>
      <button class="btn" onclick="location.reload()">Reload</button></div>`;
  }
}

/* =========================================================
   HOME
   ========================================================= */
async function pageHome(main) {
  const now = new Date().toISOString();
  const [settingsR, pollR, checkR] = await Promise.all([
    sb.from("app_settings").select("*").eq("id", 1).maybeSingle(),
    sb.from("polls").select("*").eq("active", true).order("created_at", { ascending: false }).limit(1),
    sb.from("activity_checks").select("*").eq("closed", false).lte("starts_at", now).gt("ends_at", now)
      .order("starts_at", { ascending: false }).limit(1)
  ]);
  if (settingsR.data) S.settings = settingsR.data;
  let poll = (pollR.data || [])[0];
  if (poll && poll.ends_at && new Date(poll.ends_at) < new Date()) poll = null;
  const check = (checkR.data || [])[0];

  let votes = [], myResp = null;
  if (poll) votes = (await sb.from("poll_votes").select("user_id,choice").eq("poll_id", poll.id)).data || [];
  if (check) myResp = (await sb.from("activity_responses").select("check_id").eq("check_id", check.id).eq("user_id", S.profile.id).maybeSingle()).data;

  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  let dismissed = false; try { dismissed = localStorage.getItem("olc-install-dismissed") === "1"; } catch (e) {}

  main.innerHTML = `
    <div class="hero">
      <img src="${esc(logo())}" alt="OLC lizard logo">
      <h1>${esc(S.settings.app_name)}<span class="cur">_</span></h1>
      <div class="sub">Welcome back, <b>${esc(S.profile.username)}</b></div>
    </div>

    <div class="card">
      <div class="card-h">Message of the day</div>
      <div class="pre">${esc(S.settings.motd) || `<span class="muted">No message yet.</span>`}</div>
      ${S.settings.updated_by ? `<div class="tiny muted" style="margin-top:10px">— ${esc(S.settings.updated_by)}, ${fmtDateTime(S.settings.updated_at)}</div>` : ""}
    </div>

    ${check ? `
    <div class="card warn compact">
      <div class="card-h">Activity check<span class="r">ends in ${timeLeft(check.ends_at)}</span></div>
      ${myResp
        ? `<div class="row ok-line">${ICON.check}<span>You're confirmed active</span></div>`
        : `<div class="row"><div class="grow small">${check.note ? esc(check.note) : "Confirm you're still active in the game."}</div>
           <button class="btn sm primary" id="imActive">I'm active</button></div>`}
    </div>` : ""}

    ${poll ? pollCard(poll, votes) : ""}

    ${!standalone && !dismissed ? `
    <div class="card accent" id="installCard">
      <div class="card-h">Install the app<span class="r"><button class="icon-btn" id="dismissInstall" style="width:32px;height:32px" aria-label="Dismiss">${ICON.x}</button></span></div>
      <div class="row"><div class="grow small muted">Add ${esc(S.settings.app_name)} to your home screen so it opens like a real app.</div>
      <a class="btn sm primary" href="#/settings">How</a></div>
    </div>` : ""}

    <div class="card">
      <div class="card-h">Game clock</div>
      <div class="clock">
        <div><div class="k">Game time (UTC)</div><div class="v" id="gClock">--:--</div></div>
        <div><div class="k">Day resets in</div><div class="v" id="gReset">--</div></div>
      </div>
    </div>`;

  $("#dismissInstall") && ($("#dismissInstall").onclick = () => {
    try { localStorage.setItem("olc-install-dismissed", "1"); } catch (e) {}
    $("#installCard").remove();
  });
  $("#imActive") && ($("#imActive").onclick = async (e) => {
    btnBusy(e.currentTarget, true);
    const { error } = await sb.from("activity_responses").upsert({ check_id: check.id, user_id: S.profile.id }, { onConflict: "check_id,user_id", ignoreDuplicates: true });
    if (error) { toast(errMsg(error), true); btnBusy(e.currentTarget, false); return; }
    toast("Confirmed — thanks!");
    render();
  });
  if (poll) bindPoll(poll);
  startClock();
}

function pollCard(poll, votes) {
  const total = votes.length;
  const mine = votes.find((v) => v.user_id === S.profile.id);
  return `
  <div class="card" id="pollCard">
    <div class="card-h">Poll<span class="r">${total} vote${total === 1 ? "" : "s"}${poll.ends_at ? ` · ends in ${timeLeft(poll.ends_at)}` : ""}</span></div>
    <div class="poll-q">${esc(poll.question)}</div>
    ${poll.options.map((o, i) => {
      const n = votes.filter((v) => v.choice === i).length;
      const pct = total ? Math.round((n / total) * 100) : 0;
      return `<button class="opt ${mine && mine.choice === i ? "mine" : ""}" data-choice="${i}">
        <div class="bar" style="width:${mine ? pct : 0}%"></div>
        <span>${esc(o)}</span>${mine ? `<span class="pct">${pct}% · ${n}</span>` : ""}</button>`;
    }).join("")}
    <div class="tiny muted">${mine ? "Tap another option to change your vote." : "Tap an option to vote. Results show after you vote."}</div>
  </div>`;
}
function bindPoll(poll) {
  $$("#pollCard [data-choice]").forEach((b) => (b.onclick = async () => {
    const { error } = await sb.from("poll_votes").upsert(
      { poll_id: poll.id, user_id: S.profile.id, choice: Number(b.dataset.choice), voted_at: new Date().toISOString() },
      { onConflict: "poll_id,user_id" });
    if (error) return toast(errMsg(error), true);
    render();
  }));
}

function startClock() {
  const tick = () => {
    const now = new Date();
    const c = $("#gClock"), r = $("#gReset");
    if (!c) return stopClock();
    c.textContent = now.toISOString().slice(11, 16);
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    r.textContent = timeLeft(next);
  };
  tick();
  S.clockTimer = setInterval(tick, 15000);
}
function stopClock() { if (S.clockTimer) clearInterval(S.clockTimer); S.clockTimer = null; }

/* =========================================================
   SETTINGS
   ========================================================= */
async function pageSettings(main) {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const cur = document.documentElement.dataset.theme;
  main.innerHTML = `
    <div class="card">
      <div class="card-h">Account</div>
      <div class="row"><div class="grow"><div class="who" style="font-size:17px;font-weight:700">${esc(S.profile.username)}</div>
        <div class="tiny muted">Member since ${fmtDate(S.profile.created_at)}</div></div>
        <span class="badge ${S.profile.role}">${S.profile.role}</span></div>
    </div>

    <div class="card">
      <div class="card-h">Theme</div>
      <div class="themes">${THEMES.map((t) => `
        <button class="theme-pick ${cur === t.id ? "on" : ""}" data-theme-id="${t.id}">
          <div class="sw" style="background:${t.c[0]}"><i style="width:40%;background:${t.c[1]}"></i><i style="width:25%;background:${t.c[2]};opacity:.7"></i></div>
          <b>${t.name}</b></button>`).join("")}</div>
    </div>

    <div class="card">
      <div class="card-h">Install on your phone</div>
      ${standalone ? `<div class="row" style="color:var(--accent)">${ICON.check}<b>Installed — you're using the app.</b></div>` : `
        <button class="btn primary block" id="installBtn" ${S.installPrompt ? "" : "hidden"}>${ICON.download} Install app</button>
        <div class="small" ${S.installPrompt ? "hidden" : ""} id="installHow">
          ${ios ? `<b>iPhone (Safari):</b><ol style="margin:6px 0 0;padding-left:20px;line-height:1.8">
              <li>Tap the <b>Share</b> button (square with arrow).</li>
              <li>Scroll down and tap <b>Add to Home Screen</b>.</li>
              <li>Tap <b>Add</b>.</li></ol>`
            : `<b>Android (Chrome):</b><ol style="margin:6px 0 0;padding-left:20px;line-height:1.8">
              <li>Tap the <b>⋮</b> menu at the top right.</li>
              <li>Tap <b>Install app</b> or <b>Add to Home screen</b>.</li>
              <li>Tap <b>Install</b>.</li></ol>`}
        </div>`}
    </div>

    <div class="card">
      <div class="card-h">Change PIN</div>
      <form id="pinForm">
        <label class="f"><span>Current PIN</span><input class="input pin" name="o" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="current-password" placeholder="••••"></label>
        <label class="f"><span>New PIN</span><input class="input pin" name="n" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="new-password" placeholder="••••"></label>
        <label class="f"><span>Confirm new PIN</span><input class="input pin" name="n2" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="new-password" placeholder="••••"></label>
        <div class="err" id="pinErr"></div>
        <button class="btn block" type="submit">Update PIN</button>
      </form>
    </div>

    <button class="btn danger block" id="logoutBtn">Log out</button>
    <div class="tiny muted" style="text-align:center;margin-top:16px">${esc(S.settings.app_name)} v${esc(CFG.version)}</div>`;

  $$("[data-theme-id]").forEach((b) => (b.onclick = async () => {
    applyTheme(b.dataset.themeId);
    $$(".theme-pick").forEach((x) => x.classList.toggle("on", x === b));
    S.profile.theme = b.dataset.themeId;
    await sb.rpc("set_theme", { p_theme: b.dataset.themeId });
  }));
  $("#installBtn") && ($("#installBtn").onclick = async () => {
    if (!S.installPrompt) return;
    S.installPrompt.prompt();
    await S.installPrompt.userChoice;
    S.installPrompt = null;
    render();
  });
  $("#pinForm").onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target, err = $("#pinErr");
    err.textContent = "";
    if (![f.o.value, f.n.value].every((v) => /^\d{4}$/.test(v))) return (err.textContent = "PINs must be 4 digits");
    if (f.n.value !== f.n2.value) return (err.textContent = "New PINs don't match");
    const btn = $("button", f);
    btnBusy(btn, true);
    const { error } = await sb.rpc("change_my_pin", { p_old: f.o.value, p_new: f.n.value });
    btnBusy(btn, false);
    if (error) return (err.textContent = errMsg(error));
    f.reset();
    toast("PIN updated");
  };
  $("#logoutBtn").onclick = async () => {
    if (await confirmBox({ title: "Log out?", body: "You'll need your username and PIN to log back in.", ok: "Log out", danger: true })) logout();
  };
}

/* =========================================================
   MOD TOOLS
   ========================================================= */
async function pageMod(main) {
  const now = new Date().toISOString();
  const [profR, pollR, checkR, flagR] = await Promise.all([
    sb.from("profiles").select("id,username,role,approved,created_at").order("created_at"),
    sb.from("polls").select("*").eq("active", true).order("created_at", { ascending: false }).limit(1),
    sb.from("activity_checks").select("*").order("starts_at", { ascending: false }).limit(1),
    sb.from("flags").select("*").eq("resolved", false).order("created_at", { ascending: false }).limit(100)
  ]);
  const flags = flagR.data || [];
  const people = profR.data || [];
  const pending = people.filter((p) => !p.approved);
  const members = people.filter((p) => p.approved);
  const poll = (pollR.data || [])[0];
  const check = (checkR.data || [])[0];
  const checkLive = check && !check.closed && check.ends_at > now;

  let votes = [], responses = [];
  if (poll) votes = (await sb.from("poll_votes").select("choice").eq("poll_id", poll.id)).data || [];
  if (check) responses = (await sb.from("activity_responses").select("user_id").eq("check_id", check.id)).data || [];
  const responded = new Set(responses.map((r) => r.user_id));
  const expected = members.filter((m) => new Date(m.created_at) < new Date(check?.ends_at || 0));
  const missing = expected.filter((m) => !responded.has(m.id));

  const canManage = (p) => p.id !== S.profile.id && (isAdmin() || p.role === "member");

  main.innerHTML = `
    <div class="card ${pending.length ? "warn" : ""}">
      <div class="card-h">Waiting for approval<span class="r">${pending.length}</span></div>
      ${pending.length ? `<ul class="list">${pending.map((p) => `
        <li><div class="grow"><div class="who">${esc(p.username)}</div><div class="tiny muted">Signed up ${fmtDateTime(p.created_at)}</div></div>
          <button class="btn sm danger" data-reject="${p.id}" data-name="${esc(p.username)}">Reject</button>
          <button class="btn sm primary" data-approve="${p.id}">Approve</button></li>`).join("")}</ul>`
        : `<div class="empty">No one is waiting.</div>`}
    </div>

    <div class="card ${flags.length ? "warn" : ""}">
      <div class="card-h">Review queue<span class="r">${flags.length}</span></div>
      ${flags.length ? `<ul class="list">${flags.map((f) => `
        <li style="align-items:flex-start"><div class="grow">
          <a class="mono" href="#/ip/${encodeURIComponent(f.ip)}">${esc(f.ip)}</a>
          <span class="badge ${f.kind === "incorrect" ? "pending" : "mod"}">${f.kind === "incorrect" ? "incorrect" : "spam removed"}</span>
          ${f.note ? `<div class="small pre" style="margin-top:4px">${esc(f.note)}</div>` : ""}
          <div class="tiny muted">Flagged by ${esc(f.flagged_by || "—")}, ${fmtDateTime(f.created_at)}</div>
          <div class="row wrap" style="gap:6px;margin-top:8px">
            ${f.kind === "spam_removed" ? `<button class="btn sm primary" data-flag="${f.id}" data-do="active" data-ip="${esc(f.ip)}">Set Active</button>
              <button class="btn sm" data-flag="${f.id}" data-do="resolve">Keep Inactive</button>`
            : `<a class="btn sm" href="#/ip/${encodeURIComponent(f.ip)}">Open IP</a>
              <button class="btn sm primary" data-flag="${f.id}" data-do="resolve">Mark fixed</button>`}
          </div></div></li>`).join("")}</ul>`
        : `<div class="empty">Nothing to review.</div>`}
    </div>

    <div class="card">
      <div class="card-h">Members<span class="r">${members.length}</span></div>
      <ul class="list">${members.map((p) => `
        <li><div class="grow"><div class="who">${esc(p.username)}${p.id === S.profile.id ? ` <span class="muted tiny">(you)</span>` : ""}</div>
          <div class="tiny muted">Joined ${fmtDate(p.created_at)}</div></div>
          <span class="badge ${p.role}">${p.role}</span>
          ${canManage(p) ? `<button class="icon-btn" data-manage="${p.id}" aria-label="Manage ${esc(p.username)}">${ICON.dots}</button>` : `<span style="width:44px"></span>`}
        </li>`).join("")}</ul>
    </div>

    <div class="card">
      <div class="card-h">Home screen</div>
      <form id="homeForm">
        <label class="f"><span>App name</span><input class="input" name="name" maxlength="40" value="${esc(S.settings.app_name)}"></label>
        <label class="f"><span>Message of the day</span><textarea class="input" name="motd" maxlength="1000">${esc(S.settings.motd)}</textarea></label>
        <button class="btn primary block" type="submit">Save name &amp; message</button>
      </form>
      <hr class="sep">
      <div class="f"><span class="tiny mono muted" style="letter-spacing:.1em;text-transform:uppercase;font-weight:600">Logo</span>
        <div class="row" style="margin-top:8px">
          <img id="logoPrev" src="${esc(logo())}" alt="" style="width:64px;height:64px;border-radius:14px;border:1px solid var(--line-2);object-fit:cover">
          <div class="grow row wrap" style="gap:8px">
            <label class="btn sm primary">Change logo<input type="file" accept="image/*" id="logoFile" hidden></label>
            ${S.settings.logo_url ? `<button type="button" class="btn sm ghost" id="logoReset">Use lizard</button>` : ""}
          </div>
        </div>
        <div class="hint">Cropped to a square. Changes the logo inside the app for everyone.</div>
      </div>
    </div>

    <div class="card">
      <div class="card-h">Poll</div>
      ${poll ? `
        <div class="poll-q">${esc(poll.question)}</div>
        ${poll.options.map((o, i) => {
          const n = votes.filter((v) => v.choice === i).length, pct = votes.length ? Math.round((n / votes.length) * 100) : 0;
          return `<div class="opt"><div class="bar" style="width:${pct}%"></div><span>${esc(o)}</span><span class="pct">${pct}% · ${n}</span></div>`;
        }).join("")}
        <div class="row" style="margin-top:6px"><div class="grow tiny muted">${votes.length} vote${votes.length === 1 ? "" : "s"}${poll.ends_at ? ` · ends ${fmtDateTime(poll.ends_at)}` : " · no end time"}</div>
        <button class="btn sm danger" id="endPoll">End poll</button></div>`
      : `
        <form id="pollForm">
          <label class="f"><span>Question</span><input class="input" name="q" maxlength="200" required></label>
          <div id="optList">
            <div class="opt-row"><input class="input" name="o" maxlength="80" placeholder="Option 1" required></div>
            <div class="opt-row"><input class="input" name="o" maxlength="80" placeholder="Option 2" required></div>
          </div>
          <button class="btn sm ghost" type="button" id="addOpt" style="margin-bottom:12px">${ICON.plus} Add option</button>
          <label class="f"><span>Runs for</span><select class="input" name="dur">
            <option value="0">Until I end it</option><option value="24">1 day</option><option value="72">3 days</option><option value="168">7 days</option></select></label>
          <button class="btn primary block" type="submit">Start poll</button>
        </form>`}
    </div>

    <div class="card">
      <div class="card-h">Activity check</div>
      ${check ? `
        <div class="row" style="margin-bottom:10px"><div class="grow">
          <b>${checkLive ? "Running" : "Finished"}</b> <span class="muted small">· ${checkLive ? `ends in ${timeLeft(check.ends_at)}` : `ended ${fmtDateTime(check.closed ? check.ends_at : check.ends_at)}`}</span>
          ${check.note ? `<div class="small muted pre">${esc(check.note)}</div>` : ""}</div>
          <span class="badge">${responded.size}/${expected.length}</span></div>
        <div class="small" style="margin-bottom:6px"><b>${checkLive ? "Not confirmed yet" : "Did not confirm"}</b> (${missing.length})</div>
        ${missing.length ? `<div class="mono small" style="line-height:1.8">${missing.map((m) => esc(m.username)).join(", ")}</div>` : `<div class="empty">Everyone confirmed.</div>`}
        <hr class="sep">
        <div class="row">${checkLive ? `<button class="btn sm danger" id="endCheck">End now</button>` : ""}
          <span class="grow"></span>${!checkLive ? `<button class="btn sm primary" id="newCheck">${ICON.plus} New check</button>` : ""}</div>`
      : `<div class="empty">No activity checks yet.</div><button class="btn primary block" id="newCheck">${ICON.plus} Start activity check</button>`}
      <form id="checkForm" hidden style="margin-top:14px">
        <label class="f"><span>Note (optional)</span><input class="input" name="note" maxlength="200" placeholder="Tap below if you're still playing"></label>
        <label class="f"><span>Runs for</span><select class="input" name="dur">
          <option value="24">1 day</option><option value="48">2 days</option><option value="72" selected>3 days</option><option value="168">7 days</option><option value="336">14 days</option></select></label>
        <button class="btn primary block" type="submit">Start check</button>
      </form>
    </div>`;

  // approvals
  $$("[data-approve]").forEach((b) => (b.onclick = async () => {
    btnBusy(b, true, "…");
    const { error } = await sb.rpc("approve_user", { p_id: b.dataset.approve });
    if (error) { btnBusy(b, false); return toast(errMsg(error), true); }
    toast("Approved"); render();
  }));
  $$("[data-reject]").forEach((b) => (b.onclick = async () => {
    if (!(await confirmBox({ title: `Reject ${b.dataset.name}?`, body: "This deletes the sign-up. They can register again later.", ok: "Reject", danger: true }))) return;
    const { error } = await sb.rpc("delete_user", { p_id: b.dataset.reject });
    if (error) return toast(errMsg(error), true);
    toast("Sign-up removed"); render();
  }));

  // review queue
  $$("[data-flag]").forEach((b) => (b.onclick = async () => {
    btnBusy(b, true, "…");
    if (b.dataset.do === "active") {
      const { error } = await sb.from("targets").upsert({ ip: b.dataset.ip, status: "active" }, { onConflict: "ip" });
      if (error) { btnBusy(b, false); return toast(errMsg(error), true); }
    }
    const { error } = await sb.from("flags").update({ resolved: true }).eq("id", Number(b.dataset.flag));
    if (error) { btnBusy(b, false); return toast(errMsg(error), true); }
    toast("Resolved"); render();
  }));

  // member actions
  $$("[data-manage]").forEach((b) => (b.onclick = () => {
    const p = members.find((m) => m.id === b.dataset.manage);
    modal(`<h3>${esc(p.username)}</h3><p><span class="badge ${p.role}">${p.role}</span></p>
      <button class="sheet-btn" data-act="pin">Reset PIN</button>
      ${isAdmin() ? `<button class="sheet-btn" data-act="role">${p.role === "mod" ? "Remove Mod (make Member)" : "Make Mod"}</button>` : ""}
      <button class="sheet-btn danger" data-act="del">Delete account</button>
      <button class="btn block" data-act="close" style="margin-top:10px">Cancel</button>`,
      (w, close) => {
        $("[data-act=close]", w).onclick = close;
        $("[data-act=pin]", w).onclick = async () => {
          close();
          const pin = await pinBox(`New PIN for ${p.username}`, "Tell them their new 4-digit PIN. They can change it in Settings.");
          if (!pin) return;
          const { error } = await sb.rpc("reset_pin", { p_id: p.id, p_pin: pin });
          error ? toast(errMsg(error), true) : toast(`PIN reset for ${p.username}`);
        };
        $("[data-act=role]", w) && ($("[data-act=role]", w).onclick = async () => {
          close();
          const to = p.role === "mod" ? "member" : "mod";
          if (!(await confirmBox({ title: to === "mod" ? `Make ${p.username} a Mod?` : `Remove Mod from ${p.username}?`,
            body: to === "mod" ? "Mods can approve members, reset PINs, review flags, and edit the home screen." : "They'll become a regular Member.", ok: "Confirm" }))) return;
          const { error } = await sb.rpc("set_role", { p_id: p.id, p_role: to });
          if (error) return toast(errMsg(error), true);
          toast("Role updated"); render();
        });
        $("[data-act=del]", w).onclick = async () => {
          close();
          if (!(await confirmBox({ title: `Delete ${p.username}?`,
            body: "Their personal data (crypto, spam, siphon) is deleted. IPs, wallets and software they added stay. This can't be undone.",
            ok: "Delete account", danger: true }))) return;
          const { error } = await sb.rpc("delete_user", { p_id: p.id });
          if (error) return toast(errMsg(error), true);
          toast("Account deleted"); render();
        };
      });
  }));

  // home screen
  $("#homeForm").onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target, btn = $("button", f);
    const name = f.name.value.trim() || "OLC Database";
    btnBusy(btn, true, "Saving…");
    const { error } = await sb.from("app_settings").update({ app_name: name, motd: f.motd.value.trim() }).eq("id", 1);
    btnBusy(btn, false);
    if (error) return toast(errMsg(error), true);
    await loadSettings(); renderNav(); toast("Home screen saved");
  };

  // logo
  $("#logoFile").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      toast("Uploading logo…");
      const blob = await squareImage(file, 512);
      const { error } = await sb.storage.from("branding").upload("logo.png", blob, { upsert: true, contentType: "image/png", cacheControl: "60" });
      if (error) throw error;
      const url = sb.storage.from("branding").getPublicUrl("logo.png").data.publicUrl + "?v=" + Date.now();
      const { error: e2 } = await sb.from("app_settings").update({ logo_url: url }).eq("id", 1);
      if (e2) throw e2;
      await loadSettings(); refreshLogos(); toast("Logo updated"); render();
    } catch (err) { toast(errMsg(err), true); }
  };
  $("#logoReset") && ($("#logoReset").onclick = async () => {
    if (!(await confirmBox({ title: "Go back to the lizard logo?", ok: "Use lizard" }))) return;
    const { error } = await sb.from("app_settings").update({ logo_url: null }).eq("id", 1);
    if (error) return toast(errMsg(error), true);
    await loadSettings(); refreshLogos(); render();
  });

  // poll
  $("#addOpt") && ($("#addOpt").onclick = () => {
    const n = $$("#optList .opt-row").length;
    if (n >= 8) return toast("Up to 8 options");
    const row = document.createElement("div");
    row.className = "opt-row";
    row.innerHTML = `<input class="input" name="o" maxlength="80" placeholder="Option ${n + 1}"><button class="icon-btn" type="button" aria-label="Remove">${ICON.x}</button>`;
    $("button", row).onclick = () => row.remove();
    $("#optList").appendChild(row);
  });
  $("#pollForm") && ($("#pollForm").onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const opts = $$("input[name=o]", f).map((i) => i.value.trim()).filter(Boolean);
    if (opts.length < 2) return toast("Add at least 2 options", true);
    const hrs = Number(f.dur.value);
    await sb.from("polls").update({ active: false }).eq("active", true);
    const { error } = await sb.from("polls").insert({ question: f.q.value.trim(), options: opts,
      ends_at: hrs ? new Date(Date.now() + hrs * 3600e3).toISOString() : null });
    if (error) return toast(errMsg(error), true);
    toast("Poll started"); render();
  });
  $("#endPoll") && ($("#endPoll").onclick = async () => {
    if (!(await confirmBox({ title: "End this poll?", body: "It will disappear from the home screen.", ok: "End poll", danger: true }))) return;
    const { error } = await sb.from("polls").update({ active: false }).eq("id", poll.id);
    if (error) return toast(errMsg(error), true);
    toast("Poll ended"); render();
  });

  // activity check
  $("#newCheck") && ($("#newCheck").onclick = () => { $("#checkForm").hidden = false; $("#newCheck").hidden = true; });
  $("#checkForm").onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const { error } = await sb.from("activity_checks").insert({ note: f.note.value.trim() || null,
      ends_at: new Date(Date.now() + Number(f.dur.value) * 3600e3).toISOString() });
    if (error) return toast(errMsg(error), true);
    toast("Activity check started"); render();
  };
  $("#endCheck") && ($("#endCheck").onclick = async () => {
    if (!(await confirmBox({ title: "End the activity check now?", body: "The list of members who didn't confirm will be final.", ok: "End now", danger: true }))) return;
    const { error } = await sb.from("activity_checks").update({ closed: true, ends_at: new Date().toISOString() }).eq("id", check.id);
    if (error) return toast(errMsg(error), true);
    render();
  });
}

function squareImage(file, size) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const c = document.createElement("canvas");
      c.width = c.height = size;
      c.getContext("2d").drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
      URL.revokeObjectURL(img.src);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't read that image"))), "image/png");
    };
    img.onerror = () => reject(new Error("Couldn't read that image"));
    img.src = URL.createObjectURL(file);
  });
}
function refreshLogos() { $$(".topbar-logo, .drawer-head img").forEach((i) => (i.src = logo())); }

/* =========================================================
   COMING SOON
   ========================================================= */
function pageSoon(main, item) {
  main.innerHTML = `
    <div class="card soon-page">
      ${ICON.build}
      <h2 style="margin:10px 0 4px">${esc(item.label)}</h2>
      <div class="muted small">Coming in build stage ${item.soon}.</div>
      <ul>${(SOON_TEXT[item.id] || []).map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
    </div>`;
}

/* ---------- shared with page modules (game.js) ---------- */
window.OLC = { sb, S, CFG, $, $$, esc, toast, modal, confirmBox, btnBusy, errMsg,
  fmtDate, fmtDateTime, isMod, isAdmin, render, go };

/* =========================================================
   BOOT
   ========================================================= */
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  S.installPrompt = e;
  if (S.route === "settings") render();
});
window.addEventListener("hashchange", render);

if ("serviceWorker" in navigator) {
  // When an updated version takes over, reload once so the new files are used.
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloaded) return;
    reloaded = true;
    location.reload();
  });
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js", { updateViaCache: "none" })
      .then((reg) => {
        reg.update().catch(() => {});
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") reg.update().catch(() => {});
        });
      })
      .catch(() => {});
  });
}

async function boot() {
  try { applyTheme(localStorage.getItem("olc-theme") || "green"); } catch (e) { applyTheme("green"); }
  await loadSettings().catch(() => {});
  const { data } = await sb.auth.getSession();
  S.session = data.session;
  if (!S.session) return renderAuth("login");
  await enter();
}

sb.auth.onAuthStateChange((event, session) => {
  S.session = session;
  if (event === "SIGNED_OUT") { S.profile = null; renderAuth("login"); }
});

boot().catch((e) => {
  document.body.innerHTML = `<div class="auth"><div class="card"><div class="card-h">Can't connect</div>
    <p>${esc(errMsg(e))}</p><button class="btn primary block" onclick="location.reload()">Try again</button></div></div>`;
});
})();
