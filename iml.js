/* =========================================================
   OLC Database — IP Master List (IML)
   A shared list of IPs for the accounts the Admin turns it on for.
   Paste IPs (words in the paste are ignored); full IPs come first,
   then one hidden part (xxx), then two. IPs with 3 or 4 hidden parts
   are left out. Check an IP off to move it to Complete.
   ========================================================= */
(() => {
"use strict";
const O = () => window.OLC;
const G = () => window.OLC_GAME;
const PAGES = (window.OLC_PAGES = window.OLC_PAGES || {});

// Something shaped like an IP inside any text: 4 parts, each digits or hidden (x, *, ?).
const IN_TEXT = /(?<![\w.*?])[\dxX*?]{1,3}(?:\.[\dxX*?]{1,3}){3}(?![\w*?]|\.[\dxX*?])/g;

// A firewall only counts when it's labelled FW right after the IP on the same line
// ("1.2.3.4 FW 37", "1.2.3.4 · FW 37"); a bare number is never read as a firewall.
const FW_AFTER = /^[ \t]*[·:,|-]?[ \t]*FW[ \t]*:?[ \t]*(\d{1,6})(?!\d)/i;

/** IPs from pasted text: { ips, fws, ignored } — hidden parts become xxx; 3+ hidden or bad parts ignored. fws[i] is ips[i]'s firewall or null. */
function parseIps(text) {
  const ips = [], fws = [], seen = new Map();
  let ignored = 0;
  const src = String(text || "");
  for (const m of src.matchAll(IN_TEXT)) {
    const raw = m[0];
    const fwm = FW_AFTER.exec(src.slice(m.index + raw.length, m.index + raw.length + 40).split(/[\r\n]/)[0]);
    const fw = fwm ? Number(fwm[1]) : null;
    let hidden = 0, ok = true;
    const parts = raw.split(".").map((p) => {
      if (/^[xX*?]+$/.test(p)) { hidden++; return "xxx"; }
      if (!/^\d+$/.test(p) || Number(p) > 255) ok = false;
      return String(Number(p));
    });
    if (!ok || hidden > 2) { ignored++; continue; }
    const ip = parts.join(".");
    if (!seen.has(ip)) { seen.set(ip, ips.length); ips.push(ip); fws.push(fw); }
    else if (fw != null) fws[seen.get(ip)] = fw;
  }
  return { ips, fws, ignored };
}

const missing = (e) => e && (e.code === "42P01" || e.code === "PGRST205" || /(iml|aml)_(ips|done)/i.test(e.message || ""));
const KIND = ["Full IP", "One hidden", "Two hidden"];

// Both lists work the same: the IP Master List (shared with members the Admin
// turns it on for) and the Admin Master List (Admin only, its own IPs).
const LISTS = {
  iml: { title: "IP Master List", short: "IML", ips: "iml_ips", done: "iml_done", add: "iml_add", addFw: "iml_add_fw", setDone: "iml_set_done", del: "iml_delete", who: " for everyone who uses it" },
  aml: { title: "Admin Master List", short: "AML", ips: "aml_ips", done: "aml_done", add: "aml_add", addFw: "aml_add", setDone: "aml_set_done", del: "aml_delete", who: "" }
};

PAGES.iml = (main) => pageList(main, LISTS.iml);
PAGES.aml = (main) => pageList(main, LISTS.aml);

async function pageList(main, L) {
  const { sb, esc, $, $$, toast, confirmBox, btnBusy, errMsg, render } = O();
  const { data, error } = await sb.from(L.ips).select("*").order("hidden").order("added_at").order("id");
  if (error) {
    main.innerHTML = missing(error)
      ? `<div class="card warn"><div class="card-h">Database update needed</div><p class="small" style="margin:0">This page needs the latest database update.</p></div>`
      : `<div class="card"><div class="card-h">Error</div><p>${esc(errMsg(error))}</p></div>`;
    return;
  }
  // Check marks are personal: each account only sees its own.
  const { data: mine, error: e2 } = await sb.from(L.done).select("ip_id, done_at");
  if (e2) {
    main.innerHTML = missing(e2) || e2.code === "42P01"
      ? `<div class="card warn"><div class="card-h">Database update needed</div><p class="small" style="margin:0">This page needs the latest database update.</p></div>`
      : `<div class="card"><div class="card-h">Error</div><p>${esc(errMsg(e2))}</p></div>`;
    return;
  }
  const doneAt = new Map((mine || []).map((d) => [d.ip_id, d.done_at]));
  const rows = (data || []).map((r) => ({ ...r, done: doneAt.has(r.id), done_at: doneAt.get(r.id) || null }));
  const open = rows.filter((r) => !r.done);
  const done = rows.filter((r) => r.done).sort((a, b) => String(b.done_at).localeCompare(String(a.done_at)));
  const plural = (n) => `${n} IP${n === 1 ? "" : "s"}`;

  const row = (r) => `<div class="row soon-row">
      <div class="grow">${r.hidden ? `<span class="mono">${esc(r.ip)}</span>` : `<a class="mono" href="#/ip/${encodeURIComponent(r.ip)}">${esc(r.ip)}</a>`}${r.fw != null ? ` <span class="muted">· FW ${esc(String(r.fw))}</span>` : ""}
        <div class="tiny muted">${KIND[r.hidden] || ""}${r.added_by_name ? ` · added by ${esc(r.added_by_name)}` : ""}</div></div>
      <button class="icon-btn" data-copy="${esc(r.ip)}" aria-label="Copy IP">${G().IC.copy}</button>
      ${r.done
        ? `<button class="btn sm ghost" data-undo="${r.id}" aria-label="Move back to the list">↺</button>`
        : `<button class="btn sm" data-done="${r.id}" aria-label="Complete">${G().IC.check}</button>`}
    </div>`;

  // Full IPs, then one hidden, then two: a small heading where each group starts.
  const grouped = (list) => list.map((r, i) =>
    (i === 0 || list[i - 1].hidden !== r.hidden ? `<div class="tiny muted" style="margin:10px 0 2px">${KIND[r.hidden]}</div>` : "") + row(r)).join("");

  main.innerHTML = `
    <div class="card">
      <div class="card-h">${L.title}<span class="r">${plural(open.length)}</span></div>
      <textarea class="input" rows="2" data-paste placeholder="Paste IPs… (words are ignored)" style="min-height:0"></textarea>
      <div class="row" style="margin-top:8px">
        <button class="btn ghost grow" data-fromclip>Paste</button>
        <button class="btn grow" data-add disabled>Add</button>
      </div>
      <div class="tiny muted" data-preview style="margin-top:6px">Full IPs and IPs with 1 or 2 hidden parts (xxx). 3 or 4 hidden parts are left out.</div>
    </div>
    <div class="card">
      ${open.length ? grouped(open) : `<div class="empty">Nothing on the list. Paste some IPs above.</div>`}
      <div class="row wrap" style="margin-top:12px;gap:8px">
        <button class="btn grow" data-copyiml ${open.length ? "" : "disabled"}>${G().IC.copy} Copy ${L.short}</button>
        <button class="btn ghost grow" data-copyall ${rows.length ? "" : "disabled"}>${G().IC.copy} Copy all</button>
      </div>
      <div class="row wrap" style="margin-top:8px;gap:8px">
        <button class="btn ghost grow" data-delcomplete ${done.length ? "" : "disabled"}>Delete complete</button>
        <button class="btn danger grow" data-delall ${rows.length ? "" : "disabled"}>Delete all</button>
      </div>
    </div>
    <div class="card">
      <div class="card-h">Complete <span class="tiny muted">(only you see your check marks)</span><span class="r">${plural(done.length)}</span></div>
      ${done.length ? done.map(row).join("") : `<div class="empty">Check an IP off above to move it here.</div>`}
    </div>`;

  const box = $("[data-paste]", main), addBtn = $("[data-add]", main), prev = $("[data-preview]", main);
  const update = () => {
    const { ips, ignored } = parseIps(box.value);
    addBtn.disabled = !ips.length;
    addBtn.textContent = ips.length ? `Add ${plural(ips.length)}` : "Add";
    const withFw = parseIps(box.value).fws.filter((f) => f != null).length;
    if (box.value.trim()) prev.textContent = `${plural(ips.length)} found` + (withFw ? ` · ${withFw} with FW` : "") + (ignored ? ` · ${ignored} left out (3+ hidden parts)` : "");
  };
  box.oninput = update;
  $("[data-fromclip]", main).onclick = async () => {
    try { box.value = await navigator.clipboard.readText(); update(); }
    catch (e) { box.focus(); toast("Couldn't read the clipboard: hold in the box and tap Paste", true); }
  };
  addBtn.onclick = async () => {
    const { ips, fws } = parseIps(box.value);
    if (!ips.length) return;
    btnBusy(addBtn, true, "Adding…");
    const { data: res, error: e } = fws.some((f) => f != null)
      ? await sb.rpc(L.addFw, { p_ips: ips, p_fws: fws })
      : await sb.rpc(L.add, { p_ips: ips });
    btnBusy(addBtn, false);
    if (e) return toast(errMsg(e), true);
    toast(`Added ${res.added}` + (res.dup ? ` · ${res.dup} already on the list` : "") + (res.ignored ? ` · ${res.ignored} left out` : ""));
    render();
  };

  const copyText = async (text, n) => {
    try { await navigator.clipboard.writeText(text); toast(`Copied ${plural(n)}`); }
    catch (e) { G().copy(text); }
  };
  $$("[data-copy]", main).forEach((b) => (b.onclick = () => G().copy(b.dataset.copy)));
  $("[data-copyiml]", main).onclick = () => copyText(open.map((r) => r.ip).join("\n"), open.length);
  $("[data-copyall]", main).onclick = () => copyText([...open, ...done].map((r) => r.ip).join("\n"), rows.length);

  const setDone = async (id, on) => {
    const { error: e } = await sb.rpc(L.setDone, { p_id: Number(id), p_done: on });
    if (e) return toast(errMsg(e), true);
    render();
  };
  $$("[data-done]", main).forEach((b) => (b.onclick = () => setDone(b.dataset.done, true)));
  $$("[data-undo]", main).forEach((b) => (b.onclick = () => setDone(b.dataset.undo, false)));

  $("[data-delcomplete]", main).onclick = async () => {
    if (!(await confirmBox({ title: `Delete ${plural(done.length)} from Complete?`, body: `The IPs you checked off are removed from the list${L.who}.`, ok: "Delete", danger: true }))) return;
    const { error: e } = await sb.rpc(L.del, { p_all: false });
    if (e) return toast(errMsg(e), true);
    toast("Complete cleared"); render();
  };
  $("[data-delall]", main).onclick = async () => {
    if (!(await confirmBox({ title: `Delete all ${plural(rows.length)}?`, body: `The whole list and Complete are emptied${L.who}. This can't be undone.`, ok: "Delete all", danger: true }))) return;
    const { error: e } = await sb.rpc(L.del, { p_all: true });
    if (e) return toast(errMsg(e), true);
    toast(`${L.title} emptied`); render();
  };
};
})();
