// Job Site: wheel loaders with rear winches on diggable job sites, solo or with up to 3 friends.
// The page builds one site, picked by ?site= : the quarry hub (where everyone spawns) or a level.
// Moving between sites reloads the page; in a room the server tells everyone to move together.
import * as THREE from "three";
import RAPIER from "rapier";

await RAPIER.init();
// shared systems and data live in their own files; the ?t= stamp keeps them as fresh as this file
const V = new URL(import.meta.url).search;
const [{ createPopups }, { createObjectives, when }, CFG, { CHARACTERS }, { LINES }, { sfx }] = await Promise.all(
  ["./sys/popups.js", "./sys/objectives.js", "./data/config.js", "./data/characters.js", "./data/lines.js", "./sys/sound.js"].map((f) => import(f + V)));

const params = new URLSearchParams(location.search);
const SITE = ["farm", "river", "ridge", "haul", "flood", "treasure", "airstrip", "sands", "night", "fire"].includes(params.get("site")) ? params.get("site") : "hub";
const SEED = { hub: 20261116, farm: 20261117, river: 20261118, ridge: 20261119, haul: 20261120, flood: 20261121, treasure: 20261122, airstrip: 20261123, sands: 20261124, night: 20261125, fire: 20261126 }[SITE];
const TITLES = { farm: "Muddle Acres", river: "Rapid River", ridge: "Ridge Road", haul: "Gravel Run", flood: "Flood Season", treasure: "X Marks the Spot", airstrip: "No Questions Asked", sands: "Sinking Sands", night: "Night Shift", fire: "Firebreak" };
const LEVEL_NUM = { farm: 1, river: 2, ridge: 3, haul: 4, flood: 5, treasure: 6, airstrip: 7, sands: 8, night: 9, fire: 10 };
const DT = 1 / 60;
const LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname);
const SERVER = LOCAL ? "ws://localhost:8788" : "wss://jobsite-rooms.frctop50.workers.dev";
const SYNC_VER = 4;

// ---------- helpers ----------
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(SEED);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const r3 = (v) => Math.round(v * 1000) / 1000;
const esc = (s) => String(s).replace(/[<&>"]/g, "");
function hash2(x, z) {
  let h = Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ SEED;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function noise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), tx = x - xi, tz = z - zi;
  const sx = tx * tx * (3 - 2 * tx), sz = tz * tz * (3 - 2 * tz);
  return lerp(lerp(hash2(xi, zi), hash2(xi + 1, zi), sx), lerp(hash2(xi, zi + 1), hash2(xi + 1, zi + 1), sx), sz);
}

// ---------- site layouts ----------
const HUB = {
  spawn: { x: 0, z: 0, yaw: Math.PI },
  houses: [
    { id: "farm", title: "1 · Muddle Acres", x: -36, z: -44 },
    { id: "river", title: "2 · Rapid River", x: -12, z: -44, needs: "farm" },
    { id: "ridge", title: "3 · Ridge Road", x: 12, z: -44, needs: "river" },
    { id: "haul", title: "4 · Gravel Run", x: -62, z: -44, needs: "ridge" },
    { id: "flood", title: "5 · Flood Season", x: -62, z: -18, needs: "haul" },
    { id: "treasure", title: "6 · X Marks the Spot", x: -62, z: 8, needs: "flood" },
    { id: "airstrip", title: "7 · No Questions Asked", x: 62, z: 8, needs: "flood" },
    { id: "sands", title: "8 · Sinking Sands", x: 62, z: -18, needs: "flood" },
    { id: "night", title: "9 · Night Shift", x: 62, z: 34, needs: "flood" },
    { id: "fire", title: "10 · Firebreak", x: 36, z: 48, needs: "flood" },
    { id: "garage", title: "Garage", x: 46, z: -46, garage: true },
    { id: "paint", title: "Paint Shop", x: 69, z: -46, paint: true },
  ],
  mound: { x: 20, z: -12, r: 7, h: 3.2 },
  field: { x: -40, z: 34, r: 24 },
};
// ----- level 1: Muddle Acres, "After the Storm". Grandma Dinston's farm, one short lesson per job.
const FARM = {
  spawn: { x: 0, z: -72, yaw: 0 },
  // 1 drive: Clementine the pig got out; her hoofprints lead from the pen to where she is
  pen: { x0: 14, x1: 24, z0: -66, z1: -56, gate0: -63, gate1: -59 }, pig: { x: -16, z: -55 },
  prints: [[13.5, -61], [8, -63], [2, -61.5], [-4, -58.5], [-10, -57.5], [-14, -55.5]],
  // 2 winch: her tractor is stuck in a mud patch on the lane; tow it to the marked spot
  tractor: { x: 1, z: -27 }, mudPatch: { x: 1, z: -27, r: 4.5 }, tractorSpot: { x: 12.5, z: -27, r: 3.5 },
  // 3 push: a boulder rolled into the paddock gate
  gateRock: { x: -26.5, z: -4, r: 1.15 }, gateZone: { x: -26.5, z: -4, r: 3.6 },
  // 4 dig and dump: a sinkhole opened by the well; the spoil heap in the paddock is for filling it
  sink: { x: 0, z: -8, r: 3.0, depth: 1.25 }, well: { x: 5.5, z: -12.5 },
  bank: { x: -46, z: -4, r: 11, h: 4.2 },
  paddock: { x0: -66, x1: -30, z0: -30, z1: 22, gate: -4, gateW: 9 },
  // 5 logs: three trees fell across the barn lane; winch them onto the woodpile
  lane2: [[0, -6, 0], [10, 4, 0], [22, 17, 0.2], [31, 24, 0.3]],
  pile: { x: 8, z: 25, r: 5 },
  logs: [[6.5, -0.5, 7, 0.38, 2.36], [14.5, 8.5, 6.5, 0.36, 2.36], [22, 17.5, 8, 0.42, 2.36]],   // x, z, length, radius, yaw
  // 6 the barn sits on a hill too steep to drive; winch yourself up to the post inside it
  hill: { x: 46, z: 52, top: 15, foot: 30, h: 10 },
  barn: { x: 46, z: 46, w: 13, d: 11, h: 7.5, door: 6.5, dh: 5 },          // right at the hilltop's edge, so its post is in winch range from the foot
  post: { x: 49.5, z: 48.5 }, roller: { x: 42.5, z: 47.5 },
  stream: { z: -44, w: 4.5, depth: 1.1, fordW: 6 },
  trees: [[-24, -48], [11, -37], [33, -36], [30, -52], [-30, -37], [40, -50], [-8, 14], [-6, 30], [-40, 30], [30, 2], [24, -12]],
};

const RIVER = {
  spawn: { x: 0, z: -70, yaw: 0 },
  mid: 5, water: -0.55,                                         // the river runs east-west across the middle
  ford: { x: 0, w: 12 },                                        // the shallows, where a causeway is practical
  bank: { x: -24, z: -22, r: 12, h: 4.2 },                      // loose dirt to build it with
  swamp: { z0: 30, z1: 56 },                                    // a boggy belt right across the far side
  depot: { x: -16, z: -58, r: 6.5 },                            // where the toolbox goes (bonus)
  // "The Wedding's on the Other Side": the bridge washed out; the cake is on this bank, the wedding on the far one
  cake: { x: 10, z: -15 }, wedding: { x: 6, z: 66, r: 8 },
  // the current runs east (+x). Boulders dropped in the water just upstream of the ford shelter a causeway.
  riprap: { x0: -14, x1: -4.5, need: 4 },
  boulders: [[-13, -12, 1.05], [-19, -15, 1.1], [13, -9, 1.0], [-34, -33, 1.1], [-30, -27, 1.05], [-37, -25, 1.0]],
  tool: { x: -58, z: 74 },
  rocks: [[-14, 20, 1.0], [10, 22, 0.9], [22, 19, 1.1], [-26, 24, 0.95], [4, 25, 1.05], [-6, 18, 0.9], [32, 24, 1.0], [-38, 20, 1.1], [16, 26, 0.95]],
  trees: [[40, -30], [-46, -40], [30, -56], [-40, -8], [36, -6], [-20, 34], [18, 42], [-34, 50], [36, 36], [-14, 60], [-22, 62], [28, 62], [-64, 64], [50, 70],
    [-40, -31], [-33, -38], [-27, -33], [-36, -21], [-43, -26], [-29, -22]],                       // the wood where three of the boulders are
};
// how deep and how wide the river is at x: shallow and narrow at the ford, deep and wide elsewhere
function riverAt(x) { const sh = smooth(RIVER.ford.w + 8, RIVER.ford.w, Math.abs(x - RIVER.ford.x)); return { depth: lerp(3.4, 1.5, sh), half: lerp(8.5, 5, sh) }; }
function riverDesign(x, z) {
  const R = RIVER;
  let h = (noise(x / 44, z / 44) - 0.5) * 4 + (noise(x / 14 + 3, z / 14) - 0.5) * 1.2 + (noise(x / 5, z / 5) - 0.5) * 0.25 + 0.6;
  h += smooth(78, 94, Math.max(Math.abs(x), Math.abs(z))) * 12;
  const flat = (cx, cz, r, level) => { h = lerp(h, level, smooth(r + 10, r, Math.hypot(x - cx, z - cz))); };
  flat(R.spawn.x, R.spawn.z, 12, 0.3); flat(R.depot.x, R.depot.z, 8, 0.3); flat(R.bank.x, R.bank.z, R.bank.r + 2, 0.3);
  flat(R.wedding.x, R.wedding.z, 11, 0.4); flat(R.cake.x, R.cake.z, 5, 0.35); flat(R.tool.x, R.tool.z, 6, 0.4);
  h = lerp(h, 0.3, smooth(9, 4, Math.abs(x)) * smooth(-72, -64, z) * smooth(74, 66, z));        // the road
  const inSwamp = smooth(R.swamp.z0 - 3, R.swamp.z0 + 1, z) * smooth(R.swamp.z1 + 3, R.swamp.z1 - 1, z);
  h = lerp(h, 0.05, inSwamp);
  const rv = riverAt(x), dz = Math.abs(z - R.mid);
  h = lerp(h, 0.3, smooth(rv.half + 12, rv.half + 3, dz));                                       // level banks
  h -= rv.depth * smooth(rv.half + 1, rv.half - 2.5, dz);
  const B = R.bank, loose = B.h * Math.max(0, 1 - (Math.hypot(x - B.x, z - B.z) / B.r) ** 1.6);
  return { h: h + loose, loose, mud: 2 * inSwamp };
}

// ----- level 3: Ridge Road. One road climbs a ridge in a cutting: a landslide blocks it, a gully has
// washed it out, and the last pitch is too steep to drive. The cabin has to reach the summit.
const RIDGE = {
  spawn: { x: 0, z: -76, yaw: 0 },
  cabin: { x: 11, z: -62 }, wood: { x: -12, z: -64 },
  slide: { z: -15, len: 5, h: 3.6 },
  bank: { z0: -5, z1: 2, h: 2.6 },                          // a loose bank narrowing the road on the west side: dig its foot and it slumps
  tipLimit: 15,
  gully: { z0: 4, z1: 9, depth: 2.7 },
  stage: { z0: 38, z1: 46 }, pitch: { z0: 46, z1: 59 }, top: 22,
  post: { x: 4.5, z: 64 }, pad: { x: 0, z: 78, r: 7 },
  rocks: [[-2, -17, 1.1], [2.5, -13.5, 1.0], [0.5, -19, 1.15], [-3, -12, 1.0]],
  trees: [[-20, -70], [22, -68], [-32, -52], [30, -50], [-14, -44], [16, -42], [-15, 66], [17, 68], [-22, 82], [24, 84], [-40, 70], [42, 72]],
};
function ridgeRoad(z) {
  const R = RIDGE;
  if (z < -30) return 0.3;
  if (z < 0) return lerp(0.3, 6, (z + 30) / 30);
  if (z < 18) return 6;
  if (z < R.stage.z0) return lerp(6, 12, (z - 18) / (R.stage.z0 - 18));
  if (z < R.pitch.z0) return 12;
  // the climb is straight for most of its length, then rounds over onto the summit so loads don't snag on a sharp lip
  const t = (z - R.pitch.z0) / (R.pitch.z1 - R.pitch.z0);
  if (t < 0.8) return lerp(12, R.top, t);
  if (t < 1.2) { const u = (t - 0.8) / 0.4; return lerp(12, R.top, 0.8 + (u - (u * u) / 2) * 0.4); }
  return R.top;
}
function ridgeDesign(x, z) {
  const R = RIDGE, ax = Math.abs(x);
  let valley = (noise(x / 40, z / 40) - 0.5) * 2.5 + (noise(x / 12 + 3, z / 12) - 0.5) * 0.8 + 0.5;
  const flat = (cx, cz, r, level) => { valley = lerp(valley, level, smooth(r + 10, r, Math.hypot(x - cx, z - cz))); };
  flat(R.spawn.x, R.spawn.z, 14, 0.3); flat(R.cabin.x, R.cabin.z, 7, 0.3); flat(R.wood.x, R.wood.z, 5, 0.3);
  valley = lerp(valley, 0.3, smooth(9, 4, ax) * smooth(-84, -76, z));                             // the road in
  const summit = smooth(R.pitch.z1 - 1, R.pitch.z1 + 4, z);
  const hill = ridgeRoad(z) + 11 * smooth(5, 8.5, ax) * (1 - summit) + (noise(x / 9, z / 9) - 0.5) * 1.2 * smooth(8, 14, ax);
  let h = lerp(valley, hill, smooth(-38, -30, z));
  h += smooth(78, 94, Math.max(ax, Math.abs(z))) * 12;
  const G2 = R.gully;                                                                              // the washed-out gap
  h -= G2.depth * smooth(G2.z0 - 1.5, G2.z0 + 1, z) * smooth(G2.z1 + 1.5, G2.z1 - 1, z) * smooth(10, 7, ax);
  const S = R.slide, Bk = R.bank;
  const loose = (S.h * Math.max(0, 1 - Math.abs(z - S.z) / S.len) * smooth(5.4, 4.4, ax)
    + Bk.h * smooth(0.6, -4.6, x) * smooth(Bk.z0 - 1.5, Bk.z0 + 1, z) * smooth(Bk.z1 + 1.5, Bk.z1 - 1, z)) * smooth(4.9, 4.5, ax);   // only between the walls
  const wall = smooth(-36, -33, z) * smooth(R.pitch.z1 + 1, R.pitch.z1 - 2, z) * smooth(4.5, 4.8, ax);
  return { h: h + loose, loose, mud: 0, rock: wall > 0.5 ? 1 : 0 };      // the cutting walls are bedrock: no digging through them
}

// ----- level 4: Gravel Run. A campsite in the valley needs a gravel pad; the gravel is in a pit on a
// plateau, up a switchback road cut into a steep hillside, beyond a boggy stream.
const HAUL = {
  spawn: { x: -22, z: -76, yaw: 0 },
  pad: { x: 22, z: -58, w: 28, d: 18 },
  // "Opening Day": four tent pads on the campsite, campers queueing at the east gate
  tents: [[14, -62.5], [30, -62.5], [14, -53.5], [30, -53.5]], tentW: 7, tentD: 6,
  gate: { x: 37.5, z: -58 }, queue: { x: 42, step: 5.2, max: 8 },
  stream: { z: -28, w: 3.5 },
  road: [[8, -60, 0.3], [-40, -60, 0.3], [-40, 10, 0.3], [46, 15, 2.0], [46, 22, 3.4], [-34, 27, 7.6], [-34, 40, 9], [-34, 52, 9]],
  hillZ0: 14, hillZ1: 30, top: 9,
  pit: { x: -34, z: 66, r: 13, h: 4 },
  hopper: { x: -12, z: 58 }, bay: { x: -12, z: 46, r: 3.2 },
  block: { log: [-34, 41, 9, 0.42, 1.45], rocks: [[-30.5, 45, 1.0], [-37.5, 47, 1.05]] },
  fordRocks: [[-48, -38, 1.0], [-30, -40, 0.95], [-44, -45, 1.05], [-34, -36, 0.9], [-52, -42, 1.0]],
  picnic: { x: -24, z: 70 },
  hairpin: { x0: 41, x1: 51, z0: 12, z1: 25 },
  trees: [[-60, -50], [50, -72], [62, -30], [-64, 0], [66, 4], [-62, 72], [12, 76], [44, 62], [-6, -42], [56, -46], [20, -20], [-20, -12]],
  yards: [{ x: -40, z: -76, r: 5.5 }, { x: -2, z: 70, r: 5.5 }],
};
function roadInfo(pts, x, z) {
  let best = 1e9, hh = 0;
  for (let k = 0; k + 1 < pts.length; k++) {
    const [ax, az, ah] = pts[k], [bx, bz, bh] = pts[k + 1], dx = bx - ax, dz = bz - az;
    const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1), d = Math.hypot(x - ax - dx * t, z - az - dz * t);
    if (d < best) { best = d; hh = lerp(ah, bh, t); }
  }
  return { d: best, h: hh };
}
function haulDesign(x, z) {
  const H = HAUL;
  let h = (noise(x / 40, z / 40) - 0.5) * 2.4 + (noise(x / 12 + 3, z / 12) - 0.5) * 0.8 + 0.4;
  h += H.top * smooth(H.hillZ0, H.hillZ1, z);                                                    // the steep hillside
  h += smooth(78, 94, Math.max(Math.abs(x), Math.abs(z))) * 12;
  h = lerp(h, 0.3, smooth(4.5, 2.5, Math.abs(z - H.gate.z)) * smooth(34, 37, x));             // the lane where campers queue
  const P = H.pad, out = Math.max(Math.abs(x - P.x) - P.w / 2, Math.abs(z - P.z) - P.d / 2);
  h = lerp(h, 0.3, smooth(7, 0, out));
  const r = roadInfo(H.road, x, z);
  h = lerp(h, r.h, smooth(5.6, 3.2, r.d));
  const S = H.stream, ds = Math.abs(z - S.z);
  h = lerp(h, 0.1, smooth(S.w + 7, S.w + 2, ds));
  const Pt = H.pit, loose = Pt.h * Math.max(0, 1 - (Math.hypot(x - Pt.x, z - Pt.z) / Pt.r) ** 1.6);
  return { h: h + loose, loose, mud: 1.9 * smooth(S.w + 1.5, S.w - 0.5, ds), grav: loose };
}

// ----- level 5: Flood Season. A river rises behind an old levee with three breaches and an open floodgate.
const FLOOD = {
  spawn: { x: 0, z: -62, yaw: 0 },
  levee: { z: 22, crest: 2.6 },
  breaches: [{ x: -36, w: 7, floor: 0.9, name: "west break" }, { x: 2, w: 9, floor: 0.4, name: "middle break" }, { x: 38, w: 7, floor: 1.0, name: "east break" }],
  late: { x: 64, w: 6, floor: 0.8, at: 0.55, name: "new break" },          // opens part-way through the rise
  gate: { x: 20, w: 4 }, wheel: { x: 26, z: 15 },
  borrow: [{ x: -26, z: -4, r: 11, h: 4.2 }, { x: 56, z: -6, r: 10, h: 4.2 }],
  riprap: [[-33, 27, 1.0], [-40, 27.5, 0.95], [-2, 27, 1.05], [6, 27.5, 1.0], [42, 27, 1.0], [61, 27.5, 1.05]],
  // an empty pasture west of the town, behind its own bank: dig through the levee there to let the river in
  pasture: { x0: -88, x1: -59, z0: -24, z1: 17, floor: -0.8 }, berm: { x: -54, half: 4.5, h: 4.2 }, spill: { x0: -76, x1: -61 },
  // the cars are already in the river when the job starts, stranded in the shallows until the water lifts them
  cars: [{ at: 0, x: -44, color: 0x3b8fe0, name: "Minston and Tinston's car", cans: true }, { at: 0, x: -60, color: 0xd8333a, name: "red car" }, { at: 0, x: -72, color: 0x52b45a, name: "green car" }],
  weir: 72, carStart: { x: -58, z: 34 },
  homes: [[-40, -30, 1], [-14, -38, 1], [14, -30, 1], [42, -38, 1], [-34, -60, 1], [62, -50, 1], [12, -66, 1], [64, -16, 1]],
  water: { start: -2.0, peak: 2.0, riseSolo: 1080, hold: 40, grace: 45 },      // starts low, rises faster
  trees: [[70, -20], [-26, -50], [30, -58], [0, -30], [74, 8], [-44, -76], [44, -74]],
  yards: [{ x: 24, z: -64, r: 5.5 }, { x: 4, z: -8, r: 5.5 }],
};
function floodDesign(x, z) {
  const F = FLOOD, L2 = F.levee;
  let h = (noise(x / 36, z / 36) - 0.5) * 1.2 + (noise(x / 10 + 3, z / 10) - 0.5) * 0.4 + 0.3;
  h += 1.4 * smooth(12, -70, z);                                                                 // the town rises gently away from the river: fields flood first
  h = lerp(h, 0.0, smooth(18, 26, z));                                                           // floodplain
  h -= 2.6 * smooth(30, 38, z);                                                                  // river channel
  h += 5.2 * smooth(50, 60, z);                                                                  // the far bank: it's a river, not a lake
  const inChannel = smooth(26, 31, z) * smooth(58, 52, z);                                       // where the river runs off both ends of the map
  h += smooth(78, 94, Math.max(Math.abs(x), Math.abs(z))) * 12 * (1 - inChannel * smooth(70, 80, Math.abs(x)));
  const Pa = F.pasture, inPa = Math.min(x - Pa.x0, Pa.x1 - x, z - Pa.z0, Pa.z1 - z);
  h = lerp(h, Pa.floor, smooth(-4, 3, inPa));                                                    // the low pasture
  const berm = smooth(F.berm.half, F.berm.half - 2, Math.abs(x - F.berm.x)) * smooth(L2.z + 1, L2.z - 3, z) * smooth(Pa.z0 - 6, Pa.z0, z);
  h = Math.max(h, lerp(h, F.berm.h, berm));                                                           // its bank, between pasture and town
  const dzl = Math.abs(z - L2.z), shape = smooth(4.3, 0.75, dzl);
  let crest = L2.crest;
  for (const b of F.breaches) crest = lerp(crest, Math.min(crest, b.floor), smooth(b.w / 2 + 1.6, b.w / 2, Math.abs(x - b.x)));
  if (F.gate && Math.abs(x - F.gate.x) < F.gate.w / 2 + 0.9) crest = 0;                                      // the floodgate slot
  h += crest * shape;
  let loose = 0;
  for (const B of F.borrow) loose += B.h * Math.max(0, 1 - (Math.hypot(x - B.x, z - B.z) / B.r) ** 1.6);
  return { h: h + loose, loose, mud: 0, rock: berm > 0.6 ? 1 : 0 };
}

// ----- level 6: X Marks the Spot. A clue chain in car lengths (one car length = 6 m) between landmarks,
// across a shallow river and a deep one, to a chest buried 2 m down. Four layouts; a room always gets the same one.
const CAR = 6;
const TREASURE = {
  spawn: { x: 0, z: -76, yaw: 0 }, home: { x: 0, z: -66, r: 7 },
  ford: { z: -30, w: 5, depth: 0.5, water: 0.0 },        // shallow: drive straight through
  deep: { z: 30, w: 4.5, depth: 2.6, water: -0.1 },      // deep: build a causeway
  spoil: [{ x: 14, z: 17, r: 7, h: 3.4 }, { x: -22, z: 18, r: 6, h: 3.0 }],
  marks: {
    pine: { x: -44, z: -52, name: "the lone dead pine" }, twins: { x: 8, z: -48, name: "the twin boulders" },
    dog: { x: 38, z: -12, name: "the rock shaped like a sleeping dog" }, well: { x: -50, z: 8, name: "the old well" },
    mill: { x: 44, z: 52, name: "the windmill" }, crow: { x: -36, z: 62, name: "the scarecrow" },
  },
  // each layout: four clues; the last one is where the chest is
  layouts: [
    [["pine", "E", 5], ["dog", "W", 4], ["well", "E", 5], ["mill", "W", 6]],
    [["twins", "W", 6], ["well", "S", 3], ["dog", "N", 5], ["crow", "E", 7]],
    [["pine", "E", 3], ["dog", "W", 6], ["well", "E", 3], ["mill", "W", 3]],
    [["twins", "E", 5], ["dog", "W", 3], ["well", "S", 4], ["crow", "S", 4]],
  ],
  decoys: [[-10, -62], [24, -60], [-30, -6], [26, 4], [-14, 46], [24, 68]],
  junk: ["an old boot", "a rusty tin can", "a rubber duck", "a garden gnome", "a soggy sandwich", "a bowling ball"],
  yards: [{ x: 16, z: -74, r: 5.5 }],
};
const DIRV = { N: [0, 1], S: [0, -1], E: [1, 0], W: [-1, 0] }, DIRNAME = { N: "north", S: "south", E: "east", W: "west" };
// which layout: a room's code picks it (so everyone in the room digs the same field); solo, a random one each time
const TLAYOUT = (() => {
  if (SITE !== "treasure") return 0;
  const rc = params.get("room");
  if (rc) { let h = 0; for (const ch of rc) h = (h * 31 + ch.charCodeAt(0)) | 0; return Math.abs(h) % TREASURE.layouts.length; }
  return Math.floor(Math.random() * TREASURE.layouts.length);
})();
const TCLUES = TREASURE.layouts[TLAYOUT].map(([m, d, n], k) => {
  const L = TREASURE.marks[m], [dx, dz] = DIRV[d];
  return { x: L.x + dx * n * CAR, z: L.z + dz * n * CAR, a: `From ${L.name},`, b: `go ${n} car lengths ${DIRNAME[d]}${k === 3 ? " and dig deep" : ", then dig"}.`, chest: k === 3 };
});
const TMOUNDS = [...TCLUES, ...TREASURE.decoys.map(([x, z]) => ({ x, z }))];
function treasureDesign(x, z) {
  const T = TREASURE;
  let h = (noise(x / 40, z / 40) - 0.5) * 3 + (noise(x / 12 + 3, z / 12) - 0.5) * 0.8 + 0.7;
  h += smooth(78, 94, Math.max(Math.abs(x), Math.abs(z))) * 12;
  h = lerp(h, 0.4, smooth(22, 10, Math.hypot(x - T.spawn.x, z - T.spawn.z + 4)));
  for (const L of Object.values(T.marks)) h = lerp(h, 0.6, smooth(9, 4, Math.hypot(x - L.x, z - L.z)));
  for (const R of [T.ford, T.deep]) {
    const ds = Math.abs(z - R.z);
    h = lerp(h, 0.25, smooth(R.w + 9, R.w + 2, ds));
    h -= (R.depth + 0.25) * smooth(R.w + 1.5, R.w * 0.4, ds);
  }
  let loose = 0;
  for (const S of T.spoil) loose += S.h * Math.max(0, 1 - (Math.hypot(x - S.x, z - S.z) / S.r) ** 1.6);
  for (const M of TMOUNDS) loose += 0.7 * Math.max(0, 1 - (Math.hypot(x - M.x, z - M.z) / 2.3) ** 2);     // every mound looks the same
  return { h: h + loose, loose, mud: 0 };
}

// ----- level 7: No Questions Asked. A jungle airstrip for Señor Pinstón: fell the trees, clear the
// stumps and rocks, cut and fill it level, gravel the mud, roll it firm. Rain turns loose dirt to mud.
const AIR = {
  spawn: { x: -62, z: -44, yaw: 0 },
  strip: { x0: -72, x1: 72, z: 0, half: 8, level: 0.6 },
  trees: [[-56, 3, 1.15], [-40, -5, 1.1], [-22, 4, 1.2], [-4, -3, 1.15], [24, 5, 1.2], [42, -4, 1.1], [60, 2, 1.15]],
  giant: [12, 1],
  rocks: [[-48, -2, 1.0], [-30, 6, 0.9], [-12, -6, 1.05], [32, 0, 1.0], [52, 6, 0.95]],
  mud: [[-28, -1, 6], [36, 2, 7]],
  gravel: { x: 0, z: -34, r: 10, h: 3.2 },
  yards: [{ x: -62, z: -60, r: 5.5 }, { x: 22, z: -36, r: 5.5 }],
  showers: { every: 220, len: 55 },
};
const stripSurface = (x) => AIR.strip.level + 0.85 * Math.sin(x / 11) + 0.45 * Math.sin(x / 5.3 + 1);    // humps and hollows to cut and fill
function airDesign(x, z) {
  const A = AIR, S = A.strip;
  let h = (noise(x / 34, z / 34) - 0.5) * 3.2 + (noise(x / 10 + 3, z / 10) - 0.5) * 1.0 + 1.0;
  h += smooth(78, 94, Math.max(Math.abs(x), Math.abs(z))) * 14;
  h = lerp(h, 0.6, smooth(16, 8, Math.hypot(x - A.spawn.x, z - A.spawn.z - 8)));
  for (const Y of A.yards) h = lerp(h, 0.6, smooth(10, 5, Math.hypot(x - Y.x, z - Y.z)));
  const dz = Math.abs(z - S.z), along = smooth(S.x0 - 6, S.x0, x) * smooth(S.x1 + 6, S.x1, x);
  h = lerp(h, stripSurface(x), smooth(S.half + 7, S.half + 1, dz) * along);
  let mud = 0;
  for (const [mx, mz, r] of A.mud) mud = Math.max(mud, 1.35 * smooth(r, r * 0.6, Math.hypot(x - mx, z - mz)));
  const G2 = A.gravel, grav = G2.h * Math.max(0, 1 - (Math.hypot(x - G2.x, z - G2.z) / G2.r) ** 1.6);
  h = lerp(h, 0.6, smooth(G2.r + 6, G2.r, Math.hypot(x - G2.x, z - G2.z)));
  return { h: h + grav, loose: grav, mud, grav };
}

// ----- level 8: Sinking Sands. Fill a desert pit (sand slumps flat; mixing in gravel holds it steeper),
// then roll it to seal it. Something lives in the pit: on a fixed beat it strikes everything inside its ring.
const SANDS = {
  spawn: { x: 0, z: -72, yaw: 0 },
  pit: { x: 0, z: 8, r: 15, depth: 4.2, level: 0.4 },
  ring: { start: 24, end: 11 },                       // the worm's reach shrinks as the pit fills
  strike: { every: 26, everyEnd: 15, warn: 3.5, grace: 50 },
  dunes: [{ x: -42, z: -20, r: 14, h: 5 }, { x: 44, z: -16, r: 13, h: 5 }, { x: -40, z: 44, r: 12, h: 4.5 }, { x: 42, z: 46, r: 12, h: 4.5 }, { x: 0, z: -40, r: 10, h: 3.5 }],
  rocks: [[-24, -48, 1.0], [24, -46, 1.05], [-58, 12, 1.0], [58, 10, 0.95], [-14, 52, 1.0], [16, 56, 1.05]],
  yards: [{ x: 20, z: -72, r: 5.5 }],
};
function sandsDesign(x, z) {
  const S = SANDS, P = S.pit;
  let h = (noise(x / 30, z / 30) - 0.5) * 2.4 + (noise(x / 9 + 3, z / 9) - 0.5) * 0.6 + P.level;
  h += smooth(78, 94, Math.max(Math.abs(x), Math.abs(z))) * 12;
  h = lerp(h, P.level, smooth(16, 8, Math.hypot(x - S.spawn.x, z - S.spawn.z)));
  const d = Math.hypot(x - P.x, z - P.z);
  h = lerp(h, P.level, smooth(P.r + 12, P.r + 2, d));
  h -= P.depth * smooth(P.r, P.r * 0.3, d);                                       // the pit
  let loose = 0.8 * smooth(P.r + 6, P.r, d) * smooth(P.r * 0.5, P.r * 0.9, d);    // its rim is loose sand: it keeps slumping in
  for (const D of S.dunes) loose += D.h * Math.max(0, 1 - (Math.hypot(x - D.x, z - D.z) / D.r) ** 1.4);
  return { h: h + loose, loose, mud: 0 };
}

// ----- level 9: Night Shift. Borrow 30 m³ of premium topsoil from Grade-A Grading's yard across the road,
// at night. A guard truck drives one fixed loop with a vision cone; two floodlights sweep fixed arcs.
const NIGHT = {
  spawn: { x: 0, z: -72, yaw: 0 },
  road: { z: -10, half: 5 },
  yard: { x0: -32, x1: 32, z0: 10, z1: 56 }, gate: { x: 0, w: 8 },
  pile: { x: 0, z: 40, r: 11, h: 4.5 },
  lot: { x: 0, z: -48, r: 9 },
  guard: { path: [[-25, 17], [25, 17], [25, 49], [-25, 49]], speed: 4, pause: 3, len: 16, half: 0.42 },
  lights: [{ x: -36, z: 60, aim: -0.75, amp: 0.55, period: 12, len: 30, half: 0.24 }, { x: 36, z: 6, aim: 2.4, amp: 0.55, period: 15, len: 30, half: 0.24 }],
  generator: { x: 39, z: 32 },
  need: 30,
  yards: [{ x: 22, z: -72, r: 5.5 }],
};
function nightDesign(x, z) {
  const N = NIGHT, Y = N.yard;
  let h = (noise(x / 40, z / 40) - 0.5) * 2 + (noise(x / 12 + 3, z / 12) - 0.5) * 0.5 + 0.4;
  h += smooth(78, 94, Math.max(Math.abs(x), Math.abs(z))) * 12;
  h = lerp(h, 0.3, smooth(N.road.half + 4, N.road.half, Math.abs(z - N.road.z)));
  const inY = Math.min(x - Y.x0, Y.x1 - x, z - Y.z0, Y.z1 - z);
  h = lerp(h, 0.3, smooth(-8, 0, inY));
  h = lerp(h, 0.3, smooth(N.lot.r + 8, N.lot.r, Math.hypot(x - N.lot.x, z - N.lot.z)));
  h = lerp(h, 0.3, smooth(12, 4, Math.hypot(x - N.spawn.x, z - N.spawn.z - 6)));
  const P = N.pile, loose = P.h * Math.max(0, 1 - (Math.hypot(x - P.x, z - P.z) / P.r) ** 1.5);
  return { h: h + loose, loose, mud: 0 };
}

// ----- level 10: Firebreak. A grass fire comes down the valley at dusk; cut bare-dirt breaks to keep it off
// Rancher Linston's farm. The fire is a coarse grid (2 m cells) run by the host's game.
const FIRE = {
  spawn: { x: 0, z: -66, yaw: 0 },
  farm: { x0: -42, x1: 42, z0: -84, z1: -34 },
  line: { z: -16 },                                     // the suggested firebreak
  ignite: { z: 72, at: 0 },                             // where the fire starts, and when (seconds): straight away
  windShift: 200,                                       // seconds after it starts, the wind swings south-east
  trees: [[-50, 6], [-28, 18], [-6, 28], [18, 10], [40, 22], [58, 4], [-60, 34], [30, 44], [-36, -4], [8, -4]],
  cows: [[-20, -60], [-12, -54], [14, -62], [22, -56], [-28, -70], [6, -72]],
  yards: [{ x: 24, z: -70, r: 5.5 }],
};
function fireDesign(x, z) {
  const F = FIRE;
  let h = (noise(x / 38, z / 38) - 0.5) * 2.2 + (noise(x / 11 + 3, z / 11) - 0.5) * 0.6 + 0.4;
  h += 6 * smooth(-20, 80, z);                                                   // the valley slopes up to the north: the fire comes downhill
  h += smooth(78, 94, Math.max(Math.abs(x), Math.abs(z))) * 12;
  const Fm = F.farm, inF = Math.min(x - Fm.x0, Fm.x1 - x, z - Fm.z0, Fm.z1 - z);
  h = lerp(h, 0.3, smooth(-10, 2, inF));
  return { h, loose: 0, mud: 0 };
}

function hubDesign(x, z) {
  let h = (noise(x / 46, z / 46) - 0.5) * 9 + (noise(x / 17 + 9, z / 17 + 4) - 0.5) * 2.6 + (noise(x / 6, z / 6) - 0.5) * 0.5;
  h += smooth(74, 94, Math.max(Math.abs(x), Math.abs(z))) * 16;                       // quarry walls
  const flat = (cx, cz, r, level) => { h = lerp(h, level, smooth(r + 12, r, Math.hypot(x - cx, z - cz))); };
  flat(0, 0, 14, 0);
  for (const hs of HUB.houses) flat(hs.x, hs.z, hs.garage ? 20 : 10, 0);
  h = lerp(h, 0, smooth(80, 74, x) * smooth(-64, -56, z) * smooth(-28, -36, z));        // room for the paint shop in the corner
  h = lerp(h, 0, smooth(58, 48, Math.abs(x)) * smooth(-62, -52, z) * smooth(6, -2, z));  // the yard in front of the houses
  const M = HUB.mound, loose = M.h * Math.max(0, 1 - Math.hypot(x - M.x, z - M.z) / M.r);
  return { h: h + loose, loose, mud: 0 };
}

function farmDesign(x, z, noSink = false) {
  const F = FARM;
  let h = (noise(x / 50, z / 50) - 0.5) * 5 + (noise(x / 15 + 3, z / 15) - 0.5) * 1.2 + (noise(x / 5, z / 5) - 0.5) * 0.25;
  h += smooth(78, 94, Math.max(Math.abs(x), Math.abs(z))) * 12;                       // valley sides
  const flat = (cx, cz, r, level) => { h = lerp(h, level, smooth(r + 10, r, Math.hypot(x - cx, z - cz))); };
  flat(F.sink.x, F.sink.z, 14, 0);
  flat(F.pile.x, F.pile.z, 8, 0);
  flat(F.hill.x, F.hill.z, F.hill.foot + 4, 0.3);
  h = lerp(h, 0, smooth(10, 4, Math.abs(x)) * smooth(-6, -14, z));                     // farm lane
  const Pn = F.pen, inPen = Math.min(x - Pn.x0, Pn.x1 - x, z - Pn.z0, Pn.z1 - z);
  h = lerp(h, 0.1, smooth(-10, 0, inPen));                                              // the pig pen and the yard round it
  const l2 = roadInfo(F.lane2, x, z);
  h = lerp(h, l2.h, smooth(6, 3, l2.d));                                                // the lane up to the barn hill
  h = lerp(h, 0.1, smooth(9, 4, Math.hypot(x - F.tractorSpot.x, z - F.tractorSpot.z)));
  const P = F.paddock, inP = Math.min(x - P.x0, P.x1 - x, z - P.z0, P.z1 - z);
  h = lerp(h, 0.2, smooth(-8, 2, inP));
  const S = F.stream, ds = Math.abs(z - S.z);
  h = lerp(h, 0, smooth(S.w + 10, S.w + 3, ds));
  const depth = lerp(S.depth, 0.45, smooth(S.fordW + 3, S.fordW, Math.abs(x)));        // shallow ford where the lane crosses
  h -= depth * smooth(S.w + 2.5, S.w * 0.4, ds);
  const H = F.hill;
  h += H.h * smooth(H.foot, H.top, Math.hypot(x - H.x, z - H.z));
  if (!noSink) h -= F.sink.depth * smooth(F.sink.r, F.sink.r * 0.35, Math.hypot(x - F.sink.x, z - F.sink.z));
  const B = F.bank, loose = B.h * Math.max(0, 1 - (Math.hypot(x - B.x, z - B.z) / B.r) ** 1.6);
  const mp = F.mudPatch, mudLane = 0.95 * smooth(mp.r, mp.r * 0.5, Math.hypot(x - mp.x, z - mp.z));
  return { h: h + loose, loose, mud: Math.max(smooth(S.w + 3.5, S.w + 0.5, ds), mudLane) };
}

// ---------- terrain grid ----------
const G = 384, CELL = 0.5, SIZE = G * CELL, HALF = SIZE / 2, CH = 32, NC = G / CH, W = G + 1;
const BEDROCK = 5;                            // how far below the original ground you can dig
const design = { hub: hubDesign, farm: farmDesign, river: riverDesign, ridge: ridgeDesign, haul: haulDesign, flood: floodDesign, treasure: treasureDesign, airstrip: airDesign, sands: sandsDesign, night: nightDesign, fire: fireDesign }[SITE];
// heights[zi + xi * W]: rows along z, columns along x, the layout Rapier's heightfield wants.
// firm[i] is the top of undisturbed ground: anything above it is loose dirt.
const heights = new Float32Array(W * W), base = new Float32Array(W * W), firm = new Float32Array(W * W),
  loose = new Uint8Array(W * W), mudA = new Float32Array(W * W), gravH = new Float32Array(W * W), rockA = new Uint8Array(W * W);   // gravH: thickness of gravel lying on top
// pack[i]: how firmly packed the top is, 0 = freshly dumped, 1 = rolled flat or never disturbed
const pack = new Float32Array(W * W), pack0 = new Uint8Array(W * W);
const sinkIdx = [], sinkTarget = [];
const idxAt = (x, z) => Math.round((z + HALF) / CELL) + Math.round((x + HALF) / CELL) * W;
// Cut/fill zones (Ridge Road): dirt dug out of the cut zone versus dirt placed in the fill zone.
const cutIdx = [], fillIdx = [], roadFillIdx = [];
for (let xi = 0; xi <= G; xi++) for (let zi = 0; zi <= G; zi++) {
  const x = xi * CELL - HALF, z = zi * CELL - HALF, i = zi + xi * W, d = design(x, z);
  heights[i] = base[i] = d.h; firm[i] = d.h - d.loose; loose[i] = d.loose > 0.02 ? 1 : 0; mudA[i] = d.mud; rockA[i] = d.rock ? 1 : 0; if (d.grav) gravH[i] = d.grav;
  pack[i] = pack0[i] = loose[i] ? 0 : 1;
  if (SITE === "ridge") {
    if (d.loose > 0.02) cutIdx.push(i);
    if (Math.abs(x) < 10 && z > RIDGE.gully.z0 - 1.5 && z < RIDGE.gully.z1 + 1.5) { fillIdx.push(i); if (Math.abs(x) < 2.5) roadFillIdx.push(i); }
  }
  if (SITE === "farm" && Math.hypot(x - FARM.sink.x, z - FARM.sink.z) < FARM.sink.r) { sinkIdx.push(i); sinkTarget.push(farmDesign(x, z, true).h - 0.1); }
}
function sample(arr, x, z) {
  const fx = clamp((x + HALF) / CELL, 0, G - 1e-4), fz = clamp((z + HALF) / CELL, 0, G - 1e-4);
  const xi = Math.floor(fx), zi = Math.floor(fz), tx = fx - xi, tz = fz - zi, i = zi + xi * W;
  return lerp(lerp(arr[i], arr[i + W], tx), lerp(arr[i + 1], arr[i + W + 1], tx), tz);
}
const heightAt = (x, z) => sample(heights, x, z);
// a layer of gravel makes mud firm
let rainWet = 0;                     // 0..1 while a shower soaks the ground (No Questions Asked)
const mudAt = (x, z) => (sample(mudA, x, z) + (rainWet > 0 ? rainWet * 1.1 * sample(loose, x, z) * (1 - sample(pack, x, z)) : 0)) * (1 - smooth(0.03, 0.12, sample(gravH, x, z)));
function slopeAt(x, z) {
  const gx = (heightAt(x + 0.75, z) - heightAt(x - 0.75, z)) / 1.5, gz = (heightAt(x, z + 0.75) - heightAt(x, z - 0.75)) / 1.5;
  return Math.atan(Math.hypot(gx, gz));
}

// ---------- renderer ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const SKY = 0x9fc4e0;
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 100, 280);
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.3, 500);
scene.add(new THREE.HemisphereLight(0xdcecff, 0x7a6a4f, 1.15));
const sun = new THREE.DirectionalLight(0xfff2d6, 2.1);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -50, right: 50, top: 50, bottom: -50, near: 1, far: 240 });
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.06;
scene.add(sun, sun.target);
const SUN_DIR = new THREE.Vector3(0.55, 1, 0.35).normalize();
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
const lam = (color, flat = false) => new THREE.MeshLambertMaterial({ color, flatShading: flat });

// ---------- physics world ----------
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
world.timestep = DT;
for (const [x, z, hx, hz] of [[HALF - 3, 0, 1, HALF], [-HALF + 3, 0, 1, HALF], [0, HALF - 3, HALF, 1], [0, -HALF + 3, HALF, 1]]) {
  world.createCollider(RAPIER.ColliderDesc.cuboid(hx, 40, hz).setTranslation(x, 20, z));   // invisible fence
}
const props = [];          // everything loose: rocks, boulders, logs, the stump, the tractor
const anchors = [];        // fixed things a winch can hook: trees, winch posts

// ---------- terrain: chunks with their own collider and mesh so edits stay cheap ----------
const groundMat = new THREE.MeshLambertMaterial({ vertexColors: true });
const cDirt = new THREE.Color(0xb08a58), cSand = new THREE.Color(0xd2b77c), cGrass = new THREE.Color(0x7fa653), cGrass2 = new THREE.Color(0x6d9a48),
  cRock = new THREE.Color(0x8d8a85), cLoose = new THREE.Color(0x8a6238), cMud = new THREE.Color(0x4f3a26), cGravel = new THREE.Color(0xa9a8a2), _c = new THREE.Color();
function groundColor(wx, wz, hm, steep) {
  if (SITE === "hub") {
    _c.copy(cDirt).lerp(cSand, smooth(0.35, 0.75, noise(wx / 23 + 40, wz / 23)));
    _c.lerp(cGrass, smooth(1.6, 3.4, hm + (noise(wx / 9, wz / 9 + 7) - 0.5) * 2));
    _c.lerp(cRock, Math.max(smooth(0.75, 1.2, steep), smooth(8, 12, hm)));
    return;
  }
  if (SITE === "fire") {
    _c.copy(cGrass).lerp(new THREE.Color(0xb8b05a), 0.35 + noise(wx / 13 + 5, wz / 13) * 0.3);     // dry late-summer grass
    _c.lerp(cRock, smooth(0.9, 1.3, steep) * 0.6);
    return;
  }
  if (SITE === "night") {
    _c.copy(cGrass).lerp(cGrass2, noise(wx / 13 + 5, wz / 13));
    const P = NIGHT.pile, Y = NIGHT.yard;
    _c.lerp(cDirt, smooth(1, -1, Math.min(wx - Y.x0, Y.x1 - wx, wz - Y.z0, Y.z1 - wz)) * 0.6);
    _c.lerp(cMud, smooth(P.r + 1, P.r - 3, Math.hypot(wx - P.x, wz - P.z)) * 0.7);          // dark, rich topsoil
    return;
  }
  if (SITE === "sands") {
    _c.copy(cSand).lerp(cDirt, noise(wx / 17 + 5, wz / 17) * 0.35);
    _c.lerp(cRock, smooth(0.9, 1.3, steep) * 0.5);
    return;
  }
  if (SITE === "treasure") {
    _c.copy(cGrass).lerp(cGrass2, noise(wx / 13 + 5, wz / 13));
    _c.lerp(cSand, Math.max(smooth(-0.1, -0.6, hm), smooth(11, 7, Math.abs(wz - TREASURE.ford.z)) * 0.6, smooth(10, 6.5, Math.abs(wz - TREASURE.deep.z)) * 0.7));
    _c.lerp(cDirt, smooth(9, 5, Math.hypot(wx - TREASURE.home.x, wz - TREASURE.home.z)) * 0.7);
    for (const S of TREASURE.spoil) _c.lerp(cLoose, smooth(S.r, S.r - 3, Math.hypot(wx - S.x, wz - S.z)) * 0.8);     // the spoil heaps you build the causeway from
    _c.lerp(cRock, smooth(0.9, 1.3, steep) * 0.7);
    return;
  }
  if (SITE === "airstrip") {
    _c.copy(cGrass2).multiplyScalar(0.82).lerp(cGrass, noise(wx / 9 + 5, wz / 9) * 0.6);
    const S = AIR.strip, onStrip = smooth(S.half + 2, S.half, Math.abs(wz - S.z)) * smooth(S.x0 - 3, S.x0, wx) * smooth(S.x1 + 3, S.x1, wx);
    _c.lerp(cDirt, onStrip * 0.75);
    _c.lerp(cRock, smooth(0.9, 1.3, steep) * 0.7);
    return;
  }
  if (SITE === "haul") {
    _c.copy(cGrass).lerp(cGrass2, noise(wx / 13 + 5, wz / 13));
    const P = HAUL.pad, out = Math.max(Math.abs(wx - P.x) - P.w / 2, Math.abs(wz - P.z) - P.d / 2);
    _c.lerp(cDirt, Math.max(smooth(4.2, 3, roadInfo(HAUL.road, wx, wz).d), smooth(1, -0.5, out) * 0.8));
    _c.lerp(cRock, smooth(0.8, 1.2, steep) * 0.8);
    return;
  }
  if (SITE === "flood") {
    _c.copy(cGrass).lerp(cGrass2, noise(wx / 13 + 5, wz / 13));
    _c.lerp(cSand, smooth(-0.3, -1.2, hm));
    _c.lerp(cDirt, smooth(5.5, 3.8, Math.abs(wx)) * smooth(-80, -70, wz) * smooth(14, 8, wz));
    return;
  }
  if (SITE === "ridge") {
    _c.copy(cGrass).lerp(cGrass2, noise(wx / 13 + 5, wz / 13));
    _c.lerp(cDirt, smooth(5.5, 3.8, Math.abs(wx)) * smooth(-86, -80, wz) * smooth(72, 62, wz));
    _c.lerp(cRock, Math.max(smooth(0.75, 1.15, steep) * 0.85, smooth(-34, -28, wz) * smooth(4.5, 8, Math.abs(wx)) * smooth(60, 54, wz) * 0.35));
    return;
  }
  if (SITE === "river") {
    _c.copy(cGrass).lerp(cGrass2, noise(wx / 13 + 5, wz / 13));
    _c.lerp(cDirt, smooth(5.5, 3.5, Math.abs(wx)) * smooth(-72, -66, wz) * smooth(70, 64, wz));
    _c.lerp(cSand, smooth(-0.1, -0.9, hm));
    _c.lerp(cRock, smooth(1.0, 1.6, steep) * 0.7);
    return;
  }
  const F = FARM;
  _c.copy(cGrass).lerp(cGrass2, noise(wx / 13 + 5, wz / 13));
  let dirt = smooth(9, 6, Math.hypot(wx - F.sink.x, wz - F.sink.z));
  if (wz < -10) dirt = Math.max(dirt, smooth(5, 3.5, Math.abs(wx)));
  dirt = Math.max(dirt, smooth(3.6, 2.4, roadInfo(F.lane2, wx, wz).d) * 0.85, smooth(1, -1, Math.min(wx - F.pen.x0, F.pen.x1 - wx, wz - F.pen.z0, F.pen.z1 - wz)) * 0.9);
  const P = F.paddock, inP = Math.min(wx - P.x0, P.x1 - wx, wz - P.z0, P.z1 - wz);
  dirt = Math.max(dirt, smooth(-1, 1, inP) * 0.8);
  _c.lerp(cDirt, dirt);
  _c.lerp(cRock, smooth(1.0, 1.6, steep) * 0.7);
}
// Overlays (O key): "grade" colours the ground against the level's target surface (red high, green on
// grade, blue low); "pack" shows how firm the ground is (orange loose, teal packed).
const overlay = { mode: "" };
const GRADE = {
  airstrip: { tol: CFG.LEVELS.airstrip.tol, at: (x, z) => (x > AIR.strip.x0 && x < AIR.strip.x1 && Math.abs(z - AIR.strip.z) < AIR.strip.half ? AIR.strip.level : null), what: "the airstrip" },
  haul: { tol: 0.06, at: (x, z) => (HAUL.tents.some(([cx, cz]) => Math.abs(x - cx) < HAUL.tentW / 2 && Math.abs(z - cz) < HAUL.tentD / 2) ? 0.36 : null), what: "the tent pads" },
  ridge: { tol: CFG.LEVELS.ridge.gradeTolerance, at: (x, z) => (Math.abs(x) < 2.6 && z > -30 && z < RIDGE.stage.z0 ? ridgeRoad(z) : null), what: "the road (5 m wide)" },
}[SITE] || null;
const cHigh = new THREE.Color(0xe0453a), cOn = new THREE.Color(0x4fd16a), cLow = new THREE.Color(0x3a7be0), cSoft = new THREE.Color(0xf09a3e), cPacked = new THREE.Color(0x2fb5a8);
function overlayColor(wx, wz, hm, pk) {
  if (overlay.mode === "pack") { _c.lerp(cSoft, 0.75).lerp(cPacked, 0.75 * pk); return; }
  const tgt = GRADE && GRADE.at(wx, wz);
  if (tgt == null) { _c.multiplyScalar(0.55); return; }
  const d = hm - tgt;
  if (Math.abs(d) <= GRADE.tol) _c.lerp(cOn, 0.8);
  else _c.lerp(d > 0 ? cHigh : cLow, Math.min(0.9, 0.5 + (Math.abs(d) - GRADE.tol) * 0.4));
}
const chunks = [];
const dirtyChunks = new Set();
function buildCollider(c) {
  if (c.collider) world.removeCollider(c.collider, false);
  const hf = new Float32Array((CH + 1) * (CH + 1));
  for (let lx = 0; lx <= CH; lx++) for (let lz = 0; lz <= CH; lz++) hf[lz + lx * (CH + 1)] = heights[c.z0 + lz + (c.x0 + lx) * W];
  c.collider = world.createCollider(RAPIER.ColliderDesc.heightfield(CH, CH, hf, { x: CH * CELL, y: 1, z: CH * CELL })
    .setTranslation((c.x0 + CH / 2) * CELL - HALF, 0, (c.z0 + CH / 2) * CELL - HALF).setFriction(0.9).setCollisionGroups(0x0001ffff));
}
function buildMesh(c) {
  const pos = c.pos, col = c.col;
  let o = 0;
  const tri = (ax, az, bx, bz, cx, cz) => {
    const ia = az + ax * W, ib = bz + bx * W, ic = cz + cx * W, ha = heights[ia], hb = heights[ib], hc = heights[ic];
    const wx = ((ax + bx + cx) / 3) * CELL - HALF, wz = ((az + bz + cz) / 3) * CELL - HALF;
    groundColor(wx, wz, (ha + hb + hc) / 3, (Math.max(ha, hb, hc) - Math.min(ha, hb, hc)) / CELL);
    const l = loose[ia] + loose[ib] + loose[ic], gq = (gravH[ia] + gravH[ib] + gravH[ic]) / 3;
    const m = ((mudA[ia] + mudA[ib] + mudA[ic]) / 3) * (1 - smooth(0.03, 0.12, gq));
    // loose dirt shows brown, except the treasure hunt's untouched mounds (they'd give the clues away)
    if (l && !(SITE === "treasure" && Math.abs(ha - base[ia]) + Math.abs(hb - base[ib]) + Math.abs(hc - base[ic]) < 0.06)) _c.lerp(cLoose, 0.3 * l);
    if (m > 0.05) _c.lerp(cMud, Math.min(1, m) * 0.85);
    if (gq > 0.008) _c.lerp(cGravel, Math.min(1, gq / 0.06));
    _c.multiplyScalar(0.93 + hash2(ax * 3 + bx, az * 5 + cz) * 0.14);
    if (overlay.mode) overlayColor(wx, wz, (ha + hb + hc) / 3, (pack[ia] + pack[ib] + pack[ic]) / 3);
    pos[o] = ax * CELL - HALF; pos[o + 1] = ha; pos[o + 2] = az * CELL - HALF;
    pos[o + 3] = bx * CELL - HALF; pos[o + 4] = hb; pos[o + 5] = bz * CELL - HALF;
    pos[o + 6] = cx * CELL - HALF; pos[o + 7] = hc; pos[o + 8] = cz * CELL - HALF;
    for (let k = 0; k < 9; k += 3) { col[o + k] = _c.r; col[o + k + 1] = _c.g; col[o + k + 2] = _c.b; }
    o += 9;
  };
  for (let x = c.x0; x < c.x0 + CH; x++) for (let z = c.z0; z < c.z0 + CH; z++) { tri(x, z, x, z + 1, x + 1, z); tri(x + 1, z, x, z + 1, x + 1, z + 1); }
  c.geo.attributes.position.needsUpdate = true; c.geo.attributes.color.needsUpdate = true;
  c.geo.computeVertexNormals(); c.geo.computeBoundingSphere();
}
for (let cx = 0; cx < NC; cx++) for (let cz = 0; cz < NC; cz++) {
  const c = { x0: cx * CH, z0: cz * CH, collider: null, pos: new Float32Array(CH * CH * 18), col: new Float32Array(CH * CH * 18), geo: new THREE.BufferGeometry() };
  c.geo.setAttribute("position", new THREE.BufferAttribute(c.pos, 3));
  c.geo.setAttribute("color", new THREE.BufferAttribute(c.col, 3));
  const mesh = new THREE.Mesh(c.geo, groundMat); mesh.receiveShadow = true; scene.add(mesh);
  buildCollider(c); buildMesh(c);
  chunks.push(c);
}
function markDirty(xi, zi) {
  const a = clamp(Math.floor((xi - 1) / CH), 0, NC - 1), b = clamp(Math.floor(xi / CH), 0, NC - 1);
  const c = clamp(Math.floor((zi - 1) / CH), 0, NC - 1), d = clamp(Math.floor(zi / CH), 0, NC - 1);
  dirtyChunks.add(a * NC + c); dirtyChunks.add(a * NC + d); dirtyChunks.add(b * NC + c); dirtyChunks.add(b * NC + d);
}
const netEdits = new Map();          // vertex index -> height change made here since the last network send
// Every terrain change goes through here. Returns the change actually applied (bedrock stops digging).
// g is how much of an added amount is gravel. Taking ground away takes the gravel on top first:
// lastG says how much gravel the last call removed.
const netG = new Map();              // vertex index -> gravel thickness change made here since the last network send
const netP = new Set();              // vertex indices this game's roller packed since the last network send
let lastG = 0;
function addHeight(xi, zi, dh, mine = true, g = 0) {
  lastG = 0;
  if (xi < 1 || zi < 1 || xi >= G || zi >= G) return 0;
  const i = zi + xi * W, h = Math.max(base[i] - BEDROCK, heights[i] + dh), d = h - heights[i];
  if (d === 0) return 0;
  heights[i] = h; loose[i] = 1; markDirty(xi, zi);
  if (h < firm[i]) firm[i] = h;
  // dumped dirt is unpacked; digging down to undisturbed ground leaves it firm. Every game works this out
  // the same way from the same edits, so only the roller's packing needs sending.
  if (d > 0) pack[i] *= Math.exp(-d / CFG.PACK.dumpFalloff);
  else if (h <= firm[i] + 0.005) pack[i] = 1;
  if (mine) {
    netEdits.set(i, (netEdits.get(i) || 0) + d);
    let dg = 0;
    if (d < 0) { dg = -Math.min(gravH[i], -d); lastG = -dg; } else if (g > 0) dg = Math.min(g, d);
    if (dg) { gravH[i] = Math.max(0, gravH[i] + dg); netG.set(i, (netG.get(i) || 0) + dg); }
  }
  return d;
}
function flushTerrain() {
  if (!dirtyChunks.size) return;
  for (const k of dirtyChunks) {
    const c = chunks[k]; buildCollider(c); buildMesh(c);
    const x0 = c.x0 * CELL - HALF - 2, z0 = c.z0 * CELL - HALF - 2, x1 = x0 + CH * CELL + 4, z1 = z0 + CH * CELL + 4;
    for (const r of props) { if (!r.active || !r.body.isDynamic()) continue; const p = r.body.translation(); if (p.x > x0 && p.x < x1 && p.z > z0 && p.z < z1) r.body.wakeUp(); }
  }
  dirtyChunks.clear();
}

// Loose dirt slumps to a gentle slope; undisturbed ground only collapses when cut nearly vertical.
const active = { on: false, x0: 0, x1: 0, z0: 0, z1: 0, ttl: 0 };
function touch(xi, zi) {
  if (!active.on) Object.assign(active, { on: true, x0: xi, x1: xi, z0: zi, z1: zi });
  else { active.x0 = Math.min(active.x0, xi); active.x1 = Math.max(active.x1, xi); active.z0 = Math.min(active.z0, zi); active.z1 = Math.max(active.z1, zi); }
  active.ttl = 50;
}
// how steep loose dirt can stand: dirt tipped into the river spreads out flat, so a causeway ends up wide enough to drive on
function looseSlope(i) { if (SITE === "sands") return gravH[i] > 0.05 ? 0.62 : 0.38; return SITE === "river" && Math.abs((i % W) * CELL - HALF - RIVER.mid) < 11 && heights[i] < 0.9 ? 0.36 : 0.62; }
function relaxStep() {
  if (!active.on) return;
  if (--active.ttl <= 0) { active.on = false; return; }
  const x0 = Math.max(1, active.x0 - 5), x1 = Math.min(G - 1, active.x1 + 5), z0 = Math.max(1, active.z0 - 5), z1 = Math.min(G - 1, active.z1 + 5);
  let moved = false;
  const pair = (xa, za, xb, zb) => {
    const ia = za + xa * W, ib = zb + xb * W, d = heights[ia] - heights[ib], hi = d > 0 ? ia : ib;
    if (rockA[hi] && heights[hi] - firm[hi] <= 0.03) return;                                    // bedrock never slumps
    const over = Math.abs(d) - (heights[hi] - firm[hi] > 0.03 ? looseSlope(hi) : 1.5) * CELL;
    if (over <= 0.01) return;
    const took = -addHeight(d > 0 ? xa : xb, d > 0 ? za : zb, -over * 0.3), tookG = lastG;
    if (took > 0) { addHeight(d > 0 ? xb : xa, d > 0 ? zb : za, took, true, tookG); moved = true; }
  };
  for (let it = 0; it < 2; it++) for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) { pair(x, z, x + 1, z); pair(x, z, x, z + 1); }
  if (moved) active.ttl = 50;
}

// ---------- scenery and fixed things ----------
const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 2.2, 6), leafGeo = new THREE.ConeGeometry(1.7, 4.6, 7);
const trunkMat = lam(0x6b4a2b), leafMat = lam(0x3f7d3a, true);
function backdropTrees(count, r0, r1) {
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, count), leaves = new THREE.InstancedMesh(leafGeo, leafMat, count), m = new THREE.Matrix4();
  for (let i = 0; i < count; i++) {
    const a = rng() * Math.PI * 2, d = r0 + rng() * (r1 - r0), x = clamp(Math.cos(a) * d * 1.3, -93, 93), z = clamp(Math.sin(a) * d * 1.3, -93, 93);
    const y = heightAt(x, z), s = 0.8 + rng() * 0.7;
    trunks.setMatrixAt(i, m.makeScale(s, s, s).setPosition(x, y + 1.1 * s, z));
    leaves.setMatrixAt(i, m.makeScale(s, s, s).setPosition(x, y + 4.2 * s, z));
  }
  leaves.castShadow = true;
  scene.add(trunks, leaves);
}
function addTree(x, z, s = 1.2) {
  const y = heightAt(x, z), g = new THREE.Group(); g.position.set(x, y, z); scene.add(g);
  const trunk = new THREE.Mesh(trunkGeo, trunkMat); trunk.scale.set(s * 1.3, s, s * 1.3); trunk.position.y = 1.1 * s; trunk.castShadow = true;
  const leaf = new THREE.Mesh(leafGeo, leafMat); leaf.scale.setScalar(s); leaf.position.y = 4.2 * s; leaf.castShadow = true;
  g.add(trunk, leaf);
  world.createCollider(RAPIER.ColliderDesc.cylinder(1.6 * s, 0.42 * s).setTranslation(x, y + 1.5 * s, z));
  anchors.push({ pos: new THREE.Vector3(x, y + 1.2, z), name: "tree" });
}
function addPost(x, z) {
  const y = heightAt(x, z), g = new THREE.Group(); g.position.set(x, y, z); scene.add(g);
  for (let k = 0; k < 4; k++) {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.45, 10), lam(k % 2 ? 0x22262c : 0xffc928));
    band.position.y = 0.25 + k * 0.45; band.castShadow = true; g.add(band);
  }
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.36, 10, 6), lam(0xd64528)); cap.position.y = 2.0; g.add(cap);
  world.createCollider(RAPIER.ColliderDesc.cylinder(1.0, 0.34).setTranslation(x, y + 1.0, z));
  anchors.push({ pos: new THREE.Vector3(x, y + 1.3, z), name: "winch post" });
}
function makeSign(w, h) {
  const cv = document.createElement("canvas"); cv.width = 512; cv.height = 140;
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex }));
  mesh.userData.draw = (title, sub, subColor = "#ffc928") => {
    const g = cv.getContext("2d");
    g.fillStyle = "#1d232b"; g.fillRect(0, 0, 512, 140);
    g.strokeStyle = "#ffc928"; g.lineWidth = 8; g.strokeRect(4, 4, 504, 132);
    g.textAlign = "center"; g.fillStyle = "#fff"; g.font = "bold 46px system-ui, sans-serif"; g.fillText(title, 256, 64);
    g.fillStyle = subColor; g.font = "32px system-ui, sans-serif"; g.fillText(sub, 256, 114);
    tex.needsUpdate = true;
  };
  return mesh;
}
// A shed with an open doorway. face 1 puts the door on the +z side, -1 on the -z side.
const buildings = [];
function building(o) {
  const y0 = heightAt(o.x, o.z), s = o.face, t = 0.4, wall = lam(o.wall), roof = lam(o.roof, true);
  const g = new THREE.Group(); g.position.set(o.x, y0, o.z); if (s < 0) g.rotation.y = Math.PI; scene.add(g);
  const piece = (sx, sy, sz, lx, ly, lz, mat = wall) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat); m.position.set(lx, ly, lz); m.castShadow = m.receiveShadow = true; g.add(m);
    world.createCollider(RAPIER.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2).setTranslation(o.x + lx * s, y0 + ly, o.z + lz * s));
    return m;
  };
  const side = (o.w - o.door) / 2;
  piece(o.w, o.h, t, 0, o.h / 2, -o.d / 2);
  piece(t, o.h, o.d, -o.w / 2, o.h / 2, 0); piece(t, o.h, o.d, o.w / 2, o.h / 2, 0);
  piece(side, o.h, t, -(o.w - side) / 2, o.h / 2, o.d / 2); piece(side, o.h, t, (o.w - side) / 2, o.h / 2, o.d / 2);
  piece(o.door, o.h - o.dh, t, 0, o.dh + (o.h - o.dh) / 2, o.d / 2);
  const shape = new THREE.Shape(); shape.moveTo(-o.d / 2 - 0.6, 0); shape.lineTo(0, o.d * 0.38); shape.lineTo(o.d / 2 + 0.6, 0);
  const rg = new THREE.ExtrudeGeometry(shape, { depth: o.w + 1, bevelEnabled: false }).rotateY(Math.PI / 2).translate(-(o.w + 1) / 2, o.h, 0);
  const rm = new THREE.Mesh(rg, roof); rm.castShadow = true; g.add(rm);
  const trim = new THREE.Mesh(new THREE.BoxGeometry(o.door + 0.5, 0.3, 0.5), lam(0xf4f1ea)); trim.position.set(0, o.dh + 0.1, o.d / 2 + 0.05); g.add(trim);
  const sign = makeSign(Math.min(o.w - 1, 8), 2.2); sign.position.set(0, o.dh + (o.h - o.dh) / 2 + 0.2, o.d / 2 + t / 2 + 0.03); g.add(sign);
  const bld = {
    group: g, sign, y0, roof: rm,
    inside(x, z) { const lx = (x - o.x) * s, lz = (z - o.z) * s; return Math.abs(lx) < o.w / 2 - 1.2 && lz > -o.d / 2 + 1 && lz < o.d / 2 - 1; },
  };
  buildings.push(bld);
  return bld;
}
function marker(x, z, r, color) {
  const y = heightAt(x, z);
  const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.35, r, 56), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.set(x, y + 0.1, z);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 60, 12, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }));
  beam.position.set(x, y + 30, z);
  scene.add(ring, beam);
  return { ring, beam };
}

// ---------- props ----------
const rockMats = [0x8f8b84, 0x7c7872, 0x9a9388, 0x86807a].map((c) => lam(c, true));
function addProp(p) { Object.assign(p, { owner: 0, active: true, index: props.length }); props.push(p); return p; }
function addRock(x, z, r, type = "rock") {
  const g = new THREE.IcosahedronGeometry(1, 1), p = g.attributes.position, bumps = new Map(), pts = [];
  const sq = [0.75 + rng() * 0.5, 0.6 + rng() * 0.35, 0.75 + rng() * 0.5];
  const key = (i) => `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
  for (let i = 0; i < p.count; i++) {
    const k0 = key(i);
    if (!bumps.has(k0)) bumps.set(k0, 0.78 + rng() * 0.42);
    const k = bumps.get(k0) * r;
    p.setXYZ(i, p.getX(i) * k * sq[0], p.getY(i) * k * sq[1], p.getZ(i) * k * sq[2]);
  }
  const seen = new Set();
  for (let i = 0; i < p.count; i++) { const k0 = key(i); if (!seen.has(k0)) { seen.add(k0); pts.push(p.getX(i), p.getY(i), p.getZ(i)); } }
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, rockMats[Math.floor(rng() * rockMats.length)]);
  mesh.castShadow = mesh.receiveShadow = true; scene.add(mesh);
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, heightAt(x, z) + r * 0.8 + 0.2, z)
    .setRotation(new THREE.Quaternion().setFromEuler(new THREE.Euler(rng() * 6, rng() * 6, rng() * 6))).setLinearDamping(0.15).setAngularDamping(0.6));
  world.createCollider(RAPIER.ColliderDesc.convexHull(new Float32Array(pts)).setDensity(260).setFriction(0.85).setRestitution(0.05), body);
  return addProp({ type, name: type === "boulder" ? "boulder" : "rock", body, mesh, r, x, z, anchorsLocal: [new THREE.Vector3()], damp: 0.15 });
}
const barkMat = lam(0x6e5034, true), cutMat = lam(0xd9b98a);
const Q_Y_TO_Z = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
function addLog(x, z, len, rad, yaw) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad * 1.1, len, 9).rotateX(Math.PI / 2), barkMat);
  mesh.castShadow = mesh.receiveShadow = true; scene.add(mesh);
  for (const e of [1, -1]) {
    const cap = new THREE.Mesh(new THREE.CircleGeometry(rad * (e > 0 ? 0.97 : 1.07), 9), cutMat);
    cap.position.z = (e * len) / 2 + e * 0.01; if (e < 0) cap.rotation.y = Math.PI; mesh.add(cap);
  }
  for (let k = 0; k < 3; k++) {
    const st = new THREE.Mesh(new THREE.CylinderGeometry(rad * 0.18, rad * 0.25, rad * 2.2, 5), barkMat);
    st.position.set((rng() - 0.5) * rad, rad * 0.9, (rng() - 0.5) * len * 0.7); st.rotation.set((rng() - 0.5) * 1.2, 0, (rng() - 0.5) * 1.2); mesh.add(st);
  }
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, heightAt(x, z) + rad + 0.1, z).setRotation(q).setLinearDamping(0.2).setAngularDamping(0.8));
  world.createCollider(RAPIER.ColliderDesc.cylinder(len / 2, rad).setRotation(Q_Y_TO_Z).setDensity(230).setFriction(0.9), body);
  return addProp({ type: "log", name: len > 10 ? "big fallen tree" : "fallen tree", body, mesh, r: rad, x, z, damp: 0.2,
    anchorsLocal: [new THREE.Vector3(0, 0, len * 0.42), new THREE.Vector3(0, 0, -len * 0.42)] });
}
function addStump(x, z) {
  const mesh = new THREE.Group(); scene.add(mesh);
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1.0, 1.2, 10), barkMat); core.castShadow = true; mesh.add(core);
  const top = new THREE.Mesh(new THREE.CircleGeometry(0.84, 10), cutMat); top.rotation.x = -Math.PI / 2; top.position.y = 0.61; mesh.add(top);
  for (let k = 0; k < 5; k++) {
    const root = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.28, 1.6, 5), barkMat);
    const a = (k / 5) * Math.PI * 2; root.position.set(Math.cos(a) * 1.0, -0.35, Math.sin(a) * 1.0); root.rotation.set(Math.sin(a) * 1.1, 0, -Math.cos(a) * 1.1); mesh.add(root);
  }
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, heightAt(x, z) + 0.25, z));
  world.createCollider(RAPIER.ColliderDesc.cylinder(0.6, 0.95).setDensity(500).setFriction(0.9), body);
  return addProp({ type: "stump", name: "old stump", body, mesh, r: 1, x, z, damp: 0.3, anchorsLocal: [new THREE.Vector3(0, 0.3, 0)] });
}
function addTractor(x, z) {
  const mesh = new THREE.Group(); scene.add(mesh);
  const green = lam(0x3f8f3a), blk = lam(0x22262c);
  const part = (geo, mat, px, py, pz) => { const m = new THREE.Mesh(geo, mat); m.position.set(px, py, pz); m.castShadow = true; mesh.add(m); return m; };
  part(new THREE.BoxGeometry(1.4, 1.0, 3.2), green, 0, 0.1, 0.3);
  part(new THREE.BoxGeometry(1.5, 1.4, 1.3), lam(0x9fd0e8), 0, 1.1, -0.6);
  part(new THREE.BoxGeometry(1.6, 0.12, 1.5), green, 0, 1.85, -0.6);
  for (const sx of [1, -1]) {
    part(new THREE.CylinderGeometry(0.85, 0.85, 0.5, 14).rotateZ(Math.PI / 2), blk, sx * 1.0, -0.1, -0.7);
    part(new THREE.CylinderGeometry(0.5, 0.5, 0.36, 12).rotateZ(Math.PI / 2), blk, sx * 0.85, -0.45, 1.45);
  }
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, heightAt(x, z) + 1.0, z)
    .setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 1.2)).setLinearDamping(0.3).setAngularDamping(1.5));
  world.createCollider(RAPIER.ColliderDesc.cuboid(0.95, 0.75, 1.8).setTranslation(0, 0.05, 0.2).setDensity(420).setFriction(0.4), body);   // about 4.3 t: too heavy to push out, fine for a winch
  return addProp({ type: "tractor", name: "stuck tractor", body, mesh, r: 1.5, x, z, damp: 0.3, anchorsLocal: [new THREE.Vector3(0, 0, 1.9), new THREE.Vector3(0, 0, -1.6)] });
}

// A post-and-rail fence from (x0, z0) to (x1, z1); returns the collider so a gate can be opened later.
function fenceLine(x0, z0, x1, z1, y = 0.2) {
  const rail = lam(0x8a6a44), len = Math.hypot(x1 - x0, z1 - z0), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
  const g = new THREE.Group(); scene.add(g);
  for (const ry of [0.55, 1.05]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(alongX ? len : 0.12, 0.14, alongX ? 0.12 : len), rail);
    m.position.set(cx, y + ry, cz); m.castShadow = true; g.add(m);
  }
  const n = Math.max(2, Math.round(len / 3));
  for (let k = 0; k <= n; k++) {
    const pm = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.4, 0.2), rail);
    pm.position.set(lerp(x0, x1, k / n), y + 0.6, lerp(z0, z1, k / n)); pm.castShadow = true; g.add(pm);
  }
  const collider = world.createCollider(RAPIER.ColliderDesc.cuboid(alongX ? len / 2 : 0.12, 0.8, alongX ? 0.12 : len / 2).setTranslation(cx, y + 0.7, cz));
  return { group: g, collider };
}
// Clementine the pig: she just stands where she is (no behaviour). Finding her is the first job.
function addPig(x, z) {
  const mesh = new THREE.Group(); scene.add(mesh);
  const pink = lam(0xf2a7b6), dk = lam(0xd9849a);
  const part = (geo, mat, px, py, pz) => { const m = new THREE.Mesh(geo, mat); m.position.set(px, py, pz); m.castShadow = true; mesh.add(m); return m; };
  part(new THREE.BoxGeometry(0.85, 0.7, 1.3), pink, 0, 0.1, 0);
  part(new THREE.BoxGeometry(0.62, 0.58, 0.5), pink, 0, 0.25, 0.82);
  part(new THREE.BoxGeometry(0.34, 0.24, 0.12), dk, 0, 0.16, 1.12);
  for (const sx of [-0.2, 0.2]) part(new THREE.BoxGeometry(0.16, 0.2, 0.08), dk, sx, 0.6, 0.72).rotation.x = -0.5;
  for (const sx of [-0.28, 0.28]) for (const sz of [-0.42, 0.42]) part(new THREE.BoxGeometry(0.18, 0.4, 0.18), dk, sx, -0.38, sz);
  part(new THREE.TorusGeometry(0.1, 0.035, 5, 8, 4.5), dk, 0, 0.35, -0.7);
  for (const sx of [-0.14, 0.14]) part(new THREE.BoxGeometry(0.07, 0.07, 0.02), lam(0x1d232b), sx, 0.36, 1.08);
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, heightAt(x, z) + 0.62, z).setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 2.2)));
  world.createCollider(RAPIER.ColliderDesc.capsule(0.4, 0.42).setRotation(Q_Y_TO_Z), body);
  return addProp({ type: "pig", name: "Clementine", body, mesh, r: 0.9, x, z, damp: 0.5, anchorsLocal: [], yaw: 0, wander: 0, wdir: 0 });
}

function addCrate(x, z, sx, sy, sz, color, name, density) {
  const mesh = new THREE.Group(); scene.add(mesh);
  const bodyM = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), lam(color)); bodyM.castShadow = bodyM.receiveShadow = true; mesh.add(bodyM);
  for (const e of [1, -1]) { const band = new THREE.Mesh(new THREE.BoxGeometry(sx + 0.08, 0.16, sz + 0.08), lam(0x22262c)); band.position.y = e * sy * 0.3; mesh.add(band); }
  const skid = new THREE.Mesh(new THREE.BoxGeometry(sx + 0.3, 0.14, sz + 0.5), lam(0x6e5034)); skid.position.y = -sy / 2 - 0.05; skid.castShadow = true; mesh.add(skid);
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, heightAt(x, z) + sy / 2 + 0.3, z).setLinearDamping(0.3).setAngularDamping(1.5));
  world.createCollider(RAPIER.ColliderDesc.roundCuboid(sx / 2 - 0.25, sy / 2 + 0.06 - 0.25, sz / 2 - 0.25, 0.25).setDensity(density).setFriction(0.32).setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min), body);   // crates slide on their skids: towable uphill, but they stay put on a gentle slope
  return addProp({ type: "crate", name, body, mesh, r: Math.max(sx, sz) * 0.6, x, z, damp: 0.3,
    anchorsLocal: [new THREE.Vector3(0, 0, sz / 2), new THREE.Vector3(0, 0, -sz / 2), new THREE.Vector3(sx / 2, 0, 0), new THREE.Vector3(-sx / 2, 0, 0)] });
}

// ---------- build the site ----------
const houses = [];         // hub: level houses
let barn = null, barnDoor = null, sinkMarker = null, pileMarker = null, barnBeam = null;
let pig = null, gateRock = null, woodStack = null, penMarker = null, spotMarker = null, gateMarker = null, penGate = null, barnRoller = null;
const boulders = [], logs = [];
let stump = null, tractor = null, activeBoulders = 0;

if (SITE === "hub") {
  backdropTrees(150, 80, 93);
  for (const hs of HUB.houses) {
    const b = hs.garage
      ? building({ x: hs.x, z: hs.z, w: 30, d: 15, h: 7.5, door: 26, dh: 5.2, face: 1, wall: 0xc9ced6, roof: 0x7a54c7 })     // four bays wide
      : hs.paint
      ? building({ x: hs.x, z: hs.z, w: 13, d: 12, h: 7, door: 8, dh: 5.2, face: 1, wall: 0xf1ece4, roof: 0xd8467a })
      : building({ x: hs.x, z: hs.z, w: 12, d: 10, h: 7, door: 6.5, dh: 4.8, face: 1, wall: hs.locked ? 0x9a9488 : 0xd9c39a, roof: hs.locked ? 0x5c6168 : hs.needs ? 0x2f6fb0 : 0xb4442e });
    houses.push({ ...hs, b });
    if (hs.paint) {
      // paint booth: colour swatches on the back wall, a turntable pad and spray-can racks
      const g = b.group, sw = [0xe23b3b, 0xf28c28, 0xf7d23e, 0x4caf50, 0x2f8fd8, 0x7a54c7, 0xe2e2e2, 0x222222];
      sw.forEach((c, k) => { const m = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.4, 0.08), lam(c)); m.position.set(-4.9 + k * 1.4, 3.3, -5.75); g.add(m); });
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.2, 0.06, 40), lam(0x3c3f46)); pad.position.set(0, 0.04, 0.3); g.add(pad);
      const ring = new THREE.Mesh(new THREE.RingGeometry(4.0, 4.25, 48), new THREE.MeshBasicMaterial({ color: 0xff7ab0, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(0, 0.09, 0.3); g.add(ring);
      for (const sx of [-1, 1]) {
        const shelf = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 4), lam(0x8a6a44)); shelf.position.set(sx * 6.0, 1.6, -1.5); g.add(shelf);
        for (let k = 0; k < 6; k++) {
          const can = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.42, 10), lam(sw[(k + (sx > 0 ? 3 : 0)) % sw.length]));
          can.position.set(sx * 6.0, 1.85, -3.1 + k * 0.62); g.add(can);
        }
      }
    }
  }
  const F = HUB.field;
  const sizes = [];
  for (let i = 0; i < 26; i++) sizes.push(0.38 + rng() * 0.26);
  for (let i = 0; i < 10; i++) sizes.push(0.7 + rng() * 0.25);
  for (let i = 0; i < 4; i++) sizes.push(1.2 + rng() * 0.3);
  for (const r of sizes) {
    for (let tries = 0; tries < 60; tries++) {
      const a = rng() * Math.PI * 2, d = Math.sqrt(rng()), x = F.x + Math.cos(a) * d * F.r, z = F.z + Math.sin(a) * d * F.r;
      if (props.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + r + 0.4)) continue;
      addRock(x, z, r, r > 1.1 ? "boulder" : "rock");
      break;
    }
  }
} else if (SITE === "farm") {
  const F = FARM;
  backdropTrees(130, 82, 94);
  for (const [x, z] of F.trees) addTree(x, z, 1.1 + rng() * 0.4);
  // paddock fence round the spoil heap, with a gate facing the yard
  const P = F.paddock;
  fenceLine(P.x0, P.z0, P.x1, P.z0); fenceLine(P.x0, P.z1, P.x1, P.z1); fenceLine(P.x0, P.z0, P.x0, P.z1);
  fenceLine(P.x1, P.z0, P.x1, P.gate - P.gateW / 2); fenceLine(P.x1, P.gate + P.gateW / 2, P.x1, P.z1);
  {                                                // "take from here" sign on the spoil heap
    const s = makeSign(4.2, 1.15); s.userData.draw("Spoil heap", "Take from here");
    const y = heightAt(P.x1 - 3, P.gate + 6.5); s.position.set(P.x1 - 3, y + 2.2, P.gate + 6.5); s.rotation.y = Math.PI / 2; scene.add(s);
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.2, 0.14), lam(0x8a6a44)); pole.position.set(P.x1 - 3.1, y + 1.1, P.gate + 6.5); scene.add(pole);
  }
  // the pig pen, gate open on the west side (it closes once Clementine is home)
  const Pn = F.pen;
  fenceLine(Pn.x0, Pn.z0, Pn.x1, Pn.z0, 0.1); fenceLine(Pn.x0, Pn.z1, Pn.x1, Pn.z1, 0.1); fenceLine(Pn.x1, Pn.z0, Pn.x1, Pn.z1, 0.1);
  fenceLine(Pn.x0, Pn.z0, Pn.x0, Pn.gate0, 0.1); fenceLine(Pn.x0, Pn.gate1, Pn.x0, Pn.z1, 0.1);
  {
    const trough = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.5, 0.8), lam(0x6e5034)); trough.position.set(Pn.x1 - 2, 0.35, Pn.z1 - 1.6); trough.castShadow = true; scene.add(trough);
    const s = makeSign(3.2, 0.9); s.userData.draw("Clementine", "Pig pen", "#ff9cc4"); s.position.set(Pn.x0 - 0.2, 2.2, Pn.gate1 + 1.6); s.rotation.y = -Math.PI / 2; scene.add(s);
  }
  // muddy hoofprints from the pen gate to where the pig is
  {
    const geo = new THREE.CircleGeometry(0.16, 7).rotateX(-Math.PI / 2), mat = new THREE.MeshLambertMaterial({ color: 0x4a3423, transparent: true, opacity: 0.85, depthWrite: false });
    const pts = F.prints, n = 70, im = new THREE.InstancedMesh(geo, mat, n * 2), m = new THREE.Matrix4();
    let k = 0, total = 0; const seg = [];
    for (let i = 0; i + 1 < pts.length; i++) { const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); seg.push(l); total += l; }
    for (let s = 0; s < n; s++) {
      let d = (s / n) * total, i = 0;
      while (i < seg.length - 1 && d > seg[i]) { d -= seg[i]; i++; }
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1], t = d / seg[i], dx = (bx - ax) / seg[i], dz = (bz - az) / seg[i];
      const x = lerp(ax, bx, t), z = lerp(az, bz, t), side = s % 2 ? 0.22 : -0.22;
      for (const fwd of [0, 0.22]) {
        const px = x - dz * side + dx * fwd, pz = z + dx * side + dz * fwd;
        im.setMatrixAt(k++, m.makeTranslation(px, heightAt(px, pz) + 0.04, pz));
      }
    }
    im.count = k; scene.add(im);
  }
  pig = addPig(F.pig.x, F.pig.z);
  // the well beside the sinkhole
  {
    const w = new THREE.Group(); w.position.set(F.well.x, heightAt(F.well.x, F.well.z), F.well.z); scene.add(w);
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.1, 0.9, 14, 1, true), lam(0x9a948a)); ring.position.y = 0.45; ring.material.side = THREE.DoubleSide; w.add(ring);
    for (const sx of [-0.9, 0.9]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2.1, 0.15), lam(0x6e5034)); p.position.set(sx, 1.05, 0); w.add(p); }
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.4, 0.8, 4), lam(0x8f3b2e, true)); roof.position.y = 2.4; roof.rotation.y = Math.PI / 4; w.add(roof);
    world.createCollider(RAPIER.ColliderDesc.cylinder(0.6, 1.1).setTranslation(F.well.x, w.position.y + 0.5, F.well.z));
  }
  // the creek
  {
    const water = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, F.stream.w * 2 + 3), new THREE.MeshLambertMaterial({ color: 0x5d7f8c, transparent: true, opacity: 0.82 }));
    water.rotation.x = -Math.PI / 2; water.position.set(0, -0.62, F.stream.z); scene.add(water);
  }
  // the woodpile: delivered logs stack up here
  woodStack = new THREE.Group(); woodStack.position.set(F.pile.x, heightAt(F.pile.x, F.pile.z), F.pile.z); scene.add(woodStack);
  for (let k = 0; k < 2; k++) { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 5, 8).rotateZ(Math.PI / 2), barkMat); m.position.set(0, 0.33, -1.2 + k * 0.7); m.castShadow = true; woodStack.add(m); }
  barn = building({ x: F.barn.x, z: F.barn.z, w: F.barn.w, d: F.barn.d, h: F.barn.h, door: F.barn.door, dh: F.barn.dh, face: -1, wall: 0xa8392c, roof: 0x5b5f66 });
  barn.sign.userData.draw("Barn", "Opens when the jobs are done");
  barnDoor = new THREE.Mesh(new THREE.BoxGeometry(F.barn.door, F.barn.dh, 0.25), lam(0xe9e2d0));
  barnDoor.position.set(0, F.barn.dh / 2, F.barn.d / 2 + 0.05); barn.group.add(barnDoor);
  barnDoor.userData.collider = world.createCollider(RAPIER.ColliderDesc.cuboid(F.barn.door / 2, F.barn.dh / 2, 0.2).setTranslation(F.barn.x, barn.y0 + F.barn.dh / 2, F.barn.z - F.barn.d / 2));
  addPost(F.post.x, F.post.z);
  anchors[anchors.length - 1].name = "post inside the barn";
  sinkMarker = marker(F.sink.x, F.sink.z, F.sink.r + 0.6, 0x5fd0ff);
  sinkMarker.ring.position.y = 0.1; sinkMarker.beam.position.y = 30;
  pileMarker = marker(F.pile.x, F.pile.z, F.pile.r, 0x8be28b);
  penMarker = marker((Pn.x0 + Pn.x1) / 2, (Pn.z0 + Pn.z1) / 2, 4.5, 0xff9cc4);
  spotMarker = marker(F.tractorSpot.x, F.tractorSpot.z, F.tractorSpot.r, 0x8be28b);
  gateMarker = marker(F.gateZone.x, F.gateZone.z, F.gateZone.r, 0xffa23a);
  barnBeam = marker(F.barn.x, F.barn.z - F.barn.d / 2 - 2, 0.6, 0xffc928).beam; barnBeam.visible = false;
  for (const mk of [sinkMarker, pileMarker, spotMarker, gateMarker]) mk.ring.visible = mk.beam.visible = false;     // each shows when its job comes up
  // props, always in the same order so every player's copy matches
  tractor = addTractor(F.tractor.x, F.tractor.z);
  tractor.name = "Dinston's tractor";
  gateRock = addRock(F.gateRock.x, F.gateRock.z, F.gateRock.r, "boulder");
  for (const [x, z, len, rad, yaw] of F.logs) logs.push(addLog(x, z, len, rad, yaw));
}
// ----- level 2: Rapid River -----
let crate = null, toolbox = null, depotMarker = null, fordMarker = null, ripMarker = null, weddingMarker = null;
const riverRocks = [], gravel = [];            // gravel: prop indices of rocks crushed (and logs stacked) - they are gone
const riprapRocks = [], guests = [];
let partyCar = null;
if (SITE === "river") {
  const R = RIVER;
  backdropTrees(130, 82, 94);
  for (const [x, z] of R.trees) addTree(x, z, 1.1 + rng() * 0.4);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, 22), new THREE.MeshLambertMaterial({ color: 0x3f7fa6, transparent: true, opacity: 0.85 }));
  water.rotation.x = -Math.PI / 2; water.position.set(0, R.water, R.mid); scene.add(water);
  // the current: a few arrows drifting downstream on the water
  {
    const arrowGeo = new THREE.ConeGeometry(0.35, 1.2, 3).rotateZ(-Math.PI / 2).rotateX(-Math.PI / 2);
    const arrows = new THREE.InstancedMesh(arrowGeo, new THREE.MeshBasicMaterial({ color: 0xcfe8f5, transparent: true, opacity: 0.55 }), 24);
    arrows.userData.t = 0; scene.add(arrows); R.arrows = arrows;
  }
  fordMarker = marker(R.ford.x, R.mid - 9, 4.5, 0xffa23a);
  ripMarker = marker((R.riprap.x0 + R.riprap.x1) / 2, R.mid, 4.2, 0xffa23a);
  depotMarker = marker(R.depot.x, R.depot.z, R.depot.r, 0x8be28b);
  weddingMarker = marker(R.wedding.x, R.wedding.z, R.wedding.r, 0xff9cc4);
  // the wedding: an arch, tables and guests waiting on the far side (they cheer at the end; that's all they do)
  {
    const W2 = R.wedding, y0 = heightAt(W2.x, W2.z), white = lam(0xf4f1ea);
    const g = new THREE.Group(); g.position.set(W2.x, y0, W2.z + 6); scene.add(g);
    for (const sx of [-1.8, 1.8]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.25, 2.6, 0.25), white); p.position.set(sx, 1.3, 0); p.castShadow = true; g.add(p); }
    const arch = new THREE.Mesh(new THREE.TorusGeometry(1.8, 0.14, 6, 18, Math.PI), lam(0xff9cc4)); arch.position.y = 2.6; g.add(arch);
    const colors = [0x3b8fe0, 0xd8333a, 0x52b45a, 0xf2b21c, 0x8a4fd1, 0x2fc4c4, 0xe2572b, 0x22262c, 0xff7ab8, 0x9aa3ad];
    const person = (x, z, col, head = 0xe0b48d) => {
      const p = new THREE.Group(); p.position.set(x, heightAt(x, z), z); scene.add(p);
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 1.1, 8), lam(col)); b.position.y = 0.55; b.castShadow = true; p.add(b);
      const h = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), lam(head)); h.position.y = 1.32; p.add(h);
      p.userData.y0 = p.position.y; guests.push(p); return p;
    };
    person(W2.x - 0.6, W2.z + 6, 0xffffff, 0x8d5a3b); person(W2.x + 0.6, W2.z + 6, 0x2f4a6b);          // Minston and Tinston
    for (let k = 0; k < 10; k++) person(W2.x - 5 + (k % 5) * 2.5, W2.z - 1 + Math.floor(k / 5) * 2.2, colors[k], [0xe0b48d, 0x8d5a3b, 0xc98d64, 0xf0c7a6][k % 4]);
    for (const tx of [-7, 7]) { const t = new THREE.Mesh(new THREE.BoxGeometry(3, 0.8, 1.2), white); t.position.set(W2.x + tx, heightAt(W2.x + tx, W2.z + 2) + 0.4, W2.z + 2); t.castShadow = true; scene.add(t); }
    // their car, which drives home across your causeway at the end
    partyCar = new THREE.Group(); scene.add(partyCar);
    const blue = lam(0x3b8fe0);
    const part = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; partyCar.add(m); };
    part(new THREE.BoxGeometry(1.7, 0.6, 3.8), blue, 0, 0.55, 0); part(new THREE.BoxGeometry(1.5, 0.55, 1.9), lam(0x9fd0e8), 0, 1.1, -0.2);
    for (const sx of [-0.85, 0.85]) for (const sz of [-1.2, 1.2]) part(new THREE.CylinderGeometry(0.34, 0.34, 0.25, 12).rotateZ(Math.PI / 2), lam(0x22262c), sx, 0.34, sz);
    for (let k = 0; k < 3; k++) part(new THREE.CylinderGeometry(0.08, 0.08, 0.5, 6).rotateX(Math.PI / 2), lam(0xd9d9d9), -0.4 + k * 0.4, 0.2, -2.15);    // tin cans
    partyCar.position.set(W2.x + 9, heightAt(W2.x + 9, W2.z - 4), W2.z - 4); partyCar.rotation.y = Math.PI;
  }
  crate = addCrate(R.cake.x, R.cake.z, 2.0, 1.0, 2.0, 0xf4f1ea, "wedding cake", 180);
  {                                                // three tiers on the cake board; hard bumps knock them off
    crate.tiers = [];
    for (let k = 0; k < 3; k++) {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.75 - k * 0.2, 0.75 - k * 0.2, 0.42, 16), lam(k % 2 ? 0xffd6e4 : 0xfffaf0));
      t.position.y = 0.72 + k * 0.42; t.castShadow = true; crate.mesh.add(t); crate.tiers.push(t);
    }
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), lam(0xd8333a)); top.position.y = 0.95; crate.tiers[2].add(top);
  }
  toolbox = addCrate(R.tool.x, R.tool.z, 1.3, 0.9, 1.0, 0x3b8fe0, "toolbox", 260);
  for (const [x, z, r] of R.rocks) riverRocks.push(addRock(x, z, r, "rock"));
  for (const [x, z, r] of R.boulders) riprapRocks.push(addRock(x, z, r, "boulder"));
}
// Crushing a rock spreads it into a patch of gravel: firm footing over mud.
// ----- level 3: Ridge Road -----
let cabin = null, firewood = null, padMarker = null;
const ridgeRocks = [];
if (SITE === "ridge") {
  const R = RIDGE;
  backdropTrees(130, 82, 94);
  for (const [x, z] of R.trees) addTree(x, z, 1.1 + rng() * 0.4);
  addPost(R.post.x, R.post.z);
  padMarker = marker(R.pad.x, R.pad.z, R.pad.r, 0x8be28b);
  cabin = addCrate(R.cabin.x, R.cabin.z, 4.4, 2.3, 3.6, 0xb98a52, "cabin", 90);       // about 2.1 t, 4.4 m wide: it needs a 5 m road
  {                                               // give the cabin a roof, a door and a window
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 2.5, 1.3, 4, 1).rotateY(Math.PI / 4), lam(0x8f3b2e, true)); roof.scale.set(1.35, 1, 1.25); roof.position.y = 1.85; roof.castShadow = true; cabin.mesh.add(roof);
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.5, 0.06), lam(0x5a3b22)); door.position.set(-0.6, -0.35, 1.82); cabin.mesh.add(door);
    const win = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.7, 0.06), lam(0x9fd0e8)); win.position.set(0.7, 0.15, 1.82); cabin.mesh.add(win);
  }
  firewood = addCrate(R.wood.x, R.wood.z, 1.5, 1.0, 1.2, 0x8a5a2b, "firewood crate", 240);
  {                                               // stakes marking the 5 m the cabin needs, at the road's finished level
    const geo = new THREE.CylinderGeometry(0.07, 0.07, 6, 5), mat = new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.55 });
    const im = new THREE.InstancedMesh(geo, mat, 60), m = new THREE.Matrix4(); let n = 0;
    for (let z = -28; z <= R.stage.z0 - 2 && n < 60; z += 3) for (const x of [-2.5, 2.5]) im.setMatrixAt(n++, m.makeTranslation(x, ridgeRoad(z) + 2, z));
    im.count = n; scene.add(im);
  }
  for (const [x, z, r] of R.rocks) ridgeRocks.push(addRock(x, z, r, "rock"));
}

function markCrushed(idx) {
  if (gravel.includes(idx)) return false;
  gravel.push(idx);
  const p = props[idx];
  if (p && p.active) { p.active = false; p.body.setEnabled(false); p.mesh.visible = false; if (winch.on && winch.kind === 1 && winch.ref === idx) hookOff(); }
  return true;
}
// Called by whoever crushed it: the rock becomes a heap of loose gravel you can scoop, carry and spread.
function layGravel(idx, x, z, size) {
  if (!markCrushed(idx)) return;
  const vol = 3 + size * 3, n = 30;
  for (let k = 0; k < n; k++) {
    const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * (1.2 + size);
    splat(x + Math.cos(a) * d, z + Math.sin(a) * d, vol / n, vol / n);
  }
  for (let k = 0; k < 24; k++) spawnDirt(x + (Math.random() - 0.5) * 2, heightAt(x, z) + 0.8, z + (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 6, 3 + Math.random() * 3, (Math.random() - 0.5) * 6, 0, 1);
}

// ----- level 4: Gravel Run -----
const tentCells = [], tents = [], queueCars = [];
let gateBar = null;
let hopper = null, padCells = [], pinCells = [], picnic = null, blockLog = null, padMarker4 = null, fordMarker4 = null, bayMarker = null;
const hopperD = [0, 0], blockRocks = [], fordRocks = [];
if (SITE === "haul") {
  const H = HAUL;
  backdropTrees(130, 82, 94);
  for (const [x, z] of H.trees) addTree(x, z, 1.1 + rng() * 0.4);
  const cellsIn = (x0, x1, z0, z1) => { const out = []; for (let x = x0; x <= x1; x += CELL) for (let z = z0; z <= z1; z += CELL) out.push(Math.round((z + HALF) / CELL) + Math.round((x + HALF) / CELL) * W); return out; };
  const P = H.pad;
  padCells = cellsIn(P.x - P.w / 2, P.x + P.w / 2, P.z - P.d / 2, P.z + P.d / 2);
  pinCells = cellsIn(H.hairpin.x0, H.hairpin.x1, H.hairpin.z0, H.hairpin.z1);
  const line = lam(0xffc928), tw = H.tentW, td = H.tentD;
  for (const [cx, cz] of H.tents) {
    tentCells.push(cellsIn(cx - tw / 2, cx + tw / 2, cz - td / 2, cz + td / 2));
    for (const [sx, sz, lx, lz] of [[tw, 0.15, 0, -td / 2], [tw, 0.15, 0, td / 2], [0.15, td, -tw / 2, 0], [0.15, td, tw / 2, 0]]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.1, sz), line); m.position.set(cx + lx, 0.42, cz + lz); scene.add(m);
    }
    const tent = new THREE.Mesh(new THREE.ConeGeometry(2.2, 2.4, 4).rotateY(Math.PI / 4), lam([0xe2572b, 0x3b8fe0, 0x52b45a, 0xf2b21c][tents.length], true));
    tent.position.set(cx, 0.3, cz); tent.scale.setScalar(0.001); tent.visible = false; tent.castShadow = true; scene.add(tent); tents.push(tent);
  }
  padMarker4 = marker(P.x, P.z, 1.2, 0xffc928);
  // the campground gate and the campers' cars waiting behind it
  {
    const G2 = H.gate, red = lam(0xd8333a), white = lam(0xf4f1ea);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.4, 0.4), white); post.position.set(G2.x, 1.0, G2.z - 3.4); scene.add(post);
    gateBar = new THREE.Group(); gateBar.position.set(G2.x, 1.55, G2.z - 3.2); scene.add(gateBar);
    for (let k = 0; k < 6; k++) { const s2 = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 1.1), k % 2 ? white : red); s2.position.z = 0.55 + k * 1.1; gateBar.add(s2); }
    const sg = makeSign(4.2, 1.1); sg.position.set(G2.x + 0.3, 2.6, G2.z + 4); sg.rotation.y = Math.PI / 2; scene.add(sg); sg.userData.draw("Campground", "Opens at dawn");
    const cols = [0x3b8fe0, 0xf2f2ee, 0xd8333a, 0x52b45a, 0xf2b21c, 0x8a4fd1, 0x9aa3ad, 0x2fc4c4];
    for (let k = 0; k < H.queue.max; k++) {
      const c = new THREE.Group(), x = H.queue.x + k * H.queue.step; c.position.set(x, heightAt(x, G2.z), G2.z); c.rotation.y = -Math.PI / 2; scene.add(c);
      const b = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 4.0), lam(cols[k])); b.position.y = 0.7; b.castShadow = true; c.add(b);
      const top = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.9, k % 3 === 0 ? 3.2 : 1.9), lam(k % 3 === 0 ? 0xf4f1ea : 0x9fd0e8)); top.position.set(0, 1.45, k % 3 === 0 ? 0.2 : -0.2); c.add(top);
      for (const sx of [-0.9, 0.9]) for (const sz of [-1.3, 1.3]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.25, 10).rotateZ(Math.PI / 2), lam(0x22262c)); w.position.set(sx, 0.35, sz); c.add(w); }
      c.visible = false; c.userData.home = x; queueCars.push(c);
    }
  }
  fordMarker4 = marker(-40, H.stream.z, 6, 0xffa23a);
  // the loading hopper: a bin you tip into, a conveyor, and a chute a truck parks under
  const hp = H.hopper, y0 = heightAt(hp.x, hp.z), bay = H.bay, yb = heightAt(bay.x, bay.z), concrete = lam(0xa9adb3), yellow = lam(0xffc928);
  const solid = (mat, sx, sy, sz, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; scene.add(m);
    world.createCollider(RAPIER.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2).setTranslation(x, y, z)); return m; };
  solid(concrete, 4.9, 1.3, 0.3, hp.x, y0 + 0.65, hp.z + 2.3); solid(concrete, 4.9, 1.3, 0.3, hp.x, y0 + 0.65, hp.z - 2.3);
  solid(concrete, 0.3, 1.3, 4.9, hp.x + 2.3, y0 + 0.65, hp.z); solid(concrete, 0.3, 1.3, 4.9, hp.x - 2.3, y0 + 0.65, hp.z);
  for (const e of [-1, 1]) solid(yellow, 0.35, 5.0, 0.35, bay.x + e * 2.3, yb + 2.5, bay.z);
  const chute = new THREE.Mesh(new THREE.BoxGeometry(4.95, 0.9, 1.4), yellow); chute.position.set(bay.x, yb + 5.0, bay.z); chute.castShadow = true; scene.add(chute);
  const from = new THREE.Vector3(hp.x, y0 + 1.0, hp.z - 2.4), to = new THREE.Vector3(bay.x, yb + 5.3, bay.z);
  const belt = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.25, from.distanceTo(to)), lam(0x3a3f46)); belt.position.copy(from).lerp(to, 0.5); belt.lookAt(to); belt.castShadow = true; scene.add(belt);
  const heap = new THREE.Mesh(new THREE.SphereGeometry(2.1, 12, 6), lam(0xa9a8a2, true)); heap.position.set(hp.x, y0, hp.z); heap.visible = false; scene.add(heap);
  const sign = makeSign(4.2, 1.1); sign.position.set(hp.x, y0 + 2.2, hp.z - 2.5); sign.rotation.y = Math.PI; scene.add(sign); sign.userData.draw("Hopper", "Tip gravel in here");
  hopper = { x: hp.x, z: hp.z, y0, vol: 0, g: 0, cap: 40, heap };
  bayMarker = marker(bay.x, bay.z, bay.r, 0xffa23a);
  // props: the pit road blockage, rocks by the stream, the picnic tables
  { const [x, z, len, rad, yaw] = H.block.log; blockLog = addLog(x, z, len, rad, yaw); blockLog.name = "fallen tree"; }
  for (const [x, z, r] of H.block.rocks) blockRocks.push(addRock(x, z, r, "rock"));
  for (const [x, z, r] of H.fordRocks) fordRocks.push(addRock(x, z, r, "rock"));
  picnic = addCrate(H.picnic.x, H.picnic.z, 2.0, 1.0, 1.4, 0x8a5a2b, "picnic tables", 200);
}

// ----- level 5: Flood Season -----
let gate = null, gatePanel = null, riverWater = null, floodWater = null, pastureWater = null, lowBeam = null, rain = null, wheelMesh = null, wheelAnchor = -1;
const cars = [], breachBeams = [], floodRocks = [], tyreMat = lam(0x22262c), townPts = [];
let gateCollider = null;
if (SITE === "flood") {
  const F = FLOOD;
  backdropTrees(130, 82, 94);
  for (const [x, z] of F.trees) addTree(x, z, 1.1 + rng() * 0.4);
  for (const [x, z, face] of F.homes) {
    const b = building({ x, z, w: 7, d: 6, h: 3.6, door: 2.2, dh: 2.3, face, wall: [0xe9dcc3, 0xd7e3ea, 0xf0d2c0][Math.floor(rng() * 3)], roof: [0x8f3b2e, 0x3b5f8f, 0x4f6b3a][Math.floor(rng() * 3)] });
    b.sign.visible = false;
  }
  // the town, as sample points for "how much of it is dry": everything behind the levee east of the pasture bank
  for (let x = F.berm.x + 3; x <= 76; x += 4) for (let z = -76; z <= F.levee.z - 5; z += 4) townPts.push(heightAt(x, z));
  const wmat = new THREE.MeshLambertMaterial({ color: 0x4f7f95, transparent: true, opacity: 0.85 });
  riverWater = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, HALF - F.levee.z + 1), wmat);
  riverWater.rotation.x = -Math.PI / 2; riverWater.position.set(0, F.water.start, (F.levee.z - 1 + HALF) / 2); scene.add(riverWater);
  const townW = 86 - F.berm.x;
  floodWater = new THREE.Mesh(new THREE.PlaneGeometry(townW, HALF + F.levee.z - 2), wmat);
  floodWater.rotation.x = -Math.PI / 2; floodWater.position.set(F.berm.x + townW / 2, -5, (F.levee.z - 2 - HALF) / 2); floodWater.visible = false; scene.add(floodWater);
  const Pa = F.pasture;
  pastureWater = new THREE.Mesh(new THREE.PlaneGeometry(Pa.x1 - Pa.x0 + 6, Pa.z1 - Pa.z0 + 6), wmat);
  pastureWater.rotation.x = -Math.PI / 2; pastureWater.position.set((Pa.x0 + Pa.x1) / 2, -5, (Pa.z0 + Pa.z1) / 2); pastureWater.visible = false; scene.add(pastureWater);
  {                                                // the pasture sign, on a post on the town side of its bank
    const sx = F.berm.x + F.berm.half + 1.5, sz = -4, y = heightAt(sx, sz);
    const s = makeSign(4.4, 1.15); s.userData.draw("Pasture", "Empty: nobody lives here", "#c9d1da"); s.position.set(sx, y + 2.6, sz); s.rotation.y = Math.PI / 2; scene.add(s);
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.2, 0.16), lam(0x8a6a44)); pole.position.set(sx + 0.1, y + 1.1, sz); scene.add(pole);
  }
  if (F.gate) {
  // the floodgate slot between two concrete walls; the gate panel hangs above it until you wind it down
  const concrete = lam(0xa9adb3), gx = F.gate.x, gz = F.levee.z;
  for (const e of [-1, 1]) {
    const x = gx + e * (F.gate.w / 2 + 0.45), m = new THREE.Mesh(new THREE.BoxGeometry(0.9, 5.6, 9), concrete); m.position.set(x, 2.4, gz); m.castShadow = m.receiveShadow = true; scene.add(m);
    world.createCollider(RAPIER.ColliderDesc.cuboid(0.45, 2.8, 4.5).setTranslation(x, 2.4, gz));
  }
  gatePanel = new THREE.Mesh(new THREE.BoxGeometry(F.gate.w, 3.0, 0.5), lam(0x7d858f)); gatePanel.castShadow = true; scene.add(gatePanel);
  // the wheel that winds it: hook your winch to it and reel in
  {
    const W3 = F.wheel, y = heightAt(W3.x, W3.z), g = new THREE.Group(); g.position.set(W3.x, y, W3.z); scene.add(g);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.4, 0.5), concrete); post.position.y = 1.2; post.castShadow = true; g.add(post);
    wheelMesh = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.12, 8, 20), lam(0xd8333a)); wheelMesh.position.set(0, 2.2, 0.35); g.add(wheelMesh);
    for (let k = 0; k < 3; k++) { const sp = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.08, 0.08), lam(0xd8333a)); sp.rotation.z = (k * Math.PI) / 3; wheelMesh.add(sp); }
    world.createCollider(RAPIER.ColliderDesc.cuboid(0.3, 1.3, 0.3).setTranslation(W3.x, y + 1.2, W3.z));
    anchors.push({ pos: new THREE.Vector3(W3.x, y + 2.2, W3.z), name: "floodgate wheel" }); wheelAnchor = anchors.length - 1;
    const s = makeSign(3.4, 0.9); s.userData.draw("Floodgate", "Hook and reel to close"); s.position.set(0, 3.6, 0.3); g.add(s);
  }
  }
  for (const b of [...F.breaches, F.late]) { const mk = marker(b.x, F.levee.z, 0.5, 0xffa23a); mk.ring.visible = false; breachBeams.push(mk.beam); }
  breachBeams[3].visible = false;
  if (F.gate) { const gm = marker(F.gate.x, F.levee.z, 0.5, 0xffa23a); gm.ring.visible = false; breachBeams.push(gm.beam); }
  lowBeam = marker(0, F.levee.z, 0.5, 0xff4a3a).beam; lowBeam.visible = false;
  // painted backdrops at both ends of the river, like a scenery flat: the river carries on into the distance
  for (const side of [-1, 1]) {
    const cv = document.createElement("canvas"); cv.width = 1024; cv.height = 512; paintRiverFlat(cv.getContext("2d"), side);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const flat = new THREE.Mesh(new THREE.PlaneGeometry(70, 35), new THREE.MeshBasicMaterial({ map: tex, fog: false }));
    flat.position.set(side * 95, 13.5, 41); flat.rotation.y = -side * Math.PI / 2; scene.add(flat);
  }
  // places from earlier jobs, across the river: Dinston's barn and the wedding arch
  {
    const barnFar = building({ x: -46, z: 86, w: 10, d: 8, h: 6, door: 4, dh: 3.5, face: -1, wall: 0xa8392c, roof: 0x5b5f66 }); barnFar.sign.userData.draw("Muddle Acres", "Grandma Dinston's", "#ff9cc4");
    const ay = heightAt(30, 86), arch = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.18, 6, 18, Math.PI), lam(0xff9cc4)); arch.position.set(30, ay + 3.2, 86); scene.add(arch);
  }
  // rain: a few hundred streaks around the camera (it stops at the end)
  rain = new THREE.InstancedMesh(new THREE.BoxGeometry(0.03, 0.9, 0.03), new THREE.MeshBasicMaterial({ color: 0xb8c8d6, transparent: true, opacity: 0.55 }), 400);
  rain.frustumCulled = false; rain.userData.drops = Array.from({ length: 400 }, () => [Math.random() * 60 - 30, Math.random() * 30, Math.random() * 60 - 30]); scene.add(rain);
  scene.background.set(0x8b9aa6); scene.fog.color.set(0x8b9aa6); scene.fog.near = 60; scene.fog.far = 220;
  // props, in a fixed order: boulders for riprap, then the three cars that will float down the river
  for (const [x, z, r] of F.riprap) floodRocks.push(addRock(x, z, r, "boulder"));
  for (const C of F.cars) {
    const c = addCrate(F.carStart.x, F.carStart.z, 1.9, 1.0, 4.0, C.color, C.name, 300);
    c.mesh.children.slice(1).forEach((m) => (m.visible = false));                    // no crate straps on a car
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.7, 2.0), lam(0x9fd0e8)); cab.position.set(0, 0.85, -0.2); c.mesh.add(cab);
    for (const [sx, sz] of [[1, 1.3], [-1, 1.3], [1, -1.3], [-1, -1.3]]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 12).rotateZ(Math.PI / 2), tyreMat); w.position.set(sx * 0.95, -0.45, sz); c.mesh.add(w); }
    if (C.cans) for (let k = 0; k < 3; k++) { const can = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.5, 6).rotateX(Math.PI / 2), lam(0xd9d9d9)); can.position.set(-0.4 + k * 0.4, -0.3, -2.2); c.mesh.add(can); }
    c.active = false; c.body.setEnabled(false); c.mesh.visible = false; c.spec = C;
    c.beam = marker(0, 0, 0.5, 0x5fd0ff).beam; c.beam.visible = false;
    cars.push(c);
  }
}
// Paint the far reach of the river onto a canvas: stormy sky, hills, green banks with trees, and the
// river narrowing to the horizon. side -1 is upstream (west), 1 downstream (east).
function paintRiverFlat(g, side) {
  const Wd = 1024, Hd = 512, hz = 236, vx = side > 0 ? 560 : 470;          // horizon and vanishing point
  const sky = g.createLinearGradient(0, 0, 0, hz); sky.addColorStop(0, "#7d8c98"); sky.addColorStop(1, "#b8c3ca"); g.fillStyle = sky; g.fillRect(0, 0, Wd, hz);
  g.fillStyle = "rgba(235,240,244,.55)";
  for (let k = 0; k < 9; k++) { const cx = (k * 137 + side * 60) % Wd, cy = 40 + (k * 53) % 120; g.beginPath(); g.ellipse(cx, cy, 70 + (k % 3) * 30, 16 + (k % 2) * 8, 0, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = "#7f9483"; g.beginPath(); g.moveTo(0, hz); for (let x = 0; x <= Wd; x += 32) g.lineTo(x, hz - 18 - 14 * Math.sin(x / 90 + side) - 8 * Math.sin(x / 37)); g.lineTo(Wd, hz); g.fill();     // far hills
  const bank = g.createLinearGradient(0, hz, 0, Hd); bank.addColorStop(0, "#6f8f5a"); bank.addColorStop(1, "#5d8a45"); g.fillStyle = bank; g.fillRect(0, hz, Wd, Hd - hz);
  // the river: wide at the bottom (where it meets the real one), winding to a point at the horizon
  const L = [], R = [];
  for (let k = 0; k <= 24; k++) {
    const t = k / 24, y = Hd - t * (Hd - hz), half = lerp(330, 6, Math.pow(t, 0.7)), bend = Math.sin(t * 5.5 + (side > 0 ? 0.8 : 2.2)) * 70 * t * (1 - t) * 2;
    const cx = lerp(Wd / 2, vx, t) + bend; L.push([cx - half, y]); R.push([cx + half, y]);
  }
  const water = g.createLinearGradient(0, hz, 0, Hd); water.addColorStop(0, "#9fb8c6"); water.addColorStop(1, "#4f7f95");
  g.fillStyle = water; g.beginPath(); g.moveTo(...L[0]); for (const p of L) g.lineTo(...p); for (const p of R.reverse()) g.lineTo(...p); g.closePath(); g.fill();
  g.strokeStyle = "rgba(225,238,245,.35)"; g.lineWidth = 2;                                                         // ripples
  for (let k = 0; k < 40; k++) { const t = (k * 0.618) % 1, y = Hd - t * (Hd - hz) * 0.95, w = lerp(60, 4, t); const cx = lerp(Wd / 2, vx, t) + Math.sin(t * 5.5 + (side > 0 ? 0.8 : 2.2)) * 70 * t * (1 - t) * 2 + ((k * 97) % 200 - 100) * (1 - t); g.beginPath(); g.moveTo(cx - w, y); g.lineTo(cx + w, y); g.stroke(); }
  for (let k = 0; k < 70; k++) {                                                                                     // trees along the banks, smaller with distance
    const t = ((k * 0.381) % 1) * 0.92, y = Hd - t * (Hd - hz), s = lerp(70, 6, t), left = k % 2 === 0;
    const edge = (left ? L : R.slice().reverse())[Math.round(t * 24)][0], x = edge + (left ? -1 : 1) * (s * 0.8 + ((k * 53) % 60) * (1 - t));
    g.fillStyle = "#3f6d3a"; g.beginPath(); g.moveTo(x, y - s * 1.6); g.lineTo(x - s * 0.45, y); g.lineTo(x + s * 0.45, y); g.closePath(); g.fill();
    g.fillStyle = "#6b4a2b"; g.fillRect(x - s * 0.06, y, s * 0.12, s * 0.25);
  }
  const fog = g.createLinearGradient(0, hz - 30, 0, hz + 60); fog.addColorStop(0, "rgba(184,195,202,0)"); fog.addColorStop(0.5, "rgba(184,195,202,.45)"); fog.addColorStop(1, "rgba(184,195,202,0)");
  g.fillStyle = fog; g.fillRect(0, hz - 30, Wd, 90);                                                                 // haze on the horizon
}
function lockGate() {
  if (gateCollider || !gatePanel) return;
  const F = FLOOD;
  gateCollider = world.createCollider(RAPIER.ColliderDesc.cuboid(F.gate.w / 2, 1.5, 0.25).setTranslation(F.gate.x, heightAt(F.gate.x, F.levee.z) + 1.5, F.levee.z));
}

// ----- level 6: X Marks the Spot -----
let tChest = null, tMill = null, tRuler = null, tCompass = null, homeMarker = null;
const tPosts = [], tJunk = [];
if (SITE === "treasure") {
  const T = TREASURE, wmat = new THREE.MeshLambertMaterial({ color: 0x4f86a6, transparent: true, opacity: 0.85 });
  backdropTrees(130, 82, 94);
  for (const R of [T.ford, T.deep]) { const w = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, R.w * 2 + 6), wmat); w.rotation.x = -Math.PI / 2; w.position.set(0, R.water, R.z); scene.add(w); }
  homeMarker = marker(T.home.x, T.home.z, T.home.r, 0x8be28b);
  const grey = lam(0x8d8a85, true), at = (L) => heightAt(L.x, L.z), M = T.marks;
  const solid = (geo, mat, x, y, z, r) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; scene.add(m);
    world.createCollider(RAPIER.ColliderDesc.ball(r).setTranslation(x, y, z)); return m; };
  {                                                // the lone dead pine: a tall grey trunk with bare branches
    const L = M.pine, y = at(L), g = new THREE.Group(); g.position.set(L.x, y, L.z); scene.add(g); const bark = lam(0x8a8378);
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.45, 9, 6), bark); t.position.y = 4.5; t.castShadow = true; g.add(t);
    for (let k = 0; k < 6; k++) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.1, 2.2, 4), bark); b.position.set(0, 3.5 + k * 0.8, 0); b.rotation.set(0, k * 2.1, 1.0 + (k % 2) * 0.4); b.translateY(0.9); g.add(b); }
    world.createCollider(RAPIER.ColliderDesc.cylinder(4.5, 0.45).setTranslation(L.x, y + 4.5, L.z)); anchors.push({ pos: new THREE.Vector3(L.x, y + 1.2, L.z), name: "dead pine" });
  }
  { const L = M.twins, y = at(L); solid(new THREE.DodecahedronGeometry(1.6, 0), grey, L.x - 1.7, y + 1.1, L.z, 1.5); solid(new THREE.DodecahedronGeometry(1.5, 0), grey, L.x + 1.7, y + 1.0, L.z + 0.4, 1.4); }
  {                                                // a rock shaped like a sleeping dog: curled body, head on its paws, ears, a tail
    const L = M.dog, y = at(L), g = new THREE.Group(); g.position.set(L.x, y, L.z); g.rotation.y = 0.6; scene.add(g);
    const part = (geo, x, y2, z, sx = 1, sy = 1, sz = 1) => { const m = new THREE.Mesh(geo, grey); m.position.set(x, y2, z); m.scale.set(sx, sy, sz); m.castShadow = true; g.add(m); };
    part(new THREE.SphereGeometry(1.4, 8, 6), 0, 0.9, 0, 1.5, 0.75, 1); part(new THREE.SphereGeometry(0.75, 8, 6), 2.0, 0.6, 0.6, 1.1, 0.8, 1);
    part(new THREE.ConeGeometry(0.3, 0.6, 4), 2.1, 1.25, 0.25); part(new THREE.ConeGeometry(0.3, 0.6, 4), 2.1, 1.25, 0.95);
    part(new THREE.CylinderGeometry(0.15, 0.25, 1.8, 5), -2.0, 0.4, 0.8, 1, 1, 1);
    world.createCollider(RAPIER.ColliderDesc.cuboid(2.6, 0.9, 1.5).setTranslation(L.x, y + 0.9, L.z));
  }
  {                                                // the old well
    const L = M.well, y = at(L), w = new THREE.Group(); w.position.set(L.x, y, L.z); scene.add(w);
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.1, 0.9, 14, 1, true), lam(0x9a948a)); ring.material.side = THREE.DoubleSide; ring.position.y = 0.45; w.add(ring);
    for (const sx of [-0.9, 0.9]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2.1, 0.15), lam(0x6e5034)); p.position.set(sx, 1.05, 0); w.add(p); }
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.4, 0.8, 4), lam(0x8f3b2e, true)); roof.position.y = 2.4; roof.rotation.y = Math.PI / 4; w.add(roof);
    world.createCollider(RAPIER.ColliderDesc.cylinder(0.6, 1.1).setTranslation(L.x, y + 0.5, L.z));
  }
  {                                                // the windmill, sails turning
    const L = M.mill, y = at(L), g = new THREE.Group(); g.position.set(L.x, y, L.z); scene.add(g);
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2.4, 9, 8), lam(0xe9dcc3)); tower.position.y = 4.5; tower.castShadow = true; g.add(tower);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(1.8, 2, 8), lam(0x8f3b2e)); cap.position.y = 10; g.add(cap);
    tMill = new THREE.Group(); tMill.position.set(0, 8.5, -1.9); g.add(tMill);
    for (let k = 0; k < 4; k++) { const s2 = new THREE.Mesh(new THREE.BoxGeometry(0.9, 5, 0.1), lam(0xf4f1ea)); s2.position.y = 2.6; const arm = new THREE.Group(); arm.rotation.z = (k * Math.PI) / 2; arm.add(s2); tMill.add(arm); }
    world.createCollider(RAPIER.ColliderDesc.cylinder(4.5, 2.2).setTranslation(L.x, y + 4.5, L.z));
  }
  {                                                // the scarecrow
    const L = M.crow, y = at(L), g = new THREE.Group(); g.position.set(L.x, y, L.z); scene.add(g); const wood = lam(0x8a6a44);
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.2, 3.2, 0.2), wood); pole.position.y = 1.6; g.add(pole);
    const arms = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.18, 0.18), wood); arms.position.y = 2.5; g.add(arms);
    const shirt = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.0, 0.5), lam(0xb8462e)); shirt.position.y = 2.2; shirt.castShadow = true; g.add(shirt);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), lam(0xe8c87a)); head.position.y = 3.0; g.add(head);
    const hat = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.6, 8), lam(0x5a3d26)); hat.position.y = 3.45; g.add(hat);
    world.createCollider(RAPIER.ColliderDesc.cylinder(1.6, 0.2).setTranslation(L.x, y + 1.6, L.z));
  }
  // the buried marker posts (they pop up when dug out), and the junk under the decoy mounds
  const wood = lam(0x8a6a44), red = lam(0xd8333a);
  for (const C of TCLUES) {
    if (C.chest) continue;
    const g = new THREE.Group(); g.position.set(C.x, heightAt(C.x, C.z) - 3, C.z); scene.add(g);
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.25, 2.0, 0.25), wood); p.position.y = 1.0; p.castShadow = true; g.add(p);
    const rib = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.25, 0.05), red); rib.position.set(0.3, 1.8, 0); g.add(rib);
    g.visible = false; tPosts.push(g);
  }
  T.decoys.forEach(([x, z], k) => {
    const shapes = [new THREE.BoxGeometry(0.4, 0.5, 0.9), new THREE.CylinderGeometry(0.2, 0.2, 0.4, 10), new THREE.SphereGeometry(0.35, 10, 8), new THREE.ConeGeometry(0.3, 0.8, 8), new THREE.BoxGeometry(0.6, 0.2, 0.6), new THREE.SphereGeometry(0.4, 12, 10)];
    const cols = [0x5a3d26, 0x9aa3ad, 0xf7d23e, 0xd8333a, 0xe8c87a, 0x22262c];
    const m = new THREE.Mesh(shapes[k % 6], lam(cols[k % 6])); m.position.set(x, heightAt(x, z) - 0.2, z); m.visible = false; m.castShadow = true; scene.add(m); tJunk.push(m);
  });
  // the chest, 2 m down under the last mound (it stays put until it's dug out)
  const C4 = TCLUES[3];
  tChest = addCrate(C4.x, C4.z, 1.8, 0.9, 1.2, 0x7a4b2a, "treasure chest", 420);
  tChest.mesh.children[1].material = tChest.mesh.children[2].material = lam(0xffc928);
  tChest.body.setBodyType(RAPIER.RigidBodyType.Fixed, true);
  tChest.body.setTranslation({ x: C4.x, y: base[Math.round((C4.z + HALF) / CELL) + Math.round((C4.x + HALF) / CELL) * W] - 0.7 - 2.0 + 0.45, z: C4.z }, true);
  // a car-length ruler you can switch on (O), and a compass
  tRuler = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.06, 0.18), new THREE.MeshBasicMaterial({ color: 0xffffff }), 12);
  tRuler.visible = false; tRuler.frustumCulled = false; scene.add(tRuler);
  tCompass = document.createElement("div"); tCompass.id = "compass"; tCompass.className = "panel"; document.body.appendChild(tCompass);
}

// ----- level 7: No Questions Asked -----
const standing = [], stripRocks = [];
let plane = null, planeWheel = null, airRain = null;
// A standing tree you can fell with a winch (it becomes a log, leaving a stump to pull out)
function addStandingTree(x, z, s, giant) {
  const y = heightAt(x, z), mesh = new THREE.Group(); scene.add(mesh);
  const trunk = new THREE.Mesh(trunkGeo, trunkMat); trunk.scale.set(s * 1.3, s, s * 1.3); trunk.position.y = 1.1 * s; trunk.castShadow = true;
  const leaf = new THREE.Mesh(leafGeo, leafMat); leaf.scale.setScalar(s); leaf.position.y = 4.2 * s; leaf.castShadow = true;
  mesh.add(trunk, leaf);
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z));
  world.createCollider(RAPIER.ColliderDesc.cylinder(1.6 * s, 0.42 * s).setTranslation(0, 1.5 * s, 0), body);
  const t = addProp({ type: "standing", name: giant ? "giant tree" : "tree", body, mesh, r: 0.5 * s, x, z, damp: 0, anchorsLocal: [new THREE.Vector3(0, 1.4 * s, 0)], giant, pullT: 0 });
  const log = addLog(x, z + 3 * s, giant ? 12 : 8, giant ? 0.55 : 0.38, Math.PI / 2);
  const stump = addStump(x, z);
  for (const p of [log, stump]) { p.active = false; p.body.setEnabled(false); p.mesh.visible = false; }
  t.log = log; t.stump = stump;
  return t;
}
if (SITE === "airstrip") {
  const A = AIR, S = A.strip;
  backdropTrees(240, 76, 94);
  for (let k = 0; k < 46; k++) {                    // jungle round the strip (not on it)
    const x = -80 + rng() * 160, z = (rng() < 0.5 ? -1 : 1) * (S.half + 9 + rng() * 50);
    if (Math.hypot(x - A.spawn.x, z - A.spawn.z) < 14 || Math.hypot(x - A.gravel.x, z - A.gravel.z) < A.gravel.r + 4 || A.yards.some((Y) => Math.hypot(x - Y.x, z - Y.z) < 10)) continue;
    addTree(x, z, 1.0 + rng() * 0.6);
  }
  for (let x = S.x0; x <= S.x1; x += 12) for (const e of [-1, 1]) {        // white edge markers
    const c = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.7, 6), lam(0xf4f1ea)); c.position.set(x, stripSurface(x) + 0.35, e * (S.half + 0.8)); scene.add(c);
  }
  { const sock = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.8, 8).rotateZ(Math.PI / 2), lam(0xff7a2a)); sock.position.set(S.x1 + 4, heightAt(S.x1 + 4, S.half + 4) + 4, S.half + 4); scene.add(sock);
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.15, 4, 0.15), lam(0xd9d9d9)); pole.position.set(S.x1 + 5, heightAt(S.x1 + 5, S.half + 4) + 2, S.half + 4); scene.add(pole); }
  // the plane: shown only when it comes in to land
  plane = new THREE.Group(); scene.add(plane); plane.visible = false;
  { const body = lam(0xe8e1d0), trim = lam(0x2fb5a8);
    const part = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; plane.add(m); return m; };
    part(new THREE.CylinderGeometry(0.9, 0.6, 11, 10).rotateZ(Math.PI / 2), body, 0, 1.6, 0);
    part(new THREE.BoxGeometry(2.4, 0.18, 15), body, 0.8, 1.9, 0); part(new THREE.BoxGeometry(1.4, 0.15, 5), trim, -5, 2.0, 0);
    part(new THREE.BoxGeometry(1.4, 2.0, 0.15), trim, -5.2, 2.8, 0); part(new THREE.BoxGeometry(0.15, 2.6, 0.3), lam(0x22262c), 5.7, 1.6, 0);
    for (const z of [-1.6, 1.6]) part(new THREE.CylinderGeometry(0.4, 0.4, 0.3, 10).rotateX(Math.PI / 2), lam(0x22262c), 0.5, 0.4, z);
    planeWheel = part(new THREE.CylinderGeometry(0.3, 0.3, 0.25, 10).rotateX(Math.PI / 2), lam(0x22262c), 4.5, 0.35, 0);
  }
  airRain = new THREE.InstancedMesh(new THREE.BoxGeometry(0.03, 0.9, 0.03), new THREE.MeshBasicMaterial({ color: 0xb8c8d6, transparent: true, opacity: 0.5 }), 400);
  airRain.frustumCulled = false; airRain.visible = false; airRain.userData.drops = Array.from({ length: 400 }, () => [Math.random() * 60 - 30, Math.random() * 30, Math.random() * 60 - 30]); scene.add(airRain);
  // props in a fixed order: standing trees (each with its log and stump), the giant, rocks
  for (const [x, z, s] of A.trees) standing.push(addStandingTree(x, z, s, false));
  standing.push(addStandingTree(A.giant[0], A.giant[1], 1.9, true));
  for (const [x, z, r] of A.rocks) stripRocks.push(addRock(x, z, r, "rock"));
}

// ----- level 8: Sinking Sands -----
let wormRing = null, wormMouth = null, wormRipples = null;
const pitCells = [], pitTarget = [], sandRocks = [];
if (SITE === "sands") {
  const S = SANDS, P = S.pit;
  scene.background.set(0xe8d9b5); scene.fog.color.set(0xe8d9b5);
  for (let x = P.x - P.r; x <= P.x + P.r; x += CELL) for (let z = P.z - P.r; z <= P.z + P.r; z += CELL)
    if (Math.hypot(x - P.x, z - P.z) < P.r - 0.5) { const i = idxAt(x, z); pitCells.push(i); pitTarget.push(P.level); }
  // the worm's ring, drawn on the sand; ripples run inward before it strikes; its mouth erupts when it does
  wormRing = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 72), new THREE.MeshBasicMaterial({ color: 0xd8333a, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
  wormRing.rotation.x = -Math.PI / 2; wormRing.position.set(P.x, P.level + 0.3, P.z); scene.add(wormRing);
  wormRipples = new THREE.Group(); scene.add(wormRipples);
  for (let k = 0; k < 3; k++) { const r = new THREE.Mesh(new THREE.RingGeometry(0.94, 1, 64), new THREE.MeshBasicMaterial({ color: 0xffd08a, transparent: true, opacity: 0.6, side: THREE.DoubleSide })); r.rotation.x = -Math.PI / 2; wormRipples.add(r); }
  wormRipples.visible = false;
  wormMouth = new THREE.Group(); scene.add(wormMouth); wormMouth.visible = false;
  { const flesh = lam(0xc98a6a), inner = lam(0x5a1f2a);
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 5, 9, 18, 1, true), flesh); tube.material.side = THREE.DoubleSide; tube.position.y = 4.5; wormMouth.add(tube);
    const throat = new THREE.Mesh(new THREE.CircleGeometry(4.1, 18), inner); throat.rotation.x = -Math.PI / 2; throat.position.y = 7; wormMouth.add(throat);
    for (let k = 0; k < 14; k++) { const a = (k / 14) * Math.PI * 2, tooth = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.4, 5), lam(0xf4f1ea)); tooth.position.set(Math.cos(a) * 3.8, 9.2, Math.sin(a) * 3.8); tooth.rotation.set(Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6); wormMouth.add(tooth); }
  }
  // a prospector's shack and sign, for colour
  { const b = building({ x: -14, z: -64, w: 7, d: 6, h: 3.4, door: 2.4, dh: 2.3, face: 1, wall: 0xb9935e, roof: 0x7a5a3a }); b.sign.userData.draw("Old Ginston", "Prospector (retired)", "#e8b06a"); }
  for (const [x, z, r] of S.rocks) sandRocks.push(addRock(x, z, r, "rock"));
}

// ----- night: a dark sky, a dim moon, and headlights on every vehicle (L toggles yours) -----
const IS_NIGHT = SITE === "night";
function applyNight() {
  const hemi = scene.children.find((o) => o.isHemisphereLight);
  scene.background.set(0x0b1424); scene.fog.color.set(0x0b1424); scene.fog.near = 25; scene.fog.far = 150;
  if (hemi) { hemi.intensity = 0.32; hemi.color.set(0x6f86b8); hemi.groundColor.set(0x1d2230); }
  sun.intensity = 0.35; sun.color.set(0x9fb2e0);
}
if (IS_NIGHT) applyNight();
// a flat fan on the ground, pointing along +z: used for vision cones and floodlight beams
function coneFan(len, half, color, opacity) {
  const n = 18, pos = [0, 0, 0];
  for (let k = 0; k <= n; k++) { const a = -half + (2 * half * k) / n; pos.push(Math.sin(a) * len, 0, Math.cos(a) * len); }
  const idx = []; for (let k = 1; k <= n; k++) idx.push(0, k, k + 1);
  const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false }));
  scene.add(m); return m;
}
// is (x, z) inside a cone from (ax, az) facing yaw (0 = +z), len long, half wide?
function inCone(x, z, ax, az, yaw, len, half) {
  const dx = x - ax, dz = z - az, d = Math.hypot(dx, dz);
  if (d > len || d < 0.1) return false;
  let a = Math.atan2(dx, dz) - yaw; a = Math.atan2(Math.sin(a), Math.cos(a));
  return Math.abs(a) < half;
}

// ----- level 9: Night Shift -----
const panels = [];
let guardTruck = null, guardCone = null, guardLight = null, floodCones = [], floodLights = [], generator = null, lotMarker = null, alarmTint = null;
if (SITE === "night") {
  const N = NIGHT, Y = N.yard;
  backdropTrees(130, 82, 94);
  // the road, with a few lamp posts
  { const road = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, N.road.half * 2), lam(0x3a3f46)); road.rotation.x = -Math.PI / 2; road.position.set(0, 0.33, N.road.z); road.receiveShadow = true; scene.add(road); }
  for (const x of [-60, -20, 20, 60]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.2, 5, 0.2), lam(0x565c66)); p.position.set(x, 2.8, N.road.z - N.road.half - 1); scene.add(p);
    const l = new THREE.PointLight(0xffd9a0, 18, 22, 1.5); l.position.set(x, 5.2, N.road.z - N.road.half - 1); scene.add(l);
  }
  lotMarker = marker(N.lot.x, N.lot.z, N.lot.r, 0x8be28b);
  { const s = makeSign(4.4, 1.1); s.userData.draw("Grade-A Grading", "Private. Keep out.", "#ff6a5a"); s.position.set(N.gate.x, 3.2, Y.z0 - 0.4); s.rotation.y = Math.PI; scene.add(s); }
  { const s = makeSign(3.6, 0.9); s.userData.draw("Your lot", "Drop the topsoil here"); s.position.set(N.lot.x, 2.2, N.lot.z - N.lot.r - 0.5); s.rotation.y = Math.PI; scene.add(s); }
  // the fence: 4 m panels you can dig under (quiet) or winch down (loud); the gate is a locked panel pair
  const panelMat = lam(0x8a9099), postMat = lam(0x5a6068);
  const addPanel = (x0, z0, x1, z1, gate) => {
    const len = Math.hypot(x1 - x0, z1 - z0), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, yaw = Math.atan2(x1 - x0, z1 - z0) + Math.PI / 2, y = heightAt(cx, cz);
    const mesh = new THREE.Group(); scene.add(mesh);
    const mesh2 = new THREE.Mesh(new THREE.BoxGeometry(len - 0.1, 2.4, 0.08), gate ? lam(0xb8462e) : panelMat); mesh2.position.y = 1.2; mesh2.castShadow = true; mesh.add(mesh2);
    for (const e of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.6, 0.14), postMat); p.position.set((e * len) / 2, 1.3, 0); mesh.add(p); }
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(cx, y, cz).setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)));
    world.createCollider(RAPIER.ColliderDesc.cuboid(len / 2, 1.2, 0.1).setTranslation(0, 1.2, 0), body);
    panels.push(addProp({ type: "panel", name: gate ? "locked gate" : "fence panel", body, mesh, r: len / 2, x: cx, z: cz, damp: 0, anchorsLocal: [new THREE.Vector3(0, 1.2, 0)], yaw, pullT: 0 }));
  };
  for (let x = Y.x0; x < Y.x1; x += 4) {
    addPanel(x, Y.z1, x + 4, Y.z1);
    const mid = x + 2;
    addPanel(x, Y.z0, x + 4, Y.z0, Math.abs(mid - N.gate.x) < N.gate.w / 2);
  }
  for (let z = Y.z0; z < Y.z1; z += 4) { addPanel(Y.x0, z, Y.x0, Math.min(z + 4, Y.z1)); addPanel(Y.x1, z, Y.x1, Math.min(z + 4, Y.z1)); }
  // a couple of dim lamps in the yard so you can see the pile
  for (const [x, z] of [[-14, 30], [14, 30]]) { const l = new THREE.PointLight(0xffe2b0, 10, 20, 1.5); l.position.set(x, 4, z); scene.add(l); }
  // the guard truck (it drives its loop; that is all it does)
  guardTruck = new THREE.Group(); scene.add(guardTruck);
  { const white = lam(0xe8e8e8), dk = lam(0x22262c);
    const part = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; guardTruck.add(m); return m; };
    part(new THREE.BoxGeometry(2, 0.8, 4.6), white, 0, 0.8, 0); part(new THREE.BoxGeometry(1.9, 0.8, 1.8), lam(0x9fd0e8), 0, 1.55, 0.4);
    for (const sx of [-0.95, 0.95]) for (const sz of [-1.5, 1.5]) part(new THREE.CylinderGeometry(0.4, 0.4, 0.3, 10).rotateZ(Math.PI / 2), dk, sx, 0.4, sz);
    guardTruck.userData.bar = part(new THREE.BoxGeometry(1.4, 0.2, 0.3), new THREE.MeshBasicMaterial({ color: 0xffa23a }), 0, 2.05, 0.4);
  }
  guardCone = coneFan(N.guard.len, N.guard.half, 0xffe066, 0.22);
  guardLight = new THREE.SpotLight(0xfff2cc, 60, N.guard.len + 6, N.guard.half, 0.4, 1.4); scene.add(guardLight, guardLight.target);
  // the floodlight towers
  for (const F of N.lights) {
    const y = heightAt(F.x, F.z), mast = new THREE.Mesh(new THREE.BoxGeometry(0.4, 9, 0.4), lam(0x565c66)); mast.position.set(F.x, y + 4.5, F.z); scene.add(mast);
    const head = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.8, 0.6), new THREE.MeshBasicMaterial({ color: 0xffffee })); head.position.set(F.x, y + 9, F.z); scene.add(head);
    floodCones.push(coneFan(F.len, F.half, 0xffffff, 0.16));
    const sl = new THREE.SpotLight(0xffffff, 140, F.len + 10, F.half, 0.3, 1.2); sl.position.set(F.x, y + 9, F.z); scene.add(sl, sl.target); floodLights.push({ sl, head });
  }
  generator = addCrate(N.generator.x, N.generator.z, 2.0, 1.5, 1.4, 0xd8333a, "floodlight generator", 160);
  alarmTint = document.createElement("div"); alarmTint.id = "alarmtint"; document.body.appendChild(alarmTint);
}

// ----- level 10: Firebreak -----
const FG = 96, FCELL = 2;                                     // the fire grid: 96 x 96 cells of 2 m
const fireS = SITE === "fire" ? new Uint8Array(FG * FG) : null;     // 0 grass, 1 burning, 2 burnt
const fireT = SITE === "fire" ? new Float32Array(FG * FG) : null;   // seconds left burning
const scraped = SITE === "fire" ? new Uint8Array(FG * FG) : null;   // flattened bare by the roller
const fireNet = [], scrapeNet = [];
const fcOf = (x, z) => clamp(Math.floor((z + HALF) / FCELL), 0, FG - 1) + clamp(Math.floor((x + HALF) / FCELL), 0, FG - 1) * FG;
const fcX = (c) => Math.floor(c / FG) * FCELL - HALF + 1, fcZ = (c) => (c % FG) * FCELL - HALF + 1;
let flames = null, burntMesh = null, cows = [], fireTrees = [];
if (SITE === "fire") {
  const F = FIRE;
  // dusk
  { const hemi = scene.children.find((o) => o.isHemisphereLight); scene.background.set(0xe7a067); scene.fog.color.set(0xd9946a); scene.fog.near = 70; scene.fog.far = 220;
    if (hemi) { hemi.intensity = 0.85; hemi.color.set(0xffd2a8); } sun.intensity = 1.3; sun.color.set(0xffa86a); }
  backdropTrees(130, 82, 94);
  // the farm: house, barn, fences round the field, cows
  { const b = building({ x: -26, z: -44, w: 10, d: 8, h: 6, door: 4, dh: 3.5, face: 1, wall: 0xa8392c, roof: 0x5b5f66 }); b.sign.userData.draw("Linston Ranch", "Keep the fire off it", "#ff9c6a");
    const hs = building({ x: 26, z: -46, w: 8, d: 7, h: 4, door: 2.2, dh: 2.3, face: 1, wall: 0xe9dcc3, roof: 0x8f3b2e }); hs.sign.visible = false; }
  const Fm = F.farm;
  fenceLine(Fm.x0, Fm.z0, Fm.x1, Fm.z0); fenceLine(Fm.x0, Fm.z0, Fm.x0, Fm.z1); fenceLine(Fm.x1, Fm.z0, Fm.x1, Fm.z1);
  fenceLine(Fm.x0, Fm.z1, -4, Fm.z1); fenceLine(4, Fm.z1, Fm.x1, Fm.z1);
  for (const [x, z] of F.cows) {
    const c = new THREE.Group(); c.position.set(x, heightAt(x, z), z); c.rotation.y = rng() * 6; scene.add(c);
    const white = lam(0xf4f1ea), blk = lam(0x22262c);
    const part = (geo, mat, px, py, pz) => { const m = new THREE.Mesh(geo, mat); m.position.set(px, py, pz); m.castShadow = true; c.add(m); };
    part(new THREE.BoxGeometry(1.0, 0.8, 1.9), white, 0, 1.0, 0); part(new THREE.BoxGeometry(0.5, 0.45, 0.4), blk, 0.2, 1.1, 0.3);
    part(new THREE.BoxGeometry(0.55, 0.55, 0.6), white, 0, 1.3, 1.1); for (const sx of [-0.35, 0.35]) for (const sz of [-0.7, 0.7]) part(new THREE.BoxGeometry(0.2, 0.7, 0.2), blk, sx, 0.35, sz);
    c.userData.y0 = c.position.y; cows.push(c);
  }
  // the suggested line: little flags across the valley
  for (let x = -76; x <= 76; x += 8) { const f = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.9, 4), lam(0xffc928)); f.position.set(x, heightAt(x, F.line.z) + 0.45, F.line.z); scene.add(f); }
  // fire visuals: flames on burning cells, scorched squares on burnt ones
  flames = new THREE.InstancedMesh(new THREE.ConeGeometry(0.9, 2.2, 6), new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.9 }), 2400);
  flames.count = 0; flames.frustumCulled = false; scene.add(flames);
  burntMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(FCELL, FCELL).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x2a2420, transparent: true, opacity: 0.85, depthWrite: false }), FG * FG);
  burntMesh.count = 0; burntMesh.frustumCulled = false; scene.add(burntMesh);
  // trees in the valley: they burn hot and throw embers. Fell them and drag them clear.
  for (const [x, z] of F.trees) fireTrees.push(addStandingTree(x, z, 1.2, false));
}

function setActiveBoulders(n) {
  n = clamp(n, 5, boulders.length);
  for (let i = 0; i < boulders.length; i++) {
    const b = boulders[i], on = i < n;
    if (b.active !== on) { b.active = on; b.body.setEnabled(on); b.mesh.visible = on; }
  }
  activeBoulders = n;
}
if (SITE === "farm") setActiveBoulders(5);

// ---------- wheel loaders ----------
const L = {
  mass: 3000, engine: 5200, maxSpeed: 9.5, reverseSpeed: 6, brake: 130, park: 70000, idleBrake: 80, steer: 0.55, slip: 3.2,
  wheelR: 0.8, rest: 0.45, wx: 1.3, wz: 1.55, wy: -0.25,
  pivot: new THREE.Vector3(0, 0.55, 1.7), armLen: 2.7, armMin: -0.93, armMax: 0.72, tiltMin: -0.95, tiltMax: 0.8,
  assist: true, capacity: 6, loadDrag: 1500, pushDrag: 450, firmDrag: 5000, looseRate: 2.5, firmRate: 0.45, pour: 2.4,
};
// what each vehicle can do; every vehicle has the winch
const KINDS = {
  loader: { name: "wheel loader", engine: 5200, maxSpeed: 9.5, reverseSpeed: 6, steer: 0.55 },
  roller: { name: "road roller", engine: 6200, maxSpeed: 5.5, reverseSpeed: 4.5, steer: 0.5 },
  truck: { name: "dump truck", engine: 7400, maxSpeed: 12, reverseSpeed: 6, steer: 0.5, cap: 18 },
};
const WINCH = { max: 35, tmax: 60000, reelIn: 2.5, payOut: 3.5, min: 2.5 };
const HOOK = new THREE.Vector3(0, 0.15, -2.85);       // the winch fairlead on the counterweight
const COLORS = [0xf2b21c, 0xe2572b, 0x3b8fe0, 0x52b45a];
const dark = lam(0x2b2f36), steel = lam(0x565c66), glass = lam(0x9fd0e8), dirtMat = lam(0x8a6238, true);
function box(mat, sx, sy, sz, x, y, z, parent) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m);
  return m;
}
const site0 = { hub: HUB.spawn, farm: FARM.spawn, river: RIVER.spawn, ridge: RIDGE.spawn, haul: HAUL.spawn, flood: FLOOD.spawn, treasure: TREASURE.spawn, airstrip: AIR.spawn, sands: SANDS.spawn, night: NIGHT.spawn, fire: FIRE.spawn }[SITE];
const spawnAt = (slot) => {
  const off = -7.5 + slot * 5, c = Math.cos(site0.yaw), s = Math.sin(site0.yaw);
  return { x: site0.x + off * c, z: site0.z - off * s, yaw: site0.yaw };
};

// ---------- paint jobs ----------
const PAINTS = [0xf2b21c, 0xe2572b, 0xd8333a, 0xff7ab8, 0x8a4fd1, 0x3b8fe0, 0x2fc4c4, 0x52b45a, 0xa6e22e, 0xf2f2ee, 0x9aa3ad, 0x22262c];
const PAINT_NAMES = ["Yellow", "Orange", "Red", "Pink", "Purple", "Blue", "Teal", "Green", "Lime", "White", "Silver", "Black"];
const STRIPES = ["None", "Centre stripe", "Twin stripes"];
const FLAMES = ["None", "Sides", "Hood", "Sides and hood"];
const FLAME_SETS = [
  { name: "Classic", c: ["#fff3a0", "#ffb21f", "#e8461a"] }, { name: "Blue", c: ["#e6f7ff", "#59c1ff", "#1d52d9"] },
  { name: "Green", c: ["#f0ffc4", "#8ee34f", "#1f8a2e"] }, { name: "White", c: ["#ffffff", "#dfe3e8", "#9aa3ad"] },
  { name: "Purple", c: ["#ffe1ff", "#d27bff", "#6a2bd1"] },
];
const DEFAULT_LOOK = { p: -1, s: 0, sc: 9, f: 0, fc: 0 };       // p -1: the crew colour of your room slot
const flameTex = [];
// Flame decal: tongues of fire that start at the left edge (the front) and lick back to the right.
function getFlameTex(i) {
  if (flameTex[i]) return flameTex[i];
  const W2 = 512, H2 = 192, cv = document.createElement("canvas"); cv.width = W2; cv.height = H2;
  const g = cv.getContext("2d"), lens = [0.72, 0.98, 0.82, 1.0, 0.76], n = lens.length;
  const layer = (color, k, grow) => {
    g.fillStyle = color;
    g.fillRect(0, H2 * 0.08, W2 * 0.12 * k, H2 * 0.84);               // a solid band where the tongues start
    for (let t = 0; t < n; t++) {
      const yc = H2 * (0.16 + (0.68 * t) / (n - 1)), len = W2 * lens[t] * k, h = H2 * 0.34 * grow;
      g.beginPath();
      g.moveTo(0, yc - h * 0.6);
      g.bezierCurveTo(len * 0.4, yc - h * 0.8, len * 0.72, yc - h * 0.05, len, yc - h * 0.4);
      g.bezierCurveTo(len * 0.8, yc + h * 0.12, len * 0.5, yc + h * 0.6, 0, yc + h * 0.62);
      g.closePath(); g.fill();
    }
  };
  const c = FLAME_SETS[i].c;
  g.strokeStyle = "rgba(20,20,24,0.55)"; g.lineWidth = 10; g.lineJoin = "round";      // a dark outline so flames read on any paint
  layer("rgba(20,20,24,0.55)", 1.03, 1.08);
  layer(c[2], 1, 1); layer(c[1], 0.76, 0.78); layer(c[0], 0.48, 0.55);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return (flameTex[i] = tex);
}
const cleanLook = (a) => {
  const L2 = Array.isArray(a) ? a : [];
  const n = (v, lo, hi, d) => (Number.isInteger(v) && v >= lo && v <= hi ? v : d);
  return { p: n(L2[0], -1, PAINTS.length - 1, -1), s: n(L2[1], 0, 2, 0), sc: n(L2[2], 0, PAINTS.length - 1, 9), f: n(L2[3], 0, 3, 0), fc: n(L2[4], 0, FLAME_SETS.length - 1, 0) };
};
const lookArr = (k) => [k.p, k.s, k.sc, k.f, k.fc];
// show the look on a vehicle: paint, stripes and flames, for whichever kind it is right now
function applyLook(ld, look) {
  ld.look = { ...look };
  ld.paint.color.set(look.p >= 0 ? PAINTS[look.p] : COLORS[ld.slot]);
  ld.decor.stripeMat.color.set(PAINTS[look.sc]);
  ld.decor.flameMat.map = getFlameTex(look.fc); ld.decor.flameMat.needsUpdate = true;
  showDecor(ld);
}
function showDecor(ld) {
  const k = ld.look || DEFAULT_LOOK, d = ld.decor;
  for (const m of d.single) m.visible = m.userData.kind === ld.kind && k.s === 1;
  for (const m of d.twin) m.visible = m.userData.kind === ld.kind && k.s === 2;
  for (const m of d.sides) m.visible = m.userData.kind === ld.kind && (k.f & 1) > 0;
  for (const m of d.hood) m.visible = m.userData.kind === ld.kind && (k.f & 2) > 0;
}
// where the decals go on each kind of vehicle
const DECOR = {
  loader: { side: { x: 1.012, y: 0.56, z: -1.3, len: 2.26, h: 0.78 }, hood: { y: 0.957, z: -1.62, len: 1.6, w: 1.8 },
    stripes: [[0.962, -1.625, 1.65], [1.948, -0.15, 1.45], [0.407, 0.9, 2.0]] },
  roller: { side: { x: 0.962, y: 0.5, z: -0.75, len: 2.55, h: 0.7 }, hood: { y: 0.857, z: -1.62, len: 0.8, w: 1.7 },
    stripes: [[0.862, -1.625, 0.85], [2.128, -0.55, 1.5], [0.862, 0.33, 0.45]] },
  truck: { side: { x: 1.112, y: 0.62, z: 2.05, len: 1.45, h: 0.95 }, hood: { y: 1.567, z: 2.05, len: 1.5, w: 2.0 },
    stripes: [[1.567, 2.05, 1.55]] },
};
function buildDecor(group) {
  const d = { stripeMat: lam(0xf2f2ee), single: [], twin: [], sides: [], hood: [],
    flameMat: new THREE.MeshLambertMaterial({ map: getFlameTex(0), transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }) };
  const add = (kind, mesh, list) => { mesh.visible = false; mesh.userData.kind = kind; group.add(mesh); list.push(mesh); };
  for (const kind of ["loader", "roller", "truck"]) {
    const D = DECOR[kind];
    for (const [y, z, len] of D.stripes) {
      const one = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.012, len), d.stripeMat); one.position.set(0, y, z); add(kind, one, d.single);
      for (const sx of [-0.32, 0.32]) { const two = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.012, len), d.stripeMat); two.position.set(sx, y, z); add(kind, two, d.twin); }
    }
    for (const e of [1, -1]) {
      const geo = new THREE.PlaneGeometry(D.side.len, D.side.h);
      if (e < 0) geo.scale(-1, 1, 1);
      geo.rotateY((e * Math.PI) / 2);
      const m = new THREE.Mesh(geo, d.flameMat); m.position.set(e * D.side.x, D.side.y, D.side.z); add(kind, m, d.sides);
    }
    const hg = new THREE.PlaneGeometry(D.hood.len, D.hood.w).rotateX(-Math.PI / 2).rotateY(Math.PI / 2);
    const hm = new THREE.Mesh(hg, d.flameMat); hm.position.set(0, D.hood.y, D.hood.z); add(kind, hm, d.hood);
  }
  return d;
}

function makeLoader(slot, local) {
  const paint = lam(COLORS[slot]);
  const group = new THREE.Group(); scene.add(group);
  box(paint, 2.0, 1.1, 2.3, 0, 0.4, -1.3, group);        // engine housing
  box(dark, 2.1, 0.5, 0.5, 0, 0.05, -2.5, group);        // counterweight
  box(steel, 0.5, 0.45, 0.3, 0, 0.15, -2.75, group);     // winch drum
  box(paint, 1.5, 0.7, 2.0, 0, 0.05, 0.9, group);        // front frame
  box(dark, 1.9, 0.3, 4.4, 0, -0.35, -0.2, group);       // underbody
  box(glass, 1.4, 1.1, 1.3, 0, 1.25, -0.15, group);      // cab
  box(paint, 1.55, 0.14, 1.45, 0, 1.87, -0.15, group);   // roof
  box(dark, 0.16, 0.9, 0.16, 0.6, 1.3, -1.9, group);     // exhaust
  box(steel, 2.2, 0.5, 0.4, 0, 0.55, 1.75, group);       // arm tower
  const armPivot = new THREE.Group(); armPivot.position.copy(L.pivot); group.add(armPivot);
  box(paint, 0.22, 0.3, L.armLen, 0.95, 0, L.armLen / 2, armPivot);
  box(paint, 0.22, 0.3, L.armLen, -0.95, 0, L.armLen / 2, armPivot);
  box(steel, 1.9, 0.16, 0.16, 0, 0, L.armLen * 0.55, armPivot);
  const bucketPivot = new THREE.Group(); bucketPivot.position.set(0, 0, L.armLen); armPivot.add(bucketPivot);
  const bucketParts = [
    box(steel, 2.9, 0.1, 1.35, 0, 0, 0.62, bucketPivot),      // floor
    box(steel, 2.9, 1.15, 0.12, 0, 0.55, 0, bucketPivot),     // back
    box(steel, 0.1, 0.95, 1.3, 1.45, 0.45, 0.62, bucketPivot),
    box(steel, 0.1, 0.95, 1.3, -1.45, 0.45, 0.62, bucketPivot),
  ];
  box(dark, 2.9, 0.06, 0.12, 0, 0.0, 1.3, bucketPivot);       // cutting edge (visual only)
  const heap = new THREE.Mesh(new THREE.SphereGeometry(1, 9, 5), lam(0x8a6238, true));
  heap.position.set(0, 0.08, 0.62); heap.visible = false; heap.castShadow = true; bucketPivot.add(heap);

  const s = spawnAt(slot);
  const desc = (local ? RAPIER.RigidBodyDesc.dynamic().setCanSleep(false).setLinearDamping(0.05).setAngularDamping(0.6) : RAPIER.RigidBodyDesc.kinematicPositionBased())
    .setTranslation(s.x, local ? heightAt(s.x, s.z) + 1.9 : -300, s.z)    // other players wait out of sight until their first report
    .setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw));
  const body = world.createRigidBody(desc);
  group.visible = local;
  world.createCollider(RAPIER.ColliderDesc.cuboid(1.0, 0.55, 2.4).setTranslation(0, 0.2, -0.3).setMass(L.mass * 0.3).setFriction(0.4), body);
  world.createCollider(RAPIER.ColliderDesc.cuboid(0.8, 0.15, 1.9).setTranslation(0, -0.5, -0.2).setMass(L.mass * 0.7).setFriction(0.4), body);   // low ballast keeps it upright
  world.createCollider(RAPIER.ColliderDesc.cuboid(0.7, 0.6, 0.65).setTranslation(0, 1.3, -0.15).setMass(1).setFriction(0.4), body);          // cab
  const bucketColliders = bucketParts.map((m) => {
    const p = m.geometry.parameters;   // the bucket passes through the ground, so the lip can sit on it and cut into it
    return world.createCollider(RAPIER.ColliderDesc.cuboid(p.width / 2, p.height / 2, p.depth / 2).setMass(1).setFriction(0.3).setCollisionGroups(0x0002fffe), body);
  });
  const wheels = [];
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const steerNode = new THREE.Group(); steerNode.position.set(sx * L.wx, L.wy - L.rest + 0.08, sz * L.wz); group.add(steerNode);
    const spin = new THREE.Group(); steerNode.add(spin);
    const tyre = new THREE.Mesh(new THREE.CylinderGeometry(L.wheelR, L.wheelR, 0.62, 14).rotateZ(Math.PI / 2), dark); tyre.castShadow = true;
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.66, 8).rotateZ(Math.PI / 2), paint);
    spin.add(tyre, hub, new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.16, 0.5), paint));
    wheels.push({ steerNode, spin, front: sz > 0, sx, sz });
  }
  // the same machine can also be a road roller: its own bodywork and two drums, hidden until chosen
  const loaderVis = [...group.children], rollerVis = [];
  const rb = (mat, sx, sy, sz, x, y, z) => { const m = box(mat, sx, sy, sz, x, y, z, group); m.visible = false; rollerVis.push(m); return m; };
  rb(paint, 1.9, 1.0, 2.6, 0, 0.35, -0.75); rb(dark, 2.0, 0.45, 0.5, 0, 0.05, -2.5); rb(steel, 0.5, 0.45, 0.3, 0, 0.15, -2.75);
  rb(glass, 1.5, 1.15, 1.3, 0, 1.4, -0.55); rb(paint, 1.65, 0.14, 1.5, 0, 2.05, -0.55); rb(dark, 0.16, 0.8, 0.16, 0.65, 1.2, -1.8);
  rb(paint, 0.24, 0.5, 2.3, 1.48, -0.1, 1.45); rb(paint, 0.24, 0.5, 2.3, -1.48, -0.1, 1.45); rb(paint, 3.2, 0.34, 0.34, 0, 0.12, 0.5);
  const drums = [[2.7, 1.7], [2.3, -1.5]].map(([w, z]) => {
    const d = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, w, 20).rotateZ(Math.PI / 2), steel);
    d.position.set(0, -0.56, z); d.castShadow = true; d.visible = false; group.add(d); rollerVis.push(d);
    const mark = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, 0.12, 0.4), dark); mark.position.y = 0.81; d.add(mark);
    return d;
  });
  // ... or a dump truck: cab at the front, a tipping bed behind
  const truckVis = wheels.map((w) => w.steerNode);
  const tb = (mat, sx, sy, sz, x, y, z) => { const m = box(mat, sx, sy, sz, x, y, z, group); m.visible = false; truckVis.push(m); return m; };
  tb(dark, 1.7, 0.35, 5.6, 0, -0.2, -0.4); tb(paint, 2.2, 1.5, 1.5, 0, 0.7, 2.05); tb(glass, 2.0, 0.75, 0.1, 0, 1.0, 2.81);
  tb(paint, 2.25, 0.12, 1.55, 0, 1.5, 2.05); tb(dark, 2.3, 0.3, 0.25, 0, -0.1, 2.9); tb(dark, 0.14, 1.1, 0.14, 1.0, 1.55, 1.25);
  const bedPivot = new THREE.Group(); bedPivot.position.set(0, 0.2, -3.05); bedPivot.visible = false; group.add(bedPivot); truckVis.push(bedPivot);
  box(steel, 2.5, 0.12, 4.4, 0, 0, 2.2, bedPivot); box(paint, 0.1, 1.1, 4.4, 1.25, 0.55, 2.2, bedPivot); box(paint, 0.1, 1.1, 4.4, -1.25, 0.55, 2.2, bedPivot);
  box(paint, 2.5, 1.35, 0.12, 0, 0.67, 4.4, bedPivot);
  const bedHeap = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 6), lam(0x8a6238, true)); bedHeap.position.set(0, 0.12, 2.2); bedHeap.visible = false; bedHeap.castShadow = true; bedPivot.add(bedHeap);
  const decor = buildDecor(group);
  let headlight = null;
  if (SITE === "night") {
    headlight = new THREE.SpotLight(0xfff2cc, 45, 40, 0.55, 0.45, 1.3); headlight.position.set(0, 1.4, 2.6);
    const tgt = new THREE.Object3D(); tgt.position.set(0, -0.5, 14); group.add(headlight, tgt); headlight.target = tgt;
    for (const sx of [-0.6, 0.6]) box(new THREE.MeshBasicMaterial({ color: 0xfff6d6 }), 0.3, 0.2, 0.05, sx, 0.75, 1.95, group);
  }
  const ld = { headlight, hl: true, slot, paint, bedPivot, bedHeap, bed: 0, group, armPivot, bucketPivot, bucketParts, bucketColliders, heap, body, wheels, arm: -0.5, tilt: 0.1, steer: 0, speed: 0, load: 0, loadG: 0, roll: 0,
    kind: "loader", vis: { loader: loaderVis, roller: rollerVis, truck: truckVis }, drums, decor, look: { ...DEFAULT_LOOK } };
  return ld;
}
function setKind(ld, kind) {
  if (!KINDS[kind] || ld.kind === kind) return;
  ld.kind = kind;
  for (const k in ld.vis) for (const m of ld.vis[k]) m.visible = false;      // wheels belong to two kinds, so hide all first
  for (const m of ld.vis[kind]) m.visible = true;
  for (const c of ld.bucketColliders) c.setEnabled(kind === "loader");
  showDecor(ld);
}
function disposeLoader(ld) { world.removeRigidBody(ld.body); scene.remove(ld.group); }

const me = makeLoader(0, true);
let myLook = { ...DEFAULT_LOOK };
try { myLook = cleanLook(JSON.parse(localStorage.getItem("jobsite-look") || "null")); } catch {}
applyLook(me, myLook);
const chassis = me.body;
// Places to change vehicle: the garage in the quarry, and a vehicle yard near the start of each job.
const YARD = { farm: { x: 17, z: -70, r: 5.5 }, river: { x: 17, z: -68, r: 5.5 }, ridge: { x: -19, z: -78, r: 5.5 }, haul: HAUL.yards[0], flood: FLOOD.yards[0], treasure: TREASURE.yards[0], airstrip: AIR.yards[0], sands: SANDS.yards[0], night: NIGHT.yards[0], fire: FIRE.yards[0] }[SITE] || null;
const YARDS = { haul: HAUL.yards, flood: FLOOD.yards, airstrip: AIR.yards }[SITE] || (YARD ? [YARD] : []);
function parkDisplay(kind, slot, x, z, yaw) {
  const d = makeLoader(slot, false);
  setKind(d, kind);
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  d.body.setTranslation({ x, y: heightAt(x, z) + 1.42, z }, true); d.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
  d.group.visible = true; d.group.position.set(x, heightAt(x, z) + 1.42, z); d.group.quaternion.copy(q);
  d.arm = -0.6; d.tilt = 0.3;
  return d;
}
const displays = [];
if (SITE === "hub") {
  const gh = HUB.houses.find((h) => h.garage);
  displays.push(parkDisplay("roller", 2, gh.x - 10.5, gh.z - 2.5, 0), parkDisplay("loader", 3, gh.x - 3.5, gh.z - 2.5, 0));
} else {
  if (SITE === "farm") { barnRoller = parkDisplay("roller", 2, FARM.roller.x, FARM.roller.z, Math.PI); barnRoller.group.visible = false; displays.push(barnRoller); }
  YARDS.forEach((y, n) => {
    marker(y.x, y.z, y.r, 0xb48cff);
    const big = ["haul", "flood", "treasure", "airstrip", "sands", "night", "fire"].includes(SITE);
    displays.push(parkDisplay(big ? "truck" : "roller", 2, y.x + 8.5, y.z + 1, -0.5));
    if (big && n === 0) displays.push(parkDisplay("roller", 3, y.x - 8.5, y.z + 1, 0.5));
  });
}
const vehicle = world.createVehicleController(chassis);
vehicle.indexUpAxis = 1;
vehicle.setIndexForwardAxis = 2;
me.wheels.forEach((w, i) => {
  vehicle.addWheel({ x: w.sx * L.wx, y: L.wy, z: w.sz * L.wz }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, L.rest, L.wheelR);
  vehicle.setWheelSuspensionStiffness(i, 26);
  vehicle.setWheelSuspensionCompression(i, 3.2);
  vehicle.setWheelSuspensionRelaxation(i, 4.2);
  vehicle.setWheelMaxSuspensionTravel(i, 0.4);
  vehicle.setWheelMaxSuspensionForce(i, L.mass * 40);
  vehicle.setWheelFrictionSlip(i, L.slip);
  vehicle.setWheelSideFrictionStiffness(i, 1.0);
});
const notChassis = (c) => { const p = c.parent(); return !p || p.handle !== chassis.handle; };

const input = { fwd: 0, turn: 0, brake: 0, arm: 0, tilt: 0, reel: 0 };
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
const ZV = new THREE.Vector3();
const _bpq = new THREE.Quaternion(), _bpt = new THREE.Vector3();
function bodyPoint(body, local, out) {
  const t = body.translation(), r = body.rotation();
  return out.copy(local).applyQuaternion(_bpq.set(r.x, r.y, r.z, r.w)).add(_bpt.set(t.x, t.y, t.z));
}
function heading() { const r = chassis.rotation(); return Math.atan2(2 * (r.x * r.z + r.w * r.y), 1 - 2 * (r.x * r.x + r.y * r.y)); }

function poseBucket(ld) {
  ld.armPivot.rotation.x = -ld.arm;
  ld.bucketPivot.rotation.x = ld.arm - ld.tilt;       // stays level as the arms rise, like a real loader linkage
  ld.armPivot.updateMatrix(); ld.bucketPivot.updateMatrix();
  for (let i = 0; i < ld.bucketParts.length; i++) {
    ld.bucketParts[i].updateMatrix();
    _m.multiplyMatrices(ld.armPivot.matrix, ld.bucketPivot.matrix).multiply(ld.bucketParts[i].matrix).decompose(_p, _q, _s);
    ld.bucketColliders[i].setTranslationWrtParent({ x: _p.x, y: _p.y, z: _p.z });
    ld.bucketColliders[i].setRotationWrtParent({ x: _q.x, y: _q.y, z: _q.z, w: _q.w });
  }
  if (ld.bedPivot) {
    ld.bedPivot.rotation.x = -(ld.bed || 0);
    const fb = (ld.load || 0) / KINDS.truck.cap;
    ld.bedHeap.visible = ld.kind === "truck" && fb > 0.03;
    if (ld.bedHeap.visible) { ld.bedHeap.scale.set(1.15, 0.15 + 0.8 * fb, 1.95); ld.bedHeap.material.color.copy(ld.loadG > ld.load * 0.5 ? cGravel : cLoose); }
  }
  const f = ld.load / L.capacity;
  ld.heap.visible = f > 0.03;
  if (ld.heap.visible) { ld.heap.scale.set(1.35, 0.2 + 0.95 * f, 0.45 + 0.25 * f); ld.heap.material.color.copy(ld.loadG > ld.load * 0.5 ? cGravel : cLoose); }
}

// world matrix of my bucket (origin at the back of the floor, z out to the lip, y up through the floor)
const _bw = new THREE.Matrix4(), _bi = new THREE.Matrix4(), _cq = new THREE.Quaternion(), _cp = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1),
  _up = new THREE.Vector3(), _back = new THREE.Vector3(), _rp = new THREE.Vector3();
function bucketFrame() {
  const t = chassis.translation(), r = chassis.rotation();
  _bw.compose(_cp.set(t.x, t.y, t.z), _cq.set(r.x, r.y, r.z, r.w), _one).multiply(me.armPivot.matrix).multiply(me.bucketPivot.matrix);
  _bi.copy(_bw).invert();
  _up.setFromMatrixColumn(_bw, 1); _back.setFromMatrixColumn(_bw, 2).negate();
}

// Scoop assist: a rock sitting just ahead of the bucket lip while the loader drives into it is
// nudged up and back so it slides in, instead of being bulldozed along the ground forever.
function scoopAssist(speed) {
  if (!L.assist || speed < 0.4 || me.tilt < -0.2 || me.tilt > 0.5) return;
  for (const k of props) {
    if (!k.active || k.type !== "rock" || k.r > 1.0) continue;
    const p = k.body.translation();
    _rp.set(p.x, p.y, p.z).applyMatrix4(_bi);
    if (Math.abs(_rp.x) > 1.4 || _rp.z < 0.75 || _rp.z > 1.5 + k.r || _rp.y < -0.3 || _rp.y > k.r + 0.45) continue;
    const m = k.body.mass() * DT;
    k.body.applyImpulse({ x: (_up.x * 10 + _back.x * 6) * m, y: (_up.y * 10 + _back.y * 6) * m, z: (_up.z * 10 + _back.z * 6) * m }, true);
  }
}

// ---------- falling dirt ----------
// Dumped dirt leaves the bucket as clods that fall and only become ground where they land.
const PMAX = 900, PVOL = 0.012;
const parts = { n: 0, x: new Float32Array(PMAX * 3), v: new Float32Array(PMAX * 3), vol: new Float32Array(PMAX), g: new Float32Array(PMAX), s: new Float32Array(PMAX) };
const partMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.17, 0), lam(0xffffff, true), PMAX);
partMesh.count = 0; partMesh.frustumCulled = false; partMesh.castShadow = true; scene.add(partMesh);
function splat(x, z, vol, gvol = 0) {
  const fx = (x + HALF) / CELL, fz = (z + HALF) / CELL, xi = Math.floor(fx), zi = Math.floor(fz), tx = fx - xi, tz = fz - zi, v = vol / (CELL * CELL), gv = gvol / (CELL * CELL);
  const put = (ax, az, w) => addHeight(ax, az, v * w, true, gv * w);
  put(xi, zi, (1 - tx) * (1 - tz)); put(xi + 1, zi, tx * (1 - tz)); put(xi, zi + 1, (1 - tx) * tz); put(xi + 1, zi + 1, tx * tz);
  touch(xi, zi);
}
// gvol is the part of the clod that is gravel (with vol 0 it only picks the colour)
function spawnDirt(px, py, pz, vx, vy, vz, vol, gvol = 0) {
  if (parts.n >= PMAX) { if (vol) splat(px, pz, vol, gvol); return; }
  const i = parts.n++, o = i * 3;
  parts.x[o] = px; parts.x[o + 1] = py; parts.x[o + 2] = pz; parts.v[o] = vx; parts.v[o + 1] = vy; parts.v[o + 2] = vz;
  parts.vol[i] = vol; parts.g[i] = gvol; parts.s[i] = 0.7 + Math.random() * 0.9;
}
// vol 0 makes clods that are only for show (another player's dirt: their own game moves the ground)
const _pv = new THREE.Vector3(), _pd = new THREE.Vector3();
function pourFrom(matrix, vel, vol, gvol = 0) {
  _pv.set((Math.random() - 0.5) * 2.6, 0.12, 0.85 + Math.random() * 0.45).applyMatrix4(matrix);
  _pd.setFromMatrixColumn(matrix, 2).multiplyScalar(1 + Math.random() * 0.8);
  spawnDirt(_pv.x, _pv.y, _pv.z, vel.x + _pd.x + (Math.random() - 0.5) * 0.5, vel.y + _pd.y, vel.z + _pd.z + (Math.random() - 0.5) * 0.5, vol, gvol);
}
function updateDirt() {
  prepCatch();
  for (let i = parts.n - 1; i >= 0; i--) {
    const o = i * 3, x = parts.x, v = parts.v;
    v[o + 1] -= 9.81 * DT;
    x[o] += v[o] * DT; x[o + 1] += v[o + 1] * DT; x[o + 2] += v[o + 2] * DT;
    let caught = false;
    if (v[o + 1] < 0) {
      for (const c of catchers) {
        _rp.set(x[o], x[o + 1], x[o + 2]).applyMatrix4(c.inv);
        if (Math.abs(_rp.x) < 1.2 && _rp.z > -3.0 && _rp.z < 1.3 && _rp.y > -0.3 && _rp.y < 2.4) {
          caught = true;
          if (parts.vol[i] > 0) {
            if (c.who === 0) addLoad(parts.vol[i], parts.g[i]);
            else { const pl = pendingLoad.get(c.who) || [0, 0]; pl[0] += parts.vol[i]; pl[1] += parts.g[i]; pendingLoad.set(c.who, pl); }
          }
          break;
        }
      }
      if (!caught && hopper && Math.abs(x[o] - hopper.x) < 2.15 && Math.abs(x[o + 2] - hopper.z) < 2.15 && x[o + 1] < hopper.y0 + 1.5) {
        caught = true;
        if (parts.vol[i] > 0) { hopper.vol += parts.vol[i]; hopper.g += parts.g[i]; hopperD[0] += parts.vol[i]; hopperD[1] += parts.g[i]; }
      }
    }
    if (!caught) {
      if (x[o + 1] > heightAt(x[o], x[o + 2]) + 0.05) continue;
      if (parts.vol[i] > 0) splat(x[o], x[o + 2], parts.vol[i], parts.g[i]);
    }
    const l = --parts.n, lo = l * 3;                               // remove by moving the last clod into this slot
    x[o] = x[lo]; x[o + 1] = x[lo + 1]; x[o + 2] = x[lo + 2]; v[o] = v[lo]; v[o + 1] = v[lo + 1]; v[o + 2] = v[lo + 2];
    parts.vol[i] = parts.vol[l]; parts.g[i] = parts.g[l]; parts.s[i] = parts.s[l];
  }
}
let pourAcc = 0;

// Put a volume of dirt on the ground under a point of the bucket (lz metres out from its back), spread across its width.
function deposit(vol, lz, gvol = 0) {
  for (const lx of [-1.1, -0.37, 0.37, 1.1]) {
    _rp.set(lx, 0, lz).applyMatrix4(_bw);
    splat(_rp.x, _rp.z, vol / 4, gvol / 4);
  }
}

// Digging: ground that pokes up through the bucket floor is cut away. It fills the bucket first;
// once the bucket is full the rest is shoved ahead of the lip like a bulldozer.
const _bp = new THREE.Vector3();
function digStep() {
  const P = _bp.setFromMatrixPosition(_bw);
  let cut = 0, cutFirm = 0, cutG = 0;
  // firm ground only gives way to a moving blade or a bucket being pushed down: a stalled loader doesn't sink a pit
  const bite = Math.max(clamp(Math.abs(me.speed) / 1.2, 0, 1), input.arm < 0 ? 1 : 0);
  if (me.tilt > -0.1 && _up.y > 0.35 && P.y - heightAt(P.x, P.z) < 3) {      // a bucket tipped to dump doesn't cut
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const [lx, lz] of [[-1.5, -0.15], [1.5, -0.15], [-1.5, 1.4], [1.5, 1.4]]) {
      _rp.set(lx, 0, lz).applyMatrix4(_bw);
      x0 = Math.min(x0, _rp.x); x1 = Math.max(x1, _rp.x); z0 = Math.min(z0, _rp.z); z1 = Math.max(z1, _rp.z);
    }
    const xa = Math.ceil((x0 + HALF) / CELL), xb = Math.floor((x1 + HALF) / CELL), za = Math.ceil((z0 + HALF) / CELL), zb = Math.floor((z1 + HALF) / CELL);
    for (let xi = xa; xi <= xb; xi++) for (let zi = za; zi <= zb; zi++) {
      if (xi < 1 || zi < 1 || xi >= G || zi >= G) continue;
      const wx = xi * CELL - HALF, wz = zi * CELL - HALF;
      const top = P.y - (_up.x * (wx - P.x) + _up.z * (wz - P.z)) / _up.y;        // height of the bucket floor above this spot
      _rp.set(wx, top, wz).applyMatrix4(_bi);
      if (Math.abs(_rp.x) > 1.5 || _rp.z < -0.15 || _rp.z > 1.4) continue;
      const i = zi + xi * W, over = heights[i] - (top - 0.05);
      if (over <= 0.02) continue;
      // loose dirt scoops up fast; firm ground is shaved a little at a time, so the bucket can't bury itself
      const soft = Math.min(over, Math.max(0, heights[i] - firm[i]), L.looseRate * DT);
      const hard = !rockA[i] && heights[i] - soft - firm[i] < 1e-3 ? Math.min(over - soft, L.firmRate * bite * DT) : 0;
      cut -= addHeight(xi, zi, -(soft + hard)) * CELL * CELL; cutG += lastG * CELL * CELL; cutFirm += hard * CELL * CELL; touch(xi, zi);
    }
  }
  me.cut = cut;
  if (cut > 0) {
    const take = Math.min(cut, L.capacity - me.load), takeG = (cutG * take) / cut;
    me.load += take; me.loadG += takeG;
    if (cut - take > 1e-4) deposit(cut - take, 2.1, cutG - takeG);
    const v = chassis.linvel(), sp = Math.hypot(v.x, v.z);                          // moving dirt is hard work: it slows the loader
    if (sp > 0.05) { const j = Math.min(L.loadDrag * take + L.pushDrag * (cut - take) + L.firmDrag * cutFirm, L.mass * sp * 0.3) / sp; chassis.applyImpulse({ x: -v.x * j, y: 0, z: -v.z * j }, true); }
  }
  if (me.tilt < -0.12 && me.load > 0) {                                             // dirt starts sliding out as soon as the bucket tips forward
    const out = Math.min(me.load, L.pour * DT * clamp((-0.12 - me.tilt) / 0.45, 0.25, 1));
    const gf = clamp(me.loadG / me.load, 0, 1);
    me.load -= out; me.loadG = Math.max(0, me.loadG - out * gf); if (me.load < 1e-3) { me.load = 0; me.loadG = 0; }
    pourAcc += out;
    const v = chassis.linvel();
    while (pourAcc >= PVOL || (me.load === 0 && pourAcc > 1e-5)) { const vol = Math.min(PVOL, pourAcc); pourAcc -= vol; pourFrom(_bw, v, vol, vol * gf); }
  }
}

// Grip: steep slopes and mud make the tyres slide. Mud also drags.
let gripNow = 1;
function groundStep() {
  const t = chassis.translation(), mud = mudAt(t.x, t.z), slope = slopeAt(t.x, t.z);
  const deep = mud * smooth(-0.35, -0.85, heightAt(t.x, t.z));          // down in the creek bed, under the water: very sticky
  const m1 = Math.min(1, mud), bog = Math.max(0, mud - 1);            // mud above 1 is swamp: it all but stops a loader
  gripNow = (1 - 0.88 * smooth(0.42, 0.63, slope)) * (1 - 0.5 * m1 - 0.3 * deep) * (1 - 0.55 * bog);
  for (let i = 0; i < 4; i++) vehicle.setWheelFrictionSlip(i, L.slip * gripNow);
  if (mud > 0.05) {
    const v = chassis.linvel(), j = Math.min(0.5, (4500 * m1 + 17000 * deep + 70000 * bog) * (me.kind === "truck" ? 1 + me.load / 6 : 1) * DT / L.mass) * L.mass;   // a loaded truck sinks
    chassis.applyImpulse({ x: -v.x * j, y: 0, z: -v.z * j }, true);
  }
}

// Road roller: any rock that gets under the front drum is crushed into a patch of gravel.
const _ci = new THREE.Matrix4(), _bwr = new THREE.Matrix4();
function rollStep(speed) {
  if (Math.abs(speed) < 0.3) return;
  const t = chassis.translation(), r = chassis.rotation();
  _bwr.compose(_cp.set(t.x, t.y, t.z), _cq.set(r.x, r.y, r.z, r.w), _one);
  _ci.copy(_bwr).invert();
  for (const k of props) {
    if (!k.active || k.type !== "rock" || (net.online && k.owner !== net.id && k.owner !== 0)) continue;
    const p = k.body.translation();
    if (Math.abs(p.x - t.x) > 6 || Math.abs(p.z - t.z) > 6) { k.squash = 0; continue; }
    _rp.set(p.x, p.y, p.z).applyMatrix4(_ci);
    const under = Math.abs(_rp.x) < 1.5 + k.r * 0.4 && _rp.y < 0.6 && ((_rp.z > 0.4 && _rp.z < 2.8 + k.r) || (_rp.z < -0.4 && _rp.z > -2.6 - k.r));
    k.squash = under ? (k.squash || 0) + DT : 0;
    if (k.squash > 0.22) { k.squash = 0; layGravel(k.index, p.x, p.z, k.r); }
  }
  // the drums also flatten loose ground: bumps are pressed down into the hollows beside them,
  // and what they roll over is packed firm (it stops slumping)
  const k = Math.min(1, Math.abs(speed) / 2) * 5 * DT;
  for (const [dz, hw] of [[1.7, 1.35], [-1.5, 1.15]]) flattenUnder(hw, dz, k);
}
const _fl = [];
function flattenUnder(hw, dz, k) {
  _fl.length = 0;
  let sum = 0;
  for (let lx = -hw + 0.25; lx < hw; lx += CELL) for (let lz = dz - 0.5; lz <= dz + 0.5; lz += CELL) {
    _rp.set(lx, 0, lz).applyMatrix4(_bwr);
    const xi = Math.round((_rp.x + HALF) / CELL), zi = Math.round((_rp.z + HALF) / CELL);
    if (xi < 1 || zi < 1 || xi >= G || zi >= G) continue;
    const i = zi + xi * W;
    if (_fl.includes(i)) continue;
    _fl.push(i); sum += heights[i];
  }
  if (_fl.length < 4) return;
  const mean = sum / _fl.length;
  let down = 0, upWant = 0;
  for (const i of _fl) { const d = heights[i] - mean; if (d > 0) down += Math.min(d * k, Math.max(0, heights[i] - firm[i])); else upWant += -d * k; }
  const scale = upWant > 1e-6 ? Math.min(1, down / upWant) : 0, upGot = upWant * scale, take = upGot / Math.max(down, 1e-9);
  let gRem = 0;
  for (const i of _fl) {
    const d = heights[i] - mean;
    if (d > 0) { const c = Math.min(d * k, Math.max(0, heights[i] - firm[i])) * take; if (c > 1e-5) { addHeight(Math.floor(i / W), i % W, -c); gRem += lastG; } }
  }
  const gShare = upGot > 1e-6 ? gRem / upGot : 0;          // the part of what was pressed down that was gravel
  for (const i of _fl) {
    const xi = Math.floor(i / W), zi = i % W, d = heights[i] - mean;
    if (d < 0 && scale > 0) { const a = -d * k * scale; addHeight(xi, zi, a, true, a * gShare); }
    if (loose[i] && Math.abs(heights[i] - mean) < 0.06) firm[i] = Math.max(firm[i], heights[i] - 0.02);       // packed once it is level
    if (Math.abs(heights[i] - mean) < 0.06 && pack[i] < 1) {                                             // and each pass packs it harder
      pack[i] = Math.min(1, pack[i] + (k / (5 * DT)) * CFG.PACK.perSecond * DT); netP.add(i);
      if (overlay.mode === "pack") markDirty(Math.floor(i / W), i % W);
    }
  }
}
function switchPad() {
  const t = chassis.translation();
  if (SITE === "hub") { const gh = houses.find((h) => h.garage); return gh && gh.b.inside(t.x, t.z) ? "garage" : null; }
  return YARDS.some((y) => Math.hypot(t.x - y.x, t.z - y.z) < y.r) ? "vehicle yard" : null;
}
function inPaintShop() {
  if (SITE !== "hub") return false;
  const t = chassis.translation(), ps = houses.find((h) => h.paint);
  return !!ps && ps.b.inside(t.x, t.z);
}
const NEW_LEVEL = ["treasure", "airstrip", "sands", "night", "fire"].includes(SITE);        // the new levels: every vehicle is yours
const rollerUnlocked = () => testUnlock || NEW_LEVEL || SITE === "river" || SITE === "ridge" || !!(progress.farm && progress.farm.done);
// the ranger hands the dump truck over at the gravel pit in Gravel Run; after that it's yours everywhere
const truckUnlocked = () => testUnlock || NEW_LEVEL || SITE === "flood" || !!progress.truck || !!(progress.haul && progress.haul.done) || (SITE === "haul" && !!obj && obj.has("pit"));
const KIND_ORDER = ["loader", "roller", "truck"];
const kindOpen = (k) => k === "loader" || (k === "roller" ? rollerUnlocked() : truckUnlocked());
function nextKind() {
  const i = KIND_ORDER.indexOf(me.kind);
  for (let n = 1; n < KIND_ORDER.length; n++) { const k = KIND_ORDER[(i + n) % KIND_ORDER.length]; if (kindOpen(k)) return k; }
  return null;
}
const KIND_TIPS = { loader: "Bucket and winch.", roller: "Drive over rocks to crush them, and over loose ground to flatten and pack it. No bucket, same winch.",
  truck: "Carries 18 m\u00b3. Raise the bed with \u2192 to pour it out the back, lower it with \u2190. Fill up under a hopper chute or from a friend's loader." };
function switchVehicle() {
  if (!switchPad() || Math.abs(me.speed) > 2) return;
  const next = nextKind();
  if (!next) return showBanner("<b>No other vehicles yet</b>Finish Muddle Acres to unlock the road roller.", 3500);
  if (me.load > 0) { if (me.kind === "loader") deposit(me.load, 1.6, me.loadG); else { const t = chassis.translation(); splat(t.x, t.z, me.load, me.loadG); } me.load = 0; me.loadG = 0; }
  me.bed = 0;
  setKind(me, next);
  try { localStorage.setItem("jobsite-kind", next); } catch {}
  showBanner(`<b>${KINDS[next].name[0].toUpperCase() + KINDS[next].name.slice(1)}</b>${KIND_TIPS[next]}`, 4500);
}

// the truck pours out of the back of its bed; clods from loaders (and hoppers) land in beds and bins
const _tw = new THREE.Matrix4(), _tv = new THREE.Vector3(), _tf = new THREE.Vector3();
function truckPose(ld, out) { const t = ld.body.translation(), r = ld.body.rotation(); return out.compose(_cp.set(t.x, t.y, t.z), _cq.set(r.x, r.y, r.z, r.w), _one); }
function truckPour(ld, vol, gvol, vel) {
  truckPose(ld, _tw);
  _tv.set((Math.random() - 0.5) * 2.2, 0.3 + Math.random() * 0.5, -3.2).applyMatrix4(_tw);
  _tf.setFromMatrixColumn(_tw, 2).multiplyScalar(-(1.0 + Math.random()));
  spawnDirt(_tv.x, _tv.y, _tv.z, vel.x + _tf.x, vel.y - 0.4, vel.z + _tf.z, vol, gvol);
}
function addLoad(v, g) {
  const cap = KINDS.truck.cap, take = Math.min(v, cap - me.load);
  if (take <= 0) return;
  me.load += take; me.loadG += (g * take) / v;
}
const catchers = [], pendingLoad = new Map();
function prepCatch() {
  catchers.length = 0;
  const add = (ld, who) => { if (ld.kind !== "truck" || (ld.bed || 0) > 0.3) return; catchers.push({ inv: truckPose(ld, new THREE.Matrix4()).invert(), who }); };
  if (me.load < KINDS.truck.cap - 0.01) add(me, 0);
  for (const pr of net.peers.values()) if (pr.seen) add(pr.loader, pr.id);
}
function truckStep() {
  me.bed = clamp((me.bed || 0) - input.tilt * 0.55 * DT, 0, 0.95);
  if (me.bed > 0.45 && me.load > 0) {
    const out = Math.min(me.load, 3.4 * DT * clamp((me.bed - 0.45) / 0.3, 0.3, 1)), gf = clamp(me.loadG / me.load, 0, 1);
    me.load -= out; me.loadG = Math.max(0, me.loadG - out * gf); if (me.load < 1e-3) { me.load = 0; me.loadG = 0; }
    pourAcc += out;
    const v = chassis.linvel(), step = PVOL * 1.5;
    while (pourAcc >= step || (me.load === 0 && pourAcc > 1e-5)) { const vol = Math.min(step, pourAcc); pourAcc -= vol; truckPour(me, vol, vol * gf, v); }
  }
}

function driveStep() {
  const KV = KINDS[me.kind], isLoader = me.kind === "loader";
  if (isLoader) {
    me.arm = clamp(me.arm + input.arm * 0.55 * DT, L.armMin, L.armMax);
    me.tilt = clamp(me.tilt + input.tilt * 1.5 * DT, L.tiltMin, L.tiltMax);
  }
  poseBucket(me);
  bucketFrame();

  const speed = me.speed = vehicle.currentVehicleSpeed();
  if (isLoader) { scoopAssist(speed); digStep(); } else if (me.kind === "roller") rollStep(speed); else truckStep();
  groundStep();
  const against = input.fwd !== 0 && Math.sign(input.fwd) !== Math.sign(speed) && Math.abs(speed) > 1.2;
  const top = input.fwd > 0 ? KV.maxSpeed : KV.reverseSpeed;
  const heavy = me.kind === "truck" ? 1 / (1 + (0.6 * me.load) / KV.cap) : 1;          // a full truck is slow uphill
  const force = input.fwd !== 0 && !against && !input.brake ? input.fwd * KV.engine * heavy * clamp(1.15 - Math.abs(speed) / top, 0, 1) : 0;
  const brake = input.brake || against ? L.brake : input.fwd === 0 ? L.idleBrake : 0;
  const steerTarget = input.turn * KV.steer * lerp(1, 0.55, clamp(Math.abs(speed) / L.maxSpeed, 0, 1));
  me.steer += clamp(steerTarget - me.steer, -2.2 * DT, 2.2 * DT);
  for (let i = 0; i < 4; i++) {
    vehicle.setWheelEngineForce(i, force);
    vehicle.setWheelBrake(i, brake);
    vehicle.setWheelSteering(i, me.wheels[i].front ? me.steer : 0);
  }
  vehicle.updateVehicle(DT, undefined, undefined, notChassis);
}

function placeLoader(x, z, yaw) {
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  chassis.setTranslation({ x, y: heightAt(x, z) + 2.2, z }, true);
  chassis.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
  chassis.setLinvel({ x: 0, y: 0, z: 0 }, true);
  chassis.setAngvel({ x: 0, y: 0, z: 0 }, true);
}
function resetLoader() {
  const t = chassis.translation();
  hookOff();
  placeLoader(clamp(t.x, -HALF + 8, HALF - 8), clamp(t.z, -HALF + 8, HALF - 8), heading());
}

// ---------- winch ----------
// A rope from the hook on the back of the loader to a prop, a fixed anchor or another loader.
// It is a stiff spring that only pulls, capped at the winch's strength; Q shortens it, X lets it out.
const winch = { on: false, kind: 0, ref: 0, local: new THREE.Vector3(), len: 0, T: 0, name: "" };
let target = null;
const _wa = new THREE.Vector3(), _wb = new THREE.Vector3(), _wd = new THREE.Vector3(), _wv = new THREE.Vector3(), _wv2 = new THREE.Vector3(), _wl = new THREE.Vector3();
// kind 1 prop (ref index, local point), 2 fixed anchor (ref index), 3 player (ref id)
function anchorPos(kind, ref, local, out) {
  if (kind === 1) { const p = props[ref]; return p && p.active ? bodyPoint(p.body, local, out) : null; }
  if (kind === 2) { const a = anchors[ref]; return a ? out.copy(a.pos) : null; }
  if (kind === 3) {
    if (ref === net.id) return bodyPoint(chassis, ZV, out);
    const pr = net.peers.get(ref);
    return pr && pr.seen ? bodyPoint(pr.loader.body, ZV, out) : null;
  }
  return null;
}
function pointVel(body, pt, out) {
  const v = body.linvel(), w = body.angvel(), c = body.translation();
  const rx = pt.x - c.x, ry = pt.y - c.y, rz = pt.z - c.z;
  return out.set(v.x + w.y * rz - w.z * ry, v.y + w.z * rx - w.x * rz, v.z + w.x * ry - w.y * rx);
}
function findTarget() {
  const A = bodyPoint(chassis, HOOK, _wa), h = heading(), bx = -Math.sin(h), bz = -Math.cos(h);
  let best = null, bestScore = Infinity;
  const consider = (kind, ref, local, pos, name) => {
    const dx = pos.x - A.x, dy = pos.y - A.y, dz = pos.z - A.z, dist = Math.hypot(dx, dy, dz), hd = Math.hypot(dx, dz);
    if (dist > WINCH.max || dist < 1.2 || hd < 0.5) return;
    const dot = (dx * bx + dz * bz) / hd;
    if (dot < 0.35) return;
    const score = dist * (1 + 3 * (1 - dot));          // whatever is most squarely behind wins over something just closer
    if (score < bestScore) { bestScore = score; best = { kind, ref, local: local ? local.clone() : new THREE.Vector3(), pos: pos.clone(), name, dist }; }
  };
  for (const p of props) {
    if (!p.active) continue;
    for (const lp of p.anchorsLocal) consider(1, p.index, lp, bodyPoint(p.body, lp, _wb), p.name);
  }
  anchors.forEach((a, i) => consider(2, i, null, a.pos, a.name));
  for (const pr of net.peers.values()) if (pr.seen) consider(3, pr.id, ZV, bodyPoint(pr.loader.body, ZV, _wb), pr.name + "'s loader");
  return best;
}
function hookOn(t) {
  Object.assign(winch, { on: true, kind: t.kind, ref: t.ref, name: t.name, T: 0 });
  winch.local.copy(t.local);
  winch.len = Math.min(WINCH.max, t.dist + 0.3);
}
function hookOff() { winch.on = false; winch.T = 0; }
function toggleWinch() {
  if (winch.on) return hookOff();
  const t = findTarget();
  if (t) hookOn(t);
}
// one rope's pull, as a spring: k and c are scaled by the masses so it stays stable for a light log or a fixed tree
function ropeTension(len, A, vA, B, vB, mEff) {
  _wd.subVectors(B, A);
  const d = _wd.length();
  if (d < 1e-4) return 0;
  _wd.divideScalar(d);
  const k = mEff * 25, c = mEff * 7, stretch = d - len;
  if (stretch <= 0) return 0;
  const vrel = (vB.x - vA.x) * _wd.x + (vB.y - vA.y) * _wd.y + (vB.z - vA.z) * _wd.z;
  return clamp(k * stretch + c * vrel, 0, WINCH.tmax);
}
// A rope to a fixed anchor set back from a hilltop bends over the edge: if the straight line runs into the
// ground, pull towards the highest point it would cross instead (keeping the rope's full length).
const _lip = new THREE.Vector3();
function overTheLip(A, B) {
  let worst = 0, wt = 0;
  for (let k = 1; k < 16; k++) {
    const t = k / 16, x = lerp(A.x, B.x, t), z = lerp(A.z, B.z, t), over = heightAt(x, z) + 0.4 - lerp(A.y, B.y, t);
    if (over > worst) { worst = over; wt = t; }
  }
  if (worst <= 0) return B;
  const x = lerp(A.x, B.x, wt), z = lerp(A.z, B.z, wt);
  _lip.set(x, heightAt(x, z) + 0.4, z);
  const toLip = A.distanceTo(_lip), path = toLip + _lip.distanceTo(B);
  return _lip.sub(A).multiplyScalar(path / toLip).add(A);
}
function winchStep() {
  if (winch.on) {
    let B = anchorPos(winch.kind, winch.ref, winch.local, _wb);
    if (!B) hookOff();
    else {
      const A = bodyPoint(chassis, HOOK, _wa);
      if (winch.kind === 2) B = overTheLip(A, B);
      if (input.reel > 0) winch.len -= WINCH.reelIn * DT;
      else if (input.reel < 0) winch.len += WINCH.payOut * DT;
      const prop = winch.kind === 1 ? props[winch.ref] : null, dyn = !!prop && prop.body.isDynamic();
      const mB = dyn ? prop.body.mass() : Infinity, mEff = mB === Infinity ? L.mass : (L.mass * mB) / (L.mass + mB);
      const d = A.distanceTo(B);
      winch.len = clamp(Math.max(winch.len, d - (WINCH.tmax / (mEff * 25)) * 1.1), WINCH.min, WINCH.max);   // a stalled winch doesn't store a huge stretch
      const vA = pointVel(chassis, A, _wv), vB = dyn ? pointVel(prop.body, B, _wv2) : _wv2.set(0, 0, 0);
      const T = (winch.T = ropeTension(winch.len, A, vA, B, vB, mEff));
      if (T > 0) {
        const J = T * DT;
        chassis.applyImpulseAtPoint({ x: _wd.x * J, y: _wd.y * J, z: _wd.z * J }, { x: A.x, y: A.y, z: A.z }, true);
        if (dyn) prop.body.applyImpulseAtPoint({ x: -_wd.x * J, y: -_wd.y * J, z: -_wd.z * J }, { x: B.x, y: B.y, z: B.z }, true);
      }
    }
  }
  // other players' ropes hooked to me: my game pulls my loader towards their hook
  for (const pr of net.peers.values()) {
    const h = pr.h;
    if (!h || h[0] !== 3 || h[1] !== net.id || !pr.seen) continue;
    const A = bodyPoint(pr.loader.body, HOOK, _wa), B = bodyPoint(chassis, ZV, _wb), vB = pointVel(chassis, B, _wv2);
    const T = ropeTension(h[5], A, _wv.set(0, 0, 0), B, vB, L.mass * 0.5);
    if (T > 0) { const J = T * DT; chassis.applyImpulse({ x: -_wd.x * J, y: -_wd.y * J, z: -_wd.z * J }, true); }
  }
}
// Parking brake: stopped with Space held, the loader digs its tyres in and holds against a heavy
// pull (the wheel brakes alone give way around 25 kN). Mud and slopes weaken it.
function parkStep() {
  if (!input.brake || input.fwd !== 0) return;
  const v = chassis.linvel(), sp = Math.hypot(v.x, v.z);
  if (sp > 1.5 || sp < 1e-4) return;
  const j = Math.min(L.mass * sp, L.park * gripNow * DT) / sp;
  chassis.applyImpulse({ x: -v.x * j, y: 0, z: -v.z * j }, true);
}
// the rope's tension on a prop from everyone's winches (used for the stump)
function pullOn(prop) {
  let T = winch.on && winch.kind === 1 && winch.ref === prop.index ? winch.T : 0;
  for (const pr of net.peers.values()) if (pr.h && pr.h[0] === 1 && pr.h[1] === prop.index) T += pr.h[6] || 0;
  return T;
}

// ---------- level state ----------
const FL = { stump: 1, logs: 2, boulders: 4, fill: 8, open: 16, done: 32, tractor: 64 };
let flags = 0;
const job = { gateClose: 0, townVol: 0, pasture: 0, dry: 1, marks: new Set(), tiersLost: 0, time: 0, fill: 0, logsIn: 0, bouldersIn: 0, stumpPull: 0, stuck: 0, moved: false, ended: false, water: SITE === "flood" ? FLOOD.water.start : 0, hold: 0, crest: null, floodVis: 0, cover: 0 };
function sinkDeficit() { let d = 0; for (let k = 0; k < sinkIdx.length; k++) d += Math.max(0, sinkTarget[k] - heights[sinkIdx[k]]); return d * CELL * CELL; }
const SINK_START = SITE === "farm" ? sinkDeficit() : 1;
function setFlag(f) { if (flags & f) return; flags |= f; onFlag(f); }

// ---------- objectives, character pop-ups and stars ----------
// Levels rebuilt on the objective system define `obj`; the older levels still use the flag bits below.
const popups = createPopups(CHARACTERS, CFG.POPUP);
function say(event) { const lines = LINES[SITE] && LINES[SITE][event]; if (lines) popups.say(lines); }
// Cut/fill (Ridge Road): m³ dug out of the landslide versus m³ placed in the gully
const cutFill = { cut: 0, placed: 0, need: 0, slide: 0 };
{
  const zOf = (i) => (i % W) * CELL - HALF, A = CELL * CELL;
  for (const i of cutIdx) cutFill.slide += (base[i] - firm[i]) * A;
  for (const i of fillIdx) {                  // a 5 m road, with the loose dirt's natural slope down either side
    const x = Math.floor(i / W) * CELL - HALF, tgt = ridgeRoad(zOf(i)) - Math.max(0, Math.abs(x) - 2.5) * 0.62;
    cutFill.need += Math.max(0, tgt - base[i]) * A;
  }
}
function measureCutFill() {
  let cut = 0, placed = 0;
  for (const i of cutIdx) cut += Math.max(0, base[i] - heights[i]);
  for (const i of fillIdx) placed += Math.max(0, heights[i] - base[i]);
  cutFill.cut = cut * CELL * CELL; cutFill.placed = placed * CELL * CELL;
}
const cutFillOff = () => (cutFill.cut > 1 ? Math.abs(cutFill.cut - cutFill.placed) / cutFill.cut : 1);
const cutFillOk = () => cutFill.cut > 1 && cutFillOff() <= CFG.LEVELS.ridge.cutFillTolerance;

let obj = null;
if (SITE === "farm") {
  const F = FARM, inRect = (p, r, m) => { const t = p.body.translation(); return t.x > r.x0 + m && t.x < r.x1 - m && t.z > r.z0 + m && t.z < r.z1 - m; };
  const near = (p, o, r) => { const t = p.body.translation(); return Math.hypot(t.x - o.x, t.z - o.z) < r; };
  obj = createObjectives([
    { id: "pig", text: "Follow the hoofprints and find Clementine the pig", done: () => { const t = chassis.translation(); return near(pig, { x: t.x, z: t.z }, 6); } },
    { id: "tractor", after: ["pig"], text: "Winch Dinston's tractor out of the mud onto the green ring", done: () => near(tractor, F.tractorSpot, F.tractorSpot.r) },
    { id: "gate", after: ["tractor"], text: "Push the boulder out of the paddock gate", done: () => !near(gateRock, F.gateZone, F.gateZone.r + 0.3) },
    { id: "sink", after: ["gate"], text: "Fill the sinkhole by the well", progress: () => job.fill / 0.92, done: () => job.fill >= 0.92 },
    { id: "logs", after: ["sink"], text: () => `Winch the fallen trees onto the woodpile: ${job.logsIn} / ${logs.length}`, done: () => job.logsIn >= logs.length },
    { id: "barn", after: ["logs"], text: "Winch yourself up the hill into the barn", done: () => { const t = chassis.translation(); return barn.inside(t.x, t.z); } },
  ], onObjective);
}
if (SITE === "river") {
  const R = RIVER, inZone = (p, o) => { const t = p.body.translation(); return Math.hypot(t.x - o.x, t.z - o.z) < o.r; };
  obj = createObjectives([
    { id: "riprap", text: () => `Put boulders in the river just upstream of the ford: ${Math.min(job.rip || 0, R.riprap.need)} / ${R.riprap.need}`, done: () => job.rip >= R.riprap.need },
    { id: "causeway", text: "Build a causeway across the river", progress: () => job.fill || 0, done: () => job.fill >= 1 },
    { id: "pack", after: ["causeway"], text: () => `Roll the causeway firm: ${Math.round((job.packed || 0) * 100)}% packed (${Math.round(CFG.LEVELS.river.packNeed * 100)}% needed)`, done: () => job.packed >= CFG.LEVELS.river.packNeed },
    { id: "gravel", after: ["causeway"], text: "Lay gravel across the mud flat", progress: () => job.road || 0, done: () => job.road >= 1 },
    { id: "cake", after: ["gravel"], text: () => `Tow the wedding cake to the wedding${job.tiersLost ? ` (${3 - job.tiersLost} of 3 tiers left)` : ""}`, done: () => inZone(crate, R.wedding) },
    { id: "toolbox", bonus: true, text: "Bring the toolbox to the depot by the road", done: () => inZone(toolbox, R.depot) },
    { id: "rocks", bonus: true, text: () => `Crush every rock: ${riverRocks.filter((k) => !k.active).length} / ${riverRocks.length}`, done: () => riverRocks.every((k) => !k.active) },
  ], onObjective);
}
if (SITE === "flood") {
  const F = FLOOD;
  obj = createObjectives([
    F.gate && { id: "gate", text: "Wind the floodgate shut (winch on the red wheel)", progress: () => job.gateClose, done: () => job.gateClose >= 1 },
    { id: "breaks", text: () => { const l = floodBreaks(), cr = job.crest; const ok = cr ? l.filter((b, n) => cr.per[n] >= F.water.peak + 0.1).length : 0; return `Plug the breaks above the peak: ${ok} / ${l.length}${job.marks.has("late") ? "" : " (so far)"}`; },
      done: () => { const cr = job.crest; return !!cr && job.marks.has("late") && floodBreaks().every((b, n) => cr.per[n] >= F.water.peak + 0.1); } },
    { id: "hold", text: () => job.water >= F.water.peak ? `Hold until the river falls: ${Math.max(0, F.water.hold - job.hold).toFixed(0)} s` : "Hold the river until it peaks", done: () => job.hold > F.water.hold },
    F.cars.length > 0 && { id: "cars", bonus: true, text: () => `Rescue the cars from the river: ${cars.filter((c, k) => job.marks.has("car" + k)).length} / ${cars.length}`, done: () => cars.every((c, k) => job.marks.has("car" + k)) },
  ].filter(Boolean), onObjective);
}
if (SITE === "fire") {
  obj = createObjectives([
    { id: "out", text: "Keep the fire off the farm until it burns out", done: () => job.marks.has("out") },
    { id: "trees", bonus: true, text: () => `Drag the trees out of the valley: ${fireTrees.filter((t) => !t.active).length} / ${fireTrees.length} felled`, done: () => fireTrees.every((t) => !t.active) },
  ], onObjective);
}
if (SITE === "night") {
  obj = createObjectives([
    { id: "in", text: "Get through Grade-A Grading's fence", done: () => panels.some((p) => !p.active) },
    { id: "soil", text: () => `Deliver ${NIGHT.need} m\u00b3 of topsoil to your lot: ${Math.min(NIGHT.need, Math.round(job.delivered || 0))}`, progress: () => (job.delivered || 0) / NIGHT.need, done: () => (job.delivered || 0) >= NIGHT.need },
    { id: "lights", bonus: true, text: "Cut the floodlights (winch the generator away)", done: () => !powerOn() },
  ], onObjective);
}
if (SITE === "sands") {
  obj = createObjectives([
    { id: "fill", text: "Fill the pit with sand", progress: () => (job.fill || 0) / 0.9, done: () => job.fill >= 0.9 },
    { id: "seal", after: ["fill"], text: "Roll the new sand to seal the pit", progress: () => (job.sealPack || 0) / 0.8, done: () => job.sealPack >= 0.8 },
  ], onObjective);
}
if (SITE === "treasure") {
  const T = TREASURE, clue = (k) => () => (k === 0 || obj.has("c" + (k - 1)) ? `Clue ${k + 1}: ${clueText(k)}` : `Clue ${k + 1}: written on the post you dig up`);
  obj = createObjectives([
    { id: "c0", text: clue(0), done: () => dugOut(TCLUES[0].x, TCLUES[0].z) },
    { id: "c1", after: ["c0"], text: clue(1), done: () => dugOut(TCLUES[1].x, TCLUES[1].z) },
    { id: "c2", after: ["c1"], text: clue(2), done: () => dugOut(TCLUES[2].x, TCLUES[2].z) },
    { id: "c3", after: ["c2"], text: clue(3), done: () => job.marks.has("chestUp") },
    { id: "home", after: ["c3"], text: "Drag the chest back to the start (green ring)", done: () => { const c = tChest.body.translation(); return Math.hypot(c.x - T.home.x, c.z - T.home.z) < T.home.r; } },
  ], onObjective);
}
if (SITE === "airstrip") {
  const C = CFG.LEVELS.airstrip;
  obj = createObjectives([
    { id: "trees", text: () => `Fell the trees on the strip: ${standing.filter((t, k) => job.marks.has("fell" + k)).length} / ${standing.length}`, done: () => standing.every((t, k) => job.marks.has("fell" + k)) },
    { id: "clear", after: ["trees"], text: () => `Clear the strip of logs, stumps and rocks${job.clutter != null ? `: ${job.clutter} left` : ""}`, done: () => job.clutter === 0 },
    { id: "grade", text: () => `Cut and fill the strip level (±${Math.round(C.tol * 100)} cm)`, progress: () => (job.strip ? job.strip.grade / C.gradeNeed : 0), done: () => !!job.strip && job.strip.grade >= C.gradeNeed },
    { id: "mud", text: "Gravel the mud patches", progress: () => (job.strip ? (job.strip.dry - 0.9) / 0.08 : 0), done: () => !!job.strip && job.strip.dry >= 0.98 },
    { id: "pack", after: ["grade"], text: "Roll the strip firm", progress: () => (job.strip ? job.strip.pack / C.packNeed : 0), done: () => !!job.strip && job.strip.pack >= C.packNeed },
    { id: "ready", after: ["clear", "grade", "mud", "pack"], text: "Wait for the plane", done: () => job.marks.has("landed") },
  ], onObjective);
}
if (SITE === "haul") {
  const H = HAUL, P = H.pad;
  obj = createObjectives([
    { id: "ford", text: "Gravel the stream ford", progress: () => job.road || 0, done: () => job.road >= 1 },
    { id: "pit", text: () => `Clear the pit road: tree ${job.logInWay ? "in the way" : "moved"}, boulders left ${job.rocksLeft ?? 2}`, done: () => !job.logInWay && job.rocksLeft === 0 },
    { id: "haul", after: ["pit"], text: "Bring a full truckload down the switchbacks", done: () => job.marks.has("hauled") },
    { id: "pads", after: ["pit"], text: () => `Gravel the tent pads: ${(job.ratings || []).filter((r) => r.done).length} / ${H.tents.length}`, done: () => !!job.ratings && job.ratings.every((r) => r.done) },
    { id: "picnic", bonus: true, text: "Bring the picnic tables from the pit to the campsite", done: () => { const c = picnic.body.translation(); return Math.abs(c.x - P.x) < P.w / 2 && Math.abs(c.z - P.z) < P.d / 2; } },
    { id: "hairpin", bonus: true, text: "Gravel the hairpin bend too", done: () => coverOf(pinCells, 0.06) >= 0.8 },
  ], onObjective);
}
if (SITE === "ridge") {
  const R = RIDGE, onPad = when.inZone(() => cabin, R.pad, R.top - 1);
  obj = createObjectives([
    { id: "slide", text: "Clear the landslide and the loose bank (5 m wide)", progress: () => job.fill || 0, done: () => job.fill >= 1 },
    { id: "gully", text: "Fill the washed-out gully", progress: () => job.road || 0, done: () => job.road >= 1 },
    { id: "stage", text: "Tow the cabin up to the foot of the last climb", after: ["slide", "gully"], done: () => { const c = cabin.body.translation(); return c.z > R.stage.z0 - 3 && c.y > 11; } },
    { id: "summit", text: "Winch the cabin up to the summit pad", after: ["stage"], done: onPad },
    { id: "wood", bonus: true, text: "Bring the firewood crate to the summit too", done: when.inZone(() => firewood, R.pad, R.top - 1) },
    { id: "rocks", bonus: true, text: () => `Crush the landslide rocks: ${ridgeRocks.filter((k) => !k.active).length} / ${ridgeRocks.length}`, done: () => ridgeRocks.every((k) => !k.active) },
  ], onObjective);
}
const OBJ_BANNER = {
  farm: { pig: "<b>Found her!</b>", tractor: "<b>Tractor rescued!</b>", gate: "<b>Gate clear!</b>", sink: "<b>Sinkhole filled!</b>", logs: "<b>Logs stacked!</b>The barn doors are open." },
  flood: { gate: "<b>Floodgate shut!</b>", breaks: "<b>Every break plugged!</b>Now hold on until the river peaks.", cars: "<b>All three cars rescued!</b>Bonus job done." },
  fire: { out: "<b>The fire is out!</b>", trees: "<b>No trees left to burn!</b>Bonus job done." },
  night: { in: "<b>You're in.</b>Quietly now.", soil: "<b>That's the lot!</b>Nobody saw a thing.", lights: "<b>Lights out!</b>The floodlights have no power." },
  sands: { fill: "<b>Pit filled!</b>Now roll it to seal the worm in.", seal: "<b>Sealed!</b>The worm has nowhere to go." },
  treasure: { c0: "<b>A marker post!</b>Clue 2 is written on it.", c1: "<b>Another post!</b>Clue 3 is on this one.", c2: "<b>The last post!</b>It says where the chest is.", c3: "<b>The chest!</b>Winch it out of the hole." },
  airstrip: { trees: "<b>All the trees are down!</b>", clear: "<b>Strip clear!</b>", grade: "<b>Strip level!</b>", mud: "<b>Mud gravelled!</b>", pack: "<b>Strip rolled firm!</b>" },
  haul: { ford: "<b>Ford graveled!</b>A loaded truck can cross the stream now.", pit: "<b>Pit road open!</b>The dump truck is yours.", haul: "<b>First load down!</b>",
    pads: "<b>All tent pads done!</b>Open the gates!", picnic: "<b>Picnic tables delivered!</b>Bonus job done.", hairpin: "<b>Hairpin graveled!</b>Bonus job done." },
  river: { riprap: "<b>Riprap in place!</b>The current is gentler behind it.", causeway: "<b>Causeway built!</b>Now pack it before it washes away.", pack: "<b>Causeway packed!</b>",
    gravel: "<b>Gravel road laid!</b>Go and fetch the cake.", cake: "<b>The cake has arrived!</b>", toolbox: "<b>Toolbox recovered!</b>Bonus job done.", rocks: "<b>Every rock crushed!</b>Bonus job done." },
  ridge: { slide: "<b>Landslide cleared!</b>The road is open as far as the gully.", gully: "<b>Gully filled!</b>You can tow the cabin up to the last climb.",
    wood: "<b>Firewood delivered!</b>Bonus job done.", rocks: "<b>Every rock crushed!</b>Bonus job done." },
};
function onObjective(id, quiet) {
  if (SITE === "farm") farmEffect(id);            // changes to the world happen even when restoring a save
  if (SITE === "river") riverEffect(id);
  if (SITE === "flood" && id === "gate") { job.gateClose = 1; lockGate(); }
  if (SITE === "haul" && id === "pit" && !progress.truck) { progress.truck = true; try { localStorage.setItem("jobsite-progress", JSON.stringify(progress)); } catch {} if (!quiet) saveProgress(); }
  if (quiet || job.ended) return;                 // from a saved game: no banners, pop-ups or finishing
  const b = OBJ_BANNER[SITE] && OBJ_BANNER[SITE][id];
  if (b) { showBanner(b, 4000); sfx.ding(); }
  say(id);
  if (SITE === "fire" && id === "out") { job.party = 0; job.saved = farmSaved(); say(job.saved >= 0.999 ? "done" : "doneSome"); if (job.saved >= 0.999) sfx.cheer(); finishLevel(); return; }
  if (SITE === "airstrip" && id === "ready") { const tier = [3, 2, 1].find((n) => job.marks.has("tier" + n)) || 2; say("done" + tier); finishLevel(); return; }
  if (SITE === "flood" && id === "hold") { job.party = 0; say("done"); finishLevel(); return; }      // the river peaked: whatever state the town is in, the job is over
  if (obj.mainDone()) { say("done"); if (SITE === "river" || SITE === "ridge" || SITE === "haul") job.party = 0; if (SITE === "haul") job.queueAtOpen = queueLen(); if (SITE === "river") sfx.cheer(); finishLevel(); }
}
// Stars: 1 for finishing, then two level-specific goals (data/config.js). Older levels: one per bonus job.
const starGoals = () => (CFG.LEVELS[SITE] && CFG.LEVELS[SITE].stars) || CFG.DEFAULT_STARS;
const bonusCount = () => (obj ? obj.bonusDone() : (flags & FL.stump ? 1 : 0) + (flags & FL.tractor ? 1 : 0));
function starChecks() {
  if (SITE === "farm") return [true, job.time <= CFG.LEVELS.farm.targetTime, !job.pigPushed];
  if (SITE === "fire") return [true, (job.saved ?? 1) >= CFG.LEVELS.fire.savedStar, (job.saved ?? 1) >= 0.999];
  if (SITE === "night") return [true, !job.marks.has("alarm"), job.time <= CFG.LEVELS.night.targetTime];
  if (SITE === "sands") return [true, swallowCount() <= CFG.LEVELS.sands.swallowStar, swallowCount() === 0];
  if (SITE === "treasure") return [true, job.time <= CFG.LEVELS.treasure.targetTime, !TREASURE.decoys.some((d, k) => job.marks.has("decoy" + k))];
  if (SITE === "airstrip") { const tier = [3, 2, 1].find((n) => job.marks.has("tier" + n)) || 0; return [true, tier >= 2, tier >= 3]; }
  if (SITE === "flood") return [true, job.dry >= CFG.LEVELS.flood.dryStar, job.dry >= 0.999 && cars.every((c, k) => job.marks.has("car" + k))];
  if (SITE === "haul") { const q = job.queueAtOpen ?? queueLen(); return [true, q < CFG.LEVELS.haul.queueStar, !!job.ratings && job.ratings.every((r) => r.done && r.label === "perfect")]; }
  if (SITE === "river") return [true, (job.packed || 0) >= CFG.LEVELS.river.packStar, obj.has("cake") && !job.tiersLost];
  if (SITE === "ridge") return [true, job.time <= CFG.LEVELS.ridge.targetTime, !job.marks.has("tipped") && obj.has("summit")];
  return [true, bonusCount() >= 1, bonusCount() >= 2];
}
const starsEarned = () => starChecks().filter(Boolean).length;
const starStr = (n) => "★".repeat(n) + "☆".repeat(3 - n);
const starsOf = (p) => (p && p.done ? p.stars || Math.min(3, 1 + (p.bonus || 0)) : 0);
function starsHtml(finished) {
  const ok = starChecks();
  return `<div class="sub" style="margin-top:6px">Stars</div>` + starGoals().map((g, k) => `<div class="sub star">${(k === 0 ? finished : ok[k]) ? "&#9733;" : "&#9734;"} ${g}</div>`).join("");
}
function cutFillHtml() {
  const c = cutFill, max = Math.max(c.cut, c.placed, c.need, 1);
  const bar = (v, col) => `<span class="mbar"><i style="width:${Math.round((v / max) * 100)}%;background:${col}"></i></span>`;
  const state = c.cut <= 1 ? "nothing dug yet" : cutFillOk() ? '<span class="ok">balanced</span>' : `${Math.round(cutFillOff() * 100)}% apart`;
  return `<div class="meter"><div class="sub">Cut / fill</div>
    <div class="mrow"><span>Dug from the slide</span>${bar(c.cut, "#c08a4a")}<b>${c.cut.toFixed(0)} m&sup3;</b></div>
    <div class="mrow"><span>Placed in the gully</span>${bar(c.placed, "#8be28b")}<b>${c.placed.toFixed(0)} m&sup3;</b></div>
    <div class="sub">The gully needs about ${c.need.toFixed(0)} m&sup3; for a 5 m road &middot; ${state}</div></div>`;
}
const SITE_BANNER = {
  haul: { 1: "<b>Picnic tables delivered!</b>Bonus job done.", 2: "<b>Pit road open!</b>The gravel pit and its hopper are yours.",
    4: "<b>Ford graveled!</b>A loaded truck can cross the stream now.", 64: "<b>Hairpin graveled!</b>Bonus job done." },
};
function onFlag(f) {
  if (f === FL.stump && stump) { stump.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true); showBanner("<b>Stump pulled!</b>Bonus job done.", 4000); }
  if (SITE_BANNER[SITE] && SITE_BANNER[SITE][f]) showBanner(SITE_BANNER[SITE][f], 5000);
  if (f === FL.tractor && (SITE === "farm" || SITE === "river")) showBanner(SITE === "river" ? "<b>Every rock crushed!</b>Bonus job done." : "<b>Tractor rescued!</b>Bonus job done.", 4000);
  if (SITE === "river" && f === FL.logs) showBanner("<b>Causeway built!</b>You can drive across the river now.", 5000);
  if (SITE === "river" && f === FL.boulders) showBanner("<b>Gravel road laid!</b>Go and fetch the generator.", 5000);
  if (f === FL.stump && SITE === "river") showBanner("<b>Toolbox recovered!</b>Bonus job done.", 4000);
  if (f === FL.open && barnDoor) {
    world.removeCollider(barnDoor.userData.collider, false); barnDoor.userData.open = true; barnBeam.visible = true;
    barn.sign.userData.draw("Barn", "Open: winch up the hill!", "#8be28b");
    showBanner("<b>The barn is open!</b>Winch your way up the hill and drive inside to finish.", 6500);
  }
  if (f === FL.done) finishLevel();
}

// ---------- multiplayer ----------
// Each player simulates their own loader and the props near it, and sends both 20 times a second.
// The room server only relays. The longest-connected player ("host") looks after props nobody is near,
// brings newcomers up to date, and saves the site to the room.
const net = { ws: null, id: 0, online: false, room: "", roster: [], peers: new Map(), hostId: 0, lastSave: 0 };
const elRoster = document.getElementById("roster");
let progress = {};
try { progress = JSON.parse(localStorage.getItem("jobsite-progress") || "{}") || {}; } catch {}

function buildSync() {
  const rk = [], tr = [];
  for (const r of props) { const p = r.body.translation(), q = r.body.rotation(); rk.push(r3(p.x), r3(p.y), r3(p.z), r3(q.x), r3(q.y), r3(q.z), r3(q.w)); }
  for (let i = 0; i < heights.length; i++) if (heights[i] !== base[i]) tr.push(i, Math.round(heights[i] * 1000));
  const gt = [];
  for (let i = 0; i < gravH.length; i++) if (gravH[i] > 0.001) gt.push(i, Math.round(gravH[i] * 1000));
  const pk = [];
  for (let i = 0; i < pack.length; i++) if (Math.abs(pack[i] - pack0[i]) > 0.01) pk.push(i, Math.round(pack[i] * 100));
  return { t: "sync", ver: SYNC_VER, site: SITE, rk, tr, time: Math.round(job.time), flags, nb: activeBoulders, gv: gravel, gt, hop: hopper ? [r3(hopper.vol), r3(hopper.g)] : null, wl: job.water, wh: job.hold, fs: [job.townVol, job.pasture], gc: job.gateClose,
    pk, ob: obj ? obj.list() : [], pp: job.pigPushed ? 1 : 0, ct: job.tiersLost || 0, jm: [...job.marks], fire: fireS ? [...fireS.keys()].filter((c) => fireS[c]).flatMap((c) => [c, fireS[c]]) : null, scr: scraped ? [...scraped.keys()].filter((c) => scraped[c]) : null };
}
function applySync(s) {
  if (!s || s.ver !== SYNC_VER || s.site !== SITE || !Array.isArray(s.rk) || !Array.isArray(s.tr)) return;
  for (let k = 0; k + 1 < s.tr.length; k += 2) {
    const i = s.tr[k];
    if (i > 0 && i < heights.length) { heights[i] = s.tr[k + 1] / 1000; firm[i] = Math.min(firm[i], heights[i]); loose[i] = 1; markDirty(Math.floor(i / W), i % W); }
  }
  flushTerrain();
  if (SITE === "farm") setActiveBoulders(Math.max(activeBoulders, s.nb || 5));
  if (Array.isArray(s.gv)) for (const g of s.gv) markCrushed(g);
  if (Array.isArray(s.gt)) for (let k = 0; k + 1 < s.gt.length; k += 2) { const i = s.gt[k]; if (i > 0 && i < gravH.length) { gravH[i] = s.gt[k + 1] / 1000; markDirty(Math.floor(i / W), i % W); } }
  flushTerrain();
  for (let f = 1; f <= 64; f <<= 1) if (s.flags & f && f !== FL.done) setFlag(f);
  for (let n = 0; n < props.length && n * 7 + 6 < s.rk.length; n++) {
    const a = s.rk, o = n * 7, b = props[n].body;
    b.setTranslation({ x: a[o], y: a[o + 1], z: a[o + 2] }, true); b.setRotation({ x: a[o + 3], y: a[o + 4], z: a[o + 5], w: a[o + 6] }, true);
    if (b.isDynamic()) { b.setLinvel({ x: 0, y: 0, z: 0 }, true); b.setAngvel({ x: 0, y: 0, z: 0 }, true); }
  }
  job.time = s.time || 0;
  if (Array.isArray(s.hop) && hopper) { hopper.vol = +s.hop[0] || 0; hopper.g = +s.hop[1] || 0; }
  if (SITE === "flood" && typeof s.wl === "number") { job.water = s.wl; job.hold = +s.wh || 0; if (Array.isArray(s.fs)) { job.townVol = +s.fs[0] || 0; job.pasture = +s.fs[1] || 0; } job.gateClose = Math.max(job.gateClose, +s.gc || 0); }
  if (Array.isArray(s.pk)) for (let k = 0; k + 1 < s.pk.length; k += 2) { const i = s.pk[k]; if (i > 0 && i < pack.length) pack[i] = clamp(s.pk[k + 1] / 100, 0, 1); }
  if (Array.isArray(s.ob) && obj) for (const id of s.ob) obj.complete(String(id), true);
  if (s.pp) job.pigPushed = true;
  if (s.ct) job.tiersLost = Math.min(3, s.ct | 0);
  if (Array.isArray(s.jm)) for (const k of s.jm) job.marks.add(String(k));
  if (fireS && Array.isArray(s.fire)) for (let k = 0; k + 1 < s.fire.length; k += 2) fireS[s.fire[k]] = s.fire[k + 1];
  if (scraped && Array.isArray(s.scr)) for (const c of s.scr) scraped[c] = 1;       // quietly: no banners or pop-ups for old news
}

function setRoster(list) {
  const known = new Set(net.roster.map((p) => p.id));
  net.roster = list;
  net.hostId = list.length ? Math.min(...list.map((p) => p.id)) : 0;
  for (const p of list) {
    if (p.id === net.id || net.peers.has(p.id)) continue;
    net.peers.set(p.id, { id: p.id, name: p.name, loader: makeLoader(p.slot, false), snaps: [], pos: new THREE.Vector3(1e6, 0, 1e6), seen: false, h: null });
    if (net.hostId === net.id && !known.has(p.id)) send({ t: "to", to: p.id, m: buildSync() });      // bring the newcomer up to date
  }
  for (const [id, peer] of net.peers) if (!list.some((p) => p.id === id)) { disposeLoader(peer.loader); net.peers.delete(id); }
  if (SITE === "farm" && list.length) setActiveBoulders(Math.max(activeBoulders, 5 * list.length));     // five boulders per player
  renderRoster();
}
// the colour chip next to each name matches that player's paint job
function renderRoster() {
  elRoster.style.display = net.online ? "block" : "none";
  const chip = (p) => { const ld = p.id === net.id ? me : net.peers.get(p.id) && net.peers.get(p.id).loader; return ld ? ld.paint.color.getHexString() : COLORS[p.slot].toString(16).padStart(6, "0"); };
  elRoster.innerHTML = `<h2>Room ${net.room}</h2>` + net.roster.map((p) => `<div><i style="background:#${chip(p)}"></i>${esc(p.name)}${p.id === net.id ? " (you)" : ""}${p.id === net.hostId ? " &#9733;" : ""}</div>`).join("");
}
function send(m) { if (net.ws && net.ws.readyState === 1) net.ws.send(JSON.stringify(m)); }

function connect(room, name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${SERVER}/rooms/${room}/ws`);
    let done = false;
    const fail = (why) => { if (!done) { done = true; reject(new Error(why)); } };
    ws.onopen = () => ws.send(JSON.stringify({ t: "hello", name }));
    ws.onerror = () => fail("Could not reach the room server.");
    ws.onclose = () => {
      fail("The room server closed the connection.");
      if (net.online) { net.online = false; setRoster([]); showBanner("<b>Disconnected</b>You can keep playing on your own.", 6000); }
    };
    ws.onmessage = (e) => {
      let d; try { d = JSON.parse(e.data); } catch { return; }
      if (d.t === "full") return fail("That room is full (4 players).");
      if (d.t === "welcome") {
        if (d.site && d.site !== SITE) { location.replace(`?site=${d.site}&room=${room}`); return; }     // the crew is on another site: go there
        Object.assign(net, { ws, id: d.id, online: true, room });
        if (d.progress) { try { progress = JSON.parse(d.progress) || {}; } catch {} }
        me.slot = d.slot; applyLook(me, myLook);
        const s = spawnAt(d.slot); placeLoader(s.x, s.z, s.yaw);
        if (d.save && d.roster.length === 1) { try { applySync(JSON.parse(d.save)); } catch {} }
        setRoster(d.roster);
        refreshSigns();
        done = true; resolve();
      } else if (d.t === "roster") setRoster(d.roster);
      else if (d.t === "site") { if (d.site !== SITE) location.replace(`?site=${d.site}&room=${net.room}`); }
      else if (d.m) onPeerMessage(d.f, d.m);
    };
  });
}

function onPeerMessage(from, m) {
  if (m.t === "sync") return applySync(m);
  if (m.t === "ld") { if (me.kind === "truck") addLoad(+m.v || 0, +m.g || 0); return; }      // a friend tipped their bucket into my truck
  const peer = net.peers.get(from);
  if (m.t !== "s" || !peer) return;
  peer.snaps.push({ at: performance.now(), p: m.p, q: m.q, a: m.a, b: m.b, w: m.w, l: m.l, v: m.v, bd: m.bd || 0 });
  if (Array.isArray(m.hd) && hopper) { hopper.vol = Math.max(0, hopper.vol + m.hd[0]); hopper.g = clamp(hopper.g + m.hd[1], 0, hopper.vol); }
  if (SITE === "flood" && typeof m.wl === "number" && from === net.hostId) { job.water = m.wl; job.hold = +m.wh || 0; if (Array.isArray(m.fs)) { job.townVol = +m.fs[0] || 0; job.pasture = +m.fs[1] || 0; } }
  if (SITE === "flood" && m.gc > job.gateClose) job.gateClose = Math.min(1, +m.gc);
  if (peer.snaps.length > 12) peer.snaps.shift();
  peer.pos.set(m.p[0], m.p[1], m.p[2]);
  peer.h = Array.isArray(m.h) ? m.h : null;
  setKind(peer.loader, KIND_ORDER[m.k] || "loader");
  if (fireS && Array.isArray(m.fr)) for (let k = 0; k + 1 < m.fr.length; k += 2) { const c = m.fr[k]; if (c >= 0 && c < fireS.length) fireS[c] = m.fr[k + 1]; }
  if (scraped && Array.isArray(m.fs2)) for (const c of m.fs2) if (c >= 0 && c < scraped.length) scraped[c] = 1;
  if (peer.loader.headlight && m.hl !== undefined) { peer.loader.hl = !!m.hl; peer.loader.headlight.visible = peer.loader.hl; }
  if (Array.isArray(m.lk)) {
    const key = m.lk.join(",");
    if (key !== peer.lookKey) { peer.lookKey = key; applyLook(peer.loader, cleanLook(m.lk)); renderRoster(); }
  }
  if (m.fl) for (let f = 1; f <= 64; f <<= 1) if (m.fl & f) setFlag(f);
  if (SITE === "farm" && m.nb > activeBoulders) setActiveBoulders(m.nb);
  if (Array.isArray(m.gv)) for (const g of m.gv) markCrushed(g);
  if (m.eg) for (let k = 0; k + 1 < m.eg.length; k += 2) { const i = m.eg[k]; if (i > 0 && i < gravH.length) { gravH[i] = Math.max(0, gravH[i] + m.eg[k + 1] / 1000); markDirty(Math.floor(i / W), i % W); } }
  if (m.e) for (let k = 0; k + 1 < m.e.length; k += 2) { const i = m.e[k]; addHeight(Math.floor(i / W), i % W, m.e[k + 1] / 1000, false); }
  if (m.ep) for (let k = 0; k + 1 < m.ep.length; k += 2) { const i = m.ep[k]; if (i > 0 && i < pack.length) { pack[i] = clamp(m.ep[k + 1] / 100, 0, 1); if (overlay.mode === "pack") markDirty(Math.floor(i / W), i % W); } }
  if (Array.isArray(m.ob) && obj) for (const id of m.ob) obj.complete(String(id));
  if (m.pp) job.pigPushed = true;
  if (m.ct > (job.tiersLost || 0)) job.tiersLost = Math.min(3, m.ct | 0);
  if (Array.isArray(m.jm)) for (const k of m.jm) job.marks.add(String(k));
  if (m.r) for (let k = 0; k + 13 < m.r.length; k += 14) {
    const a = m.r, prop = props[a[k]];
    if (!prop || !prop.active || !prop.body.isDynamic()) continue;
    if (winch.on && winch.kind === 1 && winch.ref === prop.index) continue;      // I'm pulling it: mine wins
    if (prop.owner === net.id && net.id < from) continue;                        // we both claim it: the lower id wins
    prop.owner = from;
    const b = prop.body;
    b.setTranslation({ x: a[k + 1], y: a[k + 2], z: a[k + 3] }, true); b.setRotation({ x: a[k + 4], y: a[k + 5], z: a[k + 6], w: a[k + 7] }, true);
    b.setLinvel({ x: a[k + 8], y: a[k + 9], z: a[k + 10] }, true); b.setAngvel({ x: a[k + 11], y: a[k + 12], z: a[k + 13] }, true);
  }
}

// A prop belongs to whoever is winching it, else the nearest loader within reach, else the host.
function updateOwnership() {
  const t = chassis.translation();
  for (const r of props) {
    if (!r.active || !r.body.isDynamic()) continue;
    if (winch.on && winch.kind === 1 && winch.ref === r.index) { r.owner = net.id; continue; }
    let pulled = 0;
    for (const pr of net.peers.values()) if (pr.h && pr.h[0] === 1 && pr.h[1] === r.index) pulled = pr.id;
    if (pulled) { r.owner = pulled; continue; }
    const p = r.body.translation();
    const dist = (id) => { if (id === net.id) return Math.hypot(p.x - t.x, p.z - t.z); const pr = net.peers.get(id); return pr ? Math.hypot(p.x - pr.pos.x, p.z - pr.pos.z) : 1e9; };
    if (r.owner && dist(r.owner) < 8 + r.r) continue;
    let best = net.hostId, bd = 5.5 + r.r;
    for (const pl of net.roster) { const d = dist(pl.id); if (d < bd) { bd = d; best = pl.id; } }
    r.owner = best;
  }
}

let stepCount = 0;
function sendState() {
  const t = chassis.translation(), q = chassis.rotation(), rk = [], e = [];
  const tick = stepCount / 3;
  for (const r of props) {
    if (!r.active || r.owner !== net.id || !r.body.isDynamic() || (r.body.isSleeping() && (tick + r.index) % 40 !== 0)) continue;
    const p = r.body.translation(), o = r.body.rotation(), v = r.body.linvel(), w = r.body.angvel();
    rk.push(r.index, r3(p.x), r3(p.y), r3(p.z), r3(o.x), r3(o.y), r3(o.z), r3(o.w), r3(v.x), r3(v.y), r3(v.z), r3(w.x), r3(w.y), r3(w.z));
  }
  for (const [i, d] of netEdits) { const mm = Math.round(d * 1000); if (mm) e.push(i, mm); }
  netEdits.clear();
  const eg = [];
  for (const [i, d] of netG) { const mm = Math.round(d * 1000); if (mm) eg.push(i, mm); }
  netG.clear();
  const m = { t: "s", p: [r3(t.x), r3(t.y), r3(t.z)], q: [r3(q.x), r3(q.y), r3(q.z), r3(q.w)], a: r3(me.arm), b: r3(me.tilt), w: r3(me.steer), l: r3(me.load), v: r3(me.speed), k: KIND_ORDER.indexOf(me.kind), bd: r3(me.bed || 0) };
  if (winch.on) m.h = [winch.kind, winch.ref, r3(winch.local.x), r3(winch.local.y), r3(winch.local.z), r3(winch.len), Math.round(winch.T)];
  if (flags) m.fl = flags;
  if (me.headlight) m.hl = me.hl ? 1 : 0;
  if (fireS && fireNet.length) { m.fr = fireNet.splice(0); }
  if (scraped && scrapeNet.length) { m.fs2 = scrapeNet.splice(0); }
  if (lookDirty || stepCount % 60 === 0) { m.lk = lookArr(myLook); lookDirty = false; }     // paint job: when it changes, and every second for newcomers
  if (SITE === "farm") m.nb = activeBoulders;
  if (gravel.length) m.gv = gravel;
  for (const [id, [v, g]] of pendingLoad) if (v > 1e-4) send({ t: "to", to: id, m: { t: "ld", v: r3(v), g: r3(g) } });
  pendingLoad.clear();
  if (hopper && Math.abs(hopperD[0]) > 1e-4) { m.hd = [r3(hopperD[0]), r3(hopperD[1])]; hopperD[0] = hopperD[1] = 0; }
  if (SITE === "flood" && net.hostId === net.id) { m.wl = r3(job.water); m.wh = r3(job.hold); m.fs = [Math.round(job.townVol), r3(job.pasture)]; }
  if (SITE === "flood" && job.gateClose > 0) m.gc = r3(job.gateClose);
  if (rk.length) m.r = rk;
  if (e.length) m.e = e;
  if (eg.length) m.eg = eg;
  if (netP.size) { m.ep = []; for (const i of netP) m.ep.push(i, Math.round(pack[i] * 100)); netP.clear(); }
  if (obj && obj.list().length) m.ob = obj.list();
  if (job.pigPushed) m.pp = 1;
  if (job.tiersLost) m.ct = job.tiersLost;
  if (job.marks.size) m.jm = [...job.marks];
  send(m);
  if (net.hostId === net.id && performance.now() - net.lastSave > 30000) { net.lastSave = performance.now(); send({ t: "save", site: SITE, d: JSON.stringify(buildSync()) }); }
}

// Other players' loaders are moved along the path they report, about a tenth of a second behind.
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _pm = new THREE.Matrix4(), _pp = new THREE.Vector3(), ZERO = { x: 0, y: 0, z: 0 };
function updatePeers() {
  const now = performance.now() - 100;
  for (const peer of net.peers.values()) {
    const s = peer.snaps;
    if (!s.length) continue;
    let a = s[s.length - 1], b = a, k = 0;
    for (let i = s.length - 1; i > 0; i--) if (s[i - 1].at <= now) { a = s[i - 1]; b = s[i]; k = clamp((now - a.at) / Math.max(1, b.at - a.at), 0, 1); break; }
    const ld = peer.loader;
    _qa.set(a.q[0], a.q[1], a.q[2], a.q[3]).slerp(_qb.set(b.q[0], b.q[1], b.q[2], b.q[3]), k);
    const to = { x: lerp(a.p[0], b.p[0], k), y: lerp(a.p[1], b.p[1], k), z: lerp(a.p[2], b.p[2], k) }, rot = { x: _qa.x, y: _qa.y, z: _qa.z, w: _qa.w };
    const at = ld.body.translation();
    if (Math.hypot(to.x - at.x, to.y - at.y, to.z - at.z) > 3) {
      // a jump (first report, or they reset): appear there, don't sweep through everything in between
      ld.body.setTranslation(to, true); ld.body.setRotation(rot, true);
    } else { ld.body.setNextKinematicTranslation(to); ld.body.setNextKinematicRotation(rot); }
    ld.group.visible = true; peer.seen = true;
    ld.arm = lerp(a.a, b.a, k); ld.tilt = lerp(a.b, b.b, k); ld.steer = lerp(a.w, b.w, k); ld.load = b.l; ld.speed = b.v; ld.bed = lerp(a.bd, b.bd, k);
    poseBucket(ld);
    if (ld.kind === "truck" && ld.bed > 0.5 && b.l > 0.05 && Math.random() < 0.6) truckPour(ld, 0, 0, ZERO);
    if (ld.kind === "loader" && b.b < -0.12 && b.l > 0.02) {
      _pm.compose(_pp.set(to.x, to.y, to.z), _qa, _one).multiply(ld.armPivot.matrix).multiply(ld.bucketPivot.matrix);
      pourFrom(_pm, ZERO, 0);
    }
    ld.roll += (ld.speed * DT) / L.wheelR;
  }
}

// ---------- moving between sites ----------
function goSite(site, extra) {
  if (net.online) {
    if (extra !== "clear") send({ t: "save", site: SITE, d: JSON.stringify(buildSync()) });
    send({ t: "site", site });            // the server tells everyone, including us, to move
  } else location.replace(`?site=${site}&solo=1`);
}
function saveProgress() {
  if (net.online) send({ t: "save", site: "progress", d: JSON.stringify(progress) });
  try { localStorage.setItem("jobsite-progress", JSON.stringify(progress)); } catch {}
}
function finishLevel() {
  if (job.ended) return;
  job.ended = true;
  if (SITE === "ridge") measureCutFill();
  const bonus = bonusCount(), stars = starsEarned(), wait = obj ? 11000 : 7000;      // time for the closing pop-ups
  showBanner(`<b>Job complete!</b><span class="stars">${starStr(stars)}</span><br>${TITLES[SITE]} finished in ${clock(job.time)}${obj && !obj.bonusTotal() ? "" : ` with ${bonus} of ${obj ? obj.bonusTotal() : 2} bonus jobs`}.<br>Heading back to the quarry&hellip;`, wait + 1000);
  setTimeout(() => {
    if (net.online && net.hostId !== net.id) return;        // the host moves everyone
    const old = progress[SITE] || {};
    progress[SITE] = { done: true, best: Math.min(old.best || 1e9, Math.round(job.time)), bonus: Math.max(old.bonus || 0, bonus), stars: Math.max(starsOf(old), stars) };
    saveProgress();
    if (net.online) send({ t: "save", site: SITE, d: "" });          // the next visit starts the level fresh
    goSite("hub", "clear");
  }, wait);
}

// ---------- input ----------
const keys = new Set();
const CAM_PITCH = 0.62, CAM_DIST = 19;
const cam = { yaw: 0, offset: 0, pitch: CAM_PITCH, dist: CAM_DIST, drag: false };
let hintsOn = true;
// ---------- paint shop (in the quarry garage) ----------
let customOpen = false, customRow = 0, lookDirty = false;
const elCustom = document.getElementById("custom");
const LOOK_ROWS = [
  { key: "p", label: "Paint", opts: [-1, ...PAINTS.keys()] },
  { key: "s", label: "Stripes", opts: [0, 1, 2] },
  { key: "sc", label: "Stripe colour", opts: [...PAINTS.keys()] },
  { key: "f", label: "Flames", opts: [0, 1, 2, 3] },
  { key: "fc", label: "Flame colours", opts: [...FLAME_SETS.keys()] },
];
const hex = (c) => "#" + c.toString(16).padStart(6, "0");
function optHtml(row, v) {
  if (row.key === "p") return v < 0 ? `<span class="sw crew" style="background:${hex(COLORS[me.slot])}" title="Crew colour">crew</span>` : `<span class="sw" style="background:${hex(PAINTS[v])}" title="${PAINT_NAMES[v]}"></span>`;
  if (row.key === "sc") return `<span class="sw" style="background:${hex(PAINTS[v])}" title="${PAINT_NAMES[v]}"></span>`;
  if (row.key === "fc") { const c = FLAME_SETS[v].c; return `<span class="sw" style="background:linear-gradient(90deg,${c[2]},${c[1]},${c[0]})" title="${FLAME_SETS[v].name}"></span>`; }
  return `<span class="txt">${(row.key === "s" ? STRIPES : FLAMES)[v]}</span>`;
}
function renderCustom() {
  elCustom.innerHTML = `<h2>Paint shop</h2>` + LOOK_ROWS.map((row, r) => `<div class="crow ${r === customRow ? "sel" : ""}"><span class="lab">${row.label}</span>${row.opts
    .map((v) => `<button data-r="${r}" data-v="${v}" class="${myLook[row.key] === v ? "on" : ""}">${optHtml(row, v)}</button>`).join("")}</div>`).join("")
    + `<div class="sub">${pad.on ? `<kbd>D-pad</kbd> choose &nbsp; <kbd>${PB("A")}</kbd> done` : `<kbd>&uarr;</kbd><kbd>&darr;</kbd><kbd>&larr;</kbd><kbd>&rarr;</kbd> or click to choose &nbsp; <kbd>G</kbd> done`}</div>`;
}
function setLook(key, v) {
  myLook = { ...myLook, [key]: v };
  applyLook(me, myLook);
  try { localStorage.setItem("jobsite-look", JSON.stringify(lookArr(myLook))); } catch {}
  lookDirty = true;
  if (net.online) renderRoster();
  renderCustom();
}
function stepLook(dir) {
  const row = LOOK_ROWS[customRow], i = row.opts.indexOf(myLook[row.key]);
  setLook(row.key, row.opts[(i + dir + row.opts.length) % row.opts.length]);
}
function openCustom() {
  if ((switchPad() !== "garage" && !inPaintShop()) || Math.abs(me.speed) > 2) return;
  customOpen = true; elCustom.style.display = "block"; renderCustom();
}
function closeCustom() { customOpen = false; elCustom.style.display = "none"; }
elCustom.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  customRow = +b.dataset.r; setLook(LOOK_ROWS[customRow].key, +b.dataset.v);
});
// ---------- controller ----------
// Standard (Xbox-style) layout. Left stick steers, triggers drive, bumpers move the arms,
// X / B curl and dump, A brakes, Y hooks the winch, D-pad up / down reels, right stick looks around.
const pad = { on: false, prev: [], rx: 0, ry: 0, style: "xbox" };
// Button names for the pad in use. Browsers put a PlayStation pad's buttons in the same places as an Xbox
// pad's (cross where A is, circle where B is...), so only the labels change.
const PAD_NAMES = {
  xbox: { A: "A", B: "B", X: "X", Y: "Y", LB: "LB", RB: "RB", LT: "LT", RT: "RT", View: "View", Menu: "Menu" },
  ps: { A: '<span style="color:#7fb2ff">&#10005;</span>', B: '<span style="color:#ff6a6a">&#9675;</span>', X: '<span style="color:#ff8ad8">&#9633;</span>', Y: '<span style="color:#6fe0a8">&#9651;</span>',
    LB: "L1", RB: "R1", LT: "L2", RT: "R2", View: "Create", Menu: "Options" },
};
const PB = (n) => PAD_NAMES[pad.style][n] ?? n;
const PAD_LABEL = { KeyW: "RT", KeyS: "LT", KeyA: "Left stick", KeyD: "", Space: "A", ArrowUp: "RB", ArrowDown: "LB", ArrowLeft: "X", ArrowRight: "B",
  KeyE: "Y", KeyQ: "D-pad &uarr;", KeyX: "D-pad &darr;", KeyF: "D-pad &rarr;", KeyG: "D-pad &larr;", KeyR: "View", KeyC: "R3", KeyH: "Menu", KeyO: "L3", KeyL: "L3", Enter: "Menu" };
function readPad() {
  const list = navigator.getGamepads ? navigator.getGamepads() : [];
  let gp = null;
  for (const g of list) if (g && g.connected && g.buttons.length >= 16) { gp = g; break; }
  if (!gp) { if (pad.on) { pad.on = false; refreshHelp(); } pad.rx = pad.ry = 0; return null; }
  // 054c is Sony's maker id; some browsers just call a PS4 pad "Wireless Controller" (Xbox pads say "Xbox")
  const style = /054c|dualsense|dualshock|playstation/i.test(gp.id) || (/wireless controller/i.test(gp.id) && !/xbox|045e/i.test(gp.id)) ? "ps" : "xbox";
  if (style !== pad.style) { pad.style = style; const sa = document.getElementById("padA"); if (sa) sa.innerHTML = PB("A"); if (pad.on) refreshHelp(); }
  const dz = (v) => (Math.abs(v) < 0.16 ? 0 : (v - Math.sign(v) * 0.16) / 0.84), b = (i) => (gp.buttons[i] ? gp.buttons[i].value : 0);
  const st = { lx: dz(gp.axes[0] || 0), rx: dz(gp.axes[2] || 0), ry: dz(gp.axes[3] || 0), b };
  const used = Math.abs(st.lx) + Math.abs(st.rx) + Math.abs(st.ry) > 0 || gp.buttons.some((x) => x.pressed);
  if (used && !pad.on) { pad.on = true; refreshHelp(); }
  // buttons that act once per press
  const hit = (i) => b(i) > 0.5 && !(pad.prev[i] > 0.5);
  if (pad.on) {
    if (elStart.style.display !== "none") { if (hit(0)) begin(); }
    else if (customOpen) {
      if (hit(12)) { customRow = (customRow + LOOK_ROWS.length - 1) % LOOK_ROWS.length; renderCustom(); }
      if (hit(13)) { customRow = (customRow + 1) % LOOK_ROWS.length; renderCustom(); }
      if (hit(14)) stepLook(-1);
      if (hit(15)) stepLook(1);
      if (hit(0) || hit(1)) closeCustom();
    } else if (hit(14) && (switchPad() === "garage" || inPaintShop())) openCustom();
    else {
      if (hit(3)) toggleWinch();
      if (hit(15)) switchVehicle();
      if (hit(8)) resetLoader();
      if (hit(11) || hit(14)) { cam.offset = 0; cam.pitch = CAM_PITCH; cam.dist = CAM_DIST; }
      if (hit(9) && !popups.skip()) toggleHints();        // Menu skips a pop-up line if one is showing
      if (hit(10)) { if (me.headlight) { me.hl = !me.hl; me.headlight.visible = me.hl; } else cycleOverlay(); }
    }
  }
  pad.prev = gp.buttons.map((x) => x.value);
  pad.rx = st.rx; pad.ry = st.ry;
  return st;
}
function readKeys() {
  const k = (c) => (keys.has(c) ? 1 : 0);
  input.fwd = k("KeyW") - k("KeyS");
  input.turn = k("KeyA") - k("KeyD");
  input.brake = k("Space");
  input.arm = k("ArrowUp") - k("ArrowDown");
  input.tilt = k("ArrowLeft") - k("ArrowRight");
  input.reel = k("KeyQ") - k("KeyX");
  if (customOpen) { input.fwd = input.turn = input.arm = input.tilt = input.reel = 0; input.brake = 1; return; }    // parked in the paint shop
  const g = padState;
  if (g && pad.on) {
    input.fwd = clamp(input.fwd + g.b(7) - g.b(6), -1, 1);
    input.turn = clamp(input.turn - g.lx, -1, 1);
    input.brake = input.brake || g.b(0) > 0.5 ? 1 : 0;
    input.arm = clamp(input.arm + g.b(5) - g.b(4), -1, 1);
    input.tilt = clamp(input.tilt + g.b(2) - g.b(1), -1, 1);
    input.reel = clamp(input.reel + g.b(12) - g.b(13), -1, 1);
  }
}
let padState = null;
function toggleHints() { hintsOn = !hintsOn; elHint.style.display = hintsOn && elHint.innerHTML ? "block" : "none"; }
addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT") return;
  if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
  if (customOpen) {
    if (e.code === "ArrowUp") { customRow = (customRow + LOOK_ROWS.length - 1) % LOOK_ROWS.length; renderCustom(); }
    else if (e.code === "ArrowDown") { customRow = (customRow + 1) % LOOK_ROWS.length; renderCustom(); }
    else if (e.code === "ArrowLeft") stepLook(-1);
    else if (e.code === "ArrowRight") stepLook(1);
    else if (["KeyG", "Enter", "Escape"].includes(e.code) && !e.repeat) closeCustom();
    if (pad.on) { pad.on = false; refreshHelp(); renderCustom(); }
    return;
  }
  if (e.repeat) return;
  keys.add(e.code);
  if (e.code === "KeyR") resetLoader();
  if (e.code === "KeyC") { cam.offset = 0; cam.pitch = CAM_PITCH; cam.dist = CAM_DIST; }
  if (e.code === "KeyE" && running) toggleWinch();
  if (e.code === "KeyF" && running) switchVehicle();
  if (e.code === "KeyG" && running) openCustom();
  if (e.code === "KeyP") {
    testUnlock = !testUnlock;
    try { localStorage.setItem("jobsite-unlock", testUnlock ? "1" : "0"); } catch {}
    refreshSigns();
    showBanner(testUnlock ? "<b>Test mode: everything unlocked</b>All levels and vehicles. Press P again to lock them." : "<b>Test mode off</b>Levels and vehicles follow your real progress again.", 3500);
  }
  if (e.code === "KeyH") toggleHints();
  if (e.code === "KeyO") cycleOverlay();
  if (e.code === "KeyL" && me.headlight) { me.hl = !me.hl; me.headlight.visible = me.hl; }
  if (e.code === "Enter") popups.skip();
  if (pad.on) { pad.on = false; refreshHelp(); }          // back on the keyboard: show keyboard keys again
});
addEventListener("keyup", (e) => keys.delete(e.code));
addEventListener("blur", () => keys.clear());
renderer.domElement.addEventListener("pointerdown", (e) => { cam.drag = true; renderer.domElement.setPointerCapture(e.pointerId); });
renderer.domElement.addEventListener("pointerup", () => { cam.drag = false; });
renderer.domElement.addEventListener("pointermove", (e) => {
  if (!cam.drag) return;
  cam.offset -= e.movementX * 0.006;
  cam.pitch = clamp(cam.pitch + e.movementY * 0.004, 0.08, 1.25);
});
renderer.domElement.addEventListener("wheel", (e) => { cam.dist = clamp(cam.dist * (e.deltaY > 0 ? 1.1 : 0.9), 7, 45); }, { passive: true });

// ---------- HUD ----------
const elFill = document.getElementById("fill"), elFillBar = document.getElementById("fillbar"), elFillText = document.getElementById("filltext");
const elTasks = document.getElementById("tasks"), elGauges = document.getElementById("gauges"), elBanner = document.getElementById("banner");
const elHint = document.getElementById("hint"), elPrompt = document.getElementById("prompt");
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
let bannerTimer = 0;
function showBanner(html, ms) { elBanner.innerHTML = html; elBanner.style.display = "block"; clearTimeout(bannerTimer); bannerTimer = setTimeout(() => { elBanner.style.display = "none"; }, ms); }
elTasks.addEventListener("click", (e) => { if (e.target.id === "leave") goSite("hub"); });
const row = (ok, text, cls = "") => `<div class="${cls} ${ok ? "done" : ""}">${ok ? "&#10003;" : "&#9675;"} ${text}</div>`;
const KEY_CODE = { W: "KeyW", A: "KeyA", S: "KeyS", D: "KeyD", E: "KeyE", Q: "KeyQ", X: "KeyX", F: "KeyF", G: "KeyG", R: "KeyR", H: "KeyH", C: "KeyC", O: "KeyO", L: "KeyL", Enter: "Enter", Space: "Space",
  "&uarr;": "ArrowUp", "&darr;": "ArrowDown", "&larr;": "ArrowLeft", "&rarr;": "ArrowRight" };
const K = (k) => { const t = pad.on && KEY_CODE[k] ? PB(PAD_LABEL[KEY_CODE[k]]) : k; return t ? `<kbd>${t}</kbd>` : ""; };
const elHelp = document.getElementById("help"), HELP_KEYS = elHelp.innerHTML;
function refreshHelp() {
  elHelp.innerHTML = !pad.on ? HELP_KEYS : `<b>Controller</b><br>
    <kbd>Left stick</kbd> steer &nbsp; <kbd>${PB("RT")}</kbd> drive &nbsp; <kbd>${PB("LT")}</kbd> reverse &nbsp; <kbd>${PB("A")}</kbd> brake<br>
    <kbd>${PB("RB")}</kbd><kbd>${PB("LB")}</kbd> raise / lower arms &nbsp; <kbd>${PB("X")}</kbd><kbd>${PB("B")}</kbd> curl / dump<br>
    <kbd>${PB("Y")}</kbd> winch hook / unhook &nbsp; <kbd>D-pad &uarr;</kbd><kbd>&darr;</kbd> reel in / out<br>
    <kbd>D-pad &rarr;</kbd> switch vehicle &nbsp; <kbd>D-pad &larr;</kbd> paint shop (garage or pink shop)<br>
    <kbd>${PB("View")}</kbd> reset &nbsp; <kbd>${PB("Menu")}</kbd> hints / skip line &nbsp; <kbd>L3</kbd> ${SITE === "night" ? "headlights" : "overlay"}<br>
<kbd>Right stick</kbd> look &nbsp; <kbd>R3</kbd> recenter`;
  if (customOpen) renderCustom();
  popups.setSkipLabel(`${K("Enter")} skip`);
  if (overlay.mode) renderLegend();
  elHint.dataset.h = ""; elPrompt.dataset.h = "\u0000";       // redraw hint and prompt with the right labels
}
// O / L3 cycles the ground overlays: grade (where the level has a target surface), packing, off
const elLegend = document.getElementById("legend");
function renderLegend() {
  elLegend.style.display = overlay.mode ? "block" : "none";
  if (overlay.mode === "grade") elLegend.innerHTML = `<b>Grade</b> against ${GRADE.what}: <i style="background:#e0453a"></i>too high <i style="background:#4fd16a"></i>within ${Math.round(GRADE.tol * 100)} cm <i style="background:#3a7be0"></i>too low &nbsp; ${K("O")} next`;
  else if (overlay.mode === "pack") elLegend.innerHTML = `<b>Packing</b>: <i style="background:#f09a3e"></i>loose <i style="background:#2fb5a8"></i>packed (roll it with the road roller) &nbsp; ${K("O")} off`;
}
function cycleOverlay() {
  if (SITE === "treasure") { job.ruler = !job.ruler; return; }
  const modes = ["", ...(GRADE ? ["grade"] : []), "pack"];
  overlay.mode = modes[(modes.indexOf(overlay.mode) + 1) % modes.length];
  for (const c of chunks) buildMesh(c);
  renderLegend();
}
popups.setSkipLabel(`${K("Enter")} skip`);
function setHint(html) {
  if (elHint.dataset.h === html) return;
  elHint.dataset.h = html; elHint.innerHTML = html ? `<span>&#128161;</span> ${html}` : "";
  elHint.style.display = hintsOn && html ? "block" : "none";
}
// P unlocks every level and vehicle for play-testing (kept in this browser only; your real progress is untouched)
let testUnlock = false;
try { testUnlock = localStorage.getItem("jobsite-unlock") === "1"; } catch {}
const isLocked = (hs) => !testUnlock && (!!hs.locked || (!!hs.needs && !(progress[hs.needs] && progress[hs.needs].done)));
function refreshSigns() {
  for (const hs of houses) {
    const p = progress[hs.id];
    if (hs.garage) hs.b.sign.userData.draw(hs.title, "Switch vehicles here", "#c9a6ff");
    else if (hs.paint) hs.b.sign.userData.draw(hs.title, "Drive in to customize", "#ff9cc4");
    else if (isLocked(hs)) hs.b.sign.userData.draw(hs.title, hs.needs ? `Finish level ${LEVEL_NUM[hs.needs]} first` : "Locked", "#aab3be");
    else hs.b.sign.userData.draw(hs.title, p && p.done ? `${starStr(starsOf(p))}  Best ${clock(p.best)}` : "Drive in to start", p && p.done ? "#8be28b" : "#ffc928");
  }
}
refreshSigns();

// ---------- per-site rules ----------
const enter = { house: null, t: 0 };
function hubStep() {
  const t = chassis.translation();
  const hs = houses.find((h) => h.b.inside(t.x, t.z)) || null;
  if (hs !== enter.house) { enter.house = hs; enter.t = 0; if (!hs) elBanner.style.display = "none"; }
  if (!hs) return;
  if (hs.garage) return;
  if (hs.paint) {                                                    // stop inside and the paint shop opens by itself
    if (Math.abs(me.speed) > 0.8) { enter.t = 0; return; }
    if (enter.t === 0 && !customOpen) openCustom();
    enter.t = 1; return;
  }
  if (isLocked(hs)) { if (enter.t === 0) showBanner(`<b>${hs.title}</b>Finish the earlier jobs to unlock this one.`, 2500); enter.t = 1; return; }
  if (Math.abs(me.speed) > 0.8) { if (enter.t > 0) showBanner(`<b>${hs.title}</b>Stop inside to start.`, 1500); enter.t = 0; return; }
  const before = Math.ceil(2 - enter.t);
  enter.t += DT;
  const left = Math.ceil(2 - enter.t);
  if (left !== before || enter.t <= DT * 1.5) showBanner(`<b>${hs.title}</b>${left > 0 ? `Starting in ${left}&hellip; (drive out to cancel)` : "Let's go!"}`, 3000);
  if (enter.t >= 2 && enter.t - DT < 2) goSite(hs.id);
}
function hookedByAnyone(p) {
  if (winch.on && winch.kind === 1 && winch.ref === p.index) return true;
  for (const pr of net.peers.values()) if (pr.h && pr.h[0] === 1 && pr.h[1] === p.index) return true;
  return false;
}
function farmStep() {
  const F = FARM, t = chassis.translation();
  // a log left on the woodpile (nobody winching it, nearly still) is stacked
  for (const l of logs) {
    if (!l.active || !mineP(l) || hookedByAnyone(l)) continue;
    const p = l.body.translation(), v = l.body.linvel();
    l.stackT = Math.hypot(p.x - F.pile.x, p.z - F.pile.z) < F.pile.r && Math.hypot(v.x, v.z) < 0.6 ? (l.stackT || 0) + DT : 0;
    if (l.stackT > 0.8) markCrushed(l.index);
  }
  if (barnDoor.userData.open) barnDoor.position.x = lerp(barnDoor.position.x, FARM.barn.door + 0.2, 0.03);
  if (!job.moved && Math.hypot(t.x - FARM.spawn.x, t.z - FARM.spawn.z) > 8) job.moved = true;
  const mud = mudAt(t.x, t.z);
  job.stuck = mud > 0.3 && input.fwd !== 0 && Math.abs(me.speed) < 0.8 && !winch.on ? job.stuck + DT : Math.max(0, job.stuck - DT * 0.3);
  if (job.stuck > 1.5 && !job.pigPushed) job.pigPushed = true;          // pigPushed now means "got stuck in the mud" (costs the third star)
  if (!job.ended) job.time += DT;
}
function openBarn() {
  if (!barnDoor || barnDoor.userData.open) return;
  world.removeCollider(barnDoor.userData.collider, false); barnDoor.userData.open = true; barnBeam.visible = true;
  barn.sign.userData.draw("Barn", "Open: winch up the hill!", "#8be28b");
  if (barnRoller) barnRoller.group.visible = true;
}
// what each finished farm job changes in the world (also when it arrives from a saved game)
function farmEffect(id) {
  const F = FARM, Pn = F.pen, show = (mk, on) => { if (mk) mk.ring.visible = mk.beam.visible = on; };
  if (id === "pig") {
    show(penMarker, false); show(spotMarker, true); if (!penGate) penGate = fenceLine(Pn.x0, Pn.gate0, Pn.x0, Pn.gate1, 0.1);
    const px = Pn.x1 - 3, pz = Pn.z0 + 3; pig.body.setTranslation({ x: px, y: heightAt(px, pz) + 0.62, z: pz }, true);      // Dinston has walked her home
  }
  if (id === "tractor") { show(spotMarker, false); show(gateMarker, true); }
  if (id === "gate") { show(gateMarker, false); show(sinkMarker, true); }
  if (id === "sink") { show(sinkMarker, false); show(pileMarker, true); }
  if (id === "logs") { show(pileMarker, false); openBarn(); }
}
function checkFarm() {
  const F = FARM, hd = (p, o) => { const t = p.body.translation(); return Math.hypot(t.x - o.x, t.z - o.z); };
  const stacked = logs.filter((l) => !l.active).length;
  if (stacked > job.logsIn) {                                           // a new log on the pile: add it to the stack
    for (let k = job.logsIn; k < stacked; k++) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 5, 8).rotateZ(Math.PI / 2), barkMat);
      m.position.set(0, 0.33 + (k === 2 ? 0.6 : 0), -0.85 + (k === 2 ? 0.35 : k * 0.7) + 1.4); m.castShadow = true; woodStack.add(m);
    }
    if (running) sfx.thunk();
    job.logsIn = stacked;
  }
  job.fill = clamp(1 - sinkDeficit() / SINK_START, 0, 1);
  obj.update();
  elTasks.innerHTML = `<h2>Muddle Acres</h2>${obj.render()}${starsHtml(obj.mainDone())}
    <div class="sub">Time ${clock(job.time)}</div>
    <button id="leave">Back to the quarry</button>`;
  setHint(farmHint());
}
function farmHint() {
  const F = FARM, t = chassis.translation(), cur = obj.current(), id = cur && cur.id;
  if (!job.moved) return `Welcome to Muddle Acres! Drive with ${K("W")}${K("A")}${K("S")}${K("D")} and drag the mouse to look around. Follow the muddy hoofprints.`;
  if (job.stuck > 1.5 && id !== "barn") return `Stuck in the mud? Turn your back to a tree (or a friend), press ${K("E")} to hook your winch, then hold ${K("Q")} to pull yourself out.`;
  const hooked = (p) => p && winch.on && winch.kind === 1 && winch.ref === p.index;
  if (id === "pig") return `Clementine got out! Follow her muddy hoofprints from the <b style="color:#ff9cc4">pig pen</b> and drive up to her.`;
  if (id === "tractor") {
    if (hooked(tractor)) return `Hooked! Hold ${K("Q")} to reel it in, or drive slowly away. Leave it on the <b class="g">green ring</b>, then ${K("E")} to unhook.`;
    if (target && target.ref === (tractor && tractor.index) && target.kind === 1) return `Press ${K("E")} to hook your winch to the tractor.`;
    return `Dinston's tractor is stuck in the mud up the lane. Don't drive into the mud: stop on firm ground, turn your <b>back</b> to the tractor (the winch is at the rear) and hook it with ${K("E")}.`;
  }
  if (id === "gate") return `A boulder is blocking the paddock gate (orange ring, west of the sinkhole). Lower the bucket ${K("&darr;")} a little and drive into it to push it out of the ring.`;
  if (id === "sink") return me.load > 0.5
    ? `Drive to the <b class="b">sinkhole</b> by the well, raise the bucket ${K("&uarr;")} and tip it ${K("&rarr;")} over the hole.`
    : `Fill the sinkhole by the well. Get dirt from the <b>spoil heap</b> in the paddock: lower the bucket ${K("&darr;")}, drive in, then lift it ${K("&uarr;")}.`;
  if (id === "logs") {
    const hk = logs.find((l) => hooked(l));
    if (hk) return `Drag it onto the <b class="g">woodpile</b> (green ring) and unhook with ${K("E")}. It stacks itself.`;
    return `Three trees fell across the barn lane. Hook each one with your winch ${K("E")} and drag it to the <b class="g">woodpile</b>.`;
  }
  if (id === "barn") {
    const onTop = t.y > heightAt(F.hill.x, F.hill.z) - 1.5 && Math.hypot(t.x - F.hill.x, t.z - F.hill.z) < F.hill.top + 2;
    if (onTop) return `Made it! Unhook with ${K("E")} and drive into the barn.`;
    if (winch.on && winch.kind === 2 && anchors[winch.ref].name === "post inside the barn") return `Hold ${K("Q")} to winch yourself up. Keep the bucket raised so it doesn't dig into the slope.`;
    return `The barn doors are open! The hill is too steep to drive. Back up to the slope, hook the <b>post inside the barn</b> with ${K("E")} and hold ${K("Q")} to reel yourself up.`;
  }
  return "";
}
// ----- Rapid River rules -----
const safe = { x: RIVER.spawn.x, z: RIVER.spawn.z, yaw: 0, wet: 0 };
const smash = { i: -1, t: 0 };
const mineP = (p) => !net.online || p.owner === net.id || p.owner === 0;
// ----- moving water wears away loose dirt (Rapid River now; Flood Season later) -----
// Run by the host's game a few times a second over a limited patch of river; what it removes reaches the
// other players as ordinary ground edits. Undisturbed ground never erodes, only dirt dumped on top of it.
// The face the current hits wears fastest; boulders just upstream shelter what is behind them (riprap);
// rolled, packed dirt barely wears at all. Returns the m³ removed.
// o.axis "x" (default): the current runs along x in direction o.dir; "z": it pushes along z (against a levee).
function erodeStep(o) {
  const E = CFG.EROSION, step = E.tick * DT * (o.mul || 1), dir = o.dir || 1, alongZ = o.axis === "z", up = alongZ ? 2 * dir : 2 * W * dir;
  const xi0 = Math.max(3, Math.round((o.x0 + HALF) / CELL)), xi1 = Math.min(G - 3, Math.round((o.x1 + HALF) / CELL));
  const zi0 = Math.max(1, Math.round((o.z0 + HALF) / CELL)), zi1 = Math.min(G - 1, Math.round((o.z1 + HALF) / CELL));
  const shelters = [];
  for (const b of o.rocks) { if (!b.active) continue; const p = b.body.translation(); if (p.y < o.water + 0.6) shelters.push(p.x, p.z, b.r); }
  let lost = 0;
  for (let xi = xi0; xi <= xi1; xi++) for (let zi = zi0; zi <= zi1; zi++) {
    const i = zi + xi * W, h = heights[i];
    if (h > o.water + E.wetAbove) continue;
    const soft = h - firm[i];
    if (soft < 0.005) continue;
    const face = h - heights[i - up];
    let rate = (E.top + (face > 0.08 ? E.face * Math.min(1, face / 0.5) : 0)) * (1 - pack[i]) ** 2;
    if (rate <= 0) continue;
    const x = xi * CELL - HALF, z = zi * CELL - HALF;
    for (let k = 0; k < shelters.length; k += 3) {
      const ahead = alongZ ? (z - shelters[k + 1]) * dir : (x - shelters[k]) * dir, side = alongZ ? Math.abs(x - shelters[k]) : Math.abs(z - shelters[k + 1]);
      if (ahead > 0 && ahead < E.reach && side < shelters[k + 2] + E.halfWidth) { rate *= E.shelter; break; }
    }
    const d = Math.min(soft, rate * step);
    if (d > 1e-5) {
      addHeight(xi, zi, -d); lost += d;
      if (d > 0.002 && Math.random() < 0.05) spawnDirt(x, h + 0.1, z, (alongZ ? 0 : dir) * 1.5, 0.6, (alongZ ? dir : 0) * 1.5, 0, 0);    // a muddy splash: you can see it go
    }
  }
  return lost * CELL * CELL;
}
const RIVER_PATH = [[15, 62], [4, 50], [1, 30], [0, 5], [0, -20], [2, -62]];
function riverEffect(id) {
  const show = (mk, on) => { if (mk) mk.ring.visible = mk.beam.visible = on; };
  if (id === "riprap") show(ripMarker, false);
  if (id === "causeway") show(fordMarker, false);
}
function knockTier() {
  if (job.tiersLost >= 3) return;
  job.tiersLost++;
  sfx.thunk();
  showBanner(`<b>Splat!</b>A cake tier fell off. ${3 - job.tiersLost} left: tow it gently and avoid bumps.`, 3000);
}
function riverRules() {
  const R = RIVER;
  // erosion: the host's game wears the river's loose dirt
  if ((!net.online || net.hostId === net.id) && stepCount % CFG.EROSION.tick === 0) {
    const m3 = erodeStep({ x0: -40, x1: 40, z0: R.mid - 11, z1: R.mid + 11, water: R.water, rocks: riprapRocks, dir: 1, mul: CFG.LEVELS.river.erosion });
    job.erosion = lerp(job.erosion || 0, (m3 * 60) / (CFG.EROSION.tick * DT), 0.3);       // m³ per minute, smoothed
  }
  // the wedding cake: a hard jolt knocks a tier off (whoever is towing it decides)
  if (crate && mineP(crate)) {
    // compare with the speed 5 steps ago, so skid chatter cancels out and only real knocks and drops count
    const vy = crate.body.linvel().y, hist = (crate.vyh = crate.vyh || []);
    hist.push(vy); if (hist.length > 6) hist.shift();
    const dv = crate.vy === undefined || hist.length < 6 ? 0 : Math.abs(vy - hist[0]);
    crate.vy = vy; crate.cool = Math.max(0, (crate.cool || 0) - DT);
    if (dv > CFG.LEVELS.river.cakeBump && crate.cool <= 0 && !obj.has("cake")) { crate.cool = 1.5; knockTier(); }
  }
  // the current: arrows drifting downstream
  if (R.arrows) {
    const a = R.arrows, m = _m; a.userData.t += DT;
    for (let k = 0; k < 24; k++) {
      const x = ((k * 23.7 + a.userData.t * 1.6) % 90) - 45, z = R.mid - 5 + (k % 4) * 3.2;
      a.setMatrixAt(k, m.makeTranslation(x, R.water + 0.06, z));
    }
    a.instanceMatrix.needsUpdate = true;
  }
  // the end: guests cheer and the couple drive home across your causeway (a scripted moment)
  if (job.party != null) {
    job.party += DT;
    guests.forEach((p, k) => { p.position.y = p.userData.y0 + Math.abs(Math.sin(job.party * 7 + k)) * 0.35; });
    if (partyCar && job.party > 3) {
      let d = (job.party - 3) * 6, i = 0;
      while (i < RIVER_PATH.length - 2 && d > Math.hypot(RIVER_PATH[i + 1][0] - RIVER_PATH[i][0], RIVER_PATH[i + 1][1] - RIVER_PATH[i][1])) {
        d -= Math.hypot(RIVER_PATH[i + 1][0] - RIVER_PATH[i][0], RIVER_PATH[i + 1][1] - RIVER_PATH[i][1]); i++;
      }
      const [ax, az] = RIVER_PATH[i], [bx, bz] = RIVER_PATH[i + 1], l = Math.hypot(bx - ax, bz - az), t = Math.min(1, d / l);
      const x = lerp(ax, bx, t), z = lerp(az, bz, t);
      partyCar.position.set(x, Math.max(heightAt(x, z), R.water), z); partyCar.rotation.y = Math.atan2(bx - ax, bz - az);
    }
  }
}
function riverStep() {
  const R = RIVER, t = chassis.translation(), ground = heightAt(t.x, t.z), inBand = Math.abs(t.z - R.mid) < 11;
  // water deeper than the axles sweeps a loader back to the bank it left
  if (inBand && ground < R.water - 0.3 && t.y < ground + 2.4) {
    chassis.applyImpulse({ x: 9000 * DT, y: 0, z: 0 }, true);
    if ((safe.wet += DT) > 1.1) { hookOff(); placeLoader(safe.x, safe.z, safe.yaw); safe.wet = 0; showBanner("<b>Swept away!</b>The water is too deep. Fill the shallows with dirt to make a causeway.", 5000); }
  } else {
    safe.wet = Math.max(0, safe.wet - DT);
    if (stepCount % 30 === 0 && ground > 0 && !inBand && mudAt(t.x, t.z) < 0.5) { safe.x = t.x; safe.z = t.z; safe.yaw = heading(); }
  }
  // smashing: hold the bucket down on a rock to crush it into gravel
  let hit = -1;
  if (input.arm < 0 && me.tilt > -0.3) {
    for (const k of riverRocks) {
      if (!k.active || !mineP(k)) continue;
      const p = k.body.translation();
      _rp.set(p.x, p.y, p.z).applyMatrix4(_bi);
      if (Math.abs(_rp.x) < 1.5 && _rp.z > -0.4 && _rp.z < 1.7 && _rp.y < 0.1 && _rp.y > -(k.r * 1.6 + 0.5)) { hit = k.index; break; }
    }
  }
  if (hit >= 0 && hit === smash.i) {
    if ((smash.t += DT) > 0.4) { const k = props[hit], p = k.body.translation(); layGravel(hit, p.x, p.z, k.r); smash.t = 0; smash.i = -1; }
  } else { smash.i = hit; smash.t = 0; }
  if (stepCount % 20 === 0) {
    for (const p of props) {                       // a crate that falls in deep water washes back to where it started
      if (!p.active || p.type !== "crate" || !mineP(p)) continue;
      const q = p.body.translation();
      p.wet = Math.abs(q.z - R.mid) < 11 && q.y < R.water - 0.6 ? (p.wet || 0) + 1 : 0;
      if (p.wet > 6) {
        p.wet = 0; if (winch.on && winch.kind === 1 && winch.ref === p.index) hookOff();
        p.body.setTranslation({ x: p.x, y: heightAt(p.x, p.z) + 1.2, z: p.z }, true); p.body.setLinvel({ x: 0, y: 0, z: 0 }, true); p.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        p.vy = undefined; p.vyh = []; p.cool = 2;
        showBanner(`<b>The ${p.name} washed away</b>It has been put back where it started.`, 4000);
      }
    }
  }
  riverRules();
  if (!job.moved && Math.hypot(t.x - R.spawn.x, t.z - R.spawn.z) > 8) job.moved = true;
  if (!job.ended) job.time += DT;
}
// how much of a belt (z0..z1) can be crossed: for each row, is there a strip 3.5 m wide that passes ok()?
function crossable(z0, z1, xr, ok, need = 7) {
  let rows = 0, good = 0;
  for (let z = z0; z <= z1; z += 1) {
    rows++;
    let run = 0, pass = false;
    for (let x = -xr; x <= xr && !pass; x += 0.5) { run = ok(x, z) ? run + 1 : 0; if (run >= need) pass = true; }
    if (pass) good++;
  }
  return good / rows;
}
function checkRiver() {
  const R = RIVER;
  job.fill = crossable(R.mid - 6, R.mid + 6, 22, (x, z) => heightAt(x, z) > R.water + 0.1);
  job.road = crossable(R.swamp.z0, R.swamp.z1, 60, (x, z) => mudAt(x, z) < 0.35);
  // riprap: boulders lying in the water just upstream of the ford
  job.rip = riprapRocks.filter((b) => {
    if (!b.active) return false;
    const p = b.body.translation();
    return p.x > R.riprap.x0 && p.x < R.riprap.x1 && Math.abs(p.z - R.mid) < riverAt(p.x).half + 1 && p.y < R.water + 0.5;
  }).length;
  // how much of the causeway's dry top is packed
  let cells = 0, firmCells = 0;
  for (let x = -10; x <= 10; x += CELL) for (let z = R.mid - 6; z <= R.mid + 6; z += CELL) {
    const i = Math.round((z + HALF) / CELL) + Math.round((x + HALF) / CELL) * W;
    if (heights[i] > R.water + 0.1 && heights[i] - base[i] > 0.3) { cells++; if (pack[i] >= 0.7) firmCells++; }
  }
  job.packed = cells > 20 ? firmCells / cells : 0;
  for (let k = 0; k < 3; k++) crate.tiers[k].visible = k < 3 - job.tiersLost;
  obj.update();
  weddingMarker.beam.visible = obj.has("gravel") && !obj.has("cake");
  const crushed = riverRocks.filter((k) => !k.active).length;
  const er = job.erosion || 0;
  elTasks.innerHTML = `<h2>Rapid River</h2>${obj.render()}
    <div class="meter"><div class="sub">Causeway: ${Math.round(job.packed * 100)}% packed &middot; ${er > 0.05 ? `<span class="hot">washing away ${er.toFixed(1)} m&sup3;/min</span>` : '<span class="ok">holding</span>'}</div></div>
    ${starsHtml(obj.mainDone())}
    <div class="sub">Time ${clock(job.time)}</div>
    <button id="leave">Back to the quarry</button>`;
  const t = chassis.translation(), far = t.z > R.mid + 7, cp = crate.body.translation(), cur = obj.current(), id = cur && cur.id;
  const nearRock = riverRocks.some((k) => { if (!k.active) return false; const p = k.body.translation(); return Math.hypot(p.x - t.x, p.z - t.z) < 8; });
  const hooked = (p) => p && winch.on && winch.kind === 1 && winch.ref === p.index;
  let h = "";
  if (!job.moved) h = "The bridge washed out and the wedding is on the far bank. Drive north to the river and take a look.";
  else if (!obj.has("riprap") && (!obj.has("causeway") || er > 0.3)) h = riprapRocks.some(hooked)
    ? `Drag it into the water at the <b class="o">orange ring</b>, just upstream (west) of the ford, and unhook with ${K("E")}.`
    : `The current washes loose dirt away. Put boulders in the river just upstream of the ford first (the <b class="o">orange ring</b>): push the ones on the bank, winch the three in the wood to the west. ${job.rip} / ${R.riprap.need}`;
  else if (!obj.has("causeway")) h = me.load > 0.5
    ? `Tip the dirt ${K("&rarr;")} into the shallows behind your boulders. Keep going until a strip of dry ground reaches the far bank.`
    : `Build a causeway: fill your bucket at the <b>dirt bank</b> west of the road (lower the bucket ${K("&darr;")} and drive in) and dump it in the shallows by the ford. Deep water sweeps you away.`;
  else if (id === "pack" || (!obj.has("pack") && !far && me.kind === "roller")) h = me.kind === "roller"
    ? `Drive back and forth over the causeway. Each pass packs it harder; packed dirt doesn't wash away. ${K("O")} shows packing.`
    : `Loose dirt keeps washing away. Pack the causeway with the <b>road roller</b>: ${K("F")} at the purple vehicle yard by the start.`;
  else if (!obj.has("gravel")) {
    if (!far) h = "The causeway holds! Drive across.";
    else if (me.kind === "roller") h = `Roll over the rocks to crush them into heaps of gravel. Then switch back to the loader (${K("F")} at the vehicle yard) to spread it over the mud.`;
    else if (nearRock) h = me.loadG > 0.5
      ? `Tip the gravel ${K("&rarr;")} onto the dark mud. A layer of gravel makes it firm enough to drive on: build a strip right across.`
      : `Crush a rock: raise the bucket ${K("&uarr;")}, hang it over the rock and hold ${K("&darr;")}. It leaves a heap of grey gravel to scoop and spread.`;
    else h = me.loadG > 0.5 ? `Tip the gravel ${K("&rarr;")} onto the dark mud to make a firm strip across it.`
      : "The mud flat ahead is too boggy to cross. Crush the grey rocks on this bank into gravel, then spread it over the mud.";
  } else if (!obj.has("cake")) {
    if (hooked(crate)) h = `Tow it slowly to the wedding (pink ring). Big bumps knock tiers off! Keep off rough ground.`;
    else if (cp.z < R.mid) h = `Fetch the wedding cake from the riverbank by the road: turn your back to it, hook it with ${K("E")} and tow it gently across your causeway.`;
    else h = `Nearly there: get the cake to the wedding (pink ring) on the far side of the mud flat.`;
  }
  setHint(h);
}
// ----- Ridge Road rules -----
function ridgeStep() {
  const R = RIDGE, t = chassis.translation();
  // holding the bucket down on a rock crushes it into gravel here too
  let hit = -1;
  if (me.kind === "loader" && input.arm < 0 && me.tilt > -0.3) {
    for (const k of ridgeRocks) {
      if (!k.active || !mineP(k)) continue;
      const p = k.body.translation();
      _rp.set(p.x, p.y, p.z).applyMatrix4(_bi);
      if (Math.abs(_rp.x) < 1.5 && _rp.z > -0.4 && _rp.z < 1.7 && _rp.y < 0.1 && _rp.y > -(k.r * 1.6 + 0.5)) { hit = k.index; break; }
    }
  }
  if (hit >= 0 && hit === smash.i) {
    if ((smash.t += DT) > 0.4) { const k = props[hit], p = k.body.translation(); layGravel(hit, p.x, p.z, k.r); smash.t = 0; smash.i = -1; }
  } else { smash.i = hit; smash.t = 0; }
  // the cabin leaning sideways (a road too narrow or too lumpy): costs the third star
  if (cabin && mineP(cabin) && !job.marks.has("tipped")) {
    const q = cabin.body.rotation(), cp = cabin.body.translation(), roll = Math.asin(clamp(2 * (q.x * q.y + q.w * q.z), -1, 1)) * 57.3;
    job.tilt = cp.z < R.stage.z0 && Math.abs(roll) > R.tipLimit ? (job.tilt || 0) + DT : 0;
    if (job.tilt > 0.3) { job.marks.add("tipped"); showBanner("<b>Careful!</b>The cabin tipped. A wide, flat road keeps it level.", 3500); }
  }
  if (job.party != null) ridgeSunset();
  if (!job.moved && Math.hypot(t.x - R.spawn.x, t.z - R.spawn.z) > 8) job.moved = true;
  if (!job.ended) job.time += DT;
}
// the ending: the sky turns to sunset and the Hollises (Jinston and Winston) wave from the porch (scripted, nothing reacts)
const sunsetSky = new THREE.Color(0xf2a65a), sunsetSun = new THREE.Color(0xffb36b);
let porch = null;
function ridgeSunset() {
  job.party += DT;
  const k = Math.min(1, job.party / 8);
  scene.background.lerp(sunsetSky, 0.01); scene.fog.color.copy(scene.background); sun.color.lerp(sunsetSun, 0.01);
  if (!porch) {
    const c = cabin.body.translation();
    porch = [0, 1].map((n) => {
      const g = new THREE.Group(); g.position.set(c.x - 1 + n * 1.2, heightAt(c.x, c.z + 2.6), c.z + 2.6); scene.add(g);
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.32, 1.1, 8), lam(n ? 0x8a5a3a : 0x6b8f4a)); b.position.y = 0.55; g.add(b);
      const h = new THREE.Mesh(new THREE.SphereGeometry(0.21, 10, 8), lam(n ? 0xd9a57e : 0xe8bc98)); h.position.y = 1.3; g.add(h);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.6, 0.1), lam(n ? 0xd9a57e : 0xe8bc98)); arm.position.set(0.32, 1.25, 0); arm.geometry.translate(0, 0.3, 0); g.add(arm);
      g.userData.arm = arm; return g;
    });
  }
  porch.forEach((g, n) => { g.userData.arm.rotation.z = -0.4 - Math.sin(job.party * 6 + n) * 0.5 * k; });
}
function checkRidge() {
  const R = RIDGE, at = (p, o) => { const t = p.body.translation(); return Math.hypot(t.x - o.x, t.z - o.z) < o.r && t.y > R.top - 1; };
  const low = (x, z) => heightAt(x, z) < ridgeRoad(z) + 0.45;                    // 5 m wide (10 cells): room for the cabin
  job.fill = Math.min(crossable(R.slide.z - R.slide.len + 1, R.slide.z + R.slide.len - 1, 6, low, 10), crossable(R.bank.z0 - 1, R.bank.z1 + 1, 6, low, 10));
  job.road = crossable(R.gully.z0, R.gully.z1, 6, (x, z) => Math.abs(heightAt(x, z) - ridgeRoad(z)) < 0.55, 10);
  measureCutFill();
  obj.update();
  const cp = cabin.body.translation();
  const cleared = obj.has("slide"), filled = obj.has("gully"), staged = obj.has("stage");
  padMarker.beam.visible = staged;
  elTasks.innerHTML = `<h2>Ridge Road</h2>${obj.render()}${starsHtml(obj.mainDone())}
    <div class="sub">Time ${clock(job.time)} &nbsp; ${K("O")} grade overlay</div>
    <button id="leave">Back to the quarry</button>`;
  const t = chassis.translation(), onTop = t.y > R.top - 1.2 && t.z > R.pitch.z1 - 1, towing = winch.on && winch.kind === 1 && winch.ref === cabin.index;
  let h = "";
  if (!job.moved) h = "The cabin has to go to the top of the ridge. The only road up is blocked: drive north and take a look.";
  else if (!cleared) h = me.load > 3
    ? `Carry the dirt up the road and tip it ${K("&rarr;")} into the washed-out gully further on. The landslide is exactly the fill you need.`
    : t.z > R.bank.z0 - 6 && t.z < R.bank.z1 + 4 && cleared === false && crossable(R.bank.z0 - 1, R.bank.z1 + 1, 6, (x, z) => heightAt(x, z) < ridgeRoad(z) + 0.45, 10) < 1
      ? `A loose bank narrows the road below 5 m (see the orange stakes). Dig it from the <b>top</b>: cut into the foot and the loose dirt above slides back down.`
      : `A landslide blocks the road. Dig a way through, 5 m wide (between the orange stakes): lower the bucket ${K("&darr;")} and drive into it. Push the rocks aside, or crush them.`;
  else if (!filled) h = me.load > 0.5
    ? `Tip the load ${K("&rarr;")} into the gully. Keep filling until a strip of road reaches the far side.`
    : `The road is washed out ahead. Fill the gully with what is left of the landslide, about 5 m wide so the cabin fits. Bumpy fill? The <b>road roller</b> (${K("F")} at the purple yard) flattens it.`;
  else if (!staged) h = towing
    ? "Tow the cabin up the road, over your fill, to the flat spot at the foot of the last steep climb."
    : `Road open! Go back for the cabin near the start: turn your back to it, hook it with ${K("E")} and tow it up the road.`;
  else if (!obj.has("summit")) {
    if (cp.y > R.top - 1) h = `Tow the cabin onto the <b class="g">summit pad</b> (green ring) to finish.`;
    else if (!onTop && towing) h = `The last climb is too steep to drive, let alone tow. Unhook the cabin with ${K("E")} and leave it here for now.`;
    else if (!onTop && winch.on) h = `Hold ${K("Q")} to winch yourself up the climb.`;
    else if (!onTop) h = `Back up to the steep climb, hook the <b>winch post</b> at the top with ${K("E")} and hold ${K("Q")} to pull yourself up. The cabin comes after you.`;
    else if (towing) h = `Hold ${K("Space")} to dig your tyres in and reel the cabin up with ${K("Q")}. Then tow it to the green ring.`;
    else h = `Now pull the cabin up from above: unhook from the post, turn your back to the drop, hook the cabin with ${K("E")}, hold ${K("Space")} and reel it in with ${K("Q")}.`;
  }
  setHint(h);
}
// ----- shared: hold the bucket down on a rock to crush it -----
function smashRocks() {
  let hit = -1;
  if (me.kind === "loader" && input.arm < 0 && me.tilt > -0.3) {
    for (const k of props) {
      if (!k.active || k.type !== "rock" || !mineP(k)) continue;
      const p = k.body.translation();
      _rp.set(p.x, p.y, p.z).applyMatrix4(_bi);
      if (Math.abs(_rp.x) < 1.5 && _rp.z > -0.4 && _rp.z < 1.7 && _rp.y < 0.1 && _rp.y > -(k.r * 1.6 + 0.5)) { hit = k.index; break; }
    }
  }
  if (hit >= 0 && hit === smash.i) {
    if ((smash.t += DT) > 0.4) { const k = props[hit], p = k.body.translation(); layGravel(hit, p.x, p.z, k.r); smash.t = 0; smash.i = -1; }
  } else { smash.i = hit; smash.t = 0; }
}
const coverOf = (cells, min) => { let n = 0; for (const i of cells) if (gravH[i] >= min) n++; return cells.length ? n / cells.length : 0; };

// ----- Gravel Run rules -----
const _bc = new THREE.Vector3();
function haulStep() {
  const H = HAUL, t = chassis.translation();
  smashRocks();
  // a truck parked under the chute with its bed down fills from the hopper
  if (me.kind === "truck" && me.bed < 0.2 && hopper.vol > 0.01 && me.load < KINDS.truck.cap - 0.01) {
    truckPose(me, _tw); _bc.set(0, 0.5, -0.9).applyMatrix4(_tw);
    if (Math.hypot(_bc.x - H.bay.x, _bc.z - H.bay.z) < H.bay.r) {
      const take = Math.min(4.5 * DT, hopper.vol, KINDS.truck.cap - me.load), gf = hopper.vol > 0 ? clamp(hopper.g / hopper.vol, 0, 1) : 0;
      hopper.vol -= take; hopper.g = Math.max(0, hopper.g - take * gf); hopperD[0] -= take; hopperD[1] -= take * gf;
      me.load += take; me.loadG += take * gf;
      if (Math.random() < 0.5) spawnDirt(H.bay.x + (Math.random() - 0.5) * 1.2, heightAt(H.bay.x, H.bay.z) + 4.5, H.bay.z + (Math.random() - 0.5) * 0.8, 0, -1, 0, 0, 1);
    }
  }
  // impatient campers honk now and then once the queue gets long (only heard near the gate)
  if (job.party == null && queueLen() >= CFG.LEVELS.haul.queueStar && stepCount % 420 === 0 && Math.hypot(t.x - H.gate.x, t.z - H.gate.z) < 70) sfx.honk();
  // a full truck that reaches the valley floor has made it down the switchbacks
  if (me.kind === "truck" && me.load >= 12 && t.z < 8 && t.y < 2) job.marks.add("hauled");
  if (job.party != null) haulEnding();
  if (!job.moved && Math.hypot(t.x - H.spawn.x, t.z - H.spawn.z) > 8) job.moved = true;
  if (!job.ended) job.time += DT;
}
// a tent pad's state: how much has gravel on it, and how flat it is (spread of heights)
function tentRating(cells) {
  let s = 0, s2 = 0;
  for (const i of cells) { s += heights[i]; s2 += heights[i] * heights[i]; }
  const n = cells.length, sd = Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2)), cover = coverOf(cells, 0.03), C = CFG.LEVELS.haul;
  return { cover, sd, done: cover >= 0.85, label: sd <= C.flatPerfect ? "perfect" : sd <= C.flatGood ? "good" : "bumpy" };
}
// the campers waiting at the gate: one more every so often (the same for everyone: it follows the clock)
const queueLen = () => Math.min(HAUL.queue.max, Math.floor(job.time / CFG.LEVELS.haul.queueEvery));
function haulEnding() {
  job.party += DT;
  const H = HAUL;
  gateBar.rotation.x = lerp(gateBar.rotation.x, -1.45, 0.05);
  // the first campers drive in, one to each pad; tents go up (a bumpy pad's tent wobbles)
  job.ratings.forEach((r, k) => {
    const car = queueCars[k], [tx, tz] = H.tents[k];
    if (car && car.visible) {
      const t = clamp((job.party - 1 - k * 1.5) / 6, 0, 1), sx = car.userData.home, gx = H.gate.x - 2;
      const x = t < 0.5 ? lerp(sx, gx, t * 2) : lerp(gx, tx + 4.5, (t - 0.5) * 2), z = t < 0.5 ? H.gate.z : lerp(H.gate.z, tz, (t - 0.5) * 2);
      car.position.set(x, heightAt(x, z), z);
    }
    const tent = tents[k], up = clamp((job.party - 4 - k * 1.5) / 1.2, 0, 1);
    tent.visible = up > 0; tent.scale.setScalar(Math.max(0.001, up)); tent.position.y = heightAt(tx, tz) + 1.2 * up;
    if (r.label === "bumpy") tent.rotation.z = Math.sin(job.party * 9 + k) * 0.18;
  });
}
function checkHaul() {
  const H = HAUL, t = chassis.translation();
  const lp = blockLog.body.translation();
  job.logInWay = Math.abs(lp.x + 34) < 5.5 && lp.z > 34 && lp.z < 50;
  job.rocksLeft = blockRocks.filter((k) => k.active).length;
  job.road = crossable(H.stream.z - H.stream.w + 0.5, H.stream.z + H.stream.w - 0.5, 85, (x, z) => mudAt(x, z) < 0.35, 10);
  job.ratings = tentCells.map(tentRating);
  const n = queueLen();
  queueCars.forEach((c, k) => { if (job.party == null) c.visible = k < n; });
  obj.update();
  hopper.heap.visible = hopper.vol > 0.3; hopper.heap.scale.set(1, clamp(hopper.vol / hopper.cap, 0.05, 1) * 0.6, 1);
  fordMarker4.beam.visible = !obj.has("ford"); bayMarker.beam.visible = obj.has("pit") && hopper.vol > 1;
  const padsHtml = job.ratings.map((r, k) => `<div class="sub">&nbsp;&nbsp;Pad ${k + 1}: ${r.done ? `&#10003; <span class="${r.label === "bumpy" ? "hot" : r.label === "perfect" ? "ok" : ""}">${r.label}</span>` : `${Math.round((r.cover / 0.85) * 100)}% gravelled`}</div>`).join("");
  elTasks.innerHTML = `<h2>Gravel Run</h2>${obj.render()}${padsHtml}
    <div class="sub">Hopper: ${hopper.vol.toFixed(0)} / ${hopper.cap} m&sup3; &nbsp; Campers waiting: <span class="${n >= CFG.LEVELS.haul.queueStar ? "hot" : ""}">${n}</span></div>
    ${starsHtml(obj.mainDone())}
    <div class="sub">Time ${clock(job.time)} &nbsp; ${K("O")} flatness overlay</div>
    <button id="leave">Back to the quarry</button>`;
  let h = "";
  const truck = me.kind === "truck", gravelIn = me.loadG > me.load * 0.5 && me.load > 0.5, cur = obj.current(), id = cur && cur.id;
  if (!job.moved) h = `The campground opens at dawn and campers are already queueing. The tent pads need gravel from the pit at the top of the switchbacks, across a boggy stream. Start with the ford.`;
  else if (id === "ford") h = truck && me.load > 1 && mudAt(t.x, t.z) > 0.5 && Math.abs(me.speed) < 0.5
    ? `Stuck! A loaded truck sinks in bog. Hook a tree behind you with ${K("E")} and reel yourself out ${K("Q")}, or have a friend tow you. Gravel the ford first.`
    : gravelIn
    ? `Tip the gravel ${K("&rarr;")} onto the bog at the <b class="o">ford</b> (orange ring). Pour while you creep forward to lay a strip 5 m wide right across.`
    : `The stream is bog. Crush the grey rocks near it into gravel: raise the bucket ${K("&uarr;")}, hang it over a rock and hold ${K("&darr;")}. Then scoop the gravel and spread it on the ford.`;
  else if (id === "pit") h = `Drive up the switchbacks to the pit. A fallen tree and two boulders block the pit road: winch the tree off the road (${K("E")}) and crush the boulders.`;
  else if (truck && me.load > 1) h = `Drive down to the tent pads. Raise the bed ${K("&rarr;")} just until gravel starts to pour, then keep driving: a slow pour on the move lays a thin, even layer. The hairpin is tight with a full load: take it slowly, or widen it with the loader.`;
  else if (truck) h = `Fill up: park with the bed under the <b class="o">hopper chute</b> (orange ring by the pit), bed down. Or have a friend tip their loader into your bed.`;
  else if (t.z > 30) h = `Scoop gravel from the pit and tip it into the hopper bin (sign). Then switch to the dump truck at the pit's <b class="p">vehicle yard</b> with ${K("F")} and park under the chute.`;
  else if (job.ratings.some((r) => r.cover > 0.3)) h = `Spread the gravel thin and flat: push with a level bucket, or pour while driving. The road roller makes a pad perfectly flat. ${K("O")} shows flatness.`;
  else h = "Head up to the pit for gravel. The dump truck carries three buckets at once; the hopper lets you load it on your own.";
  setHint(h);
}
// ----- Flood Season rules -----
// The river level, the town's floodwater and the pasture are run by the host's game and shared.
const floodBreaks = () => (job.marks.has("late") ? [...FLOOD.breaches, FLOOD.late] : FLOOD.breaches);
function leveeCrest() {
  const F = FLOOD, list = [...F.breaches, F.late], per = list.map(() => 1e9), shut = clamp(job.gateClose || 0, 0, 1);
  let min = 1e9, at = 0, sill = 1e9;
  const top = (x) => { let c = -9; for (let z = F.levee.z - 4; z <= F.levee.z + 4; z += 0.5) c = Math.max(c, heightAt(x, z)); return c; };
  for (let x = F.berm.x + 1; x <= 86; x += 0.5) {               // the town's stretch of levee
    let c = top(x);
    const dg = F.gate ? Math.abs(x - F.gate.x) : 1e9;
    if (F.gate && dg < F.gate.w / 2 + 0.95) c = dg > F.gate.w / 2 ? 3.2 : lerp(c, 2.8, shut);          // concrete walls, and the gate as it winds down
    list.forEach((b, n) => { if (Math.abs(x - b.x) <= b.w / 2 + 1) per[n] = Math.min(per[n], c); });
    if (c < min) { min = c; at = x; }
  }
  for (let x = -86; x <= F.berm.x - 2; x += 1) sill = Math.min(sill, top(x));      // the pasture's stretch: dig it down to make a spillway
  return { min, at, per, sill };
}
// the town's floodwater: the volume that came over, spread over the town from its lowest point (each sample point is 4 x 4 m)
const townLevel = () => (job.townVol > 0 ? Math.min(...townPts) + job.townVol / (townPts.length * 16) : -9);
function townDry() { const lv = townLevel(); let n = 0; for (const g of townPts) if (g > lv + 0.05) n++; return townPts.length ? n / townPts.length : 1; }
function floodStep() {
  const F = FLOOD, W2 = F.water, C = CFG.LEVELS.flood, t = chassis.translation();
  const host = !net.online || net.hostId === net.id, n = net.online ? Math.max(1, net.roster.length) : 1;
  if (stepCount % 30 === 0) job.crest = leveeCrest();
  const cr = job.crest, rate = (W2.peak - W2.start) / (W2.riseSolo / (1 + 0.3 * (n - 1))), frac = (job.water - W2.start) / (W2.peak - W2.start);
  if (host && job.time > W2.grace && job.party == null) {
    // a spillway into the empty pasture slows the rise until the pasture is full
    job.spilling = !!cr && job.water > cr.sill + 0.05 && job.pasture < 1;
    if (job.spilling) job.pasture = Math.min(1, job.pasture + (DT / C.pastureFill) * Math.min(1, (job.water - cr.sill) / 0.5));
    if (job.water < W2.peak) job.water = Math.min(W2.peak, job.water + (job.spilling ? rate * C.spillSlow : rate) * DT); else job.hold += DT;
    if (cr && job.water > cr.min) job.townVol += C.overflow * (job.water - cr.min) * DT;            // over the top: the town fills, fields first
  }
  if (host && job.party != null) { job.water = Math.max(W2.start, job.water - 0.05 * DT); job.townVol = Math.max(0, job.townVol - 900 * DT); }
  if (host && stepCount % CFG.EROSION.tick === 0)
    erodeStep({ x0: F.berm.x, x1: 86, z0: F.levee.z - 3, z1: F.levee.z + 6, water: job.water, rocks: floodRocks, axis: "z", dir: -1 });
  // the first time it comes over the top
  if (job.townVol > 0 && !job.floodSeen) {
    job.floodSeen = true; job.marks.add("flooded"); try { localStorage.setItem("jobsite-flood-tried", "1"); } catch {}
    if (cr) showBanner(`<b>The river is over the levee!</b>The fields are flooding first. Plug the low point to save the town.`, 6000);
  }
  // the late break opens part-way through the rise
  if (frac >= F.late.at && !job.lateSeen) {
    job.lateSeen = true; job.marks.add("late"); breachBeams[3].visible = true; sfx.rumble();
    showBanner(`<b>A new break!</b>The levee gave way at the east end. Plug it before the river gets there.`, 6000); say("late");
    if (host && !job.marks.has("lateCut")) {
      job.marks.add("lateCut");
      const L3 = F.late, drop = F.levee.crest - L3.floor;
      for (let x = L3.x - L3.w / 2 - 2; x <= L3.x + L3.w / 2 + 2; x += CELL) for (let z = F.levee.z - 4.5; z <= F.levee.z + 4.5; z += CELL) {
        const xi = Math.round((x + HALF) / CELL), zi = Math.round((z + HALF) / CELL);
        addHeight(xi, zi, -drop * smooth(L3.w / 2 + 1.6, L3.w / 2, Math.abs(x - L3.x)) * smooth(4.3, 0.75, Math.abs(z - F.levee.z)));
      }
    }
  }
  // the floodgate wheel: reeling in while hooked to it winds the gate down (the rope pays out as the wheel turns)
  if (gatePanel && winch.on && winch.kind === 2 && winch.ref === wheelAnchor && input.reel > 0 && job.gateClose < 1 && winch.T > C.wheelPull) {
    job.gateClose = Math.min(1, job.gateClose + DT / C.gateTime); winch.len = Math.min(WINCH.max, winch.len + WINCH.reelIn * DT * 0.95);
    wheelMesh.rotation.z -= DT * 3;
  }
  if (gatePanel) { gatePanel.position.set(F.gate.x, heightAt(F.gate.x, F.levee.z) + 1.5 + (1 - job.gateClose) * 3.4, F.levee.z); if (job.gateClose >= 1) lockGate(); }
  // the cars float down the river; winch them out before they go over the weir
  cars.forEach((c, k) => {
    if (!c.spawned && frac >= c.spec.at) {
      c.spawned = true; c.active = true; c.body.setEnabled(true); c.mesh.visible = true;
      const sx = c.spec.x ?? F.carStart.x;
      if (host) { c.body.setTranslation({ x: sx, y: Math.max(job.water, heightAt(sx, F.carStart.z)) + 0.6, z: F.carStart.z }, true); c.body.setLinvel({ x: 0, y: 0, z: 0 }, true); }
      if (c.spec.at > 0) { showBanner(`<b>A car is floating down the river!</b>${c.spec.name}: winch it out before the weir.`, 4500); sfx.splash(); }
    }
    const cp0 = c.body.translation();
    c.beam.visible = c.active && !job.marks.has("car" + k) && !job.marks.has("lost" + k); c.beam.position.set(cp0.x, cp0.y + 30, cp0.z);
    if (job.marks.has("car" + k)) { if (c.body.isDynamic()) c.body.setBodyType(RAPIER.RigidBodyType.Fixed, true); return; }
    if (job.marks.has("lost" + k)) { if (c.active) { c.active = false; c.body.setEnabled(false); c.mesh.visible = false; if (winch.on && winch.kind === 1 && winch.ref === c.index) hookOff(); } return; }
    if (!c.active || !mineP(c)) return;
    const p = c.body.translation(), v = c.body.linvel(), m = c.body.mass(), g = heightAt(p.x, p.z), sub = job.water + 0.35 - p.y;
    if (sub > 0) {                                                       // it floats, and the current carries it east
      const hooked = hookedByAnyone(c), steer = hooked ? 0 : 1;           // the current carries it east and keeps it mid-channel, unless a winch has it
      c.body.applyImpulse({ x: (C.current - v.x) * m * 0.6 * steer * DT, y: (Math.min(1, sub / 0.6) * 11.3 - v.y * 2) * m * DT, z: ((F.carStart.z - p.z) * 0.4 - v.z) * m * 0.5 * steer * DT }, true);
    }
    if (hookedByAnyone(c)) c.winched = true;
    if (p.x > F.weir) { job.marks.add("lost" + k); showBanner(`<b>The ${c.spec.name} went over the weir</b>`, 3500); }
    c.dryT = p.z < F.levee.z + 6 && g > job.water - 0.05 && p.y - g < 1.4 ? (c.dryT || 0) + DT : 0;
    if (c.dryT > 2 && c.winched) { job.marks.add("car" + k); showBanner(`<b>Car rescued!</b>${c.spec.name} is safe.`, 3500); sfx.ding(); }
  });
  // deep water sweeps a vehicle back to dry ground
  const depth = t.z > F.levee.z - 1 ? job.water - heightAt(t.x, t.z) : -1;
  if (depth > 1.3) {
    if ((safe.wet += DT) > 1.2) { hookOff(); placeLoader(safe.x, safe.z, safe.yaw); safe.wet = 0; showBanner("<b>Too deep!</b>Back on dry ground.", 3000); }
  } else {
    safe.wet = Math.max(0, safe.wet - DT);
    if (stepCount % 30 === 0 && depth < 0 && t.z < F.levee.z - 6) { safe.x = t.x; safe.z = t.z; safe.yaw = heading(); }
  }
  // water planes, rain
  riverWater.position.y = job.water;
  const tl = townLevel(); floodWater.visible = tl > -1; floodWater.position.y = tl;
  pastureWater.visible = job.pasture > 0.01; pastureWater.position.y = lerp(F.pasture.floor, cr ? Math.min(cr.sill, job.water) : 0, job.pasture);
  if (rain && rain.visible) {
    const cp = camera.position, drops = rain.userData.drops, fade = job.party != null ? Math.max(0, 1 - job.party / 4) : 1;
    for (let k = 0; k < drops.length; k++) {
      const d = drops[k]; d[1] -= 22 * DT; if (d[1] < -5) d[1] += 30;
      _m.makeTranslation(cp.x + d[0], cp.y + d[1] - 8, cp.z + d[2]); rain.setMatrixAt(k, _m);
    }
    rain.instanceMatrix.needsUpdate = true; rain.material.opacity = 0.55 * fade; if (fade <= 0) rain.visible = false;
  }
  if (job.party != null) { job.party += DT; scene.background.lerp(_skyClear, 0.01); scene.fog.color.copy(scene.background); }
  if (!job.moved && Math.hypot(t.x - F.spawn.x, t.z - F.spawn.z) > 8) job.moved = true;
  if (!job.ended) job.time += DT;
}
const _skyClear = new THREE.Color(SKY);
function checkFlood() {
  const F = FLOOD, W2 = F.water, C = CFG.LEVELS.flood, cr = job.crest || leveeCrest(), need = W2.peak + 0.1, list = floodBreaks();
  const plugged = list.map((b, n) => cr.per[n] >= need);
  job.dry = job.party != null ? job.dry : townDry();
  obj.update();
  breachBeams.forEach((b, n) => { b.visible = n < 4 ? n < list.length && !plugged[n] : job.gateClose < 1; });
  lowBeam.position.x = cr.at; lowBeam.visible = cr.min - job.water < 0.8 && job.party == null;
  const n = net.online ? Math.max(1, net.roster.length) : 1, rate = (W2.peak - W2.start) / (W2.riseSolo / (1 + 0.3 * (n - 1)));
  const left = job.time < W2.grace ? W2.grace - job.time + (W2.peak - job.water) / rate : (W2.peak - job.water) / rate;
  const margin = cr.min - job.water;
  const where = F.gate && Math.abs(cr.at - F.gate.x) < 3 ? "the floodgate" : ([...F.breaches, F.late].find((b) => Math.abs(cr.at - b.x) < b.w / 2 + 2) || { name: `x ${cr.at.toFixed(0)}` }).name;
  // the levee strip: 16 stretches, green / yellow / red by how far above the river they are
  let strip = "";
  for (let k = 0; k < 16; k++) {
    const x0 = F.berm.x + 1 + (k * (86 - F.berm.x - 1)) / 16, x1 = x0 + (86 - F.berm.x - 1) / 16;
    let lo = 1e9; for (let x = x0; x < x1; x += 1) { let c = -9; for (let z = F.levee.z - 4; z <= F.levee.z + 4; z += 1) c = Math.max(c, heightAt(x, z)); if (F.gate && Math.abs(x - F.gate.x) < F.gate.w / 2 + 0.5) c = lerp(c, 2.8, job.gateClose); lo = Math.min(lo, c); }
    const m = lo - job.water;
    strip += `<i style="background:${m > 0.6 ? "#4fd16a" : m > 0.2 ? "#f2c23a" : "#e0453a"}"></i>`;
  }
  const rescued = cars.filter((c, k) => job.marks.has("car" + k)).length;
  elTasks.innerHTML = `<h2>Flood Season</h2>${obj.render()}
    <div class="meter"><div class="sub">Levee, west to east</div><div class="lstrip">${strip}</div>
    <div class="${margin < 0.4 ? "hot" : "sub"}">River ${job.water.toFixed(2)} m &middot; lowest point ${cr.min.toFixed(2)} m at ${where}</div>
    <div class="sub">Town kept dry: <span class="${job.dry < 0.9 ? "hot" : "ok"}">${Math.round(job.dry * 100)}%</span>${job.pasture > 0.01 ? ` &middot; pasture ${Math.round(job.pasture * 100)}% full` : ""}</div></div>
    ${starsHtml(obj.mainDone())}
    <div class="sub">Time ${clock(job.time)}</div>
    <button id="leave">Back to the quarry</button>`;
  let h = "";
  const floating = cars.some((c, k) => c.active && !job.marks.has("car" + k) && !job.marks.has("lost" + k));
  let tried = false; try { tried = localStorage.getItem("jobsite-flood-tried") === "1"; } catch {}
  if (job.party != null) h = "";
  else if (!job.moved) h = `The storm is back and the river is rising behind the levee: about ${Math.round(left / 60)} minutes to the peak. Wind the floodgate shut and plug the breaks (orange beams) above the peak, lowest first! Three cars are stuck in the river (blue beams): winch them out before the water carries them over the weir.`;
  else if (margin < 0.35) h = `The river is ${margin.toFixed(2)} m from coming over at <b>${where}</b> (red beam). Get dirt there now!`;
  else if (floating && rescued < cars.length) h = `A car is floating down the river (blue beam)! Stand on the levee, hook it with ${K("E")} and reel it onto dry land before the weir at the east end.`;
  else if (F.gate && job.gateClose < 1) h = winch.on && winch.kind === 2 && winch.ref === wheelAnchor
    ? `Hold ${K("Space")} to brake and ${K("Q")} to reel: the wheel winds the gate down. ${Math.round(job.gateClose * 100)}% closed.`
    : `Close the floodgate: back up to the red <b>wheel</b> beside it, hook it with ${K("E")}, brake and reel in with ${K("Q")}.`;
  else if (!obj.has("breaks")) h = `Fill the breaks with dirt from the borrow pits, above ${need.toFixed(1)} m all the way across. Moving water eats loose dirt: pack your plugs, or put boulders on the river side.${tried && job.time > 90 ? ` <b>Idea:</b> dig a spillway through the levee into the empty pasture (west, past its bank). The river rises slower while it fills.` : ""}`;
  else h = tried ? "The levee is ready. Watch the lowest point until the river peaks. (A spillway into the pasture buys time.)" : "The levee is ready. Watch the lowest point until the river peaks and falls.";
  setHint(h);
}

// ----- X Marks the Spot rules -----
const dugOut = (x, z) => { const i = idxAt(x, z); return heights[i] < base[i] - 0.45; };          // the mound has been dug through
function chestExposed() {
  const C = TCLUES[3], top = tChest.body.translation().y + 0.45;
  for (let dx = -0.8; dx <= 0.8; dx += 0.8) for (let dz = -0.5; dz <= 0.5; dz += 0.5) if (heightAt(C.x + dx, C.z + dz) > top + 0.25) return false;
  return true;
}
const _rulerM = new THREE.Matrix4(), _rulerQ = new THREE.Quaternion(), _rulerS = new THREE.Vector3(), _rulerP = new THREE.Vector3();
function treasureStep() {
  const T = TREASURE, t = chassis.translation();
  if (tMill) tMill.rotation.z += DT * 0.6;
  // the deep river sweeps a vehicle back to the bank (the shallow one you can drive through)
  const R = T.deep, ground = heightAt(t.x, t.z), inBand = Math.abs(t.z - R.z) < R.w + 2;
  if (inBand && ground < R.water - 1.0 && t.y < ground + 2.4) {
    chassis.applyImpulse({ x: 6000 * DT, y: 0, z: 0 }, true);
    if ((safe.wet += DT) > 1.1) { hookOff(); placeLoader(safe.x, safe.z, safe.yaw); safe.wet = 0; showBanner("<b>Swept away!</b>The deep river is too deep to drive. Build a causeway with dirt from the spoil heaps.", 5000); }
  } else {
    safe.wet = Math.max(0, safe.wet - DT);
    if (stepCount % 30 === 0 && !inBand && Math.abs(t.z - T.ford.z) > T.ford.w + 2) { safe.x = t.x; safe.z = t.z; safe.yaw = heading(); }
  }
  // the chest stays buried until it has been dug out, then it can be winched
  if (tChest.body.isFixed() && (job.marks.has("chestUp") || (stepCount % 30 === 0 && chestExposed()))) {
    // sit it on whatever dirt is left under it first: freed while partly buried, physics would fling it out
    const p = tChest.body.translation(); let floor = -99;
    for (let dx = -1.1; dx <= 1.1; dx += 0.55) for (let dz = -0.8; dz <= 0.8; dz += 0.4) floor = Math.max(floor, heightAt(p.x + dx, p.z + dz));
    tChest.body.setTranslation({ x: p.x, y: Math.max(p.y, floor + 0.5), z: p.z }, true);
    job.marks.add("chestUp"); tChest.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true); tChest.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  }
  // compass and car-length ruler
  const hd = heading(), deg = ((hd * 180) / Math.PI + 360) % 360, dir = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(deg / 45) % 8];
  if (stepCount % 6 === 0) tCompass.innerHTML = `<span class="cdir">${dir}</span> ${Math.round(deg)}&deg; &nbsp; <span class="sub">${K("O")} car-length ruler ${job.ruler ? "on" : "off"}</span>`;
  tRuler.visible = !!job.ruler;
  if (job.ruler) {
    const fx = Math.sin(hd), fz = Math.cos(hd);
    _rulerQ.setFromAxisAngle(_ry, hd);
    for (let k = 0; k < 12; k++) {
      const d = 3 + k * CAR, x = t.x + fx * d, z = t.z + fz * d, big = (k + 1) % 5 === 0;
      tRuler.setMatrixAt(k, _rulerM.compose(_rulerP.set(x, heightAt(x, z) + 0.12, z), _rulerQ, _rulerS.set(big ? 3.2 : 1.8, 1, 1)));
    }
    tRuler.instanceMatrix.needsUpdate = true;
  }
  if (!job.moved && Math.hypot(t.x - T.spawn.x, t.z - T.spawn.z) > 8) job.moved = true;
  if (!job.ended) job.time += DT;
}
// each player sees half of each clue when there's a crew (solo, the whole clue)
function clueText(k) {
  const c = TCLUES[k], split = net.online && net.roster.length > 1;
  if (!split) return `${c.a} ${c.b}`;
  return me.slot % 2 === 0 ? `${c.a} <span class="sub">(a friend has the rest)</span>` : `<span class="sub">(a friend has the start)</span> ${c.b}`;
}
function checkTreasure() {
  const T = TREASURE;
  // posts dug up pop out of the ground; decoys turn up junk
  TCLUES.forEach((C, k) => { if (!C.chest && tPosts[k] && obj.has("c" + k) && !tPosts[k].visible) { tPosts[k].visible = true; tPosts[k].position.y = heightAt(C.x, C.z) - 0.3; } });
  T.decoys.forEach(([x, z], k) => {
    if (!job.marks.has("decoy" + k) && dugOut(x, z)) job.marks.add("decoy" + k);
    if (job.marks.has("decoy" + k) && !tJunk[k].visible) {
      tJunk[k].visible = true; tJunk[k].position.y = heightAt(x, z) + 0.3;
      if (running) { showBanner(`<b>Not treasure.</b>Just ${T.junk[k]}.`, 3000); popups.say("hinston", ["Ha! That's not it.", "Arr, that one's a fake.", "Keep looking, matey."][k % 3] + ` It's ${T.junk[k]}.`); }
    }
  });
  obj.update();
  const cp = tChest.body.translation();
  homeMarker.beam.visible = obj.has("c3");
  elTasks.innerHTML = `<h2>X Marks the Spot</h2>${obj.render()}${starsHtml(obj.mainDone())}
    <div class="sub">One car length = ${CAR} m (a loader). ${K("O")} shows a ruler ahead of you.</div>
    <div class="sub">Time ${clock(job.time)}</div>
    <button id="leave">Back to the quarry</button>`;
  const cur = obj.current(), id = cur && cur.id, t = chassis.translation();
  let h = "";
  if (!job.moved) h = `Captain Hinston's treasure map is all clues. Read clue 1 (top left), find the landmark, and measure in <b>car lengths</b>: ${K("O")} lays a ruler in front of you, and the compass shows which way you face.`;
  else if (id && id.startsWith("c") && id !== "c3") h = `Find the spot, then dig: lower the bucket ${K("&darr;")} into the little mound. Real clues have a marker post under them. Some mounds are decoys!`;
  else if (id === "c3") h = Math.abs(t.z - T.deep.z) < 12 && t.z < T.deep.z
    ? `The deep river is too deep to drive. Build a causeway: dirt from the spoil heaps beside it, tipped into the water until a strip reaches the far side.`
    : `The chest is 2 m down: dig a ramp into the hole so the loader can keep going deeper. Too heavy to scoop: once it's uncovered, winch it out.`;
  else if (id === "home") h = cp.y < heightAt(cp.x, cp.z) - 0.6
    ? `There it is! Hook the chest with your winch ${K("E")} from the top of the hole and reel it out ${K("Q")}.`
    : `Drag the chest all the way back to the start (green ring). Over your causeway, through the shallow river.`;
  setHint(h);
}

// ----- No Questions Asked rules -----
let stripCells = null;
function stripStats() {
  const S = AIR.strip;
  if (!stripCells) { stripCells = []; for (let x = S.x0; x <= S.x1; x += 1) for (let z = S.z - S.half + 0.5; z <= S.z + S.half - 0.5; z += 1) stripCells.push(idxAt(x, z), x, z); }
  let on = 0, firmN = 0, fill = 0, dry = 0, n = 0;
  for (let k = 0; k < stripCells.length; k += 3) {
    const i = stripCells[k], x = stripCells[k + 1], z = stripCells[k + 2];
    n++; if (Math.abs(heights[i] - S.level) <= CFG.LEVELS.airstrip.tol) on++;
    if (heights[i] > base[i] + 0.05) { fill++; if (pack[i] >= 0.7) firmN++; }      // only new dirt needs rolling: the jungle floor is already firm
    if (sample(mudA, x, z) * (1 - smooth(0.03, 0.12, gravH[i])) < 0.35) dry++;
  }
  return { grade: on / n, pack: fill ? firmN / fill : 0, fill: fill / n, dry: dry / n };
}
function stripClutter() {
  const S = AIR.strip; let n = 0;
  for (const p of props) {
    if (!p.active || !["log", "stump", "rock", "boulder", "standing"].includes(p.type)) continue;
    const t = p.body.translation();
    if (t.x > S.x0 - 1 && t.x < S.x1 + 1 && Math.abs(t.z - S.z) < S.half + 0.5) n++;
  }
  return n;
}
function fellTree(t, k) {
  if (!t.active) return;
  t.active = false; t.body.setEnabled(false); t.mesh.visible = false;
  if (winch.on && winch.kind === 1 && winch.ref === t.index) hookOff();
  for (const p of [t.log, t.stump]) { p.active = true; p.body.setEnabled(true); p.mesh.visible = true; }
  if (running) { sfx.thunk(); showBanner(`<b>Timber!</b>${t.giant ? "The giant tree is down." : "Now drag the log off the strip and pull the stump."}`, 2500); }
}
function airStep() {
  const A = AIR, C = CFG.LEVELS.airstrip, t = chassis.translation();
  smashRocks();
  // trees come down under a strong enough pull; the giant needs two winches, or one held at full power for a while
  standing.forEach((tr, k) => {
    if (job.marks.has("fell" + k)) { fellTree(tr, k); }
    else {
      const T2 = pullOn(tr), need = tr.giant ? C.giantPull : C.treePull;
      tr.pullT = T2 > need ? tr.pullT + DT : tr.giant && T2 > C.treePull * 1.8 ? tr.pullT + DT / C.giantSlow : Math.max(0, tr.pullT - DT);
      if (tr.pullT > 0.8) job.marks.add("fell" + k);
    }
    const st = tr.stump;
    if (st.active && !st.body.isDynamic()) {
      if (job.marks.has("stump" + k)) st.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
      else { st.pullT = pullOn(st) > C.stumpPull ? (st.pullT || 0) + DT : 0; if (st.pullT > 0.8) job.marks.add("stump" + k); }
    }
  });
  // showers: on a fixed clock, so every player gets the same weather
  const sh = A.showers, cyc = job.time % sh.every, raining = job.time > 60 && cyc > sh.every - sh.len && job.party == null;
  rainWet = clamp(rainWet + (raining ? DT / 8 : -DT / 25), 0, 1);
  if (raining && !job.rainSeen) { job.rainSeen = true; say("rain"); }
  airRain.visible = rainWet > 0.05;
  if (airRain.visible) {
    const cp = camera.position, drops = airRain.userData.drops;
    for (let k = 0; k < drops.length; k++) { const d = drops[k]; d[1] -= 22 * DT; if (d[1] < -5) d[1] += 30; _m.makeTranslation(cp.x + d[0], cp.y + d[1] - 8, cp.z + d[2]); airRain.setMatrixAt(k, _m); }
    airRain.instanceMatrix.needsUpdate = true; airRain.material.opacity = 0.5 * rainWet;
  }
  if (job.time > C.earlyAt && !job.earlySeen) { job.earlySeen = true; say("early"); }
  // the plane comes in once the strip is ready (a scripted landing: how well depends on the strip)
  if (job.planeT != null) planeStep();
  if (!job.moved && Math.hypot(t.x - A.spawn.x, t.z - A.spawn.z) > 8) job.moved = true;
  if (!job.ended) job.time += DT;
}
function planeStep() {
  const S = AIR.strip, tier = [3, 2, 1].find((n) => job.marks.has("tier" + n)) || 2;
  job.planeT += DT;
  const tt = job.planeT;
  plane.visible = true;
  let x, y, roll = 0;
  if (tt < 8) { const u = tt / 8; x = lerp(150, 60, u); y = lerp(30, stripSurface(60), u * u * (3 - 2 * u)); }
  else {
    const u = Math.min(1, (tt - 8) / 10); x = lerp(60, -45, 1 - (1 - u) * (1 - u)); y = S.level;
    const bounces = tier === 3 ? 0 : tier === 2 ? 1 : 3, b = (tt - 8) * 1.6;
    if (b < bounces) y += Math.abs(Math.sin(b * Math.PI)) * (tier === 1 ? 1.4 : 0.6) * (1 - b / (bounces + 0.5));
    if (tier === 1) roll = Math.sin(tt * 6) * 0.08 * (1 - u);
  }
  plane.position.set(x, y, S.z); plane.rotation.set(roll, Math.PI, tt < 8 ? 0.08 : 0);
  if (tier === 1 && tt > 9 && planeWheel.parent === plane) {           // a rough strip costs it a wheel
    plane.remove(planeWheel); scene.add(planeWheel); planeWheel.position.set(x - 4.5, y + 0.4, S.z); planeWheel.userData.v = [-9, 3];
  }
  if (planeWheel.parent === scene) { const v = planeWheel.userData.v; v[1] -= 9.8 * DT; planeWheel.position.x += v[0] * DT; planeWheel.position.y = Math.max(heightAt(planeWheel.position.x, S.z) + 0.3, planeWheel.position.y + v[1] * DT); if (planeWheel.position.y <= heightAt(planeWheel.position.x, S.z) + 0.31) v[1] = Math.abs(v[1]) * 0.4; planeWheel.rotation.z -= DT * 10; }
  if (tt > 19) job.marks.add("landed");
}
function checkAir() {
  const A = AIR, C = CFG.LEVELS.airstrip, st = (job.strip = stripStats());
  job.clutter = stripClutter();
  obj.update();
  if (obj.ready("ready") && !obj.has("ready") && job.planeT == null) {
    if (![1, 2, 3].some((n) => job.marks.has("tier" + n))) job.marks.add("tier" + (st.grade >= C.smooth.grade && st.pack >= C.smooth.pack ? 3 : st.grade >= C.good.grade && st.pack >= C.good.pack ? 2 : 1));
    job.planeT = 0; say("inbound");
  }
  const fell = standing.filter((tr, k) => job.marks.has("fell" + k)).length;
  elTasks.innerHTML = `<h2>No Questions Asked</h2>${obj.render()}
    <div class="sub">Strip: ${Math.round(st.grade * 100)}% level &middot; ${Math.round(st.pack * 100)}% firm${rainWet > 0.2 ? ' &middot; <span class="hot">raining: loose dirt is turning to mud</span>' : ""}</div>
    ${starsHtml(obj.mainDone())}
    <div class="sub">Time ${clock(job.time)} &nbsp; ${K("O")} grade overlay</div>
    <button id="leave">Back to the quarry</button>`;
  const cur = obj.current(), id = cur && cur.id;
  let h = "";
  if (!job.moved) h = `Señor Pinstón needs a runway. The strip is marked with white cones. Start with the trees standing on it.`;
  else if (id === "trees") h = target && target.ref != null && props[target.ref] && props[target.ref].giant
    ? `The giant tree won't come down for one winch. Two friends winching together will do it, or hold ${K("Q")} at full power for a long while.`
    : `Fell a tree: turn your back to it, hook it with ${K("E")}, brake ${K("Space")} and reel in ${K("Q")} hard. ${fell} / ${standing.length} down.`;
  else if (id === "clear") h = `Drag the logs off the strip, pull the stumps out with your winch (then drag them off), and crush or push the rocks away. ${job.clutter} things left on the strip.`;
  else if (id === "grade") h = `Cut the humps and fill the hollows: ${K("O")} shows red too high, blue too low, green within ${Math.round(C.tol * 100)} cm. Push dirt from the humps into the hollows.`;
  else if (id === "mud") h = `Two mud patches on the strip. Spread gravel on them: the heap south of the strip, and the dump truck (${K("F")} at a purple yard) carries a lot.`;
  else if (id === "pack") h = `Roll the strip firm with the road roller (${K("F")} at a purple yard). Packed dirt doesn't turn to mud in the rain.`;
  else if (id === "ready") h = "";
  setHint(h);
}

// ----- Sinking Sands rules -----
// The worm is deliberately simple: it lives in the pit and strikes on a fixed beat. A few seconds before,
// ripples run inward and the ground rumbles; then everything inside its ring is grabbed, shaken empty and
// thrown out to the edge. The ring shrinks as the pit fills, and the beat quickens. Nothing else.
const SINK_SAND = () => { let d = 0; for (let k = 0; k < pitCells.length; k++) d += Math.max(0, pitTarget[k] - heights[pitCells[k]]); return d * CELL * CELL; };
let SANDS_START = 0;
function sandsFill() { if (!SANDS_START) SANDS_START = Math.max(1, SINK_SAND()); return clamp(1 - SINK_SAND() / SANDS_START, 0, 1); }
const wormR = () => lerp(SANDS.ring.start, SANDS.ring.end, clamp(job.fill / 0.9, 0, 1));
function sandsStep() {
  const S = SANDS, P = S.pit, St = S.strike, t = chassis.translation();
  smashRocks();
  const sealed = obj.has("seal");
  // the beat: a phase that runs faster as the pit fills (every game counts it from the shared clock)
  if (!sealed && job.time > St.grace) job.wormPhase = (job.wormPhase || 0) + DT / lerp(St.every, St.everyEnd, clamp(job.fill / 0.9, 0, 1));
  const ph = job.wormPhase || 0, beat = Math.floor(ph), into = (ph - beat) * lerp(St.every, St.everyEnd, clamp(job.fill / 0.9, 0, 1));
  const untilStrike = lerp(St.every, St.everyEnd, clamp(job.fill / 0.9, 0, 1)) - into, R = wormR(), inside = Math.hypot(t.x - P.x, t.z - P.z) < R;
  wormRing.scale.setScalar(R); wormRing.visible = !sealed;
  // warning: ripples running inward, a rumble, the camera shakes if you're inside
  const warn = !sealed && job.time > St.grace && untilStrike < St.warn;
  wormRipples.visible = warn;
  if (warn) {
    wormRipples.children.forEach((r, k) => { const f = 1 - (((St.warn - untilStrike) * 0.6 + k / 3) % 1); r.scale.setScalar(Math.max(0.5, R * f)); r.position.set(P.x, P.level + 0.25, P.z); });
    if (!job.warned) { job.warned = true; sfx.rumble(); }
    if (inside) cam.shake = 0.25;
  } else job.warned = false;
  // the strike
  if (!sealed && beat > (job.lastBeat ?? 0)) {
    job.lastBeat = beat; job.mouthT = 1.6; sfx.splash();
    if (inside) {
      hookOff(); me.load = 0; me.loadG = 0; me.bed = 0;
      const a = Math.atan2(t.x - P.x, t.z - P.z), d = R + 5;
      placeLoader(P.x + Math.sin(a) * d, P.z + Math.cos(a) * d, a);
      chassis.setLinvel({ x: Math.sin(a) * 5, y: 7, z: Math.cos(a) * 5 }, true);
      job.marks.add("sw" + (net.id || 0) + "_" + beat);
      showBanner("<b>CHOMP!</b>The worm shook you empty and spat you out. Leave the ring before it strikes.", 3500);
    }
  }
  if (job.mouthT > 0) {
    job.mouthT -= DT; wormMouth.visible = true;
    const up = Math.sin(Math.min(1, (1.6 - job.mouthT) / 1.6) * Math.PI);
    wormMouth.position.set(P.x, heightAt(P.x, P.z) - 9 + up * 7, P.z); wormMouth.rotation.y += DT * 2;
  } else wormMouth.visible = false;
  if (!job.moved && Math.hypot(t.x - S.spawn.x, t.z - S.spawn.z) > 8) job.moved = true;
  if (!job.ended) job.time += DT;
}
const swallowCount = () => [...job.marks].filter((m) => m.startsWith("sw")).length;
function checkSands() {
  const S = SANDS, P = S.pit;
  job.fill = sandsFill();
  let n = 0, firmN = 0; for (const i of pitCells) { if (heights[i] > base[i] + 0.3) { n++; if (pack[i] >= 0.7) firmN++; } }
  job.sealPack = n ? firmN / n : 0;
  obj.update();
  const t = chassis.translation(), inside = Math.hypot(t.x - P.x, t.z - P.z) < wormR();
  elTasks.innerHTML = `<h2>Sinking Sands</h2>${obj.render()}
    <div class="sub">Swallowed: ${swallowCount()} ${swallowCount() ? "" : "&middot; keep it that way"}</div>
    ${starsHtml(obj.mainDone())}
    <div class="sub">Time ${clock(job.time)}</div>
    <button id="leave">Back to the quarry</button>`;
  const cur = obj.current(), id = cur && cur.id;
  let h = "";
  if (!job.moved) h = "Old Ginston wants his pit filled in. Grab sand from the dunes and tip it in. He didn't mention anything else.";
  else if (obj.has("seal")) h = "";
  else if (job.time > S.strike.grace && inside) h = `You're inside the red ring. When the ground shakes and the ripples run inward, get out!`;
  else if (id === "fill") h = me.load > 0.5
    ? `Wait for the worm to strike, then dash in and dump ${K("&rarr;")}, and get out before the next one. Sand slides flat: crushed rock (gravel) mixed in holds steeper.`
    : `Fill the pit with sand from the dunes. Crush rocks into gravel too: gravel holds its shape where sand slumps.`;
  else if (id === "seal") h = `Seal it: roll the new sand firm with the road roller (${K("F")} at the purple yard). Between strikes!`;
  setHint(h);
}

// ----- Night Shift rules -----
// The guard truck and the floodlights follow the shared clock, so they're in the same place for everyone.
// Every lap takes the same time. Every third lap the guard swaps direction (laps 1-3 one way, 4-6 the
// other, and so on), and on every ninth lap it fakes a switch at its first corner: it swings right round,
// holds, then turns back and carries on the way it was going. Still a fixed pattern you can learn.
function guardAt(t) {
  const G2 = NIGHT.guard, P0 = G2.path;
  const legsOf = (P) => P.map((p, k) => { const q = P[(k + 1) % P.length]; return Math.hypot(q[0] - p[0], q[1] - p[1]) / G2.speed; });
  const cycle = legsOf(P0).reduce((a, b) => a + b, 0) + G2.pause * P0.length;
  const lap = Math.floor(t / cycle), reversed = Math.floor(lap / 3) % 2 === 1, fake = (lap + 1) % 9 === 0;
  const P = reversed ? [P0[0], ...P0.slice(1).reverse()] : P0, legs = legsOf(P);
  let r = t - lap * cycle;
  for (let k = 0; k < P.length; k++) {
    const p = P[k], q = P[(k + 1) % P.length], yaw = Math.atan2(q[0] - p[0], q[1] - p[1]);
    if (r < legs[k]) { const u = r / legs[k]; return { x: lerp(p[0], q[0], u), z: lerp(p[1], q[1], u), yaw }; }
    r -= legs[k];
    if (r < G2.pause) {
      const nq = P[(k + 2) % P.length], nyaw = Math.atan2(nq[0] - q[0], nq[1] - q[1]);
      let d = nyaw - yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      if (fake && k === 0) {                                     // the fake-out: right round, hold, then on as before
        const third = G2.pause / 3, back = yaw + Math.PI;
        let d2 = nyaw - back; d2 = Math.atan2(Math.sin(d2), Math.cos(d2));
        const yy = r < third ? yaw + Math.PI * smooth(0, third, r) : r < 2 * third ? back : back + d2 * smooth(2 * third, G2.pause, r);
        return { x: q[0], z: q[1], yaw: yy, fake: true };
      }
      return { x: q[0], z: q[1], yaw: yaw + d * smooth(0, G2.pause, r) };
    }
    r -= G2.pause;
  }
  return { x: P[0][0], z: P[0][1], yaw: 0 };
}
const powerOn = () => { if (!generator) return false; const p = generator.body.translation(); return Math.hypot(p.x - NIGHT.generator.x, p.z - NIGHT.generator.z) < 6; };
function dropPanel(pn) {
  if (!pn.active) return;
  pn.active = false; pn.body.setEnabled(false);
  if (winch.on && winch.kind === 1 && winch.ref === pn.index) hookOff();
  pn.mesh.rotation.set(Math.PI / 2 * 0.98, pn.yaw, 0, "YXZ"); pn.mesh.position.y = heightAt(pn.x, pn.z) + 0.1;
}
function nightStep() {
  const N = NIGHT, t = chassis.translation(), T = job.time;
  // the guard
  const gp = guardAt(T);
  guardTruck.position.set(gp.x, heightAt(gp.x, gp.z), gp.z); guardTruck.rotation.y = gp.yaw;
  guardTruck.userData.bar.material.color.setHex(Math.floor(T * 3) % 2 ? 0xffa23a : 0x5a3a10);
  guardCone.position.set(gp.x, heightAt(gp.x, gp.z) + 0.15, gp.z); guardCone.rotation.y = gp.yaw;
  guardLight.position.set(gp.x, heightAt(gp.x, gp.z) + 1.6, gp.z); guardLight.target.position.set(gp.x + Math.sin(gp.yaw) * 10, 0, gp.z + Math.cos(gp.yaw) * 10);
  // the floodlights sweep (only while the generator is where it belongs)
  const on = powerOn();
  N.lights.forEach((F, k) => {
    const yaw = F.aim + F.amp * Math.sin((T / F.period) * Math.PI * 2), y = heightAt(F.x, F.z);
    floodCones[k].visible = on; floodCones[k].position.set(F.x, y + 0.2, F.z); floodCones[k].rotation.y = yaw;
    floodLights[k].sl.visible = on; floodLights[k].sl.target.position.set(F.x + Math.sin(yaw) * 18, 0, F.z + Math.cos(yaw) * 18);
    floodLights[k].head.material.color.setHex(on ? 0xffffee : 0x2a2e36);
    F.yawNow = yaw;
  });
  // panels: dug under (quiet) or winched down (loud)
  panels.forEach((pn, k) => {
    if (!pn.active) return;
    if (job.marks.has("pdown" + k)) return dropPanel(pn);
    if (stepCount % 20 === k % 20) {
      let under = 0;                                  // ground dug away under the panel, at three points along it
      for (const f of [-0.35, 0, 0.35]) { const i = idxAt(pn.x + Math.sin(pn.yaw + Math.PI / 2) * f * pn.r * 2, pn.z + Math.cos(pn.yaw + Math.PI / 2) * f * pn.r * 2); if (heights[i] < base[i] - 0.6) under++; }
      if (under >= 2) { job.marks.add("pdown" + k); return; }
    }
    pn.pullT = pullOn(pn) > CFG.LEVELS.night.panelPull ? pn.pullT + DT : 0;
    if (pn.pullT > 0.5) {
      job.marks.add("pdown" + k);
      if (winch.on && winch.kind === 1 && winch.ref === pn.index) { job.spotted = Math.min(1, (job.spotted || 0) + CFG.LEVELS.night.loud); showBanner("<b>CLANG!</b>That was loud.", 2000); sfx.thunk(); }
    }
  });
  // spotted: time inside the guard's cone or a floodlight fills the meter (faster with your headlights on)
  if (job.alarmT > 0) job.alarmT -= DT;
  else {
    const G2 = N.guard, seen = inCone(t.x, t.z, gp.x, gp.z, gp.yaw, G2.len, G2.half) || (on && N.lights.some((F) => inCone(t.x, t.z, F.x, F.z, F.yawNow, F.len, F.half)));
    const C = CFG.LEVELS.night;
    job.spotted = clamp((job.spotted || 0) + (seen ? C.spotRate * (me.hl ? 2 : 1) : -C.spotDecay) * DT, 0, 1);
    if (job.spotted >= 1) {                                                     // caught: lose the load, back across the road
      job.spotted = 0; job.alarmT = C.alarmTime; job.marks.add("alarm");
      if (me.load > 0.2) for (let k = 0; k < 8; k++) splat(t.x + (Math.random() - 0.5) * 3, t.z + (Math.random() - 0.5) * 3, me.load / 8, me.loadG / 8);
      me.load = 0; me.loadG = 0; me.bed = 0; hookOff();
      placeLoader(N.gate.x + (Math.random() - 0.5) * 8, N.road.z - 2, Math.PI);
      sfx.honk(); sfx.honk();
      showBanner("<b>ALARM!</b>The guard spotted you. Your load's gone and you're back across the road.", 4000);
    }
  }
  alarmTint.style.opacity = job.alarmT > 0 ? 0.35 + 0.25 * Math.sin(T * 12) : (job.spotted || 0) * 0.6;
  if (!job.moved && Math.hypot(t.x - N.spawn.x, t.z - N.spawn.z) > 8) job.moved = true;
  if (!job.ended) job.time += DT;
}
function checkNight() {
  const N = NIGHT, L = N.lot;
  let v = 0; for (let x = L.x - L.r; x <= L.x + L.r; x += CELL) for (let z = L.z - L.r; z <= L.z + L.r; z += CELL) if (Math.hypot(x - L.x, z - L.z) < L.r) { const i = idxAt(x, z); v += Math.max(0, heights[i] - base[i]); }
  job.delivered = v * CELL * CELL;
  obj.update();
  const sp = job.spotted || 0;
  elTasks.innerHTML = `<h2>Night Shift</h2>${obj.render()}
    <div class="meter"><div class="sub">Spotted</div><div class="mrow"><span class="mbar"><i style="width:${Math.round(sp * 100)}%;background:${sp > 0.6 ? "#e0453a" : "#ffc928"}"></i></span></div>
    <div class="sub">Floodlights: ${powerOn() ? "on" : '<span class="ok">off (no power)</span>'} &middot; your headlights: ${me.hl ? "on" : "off"} (${K("L")})</div></div>
    ${starsHtml(obj.mainDone())}
    <div class="sub">Time ${clock(job.time)}</div>
    <button id="leave">Back to the quarry</button>`;
  const t = chassis.translation(), inYard = t.x > N.yard.x0 && t.x < N.yard.x1 && t.z > N.yard.z0 && t.z < N.yard.z1;
  let h = "";
  if (!job.moved) h = `Grade-A Grading has the best topsoil in the valley. Borrow ${N.need} m&sup3; of it, quietly. Watch the guard's yellow cone and the white floodlight beams: stay out of them.`;
  else if (!panels.some((p) => !p.active)) h = `Get through the fence: dig under a panel (quiet, slow) or winch one down (fast, loud). The floodlights run off the red generator outside the east fence: winch it away and they go dark.`;
  else if (inYard) h = me.load > 0.5 ? `Got some! Back out, across the road, and tip it in your lot (green ring).` : `Scoop topsoil from the big pile. Keep out of the cones. Headlights off (${K("L")}) makes you harder to spot.`;
  else if (me.load > 0.5) h = `Tip it ${K("&rarr;")} in your lot (green ring) south of the road.`;
  else h = `Back for more. ${Math.round(job.delivered)} of ${N.need} m&sup3; delivered. A dump truck carries three buckets at once.`;
  setHint(h);
}

// ----- Firebreak rules -----
// Bare ground stops the fire: anything dug, dumped, gravelled, wet or rolled flat.
function fireBare(c) {
  if (scraped[c]) return true;
  const x0 = Math.floor(c / FG) * FCELL - HALF, z0 = (c % FG) * FCELL - HALF;
  for (const [dx, dz] of [[0.5, 0.5], [1.5, 0.5], [0.5, 1.5], [1.5, 1.5], [1, 1]]) {
    const i = idxAt(x0 + dx, z0 + dz);
    if (Math.abs(heights[i] - base[i]) > 0.08 || gravH[i] > 0.02) return true;
  }
  return false;
}
const windNow = () => (job.fireAt != null && job.time - job.fireAt > FIRE.windShift ? [0.62, -0.78] : [0, -1]);
function setFire(c, s, t = 0) { fireS[c] = s; fireT[c] = t; if (net.online) fireNet.push(c, s); }
function fireTick(dt) {
  const C = CFG.LEVELS.fire, [wx, wz] = windNow(), burning = [];
  for (let c = 0; c < fireS.length; c++) if (fireS[c] === 1) burning.push(c);
  for (const c of burning) {
    if (fireBare(c)) { setFire(c, 2); continue; }                       // smothered with dirt
    fireT[c] -= dt;
    if (fireT[c] <= 0) { setFire(c, 2); continue; }
    const cx = Math.floor(c / FG), cz = c % FG;
    for (let ox = -2; ox <= 2; ox++) for (let oz = -2; oz <= 2; oz++) {
      if (!ox && !oz) continue;
      const nx = cx + ox, nz = cz + oz; if (nx < 0 || nz < 0 || nx >= FG || nz >= FG) continue;
      const n = nz + nx * FG; if (fireS[n] !== 0) continue;
      const d = Math.hypot(ox, oz), dot = (ox * wx + oz * wz) / d, near = d < 1.5 ? 1 : 0.06;
      const p = C.spread * near * Math.pow(0.12 + 0.88 * Math.max(0, dot), 1.6) * dt;
      if (Math.random() < p && !fireBare(n)) setFire(n, 1, C.burnTime * (0.8 + Math.random() * 0.4));
    }
  }
  // trees in the fire burn hot and throw embers downwind (spot fires)
  for (const tr of fireTrees) {
    if (!tr.active) continue;
    const c = fcOf(tr.x, tr.z);
    if (fireS[c] === 0 && burning.some((b) => Math.abs(Math.floor(b / FG) - Math.floor(c / FG)) <= 1 && Math.abs((b % FG) - (c % FG)) <= 1) && Math.random() < 0.3 * dt) setFire(c, 1, C.burnTime * 3);
    if (fireS[c] === 1 && Math.random() < C.ember * dt) {
      const dist = 6 + Math.random() * 6, side = (Math.random() - 0.5) * 6, ex = tr.x + wx * dist - wz * side, ez = tr.z + wz * dist + wx * side, e = fcOf(ex, ez);
      if (fireS[e] === 0 && !fireBare(e)) { setFire(e, 1, C.burnTime); job.marks.add("ember"); }
    }
  }
  return burning.length;
}
function drawFire() {
  let nf = 0, nb = 0; const t = performance.now() / 1000;
  for (let c = 0; c < fireS.length; c++) {
    if (fireS[c] === 1 && nf < flames.count + 2400) {
      const x = fcX(c), z = fcZ(c), s = 0.7 + 0.35 * Math.sin(t * 9 + c);
      _m.makeScale(s, s * (1 + 0.3 * Math.sin(t * 13 + c * 1.7)), s).setPosition(x, heightAt(x, z) + 1.0 * s, z); if (nf < 2400) flames.setMatrixAt(nf++, _m);
    } else if (fireS[c] === 2) { const x = fcX(c), z = fcZ(c); _m.makeTranslation(x, heightAt(x, z) + 0.06, z); burntMesh.setMatrixAt(nb++, _m); }
  }
  flames.count = nf; burntMesh.count = nb; flames.instanceMatrix.needsUpdate = true; burntMesh.instanceMatrix.needsUpdate = true;
}
function farmSaved() {
  const Fm = FIRE.farm; let n = 0, ok = 0;
  for (let x = Fm.x0 + 1; x < Fm.x1; x += FCELL) for (let z = Fm.z0 + 1; z < Fm.z1; z += FCELL) { n++; if (fireS[fcOf(x, z)] !== 2 && fireS[fcOf(x, z)] !== 1) ok++; }
  return n ? ok / n : 1;
}
function fireStep() {
  const F = FIRE, C = CFG.LEVELS.fire, t = chassis.translation(), host = !net.online || net.hostId === net.id;
  fireTrees.forEach((tr, k) => {
    if (job.marks.has("fell" + k)) fellTree(tr, k);
    else { tr.pullT = pullOn(tr) > CFG.LEVELS.airstrip.treePull ? tr.pullT + DT : Math.max(0, tr.pullT - DT); if (tr.pullT > 0.8) job.marks.add("fell" + k); }
  });
  // the fire starts on time (every game knows when; only the host's game spreads it and shares the result)
  if (job.fireAt == null && job.time >= F.ignite.at) {
    job.fireAt = F.ignite.at;
    if (host) for (let x = -76; x <= 76; x += FCELL) setFire(fcOf(x, F.ignite.z), 1, C.burnTime);
    showBanner("<b>Here it comes!</b>The fire is coming down the valley.", 4000); say("fire");
  }
  if (job.fireAt != null && !job.shiftSeen && job.time - job.fireAt > F.windShift) { job.shiftSeen = true; showBanner("<b>The wind has shifted!</b>It's blowing south-east now: watch the ends of your line.", 5000); say("wind"); }
  if (host && job.fireAt != null && job.party == null && stepCount % 12 === 0) {
    job.burning = fireTick(12 * DT);
    if (job.burning === 0 && job.time - job.fireAt > 20) job.fireOutT = (job.fireOutT || 0) + 12 * DT; else job.fireOutT = 0;
    if (job.fireOutT > 6 || job.time - job.fireAt > C.maxFire) job.marks.add("out");
  }
  if (stepCount % 6 === 0 && flames) drawFire();
  // smoke: driving through the fire fills the view with smoke (nothing else happens)
  let smoky = false; const mc = fcOf(t.x, t.z);
  for (const o of [0, 1, -1, FG, -FG]) if (fireS[mc + o] === 1) smoky = true;
  scene.fog.far = lerp(scene.fog.far, smoky ? 18 : 220, 0.05); scene.fog.near = Math.min(70, scene.fog.far * 0.3);
  // the roller presses grass flat: that's bare too
  if (me.kind === "roller" && Math.abs(me.speed) > 0.5 && stepCount % 6 === 0) {
    const h = heading();
    for (const s of [-1.2, 0, 1.2]) for (const f of [1.7, -1.5]) {
      const c = fcOf(t.x + Math.sin(h) * f + Math.cos(h) * s, t.z + Math.cos(h) * f - Math.sin(h) * s);
      if (!scraped[c]) { scraped[c] = 1; if (net.online) scrapeNet.push(c); if (fireS[c] === 1) setFire(c, 2); }
    }
  }
  if (job.party != null) { job.party += DT; cows.forEach((c, k) => { c.position.y = c.userData.y0 + Math.abs(Math.sin(job.party * 6 + k)) * (job.saved >= 0.999 ? 0.6 : 0); }); }
  if (!job.moved && Math.hypot(t.x - F.spawn.x, t.z - F.spawn.z) > 8) job.moved = true;
  if (!job.ended) job.time += DT;
}
function checkFire() {
  const F = FIRE;
  job.saved = farmSaved();
  obj.update();
  const [wx, wz] = windNow(), arrow = wx > 0.3 ? "&#8600; south-east" : "&#8595; south";
  const left = F.ignite.at - job.time;
  elTasks.innerHTML = `<h2>Firebreak</h2>${obj.render()}
    <div class="sub">${job.fireAt == null ? `The fire starts in <b>${clock(Math.max(0, left))}</b>` : "The fire is burning"} &middot; wind ${arrow}</div>
    <div class="sub">Farm safe: <span class="${job.saved < 0.8 ? "hot" : "ok"}">${Math.round(job.saved * 100)}%</span></div>
    ${starsHtml(obj.mainDone())}
    <div class="sub">Time ${clock(job.time)}</div>
    <button id="leave">Back to the quarry</button>`;
  let h = "";
  if (job.party != null) h = "";
  else if (!job.moved || job.fireAt == null) h = `A wildfire is coming down the valley. Cut a firebreak across it before it arrives (yellow flags): fire can't cross <b>bare dirt</b>. Lower the bucket ${K("&darr;")} and drive to scrape the grass, or roll it flat with the road roller. Make it wide, and wrap it round the farm's sides.`;
  else if (job.marks.has("ember") && !job.emberHinted) { job.emberHinted = true; h = "Embers from the burning trees started a spot fire! Dump dirt on it to smother it."; }
  else h = windNow()[0] > 0.3 ? "The wind shifted south-east: the fire will try to get round the east end of your line. Extend it!" : "Hold the line. Smother spot fires with dirt. Trees near your line throw embers: winch them away.";
  setHint(h);
}

const siteStep = { hub: () => hubStep(), farm: () => farmStep(), river: () => riverStep(), ridge: () => ridgeStep(), haul: () => haulStep(), flood: () => floodStep(), treasure: () => treasureStep(), airstrip: () => airStep(), sands: () => sandsStep(), night: () => nightStep(), fire: () => fireStep() }[SITE];
const siteCheck = { hub: () => checkHub(), farm: () => checkFarm(), river: () => checkRiver(), ridge: () => checkRidge(), haul: () => checkHaul(), flood: () => checkFlood(), treasure: () => checkTreasure(), airstrip: () => checkAir(), sands: () => checkSands(), night: () => checkNight(), fire: () => checkFire() }[SITE];
function checkHub() {
  const rows = houses.map((hs) => {
    const p = progress[hs.id];
    const lk = isLocked(hs);
    if (hs.garage) return `<div class="sub">&#128295; Garage: switch vehicle with ${K("F")}${rollerUnlocked() ? "" : " (road roller unlocks after job 1)"}</div>`;
    if (hs.paint) return `<div class="sub">&#127912; Paint Shop (next to the garage): drive in and stop to customize, or ${K("G")} in the garage</div>`;
    return `<div class="${p && p.done ? "done" : lk ? "sub" : ""}">${p && p.done ? "&#10003;" : lk ? "&#128274;" : "&#9675;"} ${hs.title}${p && p.done ? ` <span class="stars">${starStr(starsOf(p))}</span> ${clock(p.best)}` : lk ? " (locked)" : ""}</div>`;
  }).join("");
  elTasks.innerHTML = `<h2>Quarry yard</h2><div class="sub">Drive into a house and stop to start a job.</div>${rows}<div class="sub" style="margin-top:6px">The rest of the quarry is a playground: dig, dump and push rocks anywhere.</div>`;
  setHint(net.online && net.roster.length > 1 ? "Your crew is here. Whoever drives into a job house takes everyone along." : `Drive to the <b>${(houses.find((h) => !h.garage && !h.paint && !isLocked(h) && !(progress[h.id] && progress[h.id].done)) || houses[0]).title}</b> house and stop inside to start the job. ${K("H")} hides hints.`);
}

// ---------- loop ----------
function physicsStep() {
  stepCount++;
  updatePeers();
  driveStep();
  winchStep();
  parkStep();
  updateDirt();
  relaxStep();
  flushTerrain();
  if (stepCount % 10 === 0) {
    for (const p of props) if (p.active && p.body.isDynamic()) { const t = p.body.translation(); p.body.setLinearDamping(p.damp + mudAt(t.x, t.z) * (p.type === "tractor" ? 4 : p.type === "crate" ? 5 : 2)); }
  }
  world.step();
  if (chassis.translation().y < -40) resetLoader();
  if (running) siteStep();
  if (net.online) {
    if (stepCount % 10 === 0) updateOwnership();
    if (stepCount % 3 === 0) sendState();
  }
}

// rope drawing: up to four ropes of ten segments each
const ROPE_SEG = 10;
const ropeMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.05, 1, 5), lam(0x1d2126), ROPE_SEG * 4);
ropeMesh.frustumCulled = false; ropeMesh.count = 0; scene.add(ropeMesh);
const marker3 = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.0, 12).rotateX(Math.PI), new THREE.MeshBasicMaterial({ color: 0xffc928 }));
marker3.visible = false; scene.add(marker3);
const _ra = new THREE.Vector3(), _rb = new THREE.Vector3(), _r0 = new THREE.Vector3(), _r1 = new THREE.Vector3(), _ry = new THREE.Vector3(0, 1, 0), _rq = new THREE.Quaternion(), _rs = new THREE.Vector3(), _rsc = new THREE.Vector3();
function drawRopes() {
  let n = 0;
  const rope = (A, B, len) => {
    const d = A.distanceTo(B), sag = Math.min(4, Math.max(0, len - d) * 0.5);
    for (let s = 0; s < ROPE_SEG; s++) {
      const t0 = s / ROPE_SEG, t1 = (s + 1) / ROPE_SEG;
      _r0.lerpVectors(A, B, t0); _r0.y -= sag * 4 * t0 * (1 - t0);
      _r1.lerpVectors(A, B, t1); _r1.y -= sag * 4 * t1 * (1 - t1);
      const l = _r0.distanceTo(_r1);
      _rq.setFromUnitVectors(_ry, _rs.subVectors(_r1, _r0).normalize());
      ropeMesh.setMatrixAt(n++, _m.compose(_rs.addVectors(_r0, _r1).multiplyScalar(0.5), _rq, _rsc.set(1, l, 1)));
    }
  };
  if (winch.on) { const B = anchorPos(winch.kind, winch.ref, winch.local, _rb); if (B) rope(bodyPoint(chassis, HOOK, _ra), B, winch.len); }
  for (const pr of net.peers.values()) {
    const h = pr.h;
    if (!h || !pr.seen || n >= ROPE_SEG * 4) continue;
    const B = anchorPos(h[0], h[1], _wl.set(h[2], h[3], h[4]), _rb);
    if (B) rope(bodyPoint(pr.loader.body, HOOK, _ra), B, h[5]);
  }
  ropeMesh.count = n; ropeMesh.instanceMatrix.needsUpdate = true;
}

const _f = new THREE.Vector3(), _target = new THREE.Vector3();
function syncLoader(ld) {
  const t = ld.body.translation(), r = ld.body.rotation();
  ld.group.position.set(t.x, t.y, t.z); ld.group.quaternion.set(r.x, r.y, r.z, r.w);
}
function syncVisuals(dt, now = performance.now()) {
  syncLoader(me);
  for (let i = 0; i < 4; i++) {
    const w = me.wheels[i];
    w.steerNode.position.y = L.wy - (vehicle.wheelSuspensionLength(i) ?? L.rest);
    w.steerNode.rotation.y = vehicle.wheelSteering(i) || 0;
    w.spin.rotation.x = vehicle.wheelRotation(i) || 0;
  }
  if (me.kind === "roller") for (const d of me.drums) d.rotation.x = (vehicle.wheelRotation(0) || 0) * (L.wheelR / 0.85);
  for (const peer of net.peers.values()) {
    syncLoader(peer.loader);
    for (const w of peer.loader.wheels) { w.steerNode.rotation.y = w.front ? peer.loader.steer : 0; w.spin.rotation.x = peer.loader.roll; }
    for (const d of peer.loader.drums) d.rotation.x = peer.loader.roll;
  }
  for (const k of props) {
    if (!k.active) continue;
    const p = k.body.translation(), q = k.body.rotation();
    k.mesh.position.set(p.x, p.y, p.z); k.mesh.quaternion.set(q.x, q.y, q.z, q.w);
  }
  partMesh.count = parts.n;
  for (let i = 0; i < parts.n; i++) { const sc = parts.s[i]; partMesh.setMatrixAt(i, _m.makeScale(sc, sc, sc).setPosition(parts.x[i * 3], parts.x[i * 3 + 1], parts.x[i * 3 + 2])); }
  for (let i = 0; i < parts.n; i++) partMesh.setColorAt(i, parts.g[i] > parts.vol[i] * 0.5 ? cGravel : cLoose);
  partMesh.instanceMatrix.needsUpdate = true; if (partMesh.instanceColor) partMesh.instanceColor.needsUpdate = true;
  drawRopes();
  marker3.visible = !winch.on && !!target && running;
  if (marker3.visible) marker3.position.set(target.pos.x, target.pos.y + 2.2 + Math.sin(now / 220) * 0.25, target.pos.z);

  // chase camera, aimed a little ahead at the bucket
  const t = me.group.position;
  _f.set(0, 0, 1).applyQuaternion(me.group.quaternion);
  const hd = Math.atan2(_f.x, _f.z);
  let d = hd - cam.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
  cam.yaw += d * Math.min(1, dt * 3.2);
  const yaw = cam.yaw + cam.offset, ch = Math.cos(cam.pitch) * cam.dist;
  _target.set(t.x + Math.sin(hd) * 2.5, t.y + 1.6, t.z + Math.cos(hd) * 2.5);
  camera.position.set(_target.x - Math.sin(yaw) * ch, _target.y + Math.sin(cam.pitch) * cam.dist, _target.z - Math.cos(yaw) * ch);
  camera.position.y = Math.max(camera.position.y, heightAt(camera.position.x, camera.position.z) + 1.2);
  camera.lookAt(_target);
  if (cam.shake > 0) { camera.position.x += (Math.random() - 0.5) * cam.shake; camera.position.y += (Math.random() - 0.5) * cam.shake; cam.shake = Math.max(0, cam.shake - dt); }
  sun.target.position.copy(_target);
  sun.position.copy(_target).addScaledVector(SUN_DIR, 110);

  const isTruck = me.kind === "truck", fill = me.load / (isTruck ? KINDS.truck.cap : L.capacity), noun = isTruck ? "Bed" : "Bucket";
  elFillBar.style.width = `${Math.round(fill * 100)}%`;
  const gp = me.load > 0.05 ? Math.round((me.loadG / me.load) * 100) : 0;
  const stuff = me.load > 0.05 ? (gp >= 85 ? "gravel" : gp >= 15 ? `${gp}% gravel` : "dirt") : "";
  elFillBar.style.background = gp >= 50 ? "#b9bcc2" : fill > 0.98 ? "#8be28b" : "#c08a4a";
  elFillText.textContent = (fill > 0.98 ? `${noun} full` : `${noun} ${Math.round(fill * 100)}%`) + (stuff ? ` \u00b7 ${stuff}` : "");
  const kmh = Math.abs(me.speed) * 3.6;
  elFill.style.display = me.kind !== "roller" ? "block" : "none";
  if (isTruck) elGauges.innerHTML = `<b>${kmh.toFixed(0)}</b> km/h &nbsp; dump truck &nbsp; bed ${me.bed > 0.45 ? "tipping" : me.bed > 0.05 ? "raised" : "down"}`;
  else if (me.kind !== "loader") elGauges.innerHTML = `<b>${kmh.toFixed(0)}</b> km/h &nbsp; ${KINDS[me.kind].name}`;
  else elGauges.innerHTML = `<b>${kmh.toFixed(0)}</b> km/h &nbsp; arms ${Math.round(((me.arm - L.armMin) / (L.armMax - L.armMin)) * 100)}% &nbsp; bucket ${me.tilt > 0.25 ? "curled" : me.tilt < -0.12 ? "dumping" : "level"}`;
  let pr = "";
  if (winch.on) {
    const strain = winch.T / WINCH.tmax;
    pr = `Winch on <b>${winch.name}</b> &middot; rope ${winch.len.toFixed(0)} m ${strain > 0.95 ? '<span class="hot">&middot; full power</span>' : strain > 0.05 ? "&middot; pulling" : ""}<br>${K("Q")} reel in &nbsp; ${K("X")} let out &nbsp; ${K("E")} unhook`;
  } else if (target && running) pr = `${K("E")} hook winch to <b>${target.name}</b> (${target.dist.toFixed(0)} m)`;
  if (padNow && running && !customOpen) { const nk = nextKind(); pr += `${pr ? "<br>" : ""}${nk ? `${K("F")} switch to the <b>${KINDS[nk].name}</b>` : "No other vehicles unlocked yet"}`; }
  const inPaint = inPaintShop();
  if ((padNow === "garage" || inPaint) && running && !customOpen) pr += `${pr ? "<br>" : ""}${K("G")} paint shop`;
  if (customOpen && padNow !== "garage" && !inPaint) closeCustom();
  if (elPrompt.dataset.h !== pr) { elPrompt.dataset.h = pr; elPrompt.innerHTML = pr; elPrompt.style.display = pr ? "block" : "none"; }
}

let running = false, last = 0, acc = 0, hudAt = 0, padNow = null;
function frame(now) { requestAnimationFrame(frame); tick(now); }
function tick(now) {
  const dt = Math.min(0.1, (now - last) / 1000 || 0); last = now;
  padState = readPad();
  if (pad.rx || pad.ry) { cam.offset -= pad.rx * 2.4 * dt; cam.pitch = clamp(cam.pitch + pad.ry * 1.3 * dt, 0.08, 1.25); }
  if (running) {
    readKeys();
    acc += dt;
    let n = 0;
    while (acc >= DT && n++ < 4) { physicsStep(); acc -= DT; }
    if (acc > DT) acc = 0;
  }
  syncVisuals(dt, now);
  popups.update(dt);
  if (now - hudAt > 250) {
    hudAt = now;
    target = !winch.on && running ? findTarget() : null;
    padNow = switchPad();
    { const t = chassis.translation(); for (const b of buildings) b.roof.visible = !b.inside(t.x, t.z); }   // lift the roof off whatever you are parked in
    siteCheck();
  }
  renderer.render(scene, camera);
}

// let the site settle before the first frame so nothing is falling when play starts
poseBucket(me);
for (const d of displays) poseBucket(d);
{ const s = spawnAt(0); placeLoader(s.x, s.z, s.yaw); cam.yaw = s.yaw; }
for (let i = 0; i < 90; i++) physicsStep();
netEdits.clear(); netG.clear();
requestAnimationFrame(frame);

// ---------- lobby ----------
const elStart = document.getElementById("start"), elMsg = document.getElementById("msg"), elName = document.getElementById("name"), elCode = document.getElementById("code");
try { elName.value = localStorage.getItem("jobsite-name") || ""; } catch {}
function begin() { elStart.style.display = "none"; running = true; if (!(obj && obj.mainDone())) say("start"); }
async function join(room) {
  const name = (elName.value.trim() || "Driver").slice(0, 16);
  try { localStorage.setItem("jobsite-name", name); } catch {}
  elMsg.textContent = "Connecting…";
  try { await connect(room, name); begin(); } catch (e) { elMsg.textContent = e.message; }
}
document.getElementById("solo").addEventListener("click", begin);
document.getElementById("create").addEventListener("click", () => {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  join(Array.from({ length: 4 }, () => abc[Math.floor(Math.random() * abc.length)]).join(""));
});
document.getElementById("join").addEventListener("click", () => {
  const room = elCode.value.trim().toUpperCase();
  if (!/^[A-Z2-9]{4}$/.test(room)) { elMsg.textContent = "Room codes are 4 letters or digits."; return; }
  join(room);
});
for (const b of elStart.querySelectorAll("button")) b.disabled = false;
elMsg.textContent = "";
try { const kk = localStorage.getItem("jobsite-kind"); if (KINDS[kk] && kindOpen(kk)) setKind(me, kk); } catch {}
// arriving from another site: rejoin the room, or carry on solo
if (params.get("room") && /^[A-Z2-9]{4}$/.test(params.get("room"))) { elMsg.textContent = "Rejoining your crew…"; join(params.get("room")); }
else if (params.get("solo")) begin();

// hooks for automated checks
window.__game = { SITE, world, chassis, vehicle, props, anchors, boulders, logs, stump: () => stump, tractor: () => tractor, input, me, job, L, WINCH, FARM, HUB, net, winch, heights, heightAt, mudAt, slopeAt,
  physicsStep, syncVisuals, checkFarm, checkHub, resetLoader, placeLoader, cam, join, begin, buildSync, findTarget, toggleWinch, hookOff, setFlag, setActiveBoulders, houses, barn, enter, pad, tick, HAUL, FLOOD, hopper: () => hopper, gate: () => gatePanel, cars, floodBreaks, townDry, wheelAnchor: () => wheelAnchor, leveeCrest, coverOf, padCells, gravH, nextKind, blockLog: () => blockLog, blockRocks, fordRocks, picnic: () => picnic, openCustom, closeCustom, setLook, stepLook, get myLook() { return myLook; }, get customOpen() { return customOpen; }, applyLook, cleanLook, RIDGE, ridgeRoad, cabin: () => cabin, firewood: () => firewood, ridgeRocks, KINDS, setKind, switchVehicle, switchPad, displays, YARD, RIVER, layGravel, gravel, crate: () => crate, toolbox: () => toolbox, riverRocks, safe,
  get flags() { return flags; }, FL, parts, obj: () => obj, popups, say, overlay, cycleOverlay, pack, cutFill, measureCutFill, starsEarned, starChecks, get progress() { return progress; }, finishLevel, get target() { return target; }, get grip() { return gripNow; },
  run(steps, set = {}) { Object.assign(input, set); for (let i = 0; i < steps; i++) physicsStep(); syncVisuals(DT); target = !winch.on ? findTarget() : null; siteCheck(); },
  render() { renderer.render(scene, camera); },
  refreshTerrain() { for (const c of chunks) { buildCollider(c); buildMesh(c); } },          // after a test edits heights directly
  marks: () => job.marks, FIRE, fireS: () => fireS, scraped: () => scraped, farmSaved, fcOf, fireTrees, NIGHT, panels, guardAt, powerOn, generator: () => generator, get spotted() { return job.spotted; }, SANDS, sandsFill, swallowCount, get wormPhase() { return job.wormPhase; }, TREASURE, TCLUES, TLAYOUT, tChest: () => tChest, AIR, standing, stripRocks, stripStats, stripClutter, get rainWet() { return rainWet; } };
