// Pedestrians for Solmaris: low-poly beach-city walkers who stroll the
// sidewalks and the promenade, chat in pairs, and run screaming (well,
// running) when a car mounts the kerb or a punch lands nearby. Knocked-down
// peds get back up after a while unless the hit was lethal.

import { WORLD, rand, randRange, randPick, clamp, nearestRoadCoord } from './state.js';
import { collideCircle } from './world.js';

const SHIRTS = [0xff6b6b, 0x4ecdc4, 0xffe66d, 0xf7fff7, 0xff9f1c, 0x7bdff2, 0xf15bb5, 0xfee440];
const SKINS = [0xf2c49b, 0xc68863, 0x8d5524, 0xffdbac, 0xe0ac69];

export function makePersonMesh(shirt, skin) {
  const grp = new THREE.Group();
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.8, 0.3), new THREE.MeshLambertMaterial({ color: 0x2b3a4a }));
  legs.position.y = 0.4; legs.name = 'legs';
  grp.add(legs);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.34), new THREE.MeshLambertMaterial({ color: shirt }));
  torso.position.y = 1.16;
  grp.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 8, 7), new THREE.MeshLambertMaterial({ color: skin }));
  head.position.y = 1.78;
  grp.add(head);
  const armMat = new THREE.MeshLambertMaterial({ color: shirt });
  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.66, 0.16), armMat);
    arm.position.set(s * 0.4, 1.18, 0);
    arm.name = s < 0 ? 'armL' : 'armR';
    grp.add(arm);
  }
  return grp;
}

export class Ped {
  constructor(scene, x, z) {
    this.mesh = makePersonMesh(randPick(SHIRTS), randPick(SKINS));
    this.mesh.position.set(x, 0, z);
    scene.add(this.mesh);
    this.pos = this.mesh.position;
    this.heading = randRange(0, Math.PI * 2);
    this.speed = randRange(1.1, 2.1);
    this.state = 'walk';        // walk | flee | down
    this.timer = randRange(2, 7);
    this.downTime = 0;
    this.walkPhase = randRange(0, 6);
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
    this.walkPhase += dt * (this.state === 'flee' ? 13 : 7);
    if (this.state === 'down') {
      this.downTime -= dt;
      if (this.downTime <= 0) {
        this.state = 'walk';
        this.mesh.rotation.x = 0;
        this.mesh.position.y = 0;
      }
      return;
    }
    // flee from a threat point (speeding car, flying fist, gunfire)
    if (threat) {
      const dx = this.pos.x - threat.x, dz = this.pos.z - threat.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < 11) {
        this.state = 'flee';
        this.heading = Math.atan2(dx, dz);
        this.timer = 1.6;
      }
    }
    if (this.state === 'flee') {
      this.timer -= dt;
      this.pos.x += Math.sin(this.heading) * 5.4 * dt;
      this.pos.z += Math.cos(this.heading) * 5.4 * dt;
      if (this.timer <= 0) { this.state = 'walk'; this.snapToSidewalk(); }
    } else {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.timer = randRange(3, 9);
        if (rand() > 0.6) { this.axis = this.axis === 'x' ? 'z' : 'x'; this.lineCoord = nearestRoadCoord(this.axis === 'x' ? this.pos.z : this.pos.x) + (rand() > 0.5 ? 11.5 : -11.5); }
        if (rand() > 0.7) this.dir *= -1;
      }
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
    this.mesh.rotation.y = this.heading;
    // simple two-bone walk swing
    const swing = Math.sin(this.walkPhase) * 0.28;
    const legs = this.mesh.getObjectByName('legs');
    if (legs) legs.rotation.x = swing * 0.4;
    const armL = this.mesh.getObjectByName('armL');
    const armR = this.mesh.getObjectByName('armR');
    if (armL) armL.rotation.x = swing;
    if (armR) armR.rotation.x = -swing;
    if (this.state === 'flee' && armL && armR) { armL.rotation.x = 2.6; armR.rotation.x = 2.6; }
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
