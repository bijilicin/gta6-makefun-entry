// Vehicles for Solmaris Heat: one car factory builds every drivable car,
// taxi, truck and police interceptor from boxes and cylinders. Parked cars
// wait to be stolen, traffic cars loop the road grid and brake for trouble,
// and the player's car uses simple arcade physics (accelerate, brake,
// reverse, steering that bites harder at low speed).

import { WORLD, rand, randRange, randPick, clamp, roadLines, nearestRoadCoord } from './state.js';
import { collideCircle } from './world.js';

export const CAR_COLORS = [0xe63946, 0xf4a261, 0x2a9d8f, 0xe9c46a, 0x457b9d, 0xf1faee, 0x9d4edd, 0xef476f, 0x118ab2, 0xffd166];

export function makeCarMesh(color, opts = {}) {
  const grp = new THREE.Group();
  const bodyMat = new THREE.MeshPhongMaterial({ color, shininess: 80, specular: 0x999999 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.62, 4.4), bodyMat);
  body.position.y = 0.62;
  grp.add(body);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.4, 0.9), bodyMat);
  nose.position.set(0, 0.5, 2.4);
  grp.add(nose);
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(1.8, 0.62, 2.1),
    new THREE.MeshPhongMaterial({ color: opts.cabinColor ?? 0x18222e, shininess: 120 })
  );
  cabin.position.set(0, 1.2, -0.25);
  grp.add(cabin);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x14161a });
  const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.3, 10);
  const wheels = [];
  for (const [x, z] of [[-1.02, 1.45], [1.02, 1.45], [-1.02, -1.45], [1.02, -1.45]]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(x, 0.42, z);
    grp.add(w);
    wheels.push(w);
  }
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xfff2b0 });
  for (const x of [-0.65, 0.65]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.2, 0.08), lightMat);
    hl.position.set(x, 0.66, 2.86);
    grp.add(hl);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.08), new THREE.MeshBasicMaterial({ color: 0xff3344 }));
    tl.position.set(x, 0.7, -2.22);
    grp.add(tl);
  }
  if (opts.taxi) {
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.3, 0.5), new THREE.MeshBasicMaterial({ color: 0xffd23e }));
    sign.position.set(0, 1.68, -0.25);
    grp.add(sign);
  }
  if (opts.police) {
    const bar = new THREE.Group();
    const red = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.24, 0.6), new THREE.MeshBasicMaterial({ color: 0xff2233 }));
    red.position.x = -0.32;
    const blue = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.24, 0.6), new THREE.MeshBasicMaterial({ color: 0x2266ff }));
    blue.position.x = 0.32;
    bar.add(red); bar.add(blue);
    bar.position.set(0, 1.66, -0.25);
    bar.name = 'lightbar';
    grp.add(bar);
    const door = new THREE.Mesh(new THREE.BoxGeometry(2.14, 0.4, 1.1), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    door.position.set(0, 0.66, 0.1);
    grp.add(door);
  }
  if (opts.truck) {
    const bed = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.1, 2.6), new THREE.MeshLambertMaterial({ color: 0x8d99ae }));
    bed.position.set(0, 1.0, -1.6);
    grp.add(bed);
  }
  grp.userData.wheels = wheels;
  return grp;
}

export class Vehicle {
  constructor(scene, color, x, z, heading, opts = {}) {
    this.mesh = makeCarMesh(color, opts);
    this.mesh.position.set(x, 0, z);
    this.mesh.rotation.y = heading;
    scene.add(this.mesh);
    this.pos = this.mesh.position;
    this.heading = heading;
    this.speed = 0;
    this.steer = 0;
    this.health = 100;
    this.kind = opts.kind || 'car';       // car | taxi | truck | police
    this.parked = !!opts.parked;
    this.isPlayerCar = false;
    this.dead = false;
    this.smokeTimer = 0;
    this.maxSpeed = opts.maxSpeed || randRange(24, 31);
    // traffic route state
    this.axis = opts.axis || (rand() > 0.5 ? 'x' : 'z');
    this.dir = opts.dir || (rand() > 0.5 ? 1 : -1);
    this.laneCoord = opts.laneCoord !== undefined ? opts.laneCoord : nearestRoadCoord(this.axis === 'x' ? z : x);
    this.cruise = randRange(10, 16);
    this.brake = 0;
  }
  get x() { return this.pos.x; }
  get z() { return this.pos.z; }
  forwardX() { return Math.sin(this.heading); }
  forwardZ() { return Math.cos(this.heading); }

  // Arcade driving for whoever holds the wheel (player input or AI intent).
  drive(dt, throttle, steerInput, colliders) {
    if (this.dead) { this.speed = 0; return; }
    const accel = throttle > 0 ? 15 : throttle < 0 ? (this.speed > 0.5 ? -26 : -9) : 0;
    this.speed += accel * dt;
    if (throttle === 0) this.speed -= this.speed * 0.55 * dt;         // drag
    this.speed -= this.speed * Math.abs(steerInput) * 0.12 * dt;      // cornering scrub
    const top = this.maxSpeed, back = -9;
    this.speed = clamp(this.speed, back, top);
    if (Math.abs(this.speed) < 0.02 && throttle === 0) this.speed = 0;
    this.steer = steerInput;
    const grip = clamp(Math.abs(this.speed) / 6, 0, 1);
    this.heading -= steerInput * grip * dt * 1.55 * (this.speed < 0 ? -1 : 1);
    const nx = this.pos.x + this.forwardX() * this.speed * dt;
    const nz = this.pos.z + this.forwardZ() * this.speed * dt;
    const probe = { x: nx, z: nz };
    const hit = collideCircle(probe, 1.7, colliders);
    if (hit) {
      const impact = Math.abs(this.speed);
      this.pos.x = probe.x; this.pos.z = probe.z;
      if (impact > 7) { this.health -= impact * 0.7; this.crashed = impact; }
      this.speed *= -0.25;
    } else {
      this.pos.x = nx; this.pos.z = nz;
    }
    this.pos.x = clamp(this.pos.x, -WORLD.half - 30, WORLD.half + 30);
    this.pos.z = clamp(this.pos.z, -WORLD.half - 6, WORLD.oceanZ + 6);
    this.syncMesh(dt);
  }

  // Traffic brain: follow the lane, slow for obstacles, turn at junctions.
  trafficUpdate(dt, obstacles, colliders) {
    if (this.parked || this.isPlayerCar || this.dead) return;
    let want = this.cruise;
    for (const o of obstacles) {
      const dx = o.x - this.pos.x, dz = o.z - this.pos.z;
      const ahead = dx * this.forwardX() + dz * this.forwardZ();
      const side = Math.abs(dx * this.forwardZ() - dz * this.forwardX());
      if (ahead > 0 && ahead < 9 && side < 2.4) want = Math.min(want, Math.max(0, (ahead - 5) * 1.6));
    }
    // steer toward the lane line; at a junction sometimes pick a new axis
    const targetCoord = this.laneCoord + this.dir * 3.8;   // right-hand lane offset
    let steer = 0, throttle = 0;
    if (this.axis === 'z') {
      const err = targetCoord - this.pos.x;
      steer = clamp(-err * 0.06, -0.5, 0.5) * (this.dir > 0 ? 1 : -1);
      if (Math.abs(err) > 26) steer = clamp(-err * 0.05, -0.6, 0.6);
      this.heading = this.dir > 0 ? 0 : Math.PI;
      this.pos.x += clamp(err, -1, 1) * dt * 3;
      throttle = this.speed < want ? 0.55 : 0;
      if (this.speed > want + 1) throttle = -0.4;
      this.speed += (throttle > 0 ? 7 : throttle < 0 ? -14 : -this.speed * 0.4) * dt;
      this.speed = clamp(this.speed, 0, want + 2);
      this.pos.z += this.dir * this.speed * dt;
      if (Math.abs(this.pos.z) > WORLD.half - 6) this.dir *= -1;
      const cross = nearestRoadCoord(this.pos.z);
      if (Math.abs(cross - this.pos.z) < 1.4 && rand() < dt * 0.16) {
        this.axis = 'x'; this.laneCoord = cross; this.pos.z = cross;
      }
    } else {
      const err = targetCoord - this.pos.z;
      this.heading = this.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      this.pos.z += clamp(err, -1, 1) * dt * 3;
      throttle = this.speed < want ? 0.55 : 0;
      if (this.speed > want + 1) throttle = -0.4;
      this.speed += (throttle > 0 ? 7 : throttle < 0 ? -14 : -this.speed * 0.4) * dt;
      this.speed = clamp(this.speed, 0, want + 2);
      this.pos.x += this.dir * this.speed * dt;
      if (Math.abs(this.pos.x) > WORLD.half - 6) this.dir *= -1;
      const cross = nearestRoadCoord(this.pos.x);
      if (Math.abs(cross - this.pos.x) < 1.4 && rand() < dt * 0.16) {
        this.axis = 'z'; this.laneCoord = cross; this.pos.x = cross;
      }
    }
    collideCircle(this.pos, 1.7, colliders);
    this.syncMesh(dt);
  }

  syncMesh(dt) {
    this.mesh.rotation.y = this.heading;
    const wheels = this.mesh.userData.wheels || [];
    for (const w of wheels) w.rotation.x += (this.speed * dt) / 0.42;
    if (wheels[0]) { wheels[0].rotation.y = this.steer * 0.45; wheels[1].rotation.y = this.steer * 0.45; }
    if (this.health < 35 && !this.dead) {
      this.smokeTimer -= dt;
      if (this.smokeTimer <= 0) { this.smokeTimer = 0.12; this.smoking = true; }
    }
    if (this.health <= 0 && !this.dead) {
      this.dead = true;
      this.mesh.rotation.z = 0.06;
    }
  }
}

export function spawnTraffic(scene, count) {
  const cars = [];
  const lines = roadLines();
  for (let i = 0; i < count; i++) {
    const axis = rand() > 0.5 ? 'x' : 'z';
    const line = randPick(lines);
    const along = randRange(-WORLD.half + 10, WORLD.half - 10);
    const dir = rand() > 0.5 ? 1 : -1;
    const lane = line + dir * 3.8;
    const x = axis === 'z' ? lane : along;
    const z = axis === 'z' ? along : lane;
    const kind = rand() > 0.86 ? 'taxi' : rand() > 0.9 ? 'truck' : 'car';
    const color = kind === 'taxi' ? 0xffc300 : randPick(CAR_COLORS);
    const v = new Vehicle(scene, color, x, z, 0, { axis, dir, laneCoord: line, kind, taxi: kind === 'taxi', truck: kind === 'truck' });
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
    const v = new Vehicle(scene, randPick(CAR_COLORS), x, z, vertical ? 0 : Math.PI / 2, { parked: true });
    cars.push(v);
  }
  // one unmistakable coral coupe at the marina: the M3 mission target
  const coupe = new Vehicle(scene, 0xff5a3c, -124, 196, Math.PI / 2, { parked: true });
  coupe.isMissionCar = true;
  cars.push(coupe);
  return cars;
}
