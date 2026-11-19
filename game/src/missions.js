// The Solmaris Heat campaign — Babylon.js port (v3 engine rewrite). The
// campaign logic, mission definitions, dialogue, stage grammar, side
// activities and save behaviour are IDENTICAL to the three.js build;
// only mesh construction / scene-graph calls moved to Babylon.
// Original header: revised story addendum (STORY_REVISION.md
// on top of STORY_MISSIONS.md). A duo, not a loner: Rina Vale and Nico
// Herrera take one easy marina pickup to clear their debt to Sal Prumo,
// and the bag holds a ledger chip the whole city wants. Ten story jobs in
// three acts, each a different GTA mission type — courier, checkpoint
// race, theft-to-order, an escape that teaches the search system, a tail
// with a spook meter, a marina robbery, an escort with a shooter-seat leg,
// a destruction rampage, a boat run, and a four-stage heist finale.
// Mission grammar throughout: gold beacon + GPS, stage text, named fail
// states, cash + unlocks, dialogue cards, chapter cards between acts.
// Side activities live here too: Taxi, Rosa's Debt Collection, and the
// ten Hidden Stashes.

import { G, clamp, commitCrime, dist2d, gpsRoute, saveGame } from './state.js';
import { LANDMARKS, SMASHABLES, resetSmashables, basicMat, pbrMat, boxMesh, sphereMesh, groupNode, removeNode, setShown, markShadow, uid } from './world.js';
import { Vehicle, Boat } from './vehicles.js';
import { makePersonMesh } from './peds.js';
import { seatPose } from './nico.js';

const L = LANDMARKS;
const DOCK = { x: 38, z: 258 };            // where Herrera's boat rides
const WAREHOUSE = { x: -168, z: -30 };     // west warehouse (tail's end)
const MOTEL = { x: 164, z: 164 };          // airport-road motel (race start corner)

export const STASH_SPOTS = [
  { x: 24, z: 246 }, { x: -168, z: -158 }, { x: -140, z: 206 }, { x: 132, z: 30 },
  { x: 0, z: -128 }, { x: 196, z: 190 }, { x: -196, z: -196 }, { x: 84, z: -188 },
  { x: -64, z: 152 }, { x: 176, z: -64 },
];

function wrapAngle(d) {
  d = d % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
// Shared pursuit/route driver for mission cars (same convention as the PD).
function driveToward(car, dt, tx, tz, colliders, cap = 1) {
  const desired = Math.atan2(tx - car.x, tz - car.z);
  const diff = wrapAngle(desired - car.heading);
  const steer = clamp(-diff * 1.4, -0.85, 0.85);
  const throttle = Math.abs(diff) > 2.4 ? -0.5 : cap;
  car.drive(dt, throttle, steer, colliders, {});
}

export const MISSION_DEFS = [
  {
    id: 'first-run', title: 'FIRST RUN', giver: 'Mama Rosa', giverAt: L.cafe, reward: 250,
    brief: 'A "catering order" for the pier, no questions. Rosa\'s nephew Nico will take it off your hands.',
    chapter: { title: 'ACT 1', sub: 'EASY MONEY' },
    intro: [
      { who: 'MAMA ROSA', text: 'You owe Sal, I owe Sal — in Solmaris, that makes us family. Take this order to the pier.' },
      { who: 'RINA', text: 'And the envelope inside the order?' },
      { who: 'MAMA ROSA', text: 'Is why you drive fast and ask slow, mi hija.' },
    ],
    outro: 'Nico, at the pier: "Clean run. You drive like you mean it."',
    stages: [
      { type: 'go', at: L.cafe, r: 8.5, label: 'Pick up the package at Mama Rosa\'s Cafe' },
      { type: 'go', at: L.pier, r: 9, timer: 180, label: 'Deliver the package to Nico at the pier', failText: 'The tide — and Nico — waited for no one.' },
    ],
  },
  {
    id: 'beach-sprint', title: 'BEACH SPRINT', giver: 'Tito Ferreira', giverAt: L.raceStart, reward: 400, unlock: 'gun',
    brief: 'Tito\'s beachfront checkpoint race. Beat his crew\'s pace car and the pistol in the glovebox is yours.',
    intro: [
      { who: 'TITO', text: 'Ten checkpoints, one loop of my beach. My boy sets the pace — finish before him, or don\'t finish.' },
      { who: 'NICO', text: 'I tuned that pace car myself. It is quick, Rina. Not sorry.' },
    ],
    outro: 'Tito: "A pistol for the winner. Try not to need it."',
    stages: [
      { type: 'go', at: L.raceStart, r: 9, needCar: true, label: 'Reach the Beach Sprint start in a car' },
      {
        type: 'checkpoints', timer: 165, label: 'Beat the pace car through the checkpoints!',
        failText: 'Tito\'s crew took the beach. And the pistol.',
        points: [
          { x: 150, z: 196 }, { x: 84, z: 204 }, { x: 20, z: 196 }, { x: -44, z: 204 }, { x: -108, z: 196 },
          { x: -172, z: 204 }, { x: -186, z: 116 }, { x: -108, z: 52 }, { x: -20, z: 116 }, { x: 84, z: 164 },
        ],
      },
    ],
  },
  {
    id: 'borrowed-wheels', title: 'BORROWED WHEELS', giver: 'Rico', giverAt: L.garage, reward: 600,
    brief: 'The coral coupe at the Marina Lot — quietly prepped "for a friend of Dario\'s". Rico wants it in his garage instead. Bonus for every panel you don\'t bend.',
    intro: [
      { who: 'RICO', text: 'Coral coupe, marina lot, keys in the visor like it wants to be stolen. Bring her home whole.' },
      { who: 'RINA', text: 'Whose is it, Rico?' },
      { who: 'RICO', text: 'Paperwork says nobody. That is the best kind of somebody.' },
    ],
    outro: 'Rico: "Not a scratch worth naming. You ever need paint to disappear, my bay is your bay."',
    stages: [
      { type: 'steal', label: 'Steal the coral coupe at the Marina Lot', failText: 'The coupe got away from you.' },
      { type: 'deliverCar', at: L.garage, r: 12, label: 'Deliver the coupe to Rico\'s Garage', failText: 'The coupe was wrecked before Rico saw it.' },
    ],
  },
  {
    id: 'the-easy-one', title: 'THE EASY ONE', giver: 'Dario Marisol', giverAt: L.marina, reward: 500, unlock: 'partner',
    brief: 'Five minutes: pick up a cash bag at the marina with Nico, drop it across town. The job that changes everything.',
    intro: [
      { who: 'DARIO', text: 'One bag, one drive, debt halved. Even you two cannot complicate this.' },
      { who: 'NICO', text: 'He says that like the bag isn\'t ticking.' },
    ],
    outro: 'Rina finds the tracker — and, sewn into the lining, a ledger chip with half the city\'s sins on it.',
    stages: [
      { type: 'go', at: { x: -104, z: 214 }, r: 9, needCar: true, label: 'Drive Nico to the pickup at the marina dock' },
      {
        type: 'escape', heat: 4, label: 'AMBUSH! Lose the heat — break sight, slip the search zone', failText: 'The ambush closed around you.',
        lines: [
          { who: 'NICO', text: 'That is not a pickup, that is a firing squad — DRIVE!' },
          { who: 'RINA', text: 'The bag was marked. Dario knew. Lose them first, questions later.' },
        ],
      },
      { type: 'respray', label: 'Ditch the marked coupe: get a respray at Rico\'s', failText: 'The marked car was impounded.' },
      { type: 'go', at: L.hideout, r: 12, label: 'Take the bag to Old Man Herrera at the lighthouse', failText: 'Herrera\'s light went dark.' },
    ],
  },
  {
    id: 'quiet-tail', title: 'QUIET TAIL', giver: 'Vera Lindqvist', giverAt: L.marina, reward: 450,
    brief: 'Vera wants her syndicate\'s bagman followed, not frightened. Stay close enough to see, far enough to be nobody.',
    chapter: { title: 'ACT 2', sub: 'EVERYONE WANTS THE BAG' },
    intro: [
      { who: 'VERA', text: 'Follow the grey sedan. If he feels followed, I learn nothing and you earn nothing.' },
      { who: 'RINA', text: 'And if I see something I shouldn\'t?' },
      { who: 'VERA', text: 'Then you will finally understand this city.' },
    ],
    outro: 'The bagman delivers to Voss\'s own task force. The conspiracy has a face now — and a badge.',
    stages: [
      {
        type: 'tail', label: 'Tail the bagman — don\'t spook him, don\'t lose him', failText: 'The tail was spooked.',
        route: [{ x: 60, z: -60 }, { x: -20, z: 20 }, { x: -90, z: 62 }, { x: -150, z: 12 }, { x: WAREHOUSE.x, z: WAREHOUSE.z }],
        spawn: { x: 150, z: -150 },
      },
      { type: 'go', at: WAREHOUSE, r: 26, label: 'Close in on the warehouse — unseen', failText: 'You were made at the warehouse.' },
    ],
  },
  {
    id: 'marina-money', title: 'MARINA MONEY', giver: 'The pair, self-directed', giverAt: L.pier, reward: 900,
    brief: 'The syndicate\'s cash office at the marina holds the pair\'s way out. Three bags, one alarm, no greed.',
    intro: [
      { who: 'NICO', text: 'We need money nobody can trace. The Ledger\'s own office is full of it. Poetic.' },
      { who: 'RINA', text: 'Grab three bags. The alarm gives us a hundred seconds of honesty.' },
    ],
    outro: 'Herrera, counting at the pier: "Enough to buy a horizon. Almost."',
    stages: [
      { type: 'go', at: { x: -132, z: 206 }, r: 5, needFoot: true, label: 'Walk into the marina cash office (on foot, armed)' },
      {
        type: 'bags', timer: 100, label: 'Grab the cash bags — hold position at each one', failText: 'The alarm sealed the office.',
        points: [{ x: -136, z: 210 }, { x: -126, z: 214 }, { x: -138, z: 198 }],
      },
      { type: 'go', at: L.pier, r: 10, label: 'Escape to Herrera at the pier!', failText: 'The marina money never left the marina.' },
    ],
  },
  {
    id: 'precious-cargo', title: 'PRECIOUS CARGO', giver: 'Vera Lindqvist', giverAt: L.marina, reward: 800,
    brief: 'Vera is defecting with copies of the accounts. Leg 1: you drive, the syndicate rams. Leg 2: Nico drives — you shoot.',
    intro: [
      { who: 'VERA', text: 'My employers burn their own. Get me to Herrera alive and the accounts are your insurance.' },
      { who: 'NICO', text: 'Second leg is mine at the wheel. You shoot better angry anyway.' },
    ],
    outro: 'Vera, safe at the lighthouse: "You drive. He trusts your hands. I see why."',
    stages: [
      { type: 'escort', at: MOTEL, r: 11, needCar: true, label: 'Drive Vera to the airport-road motel — keep her calm', failText: 'The cargo was lost.' },
      { type: 'shooter', label: 'Nico drives — you shoot. Protect the car!', failText: 'The car died on the coast road.', routeTo: L.hideout },
    ],
  },
  {
    id: 'bad-advertisement', title: 'BAD ADVERTISEMENT', giver: 'Mama Rosa', giverAt: L.cafe, reward: 600,
    brief: 'The Verano club chain is muscling Rosa\'s beach out of business. Answer in kind: $25,000 of their property, rearranged.',
    intro: [
      { who: 'MAMA ROSA', text: 'Their umbrellas. Their signs. Their pretty little club strip. Make it… less pretty.' },
      { who: 'RINA', text: 'Subtle, Rosa.' },
      { who: 'MAMA ROSA', text: 'Subtle is for people who don\'t owe Sal.' },
    ],
    outro: 'Voss, on the police band: "Vale — I am done being patient."',
    stages: [
      { type: 'damage', amount: 25000, timer: 240, label: 'Wreck the Verano strip: umbrellas, signs, anything with their name on it', failText: 'The Verano strip survived the night.' },
      { type: 'escape', label: 'Now lose the heat', failText: 'Voss made good on her promise.' },
    ],
  },
  {
    id: 'low-tide-run', title: 'LOW TIDE RUN', giver: 'Old Man Herrera', giverAt: L.pier, reward: 700, unlock: 'boat',
    brief: 'Move the real chip to the lighthouse vault by water at dawn. Four marker buoys, one harbour patrol that disagrees.',
    chapter: { title: 'ACT 3', sub: 'OUT ALIVE' },
    intro: [
      { who: 'HERRERA', text: 'The chip sleeps safer in my vault than in your glovebox. My boat knows the shallows.' },
      { who: 'NICO', text: 'She handles like a bathtub with opinions. Be kind to her.' },
    ],
    outro: 'Herrera: "One more tide, and we settle every account in this city."',
    stages: [
      { type: 'go', at: { x: 30, z: 246 }, r: 8, needFoot: true, label: 'Board Herrera\'s boat at the pier (E at the dock)' },
      {
        type: 'boatPackages', timer: 210, label: 'Collect the floating packages', failText: 'The tide took the packages — and the chip\'s escort.',
        points: [{ x: -120, z: 264 }, { x: -30, z: 280 }, { x: 70, z: 268 }, { x: 150, z: 284 }],
      },
      { type: 'boatGo', at: { x: 38, z: 262 }, r: 10, label: 'Bring the boat back to the pier dock', failText: 'The harbour kept the boat.' },
    ],
  },
  {
    id: 'evening-tides', title: 'THE EVENING TIDES', giver: 'Old Man Herrera', giverAt: L.hideout, reward: 5000,
    brief: 'Plant the decoy, let Voss arrest Dario, rob the cash boat, survive 5 stars, sail out. The last job. For real this time.',
    intro: [
      { who: 'HERRERA', text: 'Dario sells the decoy to Voss at the marina. While she arrests him, the Ledger\'s cash boat docks rich and stupid.' },
      { who: 'NICO', text: 'Then I drive, you shoot, and we do not stop for anything with a siren.' },
      { who: 'RINA', text: 'Out alive. Together. That\'s the whole plan.' },
    ],
    outro: 'Debt paid in full. The chip, mailed to a mainland newspaper. Two drivers, one horizon.',
    stages: [
      { type: 'channel', at: { x: -100, z: 190 }, r: 5, seconds: 3, needFoot: true, label: 'Plant the decoy chip at Dario\'s meet point', failText: 'The decoy was never planted.' },
      { type: 'boatGo', at: { x: 70, z: 274 }, r: 11, label: 'Hit the Ledger cash boat — pull alongside and take the vault case', failText: 'The cash boat slipped its mooring.' },
      { type: 'boatGo', at: { x: 38, z: 262 }, r: 10, label: 'Dock the boat — the getaway car waits at the pier', failText: 'The harbour kept the boat.' },
      { type: 'shooter', label: 'FIVE STARS — Nico drives, you shoot. Survive to the lighthouse!', failText: 'Voss closed the road at the lighthouse.', routeTo: L.hideout, heat: 5 },
      { type: 'go', at: { x: 30, z: 246 }, r: 9, label: 'Back to the pier — Herrera\'s boat is fuelled', failText: 'The tide turned without you.' },
      { type: 'boatGo', at: { x: 0, z: 322 }, r: 14, sunset: true, label: 'Sail out. Do not look back', failText: 'So close to the horizon.' },
    ],
  },
];

export class MissionSystem {
  constructor(scene) {
    this.scene = scene;
    this.active = null;
    this.pendingEvents = [];
    const beaconMat = basicMat(scene, { color: 0xffc93e, opacity: 0.30, depthWrite: false, backFace: true });
    this.beacon = BABYLON.MeshBuilder.CreateCylinder(uid('beacon'), { diameterTop: 6.4, diameterBottom: 6.4, height: 46, tessellation: 18 }, scene);
    this.beacon.material = beaconMat;
    this.beacon.isPickable = false;
    this.beacon.position.y = 23;
    this.beacon.isVisible = false;
    this.ring = BABYLON.MeshBuilder.CreateTorus(uid('ring'), { diameter: 6.4, thickness: 0.44, tessellation: 28 }, scene);
    this.ring.material = basicMat(scene, { color: 0xffc93e });
    this.ring.isPickable = false;
    this.ring.rotation.x = Math.PI / 2;
    this.ring.position.y = 0.4;
    this.ring.isVisible = false;
    // cyan marker for side activities (taxi / debt)
    this.sideBeacon = BABYLON.MeshBuilder.CreateCylinder(uid('beacon'), { diameterTop: 4.4, diameterBottom: 4.4, height: 30, tessellation: 14 }, scene);
    this.sideBeacon.material = basicMat(scene, { color: 0x3ec6d8, opacity: 0.30, depthWrite: false, backFace: true });
    this.sideBeacon.isPickable = false;
    this.sideBeacon.position.y = 15;
    this.sideBeacon.isVisible = false;
    this.cases = [];
    this.caseTimer = 4;
    this.ents = [];                 // stage entities to clean up
    this.stashMeshes = [];
    this.buildStashes();
    this.taxi = { phase: 'idle', t: 18, ped: null, at: null, trip: 0, dmg: 0, lastHealth: 100, time: 0 };
    this.debt = { phase: 'idle', t: 25, ped: null, at: null, prog: 0 };
  }

  currentDef() { return MISSION_DEFS[G.missionIndex] || null; }
  offering() { return !this.active && !G.storyDone && this.currentDef() !== null; }
  offerPoint() { const d = this.currentDef(); return d ? d.giverAt : L.cafe; }
  sunsetActive() { return !!(this.active && this.active.def.stages[this.active.stageIndex].sunset); }

  // ------------------------------------------------------------ lifecycle
  startNext(fx) {
    const def = this.currentDef();
    if (!def || this.active) return false;
    if (def.unlock === 'partner') G.partnerUnlocked = true;   // Nico joins for the job itself
    if (def.unlock === 'boat') G.boatUnlocked = true;
    this.active = { def, stageIndex: 0, timeLeft: null, stageStartResprays: G.resprayCount, calmTimer: 0, data: {} };
    if (def.chapter) this.pendingEvents.push({ type: 'chapter', title: def.chapter.title, sub: def.chapter.sub + ' — ' + def.title });
    if (def.intro) this.pendingEvents.push({ type: 'dialogue', lines: def.intro });
    this.enterStage(fx);
    if (fx) fx.success();
    return true;
  }

  enterStage(fx) {
    const a = this.active;
    const stage = a.def.stages[a.stageIndex];
    a.timeLeft = stage.timer || null;
    a.calmTimer = 0;
    a.stageStartResprays = G.resprayCount;
    a.data = {};
    const d = a.data;
    if (stage.heat) commitCrime(stage.heat * 100, stage.heat >= 5 ? 'VOSS: "All units — Vale is mine."' : '', true);   // stage.heat is in stars
    if (stage.lines) this.pendingEvents.push({ type: 'dialogue', lines: stage.lines });
    if (stage.type === 'checkpoints') {
      const p0 = stage.points[0];
      d.ci = 0;
      d.rivalCi = 0;
      const rival = new Vehicle(this.scene, 0x9d4edd, p0.x - 6, p0.z - 6, Math.PI / 2, { style: 'coupe' });
      rival.maxSpeed = 13.5;
      d.rival = rival;
      this.ents.push({ kind: 'car', obj: rival });
    }
    if (stage.type === 'tail') {
      const car = new Vehicle(this.scene, 0x8a8f98, stage.spawn.x, stage.spawn.z, Math.PI, { style: 'sedan' });
      car.maxSpeed = 12;
      d.target = car;
      this.ents.push({ kind: 'car', obj: car });
      // expand the route along the street grid so the target drives legally
      d.route = [];
      let prev = { x: stage.spawn.x, z: stage.spawn.z };
      for (const wp of stage.route) {
        const seg = gpsRoute(prev.x, prev.z, wp.x, wp.z);
        for (const p of seg.slice(1)) d.route.push(p);
        prev = wp;
      }
      d.wi = 0; d.spook = 0; d.lost = 0; d.parked = false;
    }
    if (stage.type === 'bags') {
      d.bags = stage.points.map((p) => {
        const mesh = this.makeBagMesh(p.x, p.z);
        return { ...p, taken: false, mesh, channel: 0 };
      });
      d.alarmed = false;
      for (const b of d.bags) this.ents.push({ kind: 'mesh', obj: b.mesh });
    }
    if (stage.type === 'escort') {
      const vera = makePersonMesh(this.scene, 0x5b2a86, 0xe8b98d, { pants: 0x1a1a22 });
      vera.position.set(L.marina.x + 3, 0, L.marina.z - 3);
      d.vera = vera;
      d.panic = 0; d.wave = 0; d.waveT = 7; d.lastHealth = 100;
      this.ents.push({ kind: 'mesh', obj: vera });
    }
    if (stage.type === 'shooter') {
      d.armed = false; d.outT = 0; d.spawnT = 4; d.spawned = 0;
    }
    if (stage.type === 'damage') {
      resetSmashables();
      d.total = 0; d.lastHealth = null; d.milestone = 0;
    }
    if (stage.type === 'boatPackages') {
      d.pkgs = stage.points.map((p) => {
        const mesh = this.makePackageMesh(p.x, p.z);
        return { ...p, taken: false, mesh };
      });
      d.cop = null;
      for (const p of d.pkgs) this.ents.push({ kind: 'mesh', obj: p.mesh });
    }
    if (stage.type === 'channel') d.prog = 0;
  }

  stageTarget() {
    const a = this.active;
    if (!a) return null;
    const stage = a.def.stages[a.stageIndex];
    const d = a.data;
    switch (stage.type) {
      case 'checkpoints': return stage.points[d.ci || 0];
      case 'steal': return G.missionCar ? { x: G.missionCar.x, z: G.missionCar.z } : L.marina;
      case 'tail': return d.target ? { x: d.target.x, z: d.target.z } : stage.route[0];
      case 'bags': { const b = (d.bags || []).find(b2 => !b2.taken); return b || L.pier; }
      case 'boatPackages': { const p = (d.pkgs || []).find(p2 => !p2.taken); return p || { x: 38, z: 262 }; }
      case 'respray': return L.respray;
      case 'shooter': return stage.routeTo;
      case 'damage': return { x: 0, z: 203 };
      case 'escape': return null;
      default: return stage.at || null;
    }
  }
  sideTarget() {
    if (this.taxi.phase === 'pickup' || this.taxi.phase === 'drop') return this.taxi.at;
    if (this.debt.phase === 'go' || this.debt.phase === 'hold') return this.debt.at;
    return null;
  }

  // ------------------------------------------------------------ main loop
  update(dt, player, fx, events) {
    for (const ev of this.pendingEvents) events.push(ev);
    this.pendingEvents = [];
    const showAt = this.active ? this.stageTarget() : (this.offering() ? this.offerPoint() : this.sideTarget());
    if (showAt) {
      const side = !this.active && !this.offering();
      const b = side ? this.sideBeacon : this.beacon;
      const other = side ? this.beacon : this.sideBeacon;
      other.isVisible = false;
      b.isVisible = true;
      b.position.x = showAt.x; b.position.z = showAt.z;
      if (!side) {
        this.ring.isVisible = true;
        this.ring.position.x = showAt.x; this.ring.position.z = showAt.z;
        const rs = 1 + Math.sin(G.time * 3) * 0.08;
        this.ring.scaling.set(rs, rs, rs);
      } else this.ring.isVisible = false;
    } else {
      this.beacon.isVisible = false; this.ring.isVisible = false; this.sideBeacon.isVisible = false;
    }

    this.updateCases(dt, player, fx);
    this.updateStashes(player, fx, events);
    if (!this.active) {
      if (this.offering() && dist2d(player.x, player.z, this.offerPoint().x, this.offerPoint().z) < 8) {
        events.push({ type: 'offer', def: this.currentDef() });
      }
      this.updateSide(dt, player, fx, events);
      return;
    }
    const a = this.active;
    const stage = a.def.stages[a.stageIndex];
    if (a.timeLeft !== null) {
      a.timeLeft -= dt;
      if (a.timeLeft <= 0) { this.fail(fx, events, stage.failText || 'Out of time.'); return; }
    }
    this.updateStage(dt, player, fx, events, stage);
  }

  updateStage(dt, player, fx, events, stage) {
    const a = this.active;
    const d = a.data;
    const colliders = G.colliders || [];
    switch (stage.type) {
      case 'go': {
        if (stage.needCar && !player.car) return;
        if (stage.needFoot && player.car) return;
        if (dist2d(player.x, player.z, stage.at.x, stage.at.z) < (stage.r || 7)) this.advance(fx, events);
        return;
      }
      case 'channel': {
        if (stage.needFoot && player.car) { d.prog = Math.max(0, d.prog - dt); return; }
        if (dist2d(player.x, player.z, stage.at.x, stage.at.z) < (stage.r || 5)) {
          d.prog += dt;
          if (d.prog >= stage.seconds) { this.advance(fx, events); return; }
        } else d.prog = Math.max(0, d.prog - dt * 1.5);
        return;
      }
      case 'checkpoints': {
        const rival = d.rival;
        if (rival && !rival.dead) {
          const rp = stage.points[d.rivalCi];
          if (rp) {
            driveToward(rival, dt, rp.x, rp.z, colliders, 0.85);
            if (dist2d(rival.x, rival.z, rp.x, rp.z) < 10) {
              d.rivalCi++;
              if (d.rivalCi >= stage.points.length) { this.fail(fx, events, stage.failText); return; }
            }
          }
        }
        if (!player.car) return;
        const p = stage.points[d.ci];
        if (p && dist2d(player.x, player.z, p.x, p.z) < 9) {
          d.ci++;
          if (fx) fx.pickup();
          events.push({ type: 'toast', text: `CHECKPOINT ${d.ci}/${stage.points.length}` });
          if (d.ci >= stage.points.length) this.advance(fx, events);
        }
        return;
      }
      case 'steal': {
        const car = G.missionCar;
        if (!car) return;
        if (car.dead) { this.fail(fx, events, stage.failText); return; }
        if (player.car === car) {
          commitCrime(100, 'Coupe stolen!', G.filmingWitnesses > 0);
          this.advance(fx, events);
        }
        return;
      }
      case 'deliverCar': {
        const car = G.missionCar;
        if (!car || car.dead) { this.fail(fx, events, stage.failText); return; }
        if (player.car === car && dist2d(player.x, player.z, stage.at.x, stage.at.z) < (stage.r || 10)) {
          a.bonus = Math.round(car.health * 2);
          this.advance(fx, events);
        }
        return;
      }
      case 'escape': {
        if (G.wanted === 0) {
          a.calmTimer += dt;
          if (a.calmTimer > 1.5) this.advance(fx, events);
        } else a.calmTimer = 0;
        return;
      }
      case 'respray': {
        if (G.resprayCount > a.stageStartResprays) this.advance(fx, events);
        return;
      }
      case 'tail': {
        const t = d.target;
        if (!t) return;
        if (!d.parked) {
          const wp = d.route[d.wi];
          if (wp) {
            driveToward(t, dt, wp.x, wp.z, colliders, 0.55);
            if (dist2d(t.x, t.z, wp.x, wp.z) < 9) {
              d.wi++;
              if (d.wi >= d.route.length) d.parked = true;
            }
          } else d.parked = true;
        } else t.drive(dt, 0, 0, colliders, {});
        const dist = dist2d(player.x, player.z, t.x, t.z);
        if (dist < 22) d.spook += dt * 26;
        else if (dist > 58) d.spook -= dt * 9;
        else d.spook -= dt * 4;
        d.spook = clamp(d.spook, 0, 100);
        if (d.spook >= 100) { this.fail(fx, events, stage.failText); return; }
        if (dist > 135) { d.lost += dt; if (d.lost > 8) { this.fail(fx, events, 'You lost the tail.'); return; } }
        else d.lost = 0;
        if (d.parked) this.advance(fx, events);
        return;
      }
      case 'bags': {
        const bag = d.bags.find(b => !b.taken);
        if (!bag) { this.advance(fx, events); return; }
        if (dist2d(player.x, player.z, bag.x, bag.z) < 2.9) {
          bag.channel += dt;
          bag.mesh.position.y = Math.sin(G.time * 6) * 0.1;
          if (bag.channel >= 2) {
            bag.taken = true;
            setShown(bag.mesh, false);
            if (fx) fx.pickup();
            if (!d.alarmed) {
              d.alarmed = true;
              commitCrime(300, 'Marina alarm tripped!', true);
              events.push({ type: 'toast', text: 'ALARM TRIPPED — GRAB AND GO' });
            }
            events.push({ type: 'toast', text: `CASH BAG ${d.bags.filter(b => b.taken).length}/3` });
            if (d.bags.every(b => b.taken)) this.advance(fx, events);
          }
        } else bag.channel = Math.max(0, bag.channel - dt);
        return;
      }
      case 'escort': {
        const car = player.car;
        if (d.vera) {
          if (car) {
            const h = car.heading;
            d.vera.position.set(car.x - 0.38 * Math.cos(h) + 0.1 * Math.sin(h), 0.52, car.z + 0.38 * Math.sin(h) + 0.1 * Math.cos(h));
            d.vera.rotation.y = h;
            seatPose(d.vera);
          } else {
            d.vera.position.set(L.marina.x + 3, 0, L.marina.z - 3);
          }
        }
        this.updateRivals(dt, player, colliders);
        if (car) {
          const drop = (d.lastHealth ?? 100) - car.health;
          if (drop > 0) d.panic = clamp(d.panic + drop * 1.1, 0, 100);
          d.lastHealth = car.health;
          d.panic = Math.max(0, d.panic - dt * 2.2);
          if (car.dead) { this.fail(fx, events, stage.failText); return; }
          if (d.panic >= 100) { this.fail(fx, events, 'Vera bailed at a red light — the cargo was lost.'); return; }
          d.waveT -= dt;
          if (d.waveT <= 0 && d.wave < 3) {
            d.wave++; d.waveT = 26;
            this.spawnRival(player, events, `SYNDICATE CAR — WAVE ${d.wave}`);
          }
          if (dist2d(player.x, player.z, stage.at.x, stage.at.z) < (stage.r || 11)) this.advance(fx, events);
        }
        return;
      }
      case 'shooter': {
        if (!d.armed) {
          if (player.car) {
            G.aiDriver = { car: player.car, route: gpsRoute(player.car.x, player.car.z, stage.routeTo.x, stage.routeTo.z), i: 0, done: false };
            d.armed = true;
            events.push({ type: 'toast', text: 'NICO HAS THE WHEEL — SHOOT!' });
          }
          return;
        }
        this.updateRivals(dt, player, colliders);
        d.spawnT -= dt;
        if (d.spawnT <= 0 && d.spawned < 2) {
          d.spawned++; d.spawnT = 16;
          this.spawnRival(player, events, 'PURSUERS INBOUND');
        }
        if (!player.car) {
          d.outT += dt;
          if (d.outT > 4) { this.fail(fx, events, 'You bailed on Nico.'); return; }
        } else {
          d.outT = 0;
          if (player.car.dead) { this.fail(fx, events, stage.failText); return; }
        }
        if (G.aiDriver && G.aiDriver.done) this.advance(fx, events);
        return;
      }
      case 'damage': {
        const car = player.car;
        if (car) {
          for (const s of SMASHABLES) {
            if (s.smashed) continue;
            if (dist2d(car.x, car.z, s.x, s.z) < 3.1 && Math.abs(car.speed) > 3) {
              s.smashed = true;
              s.mesh.rotation.z = 1.3;
              s.mesh.position.y = -0.4;
              d.total += s.value;
              commitCrime(30, '', G.filmingWitnesses > 0);
              if (fx) fx.crash();
              if (d.total - d.milestone >= 5000) {
                d.milestone = d.total;
                events.push({ type: 'toast', text: `DAMAGE $${Math.floor(d.total).toLocaleString('en-US')} / $25,000` });
              }
            }
          }
          if (d.lastHealth !== null && d.lastHealth !== undefined) {
            const drop = d.lastHealth - car.health;
            if (drop > 0) d.total += drop * 95;
          }
          d.lastHealth = car.health;
          if (d.total >= stage.amount) { this.advance(fx, events); return; }
        }
        return;
      }
      case 'boatPackages': {
        const boat = G.playerBoat;
        for (const p of d.pkgs) {
          if (p.taken) continue;
          p.mesh.position.y = 0.1 + Math.sin(G.time * 1.8 + p.x) * 0.15;
          p.mesh.rotation.y += dt * 0.8;
          if (player.boat && boat && dist2d(boat.x, boat.z, p.x, p.z) < 6.5) {
            p.taken = true;
            setShown(p.mesh, false);
            if (fx) fx.pickup();
            events.push({ type: 'toast', text: `PACKAGE ${d.pkgs.filter(q => q.taken).length}/${d.pkgs.length}` });
            if (!d.cop) {
              d.cop = new Boat(this.scene, 130, 305, Math.PI, { police: true, maxSpeed: 15 });
              this.ents.push({ kind: 'boat', obj: d.cop });
              events.push({ type: 'toast', text: 'HARBOUR PATROL — IT IS COMING FOR YOU' });
            }
            if (d.pkgs.every(q => q.taken)) { this.advance(fx, events); return; }
          }
        }
        if (d.cop && player.boat && boat) {
          const cop = d.cop;
          const desired = Math.atan2(boat.x - cop.x, boat.z - cop.z);
          const diff = wrapAngle(desired - cop.heading);
          cop.drive(dt, Math.abs(diff) > 2.2 ? -0.4 : 0.95, clamp(-diff * 1.3, -0.8, 0.8));
          if (dist2d(cop.x, cop.z, boat.x, boat.z) < 4.6) {
            boat.health -= 11 * dt;
            if (boat.health <= 0) { boat.dead = true; this.fail(fx, events, 'The patrol wrecked Herrera\'s boat.'); return; }
          }
        }
        if (player.boat && boat && boat.dead) { this.fail(fx, events, 'The boat was wrecked.'); return; }
        return;
      }
      case 'boatGo': {
        const boat = G.playerBoat;
        if (player.boat && boat && dist2d(boat.x, boat.z, stage.at.x, stage.at.z) < (stage.r || 10)) {
          this.advance(fx, events);
        }
        return;
      }
    }
  }

  // ------------------------------------------------------------ rivals
  spawnRival(player, events, note) {
    const ang = Math.random() * Math.PI * 2;
    const x = clamp(player.x + Math.sin(ang) * 58, -195, 195);
    const z = clamp(player.z + Math.cos(ang) * 58, -195, 195);
    const car = new Vehicle(this.scene, 0x23262e, x, z, ang, { style: 'sedan' });
    car.maxSpeed = 27;
    G.rivalCars.push(car);
    this.ents.push({ kind: 'car', obj: car });
    if (note) events.push({ type: 'toast', text: note });
    return car;
  }
  updateRivals(dt, player, colliders) {
    for (const car of G.rivalCars) {
      if (car.dead || car.health <= 0) continue;
      driveToward(car, dt, player.x, player.z, colliders, 1);
    }
  }

  // ------------------------------------------------------------ flow
  advance(fx, events) {
    const a = this.active;
    this.cleanupEnts(true);
    a.stageIndex++;
    if (a.stageIndex >= a.def.stages.length) { this.complete(fx, events); return; }
    this.enterStage(fx);
    events.push({ type: 'stage', def: a.def, stage: a.def.stages[a.stageIndex] });
    if (fx) fx.pickup();
  }

  complete(fx, events) {
    const a = this.active;
    const def = a.def;
    const total = def.reward + (a.bonus || 0);
    G.money += total;
    G.totalEarned += total;
    if (def.unlock === 'gun' && !G.hasGun) {
      // the Beach Sprint pistol comes with a finite starting reserve:
      // a full magazine in the gun plus 48 rounds — never unlimited
      G.hasGun = true; G.ammoMag = G.magSize; G.ammoReserve = 48; G.reloading = 0;
      events.push({ type: 'gun' });
    }
    if (def.id === 'the-easy-one') G.resprayDiscount = true;
    if (def.id === 'evening-tides') {
      G.storyDone = true;
      G.campaignDone = true;
      events.push({
        type: 'endcard',
        html: `Debt paid in full — Sal gets his envelope, Voss gets Dario, and a mainland newspaper gets the chip.<br><br>` +
          `Cash earned: $${G.totalEarned.toLocaleString('en-US')} · Cars stolen: ${G.carsStolen} · Resprays: ${G.resprayCount}<br>` +
          `Busted: ${G.timesBusted} · Wasted: ${G.timesWasted} · Hidden stashes: ${G.stashesFound}/10<br><br>` +
          `<i>"Out alive. Together."</i><br>Thanks for playing.`,
      });
      events.push({ type: 'story-done' });
    }
    G.missionIndex++;
    this.active = null;
    G.aiDriver = null;
    saveGame();
    if (fx) fx.success();
    events.push({ type: 'complete', def, paid: total });
  }

  fail(fx, events, reason) {
    if (!this.active) return;
    const def = this.active.def;
    this.cleanupEnts(false);
    this.active = null;
    G.aiDriver = null;
    if (fx) fx.fail();
    events.push({ type: 'failed', def, reason: reason || 'The job fell apart.' });
  }

  cleanupEnts(stageOnly) {
    for (const e of this.ents) {
      if (e.kind === 'car') {
        const i = G.rivalCars.indexOf(e.obj);
        if (i >= 0) G.rivalCars.splice(i, 1);
        if (e.obj.dispose) e.obj.dispose(); else removeNode(e.obj.mesh);
      } else if (e.kind === 'boat') {
        removeNode(e.obj.mesh);
      } else {
        removeNode(e.obj);
      }
    }
    this.ents = [];
  }

  resetCampaign() {
    this.cleanupEnts(false);
    this.active = null;
    G.aiDriver = null;
    this.taxi.phase = 'idle'; this.taxi.t = 18;
    this.debt.phase = 'idle'; this.debt.t = 25;
    this.restoreStashes();
  }
  restoreStashes() {
    for (let i = 0; i < this.stashMeshes.length; i++) {
      setShown(this.stashMeshes[i], !G.stashTaken.includes(i));
    }
  }

  // ------------------------------------------------------------ meshes
  makeBagMesh(x, z) {
    const grp = groupNode(this.scene);
    const bag = boxMesh(this.scene, 0.9, 0.6, 0.6, pbrMat(this.scene, { color: 0x1f6f43, roughness: 0.7 }));
    bag.position.y = 0.5;
    markShadow(bag, true, false);
    bag.parent = grp;
    const glow = sphereMesh(this.scene, 0.52, 8, basicMat(this.scene, { color: 0x7dff9a }));
    glow.position.y = 1.1;
    glow.parent = grp;
    grp.position.set(x, 0, z);
    return grp;
  }
  makePackageMesh(x, z) {
    const grp = groupNode(this.scene);
    const crate = boxMesh(this.scene, 1.3, 0.8, 1.3, pbrMat(this.scene, { color: 0xd88f2c, roughness: 0.6 }));
    markShadow(crate, true, false);
    crate.parent = grp;
    const buoy = sphereMesh(this.scene, 0.68, 8, basicMat(this.scene, { color: 0xff4545 }));
    buoy.position.y = 0.85;
    buoy.parent = grp;
    grp.position.set(x, 0.1, z);
    return grp;
  }
  buildStashes() {
    for (const s of STASH_SPOTS) {
      const grp = groupNode(this.scene);
      const box = boxMesh(this.scene, 0.9, 0.45, 0.65, pbrMat(this.scene, { color: 0xc9a227, roughness: 0.35, metalness: 0.5 }));
      box.position.y = 0.4;
      markShadow(box, true, false);
      box.parent = grp;
      const glow = sphereMesh(this.scene, 0.44, 8, basicMat(this.scene, { color: 0xffd23e }));
      glow.position.y = 0.95;
      glow.parent = grp;
      grp.position.set(s.x, 0, s.z);
      this.stashMeshes.push(grp);
    }
  }
  updateStashes(player, fx, events) {
    if (player.car || player.boat) return;
    for (let i = 0; i < STASH_SPOTS.length; i++) {
      if (G.stashTaken.includes(i)) continue;
      const s = STASH_SPOTS[i];
      if (dist2d(player.x, player.z, s.x, s.z) < 2.5) {
        G.stashTaken.push(i);
        G.stashesFound++;
        G.money += 175;
        G.totalEarned += 175;   // round 5: career cash-earned hook
        setShown(this.stashMeshes[i], false);
        if (fx) fx.pickup();
        events.push({ type: 'toast', text: `HIDDEN STASH ${G.stashesFound}/10 · +$175` });
        saveGame();
      }
    }
  }

  // ------------------------------------------------------------ ambient cash cases (free-roam flavour, kept from v2)
  spawnCase(x, z, missionCase) {
    const grp = groupNode(this.scene);
    const box = boxMesh(this.scene, 1.1, 0.5, 0.8, pbrMat(this.scene, { color: 0x1f6f43, roughness: 0.6 }));
    box.position.y = 0.5;
    markShadow(box, true, false);
    box.parent = grp;
    const glow = sphereMesh(this.scene, 0.64, 8, basicMat(this.scene, { color: 0x7dff9a }));
    glow.position.y = 1.15;
    glow.parent = grp;
    grp.position.set(x, 0, z);
    this.cases.push({ mesh: grp, x, z, spin: Math.random() * 6 });
  }
  updateCases(dt, player, fx) {
    this.caseTimer -= dt;
    if (this.caseTimer <= 0) {
      this.caseTimer = 14;
      if (this.cases.length < 4) {
        this.spawnCase((Math.random() - 0.5) * 360, (Math.random() - 0.5) * 360, false);
      }
    }
    for (let i = this.cases.length - 1; i >= 0; i--) {
      const c = this.cases[i];
      c.spin += dt * 2;
      c.mesh.rotation.y = c.spin;
      c.mesh.position.y = Math.sin(c.spin * 1.4) * 0.12;
      if (dist2d(player.x, player.z, c.x, c.z) < 3.2) {
        removeNode(c.mesh);
        this.cases.splice(i, 1);
        if (fx) fx.pickup();
        G.money += 25;
        G.totalEarned += 25;   // round 5: career cash-earned hook
      }
    }
  }

  // ------------------------------------------------------------ side activities
  updateSide(dt, player, fx, events) {
    this.updateTaxi(dt, player, fx, events);
    this.updateDebt(dt, player, fx, events);
  }
  spawnSidePed(x, z, shirt) {
    const ped = makePersonMesh(this.scene, shirt, 0xc98d5a, {});
    ped.position.set(x, 0, z);
    return ped;
  }
  updateTaxi(dt, player, fx, events) {
    const t = this.taxi;
    if (t.phase === 'idle') {
      t.t -= dt;
      if (t.t <= 0 && player.car && G.wanted === 0 && !G.aiDriver) {
        const laneX = clamp(Math.round((player.x + 40) / 80) * 80 - 40 + 7.6, -195, 195);
        t.at = { x: laneX, z: clamp(player.z + (Math.random() > 0.5 ? 55 : -55), -190, 190) };
        t.ped = this.spawnSidePed(t.at.x + 2, t.at.z, 0xffd23e);
        t.phase = 'pickup';
        t.time = 0;
        events.push({ type: 'toast', text: 'TAXI! A fare is waiting — stop for them' });
      }
      return;
    }
    t.time += dt;
    if (t.time > 150 || !player.car) { this.endTaxi(events, false); return; }
    if (t.phase === 'pickup') {
      if (dist2d(player.x, player.z, t.at.x, t.at.z) < 6.5 && Math.abs(player.car.speed) < 1.6) {
        setShown(t.ped, false);
        const spots = [L.pier, L.marina, L.hospital, L.garage, L.hideout, L.raceStart];
        const dest = spots[Math.floor(Math.random() * spots.length)];
        t.trip = dist2d(player.x, player.z, dest.x, dest.z);
        t.at = { x: dest.x, z: dest.z };
        t.dmg = 0;
        t.lastHealth = player.car.health;
        t.phase = 'drop';
        events.push({ type: 'toast', text: 'FARE ABOARD — drive to the cyan marker' });
      }
      return;
    }
    // drop
    const drop = t.lastHealth - player.car.health;
    if (drop > 0) { t.dmg += drop; t.lastHealth = player.car.health; }
    if (dist2d(player.x, player.z, t.at.x, t.at.z) < 9 && Math.abs(player.car.speed) < 2) {
      const fare = Math.round(45 + t.trip * 0.4);
      const tip = t.dmg < 4 ? Math.round(fare * 0.5) : t.dmg < 15 ? Math.round(fare * 0.15) : 0;
      G.money += fare + tip;
      G.totalEarned += fare + tip;
      if (fx) fx.success();
      events.push({ type: 'toast', text: `FARE $${fare}${tip ? ' + TIP $' + tip : ''} — ${t.dmg < 4 ? 'smooth ride!' : 'they felt every bump.'}` });
      this.endTaxi(events, true);
    }
  }
  endTaxi(events, done) {
    const t = this.taxi;
    if (t.ped) { removeNode(t.ped); t.ped = null; }
    t.phase = 'idle';
    t.t = done ? 40 : 25;
  }
  updateDebt(dt, player, fx, events) {
    const d = this.debt;
    if (d.phase === 'idle') {
      d.t -= dt;
      const def = this.currentDef();
      const rosaBusy = def && def.giverAt === L.cafe;
      if (d.t <= 0 && G.missionIndex >= 1 && !rosaBusy && dist2d(player.x, player.z, L.cafe.x, L.cafe.z) < 7) {
        const ang = Math.random() * Math.PI * 2;
        d.at = { x: clamp(player.x + Math.sin(ang) * 165, -190, 190), z: clamp(player.z + Math.cos(ang) * 165, -190, 190) };
        d.ped = this.spawnSidePed(d.at.x + 2, d.at.z, 0x8a8f98);
        d.phase = 'go';
        d.prog = 0;
        events.push({ type: 'dialogue', lines: [{ who: 'MAMA ROSA', text: 'A name on my list is late with money. Park close, look patient, collect.' }] });
        events.push({ type: 'toast', text: 'DEBT COLLECTION — cyan marker' });
      }
      return;
    }
    if (d.phase === 'go') {
      if (player.car && dist2d(player.x, player.z, d.at.x, d.at.z) < 8) d.phase = 'hold';
      return;
    }
    // hold: stay parked close and let the debtor sweat
    if (player.car && dist2d(player.x, player.z, d.at.x, d.at.z) < 9 && Math.abs(player.car.speed) < 1.2) {
      d.prog += dt;
      if (d.prog >= 3) {
        G.money += 130;
        G.totalEarned += 130;
        if (fx) fx.success();
        if (Math.random() < 0.3) commitCrime(100, 'The debtor shouted for the PD!', true);
        events.push({ type: 'toast', text: 'DEBT COLLECTED · +$130 for Rosa\'s book' });
        if (d.ped) { removeNode(d.ped); d.ped = null; }
        d.phase = 'idle';
        d.t = 75;
      }
    } else d.prog = Math.max(0, d.prog - dt);
  }

  // ------------------------------------------------------------ HUD
  hudState() {
    if (this.active) {
      const a = this.active;
      const stage = a.def.stages[a.stageIndex];
      const d = a.data;
      let text = stage.label;
      let meter = null;
      if (stage.type === 'checkpoints') text = `Checkpoint ${Math.min((d.ci || 0) + 1, stage.points.length)}/${stage.points.length} — beat Tito's pace car!`;
      if (stage.type === 'bags') text = `Grab the cash bags (${(d.bags || []).filter(b => b.taken).length}/3) — hold still at each bag`;
      if (stage.type === 'boatPackages') text = `Collect the floating packages (${(d.pkgs || []).filter(p => p.taken).length}/${(stage.points || []).length})`;
      if (stage.type === 'tail') {
        text = d.parked ? 'He parked up — close in, unseen' : (d.spook > 65 ? 'Too close — he is getting nervous!' : d.lost > 3 ? 'You are losing him — close the gap!' : stage.label);
        meter = { label: 'SPOOK', frac: (d.spook || 0) / 100 };
      }
      if (stage.type === 'escort') { text = stage.label; meter = { label: "VERA'S NERVES", frac: (d.panic || 0) / 100 }; }
      if (stage.type === 'damage') { text = `Damage caused: $${Math.floor(d.total || 0).toLocaleString('en-US')} / $${stage.amount.toLocaleString('en-US')}`; meter = { label: 'DAMAGE', frac: (d.total || 0) / stage.amount }; }
      if (stage.type === 'channel') { text = stage.label; meter = { label: 'PLANTING', frac: (d.prog || 0) / stage.seconds }; }
      if (stage.type === 'escape' && G.wanted > 0) {
        text = G.wantedState === 'searching'
          ? `They lost you — stay hidden, stars fall in ${Math.max(0, Math.ceil(G.searchTimer))}s…`
          : 'They can still see you! Break line of sight!';
      }
      if (stage.type === 'shooter' && !d.armed) text = 'Get in a car — Nico takes the wheel';
      return { title: a.def.title, text, timer: a.timeLeft, meter };
    }
    if (G.storyDone) {
      return { title: 'FREE ROAM', text: `The tide is yours. Stashes ${G.stashesFound}/10 · watch for taxi fares and Rosa's debt list.`, timer: null, meter: null };
    }
    const def = this.currentDef();
    if (def) {
      return { title: 'NEXT JOB: ' + def.title, text: `Meet ${def.giver} at ${def.giverAt.name} (gold beacon). ` + def.brief, timer: null, meter: null };
    }
    return { title: 'FREE ROAM', text: 'Explore Solmaris.', timer: null, meter: null };
  }
}
