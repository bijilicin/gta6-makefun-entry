// Pooled particle billboards + skid marks for Solmaris — Babylon.js
// port (v3 engine rewrite). One billboard pool (hard cap) serves tire
// smoke, dust, impact sparks, fire and explosion fireballs; one ring
// buffer of dark quads serves skid marks. Nothing allocates per frame:
// dead particles park far below the city.
//
// Babylon notes: three.js Sprites become camera-facing billboard planes
// (Mesh.BILLBOARDMODE_ALL) with an unlit alpha material each, so colour
// and opacity stay per-particle exactly as the sprite pool behaved.

import { clamp } from './state.js';
import { texFromCanvas, basicMat, groundQuad, uid } from './world.js';

function puffTexture(scene, inner, outer) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 3, 32, 32, 30);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  return texFromCanvas(c, scene, { hasAlpha: true });
}

const MAX_PARTICLES = 240;
const MAX_SKIDS = 220;

export class ParticleSystem {
  constructor(scene) {
    this.scene = scene;
    this.texSoft = puffTexture(scene, 'rgba(255,255,255,0.85)', 'rgba(255,255,255,0)');
    this.items = [];
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const spr = BABYLON.MeshBuilder.CreatePlane(uid('puff'), { width: 1, height: 1 }, scene);
      spr.material = basicMat(scene, { map: this.texSoft, opacity: 0, depthWrite: false });
      spr.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
      spr.position.set(0, -60, 0);
      spr.isPickable = false;
      this.items.push({ spr, life: 0, maxLife: 1, vx: 0, vy: 0, vz: 0, grow: 0, grav: 0, baseOpacity: 0 });
    }
    this.cursor = 0;
    // skid mark ring buffer
    this.skids = [];
    for (let i = 0; i < MAX_SKIDS; i++) {
      const m = groundQuad(scene, 0.34, 1.15, basicMat(scene, { color: 0x0c0d10, opacity: 0.55, depthWrite: false }));
      m.position.set(0, -5, 0);
      m.isVisible = false;
      m.renderingGroupId = 1;
      this.skids.push({ mesh: m, age: 999 });
    }
    this.skidCursor = 0;
  }
  spawn(x, y, z, opts = {}) {
    const p = this.items[this.cursor];
    this.cursor = (this.cursor + 1) % MAX_PARTICLES;
    p.life = p.maxLife = opts.life || 0.8;
    p.vx = opts.vx || 0; p.vy = opts.vy || 1; p.vz = opts.vz || 0;
    p.grow = opts.grow || 1.6;
    p.grav = opts.grav || 0;
    p.spr.position.set(x, y, z);
    const s = opts.size || 1.4;
    p.spr.scaling.set(s, s, 1);
    p.spr.material.diffuseColor = new BABYLON.Color3(
      ((opts.color ?? 0xcccccc) >> 16 & 255) / 255,
      ((opts.color ?? 0xcccccc) >> 8 & 255) / 255,
      ((opts.color ?? 0xcccccc) & 255) / 255);
    p.spr.material.alpha = opts.opacity ?? 0.5;
    p.baseOpacity = opts.opacity ?? 0.5;
    return p;
  }
  smoke(x, z, dark) {
    this.spawn(x + (Math.random() - 0.5) * 0.5, 1.6, z + (Math.random() - 0.5) * 0.5, {
      life: 1.5, vy: 1.9, size: 1.7, grow: 2.4, color: dark ? 0x333338 : 0xd8d8d8, opacity: dark ? 0.62 : 0.4,
    });
  }
  tireSmoke(x, z) {
    this.spawn(x, 0.55, z, { life: 0.85, vy: 0.9, vx: (Math.random() - 0.5) * 0.8, vz: (Math.random() - 0.5) * 0.8, size: 1.15, grow: 2.6, color: 0xe8e8e8, opacity: 0.42 });
  }
  dust(x, z) {
    this.spawn(x, 0.5, z, { life: 0.9, vy: 0.8, size: 1.5, grow: 2.2, color: 0xd9ba7c, opacity: 0.38 });
  }
  sparks(x, z) {
    for (let i = 0; i < 5; i++) {
      this.spawn(x, 0.9, z, {
        life: 0.32, vx: (Math.random() - 0.5) * 7, vy: 2 + Math.random() * 3.4, vz: (Math.random() - 0.5) * 7,
        size: 0.32, grow: -0.4, grav: -9, color: 0xffc95e, opacity: 0.95,
      });
    }
  }
  fire(x, z, big) {
    this.spawn(x + (Math.random() - 0.5) * 1.2, 1.1, z + (Math.random() - 0.5) * 1.2, {
      life: 0.55, vy: 2.6, size: big ? 2.6 : 1.5, grow: 1.2, color: Math.random() > 0.4 ? 0xff7b2e : 0xffb03a, opacity: 0.85,
    });
  }
  explosion(x, z) {
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * 3.2;
      this.spawn(x + Math.cos(a) * r, 1 + Math.random() * 1.6, z + Math.sin(a) * r, {
        life: 0.7 + Math.random() * 0.7, vx: Math.cos(a) * (2 + Math.random() * 5), vy: 3 + Math.random() * 4, vz: Math.sin(a) * (2 + Math.random() * 5),
        size: 2.4 + Math.random() * 2.4, grow: 2.6, color: Math.random() > 0.35 ? 0xff8a30 : 0xffd23e, opacity: 0.9,
      });
    }
    for (let i = 0; i < 12; i++) this.smoke(x + (Math.random() - 0.5) * 4, z + (Math.random() - 0.5) * 4, true);
  }
  muzzle(x, y, z) {
    this.spawn(x, y, z, { life: 0.07, vy: 0, size: 0.85, grow: 0.5, color: 0xffe98a, opacity: 0.95 });
  }
  skid(x, z, heading) {
    const s = this.skids[this.skidCursor];
    this.skidCursor = (this.skidCursor + 1) % MAX_SKIDS;
    s.age = 0;
    s.mesh.isVisible = true;
    s.mesh.position.set(x, 0.055, z);
    s.mesh.rotation.y = heading;
    s.mesh.material.alpha = 0.55;
  }
  update(dt) {
    for (const p of this.items) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.spr.material.alpha = 0; p.spr.position.y = -60; continue; }
      p.vy += p.grav * dt;
      p.spr.position.x += p.vx * dt;
      p.spr.position.y += p.vy * dt;
      p.spr.position.z += p.vz * dt;
      const s = p.spr.scaling.x + p.grow * dt;
      const sc = Math.max(0.1, s);
      p.spr.scaling.set(sc, sc, 1);
      p.spr.material.alpha = p.baseOpacity * clamp(p.life / p.maxLife, 0, 1);
    }
    for (const s of this.skids) {
      if (!s.mesh.isVisible) continue;
      s.age += dt;
      if (s.age > 9) { s.mesh.material.alpha = Math.max(0, 0.55 - (s.age - 9) * 0.2); if (s.age > 12) s.mesh.isVisible = false; }
    }
  }
}
