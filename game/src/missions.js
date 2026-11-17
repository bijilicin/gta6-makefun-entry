// The story of Solmaris Heat in five jobs, plus free-roam cash pickups.
// Mama Rosa hires Rina off the cafe corner; each mission is a small state
// machine (objective point, optional timer, optional checkpoint list) and
// pays cash into the shared state, unlocks the pistol, and raises Rina's
// profile with the Solmaris PD exactly as much as the job deserves.

import { G, clamp, commitCrime, dist2d, saveGame } from './state.js';
import { LANDMARKS } from './world.js';

export const MISSION_DEFS = [
  {
    id: 'first-run', title: 'FIRST RUN',
    brief: 'Mama Rosa needs a package moved, no questions. Pick it up at the cafe, then take it to the pier before the tide turns.',
    reward: 250,
    stages: [
      { at: LANDMARKS.cafe, label: 'Pick up the package at Mama Rosa\'s Cafe', r: 6 },
      { at: LANDMARKS.pier, label: 'Deliver the package to the pier', r: 8, timer: 150 },
    ],
  },
  {
    id: 'beach-sprint', title: 'BEACH SPRINT',
    brief: 'Street racers meet at the south-east corner. Hit every checkpoint in any car you can get your hands on. Winning earns you a pistol, courtesy of Rico.',
    reward: 400,
    stages: [
      { at: LANDMARKS.raceStart, label: 'Reach the Beach Sprint start in a car', r: 9, needCar: true },
      { checkpoints: [
          { x: 160, z: 40 }, { x: 84, z: -76 }, { x: -76, z: -156 }, { x: -160, z: 36 }, { x: 20, z: 168 },
        ], label: 'Hit the checkpoints!', timer: 170, needCar: true },
    ],
  },
  {
    id: 'borrowed-wheels', title: 'BORROWED WHEELS',
    brief: 'A coral-red coupe sits unlocked at the Marina Lot. Rico wants it — and he is not asking the owner. Steal it and bring it to Rico\'s Garage.',
    reward: 600,
    stages: [
      { at: LANDMARKS.marina, label: 'Steal the coral coupe at the Marina Lot', r: 10, needMissionCar: true },
      { at: LANDMARKS.garage, label: 'Deliver the coupe to Rico\'s Garage', r: 10, needMissionCar: true },
    ],
  },
  {
    id: 'shake-the-heat', title: 'SHAKE THE HEAT',
    brief: 'The cartel tipped off the PD: you are about to be very popular. Reach the Old Lighthouse and let the heat die down in its shadow.',
    reward: 800,
    heatOnStart: 2,
    stages: [
      { at: LANDMARKS.hideout, label: 'Escape to the Old Lighthouse', r: 12, timer: 150 },
      { at: LANDMARKS.hideout, label: 'Stay hidden until the heat dies', r: 14, holdUntilCalm: true },
    ],
  },
  {
    id: 'evening-tide', title: 'THE EVENING TIDE',
    brief: 'Three cash cases, one boat, one sunset. Collect every case the cartel dropped, then reach the pier. This is the money that clears Rina\'s name.',
    reward: 1500,
    stages: [
      { pickups: [{ x: -156, z: 84 }, { x: 88, z: -164 }, { x: 168, z: 88 }], label: 'Collect the cash cases', timer: 260 },
      { at: LANDMARKS.pier, label: 'Reach the boat at the pier!', r: 9, timer: 120, finale: true },
    ],
  },
];

export class MissionSystem {
  constructor(scene) {
    this.scene = scene;
    this.active = null;         // { def, stageIndex, timeLeft, checkpointIndex, pickupsLeft }
    this.offerAt = LANDMARKS.cafe;
    // golden beacon showing the current objective
    const geo = new THREE.CylinderGeometry(3.2, 3.2, 42, 18, 1, true);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffc93e, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false });
    this.beacon = new THREE.Mesh(geo, mat);
    this.beacon.position.y = 21;
    this.beacon.visible = false;
    scene.add(this.beacon);
    const ringGeo = new THREE.TorusGeometry(3.2, 0.22, 8, 28);
    this.ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffc93e }));
    this.ring.rotation.x = Math.PI / 2;
    this.ring.position.y = 0.4;
    this.ring.visible = false;
    scene.add(this.ring);
    // cash case pickups (free roam + mission)
    this.cases = [];
    this.caseTimer = 4;
  }

  currentDef() { return MISSION_DEFS[G.missionIndex] || null; }
  offering() { return !this.active && !G.storyDone && this.currentDef() !== null; }

  startNext(fx) {
    const def = this.currentDef();
    if (!def || this.active) return false;
    this.active = { def, stageIndex: 0, timeLeft: null, checkpointIndex: 0, pickupsLeft: [] };
    this.enterStage(fx);
    if (def.heatOnStart) commitCrime(def.heatOnStart * 100, 'The PD are onto you!');
    if (fx) fx.success();
    return true;
  }

  enterStage(fx) {
    const a = this.active;
    const stage = a.def.stages[a.stageIndex];
    a.timeLeft = stage.timer || null;
    a.checkpointIndex = 0;
    a.pickupsLeft = stage.pickups ? stage.pickups.map(p => ({ ...p, taken: false })) : [];
    for (const p of a.pickupsLeft) this.spawnCase(p.x, p.z, true);
  }

  stageTarget() {
    const a = this.active;
    if (!a) return null;
    const stage = a.def.stages[a.stageIndex];
    if (stage.checkpoints) return stage.checkpoints[a.checkpointIndex];
    if (stage.pickups) {
      const left = a.pickupsLeft.find(p => !p.taken);
      return left || stage.at || null;
    }
    return stage.at;
  }

  update(dt, player, fx, events) {
    // beacon follows the current objective (or the cafe when offering)
    const showAt = this.active ? this.stageTarget() : (this.offering() ? this.offerAt : null);
    if (showAt) {
      this.beacon.visible = true; this.ring.visible = true;
      this.beacon.position.x = showAt.x; this.beacon.position.z = showAt.z;
      this.ring.position.x = showAt.x; this.ring.position.z = showAt.z;
      this.ring.scale.setScalar(1 + Math.sin(G.time * 3) * 0.08);
    } else { this.beacon.visible = false; this.ring.visible = false; }

    this.updateCases(dt, player, fx);
    if (!this.active) {
      if (this.offering() && dist2d(player.x, player.z, this.offerAt.x, this.offerAt.z) < 6) {
        events.push({ type: 'offer', def: this.currentDef() });
      }
      return;
    }
    const a = this.active;
    const stage = a.def.stages[a.stageIndex];
    if (a.timeLeft !== null) {
      a.timeLeft -= dt;
      if (a.timeLeft <= 0) { this.fail(fx, events); return; }
    }
    const target = this.stageTarget();
    // conditions that gate stage completion
    if (stage.needMissionCar && !(player.car && player.car.isMissionCar)) {
      // still travelling to the car / on foot: only the zone check below at stage 0 matters
      if (a.stageIndex > 0) return;
    }
    if (stage.needCar && !player.car && !stage.checkpoints) return;
    if (stage.checkpoints && !player.car) return;   // the sprint only counts from behind a wheel
    if (stage.holdUntilCalm) {
      if (target && dist2d(player.x, player.z, target.x, target.z) < stage.r) {
        G.hideoutCalm += dt;
        if (G.wanted === 0 && G.hideoutCalm > 2) this.advance(fx, events);
      }
      return;
    }
    if (stage.pickups) {
      if (a.pickupsLeft.every(p => p.taken)) this.advance(fx, events);
      return;
    }
    if (target && dist2d(player.x, player.z, target.x, target.z) < (stage.r || 7)) {
      if (stage.checkpoints) {
        a.checkpointIndex++;
        if (fx) fx.pickup();
        if (a.checkpointIndex >= stage.checkpoints.length) this.advance(fx, events);
        return;
      }
      this.advance(fx, events);
    }
  }

  advance(fx, events) {
    const a = this.active;
    a.stageIndex++;
    if (a.stageIndex >= a.def.stages.length) { this.complete(fx, events); return; }
    this.enterStage(fx);
    events.push({ type: 'stage', def: a.def, stage: a.def.stages[a.stageIndex] });
    if (fx) fx.pickup();
  }

  complete(fx, events) {
    const def = this.active.def;
    G.money += def.reward;
    if (def.id === 'beach-sprint' && !G.hasGun) { G.hasGun = true; events.push({ type: 'gun' }); }
    if (def.id === 'evening-tide') { G.storyDone = true; events.push({ type: 'story-done' }); }
    G.missionIndex++;
    this.active = null;
    saveGame();
    if (fx) fx.success();
    events.push({ type: 'complete', def });
  }

  fail(fx, events) {
    const def = this.active.def;
    this.active = null;
    if (fx) fx.fail();
    events.push({ type: 'failed', def });
  }

  spawnCase(x, z, missionCase) {
    const grp = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.5, 0.8), new THREE.MeshLambertMaterial({ color: missionCase ? 0x8a1f2d : 0x1f6f43 }));
    box.position.y = 0.5;
    grp.add(box);
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 6), new THREE.MeshBasicMaterial({ color: 0x7dff9a }));
    glow.position.y = 1.15;
    grp.add(glow);
    grp.position.set(x, 0, z);
    this.scene.add(grp);
    this.cases.push({ mesh: grp, x, z, missionCase: !!missionCase, spin: Math.random() * 6 });
  }

  updateCases(dt, player, fx) {
    // free-roam cases trickle in so there is always a small score to chase
    this.caseTimer -= dt;
    if (this.caseTimer <= 0) {
      this.caseTimer = 14;
      if (this.cases.filter(c => !c.missionCase).length < 4) {
        this.spawnCase((Math.random() - 0.5) * 360, (Math.random() - 0.5) * 360, false);
      }
    }
    for (let i = this.cases.length - 1; i >= 0; i--) {
      const c = this.cases[i];
      c.spin += dt * 2;
      c.mesh.rotation.y = c.spin;
      c.mesh.position.y = Math.sin(c.spin * 1.4) * 0.12;
      if (dist2d(player.x, player.z, c.x, c.z) < 3.2) {
        this.scene.remove(c.mesh);
        this.cases.splice(i, 1);
        if (fx) fx.pickup();
        if (c.missionCase) {
          const a = this.active;
          if (a) { const p = a.pickupsLeft.find(q => !q.taken && Math.abs(q.x - c.x) < 2 && Math.abs(q.z - c.z) < 2); if (p) p.taken = true; }
          if (this.active && this.active.def.id === 'evening-tide') commitCrime(60, '');
        } else {
          G.money += 25;
        }
      }
    }
  }

  hudState() {
    if (this.active) {
      const a = this.active;
      const stage = a.def.stages[a.stageIndex];
      let label = stage.label;
      if (stage.checkpoints) label = `Checkpoint ${Math.min(a.checkpointIndex + 1, stage.checkpoints.length)}/${stage.checkpoints.length} — hit them in order!`;
      if (stage.pickups) {
        const left = a.pickupsLeft.filter(p => !p.taken).length;
        label = `Collect the cash cases (${a.pickupsLeft.length - left}/${a.pickupsLeft.length})`;
      }
      return { title: a.def.title, text: label, timer: a.timeLeft };
    }
    if (G.storyDone) return { title: 'FREE ROAM', text: 'The tide is yours. Cruise Solmaris, chase cash cases, or stir up the PD for fun.', timer: null };
    const def = this.currentDef();
    if (def) return { title: 'NEXT JOB: ' + def.title, text: 'Meet Mama Rosa at her cafe (gold beacon) to start. ' + def.brief, timer: null };
    return { title: 'FREE ROAM', text: 'Explore Solmaris.', timer: null };
  }
}
