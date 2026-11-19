// Rina Vale, the player — Babylon.js port (v3 engine rewrite).
// Articulated third-person character with a procedural walk/run cycle
// and an aim pose, car entry/theft, fists, a pistol on foot — and
// drive-by fire from the driver's seat: while driving she leans out and
// shoots sideways toward the nearest threat. Every crime reports
// whether it was witnessed, feeding the information-based wanted system
// in state.js. Gameplay logic is identical to the three.js build; only
// the head-prop meshes and visibility flags are Babylon-flavoured.

import { G, clamp, commitCrime, dist2d, startReload } from './state.js';
import { makePersonMesh, animatePerson, personNode } from './peds.js';
import { collideCircle, makeBlobShadow, pbrMat, boxMesh, setShown } from './world.js';

export class Player {
  constructor(scene) {
    this.scene = scene;
    this.mesh = makePersonMesh(scene, 0xe83a24, 0xd99e5f, { pants: 0x1c2a3e, noHair: true });
    // Rina's sunglasses band — her silhouette in every screenshot
    const headG = personNode(this.mesh, 'head');
    if (headG) {
      const shades = boxMesh(scene, 0.44, 0.09, 0.1, pbrMat(scene, { color: 0x0c0e12, roughness: 0.2, metalness: 0.4 }));
      shades.position.set(0, 0.24, 0.2);
      shades.parent = headG;
      // cube-build hair: a flat dark box cap over the box head
      const hair = boxMesh(scene, 0.56, 0.26, 0.56, pbrMat(scene, { color: 0x181008, roughness: 0.95, envMapIntensity: 0.15 }));
      hair.position.set(0, 0.33, -0.05);
      hair.parent = headG;
    }
    this.blob = makeBlobShadow(scene, 1.15, 1.15, 0.36);   // contact shadow
    this.blob.position.set(-30, 0.03, -30);
    this.pos = this.mesh.position;
    this.pos.set(-30, 0, -30);
    this.heading = Math.PI * 0.75;
    this.speedNow = 0;
    this.walkPhase = 0;
    this.car = null;
    this.boat = null;
    this.punchTimer = 0;
    this.shootCooldown = 0;
    this.driveByCooldown = 0;
    this.invuln = 0;
    this.aiming = false;
  }
  get x() { return this.car ? this.car.x : this.boat ? this.boat.x : this.pos.x; }
  get z() { return this.car ? this.car.z : this.boat ? this.boat.z : this.pos.z; }
  get speed() { return this.car ? Math.abs(this.car.speed) : this.boat ? Math.abs(this.boat.speed) : this.speedNow; }

  enterBoat(boat, fx) {
    this.boat = boat;
    boat.driver = 'player';
    setShown(this.mesh, false);
    if (this.blob) setShown(this.blob, false);
    G.mode = 'boat';
    if (fx) fx.door();
  }
  exitBoat(fx) {
    if (!this.boat) return;
    this.boat.driver = null;
    this.boat = null;
    this.pos.set(30, 0, 252);           // back on the pier boards
    this.heading = Math.PI;
    setShown(this.mesh, true);
    if (this.blob) { setShown(this.blob, true); this.blob.position.set(30, 0.03, 252); }
    G.mode = 'foot';
    if (fx) fx.door();
  }

  placeAt(x, z, heading) {
    this.pos.set(x, 0, z);
    if (heading !== undefined) this.heading = heading;
    this.mesh.rotation.y = this.heading;
    if (this.blob) { setShown(this.blob, true); this.blob.position.set(x, 0.03, z); }
  }

  updateOnFoot(dt, input, camYaw, colliders, fx) {
    this.punchTimer = Math.max(0, this.punchTimer - dt);
    this.shootCooldown = Math.max(0, this.shootCooldown - dt);
    this.invuln = Math.max(0, this.invuln - dt);
    const fwd = (input.w ? 1 : 0) - (input.s ? 1 : 0);
    const side = (input.d ? 1 : 0) - (input.a ? 1 : 0);
    const moving = fwd !== 0 || side !== 0;
    // Real-world pace tiers (m/s): ALT walk 1.4 · default run 4.2 ·
    // SHIFT sprint 6.5. Speed ramps toward the tier (11 m/s² up,
    // 15 m/s² down) so walk→run→sprint transitions feel natural
    // instead of snapping, and the stride phase follows true speed.
    let tier = input.alt ? 1.4 : input.shift ? 6.5 : 4.2;
    if (this.pos.z > 262) tier *= 0.5; // wading into the shallows
    const target = moving ? tier : 0;
    const maxDelta = (target > this.speedNow ? 11 : 15) * dt;
    this.speedNow += clamp(target - this.speedNow, -maxDelta, maxDelta);
    if (Math.abs(this.speedNow) < 0.02 && !moving) this.speedNow = 0;
    this.aiming = !!input.mouseDown && G.hasGun;
    if (moving && this.speedNow > 0.01) {
      const moveAngle = camYaw + Math.atan2(side, fwd);
      this.heading = this.aiming ? camYaw : moveAngle;
      this.pos.x += Math.sin(moveAngle) * this.speedNow * dt;
      this.pos.z += Math.cos(moveAngle) * this.speedNow * dt;
      this.walkPhase += dt * this.speedNow * 1.8; // stride tracks speed
    }
    collideCircle(this.pos, 0.55, colliders);
    this.pos.x = clamp(this.pos.x, -228, 228);
    this.pos.z = clamp(this.pos.z, -208, 292);
    if (this.blob) this.blob.position.set(this.pos.x, 0.03, this.pos.z);
    this.mesh.position.y = 0;
    this.mesh.rotation.y = this.heading;
    const mode = this.punchTimer > 0.12 ? 'aim' : this.aiming ? 'aim'
      : this.speedNow < 0.05 ? 'idle' : this.speedNow < 2.6 ? 'walk' : 'run';
    animatePerson(this.mesh, this.walkPhase, mode, G.time);
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
    setShown(this.mesh, false);
    if (this.blob) setShown(this.blob, false);   // the car's own blob takes over
    G.mode = 'car';
    if (fx) fx.door();
    // stealing is a witnessed crime only if someone is actually watching:
    // the caller (main) refines this via G.filmingWitnesses and nearby peds
    if (vehicle.wasTraffic) {
      commitCrime(100, 'Car jacked!', G.filmingWitnesses > 0);
      G.carsStolen++;
    } else if (vehicle.parked) {
      commitCrime(45, '', G.filmingWitnesses > 0);
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
    setShown(this.mesh, true);
    if (this.blob) { setShown(this.blob, true); this.blob.position.set(this.pos.x, 0.03, this.pos.z); }
    G.mode = 'foot';
    if (fx) fx.door();
  }

  punch(vehicles, peds, fx) {
    if (this.car || this.punchTimer > 0) return null;
    this.punchTimer = 0.32;
    if (fx) fx.punch();
    const fx2 = this.pos.x + Math.sin(this.heading) * 1.6;
    const fz2 = this.pos.z + Math.cos(this.heading) * 1.6;
    for (const p of peds) {
      if (p.state !== 'down' && dist2d(fx2, fz2, p.pos.x, p.pos.z) < 1.5) {
        p.knockDown(false);
        commitCrime(55, 'Assault!', true);
        return { type: 'ped', ped: p };
      }
    }
    for (const v of vehicles) {
      if (dist2d(fx2, fz2, v.x, v.z) < 2.6) {
        v.health -= 6;
        commitCrime(30, '', true);
        return { type: 'car', vehicle: v };
      }
    }
    return null;
  }

  // One trigger pull against the magazine: fires (true) or not.
  // Finite ammo: an empty magazine starts a reload ONLY if the reserve
  // still has rounds for it to draw; with magazine and reserve both at
  // 0 the trigger is a dry click — no shot, no reload, G.dryClicks
  // ticks so the main loop can flash the NO AMMO hint. Shared by
  // on-foot fire, drive-by and the shooter-seat stages (Rina's pistol).
  consumeRound(fx) {
    if (G.reloading > 0) return false;
    if (G.ammoMag <= 0) {
      if (G.ammoReserve > 0) { startReload(); return false; }
      G.dryClicks++;
      if (fx && fx.dryClick) fx.dryClick();
      return false;
    }
    G.ammoMag--;
    if (G.ammoMag === 0 && G.ammoReserve > 0) startReload();
    return true;
  }
  // Manual reload (R on foot): tops the magazine up from the reserve
  // when the reload finishes — see finishReload() in state.js.
  tryReload() { return startReload(); }

  shoot(vehicles, peds, policeUnits, fx, fxLayer) {
    if (this.car || !G.hasGun || this.shootCooldown > 0) return null;
    if (!this.consumeRound(fx)) return null;
    this.shootCooldown = 0.24;
    G.shotsFired++;
    if (fx) fx.gunshot();
    const seen = policeUnits.length > 0 || G.filmingWitnesses > 0;
    commitCrime(40, 'Shots fired!', seen);
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
    if (best.type === 'ped') { best.obj.knockDown(true); commitCrime(60, '', true); }
    if (best.type === 'car') { best.obj.health -= 26; }
    if (best.type === 'police') { best.obj.health -= 30; commitCrime(70, 'Officer down!', true); }
    return best;
  }

  // Drive-by: fire sideways from the driver's seat toward the nearest
  // threat on either side; with no target, rounds go out the left window
  // in the aim direction. Returns the hit (for tracers/particles) or null.
  driveBy(vehicles, peds, policeUnits, fx, fxLayer) {
    if (!this.car || !G.hasGun || this.driveByCooldown > 0) return null;
    if (!this.consumeRound(fx)) return null;
    this.driveByCooldown = 0.3;
    G.shotsFired++;
    if (fx) fx.gunshot();
    commitCrime(45, 'Drive-by!', policeUnits.length > 0);
    const car = this.car;
    const ox = car.x, oz = car.z;
    // nearest threat within 42 units, any direction
    let best = null, bestD = 42;
    const consider = (x, z, obj, type) => {
      const d = dist2d(ox, oz, x, z);
      if (d < bestD) { bestD = d; best = { obj, type, x, z }; }
    };
    for (const u of policeUnits) consider(u.x, u.z, u, 'police');
    if (!best) for (const v of (G.rivalCars || [])) { if (!v.dead) consider(v.x, v.z, v, 'car'); }
    if (!best) for (const v of vehicles) { if (v !== car && !v.dead) consider(v.x, v.z, v, 'car'); }
    let dx, dz, len;
    if (best) {
      dx = (best.x - ox) / (bestD || 1); dz = (best.z - oz) / (bestD || 1); len = bestD;
    } else {
      // out the left window, perpendicular to travel
      dx = Math.cos(car.heading); dz = -Math.sin(car.heading); len = 26;
    }
    if (fxLayer) fxLayer.tracer(ox, oz, dx, dz, len, true);
    if (!best) return null;
    if (best.type === 'police') { best.obj.health -= 22; commitCrime(50, '', true); }
    if (best.type === 'car') { best.obj.health -= 20; }
    return best;
  }

  hurt(amount) {
    if (this.invuln > 0 || G.over) return;
    this.invuln = 0.5;
    G.health -= amount;
    G.damageFlash = 1;
    G.lastDamageAt = G.time;
    if (this.car) this.car.health -= amount * 0.4;
  }
}
