// Nico Herrera — co-lead of the revised campaign (story addendum). The
// lighthouse keeper's grandson, a boat mechanic who owes Sal money too.
// Before mission 4 he waits at the marina; once the pair is formed he is
// a persistent companion: he follows Rina on foot, rides shotgun and
// shoots from the passenger seat during chases, and takes the wheel
// himself in the scripted shooter-seat stages (G.aiDriver), where his
// seat swaps to the driver's side. He is help, not an aimbot: modest
// damage, human pace.
//
// Babylon.js port (v3 engine rewrite): rig joints come from the person
// mesh's metadata map (peds.js personNode) instead of three.js name
// lookups; behaviour is otherwise identical to the three.js build.

import { G, clamp, dist2d } from './state.js';
import { makePersonMesh, animatePerson, personNode } from './peds.js';
import { collideCircle, LANDMARKS, makeBlobShadow, setShown } from './world.js';

export function seatPose(mesh) {
  const q = (n) => personNode(mesh, n);
  const legL = q('legL'), legR = q('legR'), kneeL = q('kneeL'), kneeR = q('kneeR');
  const armL = q('armL'), armR = q('armR'), pelvis = q('pelvis');
  if (!legL) return;
  legL.rotation.x = legR.rotation.x = -1.45;
  kneeL.rotation.x = kneeR.rotation.x = 1.45;
  armL.rotation.x = -0.35; armR.rotation.x = -0.35;
  if (pelvis) pelvis.position.y = 0.62;
}
function standPose(mesh) {
  const pelvis = personNode(mesh, 'pelvis');
  if (pelvis) pelvis.position.y = 0.92;
}

export class Nico {
  constructor(scene) {
    this.mesh = makePersonMesh(scene, 0x274b73, 0xc98d5a, { pants: 0xd8cfb8 });
    this.blob = makeBlobShadow(scene, 1.15, 1.15, 0.34);   // contact shadow
    this.blob.position.set(LANDMARKS.marina.x + 4, 0.03, LANDMARKS.marina.z - 4);
    this.pos = this.mesh.position;
    this.pos.set(LANDMARKS.marina.x + 4, 0, LANDMARKS.marina.z - 4);
    this.heading = Math.PI;
    this.phase = 0;
    this.shotTimer = 1.5;
    this.seat = null;               // null | 'passenger' | 'driver'
  }

  seatWorld(car, lx) {
    const h = car.heading;
    return {
      x: car.x + lx * Math.cos(h) + 0.1 * Math.sin(h),
      z: car.z - lx * Math.sin(h) + 0.1 * Math.cos(h),
    };
  }

  update(dt, ctx) {
    const { player, fx, fxLayer, policeUnits, colliders } = ctx;
    if (!G.partnerUnlocked) {
      // waiting at the marina, turning wrenches on a boat that isn't his
      setShown(this.mesh, true);
      this.mesh.rotation.y = this.heading;
      if (this.blob) { setShown(this.blob, true); this.blob.position.set(this.pos.x, 0.03, this.pos.z); }
      animatePerson(this.mesh, 0, 'idle', G.time);
      return;
    }
    const driving = G.aiDriver && player.car && G.aiDriver.car === player.car;
    if (player.car) {
      // ride along: driver seat when Nico is at the wheel, else shotgun
      if (this.blob) setShown(this.blob, false);
      this.seat = driving ? 'driver' : 'passenger';
      const p = this.seatWorld(player.car, this.seat === 'driver' ? 0.38 : -0.38);
      this.pos.set(p.x, 0.52, p.z);
      this.mesh.rotation.y = player.car.heading;
      seatPose(this.mesh);
      // shotgun fire: only in a real chase, modest and paced
      this.shotTimer -= dt;
      if (G.wanted >= 2 && this.shotTimer <= 0 && policeUnits && policeUnits.length) {
        let best = null, bd = 46;
        for (const u of policeUnits) {
          if (u.dead) continue;
          const d = dist2d(player.car.x, player.car.z, u.x, u.z);
          if (d < bd) { bd = d; best = u; }
        }
        if (best) {
          this.shotTimer = 1.25;
          best.health -= 7;
          if (fx) fx.gunshot();
          if (fxLayer) {
            const dx = (best.x - player.car.x) / (bd || 1), dz = (best.z - player.car.z) / (bd || 1);
            fxLayer.tracer(player.car.x, player.car.z, dx, dz, bd, true);
          }
        } else this.shotTimer = 0.4;
      }
      return;
    }
    this.seat = null;
    standPose(this.mesh);
    if (player.boat) {
      // rides the boat standing at the console
      if (this.blob) setShown(this.blob, false);
      const b = player.boat;
      const h = b.heading;
      this.pos.set(b.x + 0.7 * Math.cos(h), 0.55, b.z - 0.7 * Math.sin(h));
      this.mesh.rotation.y = h;
      seatPose(this.mesh);
      return;
    }
    // on foot: follow Rina, run to keep up, teleport-catch-up when far
    if (this.blob) { setShown(this.blob, true); this.blob.position.set(this.pos.x, 0.03, this.pos.z); }
    const d = dist2d(this.pos.x, this.pos.z, player.x, player.z);
    if (d > 60) {
      this.pos.set(player.x - Math.sin(player.heading) * 3, 0, player.z - Math.cos(player.heading) * 3);
    } else if (d > 3.4) {
      const speed = d > 14 ? 9.6 : 5.2;
      const ang = Math.atan2(player.x - this.pos.x, player.z - this.pos.z);
      this.heading = ang;
      this.pos.x += Math.sin(ang) * speed * dt;
      this.pos.z += Math.cos(ang) * speed * dt;
      collideCircle(this.pos, 0.55, colliders);
      this.phase += dt * (speed > 7 ? 12.5 : 8.5);
      this.mesh.rotation.y = this.heading;
      animatePerson(this.mesh, this.phase, speed > 7 ? 'run' : 'walk', G.time);
      return;
    }
    this.mesh.rotation.y = this.heading;
    animatePerson(this.mesh, 0, 'idle', G.time);
  }
}
