/* =========================================================
   OLC Database — Contact Admin (members) and Messages (Admin)
   Members send the Admin messages and long game pastes (no 2,000
   character limit like Discord). The Admin reads them per member,
   one thread each, and copies or deletes them. Deleted messages are
   removed from the database for good.
   ========================================================= */
(function () {
const PAGES = (window.OLC_PAGES = window.OLC_PAGES || {});
const O = () => window.OLC;
const MAX = 100000;
const n = (x) => Number(x || 0).toLocaleString("en-US");
const needSql = `<div class="card"><div class="card-h">Database update needed</div>
  <p class="small" style="margin:0">Messages need the v1.26 database update. The Admin runs it once in Supabase (SQL Editor).</p></div>`;
const missing = (e) => /admin_message|schema cache|does not exist|42P01|PGRST20/i.test((e && (e.message || e.code)) || "");

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) {}
  const ta = document.createElement("textarea");
  ta.value = text; ta.style.cssText = "position:fixed;opacity:0";
  document.body.appendChild(ta); ta.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch (e) {}
  ta.remove();
  return ok;
}

/* ---------- Contact Admin (everyone except the Admin) ---------- */
PAGES.contact = async function pageContact(main) {
  const { sb, S, esc, $, toast, errMsg, btnBusy, render, fmtDateTime } = O();
  const { data, error } = await sb.from("admin_messages").select("*")
    .eq("user_id", S.profile.id).order("created_at", { ascending: false });
  if (error && missing(error)) { main.innerHTML = needSql; return; }
  if (error) throw error;
  const mine = (data || []).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));    // newest first
  let draft = "";
  try { draft = sessionStorage.getItem("olc-contact-draft") || ""; } catch (e) {}

  main.innerHTML = `
    <div class="card accent">
      <div class="card-h">Message the Admin</div>
      <p class="small muted" style="margin-top:0">Only the Admin can read this. Paste long things from the game here too: there's no 2,000 character limit like Discord.</p>
      <textarea class="input log-box" rows="9" maxlength="${MAX}" placeholder="Type your message or paste from the game…">${esc(draft)}</textarea>
      <div class="row" style="margin-top:6px"><span class="tiny mono muted grow" data-count></span></div>
      <button class="btn primary block" data-send style="margin-top:10px" disabled>Send to Admin</button>
    </div>
    <div class="card">
      <div class="card-h">Your conversation<span class="r">newest first</span></div>
      ${mine.length ? `<ul class="list">${mine.map((m) => `
        <li style="align-items:flex-start" class="${m.from_admin ? "msg-reply" : ""}"><div class="grow" style="min-width:0">
          <div class="tiny muted">${m.from_admin ? `<b class="msg-from-admin">Admin replied</b> · ` : "You · "}${fmtDateTime(m.created_at)}${m.from_admin ? "" : ` · ${n(m.body.length)} characters`}</div>
          <div class="small pre ${m.from_admin ? "" : "msg-peek"}">${esc(!m.from_admin && m.body.length > 280 ? m.body.slice(0, 280) + "…" : m.body)}</div></div></li>`).join("")}</ul>
        <div class="hint">When the Admin is done with a message it's deleted and disappears from here.</div>`
        : `<div class="empty">No messages yet.</div>`}
    </div>`;

  const ta = $("textarea", main), send = $("[data-send]", main), count = $("[data-count]", main);
  const paint = () => {
    const len = ta.value.trim().length;
    count.textContent = len ? `${n(ta.value.length)} / ${n(MAX)} characters` : "";
    send.disabled = !len;
    try { sessionStorage.setItem("olc-contact-draft", ta.value); } catch (e) {}
  };
  ta.addEventListener("input", paint);
  paint();
  send.onclick = async () => {
    const body = ta.value.trim();
    if (!body) return;
    btnBusy(send, true, "Sending…");
    const { error: e } = await sb.from("admin_messages").insert({ body });
    if (e) { btnBusy(send, false); return toast(missing(e) ? "The Admin needs to run the v1.26 database update first" : errMsg(e), true); }
    try { sessionStorage.removeItem("olc-contact-draft"); } catch (x) {}
    toast("Sent to the Admin");
    render();
  };
};

/* ---------- Messages (Admin only): list of members, then a thread ---------- */
PAGES.messages = async function pageMessages(main, arg) {
  const { sb, esc, $, $$, toast, errMsg, confirmBox, render, go, fmtDateTime } = O();
  if (arg) return thread(main, arg);

  const { data, error } = await sb.rpc("admin_message_threads");
  if (error && missing(error)) { main.innerHTML = needSql; return; }
  if (error) throw error;
  const list = data || [];
  main.innerHTML = `
    <div class="card">
      <div class="card-h">Messages<span class="r">${list.length} member${list.length === 1 ? "" : "s"}</span></div>
      ${list.length ? `<ul class="list">${list.map((t) => `
        <li class="msg-thread" data-open="${esc(t.user_id)}"><div class="grow">
          <b>${esc(t.username)}</b>
          <div class="tiny muted">${n(t.messages)} message${Number(t.messages) === 1 ? "" : "s"}${t.replies ? ` · ${n(t.replies)} repl${Number(t.replies) === 1 ? "y" : "ies"}` : ""} · last ${fmtDateTime(t.last_at)}</div>
          ${t.last_from_admin ? `<div class="tiny muted">You replied last</div>` : `<div class="tiny msg-from-admin">Waiting for your reply</div>`}</div>
          <span class="count-pill mono">${n(t.messages)}</span>
          <span class="icon-btn" aria-hidden="true">›</span></li>`).join("")}</ul>`
        : `<div class="empty">No messages.</div>`}
      <div class="hint">Members send these from Contact Admin. Deleting a message removes it from the database for good.</div>
    </div>`;
  $$("[data-open]", main).forEach((li) => (li.onclick = () => go("messages/" + encodeURIComponent(li.dataset.open))));

  async function thread(main, uid) {
    const [mR, pR] = await Promise.all([
      sb.from("admin_messages").select("*").eq("user_id", uid).order("created_at", { ascending: false }),
      sb.from("profiles").select("username").eq("id", uid).maybeSingle()
    ]);
    if (mR.error && missing(mR.error)) { main.innerHTML = needSql; return; }
    if (mR.error) throw mR.error;
    const msgs = (mR.data || []).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));   // newest first
    const name = pR.data?.username || "Deleted account";
    if (!msgs.length) { go("messages"); return; }
    const open = new Set();

    main.innerHTML = `
      <a class="back-link" href="#/messages">‹ Messages</a>
      <div class="card accent">
        <div class="row"><div class="grow"><div class="tiny mono muted">FROM</div>
          <div style="font-size:20px;font-weight:700">${esc(name)}</div>
          <div class="small muted">${msgs.length} post${msgs.length === 1 ? "" : "s"}, newest first</div></div>
          <button class="btn sm danger" data-delall>Delete all</button></div>
      </div>
      <div class="card">
        <div class="card-h">Reply to ${esc(name)}</div>
        <textarea class="input" rows="3" maxlength="${MAX}" data-reply placeholder="Your reply… ${esc(name)} sees it on their Contact Admin page"></textarea>
        <button class="btn primary block" data-sendreply style="margin-top:8px" disabled>Send reply</button>
      </div>
      ${msgs.map((m) => `
        <div class="card msg-post ${m.from_admin ? "msg-reply" : ""}" data-id="${m.id}">
          <div class="row" style="margin-bottom:8px"><span class="tiny mono muted grow">${m.from_admin ? `<b class="msg-from-admin">YOU (ADMIN)</b>` : `<b>${esc(name)}</b>`} · ${fmtDateTime(m.created_at)}</span>
            <span class="tiny mono muted">${n(m.body.length)} chars</span></div>
          <div class="pre msg-body ${m.body.length > 1200 ? "clip" : ""}" data-body="${m.id}">${esc(m.body)}</div>
          ${m.body.length > 1200 ? `<button class="btn sm ghost block" data-more="${m.id}" style="margin-top:8px">Show all</button>` : ""}
          <div class="row" style="gap:6px;margin-top:10px">
            <button class="btn sm grow" data-copy="${m.id}">Copy</button>
            <button class="btn sm grow danger" data-del="${m.id}">Delete</button>
            <button class="btn sm grow primary" data-copydel="${m.id}">Copy &amp; delete</button>
          </div>
        </div>`).join("")}`;

    const byId = new Map(msgs.map((m) => [String(m.id), m]));
    const rta = $("[data-reply]", main), rsend = $("[data-sendreply]", main);
    rta.addEventListener("input", () => (rsend.disabled = !rta.value.trim()));
    rsend.onclick = async () => {
      const body = rta.value.trim();
      if (!body) return;
      O().btnBusy(rsend, true, "Sending…");
      const { error: e } = await sb.from("admin_messages").insert({ user_id: uid, body, from_admin: true });
      if (e) { O().btnBusy(rsend, false); return toast(/from_admin|row-level security/i.test(e.message || "") ? "Run the v1.30 SQL file first" : errMsg(e), true); }
      toast(`Reply sent to ${name}`);
      render();
    };
    const remove = async (id) => {
      const { error: e } = await sb.from("admin_messages").delete().eq("id", id);
      if (e) { toast(errMsg(e), true); return false; }
      return true;
    };
    $$("[data-more]", main).forEach((b) => (b.onclick = () => {
      const id = b.dataset.more, body = $(`[data-body="${id}"]`, main);
      const on = !open.has(id); on ? open.add(id) : open.delete(id);
      body.classList.toggle("clip", !on);
      b.textContent = on ? "Show less" : "Show all";
    }));
    $$("[data-copy]", main).forEach((b) => (b.onclick = async () => {
      const m = byId.get(b.dataset.copy);
      if (await copyText(m.body)) toast(`Copied ${n(m.body.length)} characters`);
      else toast("Couldn't copy", true);
    }));
    $$("[data-del]", main).forEach((b) => (b.onclick = async () => {
      if (!(await confirmBox({ title: "Delete this message?", body: "It's removed from the database for good.", ok: "Delete", danger: true }))) return;
      if (await remove(b.dataset.del)) { toast("Deleted"); render(); }
    }));
    $$("[data-copydel]", main).forEach((b) => (b.onclick = async () => {
      const m = byId.get(b.dataset.copydel);
      if (!(await copyText(m.body))) return toast("Couldn't copy, so it wasn't deleted", true);
      if (await remove(m.id)) { toast(`Copied ${n(m.body.length)} characters and deleted`); render(); }
    }));
    $("[data-delall]", main).onclick = async () => {
      if (!(await confirmBox({ title: `Delete all from ${name}?`, body: `All ${msgs.length} post${msgs.length === 1 ? "" : "s"} (their messages and your replies) are removed from the database for good.`, ok: "Delete all", danger: true }))) return;
      const { error: e } = await sb.from("admin_messages").delete().eq("user_id", uid);
      if (e) return toast(errMsg(e), true);
      toast(`Deleted ${msgs.length} message${msgs.length === 1 ? "" : "s"}`);
      go("messages");
    };
  }
};
})();
