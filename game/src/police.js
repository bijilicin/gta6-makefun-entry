// Solmaris PD: interceptor units that spawn at the city edge when the
// wanted level rises, pursue the player on foot or in a car, ram to slow
// them, and fill the BUSTED meter when they pin a slow player. Units give
// up and drive off once the heat is gone; a disabled unit smokes and stops.

import { G, clamp, dist2d } from './state.js';
import { Vehicle } from './vehicles.js';

export class PoliceSystem {
  constructor(scene) {
    this.scene = scene;
    this.units = [];
    this.spawnTimer = 0;
    this.lightPhase = 0;
  }
  wantedCapacity() { return G.wanted === 0 ? 0 : 1 + G.wanted; }  // 2..6 units
  update(dt, playerPos, playerSpeed, colliders, fx) {
    this.lightPhase += dt * 9;
    const capacity = this.wantedCapacity();
    this.spawnTimer -= dt;
    if (this.units.length < capacity && this.spawnTimer <= 0) {
      this.spawnTimer = 2.5;
      this.spawnUnit(playerPos);
    }
    let nearest = Infinity;
    let pinning = false;
    for (let i = this.units.length - 1; i >= 0; i--) {
      const u = this.units[i];
      const d = dist2d(u.x, u.z, playerPos.x, playerPos.z);
      nearest = Math.min(nearest, d);
      if (u.dead) continue;
      if (G.wanted === 0) {
        // heat is gone: units peel away and despawn at range
        u.drive(dt, 0.4, 0, colliders);
        if (d > 90) { this.scene.remove(u.mesh); this.units.splice(i, 1); }
        continue;
      }
      // pursuit steering: aim at a point just behind the player's heading
      const dx = playerPos.x - u.x, dz = playerPos.z - u.z;
      const targetHeading = Math.atan2(dx, dz);
      let diff = targetHeading - u.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const steer = clamp(-diff * 1.4, -0.85, 0.85);   // Vehicle.drive turns heading by -steer
      const throttle = d > 7 ? 1 : d > 3.4 ? 0.35 : -0.5;
      const before = u.speed;
      u.drive(dt, throttle, steer, colliders);
      if (u.crashed && Math.abs(before) > 9 && fx) fx.crash();
      u.crashed = 0;
      if (d < 6.5 && playerSpeed < 2.2) pinning = true;
      // flashing lightbar
      const bar = u.mesh.getObjectByName('lightbar');
      if (bar) bar.visible = Math.sin(this.lightPhase + i * 1.7) > -0.2;
      if (d > 260) { this.scene.remove(u.mesh); this.units.splice(i, 1); }
    }
    // the bust meter only fills while a unit has the player pinned and slow
    if (pinning && G.wanted > 0) G.bustMeter += dt / 2.6;
    else G.bustMeter = Math.max(0, G.bustMeter - dt * 0.7);
    this.nearest = nearest;
    return { nearest, active: this.units.length };
  }
  spawnUnit(playerPos) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 95;
    const x = clamp(playerPos.x + Math.cos(angle) * dist, -215, 215);
    const z = clamp(playerPos.z + Math.sin(angle) * dist, -215, 205);
    const u = new Vehicle(this.scene, 0x1b2634, x, z, Math.atan2(playerPos.x - x, playerPos.z - z), {
      kind: 'police', police: true, maxSpeed: 33,
    });
    this.units.push(u);
  }
  clearAll() {
    for (const u of this.units) this.scene.remove(u.mesh);
    this.units = [];
    G.bustMeter = 0;
  }
}
