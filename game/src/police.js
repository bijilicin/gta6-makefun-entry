// Solmaris PD — Babylon.js port (v3 engine rewrite).
// An escalation ladder driven by information, not magic. Units dispatch
// from PD HQ (or an out-of-sight street node) and DRIVE to Rina's last
// known position. While a unit has eyes on her the wanted stars are
// solid; break sight and they switch to searching — converging on the
// last known point and sweeping it while the search timer drains.
// 1 star: patrols follow. 2: they chase and ram. 3: roadblocks seal an
// avenue ahead. 4: spike strips join the roadblocks. 5: a helicopter
// with a searchlight joins and dispatch turns aggressive.
//
// Ramming the PLAYER stays intended, but units no longer clip through
// traffic — main runs resolveVehicleOverlaps (vehicles.js) over units +
// traffic after every update, which separates police-vs-traffic pairs
// while deliberately never separating a unit from the player's car.
//
// Babylon notes: spotlights are aimed by recomputing their direction
// vector each frame (Babylon spotlights have no target node), and unit
// removal disposes the mesh subtree (removeNode). Pursuit mathematics,
// spawn rules and the bust logic are identical to the three.js build.

import { G, clamp, dist2d, nearestRoadCoord, reportSighting } from './state.js';
import { Vehicle, lightbarParts } from './vehicles.js';
import { LANDMARKS, C3, pbrMat, basicMat, boxMesh, groupNode, markShadow, removeNode, setShown, uid } from './world.js';

export class PoliceSystem {
  constructor(scene) {
    this.scene = scene;
    this.units = [];
    this.spawnTimer = 0;
    this.lightPhase = 0;
    this.nearest = Infinity;
    // one real spotlight, riding on whichever unit is closest
    this.spot = new BABYLON.SpotLight(uid('spot'), new BABYLON.Vector3(0, 7.5, 0), new BABYLON.Vector3(0, -1, 0), 0.5, 1, scene);
    this.spot.diffuse = C3(0xcfe4ff);
    this.spot.intensity = 0;
    this.spot.shadowEnabled = false;
    this._spotTarget = new BABYLON.Vector3();
    // roadblock state
    this.blockers = [];
    this.spike = null;
    this.blockAt = null;
    // helicopter (built once, hidden until 5 stars)
    this.heli = buildHeli(scene);
    setShown(this.heli.group, false);
    this.heliAngle = 0;
  }
  wantedCapacity() {
    if (G.wanted === 0) return 0;
    return G.wanted === 1 ? 2 : 1 + G.wanted;   // 2,3,4,5,6
  }
  spawnUnit(playerPos) {
    // dispatch from HQ when it is far enough to be honest; otherwise from
    // the nearest street intersection outside the player's view radius
    const hqNode = { x: -120, z: -120 };
    let sx, sz;
    if (dist2d(hqNode.x, hqNode.z, playerPos.x, playerPos.z) > 75) {
      sx = hqNode.x; sz = hqNode.z;
    } else {
      const rx = nearestRoadCoord(playerPos.x + (playerPos.x > 0 ? -95 : 95));
      const rz = nearestRoadCoord(playerPos.z + (playerPos.z > 0 ? -95 : 95));
      sx = clamp(rx, -200, 200); sz = clamp(rz, -200, 200);
    }
    const u = new Vehicle(this.scene, 0x1b2634, sx, sz, Math.atan2(playerPos.x - sx, playerPos.z - sz), {
      kind: 'police', police: true, maxSpeed: 34, style: 'sedan',
    });
    this.units.push(u);
    return u;
  }

  update(dt, playerPos, playerSpeed, colliders, fx, playerCar = null) {
    this.lightPhase += dt * 10;
    const capacity = this.wantedCapacity();
    this.spawnTimer -= dt;
    const spawnDelay = G.wanted >= 5 ? 1.2 : 2.6;
    if (this.units.length < capacity && this.spawnTimer <= 0) {
      this.spawnTimer = spawnDelay;
      this.spawnUnit(playerPos);
    }
    // --- sightings: a unit sees Rina inside 52 units (38 while she is on
    // foot in the search phase), the heli sees inside 78 from the air
    let anySeeing = false;
    let nearest = Infinity;
    for (const u of this.units) {
      const d = dist2d(u.x, u.z, playerPos.x, playerPos.z);
      nearest = Math.min(nearest, d);
      if (d < 52) anySeeing = true;
    }
    if (this.heli.group.isEnabled() && dist2d(this.heli.group.position.x, this.heli.group.position.z, playerPos.x, playerPos.z) < 78) anySeeing = true;
    if (G.wanted > 0) reportSighting(playerPos.x, playerPos.z, anySeeing);

    const searching = G.wantedState === 'searching';
    const target = searching ? G.lastKnown : playerPos;
    let pinning = false;
    for (let i = this.units.length - 1; i >= 0; i--) {
      const u = this.units[i];
      const d = dist2d(u.x, u.z, playerPos.x, playerPos.z);
      if (u.dead) continue;
      if (G.wanted === 0) {
        u.drive(dt, 0.35, 0, colliders);
        if (d > 95) { u.dispose(); this.units.splice(i, 1); }
        continue;
      }
      // pursuit point: the target, with a per-unit sweep offset while searching
      let tx = target.x, tz = target.z;
      if (searching) {
        const a = (i / Math.max(1, this.units.length)) * Math.PI * 2 + G.time * 0.14;
        tx += Math.cos(a) * 26; tz += Math.sin(a) * 26;
      }
      const dx = tx - u.x, dz = tz - u.z;
      const targetHeading = Math.atan2(dx, dz);
      let diff = targetHeading - u.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const steer = clamp(-diff * 1.4, -0.85, 0.85);
      let throttle;
      if (G.wanted === 1 && !searching) {
        // 1 star: shadow her, keep a respectful gap, never ram
        throttle = d > 13 ? 0.8 : d > 9 ? 0.25 : -0.4;
      } else if (searching) {
        throttle = dist2d(u.x, u.z, tx, tz) > 8 ? 0.85 : 0.1;
      } else {
        throttle = d > 7 ? 1 : d > 3.4 ? 0.4 : -0.5;   // 2+: close and ram
      }
      const before = u.speed;
      u.drive(dt, throttle, steer, colliders);
      if (u.crashed && Math.abs(before) > 9 && fx) fx.crash();
      u.crashed = 0;
      // boxed-in check: busted only fills at close range on foot, or when
      // her car is stopped / pinned — never at speed
      const boxed = playerCar ? (Math.abs(playerCar.speed) < 1.6 && d < 6.5) : (d < 5.2 && playerSpeed < 2.4);
      if (boxed && G.wantedState === 'seen') pinning = true;
      const bar = lightbarParts(u.mesh);
      if (bar) {
        const phase = Math.sin(this.lightPhase + i * 2.1) > 0;
        bar.red.isVisible = phase;
        bar.blue.isVisible = !phase;
      }
      if (d > 280) { u.dispose(); this.units.splice(i, 1); }
    }
    if (pinning && G.wanted > 0) G.bustMeter += dt / (3.2 - G.wanted * 0.22);
    else G.bustMeter = Math.max(0, G.bustMeter - dt * 0.7);
    this.nearest = nearest;

    // spotlight follows the closest unit
    let closest = null, cd = Infinity;
    for (const u of this.units) { const d = dist2d(u.x, u.z, playerPos.x, playerPos.z); if (d < cd) { cd = d; closest = u; } }
    if (closest && G.wanted > 0) {
      this.spot.intensity = 1.5;
      this.spot.position.set(closest.x, 7.5, closest.z);
      this._spotTarget.set(playerPos.x, 0, playerPos.z);
      this.spot.direction = this._spotTarget.subtract(this.spot.position).normalize();
    } else this.spot.intensity = 0;

    this.updateRoadblock(dt, playerPos, playerCar);
    this.updateHeli(dt, playerPos);
    return { nearest, active: this.units.length };
  }

  updateRoadblock(dt, playerPos, playerCar) {
    const wantBlock = G.wanted >= 3;
    const far = this.blockAt && dist2d(this.blockAt.x, this.blockAt.z, playerPos.x, playerPos.z) > 130;
    if ((!wantBlock && this.blockers.length) || far) this.clearRoadblock();
    if (wantBlock && !this.blockers.length && playerCar && Math.abs(playerCar.speed) > 4) {
      // seal the avenue 58 units ahead of her travel direction
      const fx2 = playerCar.forwardX(), fz2 = playerCar.forwardZ();
      const aheadX = playerPos.x + fx2 * 58, aheadZ = playerPos.z + fz2 * 58;
      const vertical = Math.abs(fx2) < Math.abs(fz2); // travelling along z -> block across x road
      const lineCoord = vertical ? nearestRoadCoord(aheadX) : nearestRoadCoord(aheadZ);
      const bx = vertical ? lineCoord : aheadX;
      const bz = vertical ? aheadZ : lineCoord;
      this.blockAt = { x: bx, z: bz };
      const heading = vertical ? Math.PI / 2 : 0;
      for (const off of [-4.4, 4.4]) {
        const b = new Vehicle(this.scene, 0x1b2634, bx + (vertical ? off : 0), bz + (vertical ? 0 : off), heading, {
          kind: 'police', police: true, maxSpeed: 30, style: 'sedan',
        });
        b.parked = true;
        b.isBlocker = true;
        this.blockers.push(b);
      }
      if (G.wanted >= 4) {
        const spike = boxMesh(this.scene, vertical ? 15 : 0.8, 0.14, vertical ? 0.8 : 15,
          pbrMat(this.scene, { color: 0x22242a, roughness: 0.5, metalness: 0.6 }));
        spike.position.set(bx, 0.1, bz);
        this.spike = { mesh: spike, x: bx, z: bz };
      }
    }
    for (const b of this.blockers) {
      const bar = lightbarParts(b.mesh);
      if (bar) {
        const phase = Math.sin(this.lightPhase + 1.3) > 0;
        bar.red.isVisible = phase;
        bar.blue.isVisible = !phase;
      }
    }
    // spike strip: crossing it in a car blows a tire
    if (this.spike && playerCar && !playerCar.tireBlown) {
      if (dist2d(playerCar.x, playerCar.z, this.spike.x, this.spike.z) < 5.2 && Math.abs(playerCar.speed) > 3) {
        playerCar.tireBlown = 1;
        playerCar.tireEvent = true;
        playerCar.health -= 6;
      }
    }
  }
  clearRoadblock() {
    for (const b of this.blockers) b.dispose();
    this.blockers = [];
    if (this.spike) { removeNode(this.spike.mesh); this.spike = null; }
    this.blockAt = null;
  }

  updateHeli(dt, playerPos) {
    const active = G.wanted >= 5;
    setShown(this.heli.group, active);
    if (!active) { this.heli.spot.intensity = 0; return; }
    this.heliAngle += dt * 0.5;
    const hx = playerPos.x + Math.cos(this.heliAngle) * 26;
    const hz = playerPos.z + Math.sin(this.heliAngle) * 26;
    const g = this.heli.group;
    g.position.x += (hx - g.position.x) * Math.min(1, dt * 1.6);
    g.position.z += (hz - g.position.z) * Math.min(1, dt * 1.6);
    g.position.y = 26 + Math.sin(G.time * 0.9) * 1.2;
    g.rotation.y = Math.atan2(playerPos.x - g.position.x, playerPos.z - g.position.z);
    if (this.heli.rotor) this.heli.rotor.rotation.y += dt * 28;
    if (this.heli.tail) this.heli.tail.rotation.x += dt * 34;
    this.heli.spot.intensity = 2.2;
    this.heli.spot.position.copyFrom(g.position);
    this._spotTarget.set(playerPos.x, 0, playerPos.z);
    this.heli.spot.direction = this._spotTarget.subtract(this.heli.spot.position).normalize();
  }

  clearAll() {
    for (const u of this.units) u.dispose();
    this.units = [];
    this.clearRoadblock();
    setShown(this.heli.group, false);
    this.spot.intensity = 0;
    G.bustMeter = 0;
  }
}

function buildHeli(scene) {
  const grp = groupNode(scene);
  const bodyMat = pbrMat(scene, { color: 0x1b2634, roughness: 0.4, metalness: 0.3, envMapIntensity: 0.7 });
  const body = boxMesh(scene, 2.4, 1.7, 4.6, bodyMat);
  markShadow(body, true, false);
  body.parent = grp;
  const glass = boxMesh(scene, 2.0, 1.0, 1.2, pbrMat(scene, { color: 0x9fc4e8, roughness: 0.08, metalness: 0.0, clearcoat: true, clearcoatRoughness: 0.08, envMapIntensity: 1.2 }));
  glass.position.set(0, 0.15, 2.2);
  glass.parent = grp;
  const boom = boxMesh(scene, 0.5, 0.5, 4.6, bodyMat);
  boom.position.set(0, 0.25, -4.2);
  boom.parent = grp;
  const fin = boxMesh(scene, 0.16, 1.3, 0.7, bodyMat);
  fin.position.set(0, 0.7, -6.4);
  fin.parent = grp;
  const rotor = boxMesh(scene, 11, 0.08, 0.5, pbrMat(scene, { color: 0x22262c, roughness: 0.6 }));
  rotor.position.y = 1.15;
  rotor.parent = grp;
  const tail = boxMesh(scene, 0.08, 1.6, 0.3, pbrMat(scene, { color: 0x22262c, roughness: 0.6 }));
  tail.position.set(0.35, 0.7, -6.4);
  tail.parent = grp;
  for (const s of [-1, 1]) {
    const skid = boxMesh(scene, 0.14, 0.14, 3.4, bodyMat);
    skid.position.set(s * 1.1, -1.25, 0);
    skid.parent = grp;
  }
  const stripe = boxMesh(scene, 2.46, 0.4, 4.66, basicMat(scene, { color: 0xf2f4f6 }));
  stripe.position.y = -0.3;
  stripe.parent = grp;
  grp.position.set(0, 30, 0);
  const spot = new BABYLON.SpotLight(uid('helispot'), new BABYLON.Vector3(0, 30, 0), new BABYLON.Vector3(0, -1, 0), 0.32, 1, scene);
  spot.diffuse = C3(0xfff2cc);
  spot.intensity = 0;
  spot.shadowEnabled = false;
  return { group: grp, rotor, tail, spot };
}
export { LANDMARKS };
