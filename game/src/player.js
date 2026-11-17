// Rina Vale, the player: third-person on-foot movement with a walk/run
// cycle, entering and stealing cars, fists and (once earned) a pistol.
// Combat is short-range and physical: punches topple peds and dent panels,
// gunshots are resolved against the nearest target inside a forward cone,
// and every witnessed crime feeds the wanted system in state.js.

import { G, clamp, commitCrime, dist2d } from './state.js';
import { makePersonMesh } from './peds.js';
import { collideCircle } from './world.js';

export class Player {
  constructor(scene) {
    this.mesh = makePersonMesh(0x20304a, 0xe0ac69);
    // Rina's signature coral jacket over the shared person rig
    const jacket = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.5, 0.4), new THREE.MeshLambertMaterial({ color: 0xff5a3c }));
    jacket.position.y = 1.22;
    this.mesh.add(jacket);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), new THREE.MeshLambertMaterial({ color: 0x241a12 }));
    hair.position.set(0, 1.88, -0.04);
    this.mesh.add(hair);
    scene.add(this.mesh);
    this.pos = this.mesh.position;
    this.pos.set(-30, 0, -30);
    this.heading = Math.PI * 0.75;
    this.speedNow = 0;
    this.walkPhase = 0;
    this.car = null;              // Vehicle being driven, or null on foot
    this.punchTimer = 0;
    this.shootCooldown = 0;
    this.invuln = 0;
  }
  get x() { return this.car ? this.car.x : this.pos.x; }
  get z() { return this.car ? this.car.z : this.pos.z; }
  get speed() { return this.car ? Math.abs(this.car.speed) : this.speedNow; }

  placeAt(x, z, heading) {
    this.pos.set(x, 0, z);
    if (heading !== undefined) this.heading = heading;
    this.mesh.rotation.y = this.heading;
  }

  updateOnFoot(dt, input, camYaw, colliders, fx) {
    this.punchTimer = Math.max(0, this.punchTimer - dt);
    this.shootCooldown = Math.max(0, this.shootCooldown - dt);
    this.invuln = Math.max(0, this.invuln - dt);
    const fwd = (input.w ? 1 : 0) - (input.s ? 1 : 0);
    const side = (input.d ? 1 : 0) - (input.a ? 1 : 0);
    const moving = fwd !== 0 || side !== 0;
    const run = input.shift ? 8.6 : 4.6;
    if (moving) {
      const moveAngle = camYaw + Math.atan2(side, fwd);
      this.heading = moveAngle;
      this.pos.x += Math.sin(moveAngle) * run * dt;
      this.pos.z += Math.cos(moveAngle) * run * dt;
      this.speedNow = run;
      this.walkPhase += dt * (input.shift ? 12 : 8);
    } else {
      this.speedNow = 0;
    }
    collideCircle(this.pos, 0.55, colliders);
    this.pos.x = clamp(this.pos.x, -228, 228);
    this.pos.z = clamp(this.pos.z, -208, 292);
    this.mesh.position.y = 0;
    this.mesh.rotation.y = this.heading;
    const swing = moving ? Math.sin(this.walkPhase) * 0.3 : 0;
    const legs = this.mesh.getObjectByName('legs');
    if (legs) legs.rotation.x = swing * 0.4;
    const armL = this.mesh.getObjectByName('armL');
    const armR = this.mesh.getObjectByName('armR');
    if (armL && this.punchTimer < 0.18) armL.rotation.x = swing;
    if (armR) armR.rotation.x = this.punchTimer > 0.1 ? -2.2 : -swing;
    // wading slows Rina near the shoreline shallows
    if (this.pos.z > 262) this.speedNow *= 0.5;
  }

  nearestCar(vehicles, maxDist) {
    let best = null, bd = maxDist;
    for (const v of vehicles) {
      if (v.dead || v.isPlayerCar) continue;
      const d = dist2d(this.pos.x, this.pos.z, v.x, v.z);
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  enterCar(vehicle, fx) {
    this.car = vehicle;
    vehicle.isPlayerCar = true;
    vehicle.parked = false;
    this.mesh.visible = false;
    G.mode = 'car';
    if (fx) fx.door();
    if (vehicle.wasTraffic) {
      commitCrime(100, 'Car jacked!');
      G.carsStolen++;
    } else if (vehicle.parked) {
      commitCrime(45, '');
      G.carsStolen++;
    }
    if (vehicle.isMissionCar) G.message = 'That is the coupe! Get it to Rico\'s Garage.';
  }

  exitCar(fx) {
    if (!this.car) return;
    const c = this.car;
    c.isPlayerCar = false;
    if (Math.abs(c.speed) < 0.5 && !c.dead) c.parked = true;
    this.pos.set(c.x + Math.cos(c.heading) * 2.4, 0, c.z - Math.sin(c.heading) * 2.4);
    this.heading = c.heading;
    this.car = null;
    this.mesh.visible = true;
    G.mode = 'foot';
    if (fx) fx.door();
  }

  // Returns a hit description the caller turns into effects and heat.
  punch(vehicles, peds, fx) {
    if (this.car || this.punchTimer > 0) return null;
    this.punchTimer = 0.32;
    if (fx) fx.punch();
    const fx2 = this.pos.x + Math.sin(this.heading) * 1.6;
    const fz2 = this.pos.z + Math.cos(this.heading) * 1.6;
    for (const p of peds) {
      if (p.state !== 'down' && dist2d(fx2, fz2, p.pos.x, p.pos.z) < 1.5) {
        p.knockDown(false);
        commitCrime(55, 'Assault!');
        return { type: 'ped', ped: p };
      }
    }
    for (const v of vehicles) {
      if (dist2d(fx2, fz2, v.x, v.z) < 2.6) {
        v.health -= 6;
        commitCrime(30, '');
        return { type: 'car', vehicle: v };
      }
    }
    return null;
  }

  shoot(vehicles, peds, policeUnits, fx, fxLayer) {
    if (this.car || !G.hasGun || this.shootCooldown > 0) return null;
    this.shootCooldown = 0.24;
    G.shotsFired++;
    if (fx) fx.gunshot();
    commitCrime(40, 'Shots fired!');
    const ox = this.x, oz = this.z;
    const dx = Math.sin(this.heading), dz = Math.cos(this.heading);
    let best = null, bestD = 46;
    const consider = (x, z, obj, type) => {
      const rx = x - ox, rz = z - oz;
      const along = rx * dx + rz * dz;
      if (along < 1 || along > 46) return;
      const side = Math.abs(rx * dz - rz * dx);
      if (side < 1.6 && along < bestD) { bestD = along; best = { obj, type, x, z }; }
    };
    for (const p of peds) if (p.state !== 'down') consider(p.pos.x, p.pos.z, p, 'ped');
    for (const v of vehicles) consider(v.x, v.z, v, 'car');
    for (const u of policeUnits) consider(u.x, u.z, u, 'police');
    if (fxLayer) fxLayer.tracer(ox, oz, dx, dz, best ? bestD : 30);
    if (!best) return null;
    if (best.type === 'ped') { best.obj.knockDown(true); commitCrime(60, ''); }
    if (best.type === 'car') { best.obj.health -= 26; }
    if (best.type === 'police') { best.obj.health -= 30; commitCrime(70, 'Officer down!'); }
    return best;
  }

  hurt(amount) {
    if (this.invuln > 0 || G.over) return;
    this.invuln = 0.5;
    G.health -= amount;
    G.damageFlash = 1;
    if (this.car) this.car.health -= amount * 0.4;
  }
}
