// Solmaris Heat — main loop and glue, Babylon.js port (v3 engine
// rewrite). Boots Babylon with a right-handed scene (so every heading
// and rotation from the three.js build carries over unchanged), PCF-soft
// shadows via the world shadow generator, ACES tone mapping and the
// DefaultRenderingPipeline (FXAA + low bloom + vignette + grain) in
// place of the old hand-rolled post pass — the ?shot= scenes render
// through the same pipeline (window.__postFx reports it live). Builds
// the city, spawns traffic, parked cars, pedestrians and the PD, then
// runs the frame: input -> player (foot / arcade drive / drive-by) ->
// respray -> traffic -> peds -> police (sightings, search, roadblocks,
// heli) -> missions -> wanted and health upkeep -> particles -> camera
// (over-shoulder / chase with FOV kick) -> HUD -> render. Also owns the
// screens, save/load and the staged ?shot= scenes used to take the
// entry's screenshots. Frame logic is otherwise identical to v2.1.

import { G, WORLD, clamp, commitCrime, dist2d, isOnRoad, searchDuration, setSeed, saveGame, loadGame, hasSave, lampScale, finishReload } from './state.js';
import { buildWorld, LANDMARKS, setTextureAnisotropy, C3, removeNode, uid, basicMat, pbrMat, boxMesh, sphereMesh, groupNode, markShadow } from './world.js';
import { spawnTraffic, spawnParked, CAR_COLORS, Boat, resolveVehicleOverlaps, lightbarParts } from './vehicles.js';
import { spawnPeds } from './peds.js';
import { PoliceSystem } from './police.js';
import { Player } from './player.js';
import { Nico } from './nico.js';
import { MissionSystem } from './missions.js';
import { Hud } from './hud.js';
import { SoundFX, STATIONS } from './audio.js';
import { ParticleSystem } from './particles.js';
import { Activities } from './activities.js';

const params = new URLSearchParams(window.location.search);
const shotName = params.get('shot');
const seedParam = parseInt(params.get('seed') || '7', 10);
setSeed(Number.isInteger(seedParam) ? seedParam : 7);
if (shotName) G.shot = shotName;

const canvas = document.getElementById('scene');
const engine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, 1.5));
const scene = new BABYLON.Scene(engine);
scene.useRightHandedSystem = true;   // three.js rotation conventions, unchanged
const camera = new BABYLON.FreeCamera('camera', new BABYLON.Vector3(-52, 14, -56), scene);
camera.minZ = 0.1;
camera.maxZ = 1500;
camera.fov = 62 * Math.PI / 180;
camera.inputs.clear();               // the game drives the camera itself
scene.activeCamera = camera;
const camTargetVec = new BABYLON.Vector3();
function camLookAt(x, y, z) { camTargetVec.set(x, y, z); camera.setTarget(camTargetVec); }
window.addEventListener('resize', () => { engine.resize(); });

setTextureAnisotropy(engine.getCaps().maxTextureAnisotropy);
const world = buildWorld(scene);

// Player headlight SpotLight — created here, before the police system
// adds its spots, so it sits inside the materials' 12-light shader cap
// (hemi + sun + fill + 8 pool lights + this headlight = 12). It is
// aimed every frame by updateHeadlight() further below.
const headlight = new BABYLON.SpotLight('playerHeadlight', new BABYLON.Vector3(0, -10, 0), new BABYLON.Vector3(0, 0, 1), 0.78, 1.6, scene);
headlight.diffuse = new BABYLON.Color3(1, 0.93, 0.78);
headlight.specular = new BABYLON.Color3(0.5, 0.48, 0.4);
headlight.range = 44;
headlight.intensity = 0;
headlight.shadowEnabled = false;

// ---------------- rendering pipeline (Babylon port of the v2.1 post pass)
// DefaultRenderingPipeline: FXAA, image processing (ACES tone mapping,
// exposure/contrast tuned to the old grade, vignette), low bloom that
// only catches sun glints and lightbars, and a whisper of animated
// grain. If pipeline creation fails, rendering falls back to the direct
// path and the game still runs (window.__postFx reports which is live).
let pipeline = null;
try {
  pipeline = new BABYLON.DefaultRenderingPipeline('defaultPipeline', true, scene, [camera]);
  pipeline.fxaaEnabled = true;
  pipeline.bloomEnabled = true;
  pipeline.bloomThreshold = 0.85;
  pipeline.bloomWeight = 0.35;
  pipeline.bloomKernel = 48;
  pipeline.bloomScale = 0.5;
  pipeline.imageProcessingEnabled = true;
  const ip = pipeline.imageProcessing;
  ip.toneMappingEnabled = true;
  ip.toneMappingType = BABYLON.ImageProcessingConfiguration.TONEMAPPING_ACES;
  ip.exposure = 1.02;
  ip.contrast = 1.08;
  ip.vignetteEnabled = true;
  ip.vignetteWeight = 1.15;
  ip.vignetteCameraFov = 0.62;
  try { pipeline.grainEnabled = true; pipeline.grain.intensity = 7; pipeline.grain.animated = true; } catch (e) { /* grain is garnish */ }
} catch (e) {
  pipeline = null;
}
window.__postFx = !!pipeline;
function renderFrame() {
  scene.render();
}

const trafficCars = spawnTraffic(scene, 15);
for (const v of trafficCars) v.wasTraffic = true;
const parkedCars = spawnParked(scene, 16);
const allCars = [...trafficCars, ...parkedCars];
G.missionCar = parkedCars.find(v => v.isMissionCar) || null;
G.colliders = world.colliders;
// Herrera's motorboat rides at the pier from the start (locked until M9)
const boat = new Boat(scene, 38, 264, Math.PI);
G.playerBoat = boat;
const peds = spawnPeds(scene, 30);
const police = new PoliceSystem(scene);
const player = new Player(scene);
const nico = new Nico(scene);
const missions = new MissionSystem(scene);
const hud = new Hud();
const fx = new SoundFX();
const particles = new ParticleSystem(scene);
// Round 3 side activities (Ledger Pages + taxi fares): built after the
// world, traffic and cast exist, and driven from the frame loop below.
const activities = new Activities(scene, hud, fx);
window.__activities = activities;

// ---------------- player headlight (lighting adaptation) ----------------
// One wide SpotLight (created above, right after the world), re-aimed
// every frame at the car Rina is driving (the Vice County pattern, in
// Solmaris terms): warm white, ~44 m range, angled slightly down at the
// road. Intensity follows lampScale() — partial at dusk, full at night,
// exactly 0 in daylight and on foot. The lamp meshes themselves glow
// via vehicles.js syncMesh.
function updateHeadlight() {
  const car = player.car;
  const scale = lampScale();
  if (car && !car.dead && scale > 0) {
    const fx2 = Math.sin(car.heading), fz2 = Math.cos(car.heading);
    headlight.position.set(car.x + fx2 * 1.9, 0.85, car.z + fz2 * 1.9);
    headlight.direction.set(fx2, -0.15, fz2);
    headlight.intensity = 320 * scale;
  } else {
    headlight.intensity = 0;
  }
}
// Verification hook (headless checks + the night lighting test): lets a
// test read the real pool/headlight state and move the HUD clock, the
// same way ?shot= staging moves the game. It changes nothing in play.
window.__lighting = {
  pool: world.lightPool, lampHeads: world.lampHeads, headlight,
  lampScale, G, player, world, scene, cars: allCars, police, missions, activities,
  saveGame, loadGame, peds,
  setClockMinutes(mins) { G.clockMinutes = mins; },
};

// gun tracer + muzzle flash
const fxLayer = {
  line: null, timer: 0,
  tracer(ox, oz, dx, dz, len, fromCar) {
    if (this.line) removeNode(this.line);
    const y = fromCar ? 1.15 : 1.5;
    this.line = BABYLON.MeshBuilder.CreateLines(uid('tracer'), {
      points: [
        new BABYLON.Vector3(ox + dx * 1.2, y, oz + dz * 1.2),
        new BABYLON.Vector3(ox + dx * len, y - 0.15, oz + dz * len),
      ],
    }, scene);
    this.line.color = C3(0xffe98a);
    this.line.isPickable = false;
    this.timer = 0.07;
    particles.muzzle(ox + dx * 1.3, y, oz + dz * 1.3);
  },
  update(dt) {
    if (this.timer > 0) { this.timer -= dt; if (this.timer <= 0 && this.line) { removeNode(this.line); this.line = null; } }
  },
};

// ---------------- input ----------------
const input = { w: false, a: false, s: false, d: false, shift: false, mouseDown: false };
const KEYMAP = { KeyW: 'w', ArrowUp: 'w', KeyA: 'a', ArrowLeft: 'a', KeyS: 's', ArrowDown: 's', KeyD: 'd', ArrowRight: 'd', ShiftLeft: 'shift', ShiftRight: 'shift', AltLeft: 'alt', AltRight: 'alt' };
let camYaw = Math.PI;
let camPitch = 0.32;
let mouseDown = false;
let lastShotAt = -99;

window.addEventListener('keydown', (e) => {
  if (KEYMAP[e.code]) { input[KEYMAP[e.code]] = true; e.preventDefault(); }
  if (e.code === 'KeyE' && G.running && !G.paused && !hud.fullMapOpen) tryEnterExit();
  if (e.code === 'KeyF' && G.running && !G.paused && !hud.fullMapOpen) doAttack();
  if (e.code === 'Space' && G.running && !G.paused && !hud.fullMapOpen) { doShoot(); e.preventDefault(); }
  if ((e.code === 'KeyR' || e.code === 'BracketRight' || e.code === 'BracketLeft') && G.running && !G.paused && !hud.fullMapOpen && player.car) {
    const dir = e.code === 'BracketLeft' ? -1 : 1;
    const st = fx.cycleStation(dir);
    G.radioStation = st.id;
    hud.radio(st.name);
  }
  // R on foot is the manual reload: tops the magazine up from the
  // finite reserve (in a car R stays the radio, as above)
  if (e.code === 'KeyR' && G.running && !G.paused && !hud.fullMapOpen && !player.car && !player.boat && G.hasGun) {
    if (player.tryReload()) hud.toast('RELOADING…', 0.9);
    else if (G.ammoMag < G.magSize && G.ammoReserve <= 0) hud.toast('NO AMMO — loot drops (+12) or buy at the PAWN shop (24 for $50)', 2.6);
  }
  if (e.code === 'KeyT' && G.running && !G.paused && !hud.fullMapOpen) activities.handleTKey(player);
  if (e.code === 'KeyM' && G.running && !G.over) { toggleMap(); return; }
  if ((e.code === 'KeyP' || e.code === 'Escape') && G.running) {
    if (hud.fullMapOpen) { toggleMap(false); return; }
    togglePause();
  }
  if (e.code === 'KeyN') { const m = fx.toggleMute(); hud.toast(m ? 'SOUND OFF' : 'SOUND ON', 1.2); }
});
window.addEventListener('keyup', (e) => { if (KEYMAP[e.code]) input[KEYMAP[e.code]] = false; });
window.addEventListener('blur', () => { for (const k of Object.keys(input)) input[k] = false; mouseDown = false; input.mouseDown = false; });
canvas.addEventListener('mousedown', (e) => {
  mouseDown = true; input.mouseDown = true;
  if (G.running && !G.paused && !hud.fullMapOpen && e.button === 0) {
    doAttack();
    // pointer-lock mouse look: the camera follows the mouse without
    // stopping at the window edge (falls back to plain movementX
    // tracking where lock is unavailable or declined)
    if (document.pointerLockElement !== canvas) {
      try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (err) { /* plain tracking */ }
    }
  }
});
window.addEventListener('mouseup', () => { mouseDown = false; input.mouseDown = false; });
let lastMouseT = -99;
window.addEventListener('mousemove', (e) => {
  if (!G.running || G.paused || hud.fullMapOpen) return;
  camYaw -= e.movementX * 0.0032;
  camPitch = clamp(camPitch + e.movementY * 0.002, 0.08, 0.9);
  lastMouseT = G.time;
});
// In pointer lock the browser swallows ESC to drop the lock; treat the
// unlock itself as the pause/map-close gesture, exactly like ESC.
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === canvas || !G.running || G.paused || G.over) return;
  if (hud.fullMapOpen) { toggleMap(false); return; }
  togglePause();
});

// ---------------- actions ----------------
// PAWN shop ammo counter: E at the door point (LANDMARKS.pawn) buys a
// 24-round box for $50 into the finite reserve. No pistol yet, or not
// enough cash, and the sale is refused with a toast — money never moves.
function tryBuyAmmo() {
  if (!G.hasGun) { hud.toast('NO PISTOL YET — win Tito\'s Beach Sprint first', 2.6); return false; }
  if (dist2d(player.x, player.z, LANDMARKS.pawn.x, LANDMARKS.pawn.z) >= 5) return false;
  if (G.money < 50) { hud.toast('NOT ENOUGH CASH — ammo is 24 rounds for $50', 2.6); if (fx) fx.fail(); return false; }
  G.money -= 50;
  G.ammoReserve += 24;
  if (fx) fx.pickup();
  hud.toast(`AMMO +24 · PAWN SHOP — RESERVE ${G.ammoReserve}`, 2.6);
  saveGame();
  return true;
}
function tryEnterExit() {
  if (respray.active) return;
  // the pawn counter comes first at its door: E there is a purchase,
  // not a car entry, even if a car happens to be parked alongside
  if (!player.car && !player.boat && dist2d(player.x, player.z, LANDMARKS.pawn.x, LANDMARKS.pawn.z) < 5) { tryBuyAmmo(); return; }
  if (player.car) { player.exitCar(fx); return; }
  if (player.boat) {
    // docking: only alongside the pier boards
    if (dist2d(player.boat.x, player.boat.z, 31, 256) < 11) player.exitBoat(fx);
    return;
  }
  const v = player.nearestCar(allCars, 4.2);
  if (v) {
    player.enterCar(v, fx);
    if (v.wasTraffic) v.wasTraffic = false;
    return;
  }
  if (G.boatUnlocked && dist2d(player.x, player.z, boat.x, boat.z) < 6.5) {
    player.enterBoat(boat, fx);
    hud.toast('Herrera\'s boat — W/S throttle, A/D rudder. E at the pier to dock.', 3);
  }
}
function doPunch() {
  const hit = player.punch(allCars, peds, fx);
  if (hit && hit.type === 'car') fx.crash();
}
// F / left click: the context attack — shoot (or drive-by in a car)
// while armed, punch while unarmed. Space stays fire-only.
function doAttack() {
  if (G.hasGun) doShoot(); else doPunch();
}
function doShoot() {
  if (player.car) {
    const hit = player.driveBy(allCars, peds, police.units, fx, fxLayer);
    if (hit || G.hasGun) lastShotAt = G.time;
  } else {
    const hit = player.shoot(allCars, peds, police.units, fx, fxLayer);
    if (hit || G.hasGun) lastShotAt = G.time;
  }
}
function hurtPlayer(amount) { player.hurt(amount); }

// ---------------- Rico's Respray ----------------
const respray = { active: false, t: 0, dur: 3.2 };
function updateRespray(dt) {
  const car = player.car;
  if (respray.active) {
    respray.t += dt;
    car.speed = 0;
    hud.respray(true, respray.t / respray.dur);
    if (respray.t >= respray.dur) {
      respray.active = false;
      hud.respray(false, 0);
      const cost = Math.min(G.money, G.resprayDiscount ? 50 : 100);
      G.money -= cost;
      car.health = 100;
      car.tireBlown = 0;
      car.fireTimer = 0;
      car.flaming = false;
      let ci = Math.floor(Math.random() * CAR_COLORS.length);
      if (CAR_COLORS[ci] === car.paintHex()) ci = (ci + 3) % CAR_COLORS.length;
      car.setColor(CAR_COLORS[ci]);
      G.wanted = 0;
      G.wantedState = 'clear';
      G.bustMeter = 0;
      G.resprayCount++;
      G.lastResprayAt = G.time;
      hud.toast(`RESPRAYED — $${cost}. Rico: "What police?"`, 2.6);
      saveGame();
    }
    return true;
  }
  if (car && !car.dead && dist2d(car.x, car.z, LANDMARKS.respray.x, LANDMARKS.respray.z) < 6.5 && Math.abs(car.speed) < 1.2) {
    if (G.wanted > 0 || car.health < 99 || car.tireBlown) {
      respray.active = true;
      respray.t = 0;
      fx.spray();
      hud.respray(true, 0);
      return true;
    }
  }
  return false;
}

// ---------------- ammo drops (+12) ----------------
// Finite-ammo refill from the street, following the stash/case pickup
// pattern in missions.js: a small visible ammo box with a warm glow
// that bobs and spins where a police unit, a rival car or an armed ped
// went down. Walking (or driving) over it adds 12 rounds to the finite
// reserve. Each source drops once — flagged on the source object.
const ammoPickups = [];
function spawnAmmoDrop(x, z) {
  const grp = groupNode(scene);
  const box = boxMesh(scene, 0.62, 0.24, 0.42, pbrMat(scene, { color: 0x3a3f45, roughness: 0.5, metalness: 0.4 }));
  box.position.y = 0.22;
  markShadow(box, true, false);
  box.parent = grp;
  const lid = boxMesh(scene, 0.66, 0.1, 0.46, pbrMat(scene, { color: 0xd88f2c, roughness: 0.45, metalness: 0.3 }));
  lid.position.y = 0.38;
  lid.parent = grp;
  const glow = sphereMesh(scene, 0.34, 8, basicMat(scene, { color: 0xffb02a }));
  glow.position.y = 0.78;
  glow.parent = grp;
  grp.position.set(x, 0, z);
  ammoPickups.push({ mesh: grp, x, z, amount: 12, spin: Math.random() * 6 });
  return ammoPickups[ammoPickups.length - 1];
}
function checkAmmoDrops() {
  const tryDrop = (obj, x, z) => {
    if (!obj || obj._ammoDropped) return;
    obj._ammoDropped = true;
    spawnAmmoDrop(x, z);
  };
  for (const u of police.units) if (u.dead || u.health <= 0) tryDrop(u, u.x, u.z);
  for (const b of police.blockers) if (b.dead || b.health <= 0) tryDrop(b, b.x, b.z);
  for (const v of (G.rivalCars || [])) if (v.dead || v.health <= 0) tryDrop(v, v.x, v.z);
  // a ped counts as armed loot when it went down lethally (gunfire /
  // a fast car — knockDown(true) parks downTime far above the 4–8 s of
  // a punch knockdown, which drops nothing)
  for (const p of peds) if (p.state === 'down' && p.downTime > 100) tryDrop(p, p.pos.x, p.pos.z);
}
function updateAmmoPickups(dt) {
  for (let i = ammoPickups.length - 1; i >= 0; i--) {
    const d = ammoPickups[i];
    d.spin += dt * 2.2;
    d.mesh.rotation.y = d.spin;
    d.mesh.position.y = Math.sin(d.spin * 1.6) * 0.09;
    if (dist2d(player.x, player.z, d.x, d.z) < 2.7) {
      removeNode(d.mesh);
      ammoPickups.splice(i, 1);
      G.ammoReserve += d.amount;
      if (fx) fx.pickup();
      hud.toast(`AMMO +${d.amount} · RESERVE ${G.ammoReserve}`, 2.2);
      saveGame();
    }
  }
}
Object.assign(window.__lighting, { ammoPickups, spawnAmmoDrop, tryBuyAmmo, pawn: LANDMARKS.pawn });

// ---------------- screens ----------------
const screens = {
  start: document.getElementById('startscreen'),
  pause: document.getElementById('pausescreen'),
  end: document.getElementById('endscreen'),
};
function showScreen(which) {
  screens.start.classList.toggle('hidden', which !== 'start');
  screens.pause.classList.toggle('hidden', which !== 'pause');
  screens.end.classList.toggle('hidden', which !== 'end');
}
function startGame(fresh) {
  fx.ensure();
  if (fresh) {
    G.money = 60; G.displayedMoney = 60; G.health = 100; G.missionIndex = 0; G.storyDone = false; G.hasGun = false; G.ammoMag = G.magSize; G.ammoReserve = 0; G.reloading = 0; G.dryClicks = 0; G.wanted = 0; G.wantedState = 'clear';
  } else {
    loadGame();
  }
  if (fresh) {
    G.partnerUnlocked = false; G.boatUnlocked = false; G.resprayDiscount = false;
    G.campaignDone = false; G.stashesFound = 0; G.stashTaken = [];
    G.totalEarned = 0; G.timesBusted = 0; G.timesWasted = 0; G.carsStolen = 0; G.resprayCount = 0;
    missions.resetCampaign();
    activities.resetAll();
  } else {
    missions.restoreStashes();
    activities.restoreFromSave();
  }
  G.running = true; G.paused = false; G.over = false;
  G.mode = 'foot';
  document.body.classList.remove('ended');
  player.placeAt(-30, -30, Math.PI * 0.75);
  showScreen(null);
  hud.show();
  hud.toast(fresh ? 'Welcome to Solmaris, Rina' : 'Welcome back, Rina', 3);
}
// Full-screen city map (M / pause menu): the world freezes while it is
// open, exactly like a GTA map screen; closing returns to the game.
function toggleMap(force) {
  const open = force !== undefined ? force : !hud.fullMapOpen;
  if (open) { G.paused = false; showScreen(null); }
  hud.setFullMap(open);
}
function togglePause() {
  if (G.over) return;
  if (hud.fullMapOpen) { toggleMap(false); return; }
  G.paused = !G.paused;
  if (G.paused) {
    if (document.pointerLockElement) document.exitPointerLock();
    document.getElementById('pausestats').textContent =
      `Cash $${G.money} · Jobs done ${G.missionIndex}/10 · Cars stolen ${G.carsStolen} · Shots fired ${G.shotsFired} · Resprays ${G.resprayCount} · Stashes ${G.stashesFound}/10 · Ledger pages ${activities.collectedCount()}/30 · Taxi fares ${G.faresDone} (${'$' + (G.taxiEarned || 0)}) · Busted ${G.timesBusted} · Wasted ${G.timesWasted}`;
    showScreen('pause');
  } else showScreen(null);
}
function endRun(kind) {
  G.over = true;
  activities.cancelActiveFare();
  police.clearAll();
  G.wanted = 0;
  G.wantedState = 'clear';
  document.body.classList.add('ended');
  const title = document.getElementById('endtitle');
  const text = document.getElementById('endtext');
  if (kind === 'busted') G.timesBusted++; else G.timesWasted++;
  if (kind === 'busted') {
    const fine = Math.min(G.money, 150 + G.missionIndex * 40);
    G.money -= fine;
    title.textContent = 'BUSTED';
    text.textContent = `The Solmaris PD finally pinned Rina down. Bail and fines cost her $${fine}. She walks out at dawn, poorer and wiser.`;
  } else {
    G.money = Math.max(0, G.money - 200);
    title.textContent = 'WASTED';
    text.textContent = 'Rina wakes up at Solmaris General with a $200 hospital bill and a story she will not be telling Mama Rosa.';
  }
  G.health = 100; G.bustMeter = 0;
  if (player.car) player.exitCar(null);
  if (player.boat) player.exitBoat(null);
  if (missions.active) missions.fail(null, [], 'The run ended.');
  player.placeAt(LANDMARKS.hospital.x, LANDMARKS.hospital.z, 0);
  saveGame();
  showScreen('end');
}
document.getElementById('btn-new').addEventListener('click', () => startGame(true));
document.getElementById('btn-continue').addEventListener('click', () => startGame(false));
document.getElementById('btn-resume').addEventListener('click', togglePause);
document.getElementById('btn-map').addEventListener('click', () => toggleMap(true));
document.getElementById('btn-save').addEventListener('click', () => { saveGame(); hud.toast('GAME SAVED', 1.6); });
document.getElementById('btn-restart').addEventListener('click', () => { G.paused = false; startGame(true); });
document.getElementById('btn-again').addEventListener('click', () => { G.over = false; document.body.classList.remove('ended'); showScreen(null); });
if (!hasSave()) document.getElementById('btn-continue').style.opacity = 0.45;

// ---------------- wanted / health upkeep ----------------
function updateWanted(dt) {
  G.crimeHeat += dt;
  G.seenTimer += dt;
  if (G.wanted > 0) {
    if (G.wantedState === 'seen' && G.seenTimer > 0.7) {
      G.wantedState = 'searching';
      G.searchTimer = searchDuration();
      G.searchRadius = 40 + G.wanted * 9;
    }
    if (G.wantedState === 'searching') {
      const dZone = dist2d(player.x, player.z, G.lastKnown.x, G.lastKnown.z);
      let rate = 1;
      if (dZone > G.searchRadius) rate = 2.1;                                  // slipped the zone
      if (dist2d(player.x, player.z, LANDMARKS.hideout.x, LANDMARKS.hideout.z) < 16) rate = Math.max(rate, 1.9);
      G.searchTimer -= dt * rate;
      if (G.searchTimer <= 0) {
        G.wanted--;
        if (G.wanted <= 0) {
          G.wanted = 0;
          G.wantedState = 'clear';
          hud.toast('Heat is off. For now.', 2);
        } else {
          G.searchTimer = searchDuration();
        }
      }
    }
  }
  // health regen to 50% once out of combat for a few seconds
  if (G.health > 0 && G.health < 50 && G.time - G.lastDamageAt > 5) {
    G.health = Math.min(50, G.health + 7 * dt);
  }
  // hospital door: full heal, free, if she walks in calm
  if (!player.car && G.wanted === 0 && G.health < 100 && dist2d(player.x, player.z, LANDMARKS.hospital.x, LANDMARKS.hospital.z) < 7) {
    G.health = 100;
    hud.toast('Solmaris General patched Rina up — no charge', 2.2);
  }
  if (G.bustMeter >= 1) endRun('busted');
  if (G.health <= 0) endRun('wasted');
}

function updateCarContacts(dt) {
  const pc = player.car;
  if (!pc) return;
  for (const v of allCars) {
    if (v === pc || v.dead) continue;
    if (dist2d(pc.x, pc.z, v.x, v.z) < 3.4) {
      const impact = Math.abs(pc.speed) + Math.abs(v.speed);
      // camera fix: a brush or slow nudge (impact <= 11) is not a crash
      // at all — no damage, no crime heat, no speed cut and above all
      // no camera shake. Only a genuinely hard car-to-car hit runs the
      // old crash path, and even that feeds a smaller, capped shake.
      if (impact > 11) {
        v.health -= impact * 1.1; pc.health -= impact * 0.5;
        hurtPlayer(impact * 0.22);
        commitCrime(35, 'Hit and run!', police.units.length > 0 || G.filmingWitnesses > 0);
        fx.crash();
        particles.sparks(pc.x, pc.z);
        G.cameraShake = Math.min(0.3, G.cameraShake + (impact - 11) * 0.016);
        v.speed = pc.speed * 0.4;
        pc.speed *= 0.45;
      }
    }
  }
  for (const p of peds) {
    if (p.state === 'down') continue;
    if (dist2d(pc.x, pc.z, p.pos.x, p.pos.z) < 2.3 && Math.abs(pc.speed) > 3) {
      p.knockDown(Math.abs(pc.speed) > 12);
      hurtPlayer(1);
      commitCrime(80, 'Pedestrian down!', true);
      fx.crash();
    }
  }
  for (const u of police.units) {
    if (dist2d(pc.x, pc.z, u.x, u.z) < 3.6 && Math.abs(pc.speed) > 8) hurtPlayer(2.2);
  }
}

// explosions, fire and smoke for every car, chained
function updateVehicleDrama(dt) {
  for (const v of allCars) {
    if (v.smoking) {
      v.smoking = false;
      particles.smoke(v.x, v.z, v.damageStage() >= 2);
    }
    if (v.flaming && !v.dead) {
      if (Math.random() < dt * 16) particles.fire(v.x, v.z, false);
      if (Math.random() < dt * 5) particles.smoke(v.x, v.z, true);
    }
    if (v.explodeEvent) {
      v.explodeEvent = false;
      v.health = 0;
      v.syncMesh(0);
      particles.explosion(v.x, v.z);
      fx.explosion();
      G.cameraShake = Math.min(0.3, G.cameraShake + 0.22);
      const dp = dist2d(player.x, player.z, v.x, v.z);
      if (player.car !== v && dp < 10) hurtPlayer((10 - dp) * 2.4);
      for (const o of allCars) {
        if (o !== v && !o.dead && dist2d(o.x, o.z, v.x, v.z) < 7) o.health -= 42;   // chain reaction
      }
      for (const p of peds) {
        if (p.state !== 'down' && dist2d(p.pos.x, p.pos.z, v.x, v.z) < 6) p.knockDown(false);
      }
      if (v !== player.car) commitCrime(55, 'Explosion!', police.units.length > 0);
      if (player.car === v) {
        hurtPlayer(18);
        hud.toast('BAIL OUT — she barely made it!', 2.4);
        player.exitCar(null);
      }
    }
    if (v.tireEvent) {
      v.tireEvent = false;
      if (v === player.car) { hud.toast('TIRE BLOWN — she pulls to one side!', 2.2); fx.scrape(); }
    }
    if (v.honkEvent) {
      v.honkEvent = false;
      if (dist2d(v.x, v.z, player.x, player.z) < 32) fx.honk();
    }
  }
}

// tire smoke, skid marks, off-road dust for the player's car
let skidTick = 0;
function updatePlayerCarFx(dt) {
  const car = player.car;
  if (!car) return;
  skidTick++;
  const drifting = car.handbrake || car.burnout > 0.3 || (car.tireBlown && Math.abs(car.speed) > 6);
  if (Math.abs(car.speed) > 3 && skidTick % 2 === 0) {
    const rx = Math.cos(car.heading), rz = -Math.sin(car.heading);
    const fx2 = Math.sin(car.heading), fz2 = Math.cos(car.heading);
    if (drifting) {
      for (const s of [-1, 1]) {
        particles.skid(car.x + rx * s * 1.0 - fx2 * 1.5, car.z + rz * s * 1.0 - fz2 * 1.5, car.heading);
        if (Math.random() < 0.75) particles.tireSmoke(car.x + rx * s - fx2 * 1.5, car.z + rz * s - fz2 * 1.5);
      }
      if (car.tireBlown) particles.sparks(car.x + rx * car.tireBlown - fx2 * 1.5, car.z + rz * car.tireBlown - fz2 * 1.5);
    }
    if (!isOnRoad(car.x, car.z) && Math.random() < 0.6) particles.dust(car.x - fx2 * 1.8, car.z - fz2 * 1.8);
  }
}

// ---------------- camera ----------------
let currentFov = 62;
// Camera-only smoothed copy of the car's heading (camera fix): the
// look-ahead target is built from this, never from the raw heading, so
// a tiny steering correction can no longer swing the view sideways in
// the same frame. It is damped exponentially toward the car's heading
// every frame Rina is driving, and reset to null on foot so the next
// car entry starts from that car's true heading with no stale swing.
let camSmoothHeading = null;
function updateCamera(dt) {
  const target = player.car ? player.car : player;
  const tx = target.x ?? target.pos.x, tz = target.z ?? target.pos.z;
  if (player.car) {
    // gentle auto-align behind the car — but never while the player is
    // actively looking around (1.2 s grace after the last mouse move),
    // and slower still while the mouse button is held. Exponential
    // damping (1 - exp(-dt * rate)) replaces the old linear dt * rate
    // smoothing everywhere in this function: two half-steps now compose
    // into exactly one full step, so the camera's effective smoothing
    // per second no longer changes with the framerate — the old linear
    // form tracked a constant-speed car with a frame-time-dependent
    // lag, which read on screen as a constant micro-vibration while
    // driving straight.
    if (G.time - lastMouseT > 1.2) {
      let diff = player.car.heading - camYaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      camYaw += diff * (1 - Math.exp(-dt * (mouseDown ? 1 : 2.4)));
    }
    if (camSmoothHeading === null) camSmoothHeading = player.car.heading;
    else {
      let hDiff = player.car.heading - camSmoothHeading;
      while (hDiff > Math.PI) hDiff -= Math.PI * 2;
      while (hDiff < -Math.PI) hDiff += Math.PI * 2;
      camSmoothHeading += hDiff * (1 - Math.exp(-dt * 7));
    }
  } else camSmoothHeading = null;
  const speedRatio = player.car ? clamp(Math.abs(player.car.speed) / player.car.maxSpeed, 0, 1) : 0;
  const back = player.car ? 11.5 + speedRatio * 3.6 : 8.4;
  const height = player.car ? 4.7 : 3.2 + camPitch * 3;
  // over-the-shoulder offset on foot and in aim
  const shoulder = player.car ? 0 : 1.15;
  const rx = Math.cos(camYaw), rz = -Math.sin(camYaw);
  const cx = tx - Math.sin(camYaw) * back + rx * shoulder;
  const cz = tz - Math.cos(camYaw) * back + rz * shoulder;
  const k = 1 - Math.exp(-dt * 7);
  camera.position.x += (cx - camera.position.x) * k;
  camera.position.y += (height - camera.position.y) * k;
  camera.position.z += (cz - camera.position.z) * k;
  // shake decays faster than before and is only ever fed by hard hits
  // (see the impact gates at every cameraShake source) — a light brush
  // can no longer keep the camera trembling
  G.cameraShake = Math.max(0, G.cameraShake - dt * 2.4);
  if (G.cameraShake > 0.01) {
    camera.position.x += (Math.random() - 0.5) * G.cameraShake * 0.5;
    camera.position.y += (Math.random() - 0.5) * G.cameraShake * 0.35;
  }
  const lookAhead = player.car ? 5 + speedRatio * 5 : 3.2;
  const lookHeading = player.car ? (camSmoothHeading ?? player.car.heading) : 0;
  camLookAt(tx + Math.sin(camYaw) * (player.car ? 0 : lookAhead * 0.4) + (player.car ? Math.sin(lookHeading) * lookAhead * 0.3 : 0), 1.6, tz + Math.cos(camYaw) * (player.car ? 0 : lookAhead * 0.4) + (player.car ? Math.cos(lookHeading) * lookAhead * 0.3 : 0));
  if (!player.car && mouseDown) player.heading = camYaw;
  const wantFov = player.car ? 62 + speedRatio * 13 : 62;
  if (Math.abs(wantFov - currentFov) > 0.15) {
    currentFov += (wantFov - currentFov) * (1 - Math.exp(-dt * 5));
    camera.fov = currentFov * Math.PI / 180;
  }
}

// ---------------- frame ----------------
let last = performance.now();
let offerCooldown = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  if (hud.fullMapOpen && G.running) {
    // map screen: world frozen, but the map itself stays live
    const mtarget = missions.active ? missions.stageTarget() : (missions.offering() ? missions.offerPoint() : missions.sideTarget());
    const mkind = missions.active ? 'mission' : (missions.offering() ? 'offer' : 'side');
    hud.update(0, missions.hudState(), player, allCars, peds, police.units, mtarget, mkind);
    renderFrame();
    return;
  }
  if (G.paused || !G.running) { renderFrame(); return; }
  G.time += dt;
  G.clockMinutes += dt * 0.7;
  G.damageFlash = Math.max(0, G.damageFlash - dt * 2.4);
  offerCooldown -= dt;
  player.driveByCooldown = Math.max(0, player.driveByCooldown - dt);
  if (player.car) player.shootCooldown = Math.max(0, player.shootCooldown - dt);
  if (G.reloading > 0) {
    G.reloading -= dt;
    if (G.reloading <= 0) finishReload();   // draws only what the finite reserve still holds
  }
  // dry-click hint: a trigger pull on a totally empty gun tells Rina
  // (once per click) where the next rounds live
  if (G.dryClicks !== frame._drySeen) {
    frame._drySeen = G.dryClicks;
    if (G.dryClicks > 0) hud.toast('NO AMMO — loot +12 from downed police / peds, or buy 24 for $50 at the PAWN shop', 2.8);
  }

  const spraying = updateRespray(dt);
  if (player.car) {
    if (!spraying) {
      let throttle = (input.w ? 1 : 0) - (input.s ? 1 : 0);
      let steer = (input.a ? 1 : 0) - (input.d ? 1 : 0);
      // shooter-seat stages: Nico drives the route, Rina keeps the gun
      if (G.aiDriver && G.aiDriver.car === player.car) {
        const ad = G.aiDriver;
        const wp = ad.route[ad.i];
        if (!wp) { ad.done = true; throttle = 0; steer = 0; }
        else {
          const desired = Math.atan2(wp.x - player.car.x, wp.z - player.car.z);
          let diff = (desired - player.car.heading) % (Math.PI * 2);
          if (diff > Math.PI) diff -= Math.PI * 2;
          if (diff < -Math.PI) diff += Math.PI * 2;
          steer = clamp(-diff * 1.4, -0.85, 0.85);
          throttle = Math.abs(diff) > 2.2 ? -0.4 : 1;
          if (dist2d(player.car.x, player.car.z, wp.x, wp.z) < 11) {
            ad.i++;
            if (ad.i >= ad.route.length) ad.done = true;
          }
        }
      }
      const beforeSpeed = player.car.speed;
      player.car.drive(dt, throttle, steer, world.colliders, {
        handbrake: input.shift,
        bothPedals: input.w && input.s,
      });
      if (player.car.crashed) {
        hurtPlayer(player.car.crashed * 0.3);
        commitCrime(20, '', police.units.length > 0);
        fx.crash();
        particles.sparks(player.car.x, player.car.z);
        // camera fix: the crash flag still reports every hit above the
        // damage threshold (> 6.5, unchanged), but the CAMERA only
        // shakes for a genuinely hard impact (> 11) and then only by a
        // smaller, capped amount — a scrape that bends a fender no
        // longer rattles the view
        if (player.car.crashed > 11) G.cameraShake = Math.min(0.3, G.cameraShake + player.car.crashed * 0.011);
        player.car.crashed = 0;
      }
      if (Math.abs(beforeSpeed) > 4) updateCarContacts(dt);
    }
  } else if (player.boat) {
    const throttle = (input.w ? 1 : 0) - (input.s ? 1 : 0);
    const steer = (input.a ? 1 : 0) - (input.d ? 1 : 0);
    boat.steerVis = steer;
    boat.drive(dt, throttle, steer);
    if (Math.abs(boat.speed) > 3 && Math.random() < dt * 6) particles.dust(boat.x - Math.sin(boat.heading) * 3.6, boat.z - Math.cos(boat.heading) * 3.6);
    if (boat.dead) {
      player.exitBoat(null);
      hud.toast('The boat is wrecked. Herrera will not be pleased.', 3);
    }
  } else {
    player.updateOnFoot(dt, input, camYaw, world.colliders, fx);
  }
  nico.update(dt, { player, fx, fxLayer, policeUnits: police.units, colliders: world.colliders });

  // traffic perception set: every live vehicle — traffic, parked
  // (skipped by the probes), police, mission rivals — plus a proxy for
  // Rina herself when she is on foot, so cars brake for her in the road.
  const perceptionSet = [...allCars, ...police.units, ...(G.rivalCars || [])];
  if (!player.car && !player.boat) {
    perceptionSet.push({ x: player.x, z: player.z, speed: 0, radius: 0.7, playerProxy: true, isPedestrian: true, parked: false, dead: false });
  }
  const trafficCtx = { police: G.wanted > 0 ? police.units : null, vehicles: perceptionSet };
  for (const v of trafficCars) if (!v.isPlayerCar) v.trafficUpdate(dt, perceptionSet, world.colliders, trafficCtx);
  updateVehicleDrama(dt);
  updatePlayerCarFx(dt);
  const threat = player.car && Math.abs(player.car.speed) > 6
    ? { x: player.x, z: player.z, carSpeed: Math.abs(player.car.speed), heading: player.car.heading }
    : (player.punchTimer > 0.2 || G.time - lastShotAt < 0.4 ? { x: player.x, z: player.z } : null);
  for (const p of peds) p.update(dt, threat, world.colliders);
  G.filmingWitnesses = peds.reduce((n, p) => n + (p.state === 'film' ? 1 : 0), 0);
  const policeInfo = police.update(dt, { x: player.x, z: player.z }, player.speed, world.colliders, fx, player.car);
  // anti-interpenetration pass: separate overlapping vehicles now that
  // everything has moved — traffic queues, police vs traffic — while
  // never shoving the player's car or separating a ramming police unit
  resolveVehicleOverlaps(
    [...trafficCars, ...police.units, ...(G.rivalCars || []), ...(player.car ? [player.car] : [])],
    player.car || null
  );

  checkAmmoDrops();
  updateAmmoPickups(dt);

  const events = [];
  missions.update(dt, player, fx, events);
  for (const ev of events) {
    if (ev.type === 'offer' && offerCooldown <= 0) {
      offerCooldown = 1.2;
      if (missions.startNext(fx)) hud.toast('JOB STARTED: ' + ev.def.title, 3);
    }
    if (ev.type === 'complete') {
      hud.banner('MISSION PASSED', `${ev.def.title} · +$${ev.paid || ev.def.reward}`, '');
      if (ev.def.outro) {
        const m = /^([^:]{2,24}):\s*(.*)$/.exec(ev.def.outro);
        hud.dialogue([m ? { who: m[1].toUpperCase(), text: m[2] } : { who: 'SOLMARIS', text: ev.def.outro }]);
      }
    }
    if (ev.type === 'failed') hud.banner('MISSION FAILED', ev.reason || ev.def.title, 'failed');
    if (ev.type === 'gun') hud.toast('Tito hands you a PISTOL — with 48 rounds in reserve. Ammo is finite.', 3.4);
    if (ev.type === 'story-done') hud.banner('STORY COMPLETE', 'Out alive. Together.', '');
    if (ev.type === 'stage') hud.toast(ev.def.title + ' — ' + (ev.stage.label || ''), 2.4);
    if (ev.type === 'chapter') hud.chapter(ev.title, ev.sub);
    if (ev.type === 'dialogue') hud.dialogue(ev.lines);
    if (ev.type === 'toast') hud.toast(ev.text, 2.6);
    if (ev.type === 'endcard') hud.endCard(ev.html);
  }

  // round 3 side activities: pages spin and get pocketed, fares spawn,
  // board, ride and pay out — never while a story job is active
  activities.update(dt, player, { canOffer: !missions.active });

  // finale sunset: the light itself plays the last stage
  {
    const target = missions.sunsetActive() ? 1 : 0;
    G.sunsetFrac += clamp(target - G.sunsetFrac, -dt * 0.05, dt * 0.05);
    const f = G.sunsetFrac;
    if (f > 0.001) {
      BABYLON.Color3.LerpToRef(SUN_BASE, SUN_SET, f, world.sun.diffuse);
      world.sun.intensity = 1.3 - f * 0.55;
      BABYLON.Color3.LerpToRef(FOG_BASE, FOG_SET, f, scene.fogColor);
    }
  }

  updateWanted(dt);
  fxLayer.update(dt);
  particles.update(dt);
  world.update(dt, { x: player.x, z: player.z });
  updateHeadlight();

  if (!player.car && !player.boat && G.running) {
    const v = player.nearestCar(allCars, 4.2);
    const nearBoat = G.boatUnlocked && dist2d(player.x, player.z, boat.x, boat.z) < 6.5;
    const nearPawn = dist2d(player.x, player.z, LANDMARKS.pawn.x, LANDMARKS.pawn.z) < 5;
    const noAmmo = G.hasGun && G.reloading <= 0 && G.ammoMag <= 0 && G.ammoReserve <= 0;
    hud.prompt(nearPawn ? (G.hasGun ? 'Press <b>E</b> · Buy ammo 24 — $50' + (G.money < 50 ? ' · <b>not enough cash</b>' : '') : 'PAWN SHOP — ammo counter (win a pistol first)')
      : v ? 'Press <b>E</b> to ' + (v.parked ? 'steal this car' : 'jack this car')
      : nearBoat ? 'Press <b>E</b> to take Herrera\'s boat'
      : noAmmo ? '<b>NO AMMO</b> — loot +12 from downed police / peds, or buy 24 for $50 at the <b>PAWN shop</b>'
      : (missions.offering() && dist2d(player.x, player.z, missions.offerPoint().x, missions.offerPoint().z) < 8 ? 'Walk into the gold beacon to take the job' : ''));
  } else if (player.car) {
    const nearBay = dist2d(player.car.x, player.car.z, LANDMARKS.respray.x, LANDMARKS.respray.z) < 7;
    const noAmmoCar = G.hasGun && G.reloading <= 0 && G.ammoMag <= 0 && G.ammoReserve <= 0;
    const farePrompt = activities.pickupPromptHtml(player);
    hud.prompt(farePrompt ? farePrompt : nearBay && (G.wanted > 0 || player.car.health < 99) ? `Stop in the bay — <b>Rico's Respray</b> ($${G.resprayDiscount ? 50 : 100})` : 'Press <b>E</b> to get out · <b>R</b> radio · <b>Shift</b> handbrake' + (noAmmoCar ? ' · <b>NO AMMO</b> — PAWN shop sells 24 for $50' : ''));
  } else if (player.boat) {
    hud.prompt(dist2d(player.boat.x, player.boat.z, 31, 256) < 11 ? 'Press <b>E</b> to dock at the pier' : 'Herrera\'s boat — <b>E</b> docks at the pier');
  } else hud.prompt('');

  const target = missions.active ? missions.stageTarget() : (missions.offering() ? missions.offerPoint() : missions.sideTarget());
  const targetKind = missions.active ? 'mission' : (missions.offering() ? 'offer' : 'side');
  const sirenLevel = G.wanted > 0 && policeInfo.nearest < 70 ? 1 - policeInfo.nearest / 90 : 0;
  fx.update(dt, player.car ? player.car.speed / player.car.maxSpeed : 0, !!player.car, sirenLevel);
  hud.update(dt, missions.hudState(), player, allCars, peds, police.units, target, targetKind);
  activities.drawMinimapBlips(player, hud);
  updateCamera(dt);
  renderFrame();
}
const SUN_BASE = C3(0xffc98a), SUN_SET = C3(0xff5a26);
const FOG_BASE = C3(0xf7b183), FOG_SET = C3(0xa03c22);

// ---------------- screenshot staging ----------------
function stageShot(name) {
  G.running = true; G.mode = 'foot';
  showScreen(null);
  hud.show();
  if (name === 'start') {
    showScreen('start');
    player.placeAt(-30, -30, Math.PI * 0.75);
    camYaw = Math.PI * 0.75 + Math.PI;
    camera.position.set(-52, 16, -58);
    camLookAt(20, 6, 30);
    hud.hide();
    screens.start.classList.remove('hidden');
    return;
  }
  if (name === 'foot') {
    G.money = 310; G.displayedMoney = 310; G.hasGun = true; G.ammoMag = G.magSize; G.ammoReserve = 48; G.reloading = 0;
    player.placeAt(-40, -8, Math.PI);
    missions.startNext(fx);
    camYaw = Math.PI;
    camera.position.set(-40, 4.2, 1.5);
    camLookAt(player.x, 1.6, player.z - 6);
    return;
  }
  if (name === 'drive') {
    G.money = 720; G.displayedMoney = 720; G.missionIndex = 2; G.hasGun = true; G.ammoMag = G.magSize; G.ammoReserve = 48; G.reloading = 0;
    const car = parkedCars[2] || allCars[0];
    car.pos.set(-58, 0, 43.8); car.heading = Math.PI / 2;
    car.mesh.rotation.y = Math.PI / 2;
    player.enterCar(car, null);
    car.speed = 14;
    missions.startNext(fx);
    G.wanted = 0; G.crimeHeat = 0; G.wantedState = 'clear';
    camYaw = Math.PI / 2;
    camera.position.set(-71, 5, 43.8);
    camLookAt(-50, 1.6, 43.8);
    return;
  }
  if (name === 'night') {
    // Lighting test staging (not a competition screenshot): the clock
    // is moved to 21:30 so lampScale() is at full night, and — only in
    // this staged scene — the golden-hour ambience is dimmed so the
    // real street pool and headlight can be judged on the subject.
    // Normal play keeps the perpetual golden hour; the pool and
    // headlight intensities used here are the unmodified game values.
    G.clockMinutes = 21 * 60 + 30;
    G.money = 720; G.displayedMoney = 720; G.hasGun = true; G.ammoMag = G.magSize; G.ammoReserve = 48; G.reloading = 0;
    world.sun.intensity = 0.10;
    world.hemi.intensity = 0.15;
    world.fill.intensity = 0.03;
    if (world.sky && world.sky.material) world.sky.material.emissiveIntensity = 0.16;
    scene.fogColor.copyFromFloats(0.07, 0.09, 0.16);
    scene.clearColor.copyFromFloats(0.07, 0.09, 0.16, 1);
    const car = parkedCars[2] || allCars[0];
    // parked close under the lamp head at (49.5, -40): the pool light
    // seated on that head washes the car's front quarter, and the
    // headlight beam lands on the asphalt ahead of it (+z)
    car.pos.set(47.2, 0, -47.5); car.heading = 0.12;
    car.mesh.rotation.y = 0.12;
    player.enterCar(car, null);
    car.speed = 0;
    car.syncMesh(0);
    camYaw = 0;
    camera.position.set(40.5, 2.2, -57.5);
    camLookAt(47.8, 1.0, -43.5);
    return;
  }
  // chase: wanted 3, PD on her tail with lightbars flashing, mission live
  G.money = 1180; G.displayedMoney = 1180; G.missionIndex = 3; G.hasGun = true; G.ammoMag = G.magSize; G.ammoReserve = 48; G.reloading = 0;
  const car = parkedCars[4] || allCars[1];
  car.pos.set(43.8, 0, -70); car.heading = 0;
  car.mesh.rotation.y = 0;
  player.enterCar(car, null);
  car.speed = 17;
  missions.startNext(fx);
  G.wanted = 3; G.crimeHeat = 0;
  G.wantedState = 'seen';
  G.lastKnown.x = car.x; G.lastKnown.z = car.z;
  const spots = [[36.5, -83], [43.8, -86], [51, -83]];
  for (let i = 0; i < 3; i++) {
    police.spawnUnit({ x: car.x, z: car.z });
    const u = police.units[police.units.length - 1];
    u.pos.set(spots[i][0], 0, spots[i][1]);
    u.heading = 0; u.mesh.rotation.y = 0;
    u.speed = 16;
  }
  camYaw = 0;
  camera.position.set(43.8, 5.4, -95);
  camLookAt(43.8, 1.7, -63);
}

if (shotName) {
  stageShot(shotName);
  // test/staging override: ?clock=<minutes> pins the HUD clock so the
  // day/dusk/night lamp states can be staged deterministically
  const clockParam = parseFloat(params.get('clock'));
  if (Number.isFinite(clockParam)) G.clockMinutes = clockParam;
  let frames = 0;
  const settle = () => {
    frames++;
    G.time += 0.016;
    for (const p of peds) p.update(0.016, null, world.colliders);
    for (const v of trafficCars) v.trafficUpdate(0.016, [], world.colliders, {});
    police.lightPhase += 0.55;
    for (let i = 0; i < police.units.length; i++) {
      const bar = lightbarParts(police.units[i].mesh);
      if (bar) {
        const phase = Math.sin(police.lightPhase + i * 2.1) > 0;
        bar.red.isVisible = phase;
        bar.blue.isVisible = !phase;
      }
    }
    particles.update(0.016);
    if (player.car) player.car.syncMesh(0);
    world.update(0.016, { x: player.x, z: player.z });
    updateHeadlight();
    missions.update(0.001, player, null, []);
    activities.update(0.016, player, { canOffer: false });
    hud.update(0.016, missions.hudState(), player, allCars, peds, police.units, missions.active ? missions.stageTarget() : LANDMARKS.cafe);
    activities.drawMinimapBlips(player, hud);
    renderFrame();
    if (frames < 14) requestAnimationFrame(settle);
    else window.__shotReady = true;
  };
  requestAnimationFrame(settle);
} else {
  camera.position.set(-52, 14, -56);
  camLookAt(0, 4, 0);
  requestAnimationFrame(frame);
}
