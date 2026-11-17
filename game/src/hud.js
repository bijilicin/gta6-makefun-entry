// HUD for Solmaris Heat: DOM bars and readouts (health, cash, wanted stars,
// clock, weapon, speedometer, bust meter, mission panel, toasts and prompts)
// plus a canvas minimap that draws the road grid, the beach, every nearby
// car and pedestrian, police in red, and the gold objective beacon.

import { G, WORLD, clamp } from './state.js';
import { LANDMARKS } from './world.js';

export class Hud {
  constructor() {
    this.el = {};
    for (const id of ['hud', 'money', 'wanted', 'clock', 'healthfill', 'weapon', 'missiontitle', 'missiontext',
      'missiontimer', 'toast', 'prompt', 'speedo', 'bustedbar', 'bustedfill', 'damageflash', 'statusline']) {
      this.el[id] = document.getElementById(id);
    }
    this.map = document.getElementById('minimap');
    this.mapCtx = this.map.getContext('2d');
    this.toastTimer = 0;
    this.lastStars = -1;
  }
  show() { this.el.hud.classList.remove('hidden'); }
  hide() { this.el.hud.classList.add('hidden'); }
  toast(text, seconds) {
    this.el.toast.textContent = text;
    this.el.toast.style.opacity = 1;
    this.toastTimer = seconds || 2.6;
    this.el.statusline.textContent = text;
  }
  prompt(html) {
    if (html) { this.el.prompt.innerHTML = html; this.el.prompt.classList.remove('hidden'); }
    else this.el.prompt.classList.add('hidden');
  }
  update(dt, missionHud, player, vehicles, peds, policeUnits, target) {
    this.toastTimer -= dt;
    if (this.toastTimer <= 0) this.el.toast.style.opacity = 0;
    this.el.money.textContent = '$' + G.money.toLocaleString('en-US');
    this.el.healthfill.style.width = clamp(G.health, 0, 100) + '%';
    const mins = Math.floor(G.clockMinutes) % (24 * 60);
    const hh = String(Math.floor(mins / 60)).padStart(2, '0');
    const mm = String(mins % 60).padStart(2, '0');
    this.el.clock.textContent = hh + ':' + mm;
    if (G.wanted !== this.lastStars) {
      this.lastStars = G.wanted;
      let html = '';
      for (let i = 0; i < 5; i++) html += `<span class="${i < G.wanted ? 'lit' : ''}">★</span>`;
      this.el.wanted.innerHTML = html;
    }
    this.el.weapon.textContent = G.mode === 'car' ? (player.car ? player.car.kind.toUpperCase() + ' · HP ' + Math.max(0, Math.round(player.car.health)) : '')
      : G.hasGun ? 'PISTOL · CLICK TO FIRE' : 'FISTS · F TO PUNCH';
    this.el.missiontitle.textContent = missionHud.title;
    this.el.missiontext.textContent = missionHud.text;
    if (missionHud.timer !== null && missionHud.timer !== undefined) {
      const t = Math.max(0, missionHud.timer);
      this.el.missiontimer.textContent = Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0');
      this.el.missiontimer.style.color = t < 20 ? '#ff5b5b' : '#ffdf6b';
    } else this.el.missiontimer.textContent = '';
    if (G.mode === 'car' && player.car) {
      this.el.speedo.classList.remove('hidden');
      this.el.speedo.innerHTML = Math.round(Math.abs(player.car.speed) * 3.6) + '<small> KM/H</small>';
    } else this.el.speedo.classList.add('hidden');
    if (G.bustMeter > 0.03 && G.wanted > 0) {
      this.el.bustedbar.classList.remove('hidden');
      this.el.bustedfill.style.width = clamp(G.bustMeter * 100, 0, 100) + '%';
    } else this.el.bustedbar.classList.add('hidden');
    this.el.damageflash.style.opacity = G.damageFlash > 0 ? String(G.damageFlash * 0.9) : '0';
    this.drawMinimap(player, vehicles, peds, policeUnits, target);
  }
  drawMinimap(player, vehicles, peds, policeUnits, target) {
    const ctx = this.mapCtx;
    const S = 190, C = S / 2, scale = S / 300;   // 300 world units across
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath(); ctx.arc(C, C, C - 2, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#43584c';
    ctx.fillRect(0, 0, S, S);
    const toMap = (x, z) => [C + (x - player.x) * scale, C + (z - player.z) * scale];
    // sea and sand to the south
    let [, beachY] = toMap(0, WORLD.beachZ);
    ctx.fillStyle = '#e8cf8f'; ctx.fillRect(0, beachY, S, S - beachY);
    let [, seaY] = toMap(0, WORLD.oceanZ);
    ctx.fillStyle = '#1e7fa8'; ctx.fillRect(0, seaY, S, S - seaY);
    // roads
    ctx.strokeStyle = '#2c2f36'; ctx.lineWidth = WORLD.roadWidth * scale;
    for (let c = -WORLD.half; c <= WORLD.half; c += WORLD.roadEvery) {
      let [x1] = toMap(c, 0);
      ctx.beginPath(); ctx.moveTo(x1, 0); ctx.lineTo(x1, S); ctx.stroke();
      let [, y1] = toMap(0, c);
      ctx.beginPath(); ctx.moveTo(0, y1); ctx.lineTo(S, y1); ctx.stroke();
    }
    const dot = (x, z, r, color) => {
      const [mx, my] = toMap(x, z);
      if (mx < -6 || my < -6 || mx > S + 6 || my > S + 6) return;
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(mx, my, r, 0, Math.PI * 2); ctx.fill();
    };
    for (const p of peds) dot(p.pos.x, p.pos.z, 1.6, '#e8e4da');
    for (const v of vehicles) dot(v.x, v.z, 2.6, v.isPlayerCar ? '#7dff9a' : '#c9ced6');
    for (const u of policeUnits) dot(u.x, u.z, 3.2, '#ff4040');
    for (const key of Object.keys(LANDMARKS)) {
      const lm = LANDMARKS[key];
      dot(lm.x, lm.z, 2.2, 'rgba(255,255,255,0.5)');
    }
    if (target) {
      const [tx, ty] = toMap(target.x, target.z);
      ctx.strokeStyle = '#ffc93e'; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.arc(clamp(tx, 10, S - 10), clamp(ty, 10, S - 10), 6, 0, Math.PI * 2); ctx.stroke();
    }
    // player arrow, always centred, rotated to heading (map is north-up)
    ctx.translate(C, C);
    ctx.rotate(Math.PI - (player.car ? player.car.heading : player.heading));
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -7); ctx.lineTo(5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5, 6);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
}
