// HUD for Solmaris Heat v2: a clean modern overlay. Bottom-right circular
// minimap with the full blip language (gold objective + GPS street route,
// red police / blue searching police with vision cones, red search zone,
// white player arrow), top-right cash with count-up and wanted stars that
// are solid while seen, flashing while searched-for and hollow at zero,
// bottom-left health (and vehicle) bars, mission panel top-left, centre
// MISSION PASSED / FAILED banners, a radio toast and a respray overlay.

import { G, WORLD, clamp, gpsRoute, dist2d } from './state.js';
import { LANDMARKS } from './world.js';
import { STASH_SPOTS } from './missions.js';

export class Hud {
  constructor() {
    this.el = {};
    for (const id of ['hud', 'money', 'wanted', 'clock', 'healthfill', 'carfill', 'carwrap', 'weapon', 'missiontitle', 'missiontext',
      'missiontimer', 'toast', 'prompt', 'speedo', 'bustedbar', 'bustedfill', 'damageflash', 'statusline',
      'banner', 'bannertitle', 'bannersub', 'radiotoast', 'respray', 'respraybar',
      'meter', 'meterlabel', 'meterfill', 'dialogue', 'chapter', 'chaptertitle', 'chaptersub', 'endcard', 'endcardbody']) {
      this.el[id] = document.getElementById(id);
    }
    this.el.weaponbox = document.getElementById('weaponbox');
    this.el.wpnname = document.getElementById('wpn-name');
    this.el.wpnammo = document.getElementById('wpn-ammo');
    this.dialogueQueue = [];
    this.dialogueTimer = 0;
    this.chapterTimer = 0;
    if (this.el.endcard) this.el.endcard.addEventListener('click', () => this.el.endcard.classList.add('hidden'));
    this.map = document.getElementById('minimap');
    this.mapCtx = this.map.getContext('2d');
    // full-screen city map (M key / pause menu): same blip language as
    // the minimap, drawn world-fixed with north up
    this.mapscreen = document.getElementById('mapscreen');
    this.fullmap = document.getElementById('fullmap');
    this.fullmapCtx = this.fullmap ? this.fullmap.getContext('2d') : null;
    this.fullMapOpen = false;
    this.mapZoom = 1;
    if (this.mapscreen) this.mapscreen.addEventListener('wheel', (e) => {
      if (!this.fullMapOpen) return;
      e.preventDefault();
      this.mapZoom = clamp(this.mapZoom * (e.deltaY < 0 ? 1.18 : 0.85), 1, 2.6);
    }, { passive: false });
    this.toastTimer = 0;
    this.bannerTimer = 0;
    this.radioTimer = 0;
    this.lastStarKey = '';
  }
  show() { this.el.hud.classList.remove('hidden'); }
  hide() { this.el.hud.classList.add('hidden'); }
  toast(text, seconds) {
    this.el.toast.textContent = text;
    this.el.toast.style.opacity = 1;
    this.toastTimer = seconds || 2.6;
    this.el.statusline.textContent = text;
  }
  banner(title, sub, kind) {
    this.el.bannertitle.textContent = title;
    this.el.bannersub.textContent = sub || '';
    this.el.banner.className = 'show ' + (kind || '');
    this.bannerTimer = 3.0;
    this.el.statusline.textContent = title + (sub ? ' ' + sub : '');
  }
  radio(name) {
    this.el.radiotoast.textContent = '♪ ' + name;
    this.el.radiotoast.style.opacity = 1;
    this.radioTimer = 2.2;
  }
  respray(active, frac) {
    if (!this.el.respray) return;
    this.el.respray.classList.toggle('hidden', !active);
    if (active && this.el.respraybar) this.el.respraybar.style.width = clamp(frac * 100, 0, 100) + '%';
  }
  prompt(html) {
    if (html) { this.el.prompt.innerHTML = html; this.el.prompt.classList.remove('hidden'); }
    else this.el.prompt.classList.add('hidden');
  }
  // Generic objective meter (spook / panic / damage / intimidate): the
  // mission system skins one bar per job via hudState().meter.
  meter(label, frac) {
    if (!this.el.meter) return;
    if (frac === null || frac === undefined) { this.el.meter.classList.add('hidden'); return; }
    this.el.meter.classList.remove('hidden');
    this.el.meterlabel.textContent = label || '';
    this.el.meterfill.style.width = clamp(frac * 100, 0, 100) + '%';
  }
  dialogue(lines) {
    if (!lines || !lines.length) return;
    this.dialogueQueue = lines.slice();
    this.dialogueTimer = 0;
  }
  chapter(title, sub) {
    if (!this.el.chapter) return;
    this.el.chaptertitle.textContent = title;
    this.el.chaptersub.textContent = sub || '';
    this.el.chapter.classList.add('show');
    this.chapterTimer = 3.6;
  }
  endCard(html) {
    if (!this.el.endcard) return;
    this.el.endcardbody.innerHTML = html;
    this.el.endcard.classList.remove('hidden');
  }
  update(dt, missionHud, player, vehicles, peds, policeUnits, target, targetKind) {
    this.toastTimer -= dt;
    if (this.toastTimer <= 0) this.el.toast.style.opacity = 0;
    this.bannerTimer -= dt;
    if (this.bannerTimer <= 0 && this.el.banner.className !== '') this.el.banner.className = '';
    this.radioTimer -= dt;
    if (this.radioTimer <= 0) this.el.radiotoast.style.opacity = 0;
    // dialogue cards: one speaker line at a time, ~3.4s each
    if (this.dialogueQueue.length) {
      this.dialogueTimer -= dt;
      if (this.dialogueTimer <= 0) {
        const line = this.dialogueQueue.shift();
        this.el.dialogue.querySelector('.who').textContent = line.who;
        this.el.dialogue.querySelector('.line').textContent = line.text;
        this.el.dialogue.style.opacity = 1;
        this.dialogueTimer = 3.4;
      }
    } else if (this.el.dialogue.style.opacity !== '0') {
      this.dialogueTimer -= dt;
      if (this.dialogueTimer <= 0) this.el.dialogue.style.opacity = 0;
    }
    if (this.chapterTimer > 0) {
      this.chapterTimer -= dt;
      if (this.chapterTimer <= 0) this.el.chapter.classList.remove('show');
    }
    this.meter(missionHud.meter ? missionHud.meter.label : null, missionHud.meter ? missionHud.meter.frac : null);
    // cash count-up
    if (G.displayedMoney !== G.money) {
      const diff = G.money - G.displayedMoney;
      const step = Math.sign(diff) * Math.min(Math.abs(diff), Math.max(1, Math.abs(diff) * dt * 4));
      G.displayedMoney += step;
      if (Math.abs(G.money - G.displayedMoney) < 1) G.displayedMoney = G.money;
    }
    this.el.money.textContent = '$' + Math.round(G.displayedMoney).toLocaleString('en-US');
    this.el.healthfill.style.width = clamp(G.health, 0, 100) + '%';
    this.el.healthfill.style.background = G.health < 30 ? '#ff4545' : '';
    if (this.el.carwrap) {
      const inCar = !!player.car;
      this.el.carwrap.style.display = inCar ? 'block' : 'none';
      if (inCar) this.el.carfill.style.width = clamp(player.car.health, 0, 100) + '%';
    }
    const mins = Math.floor(G.clockMinutes) % (24 * 60);
    const hh = String(Math.floor(mins / 60)).padStart(2, '0');
    const mm = String(mins % 60).padStart(2, '0');
    this.el.clock.textContent = hh + ':' + mm;
    // wanted stars: solid gold while seen, flashing while searching
    const flash = Math.floor(G.time * 2.4) % 2 === 0;
    const key = G.wanted + '|' + G.wantedState + '|' + (G.wantedState === 'searching' ? flash : 1);
    if (key !== this.lastStarKey) {
      this.lastStarKey = key;
      let html = '';
      for (let i = 0; i < 5; i++) {
        let cls = '';
        if (i < G.wanted) cls = G.wantedState === 'searching' ? (flash ? 'flash' : 'dim') : 'lit';
        html += `<span class="${cls}">★</span>`;
      }
      this.el.wanted.innerHTML = html;
    }
    const noAmmo = G.hasGun && G.reloading <= 0 && G.ammoMag <= 0 && G.ammoReserve <= 0;
    this.el.weapon.textContent = G.mode === 'car'
      ? (player.car ? player.car.kind.toUpperCase() + ' · ' + (player.car.tireBlown ? 'FLAT TIRE · ' : '') + 'SPACE: DRIVE-BY' : '')
      : G.hasGun ? (noAmmo ? 'PISTOL · NO AMMO — LOOT DROPS +12 · PAWN SHOP 24 FOR $50' : 'PISTOL · CLICK / SPACE TO FIRE · R RELOAD') : 'FISTS · F TO PUNCH';
    // GTA-style weapon box under the wanted stars: icon + name + ammo.
    // Armed in every mode (foot, drive-by, shooter-seat, boat); the
    // count is the live magazine / finite reserve — real numbers only,
    // RELOADING while the reload runs, NO AMMO when both are empty.
    if (this.el.weaponbox) {
      const wb = this.el.weaponbox;
      if (G.hasGun) {
        wb.classList.remove('unarmed');
        this.el.wpnname.textContent = 'PISTOL';
        if (G.reloading > 0) {
          wb.classList.add('reloading');
          wb.classList.remove('noammo');
          this.el.wpnammo.textContent = 'RELOADING';
        } else if (noAmmo) {
          wb.classList.remove('reloading');
          wb.classList.add('noammo');
          this.el.wpnammo.textContent = 'NO AMMO';
        } else {
          wb.classList.remove('reloading');
          wb.classList.remove('noammo');
          this.el.wpnammo.innerHTML = G.ammoMag + ' <span>/ ' + G.ammoReserve + '</span>';
        }
      } else {
        wb.classList.add('unarmed');
        wb.classList.remove('reloading');
        wb.classList.remove('noammo');
        this.el.wpnname.textContent = 'FISTS';
        this.el.wpnammo.textContent = '—';
      }
    }
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
    } else if (G.mode === 'boat' && player.boat) {
      this.el.speedo.classList.remove('hidden');
      this.el.speedo.innerHTML = Math.round(Math.abs(player.boat.speed) * 3.6) + '<small> KM/H</small>';
    } else this.el.speedo.classList.add('hidden');
    if (G.bustMeter > 0.03 && G.wanted > 0) {
      this.el.bustedbar.classList.remove('hidden');
      this.el.bustedfill.style.width = clamp(G.bustMeter * 100, 0, 100) + '%';
    } else this.el.bustedbar.classList.add('hidden');
    this.el.damageflash.style.opacity = G.damageFlash > 0 ? String(G.damageFlash * 0.9) : '0';
    this.drawMinimap(player, vehicles, peds, policeUnits, target);
    if (this.fullMapOpen) this.drawFullMap(player, vehicles, peds, policeUnits, target, targetKind);
  }
  setFullMap(open) {
    this.fullMapOpen = !!open;
    if (this.mapscreen) this.mapscreen.classList.toggle('hidden', !this.fullMapOpen);
    return this.fullMapOpen;
  }
  // The whole city on one screen: ocean, island, beach, street grid,
  // labelled landmarks, the same blips / GPS route / search zone as the
  // circular minimap, a north indicator, and Rina's arrow turned to her
  // real heading. North (-z) is up; the bay (+z) is down, like the
  // minimap's world orientation.
  drawFullMap(player, vehicles, peds, policeUnits, target, targetKind) {
    const ctx = this.fullmapCtx;
    if (!ctx) return;
    const S = 880, M = 30;
    // mouse-wheel zoom: the view window shrinks around Rina, clamped
    // to the charted world; at zoom 1 the whole city fits
    const zoom = this.mapZoom || 1;
    const spanX = 520 / zoom, spanZ = 620 / zoom;
    const vx = spanX >= 520 ? 0 : clamp(player.x, -260 + spanX / 2, 260 - spanX / 2);
    const vz = spanZ >= 620 ? 50 : clamp(player.z, -260 + spanZ / 2, 360 - spanZ / 2);
    const minX = vx - spanX / 2, maxX = vx + spanX / 2;
    const minZ = vz - spanZ / 2, maxZ = vz + spanZ / 2;
    const scale = Math.min((S - M * 2) / (maxX - minX), (S - M * 2) / (maxZ - minZ));
    const ox = M + ((S - M * 2) - (maxX - minX) * scale) / 2;
    const oy = M + ((S - M * 2) - (maxZ - minZ) * scale) / 2;
    const X = (x) => ox + (x - minX) * scale;
    const Y = (z) => oy + (z - minZ) * scale;
    ctx.clearRect(0, 0, S, S);
    // ocean everywhere, then the island, beach band and pier
    ctx.fillStyle = '#176b96'; ctx.fillRect(0, 0, S, S);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.font = '700 25px Verdana'; ctx.textAlign = 'center';
    ctx.fillText('S O L M A R I S   B A Y', S / 2, Y(318));
    ctx.fillStyle = '#43584c';
    ctx.fillRect(X(-228), Y(-228), 456 * scale, (WORLD.beachZ + 228) * scale);
    ctx.fillStyle = '#e8cf8f';
    ctx.fillRect(X(-228), Y(WORLD.beachZ), 456 * scale, (WORLD.oceanZ - WORLD.beachZ) * scale);
    ctx.fillStyle = '#9a6f47';
    ctx.fillRect(X(14), Y(198), 26 * scale, 74 * scale);   // the pier boards
    ctx.fillStyle = 'rgba(70,52,30,0.55)';
    ctx.font = '700 15px Verdana';
    ctx.fillText('S O L M A R I S   B E A C H', X(-95), Y(234));
    ctx.textAlign = 'left';
    ctx.fillText('B O A R D W A L K', X(-186), Y(222));
    // street grid (same roads the minimap draws)
    ctx.strokeStyle = '#2c2f36'; ctx.lineWidth = WORLD.roadWidth * scale; ctx.lineCap = 'round';
    for (let c = -WORLD.half; c <= WORLD.half; c += WORLD.roadEvery) {
      ctx.beginPath(); ctx.moveTo(X(c), Y(-WORLD.half - 14)); ctx.lineTo(X(c), Y(WORLD.half + 14)); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(X(-WORLD.half - 14), Y(c)); ctx.lineTo(X(WORLD.half + 14), Y(c)); ctx.stroke();
    }
    // search zone around the last known position
    if (G.wanted > 0 && G.wantedState !== 'clear') {
      ctx.fillStyle = 'rgba(255,45,60,0.25)';
      ctx.beginPath(); ctx.arc(X(G.lastKnown.x), Y(G.lastKnown.z), G.searchRadius * scale, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,80,90,0.85)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(X(G.lastKnown.x), Y(G.lastKnown.z), G.searchRadius * scale, 0, Math.PI * 2); ctx.stroke();
    }
    // GPS route along the streets to the objective (gold for jobs,
    // cyan for side work — the colours the world beacons use)
    const targetColor = targetKind === 'side' ? '#5ef2ff' : '#ffc93e';
    if (target) {
      const route = gpsRoute(player.x, player.z, target.x, target.z);
      ctx.strokeStyle = targetColor; ctx.lineWidth = 4.5; ctx.lineJoin = 'round';
      ctx.beginPath();
      route.forEach((p, i) => { if (i === 0) ctx.moveTo(X(p.x), Y(p.z)); else ctx.lineTo(X(p.x), Y(p.z)); });
      ctx.stroke();
    }
    const dot = (x, z, r, color) => {
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(X(x), Y(z), r, 0, Math.PI * 2); ctx.fill();
    };
    for (const p of peds) dot(p.pos.x, p.pos.z, 2.2, p.state === 'film' ? '#ffd23e' : '#e8e4da');
    for (const v of vehicles) dot(v.x, v.z, 3.6, v.isPlayerCar ? '#7dff9a' : '#c9ced6');
    for (const u of policeUnits) dot(u.x, u.z, 5, G.wantedState === 'searching' ? '#4d8dff' : '#ff4040');
    // every stash still out there is charted on the big map (the
    // minimap keeps its short-range ping rule)
    ctx.globalAlpha = 0.85;
    for (let i = 0; i < STASH_SPOTS.length; i++) {
      if (G.stashTaken.includes(i)) continue;
      const s = STASH_SPOTS[i];
      dot(s.x, s.z, 3.6, '#ffd23e');
    }
    ctx.globalAlpha = 1;
    // landmarks: coloured blip + the place name, GTA style
    const LM_STYLE = {
      cafe: '#ff8ac2', respray: '#5ef2ff', garage: '#5ef2ff', hospital: '#ff5b5b',
      station: '#7db4ff', pier: '#ffe9a8', marina: '#ffe9a8', hideout: '#ffe9a8', raceStart: '#ffe9a8',
      pawn: '#ffb02a',
    };
    ctx.font = '700 14.5px Verdana'; ctx.textAlign = 'left';
    const drawn = new Set();
    for (const key of Object.keys(LANDMARKS)) {
      const lm = LANDMARKS[key];
      const sig = lm.x + ',' + lm.z;
      if (drawn.has(sig)) continue;   // garage and respray share one roof
      drawn.add(sig);
      dot(lm.x, lm.z, 5.5, LM_STYLE[key] || '#ffffff');
      ctx.strokeStyle = 'rgba(0,0,0,0.65)'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(X(lm.x), Y(lm.z), 5.5, 0, Math.PI * 2); ctx.stroke();
      const label = key === 'garage' ? "Rico's Garage · Respray" : lm.name;
      ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 5;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(label, X(lm.x) + 10, Y(lm.z) + 5);
      ctx.shadowBlur = 0;
    }
    // Herrera's boat rides at anchor off the pier
    if (G.playerBoat) {
      dot(G.playerBoat.x, G.playerBoat.z, 5, '#7dd7ff');
      ctx.strokeStyle = 'rgba(0,0,0,0.65)'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(X(G.playerBoat.x), Y(G.playerBoat.z), 5, 0, Math.PI * 2); ctx.stroke();
      ctx.font = '700 14.5px Verdana'; ctx.textAlign = 'left';
      ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 5;
      ctx.fillStyle = '#ffffff';
      ctx.fillText("Herrera's Boat", X(G.playerBoat.x) + 10, Y(G.playerBoat.z) + 5);
      ctx.shadowBlur = 0;
    }
    // district watermark
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.font = '900 30px Verdana'; ctx.textAlign = 'center';
    ctx.fillText('D O W N T O W N', X(0), Y(-52));
    // objective marker
    if (target) {
      ctx.fillStyle = targetColor;
      ctx.beginPath(); ctx.arc(X(target.x), Y(target.z), 7, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#fff3c4'; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.arc(X(target.x), Y(target.z), 10.5, 0, Math.PI * 2); ctx.stroke();
    }
    // Rina's arrow, turned to her real heading (same rotation the
    // minimap arrow uses)
    ctx.save();
    ctx.translate(X(player.x), Y(player.z));
    ctx.rotate(Math.PI - (player.car ? player.car.heading : player.heading));
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(0, -12); ctx.lineTo(8.4, 9.6); ctx.lineTo(0, 4.8); ctx.lineTo(-8.4, 9.6);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
    // north indicator: fixed, because north is up on this map
    ctx.save();
    ctx.translate(S - 52, 52);
    ctx.fillStyle = 'rgba(5,8,14,0.72)';
    ctx.beginPath(); ctx.arc(0, 0, 30, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, 30, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#ffd76e';
    ctx.beginPath(); ctx.moveTo(0, -17); ctx.lineTo(6.5, 2); ctx.lineTo(-6.5, 2); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.font = '900 16px Verdana'; ctx.textAlign = 'center';
    ctx.fillText('N', 0, 19);
    ctx.restore();
  }
  drawMinimap(player, vehicles, peds, policeUnits, target) {
    const ctx = this.mapCtx;
    const S = 190, C = S / 2, scale = S / 300;
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath(); ctx.arc(C, C, C - 2, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#43584c';
    ctx.fillRect(0, 0, S, S);
    const toMap = (x, z) => [C + (x - player.x) * scale, C + (z - player.z) * scale];
    let [, beachY] = toMap(0, WORLD.beachZ);
    ctx.fillStyle = '#e8cf8f'; ctx.fillRect(0, beachY, S, S - beachY);
    let [, seaY] = toMap(0, WORLD.oceanZ);
    ctx.fillStyle = '#1e7fa8'; ctx.fillRect(0, seaY, S, S - seaY);
    ctx.strokeStyle = '#2c2f36'; ctx.lineWidth = WORLD.roadWidth * scale;
    for (let c = -WORLD.half; c <= WORLD.half; c += WORLD.roadEvery) {
      let [x1] = toMap(c, 0);
      ctx.beginPath(); ctx.moveTo(x1, 0); ctx.lineTo(x1, S); ctx.stroke();
      let [, y1] = toMap(0, c);
      ctx.beginPath(); ctx.moveTo(0, y1); ctx.lineTo(S, y1); ctx.stroke();
    }
    // search zone: shaded red disc around the last known position
    if (G.wanted > 0 && G.wantedState !== 'clear') {
      const [zx, zy] = toMap(G.lastKnown.x, G.lastKnown.z);
      ctx.fillStyle = 'rgba(255,45,60,0.28)';
      ctx.beginPath(); ctx.arc(zx, zy, G.searchRadius * scale, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,80,90,0.8)'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(zx, zy, G.searchRadius * scale, 0, Math.PI * 2); ctx.stroke();
    }
    // GPS route along the streets to the objective
    if (target) {
      const route = gpsRoute(player.x, player.z, target.x, target.z);
      ctx.strokeStyle = '#ffc93e'; ctx.lineWidth = 3; ctx.lineJoin = 'round';
      ctx.beginPath();
      route.forEach((p, i) => {
        const [mx, my] = toMap(p.x, p.z);
        if (i === 0) ctx.moveTo(mx, my); else ctx.lineTo(mx, my);
      });
      ctx.stroke();
    }
    const dot = (x, z, r, color) => {
      const [mx, my] = toMap(x, z);
      if (mx < -6 || my < -6 || mx > S + 6 || my > S + 6) return;
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(mx, my, r, 0, Math.PI * 2); ctx.fill();
    };
    for (const p of peds) dot(p.pos.x, p.pos.z, 1.5, p.state === 'film' ? '#ffd23e' : '#e8e4da');
    for (const v of vehicles) dot(v.x, v.z, 2.5, v.isPlayerCar ? '#7dff9a' : '#c9ced6');
    // police: vision cones while searching, then the blip
    for (const u of policeUnits) {
      const [mx, my] = toMap(u.x, u.z);
      if (mx < -20 || my < -20 || mx > S + 20 || my > S + 20) continue;
      if (G.wantedState === 'searching') {
        ctx.save();
        ctx.translate(mx, my);
        ctx.rotate(Math.PI - u.heading);
        ctx.fillStyle = 'rgba(90,150,255,0.30)';
        ctx.beginPath();
        ctx.moveTo(0, 0); ctx.lineTo(-9, -22); ctx.lineTo(9, -22);
        ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = G.wantedState === 'searching' ? '#4d8dff' : '#ff4040';
      ctx.beginPath(); ctx.arc(mx, my, 3.2, 0, Math.PI * 2); ctx.fill();
    }
    for (const key of Object.keys(LANDMARKS)) {
      const lm = LANDMARKS[key];
      dot(lm.x, lm.z, 2, 'rgba(255,255,255,0.45)');
    }
    // hidden stashes ping gold when Rina is close enough to hear the city whisper
    for (let i = 0; i < STASH_SPOTS.length; i++) {
      if (G.stashTaken.includes(i)) continue;
      const s = STASH_SPOTS[i];
      if (dist2d(player.x, player.z, s.x, s.z) < 45) dot(s.x, s.z, 2.6, '#ffd23e');
    }
    if (target) {
      const [tx, ty] = toMap(target.x, target.z);
      ctx.fillStyle = '#ffc93e';
      ctx.beginPath(); ctx.arc(clamp(tx, 9, S - 9), clamp(ty, 9, S - 9), 4.4, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#fff3c4'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(clamp(tx, 9, S - 9), clamp(ty, 9, S - 9), 6.4, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.translate(C, C);
    ctx.rotate(Math.PI - (player.car ? player.car.heading : player.heading));
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(0, -7.5); ctx.lineTo(5.2, 6); ctx.lineTo(0, 3); ctx.lineTo(-5.2, 6);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
}
