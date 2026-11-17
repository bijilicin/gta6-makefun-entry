// Solmaris Heat — main loop and glue. Boots three.js, builds the city,
// spawns traffic, parked cars, pedestrians and the PD, then runs the frame:
// input -> player -> traffic -> police -> missions -> wanted decay ->
// camera -> HUD -> render. Also owns the screens (start, pause, busted,
// wasted, story complete), save/load, crime bookkeeping and the staged
// ?shot= scenes used to take the entry's screenshots.

import { G, WORLD, clamp, commitCrime, dist2d, setSeed, saveGame, loadGame, hasSave } from './state.js';
import { buildWorld, LANDMARKS } from './world.js';
import { spawnTraffic, spawnParked } from './vehicles.js';
import { spawnPeds } from './peds.js';
import { PoliceSystem } from './police.js';
import { Player } from './player.js';
import { MissionSystem } from './missions.js';
import { Hud } from './hud.js';
import { SoundFX } from './audio.js';

const params = new URLSearchParams(window.location.search);
const shotName = params.get('shot');
const seedParam = parseInt(params.get('seed') || '7', 10);
setSeed(Number.isInteger(seedParam) ? seedParam : 7);
if (shotName) G.shot = shotName;

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 1200);
const world = buildWorld(scene);

const trafficCars = spawnTraffic(scene, 15);
for (const v of trafficCars) v.wasTraffic = true;
const parkedCars = spawnParked(scene, 16);
const allCars = [...trafficCars, ...parkedCars];
const peds = spawnPeds(scene, 30);
const police = new PoliceSystem(scene);
const player = new Player(scene);
const missions = new MissionSystem(scene);
const hud = new Hud();
const fx = new SoundFX();

// transient gun tracer + muzzle light
const fxLayer = {
  line: null, timer: 0,
  tracer(ox, oz, dx, dz, len) {
    if (this.line) scene.remove(this.line);
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(ox, 1.45, oz),
      new THREE.Vector3(ox + dx * len, 1.3, oz + dz * len),
    ]);
    this.line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffe98a }));
    scene.add(this.line);
    this.timer = 0.07;
  },
  update(dt) {
    if (this.timer > 0) { this.timer -= dt; if (this.timer <= 0 && this.line) { scene.remove(this.line); this.line = null; } }
  },
};

// smoke puffs for wrecked cars
const smokeTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 4, 32, 32, 30);
  grad.addColorStop(0, 'rgba(60,60,60,0.55)'); grad.addColorStop(1, 'rgba(60,60,60,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
const smokes = [];
function puffSmoke(x, z) {
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, transparent: true, depthWrite: false }));
  spr.position.set(x, 2.2, z);
  spr.scale.set(2.4, 2.4, 1);
  scene.add(spr);
  smokes.push({ spr, life: 1.4 });
}

// ---------------- input ----------------
const input = { w: false, a: false, s: false, d: false, shift: false };
const KEYMAP = { KeyW: 'w', ArrowUp: 'w', KeyA: 'a', ArrowLeft: 'a', KeyS: 's', ArrowDown: 's', KeyD: 'd', ArrowRight: 'd', ShiftLeft: 'shift', ShiftRight: 'shift' };
let camYaw = Math.PI;         // behind Rina, who starts facing the cafe
let camPitch = 0.32;
let mouseDown = false;

window.addEventListener('keydown', (e) => {
  if (KEYMAP[e.code]) { input[KEYMAP[e.code]] = true; e.preventDefault(); }
  if (e.code === 'KeyE' && G.running && !G.paused) tryEnterExit();
  if (e.code === 'KeyF' && G.running && !G.paused) doPunch();
  if (e.code === 'Space' && G.running && !G.paused) { doShoot(); e.preventDefault(); }
  if ((e.code === 'KeyP' || e.code === 'Escape') && G.running) togglePause();
  if (e.code === 'KeyM') { const m = fx.toggleMute(); hud.toast(m ? 'SOUND OFF' : 'SOUND ON', 1.2); }
});
window.addEventListener('keyup', (e) => { if (KEYMAP[e.code]) input[KEYMAP[e.code]] = false; });
window.addEventListener('blur', () => { for (const k of Object.keys(input)) input[k] = false; });
canvas.addEventListener('mousedown', (e) => { mouseDown = true; if (G.running && !G.paused && e.button === 0 && !player.car) doShoot(); });
window.addEventListener('mouseup', () => { mouseDown = false; });
window.addEventListener('mousemove', (e) => {
  if (!G.running || G.paused) return;
  camYaw -= e.movementX * 0.0032;
  camPitch = clamp(camPitch + e.movementY * 0.002, 0.08, 0.9);
});

// ---------------- actions ----------------
function tryEnterExit() {
  if (player.car) { player.exitCar(fx); return; }
  const v = player.nearestCar(allCars, 4.2);
  if (v) {
    player.enterCar(v, fx);
    if (v.wasTraffic) { v.wasTraffic = false; }
  }
}
function doPunch() {
  const hit = player.punch(allCars, peds, fx);
  if (hit && hit.type === 'car') fx.crash();
}
function doShoot() {
  player.shoot(allCars, peds, police.units, fx, fxLayer);
}
function hurtPlayer(amount) { player.hurt(amount); }

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
    G.money = 60; G.health = 100; G.missionIndex = 0; G.storyDone = false; G.hasGun = false; G.wanted = 0;
  } else {
    loadGame();
  }
  G.running = true; G.paused = false; G.over = false;
  G.mode = 'foot';
  player.placeAt(-30, -30, Math.PI * 0.75);
  showScreen(null);
  hud.show();
  hud.toast(fresh ? 'Welcome to Solmaris, Rina' : 'Welcome back, Rina', 3);
}
function togglePause() {
  if (G.over) return;
  G.paused = !G.paused;
  if (G.paused) {
    document.getElementById('pausestats').textContent =
      `Cash $${G.money} · Jobs done ${G.missionIndex}/5 · Cars stolen ${G.carsStolen} · Shots fired ${G.shotsFired}`;
    showScreen('pause');
  } else showScreen(null);
}
function endRun(kind) {
  G.over = true;
  police.clearAll();
  G.wanted = 0;
  const title = document.getElementById('endtitle');
  const text = document.getElementById('endtext');
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
  player.placeAt(LANDMARKS.hospital.x, LANDMARKS.hospital.z, 0);
  saveGame();
  showScreen('end');
}
document.getElementById('btn-new').addEventListener('click', () => startGame(true));
document.getElementById('btn-continue').addEventListener('click', () => startGame(false));
document.getElementById('btn-resume').addEventListener('click', togglePause);
document.getElementById('btn-save').addEventListener('click', () => { saveGame(); hud.toast('GAME SAVED', 1.6); });
document.getElementById('btn-restart').addEventListener('click', () => { G.paused = false; startGame(true); });
document.getElementById('btn-again').addEventListener('click', () => { G.over = false; showScreen(null); });
if (!hasSave()) document.getElementById('btn-continue').style.opacity = 0.45;

// ---------------- wanted / crime upkeep ----------------
function updateWanted(dt) {
  G.crimeHeat += dt;
  if (G.wanted > 0 && G.crimeHeat > 14) {
    const nearPolice = police.nearest !== undefined && police.nearest < 55;
    const inHideout = dist2d(player.x, player.z, LANDMARKS.hideout.x, LANDMARKS.hideout.z) < 16;
    if (!nearPolice || inHideout) {
      G.heatDecay = (G.heatDecay || 0) + dt * (inHideout ? 2.2 : 1);
      if (G.heatDecay > 6) { G.heatDecay = 0; G.wanted = Math.max(0, G.wanted - 1); if (G.wanted === 0) hud.toast('Heat is off. For now.', 2); }
    }
  }
  if (G.bustMeter >= 1) endRun('busted');
  if (G.health <= 0) endRun('wasted');
}

// collisions between the player's car and the world of moving things
function updateCarContacts(dt) {
  const pc = player.car;
  if (!pc) return;
  for (const v of allCars) {
    if (v === pc || v.dead) continue;
    if (dist2d(pc.x, pc.z, v.x, v.z) < 3.4) {
      const impact = Math.abs(pc.speed) + Math.abs(v.speed);
      if (impact > 6) {
        v.health -= impact * 1.1; pc.health -= impact * 0.5;
        hurtPlayer(impact * 0.22);
        commitCrime(35, 'Hit and run!');
        fx.crash();
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
      commitCrime(80, 'Pedestrian down!');
      fx.crash();
    }
  }
  for (const u of police.units) {
    if (dist2d(pc.x, pc.z, u.x, u.z) < 3.6 && Math.abs(pc.speed) > 8) {
      hurtPlayer(2.2);
    }
  }
}

// ---------------- camera ----------------
function updateCamera(dt) {
  const target = player.car ? player.car : player;
  const tx = target.x ?? target.pos.x, tz = target.z ?? target.pos.z;
  let desiredYaw;
  if (player.car) {
    // ease the camera behind the car's heading
    let diff = player.car.heading - camYaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    camYaw += diff * Math.min(1, dt * (mouseDown ? 1 : 2.4));
    desiredYaw = camYaw;
  } else desiredYaw = camYaw;
  const back = player.car ? 11.5 : 8.2;
  const height = player.car ? 4.6 : 3.4 + camPitch * 3;
  const cx = tx - Math.sin(desiredYaw) * back;
  const cz = tz - Math.cos(desiredYaw) * back;
  camera.position.x += (cx - camera.position.x) * Math.min(1, dt * 7);
  camera.position.y += (height - camera.position.y) * Math.min(1, dt * 7);
  camera.position.z += (cz - camera.position.z) * Math.min(1, dt * 7);
  camera.lookAt(tx, 1.6, tz);
  // on foot, Rina faces where the camera faces when the player shoots/strafes
  if (!player.car && mouseDown) player.heading = desiredYaw;
}

// ---------------- frame ----------------
let last = performance.now();
let offerCooldown = 0;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  if (G.paused || !G.running) { renderer.render(scene, camera); return; }
  G.time += dt;
  G.clockMinutes += dt * 0.7;
  G.damageFlash = Math.max(0, G.damageFlash - dt * 2.4);
  offerCooldown -= dt;

  // player
  if (player.car) {
    const throttle = (input.w ? 1 : 0) - (input.s ? 1 : 0);
    const steer = (input.a ? 1 : 0) - (input.d ? 1 : 0);
    const beforeSpeed = player.car.speed;
    player.car.drive(dt, throttle, steer, world.colliders);
    if (player.car.crashed) {
      hurtPlayer(player.car.crashed * 0.3);
      commitCrime(20, '');
      fx.crash();
      player.car.crashed = 0;
    }
    if (Math.abs(beforeSpeed) > 4) updateCarContacts(dt);
  } else {
    player.updateOnFoot(dt, input, camYaw, world.colliders, fx);
    // movement is camera-relative: W walks away from the camera
  }

  // world actors
  const obstacles = [...allCars.map(v => ({ x: v.x, z: v.z })), { x: player.x, z: player.z }];
  for (const v of trafficCars) if (!v.isPlayerCar) v.trafficUpdate(dt, obstacles, world.colliders);
  for (const v of allCars) if (v.smoking) { v.smoking = false; puffSmoke(v.x, v.z); }
  const threat = player.car && Math.abs(player.car.speed) > 6 ? { x: player.x, z: player.z }
    : (player.punchTimer > 0.2 ? { x: player.x, z: player.z } : null);
  for (const p of peds) p.update(dt, threat, world.colliders);
  const policeInfo = police.update(dt, { x: player.x, z: player.z }, player.speed, world.colliders, fx);

  // missions
  const events = [];
  missions.update(dt, player, fx, events);
  for (const ev of events) {
    if (ev.type === 'offer' && offerCooldown <= 0) {
      offerCooldown = 1.2;
      if (missions.startNext(fx)) hud.toast('JOB STARTED: ' + ev.def.title, 3);
    }
    if (ev.type === 'complete') hud.toast(`JOB DONE  +$${ev.def.reward}`, 3.4);
    if (ev.type === 'failed') hud.toast('JOB FAILED — see Mama Rosa to retry', 3.2);
    if (ev.type === 'gun') hud.toast('Rico hands you a PISTOL', 3);
    if (ev.type === 'story-done') hud.toast('STORY COMPLETE — Rina sails free!', 4.5);
    if (ev.type === 'stage') hud.toast(ev.def.title, 2);
  }

  updateWanted(dt);
  fxLayer.update(dt);
  for (let i = smokes.length - 1; i >= 0; i--) {
    const s = smokes[i];
    s.life -= dt;
    s.spr.position.y += dt * 1.6;
    s.spr.material.opacity = Math.max(0, s.life / 1.4) * 0.8;
    if (s.life <= 0) { scene.remove(s.spr); smokes.splice(i, 1); }
  }
  if (world.sea) world.sea.position.y = 0.06 + Math.sin(G.time * 0.8) * 0.05;

  // prompt for car entry
  if (!player.car && G.running) {
    const v = player.nearestCar(allCars, 4.2);
    hud.prompt(v ? 'Press <b>E</b> to ' + (v.parked ? 'steal this car' : 'jack this car') : (missions.offering() && dist2d(player.x, player.z, LANDMARKS.cafe.x, LANDMARKS.cafe.z) < 8 ? 'Walk into the gold beacon to take the job' : ''));
  } else if (player.car) hud.prompt('Press <b>E</b> to get out');
  else hud.prompt('');

  const target = missions.active ? missions.stageTarget() : (missions.offering() ? LANDMARKS.cafe : null);
  const sirenLevel = G.wanted > 0 && policeInfo.nearest < 70 ? 1 - policeInfo.nearest / 90 : 0;
  fx.update(dt, player.car ? player.car.speed / player.car.maxSpeed : 0, !!player.car, sirenLevel);
  hud.update(dt, missions.hudState(), player, allCars, peds, police.units, target);
  updateCamera(dt);
  renderer.render(scene, camera);
}

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
    camera.lookAt(20, 6, 30);
    hud.hide();
    screens.start.classList.remove('hidden');
    return;
  }
  if (name === 'foot') {
    // on the x=-40 avenue, facing north up the road canyon
    G.money = 310; G.hasGun = true;
    player.placeAt(-40, -8, Math.PI);
    missions.startNext(fx);
    camYaw = Math.PI;
    camera.position.set(-40, 4.2, 1.5);
    camera.lookAt(player.x, 1.6, player.z - 6);
    return;
  }
  if (name === 'drive') {
    // eastbound on the z=40 avenue, camera trailing behind the car
    G.money = 720; G.missionIndex = 2; G.hasGun = true;
    const car = parkedCars[2] || allCars[0];
    car.pos.set(-58, 0, 43.8); car.heading = Math.PI / 2;
    car.mesh.position.set(-58, 0, 43.8); car.mesh.rotation.y = Math.PI / 2;
    player.enterCar(car, null);
    car.speed = 14;
    missions.startNext(fx);
    G.wanted = 0; G.crimeHeat = 0;
    camYaw = Math.PI / 2;
    camera.position.set(-71, 5, 43.8);
    camera.lookAt(-50, 1.6, 43.8);
    return;
  }
  // chase: the cover-worthy money shot — wanted, police close, mission live
  G.money = 1180; G.missionIndex = 3; G.hasGun = true;
  const car = parkedCars[4] || allCars[1];
  // northbound lane of the x=120 avenue, three interceptors on the tail
  car.pos.set(123.8, 0, -70); car.heading = 0;
  car.mesh.position.set(123.8, 0, -70); car.mesh.rotation.y = 0;
  player.enterCar(car, null);
  car.speed = 17;
  missions.startNext(fx);
  G.wanted = 3; G.crimeHeat = 0;   // set last: entering the car and the job both add heat of their own
  const spots = [[116.5, -84], [123.8, -87], [131, -84]];
  for (let i = 0; i < 3; i++) {
    police.spawnUnit({ x: car.x, z: car.z });
    const u = police.units[police.units.length - 1];
    u.pos.set(spots[i][0], 0, spots[i][1]);
    u.mesh.position.copy(u.pos);
    u.heading = 0; u.mesh.rotation.y = 0;
    u.speed = 16;
  }
  camYaw = 0;
  camera.position.set(123.8, 5.6, -99);
  camera.lookAt(123.8, 1.8, -58);
}

if (shotName) {
  stageShot(shotName);
  // settle a few frames of animation so screenshots show a lived-in scene
  let frames = 0;
  const settle = () => {
    frames++;
    G.time += 0.016;
    for (const p of peds) p.update(0.016, null, world.colliders);
    for (const v of trafficCars) v.trafficUpdate(0.016, [], world.colliders);
    police.lightPhase += 0.15;
    for (const u of police.units) { const bar = u.mesh.getObjectByName('lightbar'); if (bar) bar.visible = frames % 4 < 3; }
    missions.update(0.001, player, null, []);
    hud.update(0.016, missions.hudState(), player, allCars, peds, police.units, missions.active ? missions.stageTarget() : LANDMARKS.cafe);
    renderer.render(scene, camera);
    if (frames < 40) requestAnimationFrame(settle);
    else window.__shotReady = true;
  };
  requestAnimationFrame(settle);
} else {
  camera.position.set(-52, 14, -56);
  camera.lookAt(0, 4, 0);
  requestAnimationFrame(frame);
}
