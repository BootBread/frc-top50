// Rules for the POWER UP Arcade (FRC 2018 POWER UP, one robot per alliance, d20 checks).
// Pure functions over a JSON state object, so the same file runs in the Worker (which owns the
// match and rolls every die) and in the browser (move previews and odds).
// Functions that change the match push UI events into `out`:
//   {t: "log", html, cls}  {t: "die", idx, nat, what, math, res, cls}  {t: "popup", idx, kind, noun}

export const COLS = "ABCDEFGHIJK";
export const STATS = [
  ["SPD", "Speed", "how many squares you drive"],
  ["INT", "Intake", "grab cubes, feed the exchange"],
  ["ACC", "Accuracy", "land cubes on plates"],
  ["CLB", "Climb", "face the boss in the endgame"],
];
export const KEYS = STATS.map((s) => s[0]);
export const COST = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
export const BUDGET = 20;
export const START = { SPD: 13, INT: 12, ACC: 15, CLB: 10 };
export const STD = [15, 13, 12, 10];
export const FEATS = {
  lucky:  { name: "Lucky",         desc: "3 luck tokens. When you fail a roll, spend one to reroll." },
  mobile: { name: "Mobile",        desc: "Move 1.5 times as far as everyone else (rounded down)." },
  intake: { name: "Intake Master", desc: "Intake as a bonus action, so you can still place, exchange or climb that turn." },
  climb:  { name: "Climb Master",  desc: "A successful climb also scores 1 buddy climb (+60 total)." },
};
export const DC = { intake: 10, portal: 8, exchange: 7, switch: 10, scale: 16, climb: 16 };
export const NAMES = ["Sir Bumps-a-Lot", "The Forklift", "Cube Goblin", "Rung Raider", "Elevator Lich", "Brownout", "Lord of the Scale", "Gearbox Bard", "Plate Paladin", "Null Territory"];
export const ROUNDS = 15;
export const ALN = { R: "RED", B: "BLUE" };

// ---------- field ----------
export const TYPE = {};
const setT = (cells, t) => cells.forEach((c) => (TYPE[c] = t));
setT(["A1", "A7"], "portalB"); setT(["K1", "K7"], "portalR");
setT(["A4"], "exR"); setT(["K4"], "exB");
setT(["D3", "D4", "D5", "H3", "H4", "H5"], "fence");
setT(["D2", "D6", "H2", "H6"], "swplate");
setT(["F4"], "tower");
setT(["E3", "E4", "E5"], "platR"); setT(["G3", "G4", "G5"], "platB"); setT(["F3", "F5"], "plat");
setT(["F1", "F7"], "null");
export const BLOCKED = { fence: 1, swplate: 1, tower: 1 };
export const SWITCH = { R: ["D2", "D6"], B: ["H2", "H6"] };
export const SCALE = ["F1", "F7"];
export const EXCH = { R: "A4", B: "K4" };
export const PORTALS = { R: ["K1", "K7"], B: ["A1", "A7"] };
export const PLAT = { R: ["E3", "E4", "E5"], B: ["G3", "G4", "G5"] };
const DIRS = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

export const ci = (c) => COLS.indexOf(c[0]);
export const ri = (c) => +c.slice(1);
export const cellId = (x, y) => COLS[x] + y;
export const cheb = (a, b) => Math.max(Math.abs(ci(a) - ci(b)), Math.abs(ri(a) - ri(b)));
export const adj = (a, b) => cheb(a, b) <= 1;
export const nbrs = (c) => DIRS.map(([dx, dy]) => [ci(c) + dx, ri(c) + dy])
  .filter(([x, y]) => x >= 0 && x <= 10 && y >= 1 && y <= 7).map(([x, y]) => cellId(x, y));
export const parseCell = (s) => { const m = /^([a-k])([1-7])$/i.exec(s || ""); return m ? m[1].toUpperCase() + m[2] : null; };

// ---------- helpers ----------
export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export const mod = (s) => Math.floor((s - 10) / 2);
export const sgn = (n) => (n >= 0 ? "+" : "") + n;
export const roll = (n, rng) => 1 + Math.floor(rng() * n);
const pick = (a, rng) => a[Math.floor(rng() * a.length)];
const tag = (r) => `<b class="${r.al}">${esc(r.t)}</b>`;
const log = (out, html, cls) => out.push({ t: "log", html, cls });

export function spent(base) { return KEYS.reduce((a, k) => a + (COST[base[k]] ?? 99), 0); }

export function derived(b) {
  const f = { ...b.base }, m = {};
  KEYS.forEach((k) => (m[k] = mod(f[k])));
  const sq = 2 + (m.SPD >= 2 ? 1 : 0);
  return { f, m, sq: b.feat === "mobile" ? Math.floor(sq * 1.5) : sq };
}

// Returns a clean copy of a robot build, or throws a message for the player.
export function cleanBuild(b) {
  if (!b || typeof b !== "object") throw "Missing robot.";
  const name = String(b.name || "").trim().slice(0, 24) || "Unnamed";
  if (!FEATS[b.feat]) throw "Pick a feat.";
  const method = b.method === "roll" ? "roll" : "buy";
  const base = {};
  for (const k of KEYS) {
    const v = Number(b.base && b.base[k]);
    if (!Number.isInteger(v) || v < 3 || v > 18) throw `Bad ${k} score.`;
    base[k] = v;
  }
  if (method === "buy" && spent(base) > BUDGET) throw "Point buy is over budget.";
  return { name, feat: b.feat, method, base };
}
export function cleanTeam(t) {
  const v = String(t || "").trim();
  if (!/^\d{1,5}$/.test(v) || +v === 0) throw "Team number must be 1 to 99999.";
  return String(+v);
}

export function randomBuild(rng, avoid) {
  const base = {};
  KEYS.slice().sort(() => rng() - 0.5).forEach((k, i) => (base[k] = STD[i]));
  return { name: pick(NAMES.filter((n) => n !== avoid), rng), feat: pick(Object.keys(FEATS), rng), method: "buy", base };
}

// ---------- match state ----------
// players: [{team, nick, build, al: "R"|"B", bot}] in any order; robots are stored red first.
export function newMatch(players) {
  const flip = (rng) => (rng < 0.5 ? ["R", "B"] : ["B", "R"]);
  const robots = ["R", "B"].map((al) => {
    const p = players.find((x) => x.al === al), d = derived(p.build);
    return { t: p.team, nick: p.nick || "", name: p.build.name, al, bot: !!p.bot, at: al === "R" ? "B4" : "J4",
      m: d.m, sq: d.sq, feat: p.build.feat, luck: p.build.feat === "lucky" ? 3 : 0, skip: false, cube: true, climbed: false };
  });
  const r3 = [Math.random(), Math.random(), Math.random()];
  const [a, b] = flip(r3[0]), [c, d] = flip(r3[1]), [e, f] = flip(r3[2]);
  return {
    phase: "init", round: 1, score: { R: 0, B: 0 }, robots, init: [null, null], orderIdx: [0, 1],
    tid: 0, turn: 0, moveLeft: 0, acted: false, extra: 0, ibUsed: false, done: {},
    plates: { D2: { c: a, n: 0 }, D6: { c: b, n: 0 }, F1: { c: c, n: 0 }, F7: { c: d, n: 0 }, H2: { c: e, n: 0 }, H6: { c: f, n: 0 } },
    floor: { C3: 3, C4: 4, C5: 3, E2: 3, E6: 3, G2: 3, G6: 3, I3: 3, I4: 4, I5: 3 },
    vault: { R: { force: 0, boost: 0, levitate: 0 }, B: { force: 0, boost: 0, levitate: 0 } },
    used: { R: {}, B: {} }, hpUsed: { R: false, B: false }, active: null, queue: [], lev: { R: false, B: false },
    autoRun: { R: false, B: false }, quest: { R: false, B: false },
    pending: null, botStage: 0, botActs: 0, result: null,
  };
}

export const curIdx = (S) => S.orderIdx[S.turn];
export const cur = (S) => S.robots[curIdx(S)];
export const phaseName = (S) => (S.round === 1 ? "AUTO" : S.round >= 13 ? "ENDGAME" : "TELEOP");
const robotAt = (S, c) => S.robots.find((r) => r.at === c);

export function reachable(S, r) {
  const seen = { [r.at]: 0 }, q = [r.at], out = {};
  while (q.length) {
    const c = q.shift(), d = seen[c];
    if (d >= S.moveLeft) continue;
    for (const n of nbrs(c)) {
      if (n in seen || BLOCKED[TYPE[n]] || robotAt(S, n)) continue;
      seen[n] = d + 1; out[n] = d + 1; q.push(n);
    }
  }
  return out;
}

function heavier(S, a, b) { const pa = S.plates[a], pb = S.plates[b]; return pa.n > pb.n ? pa.c : pb.n > pa.n ? pb.c : null; }
export function owners(S) {
  const o = { R: heavier(S, "D2", "D6") === "R", B: heavier(S, "H2", "H6") === "B", scale: heavier(S, "F1", "F7") };
  const a = S.active;
  if (a && a.type === "force") { if (a.lvl !== 2) o[a.al] = true; if (a.lvl >= 2) o.scale = a.al; }
  return o;
}

export function actionsLeft(S) {
  const r = cur(S);
  return !S.acted || S.extra > 0 || (r.feat === "intake" && !S.ibUsed && !r.cube);
}

export function pct(dc, m, adv) {
  let p = Math.min(0.95, Math.max(0.05, (21 - (dc - m)) / 20));
  if (adv) p = 1 - (1 - p) * (1 - p);
  return Math.round(p * 100);
}

// ---------- initiative ----------
// Each robot rolls once at the start of the match; that order holds for every round.
export function rollInitiative(S, idx, rng, out) {
  if (S.phase !== "init" || S.init[idx] != null) return { err: "You already rolled initiative." };
  const r = S.robots[idx], nat = roll(20, rng);
  S.init[idx] = nat + r.m.SPD;
  out.push({ t: "die", idx, nat, what: `${tag(r)} · Initiative`, math: `${nat} ${sgn(r.m.SPD)} SPD = ${S.init[idx]}`, res: `INITIATIVE ${S.init[idx]}`, cls: nat === 20 ? "crit" : "ok" });
  log(out, `${tag(r)} rolls initiative: ${nat} ${sgn(r.m.SPD)} = ${S.init[idx]}.`, "roll");
  if (S.init[0] != null && S.init[1] != null) {
    if (S.init[0] === S.init[1]) S.init[rng() < 0.5 ? 0 : 1] += 0.5;
    S.orderIdx = [0, 1].sort((i, j) => S.init[j] - S.init[i]);
    log(out, `Initiative order: ${S.orderIdx.map((i) => esc(S.robots[i].t)).join(", then ")}. This order holds for the whole match.`, "rnd");
    S.phase = "play";
    log(out, `== ROUND 1 · AUTO ==`, "rnd");
    startTurn(S, out);
  }
  return { ok: true };
}

// ---------- commands ----------
// plan() never changes state. It returns null (no input), {err}, or what the command would do.
export function plan(S, idx, tok) {
  const c = tok[0];
  if (!c) return null;
  if (c === "help" || c === "h" || c === "?") return { kind: "help", label: "show the command list" };
  if (S.phase !== "play") return { err: "The match is not running." };
  if (curIdx(S) !== idx) return { err: "It is not your turn." };
  if (S.pending) return { err: "Roll the die first." };
  const r = S.robots[idx], al = r.al;
  if (c === "end" || c === "e") return { kind: "end", label: `end ${r.t}'s turn` };
  if (c === "m" || c === "move" || c === "go") {
    if (S.moveLeft <= 0) return { err: `${r.t} has no movement left this turn.` };
    if (r.climbed) return { err: `${r.t} is hanging on the scale. It stays put until the buzzer.` };
    const dest = parseCell(tok[tok.length - 1]);
    if (!dest) return { err: "Say where: m c4 (columns A-K, rows 1-7)." };
    const reach = reachable(S, r);
    if (!reach[dest]) return { err: `${dest} is out of reach (${S.moveLeft} square${S.moveLeft === 1 ? "" : "s"} of movement left; fences, the tower and robots block you).` };
    return { kind: "move", dest, cost: reach[dest], label: `drive to ${dest} (${reach[dest]} square${reach[dest] === 1 ? "" : "s"}, ${S.moveLeft - reach[dest]} left after)` };
  }
  // main action, natural-20 bonus actions, and Intake Master's bonus intake
  const slotFor = (isIntake) => (isIntake && r.feat === "intake" && !S.ibUsed ? "ib" : !S.acted ? "main" : S.extra > 0 ? "extra" : null);
  const noSlot = { err: `${r.t} has no actions left. Move, or type end.` };
  if (c === "i" || c === "intake") {
    const slot = slotFor(true);
    if (!slot) return noSlot;
    if (r.cube) return { err: `${r.t} already holds a cube (max 1).` };
    const src = S.floor[r.at] ? r.at : null;
    const portal = PORTALS[al].includes(r.at) ? r.at : null;
    if (!src && !portal) return { err: `${r.t} must be on a cube to intake it. Drive onto a square with a cube, or onto your portal (${PORTALS[al].join("/")}).` };
    const dc = src ? DC.intake : DC.portal;
    return { kind: "check", noun: "Intake", dc, m: r.m.INT, adv: false, action: { type: "intake", src, slot },
      label: `intake from ${src || portal + " (portal)"}${slot === "ib" ? " as a bonus action (Intake Master)" : slot === "extra" ? " (bonus action)" : ""}` };
  }
  if (c === "p" || c === "place") {
    const slot = slotFor(false);
    if (!slot) return noSlot;
    if (!r.cube) return { err: `${r.t} has no cube. Intake one first.` };
    const isScale = /^sc/.test(tok[1] || ""), isSwitch = /^sw/.test(tok[1] || "");
    if (!isScale && !isSwitch) return { err: "place switch  or  place scale" };
    const near = (isScale ? SCALE : [...SWITCH.R, ...SWITCH.B]).filter((p) => p === r.at || adj(p, r.at));
    if (!near.length) return { err: `${r.t} is not next to a ${isScale ? "scale plate (F1/F7)" : "switch plate"}.` };
    near.sort((x, y) => (S.plates[y].c === al) - (S.plates[x].c === al));
    const pl = near[0];
    return { kind: "check", noun: "Placement", dc: isScale ? DC.scale : DC.switch, m: r.m.ACC, adv: false, action: { type: "place", pl, isScale, slot },
      label: `place on the ${isScale ? "SCALE" : "SWITCH"} plate ${pl} (${ALN[S.plates[pl].c]})` };
  }
  if (c === "x" || c === "exchange") {
    const slot = slotFor(false);
    if (!slot) return noSlot;
    if (!r.cube) return { err: `${r.t} has no cube to exchange.` };
    if (!adj(EXCH[al], r.at)) return { err: `Drive next to your exchange (${EXCH[al]}) first.` };
    const want = tok[1] && /^(force|boost|lev)/.test(tok[1]) ? (tok[1].startsWith("lev") ? "levitate" : tok[1]) : null;
    return { kind: "check", noun: "Exchange", dc: DC.exchange, m: r.m.INT, adv: false, action: { type: "exchange", want, slot }, label: "feed the exchange (+5)" };
  }
  if (c === "c" || c === "climb") {
    const slot = slotFor(false);
    if (!slot) return noSlot;
    if (phaseName(S) !== "ENDGAME") return { err: "Climbing opens in the ENDGAME (round 13+)." };
    if (r.climbed) return { err: `${r.t} already climbed.` };
    if (!PLAT[al].includes(r.at)) return { err: `Climb from your platform zone (${PLAT[al].join("/")}).` };
    return { kind: "check", noun: "Climb", dc: DC.climb, m: r.m.CLB, adv: false, action: { type: "climb", slot },
      label: `climb the scale (FACE THE BOSS +${r.feat === "climb" ? 60 : 30})` };
  }
  if (c === "play" || c === "vault") {
    if (phaseName(S) === "AUTO") return { err: "Power-ups can only be played in TELEOP." };
    if (S.hpUsed[al]) return { err: `${ALN[al]}'s human player already acted this round.` };
    const k = (tok[1] || "").startsWith("lev") ? "levitate" : tok[1];
    if (!["force", "boost", "levitate"].includes(k)) return { err: "play force N | play boost N | play levitate   (N: 1 switch, 2 scale, 3 both)" };
    if (S.used[al][k]) return { err: `${k.toUpperCase()} was already played this match.` };
    const have = S.vault[al][k];
    if (k === "levitate") {
      if (have < 3) return { err: `LEVITATE needs 3 cubes in its column (you have ${have}).` };
      return { kind: "instant", action: { type: "play", k, lvl: 3 }, label: "play LEVITATE (a free climb at the end)" };
    }
    const lvl = +tok[2] || have;
    if (have < 1 || lvl > have || lvl < 1) return { err: `${k.toUpperCase()} level ${lvl || 1} needs ${lvl || 1} cube(s) in its column (you have ${have}). Feed the exchange.` };
    return { kind: "instant", action: { type: "play", k, lvl }, label: `play ${k.toUpperCase()} ${lvl} (${["", "switch", "scale", "switch + scale"][lvl]}, this round)` };
  }
  return { err: `Unknown command "${c}". Type help.` };
}

export const HELP = [
  "COMMANDS: m <cell> · intake · place switch|scale · exchange [force|boost|lev] · climb · play force|boost <1-3> · play levitate · end",
  "Each turn: drive up to your speed in squares, split however you like before and after your 1 action. Actions roll d20 + modifier vs DC: click the die to roll. Type end when you are done.",
  `DCs: intake ${DC.intake} (portal ${DC.portal}) · exchange ${DC.exchange} · switch ${DC.switch} · scale ${DC.scale} · climb ${DC.climb}. Natural 20: success plus a bonus action. Natural 1: fail and lose your next turn.`,
];

// Runs a typed command for robot idx. Checks wait in S.pending until that player rolls.
export function command(S, idx, text, rng, out) {
  const tok = String(text || "").trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 4);
  const p = plan(S, idx, tok);
  if (!p) return { err: "Type a command." };
  if (p.err) return p;
  const r = S.robots[idx];
  if (p.kind === "help") return { ok: true };
  log(out, `<b class="${r.al}">${esc(r.t)}&gt;</b> ${esc(tok.join(" "))}`);
  if (p.kind === "end") { endTurn(S, out); return { ok: true }; }
  if (p.kind === "move") {
    log(out, `${tag(r)} drives ${r.at} -> ${p.dest}.`);
    S.moveLeft -= p.cost; r.at = p.dest;
    if (S.round === 1 && !S.autoRun[r.al] && (r.al === "R" ? ci(p.dest) >= 2 : ci(p.dest) <= 8)) {
      S.autoRun[r.al] = true; S.score[r.al] += 5;
      log(out, `  AUTO-RUN! ${tag(r)} crosses the auto line. +5 ${ALN[r.al]}.`);
    }
    after(S, out); return { ok: true };
  }
  if (p.kind === "instant") { playPowerUp(S, r.al, p.action, out); return { ok: true }; }
  // a check: spend the action now, roll when the player clicks the die
  const a = p.action;
  if (a.slot === "ib") S.ibUsed = true; else if (a.slot === "main") S.acted = true; else S.extra--;
  const intro = { intake: `goes for a cube at ${a.src || r.at}...`, place: `lines up on ${a.isScale ? "the SCALE" : "a SWITCH"} plate ${a.pl}...`, exchange: "feeds the exchange...", climb: "grabs the rung..." }[a.type];
  log(out, `${tag(r)} ${intro}`);
  S.pending = { kind: "check", idx, noun: p.noun, dc: p.dc, m: p.m, adv: p.adv, action: a };
  if (r.bot) rollPending(S, idx, rng, out);
  return { ok: true };
}

function once(p, rng) {
  const a = roll(20, rng), b = roll(20, rng), nat = p.adv ? Math.max(a, b) : a, total = nat + p.m;
  return { nat, total, ok: nat === 20 || (nat !== 1 && total >= p.dc), note: p.adv ? ` (advantage: ${a}, ${b})` : "" };
}
function showRoll(S, p, x, out) {
  const r = S.robots[p.idx];
  const res = `${p.noun.toUpperCase()} ${x.ok ? "SUCCEEDED" : "FAILED"}${x.nat === 20 ? " · NAT 20!" : x.nat === 1 ? " · NAT 1!" : ""}`;
  log(out, `  [d20] ${x.nat} ${sgn(p.m)} = ${x.total} vs DC ${p.dc}${x.note} ... <span class="${x.ok ? "ok" : "no"}">${res}</span>`, "roll");
  out.push({ t: "die", idx: p.idx, nat: x.nat, what: `${tag(r)} · ${p.noun}`, math: `${x.nat} ${sgn(p.m)} = ${x.total} vs DC ${p.dc}`, res, cls: x.nat === 20 ? "crit" : x.ok ? "ok" : "no" });
}

// The player whose check is waiting clicks the die.
export function rollPending(S, idx, rng, out) {
  const p = S.pending;
  if (!p || p.kind !== "check" || p.idx !== idx) return { err: "Nothing to roll." };
  const r = S.robots[idx], x = once(p, rng);
  showRoll(S, p, x, out);
  if (!x.ok && r.feat === "lucky" && r.luck > 0) {
    if (r.bot) { useLuck(S, r, p, rng, out); return { ok: true }; }
    S.pending = { ...p, kind: "lucky", x };
    return { ok: true };
  }
  finish(S, p, x, out);
  return { ok: true };
}

// Lucky robots choose whether to spend a token after a failed roll.
export function luckyChoice(S, idx, use, rng, out) {
  const p = S.pending;
  if (!p || p.kind !== "lucky" || p.idx !== idx) return { err: "No Lucky reroll to decide." };
  const r = S.robots[idx];
  if (use && r.luck > 0) useLuck(S, r, p, rng, out);
  else { log(out, `  ${tag(r)} keeps the roll.`); finish(S, p, p.x, out); }
  return { ok: true };
}
function useLuck(S, r, p, rng, out) {
  r.luck--;
  log(out, `  ${tag(r)} spends a Lucky token (${r.luck} left) and rerolls.`);
  const y = once(p, rng);
  showRoll(S, p, y, out);
  finish(S, p, y, out);
}

function finish(S, p, x, out) {
  const r = S.robots[p.idx], al = r.al, a = p.action;
  S.pending = null;
  if (x.nat === 20) { S.extra++; log(out, `  NATURAL 20! ${tag(r)} gets a bonus action.`); out.push({ t: "popup", idx: p.idx, kind: "nat20", noun: p.noun }); }
  if (x.nat === 1) { r.skip = true; log(out, `  NATURAL 1! ${tag(r)} loses its next turn.`); out.push({ t: "popup", idx: p.idx, kind: "nat1", noun: p.noun }); }
  if (a.type === "intake") {
    if (x.ok) { r.cube = true; if (a.src) S.floor[a.src]--; log(out, "  Intake succeeded. Cube secured."); }
    else log(out, "  Intake failed. The cube squirts away.");
  } else if (a.type === "place") {
    if (x.ok) { S.plates[a.pl].n++; r.cube = false; log(out, `  Placement succeeded. ${a.pl} now has ${S.plates[a.pl].n}.`); }
    else log(out, "  Placement failed. It bounces off; still holding it.");
  } else if (a.type === "exchange") {
    if (x.ok) {
      r.cube = false;
      const v = S.vault[al], k = a.want && v[a.want] < 3 ? a.want : ["boost", "force", "levitate"].find((q) => v[q] < 3);
      if (k) v[k]++; S.score[al] += 5;
      log(out, `  Exchange succeeded. Human player vaults it${k ? " into " + k.toUpperCase() : ""}. +5 ${ALN[al]}.`);
    } else log(out, "  Exchange failed. It jams in the opening.");
  } else if (a.type === "climb") {
    if (x.ok) {
      r.climbed = true;
      const pts = r.feat === "climb" ? 60 : 30;
      S.score[al] += pts;
      log(out, `  Climb succeeded. ${tag(r)} is UP!${r.feat === "climb" ? " Climb Master brings a buddy along." : ""} +${pts} ${ALN[al]}.`);
    } else log(out, "  Climb failed. Slips off the bar.");
  }
  after(S, out);
}

function playPowerUp(S, al, a, out) {
  S.used[al][a.k] = true; S.hpUsed[al] = true;
  if (a.k === "levitate") { S.lev[al] = true; log(out, `${ALN[al]} human player hits LEVITATE.`); return; }
  const pu = { al, type: a.k, lvl: a.lvl };
  if (S.active) { S.queue.push(pu); log(out, `${ALN[al]} plays ${a.k.toUpperCase()} ${a.lvl}. Another power-up is running, so it is QUEUED.`); }
  else { S.active = pu; log(out, `${ALN[al]} plays ${a.k.toUpperCase()} ${a.lvl}! Active this round.`); }
}

// ---------- turns, rounds, end of match ----------
function after(S, out) {
  if (S.phase !== "play" || S.pending) return;
  if (S.moveLeft <= 0 && !actionsLeft(S)) endTurn(S, out);
}

function startTurn(S, out) {
  const r = cur(S);
  S.tid++; S.moveLeft = r.climbed ? 0 : r.sq; S.acted = false; S.extra = 0; S.ibUsed = false; S.botStage = 0; S.botActs = 0;
  if (r.skip) {
    r.skip = false;
    log(out, `${tag(r)} is still recovering from its natural 1 and loses this turn.`);
    endTurn(S, out);
  }
}

export function endTurn(S, out) {
  if (S.phase !== "play") return;
  S.pending = null;
  S.done[curIdx(S)] = true;
  S.turn++;
  if (S.turn >= 2) endRound(S, out); else startTurn(S, out);
}

function endRound(S, out) {
  const o = owners(S), a = S.active, base = S.round === 1 ? 20 : 10, notes = [];
  const award = (al, what, isScale) => {
    let p = base;
    if (a && a.type === "boost" && a.al === al && (a.lvl === 3 || (a.lvl === 2) === isScale)) { p *= 2; what += " x2 BOOST"; }
    S.score[al] += p; notes.push(`${ALN[al]} ${what} +${p}`);
  };
  if (o.R) award("R", "switch", false);
  if (o.B) award("B", "switch", false);
  if (o.scale) award(o.scale, "scale", true);
  log(out, `END OF ROUND ${S.round}: ${notes.length ? notes.join(" · ") : "nobody owns anything"}`, "rnd");
  if (S.round === 1) ["R", "B"].forEach((al) => { S.quest[al] = S.autoRun[al] && o[al]; if (S.quest[al]) log(out, `${ALN[al]} completes the AUTO QUEST (+1 RP).`); });
  S.active = S.queue.shift() || null;
  if (S.active) log(out, `Queued ${ALN[S.active.al]} ${S.active.type.toUpperCase()} ${S.active.lvl} is now active.`);
  S.round++;
  if (S.round > ROUNDS) { endMatch(S, out); return; }
  S.hpUsed = { R: false, B: false }; S.done = {}; S.turn = 0;
  log(out, `== ROUND ${S.round} · ${phaseName(S)} ==`, "rnd");
  if (S.round === 13) log(out, "ENDGAME! 30 seconds left. Get to your platform zone and climb.", "rnd");
  startTurn(S, out);
}

function endMatch(S, out) {
  S.robots.forEach((r) => {
    if (!r.climbed && PLAT[r.al].includes(r.at)) { S.score[r.al] += 5; log(out, `${tag(r)} PARKED. +5`); }
    if (S.lev[r.al] && !r.climbed) { S.score[r.al] += 30; r.climbed = true; log(out, `${ALN[r.al]} LEVITATE credits a climb. +30`); }
  });
  S.phase = "over"; S.pending = null; S.round = ROUNDS;
  const R = S.score.R, B = S.score.B, w = R > B ? "R" : B > R ? "B" : null;
  const rp = (al) => (w === al ? 2 : w ? 0 : 1) + (S.robots.find((r) => r.al === al).climbed ? 1 : 0) + (S.quest[al] ? 1 : 0);
  S.result = { w, rp: { R: rp("R"), B: rp("B") } };
  log(out, `*** FINAL: RED ${R} - BLUE ${B} · ${w ? ALN[w] + " WINS" : "TIE"} ***`, "rnd");
}

// When a player's turn timer runs out: settle any waiting roll, then end the turn.
export function timeout(S, rng, out) {
  if (S.phase === "init") {
    S.robots.forEach((r, i) => { if (S.init[i] == null) rollInitiative(S, i, rng, out); });
    return;
  }
  if (S.phase !== "play") return;
  const tid = S.tid, idx = curIdx(S);
  log(out, "  Turn timer ran out.");
  if (S.pending && S.pending.kind === "check") rollPending(S, idx, rng, out);
  if (S.pending && S.pending.kind === "lucky") luckyChoice(S, idx, false, rng, out);
  if (S.phase === "play" && S.tid === tid) endTurn(S, out);
}

// ---------- the bot ----------
function botGoal(S, r) {
  const al = r.al, open = (cells) => cells.filter((c) => !BLOCKED[TYPE[c]]);
  if (r.climbed) return { cells: [r.at], cmd: "" };
  if (phaseName(S) === "ENDGAME") return { cells: PLAT[al], cmd: "climb" };
  if (r.cube) {
    const v = S.vault[al];
    if (S.round > 2 && v.boost + v.force < 3 && Math.random() < 0.3) return { cells: open([EXCH[al], ...nbrs(EXCH[al])]), cmd: "exchange" };
    const sw = SWITCH[al].find((p) => S.plates[p].c === al);
    if (!owners(S)[al] || S.round === 1) return { cells: open(nbrs(sw)), cmd: "place switch" };
    const sc = SCALE.find((p) => S.plates[p].c === al);
    return { cells: open([sc, ...nbrs(sc)]), cmd: "place scale" };
  }
  const src = Object.keys(S.floor).filter((c) => S.floor[c] > 0);
  return { cells: [...src, ...PORTALS[al]], cmd: "intake" };
}

function botMove(S, idx, rng, out) {
  const r = S.robots[idx], g = botGoal(S, r);
  if (S.moveLeft <= 0 || !g.cells.length || g.cells.includes(r.at)) return false;
  const reach = reachable(S, r), dist = (c) => Math.min(...g.cells.map((x) => cheb(x, c)));
  let best = null;
  for (const c in reach) if (best === null || dist(c) < dist(best) || (dist(c) === dist(best) && reach[c] < reach[best])) best = c;
  if (!best || dist(best) >= dist(r.at)) return false;
  return !command(S, idx, "m " + best.toLowerCase(), rng, out).err;
}

// One bot decision. The server calls this on a timer while it is a bot's turn.
export function botStep(S, rng, out) {
  if (S.phase === "init") {
    S.robots.forEach((r, i) => { if (r.bot && S.init[i] == null) rollInitiative(S, i, rng, out); });
    return;
  }
  if (S.phase !== "play" || !cur(S).bot || S.pending) return;
  const idx = curIdx(S), r = cur(S), tid = S.tid;
  if (S.botStage === 0) { S.botStage = 1; if (botMove(S, idx, rng, out)) return; }
  if (S.tid !== tid) return;
  if (S.botStage === 1) {
    const v = S.vault[r.al];
    if (!S.hpUsed[r.al] && phaseName(S) !== "AUTO" && !S.used[r.al].boost && v.boost >= 2) command(S, idx, "play boost 2", rng, out);
    const g = botGoal(S, r);
    if (S.botActs < 4 && actionsLeft(S) && g.cmd && g.cells.includes(r.at)) {
      const res = command(S, idx, g.cmd, rng, out);
      if (!res.err) { S.botActs++; return; }
    }
    S.botStage = 2;
  }
  if (S.tid !== tid) return;
  if (S.botStage === 2) { S.botStage = 3; if (S.botActs > 0 && botMove(S, idx, rng, out)) return; }
  if (S.tid === tid && S.phase === "play") endTurn(S, out);
}
