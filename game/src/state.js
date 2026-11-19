// Shared game state for Solmaris Heat v2. Every system reads and writes the
// single G object so modules stay decoupled: world builds into it, player,
// traffic, police and missions all act on it each frame. The v2 wanted model
// is information-based: police must SEE Rina (or a witness must report her)
// for the heat to stay up; break line of sight and the stars start flashing
// while a search zone closes around her last known position.

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
  displayedMoney: 60,           // HUD cash count-up chases this toward money
  health: 100,
  maxHealth: 100,
  armor: 0,
  wanted: 0,                    // 0..5 stars
  wantedState: 'clear',         // clear | seen | searching
  lastKnown: { x: -30, z: -30 },// where the PD last actually saw Rina
  seenTimer: 0,                 // seconds since a unit last had eyes on her
  searchTimer: 0,               // drains while searching; a star falls at zero
  searchRadius: 46,             // minimap search-zone radius (world units)
  crimeHeat: 0,                 // seconds since last crime
  lastDamageAt: -99,            // G.time of the last hit taken (regen gate)
  lastCrimeAt: -99,
  filmingWitnesses: 0,          // peds currently filming Rina (set by peds.js)
  hideoutCalm: 0,
  hasGun: false,
  magSize: 12,                  // pistol magazine size (never changes)
  ammoMag: 12,
  ammoReserve: 0,               // finite reserve ammo: 0 until the pistol is won, then 48
  reloading: 0,                 // seconds left on the current reload
  dryClicks: 0,                 // trigger pulls on an empty gun with an empty reserve
  shotsFired: 0,
  carsStolen: 0,
  resprayCount: 0,              // Rico's Respray visits (mission + free use)
  lastResprayAt: -99,
  radioStation: 0,              // 0 off, 1..3 stations (audio.js owns names)
  radioToastAt: -99,
  trafficPhase: 0,              // traffic-light cycle clock (world.js lights)
  missionIndex: 0,
  storyDone: false,
  // --- campaign v2 (story addendum): duo partner, boat, activities, stats
  partnerUnlocked: false,       // Nico Herrera rides along from mission 4
  boatUnlocked: false,          // Herrera's motorboat, from mission 9
  resprayDiscount: false,       // Rico's trade price after mission 4
  campaignDone: false,
  stashesFound: 0,
  stashTaken: [],               // indices into the hidden-stash list
  // --- round 3 side activities (activities.js): ledger pages + taxi
  ledgerPages: [],              // ids of Ledger Pages already collected
  ledgerBonusMid: false,        // halfway (15 pages) bonus already paid
  ledgerBonusFull: false,       // full-set (30 pages) bonus already paid
  faresDone: 0,                 // taxi fares completed (activities.js)
  taxiEarned: 0,                // lifetime taxi earnings, fares + tips
  taxiTips: 0,                  // lifetime tips alone
  taxiFails: 0,                 // fares that timed out or were abandoned
  taxiBestFare: 0,              // best single fare + tip ever paid
  // --- round 4 street races (races.js): Harbor Sprint & friends
  racesWon: 0,                  // street races finished 1st
  racesDone: 0,                 // street races finished (any placing)
  raceEarnings: 0,              // lifetime prize money from racing
  raceBestTimes: {},            // race id -> best finish time, seconds
  totalEarned: 0,
  timesBusted: 0,
  timesWasted: 0,
  rivalCars: [],                // mission-spawned hostile cars (drive-by targets)
  aiDriver: null,               // { car, route, i, done } — Nico at the wheel
  sunsetFrac: 0,                // finale light shift, applied by main
  playerBoat: null,             // the shared motorboat (set by main)
  mode: 'menu',                 // menu | foot | car | busted | wasted | won
  bustMeter: 0,
  damageFlash: 0,
  cameraShake: 0,
  message: '',
  shot: null,
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
// A GPS route along the street grid: from a point, snap to the nearest
// vertical avenue, run along it to the target's nearest horizontal street,
// then in to the target. Returned as waypoints for the minimap polyline.
export function gpsRoute(fromX, fromZ, toX, toZ) {
  const vx = nearestRoadCoord(fromX);
  const hz = nearestRoadCoord(toZ);
  return [
    { x: fromX, z: fromZ },
    { x: vx, z: fromZ },
    { x: vx, z: hz },
    { x: toX, z: hz },
    { x: toX, z: toZ },
  ];
}
// commitCrime(amount, reason, witnessed): witnessed crimes (a cop or a
// filming ped had eyes on Rina) raise a full extra chunk of heat; a crime
// nobody saw still counts, but less, and it does NOT refresh the PD's
// last-known position — information, not magic.
export function commitCrime(amount, reason, witnessed) {
  G.crimeHeat = 0;
  G.lastCrimeAt = G.time;
  const filming = G.filmingWitnesses > 0;
  let pts = amount;
  if (witnessed) pts *= 1.5;
  if (filming && amount >= 30) pts += 25;      // caught on a phone camera
  const before = G.wanted;
  const total = G.wanted * 100 + pts;
  G.wanted = clamp(Math.ceil(total / 100), 0, 5);
  if (G.wanted > 0 && witnessed) {
    G.wantedState = 'seen';
    G.seenTimer = 0;
    G.searchTimer = searchDuration();
  }
  if (reason && G.wanted > before) G.message = reason;
}
export function searchDuration() { return 5 + G.wanted * 3.2; }
// Dusk/night lamp factor (lighting adaptation): how strongly Solmaris's
// real street lights and vehicle headlights burn, derived purely from
// the HUD clock (G.clockMinutes). 0 = full day (lamps and headlights
// completely off), a partial plateau through the golden-hour dusk the
// game starts in, 1 = full night. Dawn mirrors dusk. This only scales
// light intensities and lamp emissives — it moves no sun, sky or fog,
// and touches no gameplay, story or save state.
export function lampScale() {
  const h = (((G.clockMinutes % 1440) + 1440) % 1440) / 60;
  if (h >= 6.5 && h < 16.5) return 0;                    // day
  if (h >= 16.5 && h < 18) return 0.55 * (h - 16.5) / 1.5;   // dusk ramp -> partial
  if (h >= 18 && h < 19) return 0.55 + 0.45 * (h - 18);      // dusk -> full night
  if (h >= 19 || h < 5) return 1;                       // night
  return 1 - (h - 5) / 1.5;                             // dawn ramp (05:00 -> 06:30)
}
// Called every frame by the police system with fresh sighting information.
export function reportSighting(x, z, anySeeing) {
  if (G.wanted === 0) { G.wantedState = 'clear'; return; }
  if (anySeeing) {
    G.lastKnown.x = x; G.lastKnown.z = z;
    G.wantedState = 'seen';
    G.seenTimer = 0;
    G.searchTimer = searchDuration();
  }
}
// Finite ammo economy: there is NO unlimited ammo anywhere for Rina's
// pistol. A reload (auto at an empty magazine, or R on foot) takes
// min(magSize - ammoMag, ammoReserve) rounds out of the finite reserve;
// with the reserve at 0 no reload can start and the trigger only clicks.
// Refills come from the world: +12 drops from downed police / armed peds,
// and 24 rounds for $50 at the PAWN shop.
export function startReload() {
  if (!G.hasGun || G.reloading > 0) return false;
  if (G.ammoMag >= G.magSize) return false;
  if (G.ammoReserve <= 0) return false;
  G.reloading = 0.9;            // reload time is unchanged: 0.9 s
  return true;
}
export function finishReload() {
  const need = G.magSize - G.ammoMag;
  const take = Math.min(need, Math.max(0, G.ammoReserve));
  G.ammoMag += take;
  G.ammoReserve -= take;
  G.reloading = 0;
  return take;
}
// Save format v2 (story addendum): key versioned so v1 saves never clash.
const SAVE_KEY = 'solmaris-save-v2';
export function saveGame() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      money: G.money, health: G.health, missionIndex: G.missionIndex,
      storyDone: G.storyDone, campaignDone: G.campaignDone, hasGun: G.hasGun,
      ammoReserve: G.ammoReserve,
      carsStolen: G.carsStolen, resprayCount: G.resprayCount,
      partnerUnlocked: G.partnerUnlocked, boatUnlocked: G.boatUnlocked,
      resprayDiscount: G.resprayDiscount, stashesFound: G.stashesFound,
      stashTaken: G.stashTaken, totalEarned: G.totalEarned,
      timesBusted: G.timesBusted, timesWasted: G.timesWasted,
      ledgerPages: G.ledgerPages, ledgerBonusMid: G.ledgerBonusMid,
      ledgerBonusFull: G.ledgerBonusFull, faresDone: G.faresDone,
      taxiEarned: G.taxiEarned, taxiTips: G.taxiTips,
      taxiFails: G.taxiFails, taxiBestFare: G.taxiBestFare,
      racesWon: G.racesWon, racesDone: G.racesDone,
      raceEarnings: G.raceEarnings, raceBestTimes: G.raceBestTimes,
    }));
  } catch (e) { /* storage may be unavailable; the game still runs */ }
}
export function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const s = JSON.parse(raw);
    G.money = s.money ?? G.money;
    G.displayedMoney = G.money;
    G.health = clamp(s.health ?? 100, 10, 100);
    G.missionIndex = s.missionIndex ?? 0;
    G.storyDone = !!s.storyDone;
    G.campaignDone = !!s.campaignDone;
    G.hasGun = !!s.hasGun;
    G.ammoMag = G.magSize; G.reloading = 0;   // a loaded save starts with a full magazine
    // finite reserve: a v2 save written before this field existed gets
    // the sensible default — a full starting reserve if Rina already
    // owns the pistol, nothing if she does not
    G.ammoReserve = (s.ammoReserve === undefined || s.ammoReserve === null)
      ? (G.hasGun ? 48 : 0)
      : Math.max(0, Math.floor(s.ammoReserve) || 0);
    G.carsStolen = s.carsStolen ?? 0;
    G.resprayCount = s.resprayCount ?? 0;
    G.partnerUnlocked = !!s.partnerUnlocked;
    G.boatUnlocked = !!s.boatUnlocked;
    G.resprayDiscount = !!s.resprayDiscount;
    G.stashesFound = s.stashesFound ?? 0;
    G.stashTaken = Array.isArray(s.stashTaken) ? s.stashTaken : [];
    G.totalEarned = s.totalEarned ?? 0;
    G.timesBusted = s.timesBusted ?? 0;
    G.timesWasted = s.timesWasted ?? 0;
    // round 3 activities: a save written before these fields existed
    // loads with an untouched ledger and no taxi history at all
    G.ledgerPages = Array.isArray(s.ledgerPages)
      ? s.ledgerPages.filter((n) => Number.isInteger(n) && n >= 0 && n < 30)
      : [];
    G.ledgerBonusMid = !!s.ledgerBonusMid;
    G.ledgerBonusFull = !!s.ledgerBonusFull;
    G.faresDone = s.faresDone ?? 0;
    G.taxiEarned = s.taxiEarned ?? 0;
    G.taxiTips = s.taxiTips ?? 0;
    G.taxiFails = s.taxiFails ?? 0;
    G.taxiBestFare = s.taxiBestFare ?? 0;
    // round 4 street races: a save written before these fields
    // existed loads with an empty racing record — no wins, no
    // finishes, no earnings, and no best time on any board. Best
    // times are kept only when they are sane finish times keyed by
    // a race id string, so a hand-edited or damaged save can never
    // put a nonsense clock on the board.
    G.racesWon = Math.max(0, Math.floor(s.racesWon) || 0);
    G.racesDone = Math.max(0, Math.floor(s.racesDone) || 0);
    G.raceEarnings = Math.max(0, Math.floor(s.raceEarnings) || 0);
    G.raceBestTimes = {};
    if (s.raceBestTimes && typeof s.raceBestTimes === 'object' && !Array.isArray(s.raceBestTimes)) {
      for (const key of Object.keys(s.raceBestTimes)) {
        const t = s.raceBestTimes[key];
        if (typeof t === 'number' && Number.isFinite(t) && t > 5 && t < 3600) {
          G.raceBestTimes[key] = t;
        }
      }
    }
    return true;
  } catch (e) { return false; }
}
export function hasSave() {
  try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; }
}
