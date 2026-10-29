/* =========================================================
   OLC Database — upgrade maths (from HEDB, verified with real game data)
   Store prices, Keygen key prices, upgrade XP and character XP.
   Used by the Calculator and the Character Builder.
   ========================================================= */
(() => {
"use strict";

/* ---------- what can be upgraded ---------- */
// category: hw = Device/Network/Botnet, sw = apps keys can buy, keygen, once = one-time items
const ITEMS = [
  { key: "device", name: "Device", cat: "hw", min: 1, max: 12 },
  { key: "network", name: "Network", cat: "hw", min: 1, max: 11 },
  { key: "botnet", name: "Botnet", cat: "hw", min: 1, max: 7 },
  { key: "bypasser", name: "Bypasser", cat: "sw", min: 0, max: null },
  { key: "password_cracker", name: "Password Cracker", cat: "sw", min: 0, max: null },
  { key: "firewall", name: "Firewall", cat: "sw", min: 0, max: null },
  { key: "password_encryptor", name: "Password Encryptor", cat: "sw", min: 0, max: null },
  { key: "antivirus", name: "Antivirus", cat: "sw", min: 0, max: null },
  { key: "proxy", name: "Proxy", cat: "sw", min: 0, max: null },
  { key: "trace", name: "Trace", cat: "sw", min: 0, max: null },
  { key: "spam", name: "Spam", cat: "sw", min: 0, max: null },
  { key: "siphon", name: "Siphon", cat: "sw", min: 0, max: null },
  { key: "rootkit", name: "Rootkit", cat: "sw", min: 0, max: null },
  { key: "keygen", name: "Keygen", cat: "keygen", min: 0, max: null },
  { key: "notepad", name: "Notepad", cat: "once", min: 0, max: 1 },
  { key: "message_encryptor", name: "Message Encryptor", cat: "once", min: 0, max: 1 }
];
const BY_KEY = Object.fromEntries(ITEMS.map((i) => [i.key, i]));
const GROUPS = [
  { title: "Hardware", keys: ["device", "network", "botnet"] },
  { title: "Offensive", keys: ["bypasser", "password_cracker"] },
  { title: "Defensive", keys: ["firewall", "password_encryptor", "antivirus", "proxy", "trace"] },
  { title: "Viruses", keys: ["spam", "siphon", "rootkit"] },
  { title: "Keygen & one-time", keys: ["keygen", "notepad", "message_encryptor"] }
];
const BOTNET_TIERS = ["Free", "Node", "Cluster", "Grid", "Farm", "Hive", "Nexus"];
const MIX_CAP = 50;   // the 2–3 level jump estimate stops at account LVL 50

/* ---------- prices ---------- */
const BASE = { firewall: 800, bypasser: 800, password_encryptor: 1100, password_cracker: 1100, antivirus: 1000,
  proxy: 900, trace: 900, spam: 1800, siphon: 1600, rootkit: 1400, keygen: 600 };
const DEFENSIVE = new Set(["firewall", "password_encryptor", "antivirus", "proxy", "trace"]);
// hardware price to reach each level (index = level)
const HW_PRICE = {
  device: [null, null, 4000, 10000, 18000, 28000, 40000, 56000, 82000, 120000, 160000, 220000, 300000],
  network: [null, null, 3000, 7000, 12000, 20000, 30000, 44000, 60000, 85000, 120000, 170000],
  botnet: [null, null, 800, 3500, 15000, 42000, 95000, 180000]
};
const ONCE = { notepad: { price: 5000, xp: 1000 }, message_encryptor: { price: 9000, xp: 1800 } };

/** Store price to reach level L: ceil(base × L^1.3), then ceil(× 0.85) for defensive apps. */
function softPrice(key, L) {
  const b = BASE[key];
  if (b === undefined || L < 1) return null;
  const p = Math.ceil(b * Math.pow(L, 1.3));
  return DEFENSIVE.has(key) ? Math.ceil(p * 0.85) : p;
}
/** XP for reaching level L: floor(0.2 × ceil(ceil(base × L^1.25) × 0.85 for defensive)). */
function softXp(key, L) {
  const b = BASE[key];
  if (b === undefined || L < 1) return null;
  const a = Math.ceil(b * Math.pow(L, 1.25));
  return Math.floor((DEFENSIVE.has(key) ? Math.ceil(a * 0.85) : a) * 0.2);
}
/** Keygen key from A to B: ceil(store(B) × 0.5 × min(1, 0.3 + 0.7 × (B − A − 1) / 19)). */
function keyPrice(key, a, b) {
  const s = softPrice(key, b);
  if (s === null || b - a < 1) return null;
  return Math.ceil(s * 0.5 * Math.min(1, 0.3 + (0.7 * (b - a - 1)) / 19));
}
/** Price and XP of one store level of anything. */
function storeLevel(key, L) {
  const it = BY_KEY[key];
  if (it.cat === "once") return L === 1 ? { ...ONCE[key] } : null;
  if (it.cat === "hw") {
    const p = HW_PRICE[key][L];
    if (p == null) return null;
    const xp = key === "device" ? Math.round(p * 0.25) : key === "network" ? Math.round(p * 0.2) : Math.floor(p / 6);
    return { price: p, xp };
  }
  return { price: softPrice(key, L), xp: softXp(key, L) };
}
const canKey = (key) => BY_KEY[key].cat === "sw";

/* ---------- character ---------- */
/** XP needed at LVL L (the number after "/"): ceil(230 × (L+1)^1.3544). */
const charTarget = (L) => (Number.isInteger(L) && L >= 1 ? Math.ceil(230 * Math.pow(L + 1, 1.3544)) : null);
/** Adds XP; leftover carries over on level-up. */
function addXp(level, exp, gain) {
  let req = charTarget(level), xp = exp + gain;
  while (req !== null && xp >= req) { xp -= req; level += 1; req = charTarget(level); }
  return { level, exp: xp, required: req };
}

/* ---------- one upgrade, from → to ---------- */
function plan(key, from, to) {
  if (!(to > from)) return null;
  let cost = 0, xp = 0;
  for (let L = from + 1; L <= to; L++) {
    const s = storeLevel(key, L);
    if (!s) return null;
    cost += s.price; xp += s.xp;
  }
  const store = { cost, xp };
  if (!canKey(key)) return { key, from, to, store, single: null, jump: null };
  let sc = 0;
  for (let L = from + 1; L <= to; L++) sc += keyPrice(key, L - 1, L);
  return {
    key, from, to, store,
    single: { cost: sc, xp },                                        // one 1-level key per level: same XP as the store
    jump: { cost: keyPrice(key, from, to), xp: softXp(key, to) }     // one key straight there: landing level XP only
  };
}
/** Keys of `step` levels at a time (last one may be shorter); store for things keys can't buy. */
function chunked(p, step) {
  if (!p.jump) return { ...p.store };
  const s = { cost: 0, xp: 0 };
  for (let a = p.from; a < p.to; a += step) {
    const b = Math.min(a + step, p.to);
    s.cost += keyPrice(p.key, a, b); s.xp += softXp(p.key, b);
  }
  return s;
}

/** A whole build: levels = { key: { from, to } }. */
function build(levels) {
  const rows = [];
  for (const it of ITEMS) {
    const l = levels[it.key];
    const p = l ? plan(it.key, l.from, l.to) : null;
    if (p) rows.push(p);
  }
  const sum = () => ({ cost: 0, xp: 0 });
  const store = sum(), single = sum(), jump = sum(), mix2 = sum(), mix3 = sum();
  const add = (s, o) => { s.cost += o.cost; s.xp += o.xp; };
  let keygenNeeded = 0;
  for (const p of rows) {
    add(store, p.store); add(single, p.single || p.store); add(jump, p.jump || p.store);
    add(mix2, chunked(p, 2)); add(mix3, chunked(p, 3));
    if (p.jump) keygenNeeded = Math.max(keygenNeeded, p.to);
  }
  return { rows, store, single, jump, mix2, mix3, keygenNeeded };
}

const n = (v) => Number(v).toLocaleString("en-US");
const SHEET = `HACK EX2 FORMULAS (verified with real game data)

STORE PRICES (apps)
• Price for level L = base × L^1.3, rounded up
• Defensive apps (Firewall, Password Encryptor, Antivirus, Proxy, Trace): then × 0.85, rounded up
• Base prices: Spam ${n(BASE.spam)} · Siphon ${n(BASE.siphon)} · Rootkit ${n(BASE.rootkit)} · Password Cracker ${n(BASE.password_cracker)} · Password Encryptor ${n(BASE.password_encryptor)} · Antivirus ${n(BASE.antivirus)} · Proxy ${n(BASE.proxy)} · Trace ${n(BASE.trace)} · Firewall ${n(BASE.firewall)} · Bypasser ${n(BASE.bypasser)} · Keygen ${n(BASE.keygen)}

HARDWARE & ONE-TIME PRICES (fixed)
• Device Lv 2–12: 4k, 10k, 18k, 28k, 40k, 56k, 82k, 120k, 160k, 220k, 300k
• Network Lv 2–11: 3k, 7k, 12k, 20k, 30k, 44k, 60k, 85k, 120k, 170k
• Botnet: Node 800 · Cluster 3,500 · Grid 15,000 · Farm 42,000 · Hive 95,000 · Nexus 180,000
• Notepad 5,000 · Message Encryptor 9,000

KEYGEN KEY PRICES
• Key from level A to B = store price of level B × 0.5 × (0.3 + 0.7 × (B − A − 1) ÷ 19), rounded up
• That last part maxes out at 1, so: 1-level jump = 15% of the store price, 20+ levels = 50%
• You need Keygen level B or higher. Your Keygen level doesn't change the price.

UPGRADE XP
• XP for reaching level L = 20% of (base × L^1.25 rounded up, then × 0.85 rounded up for defensive apps), rounded down
• A key only gives the XP of the level it lands on. Skipped levels give no XP.
• Device = 25% of its price · Network = 20% · Botnet = price ÷ 6, rounded down · Notepad 1,000 · Message Encryptor 1,800

CHARACTER LEVELS
• XP needed at LVL L (the number after the "/") = 230 × (L + 1)^1.3544, rounded up
• LVL 1 = 589. Leftover XP carries over when you level up. Reboots don't change it.

TIPS
• Cheapest XP: keys one level at a time (about 1 XP per Crypto vs about 0.2 in the store)
• Big key jumps: cheapest way to raise an app's level, but you lose the skipped levels' XP

From OLC Database`;

const API = { ITEMS, BY_KEY, GROUPS, BOTNET_TIERS, MIX_CAP, softPrice, softXp, keyPrice, storeLevel, canKey,
  charTarget, addXp, plan, chunked, build, SHEET };
if (typeof window !== "undefined") window.OLC_UPG = API;
if (typeof module !== "undefined") module.exports = API;
})();
