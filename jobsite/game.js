// Job Site: wheel loaders with rear winches on diggable job sites, solo or with up to 3 friends.
// The page builds one site, picked by ?site= : the quarry hub (where everyone spawns) or a level.
// Moving between sites reloads the page; in a room the server tells everyone to move together.
import * as THREE from "three";
import RAPIER from "rapier";

await RAPIER.init();

const params = new URLSearchParams(location.search);
const SITE = ["farm", "river"].includes(params.get("site")) ? params.get("site") : "hub";
const SEED = { hub: 20261116, farm: 20261117, river: 20261118 }[SITE];
const TITLES = { farm: "Muddle Acres", river: "Rapid River" };
const DT = 1 / 60;
const LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname);
const SERVER = LOCAL ? "ws://localhost:8788" : "wss://jobsite-rooms.frctop50.workers.dev";
const SYNC_VER = 3;

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
    { id: "lvl3", title: "3 · Switchback Ridge", x: 12, z: -44, locked: true },
    { id: "garage", title: "Garage", x: 46, z: -46, garage: true },
  ],
  mound: { x: 20, z: -12, r: 7, h: 3.2 },
  field: { x: -40, z: 34, r: 24 },
};
const FARM = {
  spawn: { x: 0, z: -72, yaw: 0 },
  sink: { x: 0, z: -8, r: 5.5, depth: 2.0 },
  bank: { x: -48, z: -4, r: 12, h: 4.5 },
  paddock: { x0: -66, x1: -30, z0: -30, z1: 22, gate: -4, gateW: 9 },
  pile: { x: -16, z: 26, r: 6.5 },
  hill: { x: 46, z: 52, top: 15, foot: 30, h: 10 },
  post: { x: 40, z: 41 },
  barn: { x: 46, z: 57, w: 13, d: 11, h: 7.5, door: 6.5, dh: 5 },
  stream: { z: -44, w: 4.5, depth: 1.1, fordW: 6 },
  stump: { x: 22, z: 14 },
  tractor: { x: 26, z: -44 },
  logs: [[-25.5, -4, 12, 0.5, 0.15], [-22.5, -10, 8, 0.36, -0.35], [-21.5, 1.5, 8.5, 0.36, 0.4], [-27, 6, 7.5, 0.34, 1.2]],   // x, z, length, radius, yaw
  trees: [[-12, -51], [11, -37], [33, -36], [18, -52], [-30, -37], [40, -50], [-8, 14], [16, 30], [-40, 30], [28, 4]],
};

const RIVER = {
  spawn: { x: 0, z: -70, yaw: 0 },
  mid: 5, water: -0.55,                                         // the river runs east-west across the middle
  ford: { x: 0, w: 12 },                                        // the shallows, where a causeway is practical
  bank: { x: -24, z: -22, r: 12, h: 4.2 },                      // loose dirt to build it with
  swamp: { z0: 30, z1: 56 },                                    // a boggy belt right across the far side
  depot: { x: -16, z: -58, r: 6.5 },
  crate: { x: 6, z: 68 },
  tool: { x: -58, z: 74 },
  rocks: [[-14, 20, 1.0], [10, 22, 0.9], [22, 19, 1.1], [-26, 24, 0.95], [4, 25, 1.05], [-6, 18, 0.9], [32, 24, 1.0], [-38, 20, 1.1], [16, 26, 0.95]],
  trees: [[40, -30], [-46, -40], [30, -56], [-40, -8], [36, -6], [-20, 34], [18, 42], [-34, 50], [36, 36], [0, 60], [-22, 62], [28, 62], [-64, 64], [50, 70]],
};
// how deep and how wide the river is at x: shallow and narrow at the ford, deep and wide elsewhere
function riverAt(x) { const sh = smooth(RIVER.ford.w + 8, RIVER.ford.w, Math.abs(x - RIVER.ford.x)); return { depth: lerp(3.4, 1.5, sh), half: lerp(8.5, 5, sh) }; }
function riverDesign(x, z) {
  const R = RIVER;
  let h = (noise(x / 44, z / 44) - 0.5) * 4 + (noise(x / 14 + 3, z / 14) - 0.5) * 1.2 + (noise(x / 5, z / 5) - 0.5) * 0.25 + 0.6;
  h += smooth(78, 94, Math.max(Math.abs(x), Math.abs(z))) * 12;
  const flat = (cx, cz, r, level) => { h = lerp(h, level, smooth(r + 10, r, Math.hypot(x - cx, z - cz))); };
  flat(R.spawn.x, R.spawn.z, 12, 0.3); flat(R.depot.x, R.depot.z, 8, 0.3); flat(R.bank.x, R.bank.z, R.bank.r + 2, 0.3);
  flat(R.crate.x, R.crate.z, 9, 0.4); flat(R.tool.x, R.tool.z, 6, 0.4);
  h = lerp(h, 0.3, smooth(9, 4, Math.abs(x)) * smooth(-72, -64, z) * smooth(74, 66, z));        // the road
  const inSwamp = smooth(R.swamp.z0 - 3, R.swamp.z0 + 1, z) * smooth(R.swamp.z1 + 3, R.swamp.z1 - 1, z);
  h = lerp(h, 0.05, inSwamp);
  const rv = riverAt(x), dz = Math.abs(z - R.mid);
  h = lerp(h, 0.3, smooth(rv.half + 12, rv.half + 3, dz));                                       // level banks
  h -= rv.depth * smooth(rv.half + 1, rv.half - 2.5, dz);
  const B = R.bank, loose = B.h * Math.max(0, 1 - (Math.hypot(x - B.x, z - B.z) / B.r) ** 1.6);
  return { h: h + loose, loose, mud: 2 * inSwamp };
}

function hubDesign(x, z) {
  let h = (noise(x / 46, z / 46) - 0.5) * 9 + (noise(x / 17 + 9, z / 17 + 4) - 0.5) * 2.6 + (noise(x / 6, z / 6) - 0.5) * 0.5;
  h += smooth(74, 94, Math.max(Math.abs(x), Math.abs(z))) * 16;                       // quarry walls
  const flat = (cx, cz, r, level) => { h = lerp(h, level, smooth(r + 12, r, Math.hypot(x - cx, z - cz))); };
  flat(0, 0, 14, 0);
  for (const hs of HUB.houses) flat(hs.x, hs.z, hs.garage ? 20 : 10, 0);
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
  return { h: h + loose, loose, mud: smooth(S.w + 3.5, S.w + 0.5, ds) };
}

// ---------- terrain grid ----------
const G = 384, CELL = 0.5, SIZE = G * CELL, HALF = SIZE / 2, CH = 32, NC = G / CH, W = G + 1;
const BEDROCK = 5;                            // how far below the original ground you can dig
const design = { hub: hubDesign, farm: farmDesign, river: riverDesign }[SITE];
// heights[zi + xi * W]: rows along z, columns along x, the layout Rapier's heightfield wants.
// firm[i] is the top of undisturbed ground: anything above it is loose dirt.
const heights = new Float32Array(W * W), base = new Float32Array(W * W), firm = new Float32Array(W * W),
  loose = new Uint8Array(W * W), mudA = new Float32Array(W * W), grav = new Uint8Array(W * W);
const sinkIdx = [], sinkTarget = [];
for (let xi = 0; xi <= G; xi++) for (let zi = 0; zi <= G; zi++) {
  const x = xi * CELL - HALF, z = zi * CELL - HALF, i = zi + xi * W, d = design(x, z);
  heights[i] = base[i] = d.h; firm[i] = d.h - d.loose; loose[i] = d.loose > 0.02 ? 1 : 0; mudA[i] = d.mud;
  if (SITE === "farm" && Math.hypot(x - FARM.sink.x, z - FARM.sink.z) < FARM.sink.r) { sinkIdx.push(i); sinkTarget.push(farmDesign(x, z, true).h - 0.1); }
}
function sample(arr, x, z) {
  const fx = clamp((x + HALF) / CELL, 0, G - 1e-4), fz = clamp((z + HALF) / CELL, 0, G - 1e-4);
  const xi = Math.floor(fx), zi = Math.floor(fz), tx = fx - xi, tz = fz - zi, i = zi + xi * W;
  return lerp(lerp(arr[i], arr[i + W], tx), lerp(arr[i + 1], arr[i + W + 1], tx), tz);
}
const heightAt = (x, z) => sample(heights, x, z);
const mudAt = (x, z) => sample(mudA, x, z);
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
  if (SITE === "river") {
    _c.copy(cGrass).lerp(cGrass2, noise(wx / 13 + 5, wz / 13));
    _c.lerp(cDirt, smooth(5.5, 3.5, Math.abs(wx)) * smooth(-72, -66, wz) * smooth(70, 64, wz));
    _c.lerp(cSand, smooth(-0.1, -0.9, hm));
    _c.lerp(cRock, smooth(1.0, 1.6, steep) * 0.7);
    return;
  }
  const F = FARM;
  _c.copy(cGrass).lerp(cGrass2, noise(wx / 13 + 5, wz / 13));
  let dirt = smooth(13, 10, Math.hypot(wx - F.sink.x, wz - F.sink.z));
  if (wz < -10) dirt = Math.max(dirt, smooth(5, 3.5, Math.abs(wx)));
  const P = F.paddock, inP = Math.min(wx - P.x0, P.x1 - wx, wz - P.z0, P.z1 - wz);
  dirt = Math.max(dirt, smooth(-1, 1, inP) * 0.8);
  _c.lerp(cDirt, dirt);
  _c.lerp(cRock, smooth(1.0, 1.6, steep) * 0.7);
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
    const l = loose[ia] + loose[ib] + loose[ic], m = (mudA[ia] + mudA[ib] + mudA[ic]) / 3;
    if (l) _c.lerp(cLoose, 0.3 * l);
    if (m > 0.05) _c.lerp(cMud, Math.min(1, m) * 0.85);
    const gv = grav[ia] + grav[ib] + grav[ic];
    if (gv) _c.lerp(cGravel, 0.3 * gv);
    _c.multiplyScalar(0.93 + hash2(ax * 3 + bx, az * 5 + cz) * 0.14);
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
function addHeight(xi, zi, dh, mine = true) {
  if (xi < 1 || zi < 1 || xi >= G || zi >= G) return 0;
  const i = zi + xi * W, h = Math.max(base[i] - BEDROCK, heights[i] + dh), d = h - heights[i];
  if (d === 0) return 0;
  heights[i] = h; loose[i] = 1; markDirty(xi, zi);
  if (h < firm[i]) firm[i] = h;
  if (mine) netEdits.set(i, (netEdits.get(i) || 0) + d);
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
function looseSlope(i) { return SITE === "river" && Math.abs((i % W) * CELL - HALF - RIVER.mid) < 11 && heights[i] < 0.9 ? 0.36 : 0.62; }
function relaxStep() {
  if (!active.on) return;
  if (--active.ttl <= 0) { active.on = false; return; }
  const x0 = Math.max(1, active.x0 - 5), x1 = Math.min(G - 1, active.x1 + 5), z0 = Math.max(1, active.z0 - 5), z1 = Math.min(G - 1, active.z1 + 5);
  let moved = false;
  const pair = (xa, za, xb, zb) => {
    const ia = za + xa * W, ib = zb + xb * W, d = heights[ia] - heights[ib], hi = d > 0 ? ia : ib;
    const over = Math.abs(d) - (heights[hi] - firm[hi] > 0.03 ? looseSlope(hi) : 1.5) * CELL;
    if (over <= 0.01) return;
    const took = -addHeight(d > 0 ? xa : xb, d > 0 ? za : zb, -over * 0.3);
    if (took > 0) { addHeight(d > 0 ? xb : xa, d > 0 ? zb : za, took); moved = true; }
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

function addCrate(x, z, sx, sy, sz, color, name, density) {
  const mesh = new THREE.Group(); scene.add(mesh);
  const bodyM = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), lam(color)); bodyM.castShadow = bodyM.receiveShadow = true; mesh.add(bodyM);
  for (const e of [1, -1]) { const band = new THREE.Mesh(new THREE.BoxGeometry(sx + 0.08, 0.16, sz + 0.08), lam(0x22262c)); band.position.y = e * sy * 0.3; mesh.add(band); }
  const skid = new THREE.Mesh(new THREE.BoxGeometry(sx + 0.3, 0.14, sz + 0.5), lam(0x6e5034)); skid.position.y = -sy / 2 - 0.05; skid.castShadow = true; mesh.add(skid);
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, heightAt(x, z) + sy / 2 + 0.3, z).setLinearDamping(0.3).setAngularDamping(1.5));
  world.createCollider(RAPIER.ColliderDesc.cuboid(sx / 2, sy / 2 + 0.06, sz / 2).setDensity(density).setFriction(0.2), body);
  return addProp({ type: "crate", name, body, mesh, r: Math.max(sx, sz) * 0.6, x, z, damp: 0.3,
    anchorsLocal: [new THREE.Vector3(0, 0, sz / 2), new THREE.Vector3(0, 0, -sz / 2), new THREE.Vector3(sx / 2, 0, 0), new THREE.Vector3(-sx / 2, 0, 0)] });
}

// ---------- build the site ----------
const houses = [];         // hub: level houses
let barn = null, barnDoor = null, sinkMarker = null, pileMarker = null, barnBeam = null;
const boulders = [], logs = [];
let stump = null, tractor = null, activeBoulders = 0;

if (SITE === "hub") {
  backdropTrees(150, 80, 93);
  for (const hs of HUB.houses) {
    const b = hs.garage
      ? building({ x: hs.x, z: hs.z, w: 30, d: 15, h: 7.5, door: 26, dh: 5.2, face: 1, wall: 0xc9ced6, roof: 0x7a54c7 })     // four bays wide
      : building({ x: hs.x, z: hs.z, w: 12, d: 10, h: 7, door: 6.5, dh: 4.8, face: 1, wall: hs.locked ? 0x9a9488 : 0xd9c39a, roof: hs.locked ? 0x5c6168 : hs.needs ? 0x2f6fb0 : 0xb4442e });
    houses.push({ ...hs, b });
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
  addPost(F.post.x, F.post.z);
  // paddock fence round the dirt bank, with a gate facing the yard
  {
    const P = F.paddock, rail = lam(0x8a6a44), y = 0.2;
    const fence = (x0, z0, x1, z1) => {
      const len = Math.hypot(x1 - x0, z1 - z0), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
      for (const ry of [0.55, 1.05]) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(alongX ? len : 0.12, 0.14, alongX ? 0.12 : len), rail);
        m.position.set(cx, y + ry, cz); m.castShadow = true; scene.add(m);
      }
      const n = Math.max(2, Math.round(len / 3));
      for (let k = 0; k <= n; k++) {
        const pm = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.4, 0.2), rail);
        pm.position.set(lerp(x0, x1, k / n), y + 0.6, lerp(z0, z1, k / n)); pm.castShadow = true; scene.add(pm);
      }
      world.createCollider(RAPIER.ColliderDesc.cuboid(alongX ? len / 2 : 0.12, 0.8, alongX ? 0.12 : len / 2).setTranslation(cx, y + 0.7, cz));
    };
    fence(P.x0, P.z0, P.x1, P.z0); fence(P.x0, P.z1, P.x1, P.z1); fence(P.x0, P.z0, P.x0, P.z1);
    fence(P.x1, P.z0, P.x1, P.gate - P.gateW / 2); fence(P.x1, P.gate + P.gateW / 2, P.x1, P.z1);
  }
  // the creek
  {
    const water = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, F.stream.w * 2 + 3), new THREE.MeshLambertMaterial({ color: 0x5d7f8c, transparent: true, opacity: 0.82 }));
    water.rotation.x = -Math.PI / 2; water.position.set(0, -0.62, F.stream.z); scene.add(water);
  }
  // decoration: a few logs already stacked behind the log pile
  for (let k = 0; k < 3; k++) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 5, 8).rotateZ(Math.PI / 2), barkMat);
    const z = F.pile.z + F.pile.r + 1.5;
    m.position.set(F.pile.x + (k === 1 ? 0 : (k - 1) * 0.35), heightAt(F.pile.x, z) + 0.33 + (k === 1 ? 0.55 : 0), z + (k === 1 ? 0 : (k - 1) * 0.35));
    m.castShadow = true; scene.add(m);
  }
  barn = building({ x: F.barn.x, z: F.barn.z, w: F.barn.w, d: F.barn.d, h: F.barn.h, door: F.barn.door, dh: F.barn.dh, face: -1, wall: 0xa8392c, roof: 0x5b5f66 });
  barn.sign.userData.draw("Barn", "Finish the jobs to open");
  barnDoor = new THREE.Mesh(new THREE.BoxGeometry(F.barn.door, F.barn.dh, 0.25), lam(0xe9e2d0));
  barnDoor.position.set(0, F.barn.dh / 2, F.barn.d / 2 + 0.05); barn.group.add(barnDoor);
  barnDoor.userData.collider = world.createCollider(RAPIER.ColliderDesc.cuboid(F.barn.door / 2, F.barn.dh / 2, 0.2).setTranslation(F.barn.x, barn.y0 + F.barn.dh / 2, F.barn.z - F.barn.d / 2));
  sinkMarker = marker(F.sink.x, F.sink.z, F.sink.r + 0.6, 0x5fd0ff);
  sinkMarker.ring.position.y = 0.1; sinkMarker.beam.position.y = 30;
  pileMarker = marker(F.pile.x, F.pile.z, F.pile.r, 0x8be28b);
  barnBeam = marker(F.barn.x, F.barn.z - F.barn.d / 2 - 2, 0.6, 0xffc928).beam; barnBeam.visible = false;
  // props, always in the same order so every player's copy matches
  for (const [x, z, len, rad, yaw] of F.logs) logs.push(addLog(x, z, len, rad, yaw));
  for (let i = 0; i < 20; i++) {
    const r = 0.95 + rng() * 0.35;
    for (let tries = 0; tries < 80; tries++) {
      const a = rng() * Math.PI * 2 + i * 1.3, d = 10 + rng() * 15, x = F.sink.x + Math.cos(a) * d, z = F.sink.z + Math.sin(a) * d;
      if (z < -34 || x < -26 || Math.hypot(x - F.hill.x, z - F.hill.z) < F.hill.foot + 2 || (Math.abs(x) < 4.5 && z < -14)) continue;
      if (props.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + r + 1)) continue;
      if (F.trees.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < 3)) continue;
      boulders.push(addRock(x, z, r, "boulder"));
      break;
    }
  }
  stump = addStump(F.stump.x, F.stump.z);
  tractor = addTractor(F.tractor.x, F.tractor.z);
}
// ----- level 2: Rapid River -----
let crate = null, toolbox = null, depotMarker = null, fordMarker = null;
const riverRocks = [], gravel = [];            // gravel: [prop index, x, z, radius] for every rock crushed
if (SITE === "river") {
  const R = RIVER;
  backdropTrees(130, 82, 94);
  for (const [x, z] of R.trees) addTree(x, z, 1.1 + rng() * 0.4);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, 22), new THREE.MeshLambertMaterial({ color: 0x3f7fa6, transparent: true, opacity: 0.85 }));
  water.rotation.x = -Math.PI / 2; water.position.set(0, R.water, R.mid); scene.add(water);
  fordMarker = marker(R.ford.x, R.mid - 9, 4.5, 0xffa23a);
  depotMarker = marker(R.depot.x, R.depot.z, R.depot.r, 0x8be28b);
  crate = addCrate(R.crate.x, R.crate.z, 2.2, 1.7, 2.6, 0xd64528, "generator", 150);
  toolbox = addCrate(R.tool.x, R.tool.z, 1.3, 0.9, 1.0, 0x3b8fe0, "toolbox", 260);
  for (const [x, z, r] of R.rocks) riverRocks.push(addRock(x, z, r, "rock"));
}
// Crushing a rock spreads it into a patch of gravel: firm footing over mud.
function layGravel(idx, x, z, r) {
  if (gravel.some((g) => g[0] === idx)) return;
  gravel.push([idx, r3(x), r3(z), r3(r)]);
  const p = props[idx];
  if (p && p.active) { p.active = false; p.body.setEnabled(false); p.mesh.visible = false; if (winch.on && winch.kind === 1 && winch.ref === idx) hookOff(); }
  const xa = Math.max(1, Math.floor((x - r + HALF) / CELL)), xb = Math.min(G - 1, Math.ceil((x + r + HALF) / CELL));
  const za = Math.max(1, Math.floor((z - r + HALF) / CELL)), zb = Math.min(G - 1, Math.ceil((z + r + HALF) / CELL));
  for (let xi = xa; xi <= xb; xi++) for (let zi = za; zi <= zb; zi++) {
    const d = Math.hypot(xi * CELL - HALF - x, zi * CELL - HALF - z);
    if (d > r) continue;
    const i = zi + xi * W;
    mudA[i] *= smooth(r * 0.75, r, d); if (d < r * 0.9) grav[i] = 1;
    markDirty(xi, zi);
  }
  for (let k = 0; k < 24; k++) spawnDirt(x + (Math.random() - 0.5) * 2, heightAt(x, z) + 0.6, z + (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 6, 3 + Math.random() * 3, (Math.random() - 0.5) * 6, 0);
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
const site0 = { hub: HUB.spawn, farm: FARM.spawn, river: RIVER.spawn }[SITE];
const spawnAt = (slot) => {
  const off = -7.5 + slot * 5, c = Math.cos(site0.yaw), s = Math.sin(site0.yaw);
  return { x: site0.x + off * c, z: site0.z - off * s, yaw: site0.yaw };
};

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
  const heap = new THREE.Mesh(new THREE.SphereGeometry(1, 9, 5), dirtMat);
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
  return { slot, paint, group, armPivot, bucketPivot, bucketParts, bucketColliders, heap, body, wheels, arm: -0.5, tilt: 0.1, steer: 0, speed: 0, load: 0, roll: 0,
    kind: "loader", vis: { loader: loaderVis, roller: rollerVis }, drums };
}
function setKind(ld, kind) {
  if (!KINDS[kind] || ld.kind === kind) return;
  ld.kind = kind;
  for (const k in ld.vis) for (const m of ld.vis[k]) m.visible = k === kind;
  for (const c of ld.bucketColliders) c.setEnabled(kind === "loader");
}
function disposeLoader(ld) { world.removeRigidBody(ld.body); scene.remove(ld.group); }

const me = makeLoader(0, true);
const chassis = me.body;
// Places to change vehicle: the garage in the quarry, and a vehicle yard near the start of each job.
const YARD = { farm: { x: 17, z: -70, r: 5.5 }, river: { x: 17, z: -68, r: 5.5 } }[SITE] || null;
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
} else if (YARD) {
  marker(YARD.x, YARD.z, YARD.r, 0xb48cff);
  displays.push(parkDisplay("roller", 2, YARD.x + 8.5, YARD.z + 1, -0.5));
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
  const f = ld.load / L.capacity;
  ld.heap.visible = f > 0.03;
  if (ld.heap.visible) ld.heap.scale.set(1.35, 0.2 + 0.95 * f, 0.45 + 0.25 * f);
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
const parts = { n: 0, x: new Float32Array(PMAX * 3), v: new Float32Array(PMAX * 3), vol: new Float32Array(PMAX), s: new Float32Array(PMAX) };
const partMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.17, 0), dirtMat, PMAX);
partMesh.count = 0; partMesh.frustumCulled = false; partMesh.castShadow = true; scene.add(partMesh);
function splat(x, z, vol) {
  const fx = (x + HALF) / CELL, fz = (z + HALF) / CELL, xi = Math.floor(fx), zi = Math.floor(fz), tx = fx - xi, tz = fz - zi, v = vol / (CELL * CELL);
  addHeight(xi, zi, v * (1 - tx) * (1 - tz)); addHeight(xi + 1, zi, v * tx * (1 - tz));
  addHeight(xi, zi + 1, v * (1 - tx) * tz); addHeight(xi + 1, zi + 1, v * tx * tz);
  touch(xi, zi);
}
function spawnDirt(px, py, pz, vx, vy, vz, vol) {
  if (parts.n >= PMAX) { if (vol) splat(px, pz, vol); return; }
  const i = parts.n++, o = i * 3;
  parts.x[o] = px; parts.x[o + 1] = py; parts.x[o + 2] = pz; parts.v[o] = vx; parts.v[o + 1] = vy; parts.v[o + 2] = vz;
  parts.vol[i] = vol; parts.s[i] = 0.7 + Math.random() * 0.9;
}
// vol 0 makes clods that are only for show (another player's dirt: their own game moves the ground)
const _pv = new THREE.Vector3(), _pd = new THREE.Vector3();
function pourFrom(matrix, vel, vol) {
  _pv.set((Math.random() - 0.5) * 2.6, 0.12, 0.85 + Math.random() * 0.45).applyMatrix4(matrix);
  _pd.setFromMatrixColumn(matrix, 2).multiplyScalar(1 + Math.random() * 0.8);
  spawnDirt(_pv.x, _pv.y, _pv.z, vel.x + _pd.x + (Math.random() - 0.5) * 0.5, vel.y + _pd.y, vel.z + _pd.z + (Math.random() - 0.5) * 0.5, vol);
}
function updateDirt() {
  for (let i = parts.n - 1; i >= 0; i--) {
    const o = i * 3, x = parts.x, v = parts.v;
    v[o + 1] -= 9.81 * DT;
    x[o] += v[o] * DT; x[o + 1] += v[o + 1] * DT; x[o + 2] += v[o + 2] * DT;
    if (x[o + 1] > heightAt(x[o], x[o + 2]) + 0.05) continue;
    if (parts.vol[i] > 0) splat(x[o], x[o + 2], parts.vol[i]);
    const l = --parts.n, lo = l * 3;                               // remove by moving the last clod into this slot
    x[o] = x[lo]; x[o + 1] = x[lo + 1]; x[o + 2] = x[lo + 2]; v[o] = v[lo]; v[o + 1] = v[lo + 1]; v[o + 2] = v[lo + 2];
    parts.vol[i] = parts.vol[l]; parts.s[i] = parts.s[l];
  }
}
let pourAcc = 0;

// Put a volume of dirt on the ground under a point of the bucket (lz metres out from its back), spread across its width.
function deposit(vol, lz) {
  for (const lx of [-1.1, -0.37, 0.37, 1.1]) {
    _rp.set(lx, 0, lz).applyMatrix4(_bw);
    splat(_rp.x, _rp.z, vol / 4);
  }
}

// Digging: ground that pokes up through the bucket floor is cut away. It fills the bucket first;
// once the bucket is full the rest is shoved ahead of the lip like a bulldozer.
const _bp = new THREE.Vector3();
function digStep() {
  const P = _bp.setFromMatrixPosition(_bw);
  let cut = 0, cutFirm = 0;
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
      const hard = heights[i] - soft - firm[i] < 1e-3 ? Math.min(over - soft, L.firmRate * DT) : 0;
      cut -= addHeight(xi, zi, -(soft + hard)) * CELL * CELL; cutFirm += hard * CELL * CELL; touch(xi, zi);
    }
  }
  me.cut = cut;
  if (cut > 0) {
    const take = Math.min(cut, L.capacity - me.load);
    me.load += take;
    if (cut - take > 1e-4) deposit(cut - take, 2.1);
    const v = chassis.linvel(), sp = Math.hypot(v.x, v.z);                          // moving dirt is hard work: it slows the loader
    if (sp > 0.05) { const j = Math.min(L.loadDrag * take + L.pushDrag * (cut - take) + L.firmDrag * cutFirm, L.mass * sp * 0.3) / sp; chassis.applyImpulse({ x: -v.x * j, y: 0, z: -v.z * j }, true); }
  }
  if (me.tilt < -0.12 && me.load > 0) {                                             // dirt starts sliding out as soon as the bucket tips forward
    const out = Math.min(me.load, L.pour * DT * clamp((-0.12 - me.tilt) / 0.45, 0.25, 1));
    me.load -= out; if (me.load < 1e-3) me.load = 0;
    pourAcc += out;
    const v = chassis.linvel();
    while (pourAcc >= PVOL || (me.load === 0 && pourAcc > 1e-5)) { const vol = Math.min(PVOL, pourAcc); pourAcc -= vol; pourFrom(_bw, v, vol); }
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
    const v = chassis.linvel(), j = Math.min(0.5, (4500 * m1 + 17000 * deep + 70000 * bog) * DT / L.mass) * L.mass;
    chassis.applyImpulse({ x: -v.x * j, y: 0, z: -v.z * j }, true);
  }
}

// Road roller: any rock that gets under the front drum is crushed into a patch of gravel.
const _ci = new THREE.Matrix4();
function rollStep(speed) {
  if (Math.abs(speed) < 0.3) return;
  const t = chassis.translation(), r = chassis.rotation();
  _ci.compose(_cp.set(t.x, t.y, t.z), _cq.set(r.x, r.y, r.z, r.w), _one).invert();
  for (const k of props) {
    if (!k.active || k.type !== "rock" || (net.online && k.owner !== net.id && k.owner !== 0)) continue;
    const p = k.body.translation();
    if (Math.abs(p.x - t.x) > 6 || Math.abs(p.z - t.z) > 6) { k.squash = 0; continue; }
    _rp.set(p.x, p.y, p.z).applyMatrix4(_ci);
    const under = Math.abs(_rp.x) < 1.5 + k.r * 0.4 && _rp.y < 0.6 && ((_rp.z > 0.4 && _rp.z < 2.8 + k.r) || (_rp.z < -0.4 && _rp.z > -2.6 - k.r));
    k.squash = under ? (k.squash || 0) + DT : 0;
    if (k.squash > 0.22) { k.squash = 0; layGravel(k.index, p.x, p.z, 2.8 + k.r * 1.7); }
  }
}
function switchPad() {
  const t = chassis.translation();
  if (SITE === "hub") { const gh = houses.find((h) => h.garage); return gh && gh.b.inside(t.x, t.z) ? "garage" : null; }
  return YARD && Math.hypot(t.x - YARD.x, t.z - YARD.z) < YARD.r ? "vehicle yard" : null;
}
const rollerUnlocked = () => SITE === "river" || !!(progress.farm && progress.farm.done);
function switchVehicle() {
  if (!switchPad() || Math.abs(me.speed) > 2) return;
  const next = me.kind === "loader" ? "roller" : "loader";
  if (next === "roller" && !rollerUnlocked()) return showBanner("<b>Road roller locked</b>Finish Muddle Acres to unlock it.", 3500);
  if (me.load > 0) { deposit(me.load, 1.6); me.load = 0; }
  setKind(me, next);
  try { localStorage.setItem("jobsite-kind", next); } catch {}
  showBanner(`<b>${KINDS[next].name[0].toUpperCase() + KINDS[next].name.slice(1)}</b>${next === "roller" ? "Drive over rocks to crush them into gravel. No bucket, same winch." : "Bucket and winch."}`, 4000);
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
  if (isLoader) { scoopAssist(speed); digStep(); } else rollStep(speed);
  groundStep();
  const against = input.fwd !== 0 && Math.sign(input.fwd) !== Math.sign(speed) && Math.abs(speed) > 1.2;
  const top = input.fwd > 0 ? KV.maxSpeed : KV.reverseSpeed;
  const force = input.fwd !== 0 && !against && !input.brake ? input.fwd * KV.engine * clamp(1.15 - Math.abs(speed) / top, 0, 1) : 0;
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
function winchStep() {
  if (winch.on) {
    const B = anchorPos(winch.kind, winch.ref, winch.local, _wb);
    if (!B) hookOff();
    else {
      const A = bodyPoint(chassis, HOOK, _wa);
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
const job = { time: 0, fill: 0, logsIn: 0, bouldersIn: 0, stumpPull: 0, stuck: 0, moved: false, ended: false };
function sinkDeficit() { let d = 0; for (let k = 0; k < sinkIdx.length; k++) d += Math.max(0, sinkTarget[k] - heights[sinkIdx[k]]); return d * CELL * CELL; }
const SINK_START = SITE === "farm" ? sinkDeficit() : 1;
function setFlag(f) { if (flags & f) return; flags |= f; onFlag(f); }
function onFlag(f) {
  if (f === FL.stump && stump) { stump.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true); showBanner("<b>Stump pulled!</b>Bonus job done.", 4000); }
  if (f === FL.tractor) showBanner(SITE === "river" ? "<b>Every rock crushed!</b>Bonus job done." : "<b>Tractor rescued!</b>Bonus job done.", 4000);
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
  return { t: "sync", ver: SYNC_VER, site: SITE, rk, tr, time: Math.round(job.time), flags, nb: activeBoulders, gv: gravel };
}
function applySync(s) {
  if (!s || s.ver !== SYNC_VER || s.site !== SITE || !Array.isArray(s.rk) || !Array.isArray(s.tr)) return;
  for (let k = 0; k + 1 < s.tr.length; k += 2) {
    const i = s.tr[k];
    if (i > 0 && i < heights.length) { heights[i] = s.tr[k + 1] / 1000; firm[i] = Math.min(firm[i], heights[i]); loose[i] = 1; markDirty(Math.floor(i / W), i % W); }
  }
  flushTerrain();
  if (SITE === "farm") setActiveBoulders(Math.max(activeBoulders, s.nb || 5));
  if (Array.isArray(s.gv)) for (const g of s.gv) layGravel(g[0], g[1], g[2], g[3]);
  for (let f = 1; f <= 64; f <<= 1) if (s.flags & f && f !== FL.done) setFlag(f);
  for (let n = 0; n < props.length && n * 7 + 6 < s.rk.length; n++) {
    const a = s.rk, o = n * 7, b = props[n].body;
    b.setTranslation({ x: a[o], y: a[o + 1], z: a[o + 2] }, true); b.setRotation({ x: a[o + 3], y: a[o + 4], z: a[o + 5], w: a[o + 6] }, true);
    if (b.isDynamic()) { b.setLinvel({ x: 0, y: 0, z: 0 }, true); b.setAngvel({ x: 0, y: 0, z: 0 }, true); }
  }
  job.time = s.time || 0;
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
  elRoster.style.display = net.online ? "block" : "none";
  elRoster.innerHTML = `<h2>Room ${net.room}</h2>` + list.map((p) => `<div><i style="background:#${COLORS[p.slot].toString(16).padStart(6, "0")}"></i>${esc(p.name)}${p.id === net.id ? " (you)" : ""}${p.id === net.hostId ? " &#9733;" : ""}</div>`).join("");
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
        me.slot = d.slot; me.paint.color.set(COLORS[d.slot]);
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
  const peer = net.peers.get(from);
  if (m.t !== "s" || !peer) return;
  peer.snaps.push({ at: performance.now(), p: m.p, q: m.q, a: m.a, b: m.b, w: m.w, l: m.l, v: m.v });
  if (peer.snaps.length > 12) peer.snaps.shift();
  peer.pos.set(m.p[0], m.p[1], m.p[2]);
  peer.h = Array.isArray(m.h) ? m.h : null;
  setKind(peer.loader, m.k === 1 ? "roller" : "loader");
  if (m.fl) for (let f = 1; f <= 64; f <<= 1) if (m.fl & f) setFlag(f);
  if (SITE === "farm" && m.nb > activeBoulders) setActiveBoulders(m.nb);
  if (Array.isArray(m.gv)) for (const g of m.gv) layGravel(g[0], g[1], g[2], g[3]);
  if (m.e) for (let k = 0; k + 1 < m.e.length; k += 2) { const i = m.e[k]; addHeight(Math.floor(i / W), i % W, m.e[k + 1] / 1000, false); }
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
  const m = { t: "s", p: [r3(t.x), r3(t.y), r3(t.z)], q: [r3(q.x), r3(q.y), r3(q.z), r3(q.w)], a: r3(me.arm), b: r3(me.tilt), w: r3(me.steer), l: r3(me.load), v: r3(me.speed), k: me.kind === "roller" ? 1 : 0 };
  if (winch.on) m.h = [winch.kind, winch.ref, r3(winch.local.x), r3(winch.local.y), r3(winch.local.z), r3(winch.len), Math.round(winch.T)];
  if (flags) m.fl = flags;
  if (SITE === "farm") m.nb = activeBoulders;
  if (gravel.length) m.gv = gravel;
  if (rk.length) m.r = rk;
  if (e.length) m.e = e;
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
    ld.arm = lerp(a.a, b.a, k); ld.tilt = lerp(a.b, b.b, k); ld.steer = lerp(a.w, b.w, k); ld.load = b.l; ld.speed = b.v;
    poseBucket(ld);
    if (b.b < -0.12 && b.l > 0.02) {
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
  const bonus = (flags & FL.stump ? 1 : 0) + (flags & FL.tractor ? 1 : 0);
  showBanner(`<b>Job complete!</b>${TITLES[SITE]} finished in ${clock(job.time)} with ${bonus} of 2 bonus jobs.<br>Heading back to the quarry&hellip;`, 8000);
  setTimeout(() => {
    if (net.online && net.hostId !== net.id) return;        // the host moves everyone
    const old = progress[SITE] || {};
    progress[SITE] = { done: true, best: Math.min(old.best || 1e9, Math.round(job.time)), bonus: Math.max(old.bonus || 0, bonus) };
    saveProgress();
    if (net.online) send({ t: "save", site: SITE, d: "" });          // the next visit starts the level fresh
    goSite("hub", "clear");
  }, 7000);
}

// ---------- input ----------
const keys = new Set();
const CAM_PITCH = 0.62, CAM_DIST = 19;
const cam = { yaw: 0, offset: 0, pitch: CAM_PITCH, dist: CAM_DIST, drag: false };
let hintsOn = true;
// ---------- controller ----------
// Standard (Xbox-style) layout. Left stick steers, triggers drive, bumpers move the arms,
// X / B curl and dump, A brakes, Y hooks the winch, D-pad up / down reels, right stick looks around.
const pad = { on: false, prev: [], rx: 0, ry: 0 };
const PAD_LABEL = { KeyW: "RT", KeyS: "LT", KeyA: "Left stick", KeyD: "", Space: "A", ArrowUp: "RB", ArrowDown: "LB", ArrowLeft: "X", ArrowRight: "B",
  KeyE: "Y", KeyQ: "D-pad &uarr;", KeyX: "D-pad &darr;", KeyF: "D-pad &rarr;", KeyR: "View", KeyC: "R3", KeyH: "Menu" };
function readPad() {
  const list = navigator.getGamepads ? navigator.getGamepads() : [];
  let gp = null;
  for (const g of list) if (g && g.connected && g.buttons.length >= 16) { gp = g; break; }
  if (!gp) { if (pad.on) { pad.on = false; refreshHelp(); } pad.rx = pad.ry = 0; return null; }
  const dz = (v) => (Math.abs(v) < 0.16 ? 0 : (v - Math.sign(v) * 0.16) / 0.84), b = (i) => (gp.buttons[i] ? gp.buttons[i].value : 0);
  const st = { lx: dz(gp.axes[0] || 0), rx: dz(gp.axes[2] || 0), ry: dz(gp.axes[3] || 0), b };
  const used = Math.abs(st.lx) + Math.abs(st.rx) + Math.abs(st.ry) > 0 || gp.buttons.some((x) => x.pressed);
  if (used && !pad.on) { pad.on = true; refreshHelp(); }
  // buttons that act once per press
  const hit = (i) => b(i) > 0.5 && !(pad.prev[i] > 0.5);
  if (pad.on) {
    if (elStart.style.display !== "none") { if (hit(0)) begin(); }
    else {
      if (hit(3)) toggleWinch();
      if (hit(15)) switchVehicle();
      if (hit(8)) resetLoader();
      if (hit(11) || hit(14)) { cam.offset = 0; cam.pitch = CAM_PITCH; cam.dist = CAM_DIST; }
      if (hit(9)) toggleHints();
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
  if (e.repeat) return;
  keys.add(e.code);
  if (e.code === "KeyR") resetLoader();
  if (e.code === "KeyC") { cam.offset = 0; cam.pitch = CAM_PITCH; cam.dist = CAM_DIST; }
  if (e.code === "KeyE" && running) toggleWinch();
  if (e.code === "KeyF" && running) switchVehicle();
  if (e.code === "KeyH") toggleHints();
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
const KEY_CODE = { W: "KeyW", A: "KeyA", S: "KeyS", D: "KeyD", E: "KeyE", Q: "KeyQ", X: "KeyX", F: "KeyF", R: "KeyR", H: "KeyH", C: "KeyC", Space: "Space",
  "&uarr;": "ArrowUp", "&darr;": "ArrowDown", "&larr;": "ArrowLeft", "&rarr;": "ArrowRight" };
const K = (k) => { const t = pad.on && KEY_CODE[k] ? PAD_LABEL[KEY_CODE[k]] : k; return t ? `<kbd>${t}</kbd>` : ""; };
const elHelp = document.getElementById("help"), HELP_KEYS = elHelp.innerHTML;
function refreshHelp() {
  elHelp.innerHTML = !pad.on ? HELP_KEYS : `<b>Controller</b><br>
    <kbd>Left stick</kbd> steer &nbsp; <kbd>RT</kbd> drive &nbsp; <kbd>LT</kbd> reverse &nbsp; <kbd>A</kbd> brake<br>
    <kbd>RB</kbd><kbd>LB</kbd> raise / lower arms &nbsp; <kbd>X</kbd><kbd>B</kbd> curl / dump<br>
    <kbd>Y</kbd> winch hook / unhook &nbsp; <kbd>D-pad &uarr;</kbd><kbd>&darr;</kbd> reel in / out<br>
    <kbd>D-pad &rarr;</kbd> switch vehicle &nbsp; <kbd>View</kbd> reset &nbsp; <kbd>Menu</kbd> hints<br>
    <kbd>Right stick</kbd> look &nbsp; <kbd>R3</kbd> recenter camera`;
  elHint.dataset.h = ""; elPrompt.dataset.h = "\u0000";       // redraw hint and prompt with the right labels
}
function setHint(html) {
  if (elHint.dataset.h === html) return;
  elHint.dataset.h = html; elHint.innerHTML = html ? `<span>&#128161;</span> ${html}` : "";
  elHint.style.display = hintsOn && html ? "block" : "none";
}
const isLocked = (hs) => !!hs.locked || (!!hs.needs && !(progress[hs.needs] && progress[hs.needs].done));
function refreshSigns() {
  for (const hs of houses) {
    const p = progress[hs.id];
    if (hs.garage) hs.b.sign.userData.draw(hs.title, "Switch vehicles here", "#c9a6ff");
    else if (isLocked(hs)) hs.b.sign.userData.draw(hs.title, hs.needs ? `Finish level ${hs.needs === "farm" ? 1 : 2} first` : "Locked", "#aab3be");
    else hs.b.sign.userData.draw(hs.title, p && p.done ? `★ Done in ${clock(p.best)}` : "Drive in to start", p && p.done ? "#8be28b" : "#ffc928");
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
  if (isLocked(hs)) { if (enter.t === 0) showBanner(`<b>${hs.title}</b>Finish the earlier jobs to unlock this one.`, 2500); enter.t = 1; return; }
  if (Math.abs(me.speed) > 0.8) { if (enter.t > 0) showBanner(`<b>${hs.title}</b>Stop inside to start.`, 1500); enter.t = 0; return; }
  const before = Math.ceil(2 - enter.t);
  enter.t += DT;
  const left = Math.ceil(2 - enter.t);
  if (left !== before || enter.t <= DT * 1.5) showBanner(`<b>${hs.title}</b>${left > 0 ? `Starting in ${left}&hellip; (drive out to cancel)` : "Let's go!"}`, 3000);
  if (enter.t >= 2 && enter.t - DT < 2) goSite(hs.id);
}
function farmStep() {
  // the stump comes out under enough pull: two winches, or one once it's been dug around
  if (!(flags & FL.stump)) {
    const sp = stump.body.translation();
    let drop = 0;
    for (let a = 0; a < 12; a++) {
      const x = sp.x + Math.cos(a) * 2.2, z = sp.z + Math.sin(a) * 2.2, fx = Math.round((x + HALF) / CELL), fz = Math.round((z + HALF) / CELL), i = fz + fx * W;
      drop += base[i] - heights[i];
    }
    const need = drop / 12 > 0.5 ? 28000 : 85000;
    job.stumpPull = pullOn(stump) > need ? job.stumpPull + DT : 0;
    if (job.stumpPull > 0.8) setFlag(FL.stump);
  }
  if (barnDoor.userData.open) barnDoor.position.x = lerp(barnDoor.position.x, FARM.barn.door + 0.2, 0.03);
  const t = chassis.translation();
  if (!job.moved && Math.hypot(t.x - FARM.spawn.x, t.z - FARM.spawn.z) > 8) job.moved = true;
  const mud = mudAt(t.x, t.z);
  job.stuck = mud > 0.3 && input.fwd !== 0 && Math.abs(me.speed) < 0.8 && !winch.on ? job.stuck + DT : Math.max(0, job.stuck - DT * 0.3);
  if (!job.ended) job.time += DT;
}
function checkFarm() {
  const F = FARM, hd = (p, x, z) => { const t = p.body.translation(); return Math.hypot(t.x - x, t.z - z); };
  job.logsIn = logs.filter((l) => hd(l, F.pile.x, F.pile.z) < F.pile.r).length;
  if (job.logsIn === logs.length) setFlag(FL.logs);
  const act = boulders.filter((b) => b.active);
  job.bouldersIn = act.filter((b) => hd(b, F.sink.x, F.sink.z) < F.sink.r + 0.5).length;
  if (job.bouldersIn >= act.length) setFlag(FL.boulders);
  let bvol = 0;
  for (const b of act) { const p = b.body.translation(); if (Math.hypot(p.x - F.sink.x, p.z - F.sink.z) < F.sink.r && p.y < 0.4) bvol += b.body.mass() / 260; }
  job.fill = clamp(1 - Math.max(0, sinkDeficit() - bvol) / SINK_START, 0, 1);
  if (job.fill >= 0.92) setFlag(FL.fill);
  if ((flags & (FL.logs | FL.boulders | FL.fill)) === (FL.logs | FL.boulders | FL.fill)) setFlag(FL.open);
  const t = chassis.translation();
  if (flags & FL.open && barn.inside(t.x, t.z)) setFlag(FL.done);
  const tp = tractor.body.translation();
  if (mudAt(tp.x, tp.z) < 0.12) setFlag(FL.tractor);
  sinkMarker.beam.visible = !(flags & FL.fill) || !(flags & FL.boulders);
  pileMarker.beam.visible = !(flags & FL.logs);
  const fillPct = flags & FL.fill ? 100 : Math.floor((job.fill / 0.92) * 100);
  elTasks.innerHTML = `<h2>Muddle Acres</h2>
    ${row(flags & FL.logs, `Drag the fallen trees to the log pile: ${Math.min(job.logsIn, logs.length)} / ${logs.length}`)}
    ${row(flags & FL.boulders, `Push the boulders into the sinkhole: ${Math.min(job.bouldersIn, act.length)} / ${act.length}`)}
    ${row(flags & FL.fill, `Fill the sinkhole: ${Math.min(100, fillPct)}%`)}
    ${row(flags & FL.done, flags & FL.open ? "Winch up the hill and drive into the barn" : "Then: winch up the hill to the barn", flags & FL.open ? "" : "sub")}
    <div class="sub" style="margin-top:6px">Bonus</div>
    ${row(flags & FL.stump, "Pull out the old stump (two winches, or dig round it)", "sub")}
    ${row(flags & FL.tractor, "Winch the stuck tractor out of the creek", "sub")}
    <div class="sub">Time ${clock(job.time)}</div>
    <button id="leave">Back to the quarry</button>`;
  setHint(farmHint());
}
function farmHint() {
  const t = chassis.translation();
  if (!job.moved) return `Welcome to Muddle Acres! Drive with ${K("W")}${K("A")}${K("S")}${K("D")}. Drag the mouse to look around.`;
  if (job.stuck > 1.5) return `Stuck in the mud? Turn your back to a tree (or a friend), press ${K("E")} to hook your winch, then hold ${K("Q")} to pull yourself out.`;
  if (!(flags & FL.logs)) {
    if (winch.on && winch.kind === 1 && props[winch.ref].type === "log") return `Hooked! Drive away to drag it, or brake and hold ${K("Q")} to reel it in. Leave it inside the <b class="g">log pile</b> (green ring), then press ${K("E")} to unhook.`;
    if (target && target.kind === 1 && props[target.ref].type === "log") return `Press ${K("E")} to hook your rear winch to the fallen tree.`;
    return "Fallen trees block the gate to the dirt bank (west of the yard). Your winch is on the <b>back</b> of the loader: turn your back to a tree, within 35 m.";
  }
  if (!(flags & FL.boulders)) return `Gate clear! Push the boulders into the <b class="b">sinkhole</b> (blue ring). Lower the bucket with ${K("&darr;")} and drive into them.`;
  if (!(flags & FL.fill)) return `Fill the rest of the sinkhole with dirt from the dirt bank: lower the bucket ${K("&darr;")} and drive into the bank, raise it ${K("&uarr;")}, then tip it ${K("&rarr;")} over the hole.`;
  if (!(flags & FL.done)) {
    const onTop = t.y > heightAt(FARM.hill.x, FARM.hill.z) - 1.5 && Math.hypot(t.x - FARM.hill.x, t.z - FARM.hill.z) < FARM.hill.top + 2;
    if (onTop) return `Made it! Unhook with ${K("E")} and drive into the barn to finish the job.`;
    if (winch.on && winch.kind === 2 && anchors[winch.ref].name === "winch post") return `Hold ${K("Q")} to winch yourself up. Keep the bucket raised so it doesn't dig into the slope.`;
    return `The barn on the hill is open! It's too steep to drive up. Back up to the slope, hook the <b>winch post</b> at the top with ${K("E")}, and hold ${K("Q")} to pull yourself up.`;
  }
  return "";
}
// ----- Rapid River rules -----
const safe = { x: RIVER.spawn.x, z: RIVER.spawn.z, yaw: 0, wet: 0 };
const smash = { i: -1, t: 0 };
const mineP = (p) => !net.online || p.owner === net.id || p.owner === 0;
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
    if ((smash.t += DT) > 0.4) { const k = props[hit], p = k.body.translation(); layGravel(hit, p.x, p.z, 2.8 + k.r * 1.7); smash.t = 0; smash.i = -1; }
  } else { smash.i = hit; smash.t = 0; }
  if (stepCount % 20 === 0) {
    for (const p of props) {                       // a crate that falls in deep water washes back to where it started
      if (!p.active || p.type !== "crate" || !mineP(p)) continue;
      const q = p.body.translation();
      p.wet = Math.abs(q.z - R.mid) < 11 && q.y < R.water - 0.6 ? (p.wet || 0) + 1 : 0;
      if (p.wet > 6) {
        p.wet = 0; if (winch.on && winch.kind === 1 && winch.ref === p.index) hookOff();
        p.body.setTranslation({ x: p.x, y: heightAt(p.x, p.z) + 1.2, z: p.z }, true); p.body.setLinvel({ x: 0, y: 0, z: 0 }, true); p.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        showBanner(`<b>The ${p.name} washed away</b>It has been put back where it started.`, 4000);
      }
    }
  }
  if (!job.moved && Math.hypot(t.x - R.spawn.x, t.z - R.spawn.z) > 8) job.moved = true;
  if (!job.ended) job.time += DT;
}
// how much of a belt (z0..z1) can be crossed: for each row, is there a strip 3.5 m wide that passes ok()?
function crossable(z0, z1, xr, ok) {
  let rows = 0, good = 0;
  for (let z = z0; z <= z1; z += 1) {
    rows++;
    let run = 0, pass = false;
    for (let x = -xr; x <= xr && !pass; x += 0.5) { run = ok(x, z) ? run + 1 : 0; if (run >= 7) pass = true; }
    if (pass) good++;
  }
  return good / rows;
}
function checkRiver() {
  const R = RIVER, at = (p, o) => { const t = p.body.translation(); return Math.hypot(t.x - o.x, t.z - o.z) < o.r; };
  job.fill = crossable(R.mid - 6, R.mid + 6, 22, (x, z) => heightAt(x, z) > R.water + 0.1);
  if (job.fill >= 1) setFlag(FL.logs);
  job.road = crossable(R.swamp.z0, R.swamp.z1, 60, (x, z) => mudAt(x, z) < 0.35);
  if (job.road >= 1) setFlag(FL.boulders);
  if (at(crate, R.depot)) setFlag(FL.done);
  if (at(toolbox, R.depot)) setFlag(FL.stump);
  const crushed = riverRocks.filter((k) => !k.active).length;
  if (crushed >= riverRocks.length) setFlag(FL.tractor);
  const built = !!(flags & FL.logs), paved = !!(flags & FL.boulders);
  fordMarker.beam.visible = !built; depotMarker.beam.visible = built && paved;
  const t = chassis.translation(), far = t.z > R.mid + 7, cp = crate.body.translation();
  elTasks.innerHTML = `<h2>Rapid River</h2>
    ${row(built, `Build a causeway across the river: ${built ? 100 : Math.floor(job.fill * 100)}%`)}
    ${row(paved, `Lay gravel across the swamp: ${paved ? 100 : Math.floor(job.road * 100)}% <span class="sub">(rocks crushed ${crushed} / ${riverRocks.length})</span>`, built ? "" : "sub")}
    ${row(flags & FL.done, "Bring the generator back to the depot", paved ? "" : "sub")}
    <div class="sub" style="margin-top:6px">Bonus</div>
    ${row(flags & FL.stump, "Bring the toolbox back to the depot too", "sub")}
    ${row(flags & FL.tractor, "Crush every rock", "sub")}
    <div class="sub">Time ${clock(job.time)}</div>
    <button id="leave">Back to the quarry</button>`;
  let h = "";
  const nearRock = riverRocks.some((k) => { if (!k.active) return false; const p = k.body.translation(); return Math.hypot(p.x - t.x, p.z - t.z) < 8; });
  if (!job.moved) h = "There is no bridge here. The depot needs its generator back from the far side of the river. Drive north.";
  else if (!built) h = me.load > 0.5
    ? `Tip the dirt ${K("&rarr;")} into the shallow water by the <b class="o">orange ring</b>. Keep going until a strip of dry ground reaches the far bank.`
    : `Build a causeway: fill your bucket at the <b>dirt bank</b> west of the road (lower the bucket ${K("&darr;")} and drive in), then dump it into the shallows at the <b class="o">orange ring</b>. Deep water sweeps you away.`;
  else if (!paved) {
    if (!far) h = "The causeway holds! Drive across.";
    else if (me.kind === "roller") h = "Roll over the rocks to crush them into gravel. A rock crushed on the swamp mud makes firm ground: push rocks onto the mud with a loader first, or nudge them with the drum.";
    else if (nearRock) h = `Push a rock onto the dark swamp mud. Then raise the bucket ${K("&uarr;")}, hang it over the rock and hold ${K("&darr;")} to smash it into gravel. The road roller from the <b class="p">vehicle yard</b> crushes rocks just by driving over them.`;
    else h = "The swamp ahead is too boggy to cross. Rocks crushed into gravel make firm ground: find the grey rocks on this bank.";
  } else if (!(flags & FL.done)) {
    if (winch.on && winch.kind === 1 && winch.ref === crate.index) h = `Tow it home: over your gravel, across the causeway, to the <b class="g">depot</b> (green ring). If it falls in deep water it washes back.`;
    else if (cp.z > R.mid) h = `Follow the road north to the red generator. Turn your back to it, hook it with ${K("E")} and tow it home.`;
    else h = `Nearly there: get the generator into the <b class="g">depot</b> (green ring) near where you started.`;
  }
  setHint(h);
}
const siteStep = { hub: () => hubStep(), farm: () => farmStep(), river: () => riverStep() }[SITE];
const siteCheck = { hub: () => checkHub(), farm: () => checkFarm(), river: () => checkRiver() }[SITE];
function checkHub() {
  const rows = houses.map((hs) => {
    const p = progress[hs.id];
    const lk = isLocked(hs);
    if (hs.garage) return `<div class="sub">&#128295; Garage: switch vehicle with ${K("F")}${rollerUnlocked() ? "" : " (road roller unlocks after job 1)"}</div>`;
    return `<div class="${p && p.done ? "done" : lk ? "sub" : ""}">${p && p.done ? "&#9733;" : lk ? "&#128274;" : "&#9675;"} ${hs.title}${p && p.done ? ` (${clock(p.best)})` : lk ? " (locked)" : ""}</div>`;
  }).join("");
  elTasks.innerHTML = `<h2>Quarry yard</h2><div class="sub">Drive into a house and stop to start a job.</div>${rows}<div class="sub" style="margin-top:6px">The rest of the quarry is a playground: dig, dump and push rocks anywhere.</div>`;
  setHint(net.online && net.roster.length > 1 ? "Your crew is here. Whoever drives into a job house takes everyone along." : `Drive to the <b>${(houses.find((h) => !h.garage && !isLocked(h) && !(progress[h.id] && progress[h.id].done)) || houses[0]).title}</b> house and stop inside to start the job. ${K("H")} hides hints.`);
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
  partMesh.instanceMatrix.needsUpdate = true;
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
  sun.target.position.copy(_target);
  sun.position.copy(_target).addScaledVector(SUN_DIR, 110);

  const fill = me.load / L.capacity;
  elFillBar.style.width = `${Math.round(fill * 100)}%`;
  elFillBar.style.background = fill > 0.98 ? "#8be28b" : "#c08a4a";
  elFillText.textContent = fill > 0.98 ? "Bucket full" : `Bucket ${Math.round(fill * 100)}%`;
  const kmh = Math.abs(me.speed) * 3.6;
  elFill.style.display = me.kind === "loader" ? "block" : "none";
  if (me.kind !== "loader") elGauges.innerHTML = `<b>${kmh.toFixed(0)}</b> km/h &nbsp; ${KINDS[me.kind].name}`;
  else elGauges.innerHTML = `<b>${kmh.toFixed(0)}</b> km/h &nbsp; arms ${Math.round(((me.arm - L.armMin) / (L.armMax - L.armMin)) * 100)}% &nbsp; bucket ${me.tilt > 0.25 ? "curled" : me.tilt < -0.12 ? "dumping" : "level"}`;
  let pr = "";
  if (winch.on) {
    const strain = winch.T / WINCH.tmax;
    pr = `Winch on <b>${winch.name}</b> &middot; rope ${winch.len.toFixed(0)} m ${strain > 0.95 ? '<span class="hot">&middot; full power</span>' : strain > 0.05 ? "&middot; pulling" : ""}<br>${K("Q")} reel in &nbsp; ${K("X")} let out &nbsp; ${K("E")} unhook`;
  } else if (target && running) pr = `${K("E")} hook winch to <b>${target.name}</b> (${target.dist.toFixed(0)} m)`;
  if (padNow && running) pr += `${pr ? "<br>" : ""}${K("F")} switch to the <b>${KINDS[me.kind === "loader" ? "roller" : "loader"].name}</b>${me.kind === "loader" && !rollerUnlocked() ? " (locked)" : ""}`;
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
netEdits.clear();
requestAnimationFrame(frame);

// ---------- lobby ----------
const elStart = document.getElementById("start"), elMsg = document.getElementById("msg"), elName = document.getElementById("name"), elCode = document.getElementById("code");
try { elName.value = localStorage.getItem("jobsite-name") || ""; } catch {}
function begin() { elStart.style.display = "none"; running = true; }
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
try { if (localStorage.getItem("jobsite-kind") === "roller" && rollerUnlocked()) setKind(me, "roller"); } catch {}
// arriving from another site: rejoin the room, or carry on solo
if (params.get("room") && /^[A-Z2-9]{4}$/.test(params.get("room"))) { elMsg.textContent = "Rejoining your crew…"; join(params.get("room")); }
else if (params.get("solo")) begin();

// hooks for automated checks
window.__game = { SITE, world, chassis, vehicle, props, anchors, boulders, logs, stump: () => stump, tractor: () => tractor, input, me, job, L, WINCH, FARM, HUB, net, winch, heights, heightAt, mudAt, slopeAt,
  physicsStep, syncVisuals, checkFarm, checkHub, resetLoader, placeLoader, cam, join, begin, buildSync, findTarget, toggleWinch, hookOff, setFlag, setActiveBoulders, houses, barn, enter, pad, tick, KINDS, setKind, switchVehicle, switchPad, displays, YARD, RIVER, layGravel, gravel, crate: () => crate, toolbox: () => toolbox, riverRocks, safe,
  get flags() { return flags; }, FL, parts, get target() { return target; }, get grip() { return gripNow; },
  run(steps, set = {}) { Object.assign(input, set); for (let i = 0; i < steps; i++) physicsStep(); syncVisuals(DT); target = !winch.on ? findTarget() : null; siteCheck(); },
  render() { renderer.render(scene, camera); } };
