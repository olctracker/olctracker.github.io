/* =========================================================
   OLC Database — Calculator, Character Builder (everyone) and Formulas (Admin)
   All numbers come from upgrades.js (verified formulas, no database).
   Import my device copies your levels from My Device.
   ========================================================= */
(() => {
"use strict";
const O = () => window.OLC;
const G = () => window.OLC_GAME;
const U = () => window.OLC_UPG;
const PAGES = (window.OLC_PAGES = window.OLC_PAGES || {});

const n = (v) => Number(v).toLocaleString("en-US");
const digits = (v) => String(v || "").replace(/[^\d]/g, "").slice(0, 4);
const num = (v) => (v === "" || v == null ? null : Number(v));
const load = (k) => { try { return JSON.parse(localStorage.getItem(k) || "{}"); } catch (e) { return {}; } };
const keep = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

/** How a level reads: Botnet tiers by name, one-time items Yes/No. */
function levelText(key, v) {
  const it = U().BY_KEY[key];
  if (key === "botnet") return U().BOTNET_TIERS[v - 1] || String(v);
  if (it.cat === "once") return v ? "Yes" : "No";
  return String(v);
}

/** A level box: number input, or a select for Botnet and one-time items. */
function levelBox(key, side, label, value, placeholder) {
  const { esc } = O();
  const it = U().BY_KEY[key];
  const attrs = `data-k="${key}" data-side="${side}" aria-label="${esc(it.name)} ${esc(label)}"`;
  if (key === "botnet" || it.cat === "once") {
    const opts = key === "botnet" ? U().BOTNET_TIERS.map((t, i) => [i + 1, t]) : [[0, "No"], [1, "Yes"]];
    return `<label class="up-f"><span>${esc(label)}</span><select class="input" ${attrs}>
      <option value="">${esc(placeholder)}</option>${opts.map(([v, t]) => `<option value="${v}" ${String(value) === String(v) ? "selected" : ""}>${t}</option>`).join("")}</select></label>`;
  }
  return `<label class="up-f"><span>${esc(label)}</span><input class="input mono" inputmode="numeric" pattern="[0-9]*" maxlength="4"
    ${attrs} value="${esc(value ?? "")}" placeholder="${esc(placeholder)}"></label>`;
}

/** Resolves every box. Empty start = lowest level, empty end = no change. */
function resolve(state) {
  const out = {};
  for (const it of U().ITEMS) {
    const from = num(state.cur?.[it.key]) ?? it.min;
    const to = num(state.end?.[it.key]) ?? from;
    let error = null;
    if (it.max !== null && (from > it.max || to > it.max)) error = `Max is ${it.max}`;
    else if (from < it.min) error = `Lowest is ${it.min}`;
    else if (to < from) error = "End is below start";
    out[it.key] = { from, to, error };
  }
  return out;
}
const usable = (lv) => Object.fromEntries(Object.entries(lv).filter(([, l]) => !l.error));

/** Copies My Device into the start levels (software, Keygen, player level). */
async function importInto(state) {
  const d = await G().myDevice(true).catch(() => null);
  if (!d) { O().toast("Set up My Device first", true); return false; }
  state.cur = state.cur || {};
  let got = 0;
  const col = { device: "device_level", network: "network_level", botnet: "botnet_level" };
  for (const it of U().ITEMS) {
    const v = d[col[it.key] || it.key];
    if (v != null) { state.cur[it.key] = String(v); got++; }
  }
  if (d.player_level != null) { state.lvl = String(d.player_level); state.xp = ""; }
  O().toast(`Imported ${got} level${got === 1 ? "" : "s"} from My Device`);
  return true;
}

/** The account level boxes + where it lands. */
function accountBoxes(state) {
  const { esc } = O();
  return `<div class="up-two">
    <label class="up-f"><span>Account LVL</span><input class="input mono" inputmode="numeric" pattern="[0-9]*" maxlength="3" data-acc="lvl" value="${esc(state.lvl ?? "")}" placeholder="1"></label>
    <label class="up-f"><span>XP (optional)</span><input class="input mono" inputmode="numeric" pattern="[0-9]*" maxlength="7" data-acc="xp" value="${esc(state.xp ?? "")}" placeholder="0"></label>
  </div><div class="hint" data-now></div>`;
}
function account(state) {
  const level = num(state.lvl) ?? 1, exp = num(String(state.xp ?? "").replace(/[^\d]/g, "")) ?? 0;
  const req = U().charTarget(level);
  return { level, exp, req, ok: req !== null && exp < req, land: (gain) => (req !== null && exp < req ? U().addXp(level, exp, gain) : null) };
}
function nowText(a, state) {
  if (a.req === null) return "";
  if (!a.ok) return `<span class="up-bad">XP must be less than ${n(a.req)} at LVL ${a.level}.</span>`;
  return `Now: LVL ${a.level} · ${n(a.exp)} / ${n(a.req)}${state.xp ? "" : " (XP taken as 0)"}`;
}

/** Wires inputs: typing updates state and calls update() without redrawing the boxes. */
function wire(main, state, saveKey, update) {
  const { $$ } = O();
  $$("[data-k]", main).forEach((el) => {
    const on = () => {
      if (el.tagName === "INPUT") el.value = digits(el.value);
      const box = el.dataset.side === "from" ? "cur" : "end";
      state[box] = state[box] || {};
      state[box][el.dataset.k] = el.value;
      keep(saveKey, state); update();
    };
    el.addEventListener("input", on);
    el.addEventListener("change", on);
    if (el.tagName === "INPUT") el.addEventListener("focus", () => el.select());
  });
  $$("[data-acc]", main).forEach((el) => el.addEventListener("input", () => {
    el.value = el.value.replace(/[^\d]/g, "");
    state[el.dataset.acc] = el.value; keep(saveKey, state); update();
  }));
}

/* =========================================================
   CALCULATOR
   ========================================================= */
PAGES.calc = async function pageCalc(main) {
  const { esc, $, $$, render } = O();
  const KEY = "olc-calc";
  const state = load(KEY);

  main.innerHTML = `
    <div class="row" style="margin:0 2px 12px"><button class="btn sm" data-import>Import my device</button>
      <span class="grow"></span><button class="btn sm danger" data-clear>Clear</button></div>
    <div class="tiny muted" style="margin:0 4px 12px">Enter a start and end level for anything you're buying. Store, one key per level, or one big key jump.</div>
    ${U().ITEMS.map((it) => `
      <div class="card compact up-calc" data-row="${it.key}">
        <div class="card-h">${esc(it.name)}<span class="r" data-err="${it.key}"></span></div>
        <div class="up-two">
          ${levelBox(it.key, "from", "Start", state.cur?.[it.key], it.key === "botnet" ? "Free" : it.cat === "once" ? "No" : String(it.min))}
          ${levelBox(it.key, "to", "End", state.end?.[it.key], "—")}
        </div>
        <div class="up-three" data-out="${it.key}"></div>
      </div>`).join("")}

    <div class="card accent">
      <div class="card-h">Total cost</div>
      <div class="up-three" data-total></div>
      <div class="hint" data-kg></div>
    </div>
    <div class="card accent">
      <div class="card-h">Ending level</div>
      ${accountBoxes(state)}
      <div class="up-two" style="margin-top:10px" data-end></div>
      <div class="hint">Store and one key per level give the same XP. A key that jumps several levels only gives the XP of the level it lands on.</div>
    </div>`;

  const cell = (label, cost, sub) => `<div class="up-cost"><span>${label}</span><b class="mono">${cost}</b>${sub ? `<em>${sub}</em>` : ""}</div>`;
  const update = () => {
    const lv = resolve(state);
    const r = U().build(usable(lv));
    const by = Object.fromEntries(r.rows.map((p) => [p.key, p]));
    for (const it of U().ITEMS) {
      const p = by[it.key], l = lv[it.key];
      $(`[data-err="${it.key}"]`, main).innerHTML = l.error ? `<span class="up-bad">${esc(l.error)}</span>` : "";
      $(`[data-row="${it.key}"]`, main).classList.toggle("on", !!p);
      const noKey = it.cat === "keygen" ? "Keygen can't be a key" : it.cat === "once" ? "store only" : it.cat === "hw" ? "store only" : "—";
      $(`[data-out="${it.key}"]`, main).innerHTML = !p ? "" :
        cell("Store", n(p.store.cost), `+${n(p.store.xp)} XP`) +
        (p.single ? cell("1-level keys", n(p.single.cost), `+${n(p.single.xp)} XP · ${p.to - p.from} key${p.to - p.from === 1 ? "" : "s"}`) : cell("1-level keys", `<small class="muted">${noKey}</small>`)) +
        (p.jump ? cell("Big jump", n(p.jump.cost), `+${n(p.jump.xp)} XP · ${p.from}→${p.to}`) : cell("Big jump", `<small class="muted">${noKey}</small>`));
    }
    $("[data-total]", main).innerHTML = cell("Store", n(r.store.cost)) + cell("1-level keys", n(r.single.cost)) + cell("Big jumps", n(r.jump.cost));
    const kgTo = lv.keygen.error ? null : lv.keygen.to;
    $("[data-kg]", main).textContent = !r.rows.length ? "Enter a start and end level above to see totals."
      : r.keygenNeeded ? `Key totals use the store price for things keys can't buy. Keys need Keygen ${r.keygenNeeded}+${kgTo !== null && kgTo >= r.keygenNeeded ? " (your Keygen box covers it)." : ". Add Keygen above to include what raising it costs."}` : "";
    const a = account(state);
    $("[data-now]", main).innerHTML = nowText(a, state);
    const A = a.land(r.store.xp), B = a.land(r.jump.xp);
    $("[data-end]", main).innerHTML =
      cell("Store or 1-level keys", A ? `LVL ${A.level}` : "—", A ? `+${n(r.store.xp)} XP · ${n(A.exp)} / ${n(A.required)}` : "") +
      cell("Big jumps", B ? `LVL ${B.level}` : "—", B ? `+${n(r.jump.xp)} XP · ${n(B.exp)} / ${n(B.required)}` : "");
  };
  wire(main, state, KEY, update);
  update();
  $("[data-import]", main).onclick = async () => { if (await importInto(state)) { keep(KEY, state); render(); } };
  $("[data-clear]", main).onclick = async () => {
    if (!(await O().confirmBox({ title: "Clear the calculator?", body: "Empties every start and end level and your account level.", ok: "Clear", danger: true }))) return;
    keep(KEY, {}); render();
  };
};

/* =========================================================
   CHARACTER BUILDER
   ========================================================= */
PAGES.builder = async function pageBuilder(main) {
  const { esc, $, $$, render, S } = O();
  const KEY = "olc-builder";
  const state = load(KEY);
  const dev = await G().myDevice().catch(() => null);
  if (state.reboot == null) state.reboot = String(dev?.reboots ?? 0);
  let shot = null;

  main.innerHTML = `
    <div class="row" style="margin:0 2px 12px"><button class="btn sm" data-import>Import my device</button>
      <span class="grow"></span><button class="btn sm danger" data-reset>Reset</button></div>

    <div class="card accent">
      <div class="up-three-in">
        <label class="up-f"><span>Reboot</span><select class="input" data-reboot>${Array.from({ length: 31 }, (_, i) =>
          `<option value="${i}" ${String(state.reboot) === String(i) ? "selected" : ""}>R${i}</option>`).join("")}</select></label>
        ${accountBoxes(state).replace('<div class="up-two">', "").replace('</div><div class="hint" data-now></div>', "")}
      </div>
      <div class="hint" data-now></div>
      <div data-results style="margin-top:10px"></div>
      <div class="hint up-warn" data-kg></div>
    </div>

    ${U().GROUPS.map((g) => `
      <div class="up-group">${esc(g.title)}</div>
      <div class="up-grid">${g.keys.map((k) => {
        const it = U().BY_KEY[k];
        return `<div class="up-card" data-row="${k}">
          <div class="up-name">${esc(it.name)}</div>
          <div class="up-two">
            ${levelBox(k, "from", "Current", state.cur?.[k], k === "botnet" ? "Free" : it.cat === "once" ? "No" : String(it.min))}
            ${levelBox(k, "to", "End", state.end?.[k], "—")}
          </div>
          <div class="up-two up-costs" data-out="${k}"></div>
        </div>`;
      }).join("")}</div>`).join("")}

    <div class="card accent" style="margin-top:14px">
      <div class="card-h">Totals</div>
      <div class="up-two up-totals" data-total></div>
      <div class="hint">The Keygen total uses the store price for Device, Network, Botnet, Keygen and one-time items, since keys can't buy those.</div>
    </div>

    <div class="card">
      <div class="card-h">Share this build</div>
      <p class="small muted" style="margin-top:0">One picture of your whole build: every upgrade, where the account lands, and the totals.</p>
      <button class="btn primary block" data-shot>Make image</button>
      <div data-shotbox></div>
    </div>`;

  let last = null;
  const update = () => {
    const lv = resolve(state);
    const r = U().build(usable(lv));
    const by = Object.fromEntries(r.rows.map((p) => [p.key, p]));
    for (const it of U().ITEMS) {
      const p = by[it.key], l = lv[it.key];
      $(`[data-row="${it.key}"]`, main).classList.toggle("on", !!p);
      $(`[data-out="${it.key}"]`, main).innerHTML = l.error ? `<div class="up-bad" style="grid-column:1/-1">${esc(l.error)}</div>` :
        `<div><span>Store</span><b class="mono">${p ? n(p.store.cost) : "—"}</b></div>
         <div><span>Keygen</span><b class="mono">${!U().canKey(it.key) ? `<small class="muted">store only</small>` : p ? n(p.jump.cost) : "—"}</b></div>`;
    }
    const a = account(state);
    $("[data-now]", main).innerHTML = nowText(a, state) + (a.ok ? " · Prices and XP are the same on every reboot so far." : "");
    const one = a.land(r.store.xp), jump = a.land(r.jump.xp), m2 = a.land(r.mix2.xp), m3 = a.land(r.mix3.xp);
    const cap = (l) => (l >= U().MIX_CAP ? `${U().MIX_CAP}+` : String(l));
    let mix = "—";
    if (m2 && m3) {
      const lo = cap(Math.min(m2.level, m3.level)), hi = cap(Math.max(m2.level, m3.level));
      mix = lo === hi ? lo : `${lo}–${hi}`;
    }
    const mixCost = r.mix2.cost === r.mix3.cost ? n(r.mix2.cost) : `${n(Math.min(r.mix2.cost, r.mix3.cost))} – ${n(Math.max(r.mix2.cost, r.mix3.cost))}`;
    const res = (label, val, line, sub) => `<div class="up-res"><div class="up-res-top"><span>${label}</span><b class="mono">${val}</b></div>
      <div class="tiny mono muted">${line}</div>${sub ? `<div class="hint" style="margin-top:2px">${sub}</div>` : ""}</div>`;
    $("[data-results]", main).innerHTML =
      res("One level at a time", one ? `LVL ${one.level}` : "—", `Store ${n(r.store.cost)} · 1-level keys ${n(r.single.cost)} · +${n(r.store.xp)} XP`, "Store and 1-level keys give the same XP.") +
      res("One Keygen jump", jump ? `LVL ${jump.level}` : "—", `${n(r.jump.cost)} Crypto · +${n(r.jump.xp)} XP`, "Each app jumps straight to its end level: only the end level's XP.") +
      res("Mix: 2–3 level jumps", m2 && m3 ? `≈ LVL ${mix}` : "—", `${mixCost} Crypto · +${n(Math.min(r.mix2.xp, r.mix3.xp))}–${n(Math.max(r.mix2.xp, r.mix3.xp))} XP`,
        `Estimate, shown up to LVL ${U().MIX_CAP}. Past ${U().MIX_CAP}, apps above 40 are rarely downloadable, so it's mostly store buying.`);
    const kgTo = lv.keygen.error ? null : lv.keygen.to;
    $("[data-kg]", main).textContent = r.keygenNeeded && kgTo !== null && kgTo < r.keygenNeeded
      ? `Keys need Keygen ${r.keygenNeeded}. Raise Keygen's end level to ${r.keygenNeeded} (Keygen is store only).` : "";
    $("[data-total]", main).innerHTML = `
      <div><span>Store cost</span><b class="mono">${n(r.store.cost)}</b></div>
      <div><span>Keygen cost (one jump)</span><b class="mono">${n(r.jump.cost)}</b></div>
      <div><span>XP one level at a time</span><b class="mono">+${n(r.store.xp)}</b></div>
      <div><span>XP one Keygen jump</span><b class="mono">+${n(r.jump.xp)}</b></div>`;
    last = { lv, r, a, one, jump, mix: m2 && m3 ? `≈ ${mix}` : "—", mixCost };
  };
  wire(main, state, KEY, update);
  $("[data-reboot]", main).onchange = (e) => { state.reboot = e.target.value; keep(KEY, state); };
  update();

  $("[data-import]", main).onclick = async () => {
    if (await importInto(state)) { const d = await G().myDevice().catch(() => null); state.reboot = String(d?.reboots ?? state.reboot ?? 0); keep(KEY, state); render(); }
  };
  $("[data-reset]", main).onclick = async () => {
    if (!(await O().confirmBox({ title: "Reset current levels?", body: "Sets every current level to zero. Device and Network go to 1 and Botnet to Free, the lowest they can be.", ok: "Reset", danger: true }))) return;
    state.cur = Object.fromEntries(U().ITEMS.map((it) => [it.key, String(it.min)]));
    keep(KEY, state); render();
  };

  $("[data-shot]", main).onclick = async () => {
    const { lv, r, a, one, jump, mix, mixCost } = last;
    const by = Object.fromEntries(r.rows.map((p) => [p.key, p]));
    const blob = await drawImage({
      title: "Character Build",
      subtitle: `${S.profile.username} · R${state.reboot ?? 0} · start LVL ${a.level}${a.ok ? ` · ${n(a.exp)} / ${n(a.req)}` : ""}`,
      groups: U().GROUPS.map((g) => ({ title: g.title, cards: g.keys.map((k) => {
        const p = by[k], l = lv[k];
        return { name: U().BY_KEY[k].name, from: levelText(k, l.from), to: levelText(k, l.to), changed: !!p,
          store: p ? n(p.store.cost) : "", key: !U().canKey(k) ? "store only" : p ? n(p.jump.cost) : "" };
      }) })),
      results: [
        { label: "One level at a time", value: one ? `LVL ${one.level}` : "—", line: `Store ${n(r.store.cost)} · keys ${n(r.single.cost)} · +${n(r.store.xp)} XP` },
        { label: "One Keygen jump", value: jump ? `LVL ${jump.level}` : "—", line: `${n(r.jump.cost)} Crypto · +${n(r.jump.xp)} XP` },
        { label: "Mix: 2–3 level jumps", value: mix, line: `${mixCost} Crypto · estimate` }
      ],
      totals: [
        { label: "Store cost", value: n(r.store.cost) }, { label: "Keygen cost (one jump)", value: n(r.jump.cost) },
        { label: "XP one level at a time", value: `+${n(r.store.xp)}` }, { label: "XP one Keygen jump", value: `+${n(r.jump.xp)}` }
      ],
      footer: `OLC Database · Character Builder · ${new Date().toLocaleDateString()}`
    });
    if (shot) URL.revokeObjectURL(shot.url);
    shot = { url: URL.createObjectURL(blob), file: new File([blob], `character-build-${new Date().toISOString().slice(0, 10)}.png`, { type: "image/png" }) };
    $("[data-shot]", main).textContent = "Update image";
    $("[data-shotbox]", main).innerHTML = `<img class="up-shot" src="${shot.url}" alt="Your character build as one picture">
      <button class="btn block" data-save style="margin-top:10px">Save or share image</button>
      <div class="hint">On iPhone you can also press and hold the picture, then tap Save to Photos.</div>`;
    $("[data-save]", main).onclick = async () => {
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [shot.file] })) {
        try { await navigator.share({ files: [shot.file], title: "Character Build" }); return; }
        catch (e) { if (e && e.name === "AbortError") return; }
      }
      const link = document.createElement("a");
      link.href = shot.url; link.download = shot.file.name;
      document.body.appendChild(link); link.click(); link.remove();
    };
  };
};

/* ---------- share picture (landscape, like a game's character sheet) ---------- */
function drawImage(d) {
  const W = 1600, H = 1040;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d");
  const css = getComputedStyle(document.documentElement);
  const v = (name, fb) => css.getPropertyValue(name).trim() || fb;
  const accent = v("--accent", "#34f08a"), bg = v("--bg", "#050a07"), panel = v("--panel", "#0c1811"), panel2 = v("--panel-2", "#10201a"),
    line = v("--line", "#1c3326"), text = v("--text", "#d6f5e2"), dim = v("--dim", "#7fa391"), faint = v("--faint", "#4d6b5b");
  const FONT = "Inter, system-ui, -apple-system, sans-serif", MONO = "'JetBrains Mono', ui-monospace, Menlo, monospace";
  const box = (x, y, w, h, r, fill, stroke) => {
    g.beginPath();
    if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h);
    g.fillStyle = fill; g.fill();
    if (stroke) { g.lineWidth = 2; g.strokeStyle = stroke; g.stroke(); }
  };
  const write = (s, x, y, size, o = {}) => {
    let px = size;
    const set = () => (g.font = `${o.weight || 400} ${px}px ${o.mono ? MONO : FONT}`);
    set();
    while (o.maxW && g.measureText(s).width > o.maxW && px > 9) { px--; set(); }
    g.fillStyle = o.color || text; g.textAlign = o.align || "left"; g.textBaseline = "alphabetic";
    g.fillText(s, x, y);
  };
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  box(24, 20, W - 48, 76, 14, panel, line);
  write(d.title, 48, 70, 34, { weight: 700 });
  write(d.subtitle, W - 48, 68, 24, { color: dim, align: "right", mono: true, maxW: 900 });

  const left = 24, labelW = 120, gap = 10, cols = 5, top = 116, rowH = 164;
  const cardW = (1060 - left - labelW - gap * cols) / cols;
  d.groups.forEach((grp, i) => {
    const y = top + i * (rowH + gap);
    box(left, y, labelW, rowH, 12, panel, line);
    const words = grp.title.split(/\s+/);
    words.forEach((w, j) => write(w.toUpperCase(), left + labelW / 2, y + rowH / 2 - (words.length - 1) * 12 + j * 24 + 6, 16,
      { weight: 700, color: dim, align: "center", maxW: labelW - 12, mono: true }));
    grp.cards.forEach((card, j) => {
      const x = left + labelW + gap + j * (cardW + gap);
      box(x, y, cardW, rowH, 12, card.changed ? panel2 : panel, card.changed ? accent : line);
      write(card.name, x + cardW / 2, y + 30, 19, { weight: 600, align: "center", maxW: cardW - 16, color: card.changed ? text : dim });
      if (card.changed) {
        write(`${card.from} → ${card.to}`, x + cardW / 2, y + 78, 30, { weight: 700, mono: true, align: "center", maxW: cardW - 14, color: accent });
        write("STORE", x + 12, y + 112, 12, { weight: 700, color: faint, mono: true });
        write(card.store, x + cardW - 12, y + 112, 16, { mono: true, align: "right", maxW: cardW - 70 });
        write("KEYGEN", x + 12, y + 142, 12, { weight: 700, color: faint, mono: true });
        write(card.key, x + cardW - 12, y + 142, 16, { mono: true, align: "right", maxW: cardW - 80, color: card.key === "store only" ? dim : text });
      } else {
        write(card.from, x + cardW / 2, y + 96, 34, { weight: 700, mono: true, align: "center", maxW: cardW - 14, color: faint });
      }
    });
  });

  const rx = 1080, rw = W - 24 - rx;
  let y = top;
  write("WHERE THE ACCOUNT LANDS", rx + 4, y + 18, 15, { weight: 700, color: dim, mono: true });
  y += 32;
  for (const res of d.results) {
    box(rx, y, rw, 104, 12, panel, line);
    write(res.label, rx + 18, y + 36, 20, { weight: 600, maxW: rw - 200 });
    write(res.value, rx + rw - 18, y + 40, 32, { weight: 700, mono: true, align: "right", color: accent });
    write(res.line, rx + 18, y + 80, 16, { mono: true, color: dim, maxW: rw - 36 });
    y += 116;
  }
  y += 8;
  write("TOTALS", rx + 4, y + 18, 15, { weight: 700, color: dim, mono: true });
  y += 32;
  const tw = (rw - 10) / 2;
  d.totals.forEach((t, i) => {
    const x = rx + (i % 2) * (tw + 10), ty = y + Math.floor(i / 2) * 96;
    box(x, ty, tw, 86, 12, panel2, line);
    write(t.label.toUpperCase(), x + 14, ty + 30, 13, { weight: 700, color: faint, maxW: tw - 28, mono: true });
    write(t.value, x + 14, ty + 68, 28, { weight: 700, mono: true, maxW: tw - 28 });
  });
  write(d.footer, W - 30, H - 22, 15, { color: dim, align: "right" });
  return new Promise((ok, bad) => c.toBlob((b) => (b ? ok(b) : bad(new Error("Couldn't make the image"))), "image/png"));
}

/* =========================================================
   FORMULAS (Admin) — kept here for safe keeping
   ========================================================= */
const EXACT = () => {
  const u = U();
  return `HACK EX2 FORMULAS — EXACT (for Claude / code)
Verified against 397 real game reports (HEDB export 2026-10-28): 135/135 store prices, 99/99 key prices,
78/78 software XP, every Device/Network/Botnet XP report, 29/29 character XP targets. Reboots R2–R4: no change.

// Store price to reach software level L (L >= 1)
BASE = { firewall: 800, bypasser: 800, password_encryptor: 1100, password_cracker: 1100, antivirus: 1000,
         proxy: 900, trace: 900, spam: 1800, siphon: 1600, rootkit: 1400, keygen: 600 }
DEFENSIVE = { firewall, password_encryptor, antivirus, proxy, trace }
storePrice(app, L) = p = ceil(BASE[app] * L^1.3); if DEFENSIVE: ceil(p * 0.85)

// Keygen key from level A to level B (jump = B - A >= 1). Needs Keygen >= B. Keygen itself can't be a key.
keyPrice(app, A, B) = ceil(storePrice(app, B) * 0.5 * min(1, 0.3 + 0.7 * (B - A - 1) / 19))

// Software XP for reaching level L (store, or a key landing on L)
softXp(app, L) = a = ceil(BASE[app] * L^1.25); if DEFENSIVE: a = ceil(a * 0.85); floor(a * 0.2)
// A key that jumps several levels gives ONLY softXp(app, B). Skipped levels give 0 XP.

// Hardware: fixed price to reach each level; XP from the price
DEVICE  price L2..12 = 4000, 10000, 18000, 28000, 40000, 56000, 82000, 120000, 160000, 220000, 300000; XP = round(price * 0.25)
NETWORK price L2..11 = 3000, 7000, 12000, 20000, 30000, 44000, 60000, 85000, 120000, 170000;           XP = round(price * 0.20)
BOTNET  price L2..7  = 800 (Node), 3500 (Cluster), 15000 (Grid), 42000 (Farm), 95000 (Hive), 180000 (Nexus); XP = floor(price / 6)
        L1 = Free (2 slots). Slots: Free 2, Node 4, Cluster 8, Grid 16, Farm 28, Hive 44, Nexus 64. Node needs player LVL 3.

// One-time items
NOTEPAD           price 5000, XP 1000
MESSAGE_ENCRYPTOR price 9000, XP 1800

// Character: XP shown after "/" at LVL L (XP to reach L+1)
charTarget(L) = ceil(230 * (L + 1)^1.3544)        // LVL 1 = 589
// Leftover XP carries over: while (xp >= charTarget(L)) { xp -= charTarget(L); L++ }

// Checks
storePrice(spam, 20) = ${n(u.softPrice("spam", 20))} · storePrice(firewall, 27) = ${n(u.softPrice("firewall", 27))}
keyPrice(siphon, 17, 18) = ${n(u.keyPrice("siphon", 17, 18))} · keyPrice(password_cracker, 2, 4) = ${n(u.keyPrice("password_cracker", 2, 4))}
softXp(firewall, 27) = ${n(u.softXp("firewall", 27))} · softXp(password_cracker, 4) = ${n(u.softXp("password_cracker", 4))}
charTarget(34) = ${n(u.charTarget(34))} · charTarget(46) = ${n(u.charTarget(46))}`;
};

PAGES.formulas = async function pageFormulas(main) {
  const { esc, $, isAdmin } = O();
  if (!isAdmin()) { main.innerHTML = `<div class="card"><div class="empty">Admin only.</div></div>`; return; }
  const exact = EXACT();
  main.innerHTML = `
    <div class="tiny muted" style="margin:0 4px 12px">Every verified Hack EX2 formula, kept for safe keeping. Give either block back to Claude and it will recognise them.</div>
    <div class="card"><div class="card-h">Exact formulas<span class="r">for Claude</span></div>
      <button class="btn block" data-copy="exact" style="margin-bottom:12px">Copy exact formulas</button>
      <pre class="up-sheet">${esc(exact)}</pre></div>
    <div class="card"><div class="card-h">Plain English</div>
      <button class="btn block" data-copy="sheet" style="margin-bottom:12px">Copy plain version</button>
      <pre class="up-sheet">${esc(U().SHEET)}</pre></div>`;
  const copyText = async (t, label) => {
    try { await navigator.clipboard.writeText(t); O().toast(`Copied ${label}`); }
    catch (e) { G().copy(t); }
  };
  $("[data-copy=exact]", main).onclick = () => copyText(exact, "exact formulas");
  $("[data-copy=sheet]", main).onclick = () => copyText(U().SHEET, "formulas");
};
})();
