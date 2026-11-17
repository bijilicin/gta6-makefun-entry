// Shared game state for Solmaris Heat. Every system reads and writes the
// single G object so modules stay decoupled: world builds into it, player,
// traffic, police and missions all act on it each frame.

export const WORLD = {
  half: 200,          // city spans -200..200 on both axes
  roadEvery: 80,      // a road line every 80 units
  roadWidth: 17,      // asphalt width
  beachZ: 208,        // sand starts here (south edge)
  oceanZ: 252,        // water starts here
};

export const G = {
  running: false,
  paused: false,
  over: false,
  time: 0,
  clockMinutes: 17 * 60 + 42,   // golden hour, creeps forward slowly
  money: 60,
  health: 100,
  maxHealth: 100,
  wanted: 0,                    // 0..5 stars
  crimeHeat: 0,                 // seconds since last crime (drives decay)
  hideoutCalm: 0,               // time spent calm inside a hideout zone
  hasGun: false,
  shotsFired: 0,
  carsStolen: 0,
  missionIndex: 0,              // next story mission to offer
  storyDone: false,
  mode: 'menu',                 // menu | foot | car | busted | wasted | won
  bustMeter: 0,
  damageFlash: 0,
  message: '',
  shot: null,                   // screenshot staging name, if any
  seed: 7,
};

let seedState = 1234567;
export function setSeed(n) { seedState = n >>> 0 || 1; G.seed = n; }
// Deterministic LCG so the city is the same on every visit and in screenshots.
export function rand() {
  seedState = (seedState * 1664525 + 1013904223) >>> 0;
  return seedState / 4294967296;
}
export function randRange(a, b) { return a + rand() * (b - a); }
export function randPick(list) { return list[Math.floor(rand() * list.length) % list.length]; }
export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function dist2d(ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return Math.sqrt(dx * dx + dz * dz); }
export function angleLerp(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
// Road lines sit at multiples of roadEvery inside the city.
export function roadLines() {
  const lines = [];
  for (let c = -WORLD.half; c <= WORLD.half; c += WORLD.roadEvery) lines.push(c);
  return lines;
}
export function nearestRoadCoord(v) {
  const lines = roadLines();
  let best = lines[0], bd = Infinity;
  for (const l of lines) { const d = Math.abs(l - v); if (d < bd) { bd = d; best = l; } }
  return best;
}
export function isOnRoad(x, z) {
  const w = WORLD.roadWidth / 2 + 1;
  if (Math.abs(nearestRoadCoord(x) - x) < w && Math.abs(z) <= WORLD.half + 8) return true;
  if (Math.abs(nearestRoadCoord(z) - z) < w && Math.abs(x) <= WORLD.half + 8) return true;
  return false;
}
export function commitCrime(amount, reason) {
  // amount is in "heat points": 100 points = one star.
  G.crimeHeat = 0;
  const before = G.wanted;
  const points = G.wanted * 100 + amount;
  G.wanted = clamp(Math.ceil(points / 100), 0, 5);
  if (reason && G.wanted > before) G.message = reason;
}
export function saveGame() {
  try {
    localStorage.setItem('solmarisHeatSaveV1', JSON.stringify({
      money: G.money, health: G.health, missionIndex: G.missionIndex,
      storyDone: G.storyDone, hasGun: G.hasGun, carsStolen: G.carsStolen,
    }));
  } catch (e) { /* storage may be unavailable; the game still runs */ }
}
export function loadGame() {
  try {
    const raw = localStorage.getItem('solmarisHeatSaveV1');
    if (!raw) return false;
    const s = JSON.parse(raw);
    G.money = s.money ?? G.money;
    G.health = clamp(s.health ?? 100, 10, 100);
    G.missionIndex = s.missionIndex ?? 0;
    G.storyDone = !!s.storyDone;
    G.hasGun = !!s.hasGun;
    G.carsStolen = s.carsStolen ?? 0;
    return true;
  } catch (e) { return false; }
}
export function hasSave() {
  try { return !!localStorage.getItem('solmarisHeatSaveV1'); } catch (e) { return false; }
}
