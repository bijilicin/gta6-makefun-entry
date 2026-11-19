// Pedestrians for Solmaris — Babylon.js port (v3 engine rewrite).
// An articulated low-poly rig (pelvis, torso, head, upper/lower arms and
// legs on pivot nodes) with a procedural walk/run cycle, idle sway and a
// phone-filming pose. Behaviour is reactive: peds dive from speeding
// cars, flee screaming from gunfire and crashes, and some stop to film
// Rina — committing a crime on camera feeds the wanted system extra heat
// through G.filmingWitnesses.
//
// Babylon notes: rig pivots are TransformNodes; the named joints live in
// the root node's metadata.nodes map (the Babylon equivalent of the
// three.js getObjectByName lookups the animation used). Poses, timings
// and behaviour states are identical to the three.js build.

import { WORLD, G, rand, randRange, randPick, clamp, nearestRoadCoord } from './state.js';
import { collideCircle, makeBlobShadow, pbrMat, basicMat, boxMesh, groupNode, markShadow, removeNode, uid } from './world.js';

const SHIRTS = [0xff6b6b, 0x4ecdc4, 0xffe66d, 0xf7fff7, 0xff9f1c, 0x7bdff2, 0xf15bb5, 0xfee440, 0x95d5b2, 0xff8fa3];
const PANTS = [0x2b3a4a, 0x5b4a3f, 0x33415c, 0x6c757d, 0x463f3a];
const SKINS = [0xf2c49b, 0xc68863, 0x8d5524, 0xffdbac, 0xe0ac69];

// Limb segment (cube build, restored per user verdict 2026-11-19): a
// plain box hung below its pivot (shoulder/hip), offset -h/2 from the
// pivot node, so every pivot, pose and timing in animatePerson drives
// it exactly as before — only the silhouette is blocky again.
function limb(scene, w, h, d, mat) {
  const m = boxMesh(scene, w, h, d, mat);
  m.position.y = -h / 2;
  markShadow(m, true, false);
  return m;
}
// Torso/hip volume (cube build): a plain box, same centre and size
// envelope the rounded volume used.
function bodyBox(scene, radius, height, flatZ, mat) {
  const m = boxMesh(scene, radius * 2, height, radius * 2 * flatZ, mat);
  markShadow(m, true, false);
  return m;
}
export function makePersonMesh(scene, shirt, skin, opts = {}) {
  const grp = groupNode(scene);
  const scale = opts.scale || 1;
  // per-person roughness variance so clothes do not read as one flat cloth
  const shirtMat = pbrMat(scene, { color: shirt, roughness: randRange(0.55, 0.95), envMapIntensity: 0.25 });
  const pantsMat = pbrMat(scene, { color: opts.pants ?? randPick(PANTS), roughness: randRange(0.8, 1.0), envMapIntensity: 0.25 });
  const skinMat = pbrMat(scene, { color: skin, roughness: randRange(0.6, 0.85), envMapIntensity: 0.25 });
  const nodes = {};
  const pelvis = groupNode(scene, grp);
  pelvis.position.y = 0.92;
  pelvis.name = 'pelvis';
  nodes.pelvis = pelvis;
  const hips = bodyBox(scene, 0.25, 0.3, 0.62, pantsMat);
  hips.parent = pelvis;
  const torso = groupNode(scene, pelvis);
  torso.position.y = 0.1;
  torso.name = 'torso';
  nodes.torso = torso;
  const chest = bodyBox(scene, 0.31, 0.66, 0.55, shirtMat);
  chest.position.y = 0.33;
  chest.scaling.x = 1.05;
  chest.parent = torso;
  const headG = groupNode(scene, torso);
  headG.position.y = 0.72;
  headG.name = 'head';
  nodes.head = headG;
  // cube head: a plain box, same centre and envelope as the sphere it
  // replaces (user verdict 2026-11-19: characters read better as cubes)
  const head = boxMesh(scene, 0.46, 0.5, 0.46, skinMat);
  head.position.y = 0.2;
  markShadow(head, true, false);
  head.parent = headG;
  // hair cap (cube build): a flat box slab riding high and back on the
  // head, so the face stays skin. Style/colour come from a
  // deterministic hash of the person's own colours — no extra draws
  // from the shared game rand, so spawn sequences are untouched. The
  // player passes noHair (her own hair/shades are added in player.js).
  if (!opts.noHair) {
    const hfrac = Math.abs(Math.sin(shirt * 12.9898 + skin * 78.233) * 43758.5453) % 1;
    if (hfrac > 0.18) {
      const hairCols = [0x181008, 0x3a2410, 0x6b4a2a, 0x8a8d90, 0xb5522c, 0xd8c26a];
      const hairMat = pbrMat(scene, { color: hairCols[Math.floor(hfrac * 61) % hairCols.length], roughness: 0.92, envMapIntensity: 0.15 });
      const hair = boxMesh(scene, 0.52, 0.24, 0.52, hairMat);
      hair.position.set(0, 0.37, -0.04);
      markShadow(hair, true, false);
      hair.parent = headG;
    }
  }
  const mkArm = (side) => {
    const sh = groupNode(scene, torso);
    sh.position.set(side * 0.39, 0.58, 0);
    sh.name = side < 0 ? 'armL' : 'armR';
    const upper = limb(scene, 0.15, 0.36, 0.15, shirtMat);
    upper.parent = sh;
    const el = groupNode(scene, sh);
    el.position.y = -0.36;
    el.name = side < 0 ? 'elbowL' : 'elbowR';
    const fore = limb(scene, 0.13, 0.34, 0.13, skinMat);
    fore.parent = el;
    nodes[sh.name] = sh;
    nodes[el.name] = el;
    return sh;
  };
  const mkLeg = (side) => {
    const hip = groupNode(scene, pelvis);
    hip.position.set(side * 0.14, -0.08, 0);
    hip.name = side < 0 ? 'legL' : 'legR';
    const thigh = limb(scene, 0.19, 0.44, 0.2, pantsMat);
    thigh.parent = hip;
    const knee = groupNode(scene, hip);
    knee.position.y = -0.44;
    knee.name = side < 0 ? 'kneeL' : 'kneeR';
    const shin = limb(scene, 0.15, 0.42, 0.16, opts.bareLegs ? skinMat : pantsMat);
    shin.parent = knee;
    nodes[hip.name] = hip;
    nodes[knee.name] = knee;
    return hip;
  };
  mkArm(-1); mkArm(1); mkLeg(-1); mkLeg(1);
  grp.scaling.set(scale, scale, scale);
  grp.metadata = { rig: true, nodes };
  return grp;
}
// Look up a named rig joint (pelvis/torso/head/armL/...) on a person mesh.
export function personNode(mesh, name) {
  return mesh && mesh.metadata && mesh.metadata.nodes ? mesh.metadata.nodes[name] || null : null;
}
// Shared procedural animation: walkPhase advances with speed; mode picks
// the pose family (walk, run, flee with arms up, film, aim, idle sway).
export function animatePerson(mesh, phase, mode, t) {
  const q = (n) => personNode(mesh, n);
  const legL = q('legL'), legR = q('legR'), kneeL = q('kneeL'), kneeR = q('kneeR');
  const armL = q('armL'), armR = q('armR'), elbowL = q('elbowL'), elbowR = q('elbowR');
  const torso = q('torso'), pelvis = q('pelvis');
  if (!legL) return;
  const sw = Math.sin(phase), sw2 = Math.sin(phase + Math.PI);
  if (mode === 'idle') {
    legL.rotation.x = legR.rotation.x = 0;
    kneeL.rotation.x = kneeR.rotation.x = 0;
    armL.rotation.x = Math.sin(t * 1.4) * 0.05;
    armR.rotation.x = -Math.sin(t * 1.4) * 0.05;
    elbowL.rotation.x = elbowR.rotation.x = -0.12;
    if (torso) torso.rotation.x = Math.sin(t * 1.4) * 0.02;
    if (pelvis) pelvis.position.y = 0.92 + Math.sin(t * 1.4) * 0.012;
    return;
  }
  if (mode === 'film') {
    legL.rotation.x = legR.rotation.x = 0;
    kneeL.rotation.x = kneeR.rotation.x = 0;
    armL.rotation.x = -1.25; armR.rotation.x = -1.35;
    elbowL.rotation.x = -0.5; elbowR.rotation.x = -0.35;
    if (torso) torso.rotation.x = 0.03;
    return;
  }
  if (mode === 'aim') {
    legL.rotation.x = 0.06; legR.rotation.x = -0.06;
    kneeL.rotation.x = 0.08; kneeR.rotation.x = 0.08;
    armR.rotation.x = -1.5; elbowR.rotation.x = -0.06;
    armL.rotation.x = -1.1; elbowL.rotation.x = -0.7;
    if (torso) torso.rotation.x = 0.05;
    return;
  }
  const amp = mode === 'run' || mode === 'flee' ? 0.85 : 0.5;
  legL.rotation.x = sw * amp;
  legR.rotation.x = sw2 * amp;
  kneeL.rotation.x = Math.max(0, -sw2) * 0.9;
  kneeR.rotation.x = Math.max(0, -sw) * 0.9;
  if (mode === 'flee') {
    armL.rotation.x = 2.7; armR.rotation.x = 2.7;
    elbowL.rotation.x = 0.3; elbowR.rotation.x = 0.3;
  } else {
    armL.rotation.x = sw2 * amp * 0.8;
    armR.rotation.x = sw * amp * 0.8;
    elbowL.rotation.x = -0.25 - Math.max(0, sw) * 0.3;
    elbowR.rotation.x = -0.25 - Math.max(0, sw2) * 0.3;
  }
  if (torso) torso.rotation.x = mode === 'run' ? 0.14 : 0.05;
  if (pelvis) pelvis.position.y = 0.92 + Math.abs(Math.cos(phase)) * 0.05;
}

export class Ped {
  constructor(scene, x, z) {
    this.scene = scene;
    const scale = rand() > 0.25 ? randRange(0.95, 1.05) : randRange(0.82, 0.9);
    this.mesh = makePersonMesh(scene, randPick(SHIRTS), randPick(SKINS), { scale, bareLegs: z > WORLD.beachZ - 4 });
    this.mesh.position.set(x, 0, z);
    // contact blob shadow, kept in the scene so it stays flat when the
    // ped dives or is knocked down
    this.blob = makeBlobShadow(scene, 1.15, 1.15, 0.34);
    this.blob.position.set(x, 0.03, z);
    this.pos = this.mesh.position;
    this.heading = randRange(0, Math.PI * 2);
    this.speed = randRange(1.1, 2.1);
    this.state = 'walk';        // walk | flee | down | film | dive
    this.timer = randRange(2, 7);
    this.downTime = 0;
    this.walkPhase = randRange(0, 6);
    this.films = rand() > 0.55; // some peds are the filming kind
    this.diveDir = 1;
    this.axis = rand() > 0.5 ? 'x' : 'z';
    this.lineCoord = nearestRoadCoord(this.axis === 'x' ? z : x) + (rand() > 0.5 ? 11.5 : -11.5);
    this.dir = rand() > 0.5 ? 1 : -1;
  }
  knockDown(lethal) {
    if (this.state === 'down') return;
    this.state = 'down';
    this.downTime = lethal ? 9999 : randRange(4, 8);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.y = 0.25;
  }
  update(dt, threat, colliders) {
    if (this.state === 'down') {
      this.downTime -= dt;
      if (this.downTime <= 0) {
        this.state = 'walk';
        this.mesh.rotation.x = 0;
        this.mesh.position.y = 0;
      }
      return;
    }
    // A speeding car dead ahead: dive sideways out of its path.
    if (threat && threat.carSpeed && threat.carSpeed > 7) {
      const dx = this.pos.x - threat.x, dz = this.pos.z - threat.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < 7 && this.state !== 'dive') {
        this.state = 'dive';
        this.timer = 0.55;
        this.diveDir = (dx * Math.cos(threat.heading || 0) - dz * Math.sin(threat.heading || 0)) >= 0 ? 1 : -1;
        this.heading = (threat.heading || 0) + this.diveDir * Math.PI / 2;
      }
    } else if (threat) {
      const dx = this.pos.x - threat.x, dz = this.pos.z - threat.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < 10) {
        this.state = 'flee';
        this.heading = Math.atan2(dx, dz);
        this.timer = 1.7;
      } else if (d < 21 && this.films && this.state === 'walk' && G.time - G.lastCrimeAt < 6) {
        this.state = 'film';
        this.timer = randRange(2.5, 4.5);
        this.heading = Math.atan2(threat.x - this.pos.x, threat.z - this.pos.z);
      }
    }
    if (this.state === 'dive') {
      this.timer -= dt;
      this.walkPhase += dt * 16;
      this.pos.x += Math.sin(this.heading) * 7.5 * dt;
      this.pos.z += Math.cos(this.heading) * 7.5 * dt;
      this.mesh.rotation.z = this.diveDir * 0.5 * Math.max(0, this.timer);
      if (this.timer <= 0) { this.state = 'flee'; this.timer = 1.2; this.mesh.rotation.z = 0; }
    } else if (this.state === 'flee') {
      this.timer -= dt;
      this.walkPhase += dt * 13;
      this.pos.x += Math.sin(this.heading) * 5.6 * dt;
      this.pos.z += Math.cos(this.heading) * 5.6 * dt;
      if (this.timer <= 0) { this.state = 'walk'; this.snapToSidewalk(); }
    } else if (this.state === 'film') {
      this.timer -= dt;
      if (this.timer <= 0) this.state = 'walk';
    } else {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.timer = randRange(3, 9);
        if (rand() > 0.6) { this.axis = this.axis === 'x' ? 'z' : 'x'; this.lineCoord = nearestRoadCoord(this.axis === 'x' ? this.pos.z : this.pos.x) + (rand() > 0.5 ? 11.5 : -11.5); }
        if (rand() > 0.7) this.dir *= -1;
      }
      this.walkPhase += dt * 7;
      if (this.axis === 'x') {
        this.pos.x += this.dir * this.speed * dt;
        this.pos.z += clamp(this.lineCoord - this.pos.z, -1, 1) * dt * 2;
        this.heading = this.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      } else {
        this.pos.z += this.dir * this.speed * dt;
        this.pos.x += clamp(this.lineCoord - this.pos.x, -1, 1) * dt * 2;
        this.heading = this.dir > 0 ? 0 : Math.PI;
      }
      if (Math.abs(this.pos.x) > WORLD.half - 4) this.dir = this.pos.x > 0 ? -1 : 1;
      if (this.pos.z > WORLD.beachZ + 26 || this.pos.z < -WORLD.half + 4) this.dir = this.pos.z > 0 ? -1 : 1;
    }
    collideCircle(this.pos, 0.45, colliders);
    this.pos.x = clamp(this.pos.x, -WORLD.half - 20, WORLD.half + 20);
    this.pos.z = clamp(this.pos.z, -WORLD.half - 2, WORLD.beachZ + 30);
    if (this.blob) this.blob.position.set(this.pos.x, 0.03, this.pos.z);
    this.mesh.rotation.y = this.heading;
    const mode = this.state === 'flee' || this.state === 'dive' ? 'flee'
      : this.state === 'film' ? 'film' : 'walk';
    animatePerson(this.mesh, this.walkPhase, mode, G.time);
    // phone prop while filming
    if (this.state === 'film' && !this.phone) {
      this.phone = boxMesh(this.scene, 0.1, 0.2, 0.04, basicMat(this.scene, { color: 0xbfd9ff }));
      this.phone.position.set(0.1, 1.62, 0.3);
      this.phone.parent = this.mesh;
    } else if (this.state !== 'film' && this.phone) {
      removeNode(this.phone);
      this.phone = null;
    }
  }
  snapToSidewalk() {
    this.lineCoord = nearestRoadCoord(this.axis === 'x' ? this.pos.z : this.pos.x) + (rand() > 0.5 ? 11.5 : -11.5);
  }
}

export function spawnPeds(scene, count) {
  const peds = [];
  for (let i = 0; i < count; i++) {
    const onBeach = rand() > 0.78;
    const x = randRange(-WORLD.half + 8, WORLD.half - 8);
    const z = onBeach ? randRange(WORLD.beachZ, WORLD.beachZ + 26) : randRange(-WORLD.half + 8, WORLD.half - 8);
    peds.push(new Ped(scene, x, z));
  }
  return peds;
}
