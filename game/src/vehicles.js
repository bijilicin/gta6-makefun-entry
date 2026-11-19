// Vehicles for Solmaris Heat — Babylon.js port (v3 engine rewrite).
// A small kit builds sedans, coupes, pickups and vans — sloped hood and
// trunk, glossy glass cabin, wheels that spin and steer, emissive
// headlights and brake-bright taillights — plus black-and-white PD
// interceptors with a flashing lightbar. Driving is arcade with weight:
// momentum, speed-sensitive steering, Shift handbrake drifts, standstill
// burnouts, and staged damage (smoke, sputter, fire, explosion) with a
// blowable tire that pulls the car sideways.
//
// Paint/glass are PBR materials lit by the scene environment (the
// equirect IBL from world.js), with blob contact shadows and headlight
// glow billboards. Traffic keeps the v2.1 brain verbatim: perception
// probes, IDM-lite car-following, junction yield and a positional
// anti-interpenetration pass (see trafficUpdate / resolveVehicleOverlaps).
// All driving/traffic mathematics is byte-for-byte the three.js build's —
// only mesh construction moved to Babylon (TransformNode groups, mesh
// metadata in place of three's userData).

import { WORLD, G, rand, randRange, randPick, clamp, roadLines, nearestRoadCoord, lampScale } from './state.js';
import { collideCircle, glowTexture, makeBlobShadow, makeBillboard, C3, pbrMat, basicMat, boxMesh, cylMesh, groupNode, markShadow, removeNode, uid } from './world.js';

export const CAR_COLORS = [0xe63946, 0xf4a261, 0x2a9d8f, 0xe9c46a, 0x457b9d, 0xf1faee, 0x9d4edd, 0xef476f, 0x118ab2, 0xffd166, 0x74c69d, 0xff7b54];
export const PALETTE_NAMES = ['Crimson', 'Sunset', 'Lagoon', 'Sand', 'Harbor', 'Pearl', 'Violet', 'Flamingo', 'Deep Sea', 'Gold', 'Mint', 'Coral'];

const TAIL_OFF = null; // set lazily (needs BABYLON loaded, which it is at module scope in the browser)
function tailColors() {
  return {
    off: C3(0x881122),
    on: C3(0xff2233),
  };
}
let TAILC = null;

function paintMat(scene, color) {
  return pbrMat(scene, {
    color, roughness: 0.35, metalness: 0.1,
    clearcoat: true, clearcoatRoughness: 0.08, envMapIntensity: 1.0,
  });
}
function glassMat(scene) {
  return pbrMat(scene, {
    color: 0x101c28, roughness: 0.06, metalness: 0.0,
    clearcoat: true, clearcoatRoughness: 0.06, envMapIntensity: 1.25,
  });
}

export function makeCarMesh(scene, color, opts = {}) {
  const grp = groupNode(scene);
  const style = opts.style || 'sedan';
  const paint = paintMat(scene, opts.police ? 0x151a21 : color);
  const glass = glassMat(scene);
  const wheelMat = pbrMat(scene, { color: 0x14161a, roughness: 0.9, envMapIntensity: 0.25 });
  const hubMat = pbrMat(scene, { color: 0xb9c0c8, roughness: 0.35, metalness: 0.7, envMapIntensity: 0.8 });
  const L = style === 'van' ? 4.9 : style === 'pickup' ? 5.0 : style === 'coupe' ? 4.3 : 4.6;
  const Wd = 2.1, bodyH = style === 'van' ? 0.95 : 0.62;
  const body = boxMesh(scene, Wd, bodyH, L, paint);
  body.position.y = 0.42 + bodyH / 2;
  markShadow(body, true, false);
  body.parent = grp;
  // realism detail: dark lower skirt, chrome side spear and bumpers
  // break up the slab sides and give the body a grounded, bevelled read
  const trimMat = pbrMat(scene, { color: 0x1d2126, roughness: 0.7, metalness: 0.2, envMapIntensity: 0.4 });
  const chromeMat = pbrMat(scene, { color: 0xd7dde3, roughness: 0.25, metalness: 0.85, envMapIntensity: 1.1 });
  const skirt = boxMesh(scene, Wd + 0.04, 0.2, L - 0.6, trimMat);
  skirt.position.y = 0.3;
  skirt.parent = grp;
  const spear = boxMesh(scene, Wd + 0.03, 0.06, L * 0.5, chromeMat);
  spear.position.set(0, 0.82, -0.15);
  spear.parent = grp;
  const bumperF = boxMesh(scene, Wd + 0.05, 0.26, 0.28, trimMat);
  bumperF.position.set(0, 0.4, L / 2 + 0.42);
  bumperF.parent = grp;
  const bumperR = boxMesh(scene, Wd + 0.05, 0.26, 0.28, trimMat);
  bumperR.position.set(0, 0.4, -L / 2 - 0.18);
  bumperR.parent = grp;
  if (style !== 'van') {
    const hood = boxMesh(scene, Wd - 0.22, 0.3, 1.0, paint);
    hood.position.set(0, 0.78, L / 2 + 0.18);
    hood.rotation.x = 0.1;
    markShadow(hood, true, false);
    hood.parent = grp;
    const trunk = boxMesh(scene, Wd - 0.22, 0.26, 0.8, paint);
    trunk.position.set(0, 0.8, -L / 2 - 0.1);
    trunk.rotation.x = -0.07;
    trunk.parent = grp;
  }
  // cabin / cargo per style
  let cabin;
  if (style === 'pickup') {
    cabin = boxMesh(scene, 1.85, 0.68, 1.5, glass);
    cabin.position.set(0, 1.28, 0.75);
    cabin.parent = grp;
    const bed = boxMesh(scene, 1.95, 0.55, 2.2, pbrMat(scene, { color: 0x565e66, roughness: 0.8 }));
    bed.position.set(0, 1.0, -1.45);
    bed.parent = grp;
  } else if (style === 'van') {
    cabin = boxMesh(scene, 1.95, 0.75, 1.1, glass);
    cabin.position.set(0, 1.62, 1.65);
    cabin.parent = grp;
    const panel = boxMesh(scene, 2.0, 1.15, 3.2, paint);
    panel.position.set(0, 1.55, -0.7);
    markShadow(panel, true, false);
    panel.parent = grp;
  } else {
    cabin = boxMesh(scene, 1.8, 0.6, style === 'coupe' ? 1.7 : 2.1, glass);
    cabin.position.set(0, 1.2, style === 'coupe' ? -0.45 : -0.25);
    cabin.parent = grp;
  }
  markShadow(cabin, true, false);
  // realism detail per style: sloped windshield + rear glass over the
  // cabin box, a painted roof panel, and side mirrors — the glasshouse
  // stops reading as one dark block. Cabin centre/depth/top per style
  // mirror the cabin construction above.
  {
    let cz = -0.25, cd = 2.1, cTop = 1.5, cWid = 1.66;
    if (style === 'pickup') { cz = 0.75; cd = 1.5; cTop = 1.62; cWid = 1.7; }
    else if (style === 'van') { cz = 1.65; cd = 1.1; cTop = 2.0; cWid = 1.8; }
    else if (style === 'coupe') { cz = -0.45; cd = 1.7; cTop = 1.5; cWid = 1.62; }
    const slope = style === 'van' ? 0.22 : 0.42;
    const shield = boxMesh(scene, cWid, 0.62, 0.06, glass);
    shield.position.set(0, cTop - 0.3, cz + cd / 2 + 0.02);
    shield.rotation.x = -slope;
    shield.parent = grp;
    const rearGlass = boxMesh(scene, cWid, 0.56, 0.06, glass);
    rearGlass.position.set(0, cTop - 0.3, cz - cd / 2 - 0.02);
    rearGlass.rotation.x = slope;
    rearGlass.parent = grp;
    if (style !== 'van') {
      const roof = boxMesh(scene, cWid + 0.02, 0.06, cd * 0.94, paint);
      roof.position.set(0, cTop + 0.02, cz);
      markShadow(roof, true, false);
      roof.parent = grp;
    }
    for (const s of [-1, 1]) {
      const mir = boxMesh(scene, 0.2, 0.11, 0.09, trimMat);
      mir.position.set(s * (Wd / 2 + 0.07), cTop - 0.24, cz + cd / 2 - 0.14);
      mir.parent = grp;
    }
    if (style === 'van') {
      // the van's lamps sit on a short snout, not floating ahead of it
      const snout = boxMesh(scene, Wd - 0.18, 0.6, 0.68, paint);
      snout.position.set(0, 0.64, L / 2 + 0.26);
      markShadow(snout, true, false);
      snout.parent = grp;
    }
  }
  // wheels with hubcaps; front pair steers (metadata.front)
  const wheels = [];
  const fz = L / 2 - 0.85, rz = -L / 2 + 0.85;
  for (const [x, z, front] of [[-1.04, fz, 1], [1.04, fz, 1], [-1.04, rz, 0], [1.04, rz, 0]]) {
    const pivot = groupNode(scene, grp);
    pivot.position.set(x, 0.42, z);
    // realism detail: the whole wheel (tyre, dark rim disc, three
    // crossed alloy spokes, hub cap) spins as one group — syncMesh
    // still just advances metadata.spin.rotation.x, as before
    const spin = groupNode(scene, pivot);
    const w = cylMesh(scene, 0.84, 0.84, 0.3, 20, wheelMat);
    w.rotation.z = Math.PI / 2;
    markShadow(w, true, false);
    w.parent = spin;
    const rim = cylMesh(scene, 0.5, 0.5, 0.31, 14, wheelMat);
    rim.rotation.z = Math.PI / 2;
    rim.parent = spin;
    for (let s = 0; s < 3; s++) {
      const spoke = boxMesh(scene, 0.33, 0.46, 0.09, hubMat);
      spoke.rotation.x = s * Math.PI / 3;
      spoke.parent = spin;
    }
    const cap = cylMesh(scene, 0.15, 0.15, 0.34, 8, hubMat);
    cap.rotation.z = Math.PI / 2;
    cap.parent = spin;
    pivot.metadata = { spin, front: !!front };
    wheels.push(pivot);
  }
  // contact shadow first so it grounds the car even off the shadow camera
  const blob = makeBlobShadow(scene, Wd + 1.5, L + 1.6, 0.42);
  blob.position.y = 0.045;
  blob.parent = grp;
  // lights
  const headMat = basicMat(scene, { color: 0xfff3b8 });
  if (!TAILC) TAILC = tailColors();
  const tails = [];
  const heads = [];
  const headGlows = [];
  const headGlowLocal = [];
  for (const x of [-0.66, 0.66]) {
    const hl = boxMesh(scene, 0.44, 0.18, 0.08, headMat);
    hl.position.set(x, 0.72, L / 2 + 0.62);
    hl.parent = grp;
    heads.push(hl);
    // headlight glow: a small soft halo hugging each lamp housing. Two
    // measured faults made it read as a free-floating orb at the car's
    // SIDE (the reported bug): (1) at 1.15 m wide its edge reached
    // |x| = 1.235, past the body silhouette, and its alpha never went
    // below 0.5; (2) a billboard parented to the rotated car group is
    // placed at parentPos + localPos WITHOUT the parent's rotation in
    // this Babylon build — at heading PI/2 the glows landed 3 m to the
    // car's side (verified from absolute positions: lamp boxes land on
    // the nose, billboards did not). So the glow is now 0.5 m wide
    // (edge |x| = 0.91, inside the hood's 0.94 and body's 1.05
    // half-widths), its alpha follows lampScale() exactly (0 in
    // daylight, max 0.55 at night), and it is NOT parented to the car:
    // it stays a scene-level billboard that Vehicle.placeGlows() seats
    // on the lamp housing from pos + heading every sync.
    const glow = makeBillboard(scene, glowTexture(scene), 0.5, 0.5, { color: 0xffdf9e, opacity: lampScale() * 0.55 });
    headGlows.push(glow);
    headGlowLocal.push({ x, z: L / 2 + 0.7 });
    const tl = boxMesh(scene, 0.44, 0.15, 0.08, basicMat(scene, { color: 0x881122 }));
    tl.position.set(x, 0.76, -L / 2 - 0.32);
    tl.parent = grp;
    tails.push(tl);
  }
  // realism detail: grille between the lamps, a rear plate, exhaust
  const grille = boxMesh(scene, 1.15, 0.15, 0.06, trimMat);
  grille.position.set(0, style === 'van' ? 0.6 : 0.56, L / 2 + 0.6);
  grille.parent = grp;
  const plateMat = pbrMat(scene, { color: 0xe8e6da, roughness: 0.6, envMapIntensity: 0.4 });
  const plate = boxMesh(scene, 0.55, 0.15, 0.03, plateMat);
  if (style === 'van') plate.position.set(0, 0.95, -L / 2 - 0.02);
  else if (style === 'pickup') plate.position.set(0, 0.75, -2.57);
  else plate.position.set(0, 0.58, -L / 2 - 0.51);
  plate.parent = grp;
  if (style !== 'van') {
    const exhaust = cylMesh(scene, 0.1, 0.1, 0.3, 8, trimMat);
    exhaust.rotation.x = Math.PI / 2;
    exhaust.position.set(0.62, 0.24, -L / 2 - 0.2);
    exhaust.parent = grp;
  }
  let barRed = null, barBlue = null;
  if (opts.taxi) {
    const sign = boxMesh(scene, 0.95, 0.3, 0.5, basicMat(scene, { color: 0xffd23e }));
    sign.position.set(0, 1.68, -0.25);
    sign.parent = grp;
  }
  if (opts.police) {
    // white doors over the black body sell the livery at any distance
    for (const s of [-1, 1]) {
      const door = boxMesh(scene, 0.06, 0.44, 1.5, pbrMat(scene, { color: 0xf2f4f6, roughness: 0.4 }));
      door.position.set(s * (Wd / 2 + 0.01), 0.72, 0.05);
      door.parent = grp;
    }
    const bar = groupNode(scene, grp);
    const base = boxMesh(scene, 1.3, 0.1, 0.55, pbrMat(scene, { color: 0x11141a, roughness: 0.6 }));
    base.parent = bar;
    barRed = boxMesh(scene, 0.58, 0.2, 0.5, basicMat(scene, { color: 0xff2233 }));
    barRed.position.set(-0.33, 0.14, 0);
    barRed.name = 'barRed';
    barRed.parent = bar;
    barBlue = boxMesh(scene, 0.58, 0.2, 0.5, basicMat(scene, { color: 0x2266ff }));
    barBlue.position.set(0.33, 0.14, 0);
    barBlue.name = 'barBlue';
    barBlue.parent = bar;
    bar.position.set(0, 1.6, -0.25);
    bar.name = 'lightbar';
  }
  grp.metadata = {
    wheels, tails, heads, headGlows, headGlowLocal, paint, headMat,
    paintHex: opts.police ? 0x151a21 : color,
    barRed, barBlue,
  };
  return grp;
}
// Lightbar parts for a police mesh (null for civilian cars).
export function lightbarParts(mesh) {
  const md = mesh && mesh.metadata;
  if (!md || !md.barRed) return null;
  return { red: md.barRed, blue: md.barBlue };
}

export class Vehicle {
  constructor(scene, color, x, z, heading, opts = {}) {
    this.scene = scene;
    this.colorIndex = opts.colorIndex !== undefined ? opts.colorIndex : Math.floor(rand() * CAR_COLORS.length);
    this.mesh = makeCarMesh(scene, color, { ...opts });
    this.mesh.position.set(x, 0, z);
    this.mesh.rotation.y = heading;
    this.pos = this.mesh.position;
    this.heading = heading;
    this.speed = 0;
    this.steer = 0;
    this.health = 100;
    this.kind = opts.kind || 'car';
    this.style = opts.style || 'sedan';
    this.parked = !!opts.parked;
    this.isPlayerCar = false;
    this.dead = false;
    this.smokeTimer = 0;
    this.maxSpeed = opts.maxSpeed || randRange(25, 32);
    // staged damage + drama state
    this.crashed = 0;
    this.smoking = false;
    this.flaming = false;
    this.fireTimer = 0;
    this.exploded = false;
    this.tireBlown = 0;         // -1 left, +1 right, 0 intact
    this.handbrake = false;
    this.burnout = 0;
    this.braking = false;
    this.honkTimer = randRange(1, 5);
    this.axis = opts.axis || (rand() > 0.5 ? 'x' : 'z');
    this.dir = opts.dir || (rand() > 0.5 ? 1 : -1);
    this.laneCoord = opts.laneCoord !== undefined ? opts.laneCoord : nearestRoadCoord(this.axis === 'x' ? z : x);
    this.cruise = randRange(10, 16);
    this.brake = 0;
    this.swerve = 0;
    this.pulledOver = 0;
    // traffic perception state: bounding-circle radius used by the
    // probe corridor, the IDM-lite follower and the push-out pass
    this.radius = 2.35;
    this.stuckTimer = 0;      // seconds spent blocked behind a stopped lead
    this.yieldHold = 0;       // junction-yield clear timer (0.6 s to proceed)
    this.placeGlows();
  }
  // Seat the headlight glow billboards on the lamp housings. They are
  // scene-level meshes (see makeCarMesh for why they cannot be parented
  // to the rotated car group), so their world position is computed here
  // from pos + heading with the same R_y(h) the lamp boxes get from the
  // group: right = (cos h, -sin h), forward = (sin h, cos h).
  placeGlows() {
    const md = this.mesh && this.mesh.metadata;
    if (!md || !md.headGlows || !md.headGlowLocal) return;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const rx = Math.cos(this.heading), rz = -Math.sin(this.heading);
    for (let i = 0; i < md.headGlows.length; i++) {
      const g = md.headGlows[i], lp = md.headGlowLocal[i];
      if (!g || !lp) continue;
      g.position.set(this.pos.x + rx * lp.x + fx * lp.z, 0.72, this.pos.z + rz * lp.x + fz * lp.z);
    }
  }
  get x() { return this.pos.x; }
  get z() { return this.pos.z; }
  forwardX() { return Math.sin(this.heading); }
  forwardZ() { return Math.cos(this.heading); }
  // Dispose the car: the mesh subtree AND the scene-level glow
  // billboards (they are not descendants of the mesh, so a bare
  // removeNode(this.mesh) would orphan them in the scene).
  dispose() {
    const md = this.mesh && this.mesh.metadata;
    if (md && md.headGlows) for (const g of md.headGlows) removeNode(g);
    removeNode(this.mesh);
  }
  damageStage() { return this.health > 68 ? 0 : this.health > 38 ? 1 : this.health > 16 ? 2 : 3; }
  setColor(hex) {
    const md = this.mesh.metadata;
    if (md && md.paint) { md.paint.albedoColor = C3(hex); md.paintHex = hex; }
  }
  paintHex() { return this.mesh.metadata ? this.mesh.metadata.paintHex : 0; }

  // Arcade driving with weight. throttle -1..1, steerInput -1..1 (A = +1
  // turns left), extras: { handbrake, bothPedals } from the player's keys.
  drive(dt, throttle, steerInput, colliders, extras = {}) {
    if (this.dead) { this.speed = 0; return; }
    const stage = this.damageStage();
    const power = stage === 2 ? 0.62 : stage >= 3 ? 0.35 : 1;   // sputtering engine
    const sputter = stage === 2 ? (Math.sin(G.time * 31) > 0.72 ? 0.3 : 1) : 1;
    // burnout: gas + brake together from a standstill, then a boosted launch
    this.braking = throttle < 0 && this.speed > 0.5;
    if (extras.bothPedals && Math.abs(this.speed) < 1.2) {
      this.burnout = Math.min(1.2, this.burnout + dt);
      this.speed = 0;
      this.syncMesh(dt);
      return;
    }
    let launch = 1;
    if (this.burnout > 0.35 && throttle > 0) launch = 1.9;
    if (throttle <= 0) this.burnout = Math.max(0, this.burnout - dt * 3);
    const accel = throttle > 0 ? 12 * power * sputter * launch : throttle < 0 ? (this.speed > 0.5 ? -22 : -9.5) : 0;
    this.speed += accel * dt;
    if (throttle === 0) this.speed -= this.speed * 0.5 * dt;
    this.speed -= this.speed * Math.abs(steerInput) * (extras.handbrake ? 0.02 : 0.13) * dt;
    const top = this.maxSpeed * power * (this.tireBlown ? 0.72 : 1);
    this.speed = clamp(this.speed, -9.5, top);
    if (Math.abs(this.speed) < 0.02 && throttle === 0) this.speed = 0;
    this.steer = steerInput;
    this.handbrake = !!extras.handbrake && Math.abs(this.speed) > 3;
    if (this.handbrake) this.speed -= this.speed * 0.55 * dt;
    // speed-sensitive steering: lazy at a crawl, sharp mid-range, calmer flat-out
    const spd = Math.abs(this.speed);
    const steerAuthority = clamp(spd / 5, 0, 1) * (1 - clamp((spd - 19) / 30, 0, 0.45));
    const turnRate = this.handbrake ? 2.5 : 1.6;
    let yaw = -steerInput * steerAuthority * turnRate * dt * (this.speed < 0 ? -1 : 1);
    if (this.tireBlown) yaw += this.tireBlown * 0.22 * dt * clamp(spd / 8, 0, 1); // pulls to the flat side
    this.heading += yaw;
    // drift: with the handbrake up the velocity lags the nose
    if (this.handbrake) this.heading += -steerInput * 0.55 * dt;
    const nx = this.pos.x + this.forwardX() * this.speed * dt;
    const nz = this.pos.z + this.forwardZ() * this.speed * dt;
    const before = { x: this.pos.x, z: this.pos.z };
    const probe = { x: nx, z: nz };
    const hit = collideCircle(probe, 1.7, colliders);
    // side impact test: hit while moving mostly sideways into the box
    if (hit) {
      const impact = Math.abs(this.speed);
      this.pos.x = probe.x; this.pos.z = probe.z;
      if (impact > 6.5) {
        this.health -= impact * 0.7;
        this.crashed = impact;
        const sidePush = Math.abs((probe.x - before.x) * this.forwardZ() - (probe.z - before.z) * this.forwardX());
        if (impact > 12.5 && sidePush > 0.35 && !this.tireBlown && rand() > 0.35) {
          this.tireBlown = rand() > 0.5 ? 1 : -1;
          this.tireEvent = true;
        }
      }
      // camera fix: the old code reversed EVERY hit (speed *= -0.25),
      // so even a slow scrape bounced the car backwards and fed the
      // crash-shake path. Now only a hard hit (impact > 11) bounces;
      // anything lighter stops dead against the obstacle — the
      // collideCircle push-out above has already slid the car out
      // along the obstacle's face, so it grinds to a halt instead of
      // rebounding. Damage / crashed / tireBlown thresholds above are
      // unchanged (> 6.5 / > 12.5).
      if (impact > 11) this.speed *= -0.25;
      else this.speed = 0;
    } else {
      this.pos.x = nx; this.pos.z = nz;
    }
    this.pos.x = clamp(this.pos.x, -WORLD.half - 30, WORLD.half + 30);
    this.pos.z = clamp(this.pos.z, -WORLD.half - 6, WORLD.oceanZ + 6);
    this.syncMesh(dt);
  }

  // Traffic brain v2.1: lane-follow with real car-following. Each tick the
  // car probes a forward corridor, follows the vehicle ahead IDM-lite,
  // yields at occupied junctions, honours red lights, pulls over for
  // sirens, and never accelerates into a gap below its minimum. The
  // player's car (and Rina on foot) are part of the perception set.
  trafficUpdate(dt, obstacles, colliders, ctx = {}) {
    if (this.parked || this.isPlayerCar || this.dead) return;
    const fx = this.forwardX(), fz = this.forwardZ();
    const others = ctx.vehicles || obstacles || [];
    // ---- 1. perception probes: full lookahead + a half-length probe.
    // A vehicle counts as "ahead" when its bounding circle intersects the
    // corridor; parked cars are excluded (they sit off-lane by design).
    const lookahead = clamp(4 + this.speed * 0.9, 5, 16);
    let lead = null, leadGap = Infinity, leadDist = Infinity, leadSide = 0;
    for (const o of others) {
      if (o === this || o.parked || o.dead) continue;
      const dx = o.x - this.pos.x, dz = o.z - this.pos.z;
      const ahead = dx * fx + dz * fz;
      const side = dx * fz - dz * fx;
      const oR = o.radius || 2.35;
      const corridor = ahead < lookahead * 0.5 ? 2.3 : 1.9;   // half probe is a touch wider
      if (ahead > -oR && ahead < lookahead + oR && Math.abs(side) < corridor) {
        const gap = ahead - (this.radius + oR);
        if (gap < leadGap) { leadGap = gap; leadDist = ahead; leadSide = side; lead = o; }
      }
    }
    let want = this.cruise;
    let hardStop = false;
    // ---- 2. car-following (IDM-lite): desired gap grows with speed; match
    // the lead's speed minus a closing correction; a stopped lead inside
    // 3 m means a full stop. Never accelerate into a sub-minimum gap.
    if (lead) {
      const desired = 2.2 + this.speed * 0.8;
      if (leadGap < desired) {
        const leadSpeed = Math.max(0, lead.speed || 0);
        let follow = leadSpeed - (desired - leadGap) * 0.85;
        if (leadSpeed < 0.5 && leadGap < 3) { follow = 0; hardStop = true; }
        want = Math.min(want, Math.max(0, follow));
      }
      if (leadGap < 0.6) { want = 0; hardStop = true; }
      // close + fast + offset lead: shy sideways a little, like a driver
      if (leadDist < 5 && this.speed > 4) this.swerve = clamp(-Math.sign(leadSide || 1) * 0.5, -1, 1);
    }
    // ---- honk: blocked behind a stopped lead (the player's car included)
    // for over 2 s. Reuses the existing honk event/audio path.
    this.honkTimer -= dt;
    if (lead && this.speed < 1.5 && want <= 1) {
      this.stuckTimer += dt;
      const threshold = (lead.isPlayerCar || lead.playerProxy) ? 2 : 2.8;
      if (this.stuckTimer > threshold && this.honkTimer <= 0) {
        this.honkTimer = randRange(2.5, 6);
        this.stuckTimer = 0;
        this.honkEvent = true;
      }
    } else this.stuckTimer = 0;
    // ---- 3. junction yield: if the next intersection box is occupied (or
    // a car is stopped at a conflicting entry), brake to the entry line
    // and proceed only after it has been clear for 0.6 s.
    {
      const alongPos = this.axis === 'z' ? this.pos.z : this.pos.x;
      const rel = (alongPos + WORLD.half) / WORLD.roadEvery;
      const nextIdx = this.dir > 0 ? Math.floor(rel) + 1 : Math.ceil(rel) - 1;
      const crossCoord = -WORLD.half + nextIdx * WORLD.roadEvery;
      const dEntry = this.dir * ((crossCoord - this.dir * (WORLD.roadWidth / 2 + 1.5)) - alongPos);
      const jx = this.axis === 'z' ? nearestRoadCoord(this.pos.x) : crossCoord;
      const jz = this.axis === 'z' ? crossCoord : nearestRoadCoord(this.pos.z);
      const iAmInBox = Math.abs(this.pos.x - jx) < 10 && Math.abs(this.pos.z - jz) < 10;
      let blocked = false;
      if (!iAmInBox && dEntry > -2 && dEntry < 16) {
        for (const o of others) {
          if (o === this || o.parked || o.dead) continue;
          if (Math.abs(o.x - jx) < 12 && Math.abs(o.z - jz) < 12) { blocked = true; break; }
        }
      }
      if (blocked) this.yieldHold = 0.6;
      else this.yieldHold = Math.max(0, this.yieldHold - dt);
      if (!iAmInBox && this.yieldHold > 0 && dEntry > -2 && dEntry < 16) {
        want = dEntry < 8 ? 0 : Math.min(want, 3);
        if (dEntry < 8) hardStop = true;
      }
    }
    // pull over for a siren behind
    if (ctx.police) {
      for (const u of ctx.police) {
        const dx = this.pos.x - u.x, dz = this.pos.z - u.z;
        const behind = -(dx * fx + dz * fz);
        const d = Math.sqrt(dx * dx + dz * dz);
        if (behind > 0 && behind < 16 && d < 18) this.pulledOver = 1.4;
      }
    }
    this.pulledOver = Math.max(0, this.pulledOver - dt);
    if (this.pulledOver > 0) want = 0;
    // red lights: stop at the line when our axis is red
    const ph = G.time % 12;
    const nsGreen = ph < 5, ewGreen = ph >= 6 && ph < 11;
    const myGreen = this.axis === 'z' ? nsGreen : ewGreen;
    if (!myGreen) {
      const crossCoord = this.axis === 'z' ? nearestRoadCoord(this.pos.z + this.dir * 10) : nearestRoadCoord(this.pos.x + this.dir * 10);
      const along = this.axis === 'z' ? this.pos.z : this.pos.x;
      const distToLine = (crossCoord - this.dir * 11) - along;
      if ((this.dir > 0 && distToLine > 0 && distToLine < 7) || (this.dir < 0 && distToLine < 0 && distToLine > -7)) want = 0;
    }
    // ---- speed control: accelerate gently, brake firmly (harder for a
    // hard stop), and clamp so a follower can never surge past its target
    let throttle = 0;
    if (this.speed < want) {
      this.speed = Math.min(want, this.speed + 7 * dt);
      throttle = 0.55;
    } else if (this.speed > want) {
      this.speed = Math.max(want, this.speed - (hardStop ? 17 : 11) * dt);
      throttle = -0.4;
    }
    this.speed = clamp(this.speed, 0, this.cruise + 2);
    const targetCoord = this.laneCoord + this.dir * 3.8 + (this.pulledOver > 0 ? this.dir * 3.4 : 0) + this.swerve * 1.6;
    this.swerve *= Math.max(0, 1 - dt * 2.2);
    const canTurn = this.speed > 3 && !lead;   // never turn across a queue
    if (this.axis === 'z') {
      const err = targetCoord - this.pos.x;
      this.heading = this.dir > 0 ? 0 : Math.PI;
      this.pos.x += clamp(err, -1, 1) * dt * 3;
      this.pos.z += this.dir * this.speed * dt;
      if (Math.abs(this.pos.z) > WORLD.half - 6) this.dir *= -1;
      const cross = nearestRoadCoord(this.pos.z);
      if (canTurn && Math.abs(cross - this.pos.z) < 1.4 && rand() < dt * 0.16) { this.axis = 'x'; this.laneCoord = cross; this.pos.z = cross; }
    } else {
      const err = targetCoord - this.pos.z;
      this.heading = this.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      this.pos.z += clamp(err, -1, 1) * dt * 3;
      this.pos.x += this.dir * this.speed * dt;
      if (Math.abs(this.pos.x) > WORLD.half - 6) this.dir *= -1;
      const cross = nearestRoadCoord(this.pos.x);
      if (canTurn && Math.abs(cross - this.pos.x) < 1.4 && rand() < dt * 0.16) { this.axis = 'z'; this.laneCoord = cross; this.pos.x = cross; }
    }
    this.braking = throttle < 0 || want === 0 || (lead !== null && this.speed > want + 0.5);
    collideCircle(this.pos, 1.7, colliders);
    this.syncMesh(dt);
  }

  syncMesh(dt) {
    this.mesh.rotation.y = this.heading;
    this.placeGlows();
    const md = this.mesh.metadata || {};
    const wheels = md.wheels || [];
    for (const pivot of wheels) {
      const pm = pivot.metadata || {};
      if (pm.spin) pm.spin.rotation.x += (this.speed * dt) / 0.42;
      if (pm.front) pivot.rotation.y = -this.steer * 0.42;
    }
    if (!TAILC) TAILC = tailColors();
    // Lamp emissives (lighting adaptation): at dusk/night every car's
    // headlights burn brighter and its taillights glow running-light
    // red; braking still wins with full brake red. Daytime keeps the
    // original golden-hour look. (basicMat is an emissive PBR, so the
    // emissive colour/intensity is what actually shows — the old
    // diffuseColor write never reached the shader.)
    const ls = lampScale();
    const tails = md.tails || [];
    for (const t of tails) {
      if (this.braking) t.material.emissiveColor.copyFrom(TAILC.on);
      else if (ls > 0.02) BABYLON.Color3.LerpToRef(TAILC.off, TAILC.on, ls * 0.8, t.material.emissiveColor);
      else t.material.emissiveColor.copyFrom(TAILC.off);
    }
    if (md.headMat) md.headMat.emissiveIntensity = 1 + ls * 1.8;
    const glows = md.headGlows || [];
    // glow halo follows lampScale() exactly: invisible all day (ls 0),
    // a subtle 0.24 at the 17:42 start (ls ≈ 0.44), max 0.55 at night.
    for (const g of glows) { if (g.material) g.material.alpha = ls * 0.55; }
    // staged smoke / fire flags the main loop turns into particles
    const stage = this.damageStage();
    if (!this.dead && stage >= 1) {
      this.smokeTimer -= dt;
      if (this.smokeTimer <= 0) { this.smokeTimer = stage === 1 ? 0.3 : 0.12; this.smoking = true; }
    }
    if (!this.dead && stage >= 3) {
      this.flaming = true;
      this.fireTimer += dt;
      if (this.fireTimer > 3.4 && !this.exploded) { this.exploded = true; this.explodeEvent = true; }
    }
    if (this.health <= 0 && !this.dead) {
      this.dead = true;
      this.speed = 0;
      this.mesh.rotation.z = 0.07;
      const paint = md.paint;
      if (paint) paint.albedoColor = paint.albedoColor.scale(0.35);
    }
  }
}

const STYLES = ['sedan', 'sedan', 'coupe', 'pickup', 'van', 'coupe'];
export function spawnTraffic(scene, count) {
  const cars = [];
  const lines = roadLines();
  for (let i = 0; i < count; i++) {
    const axis = rand() > 0.5 ? 'x' : 'z';
    const line = randPick(lines);
    let along = randRange(-WORLD.half + 10, WORLD.half - 10);
    const dir = rand() > 0.5 ? 1 : -1;
    const lane = line + dir * 3.8;
    // keep freshly spawned traffic out of each other's bumpers
    for (let tries = 0; tries < 6; tries++) {
      const px = axis === 'z' ? lane : along, pz = axis === 'z' ? along : lane;
      let clear = true;
      for (const o of cars) { const ddx = o.x - px, ddz = o.z - pz; if (ddx * ddx + ddz * ddz < 121) { clear = false; break; } }
      if (clear) break;
      along = randRange(-WORLD.half + 10, WORLD.half - 10);
    }
    const x = axis === 'z' ? lane : along;
    const z = axis === 'z' ? along : lane;
    const kind = rand() > 0.86 ? 'taxi' : 'car';
    const ci = Math.floor(rand() * CAR_COLORS.length);
    const color = kind === 'taxi' ? 0xffc300 : CAR_COLORS[ci];
    const style = kind === 'taxi' ? 'sedan' : randPick(STYLES);
    const v = new Vehicle(scene, color, x, z, 0, { axis, dir, laneCoord: line, kind, taxi: kind === 'taxi', style, colorIndex: ci });
    v.heading = axis === 'z' ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? Math.PI / 2 : -Math.PI / 2);
    v.mesh.rotation.y = v.heading;
    cars.push(v);
  }
  return cars;
}
export function spawnParked(scene, count) {
  const cars = [];
  const lines = roadLines();
  for (let i = 0; i < count; i++) {
    const vertical = rand() > 0.5;
    const line = randPick(lines);
    const along = randRange(-WORLD.half + 14, WORLD.half - 14);
    const side = rand() > 0.5 ? 7.6 : -7.6;
    const x = vertical ? line + side : along;
    const z = vertical ? along : line + side;
    const ci = Math.floor(rand() * CAR_COLORS.length);
    const v = new Vehicle(scene, CAR_COLORS[ci], x, z, vertical ? 0 : Math.PI / 2, { parked: true, style: randPick(STYLES), colorIndex: ci });
    cars.push(v);
  }
  const coupe = new Vehicle(scene, 0xff5a3c, -124, 196, Math.PI / 2, { parked: true, style: 'coupe' });
  coupe.isMissionCar = true;
  cars.push(coupe);
  return cars;
}

// ---------------------------------------------------------------------------
// Anti-interpenetration net (v2.1): after every vehicle has moved, resolve
// bounding-circle overlaps with a gentle positional push-out. The
// correction is split by movability — the player's car is never shoved
// by traffic (the traffic car takes the full correction), parked and
// dead cars never move, and a police car ramming the PLAYER is intended
// behaviour, so that pair is never separated. Police DO get pushed out
// of traffic cars so chases do not clip through queues. Purely
// positional: it changes no speeds, health, wanted or crime state, so
// traffic-vs-traffic contact can never hurt the player.
export function resolveVehicleOverlaps(vehicles, playerCar = null) {
  let resolved = 0, maxOverlap = 0;
  for (let i = 0; i < vehicles.length; i++) {
    const a = vehicles[i];
    if (!a || a.parked || a.dead) continue;
    for (let j = i + 1; j < vehicles.length; j++) {
      const b = vehicles[j];
      if (!b || b.parked || b.dead) continue;
      if (playerCar && ((a.kind === 'police' && b === playerCar) || (b.kind === 'police' && a === playerCar))) continue;
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
      const minD = (a.radius || 2.35) + (b.radius || 2.35);
      const d2 = dx * dx + dz * dz;
      if (d2 >= minD * minD) continue;
      let d = Math.sqrt(d2), ux, uz;
      if (d < 0.001) { const ang = ((i * 37 + j * 91) % 628) / 100; ux = Math.cos(ang); uz = Math.sin(ang); d = 0.001; }
      else { ux = dx / d; uz = dz / d; }
      const overlap = minD - d;
      if (overlap > maxOverlap) maxOverlap = overlap;
      const wa = (a === playerCar || a.isPlayerCar) ? 0 : 1;
      const wb = (b === playerCar || b.isPlayerCar) ? 0 : 1;
      const wSum = wa + wb;
      if (!wSum) continue;
      a.pos.x -= ux * overlap * (wa / wSum);
      a.pos.z -= uz * overlap * (wa / wSum);
      b.pos.x += ux * overlap * (wb / wSum);
      b.pos.z += uz * overlap * (wb / wSum);
      resolved++;
    }
  }
  return { resolved, maxOverlap };
}

// ---------------------------------------------------------------------------
// Boat: a simple drivable motorboat for the harbour (story addendum
// M9/M10). Box hull + console + outboard; floats on the sea plane with a
// sine bob, drives like a slow, slidey car that is fenced to open water.
export class Boat {
  constructor(scene, x, z, heading, opts = {}) {
    const grp = groupNode(scene);
    const hullMat = pbrMat(scene, { color: opts.color || 0xf4f6f8, roughness: 0.35, metalness: 0.15, envMapIntensity: 0.7 });
    const hull = boxMesh(scene, 2.6, 0.9, 6.4, hullMat);
    hull.position.y = 0.35;
    markShadow(hull, true, false);
    hull.parent = grp;
    const bow = boxMesh(scene, 1.7, 0.7, 1.6, hullMat);
    bow.position.set(0, 0.42, 3.6);
    markShadow(bow, true, false);
    bow.parent = grp;
    const console_ = boxMesh(scene, 1.5, 0.9, 1.1,
      pbrMat(scene, { color: 0x2277aa, roughness: 0.3, metalness: 0.2 }));
    console_.position.set(0, 1.1, 0.5);
    markShadow(console_, true, false);
    console_.parent = grp;
    const motor = boxMesh(scene, 0.6, 1.0, 0.4,
      pbrMat(scene, { color: 0x14181d, roughness: 0.5, metalness: 0.4 }));
    motor.position.set(0, 0.75, -3.4);
    motor.parent = grp;
    if (opts.police) {
      const stripe = boxMesh(scene, 2.65, 0.3, 6.45,
        pbrMat(scene, { color: 0x14406e, roughness: 0.4 }));
      stripe.position.y = 0.55;
      stripe.parent = grp;
    }
    grp.position.set(x, 0, z);
    grp.rotation.y = heading;
    this.mesh = grp;
    this.pos = grp.position;
    this.heading = heading;
    this.speed = 0;
    this.health = 100;
    this.dead = false;
    this.driver = null;             // 'player' | 'ai' | null
    this.isPolice = !!opts.police;
    this.phase = Math.random() * 6;
    this.maxSpeed = opts.maxSpeed || 14;
  }
  get x() { return this.pos.x; }
  get z() { return this.pos.z; }
  // throttle -1..1, steer -1..1 (A = +1 turns left, same convention as cars)
  drive(dt, throttle, steer) {
    if (this.dead) { this.speed = 0; return; }
    const accel = throttle > 0 ? 8.5 : throttle < 0 ? -6 : 0;
    this.speed += accel * dt;
    this.speed -= this.speed * 0.55 * dt;                    // water drag
    this.speed = clamp(this.speed, -4.5, this.maxSpeed);
    const turn = steer * clamp(Math.abs(this.speed) / 6, 0, 1) * 0.85 * (this.speed < 0 ? -1 : 1);
    this.heading += turn * dt;
    this.pos.x += Math.sin(this.heading) * this.speed * dt;
    this.pos.z += Math.cos(this.heading) * this.speed * dt;
    // fenced to open water: never beach, never leave the harbour
    if (this.pos.z < 247) { this.pos.z = 247; this.speed *= 0.4; }
    if (this.pos.z > 335) { this.pos.z = 335; this.speed *= 0.4; }
    this.pos.x = clamp(this.pos.x, -285, 285);
    this.syncMesh(dt);
  }
  syncMesh(dt) {
    this.mesh.rotation.y = this.heading;
    this.mesh.position.y = -0.25 + Math.sin(G.time * 1.6 + this.phase) * 0.1;
    this.mesh.rotation.z = Math.sin(G.time * 1.1 + this.phase) * 0.02 - (this.steerVis || 0) * 0.03;
    this.mesh.rotation.x = -this.speed * 0.006 + Math.sin(G.time * 1.3 + this.phase) * 0.012;
  }
}
