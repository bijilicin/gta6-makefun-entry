// Solmaris Heat — street races module (round 4, authored in-session).
//
//   Harbor Sprint street races — three standing start markers, each
//   the gate to its own checkpoint course. Drive up, pay the entry
//   fee with G, and the grid forms: three rival drivers, a short
//   countdown, then a fight through large glowing checkpoint rings
//   shown one at a time, with a dedicated race panel calling your
//   position, checkpoint count, the clock, and the gap to the ring.
//
// Design notes, written for whoever maintains this next:
//
//   * This module owns no lights. The scene already runs at the
//     twelve-light shader ceiling, so every glow here is an unlit
//     billboard, an emissive mesh or a transparent column.
//   * Rival cars are ordinary Vehicle instances driven through the
//     same drive() call the player uses. They live in G.rivalCars
//     while a race runs — so the main loop's perception set and
//     anti-interpenetration pass treat them like mission rivals —
//     and are disposed and spliced out when the race resolves.
//   * Courses follow the street grid: checkpoints sit on avenues
//     and street lines and consecutive rings share an axis wherever
//     the course allows, so a rival steering at its next ring is
//     mostly driving down a real road. The Lighthouse Run's final
//     leg cuts the last corner, the way a street racer would.
//   * Persistence is plain G fields (racesWon, racesDone,
//     raceEarnings, raceBestTimes) folded into solmaris-save-v2 by
//     state.js; older saves load with clean defaults.
//   * Nothing here touches story missions, speeds, the ammo model,
//     the camera, lighting, police AI, traffic lights, characters,
//     Ledger Pages or taxi fares. A race cannot start while a story
//     job is active or the heat is on (the main loop's canOffer).

import { G, WORLD, clamp, dist2d, saveGame } from './state.js';
import {
  LANDMARKS, basicMat, pbrMat, boxMesh, sphereMesh, groupNode,
  removeNode, setShown, markShadow, uid, glowTexture, makeBillboard,
} from './world.js';
import { Vehicle } from './vehicles.js';

// ---------------------------------------------------------------------
// Tunables, kept together at the top for balancing.
// ---------------------------------------------------------------------

const RACE_START_RADIUS = 10;       // metres: close enough to be offered a race
const RACE_CHECKPOINT_RADIUS = 11;  // metres: driving through a ring counts
const RIVAL_CHECKPOINT_RADIUS = 10; // metres: a rival's ring is a touch stricter
const RACE_COUNTDOWN = 2.6;         // seconds of held grid before GO
const RACE_EXIT_GRACE = 6;          // seconds out of the car before a fail
const RACE_COOLDOWN = 20;           // seconds before the same grid reopens
const RACE_RIVALS = 3;              // rival drivers on every grid
const CHECKPOINT_COLUMN_H = 30;     // beacon column height (next ring only)
const START_COLUMN_H = 17;          // start-marker column height

// ---------------------------------------------------------------------
// Course definitions.
//
// A course is a start point (with the heading the grid forms on)
// and an ordered checkpoint list; the LAST checkpoint is the
// finish. Starts sit on road lanes — avenue coordinate plus the
// lane offset traffic uses — so rivals form up on real asphalt.
//
//   Harbor Sprint — a beach-and-harbour rectangle in the south-east.
//   Downtown Dash — a tight rectangle around the central blocks.
//   Lighthouse Run — a point-to-point haul to the Old Lighthouse.
//
// Fees, purses and timeouts are derived from the measured route
// length in buildRaceDefs() below (about eight metres of route per
// dollar of entry, a winner's purse of four fees, and a timeout a
// patient driver can beat but a dawdler cannot), so lengthening a
// course automatically reprices it.
// ---------------------------------------------------------------------

const COURSE_SHAPES = [
  {
    id: 'harbor-sprint',
    name: 'HARBOR SPRINT',
    tagline: 'Beach road west, harbour streets home',
    start: { x: 123.8, z: 200, heading: -Math.PI / 2 },
    checkpoints: [
      { x: 40, z: 200 }, { x: -40, z: 200 }, { x: -120, z: 200 },
      { x: -120, z: 120 }, { x: -40, z: 120 }, { x: 40, z: 120 },
      { x: 120, z: 120 }, { x: 120, z: 200 },
    ],
    rivalSpeeds: [20.5, 19, 17.5],
    rivalStyles: ['coupe', 'sedan', 'sedan'],
  },
  {
    id: 'downtown-dash',
    name: 'DOWNTOWN DASH',
    tagline: 'A tight rectangle around the central blocks',
    start: { x: 43.8, z: -40, heading: Math.PI },
    checkpoints: [
      { x: 40, z: -120 }, { x: 120, z: -120 }, { x: 120, z: -40 },
      { x: 120, z: 40 }, { x: 40, z: 40 }, { x: -40, z: 40 },
      { x: -40, z: -40 }, { x: 40, z: -40 },
    ],
    rivalSpeeds: [21, 19.5, 18],
    rivalStyles: ['sedan', 'coupe', 'sedan'],
  },
  {
    id: 'lighthouse-run',
    name: 'LIGHTHOUSE RUN',
    tagline: 'Clear across town to the Old Lighthouse',
    start: { x: 163.8, z: 120, heading: -Math.PI / 2 },
    checkpoints: [
      { x: 120, z: 120 }, { x: 120, z: 40 }, { x: 40, z: 40 },
      { x: 40, z: -40 }, { x: -40, z: -40 }, { x: -40, z: -120 },
      { x: -120, z: -120 }, { x: -168, z: -168 },
    ],
    rivalSpeeds: [22, 20.5, 19],
    rivalStyles: ['coupe', 'coupe', 'sedan'],
  },
];

// Rival identities. A race reads better when the three cars chasing
// the same rings have names the panel can call: the gap line names
// the car directly ahead of Rina, and the finish banner names the
// winner when it is not her. Colours match the cars the spawner
// builds, so a name, a colour and a driving style stay one person.
const RIVAL_DRIVERS = [
  { name: 'Vex Marlowe', color: 0x9d4edd, note: 'violet coupe, late braker' },
  { name: 'Sana Iqbal', color: 0x2a9d8f, note: 'lagoon sedan, metronome lines' },
  { name: 'Bruno Fenn', color: 0xe63946, note: 'crimson car, first-corner gambler' },
];

// The full route of a course as a point list, start first: the line
// the length is measured along, and the line a rival's progress is
// judged against when two cars share a checkpoint count.
function courseRoutePoints(shape) {
  const points = [{ x: shape.start.x, z: shape.start.z }];
  for (const cp of shape.checkpoints) points.push({ x: cp.x, z: cp.z });
  return points;
}

// Total driven length of a course, in metres, measured the honest
// way: leg by leg along the route points, start to finish.
function courseRouteLength(shape) {
  const points = courseRoutePoints(shape);
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += dist2d(points[i - 1].x, points[i - 1].z, points[i].x, points[i].z);
  }
  return total;
}

// Round a purse to the nearest five dollars.
function roundToFive(amount) {
  return Math.max(5, Math.round(amount / 5) * 5);
}

// Build the runtime race definitions from the course shapes: every
// number the game will quote the player — fee, prizes, timeout — is
// settled here, once, at boot, from the measured length.
function buildRaceDefs() {
  return COURSE_SHAPES.map((shape) => {
    const routeLength = courseRouteLength(shape);
    const entryFee = Math.max(40, Math.round(routeLength / 8));
    return {
      id: shape.id,
      name: shape.name,
      tagline: shape.tagline,
      start: shape.start,
      checkpoints: shape.checkpoints,
      rivalSpeeds: shape.rivalSpeeds,
      rivalStyles: shape.rivalStyles,
      routeLength,
      entryFee,
      // The purse: first place pays four fees back, second doubles
      // the money, third refunds the entry exactly, fourth is a
      // long walk home with a good story.
      prizes: [roundToFive(entryFee * 4), roundToFive(entryFee * 2), entryFee, 0],
      // A generous timeout: the route at a battered sedan's honest
      // cruise, nearly doubled, plus a flat allowance for the grid,
      // the corners and one mistake worth recovering from.
      timeoutSec: Math.round(routeLength / 8.5 * 1.9 + 25),
    };
  });
}

// ---------------------------------------------------------------------
// Small formatting helpers, shared by the race panel, the prompts
// and the finish banners.
// ---------------------------------------------------------------------

// A race clock with tenths: 1:23.4.
function formatRaceTime(totalSeconds) {
  const s = Math.max(0, totalSeconds);
  const minutes = Math.floor(s / 60);
  const rest = s - minutes * 60;
  const whole = Math.floor(rest);
  const tenth = Math.floor((rest - whole) * 10);
  return minutes + ':' + String(whole).padStart(2, '0') + '.' + tenth;
}

// A plain countdown clock with no tenths, for timeouts and cooldowns
// where a whole second is precision enough.
function formatClock(totalSeconds) {
  const s = Math.max(0, Math.ceil(totalSeconds));
  const minutes = Math.floor(s / 60);
  const rest = s % 60;
  return minutes + ':' + String(rest).padStart(2, '0');
}

function formatCash(amount) {
  return '$' + Math.round(amount).toLocaleString('en-US');
}

function formatMetres(metres) {
  if (metres >= 1000) return (metres / 1000).toFixed(2) + ' km';
  return Math.round(metres) + ' m';
}

// 1st, 2nd, 3rd, 4th — the placing words the banners use.
function ordinal(place) {
  if (place === 1) return '1st';
  if (place === 2) return '2nd';
  if (place === 3) return '3rd';
  return place + 'th';
}

function wrapAngleDelta(d) {
  let out = d % (Math.PI * 2);
  if (out > Math.PI) out -= Math.PI * 2;
  if (out < -Math.PI) out += Math.PI * 2;
  return out;
}

// ---------------------------------------------------------------------
// The race system itself.
// ---------------------------------------------------------------------

export class Races {
  constructor(scene, hud, fx) {
    this.scene = scene;
    this.hud = hud || null;
    this.fx = fx || null;

    // DOM handles for the dedicated race panel (optional: without
    // them the racing still runs on toasts and banners alone).
    this.panelEl = document.getElementById('racepanel');
    this.panelTitleEl = document.getElementById('racetitle');
    this.panelLineEl = document.getElementById('raceline');
    this.panelMetaEl = document.getElementById('racemeta');
    this.panelVisible = false;

    this.defs = buildRaceDefs();
    this.defsById = {};
    for (const def of this.defs) this.defsById[def.id] = def;

    // Standing start markers, one per course, built once at boot.
    this.markers = [];
    for (const def of this.defs) this.markers.push(this.buildStartMarker(def));

    // The single live checkpoint display: a ground ring, a tall soft
    // column and a floating marker sphere. Only one checkpoint is
    // ever shown at a time — the next one — so the meshes are built
    // once and simply moved from ring to ring as the race advances.
    const cpMeshes = this.buildCheckpointMeshes();
    this.cpColumn = cpMeshes.column;
    this.cpRing = cpMeshes.ring;
    this.cpOrb = cpMeshes.orb;
    this.setCheckpointShown(false);

    // Race state: a live race object carries everything one running
    // of a course needs and is discarded whole when it resolves.
    this.phase = 'idle';           // idle | countdown | racing
    this.race = null;
    this.cooldowns = {};           // race id -> seconds until its grid reopens
    this.canOffer = true;          // refreshed by the main loop each frame
    this.markerClock = 0;          // shared bob/pulse phase for the markers
  }

  // ---------------------------------------------------------------
  // Start markers — world furniture
  // ---------------------------------------------------------------

  // One standing start marker: a fat orange ground ring, a soft
  // translucent column so the grid reads from streets away, and a
  // floating flag icon inside a warm halo billboard — the Ledger
  // Pages' visual language. Nothing here emits light.
  buildStartMarker(def) {
    const scene = this.scene;
    const group = groupNode(scene);
    const orange = 0xff8c1a;

    const ring = BABYLON.MeshBuilder.CreateTorus(uid('raceStartRing'), {
      diameter: 7.6, thickness: 0.42, tessellation: 28,
    }, scene);
    ring.material = basicMat(scene, { color: orange });
    ring.isPickable = false;
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.35;
    ring.parent = group;

    const column = BABYLON.MeshBuilder.CreateCylinder(uid('raceStartColumn'), {
      diameterTop: 5.6, diameterBottom: 5.6, height: START_COLUMN_H, tessellation: 16,
    }, scene);
    column.material = basicMat(scene, {
      color: orange, opacity: 0.20, depthWrite: false, backFace: true,
    });
    column.isPickable = false;
    column.position.y = START_COLUMN_H / 2;
    column.parent = group;

    // The floating icon: pole, two flag panels (dark and light, the
    // chequer read at a glance), and the halo that carries the glow.
    const icon = groupNode(scene);
    const pole = boxMesh(scene, 0.09, 1.5, 0.09,
      pbrMat(scene, { color: 0x2b2f36, roughness: 0.5, metalness: 0.5 }));
    pole.position.y = 0.4;
    markShadow(pole, true, false);
    pole.parent = icon;
    const flagDark = boxMesh(scene, 0.85, 0.5, 0.05,
      pbrMat(scene, { color: 0x17191d, roughness: 0.6, metalness: 0.05 }));
    flagDark.position.set(0.46, 0.95, 0);
    flagDark.parent = icon;
    const flagLight = boxMesh(scene, 0.42, 0.5, 0.055,
      pbrMat(scene, {
        color: 0xf4f1e8, roughness: 0.6, metalness: 0.05,
        emissive: 0xff8c1a, emissiveIntensity: 0.25,
      }));
    flagLight.position.set(0.25, 0.95, 0);
    flagLight.parent = icon;
    const halo = makeBillboard(scene, glowTexture(scene), 2.6, 2.6,
      { color: orange, opacity: 0.5 });
    halo.position.y = 0.85;
    halo.parent = icon;
    icon.position.y = 2.1;
    icon.parent = group;

    group.position.set(def.start.x, 0, def.start.z);
    return { def, group, ring, column, icon, halo, phase: (this.markers.length * 1.37) % (Math.PI * 2) };
  }

  // The live checkpoint display, built once: a wide ground ring, a
  // column visible over rooftops, and a bobbing orb at its centre.
  buildCheckpointMeshes() {
    const scene = this.scene;
    const orange = 0xffa02a;
    const column = BABYLON.MeshBuilder.CreateCylinder(uid('raceCpColumn'), {
      diameterTop: 10.5, diameterBottom: 10.5, height: CHECKPOINT_COLUMN_H, tessellation: 18,
    }, scene);
    column.material = basicMat(scene, {
      color: orange, opacity: 0.26, depthWrite: false, backFace: true,
    });
    column.isPickable = false;
    column.position.y = CHECKPOINT_COLUMN_H / 2;
    const ring = BABYLON.MeshBuilder.CreateTorus(uid('raceCpRing'), {
      diameter: 11, thickness: 0.55, tessellation: 30,
    }, scene);
    ring.material = basicMat(scene, { color: orange });
    ring.isPickable = false;
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.4;
    const orb = sphereMesh(scene, 0.62, 10, basicMat(scene, { color: 0xffd23e }));
    orb.position.y = 3.1;
    return { column, ring, orb };
  }

  // Move the checkpoint display to a point, or park it out of sight.
  placeCheckpoint(point) {
    if (!point) { this.setCheckpointShown(false); return; }
    this.cpColumn.position.x = point.x;
    this.cpColumn.position.z = point.z;
    this.cpRing.position.x = point.x;
    this.cpRing.position.z = point.z;
    this.cpOrb.position.x = point.x;
    this.cpOrb.position.z = point.z;
    this.setCheckpointShown(true);
  }

  setCheckpointShown(shown) {
    setShown(this.cpColumn, shown);
    setShown(this.cpRing, shown);
    setShown(this.cpOrb, shown);
  }

  // ---------------------------------------------------------------
  // Offers — finding a grid, reading its terms, taking the start
  // ---------------------------------------------------------------

  // The nearest course whose start marker is within offer range of
  // the player, and how far it is. Start markers are the only doors
  // into racing; there is no menu entry and no map teleport.
  nearestStart(player) {
    if (!player) return null;
    let best = null;
    let bestDist = Infinity;
    for (const def of this.defs) {
      const d = dist2d(player.x, player.z, def.start.x, def.start.z);
      if (d < bestDist) { bestDist = d; best = def; }
    }
    return best && bestDist < RACE_START_RADIUS
      ? { def: best, distance: bestDist }
      : null;
  }

  cooldownLeft(def) {
    return Math.max(0, this.cooldowns[def.id] || 0);
  }

  bestTimeFor(def) {
    const table = (G.raceBestTimes && typeof G.raceBestTimes === 'object')
      ? G.raceBestTimes : {};
    const t = table[def.id];
    return (typeof t === 'number' && Number.isFinite(t) && t > 0) ? t : null;
  }

  // Why a start would be refused right now, as a short phrase, or
  // null when the grid can form. Every refusal path — prompt, G key,
  // direct start — reads through this one gate.
  startBlockReason(player, def) {
    if (this.phase !== 'idle') return 'a race is already running';
    if (!player || !player.car) return 'you need a car to race';
    if (player.boat) return 'you need a car to race';
    if (!this.canOffer) return 'finish the current job first';
    if (G.wanted > 0) return 'lose the heat first';
    if (this.cooldownLeft(def) > 0) return 'the grid is still resetting';
    if (G.money < def.entryFee) return 'not enough cash for the entry fee';
    return null;
  }

  // The prompt the main loop shows while the player lingers near a
  // start marker, as an HTML string, or null when racing has nothing
  // to say and the main prompt should speak for itself. During a race
  // the dedicated panel does the talking, so this returns null.
  promptHtml(player) {
    if (this.phase !== 'idle') return null;
    const near = this.nearestStart(player);
    if (!near) return null;
    const def = near.def;
    const best = this.bestTimeFor(def);
    const bestText = best ? ' · best ' + formatRaceTime(best) : '';
    if (!player.car) {
      return 'Street race — <b>' + def.name + '</b> · ' + formatCash(def.entryFee)
        + ' entry' + bestText + ' · get in a car, then press <b>G</b>';
    }
    const reason = this.startBlockReason(player, def);
    if (reason === 'the grid is still resetting') {
      return '<b>' + def.name + '</b> — grid reopens in '
        + Math.ceil(this.cooldownLeft(def)) + 's';
    }
    if (reason === 'finish the current job first') {
      return '<b>' + def.name + '</b> — finish the current job before racing';
    }
    if (reason === 'lose the heat first') {
      return '<b>' + def.name + '</b> — lose the heat before racing';
    }
    if (reason === 'not enough cash for the entry fee') {
      return '<b>' + def.name + '</b> — ' + formatCash(def.entryFee)
        + ' entry · <b>not enough cash</b>';
    }
    if (reason) return null;
    return 'Press <b>G</b> · Enter <b>' + def.name + '</b> — '
      + formatCash(def.entryFee) + ' entry · win ' + formatCash(def.prizes[0]) + bestText;
  }

  // The G key, forwarded here by the main loop's key handler:
  // standing at a marker in a car forms the grid; anything else gets
  // a short honest explanation rather than silence.
  handleGKey(player) {
    if (!player) return false;
    if (this.phase !== 'idle') {
      if (this.hud && this.hud.toast) {
        this.hud.toast('Race already running — ' + this.race.def.name, 1.8);
      }
      return false;
    }
    const near = this.nearestStart(player);
    if (!near) {
      if (this.hud && this.hud.toast) {
        this.hud.toast('Street races start at the orange rings — Harbor Sprint, Downtown Dash, Lighthouse Run', 2.6);
      }
      return false;
    }
    return this.startRace(player, near.def);
  }

  // Form the grid and take the entry fee: the single doorway every
  // race start passes through, so fee, refusals and rival spawn can
  // never drift apart. opts.free / opts.skipCountdown are for
  // screenshot staging.
  startRace(player, def, opts) {
    const options = opts || {};
    if (!def || !player) return false;
    if (!options.free) {
      const reason = this.startBlockReason(player, def);
      if (reason) {
        if (this.hud && this.hud.toast) {
          if (reason === 'not enough cash for the entry fee') {
            this.hud.toast('NOT ENOUGH CASH — ' + def.name + ' entry is '
              + formatCash(def.entryFee), 2.6);
            if (this.fx && this.fx.fail) this.fx.fail();
          } else {
            this.hud.toast(def.name + ' — ' + reason, 2.4);
          }
        }
        return false;
      }
      G.money -= def.entryFee;
    } else if (this.phase !== 'idle' || !player.car) {
      return false;
    }
    const rivals = this.spawnRivals(player, def);
    this.race = {
      def,
      elapsed: 0,
      countdown: options.skipCountdown ? 0 : RACE_COUNTDOWN,
      checkpointIndex: 0,
      rivals,
      carUsed: player.car,
      outOfCarFor: 0,
      timeLeft: def.timeoutSec,
      position: 1,
      gapMetres: 0,
      finished: false,
    };
    this.phase = options.skipCountdown ? 'racing' : 'countdown';
    const first = def.checkpoints[0];
    this.placeCheckpoint(first);
    if (this.fx && this.fx.success) this.fx.success();
    if (this.hud && this.hud.toast) {
      this.hud.toast(def.name + ' — ' + def.tagline + ' · '
        + def.checkpoints.length + ' checkpoints · entry ' + formatCash(def.entryFee), 3.2);
    }
    this.renderPanel(player);
    return true;
  }

  // Build the three rival cars on the grid around the player: one
  // behind, one behind-left, one behind-right, in the start
  // heading's own forward/right frame.
  spawnRivals(player, def) {
    const heading = def.start.heading;
    const fxv = Math.sin(heading);
    const fzv = Math.cos(heading);
    const rxv = Math.cos(heading);
    const rzv = -Math.sin(heading);
    const slots = [
      { back: 7.5, side: 0 },
      { back: 13, side: -2.6 },
      { back: 13, side: 2.6 },
    ];
    const rivals = [];
    for (let i = 0; i < RACE_RIVALS; i++) {
      const slot = slots[i];
      const info = RIVAL_DRIVERS[i % RIVAL_DRIVERS.length];
      const x = player.x - fxv * slot.back + rxv * slot.side;
      const z = player.z - fzv * slot.back + rzv * slot.side;
      const car = new Vehicle(this.scene, info.color, x, z, heading, {
        style: def.rivalStyles[i % def.rivalStyles.length],
        maxSpeed: def.rivalSpeeds[i % def.rivalSpeeds.length],
      });
      car.speed = 0;
      if (!Array.isArray(G.rivalCars)) G.rivalCars = [];
      G.rivalCars.push(car);
      rivals.push({
        car,
        name: info.name,
        checkpointIndex: 0,
        finished: false,
        finishElapsed: 0,
        stuckFor: 0,
        lastX: x,
        lastZ: z,
      });
    }
    return rivals;
  }

  // ---------------------------------------------------------------
  // Per-frame work
  // ---------------------------------------------------------------

  // Called once per frame from the main loop. opts.canOffer is
  // remembered so the prompt and the G key judge starts by the
  // same fact the frame did.
  update(dt, player, opts) {
    if (opts && typeof opts.canOffer === 'boolean') this.canOffer = opts.canOffer;
    this.markerClock += dt;
    this.updateMarkers(dt);
    for (const id of Object.keys(this.cooldowns)) {
      if (this.cooldowns[id] > 0) this.cooldowns[id] = Math.max(0, this.cooldowns[id] - dt);
    }
    if (this.phase === 'idle' || !this.race || !player) {
      if (this.phase === 'idle') this.hidePanel();
      return;
    }
    if (this.phase === 'countdown') this.updateCountdown(dt, player);
    else this.updateRacing(dt, player);
  }

  // The standing markers idle like things that want to be found:
  // the icon bobs and turns slowly, the halo breathes, and a marker
  // whose grid is on cooldown sits visibly dimmer than a live one.
  updateMarkers(dt) {
    const t = this.markerClock;
    for (const marker of this.markers) {
      const cooling = this.cooldownLeft(marker.def) > 0;
      const busy = this.phase !== 'idle' && this.race && this.race.def === marker.def;
      marker.icon.position.y = 2.1 + Math.sin(t * 1.9 + marker.phase) * 0.22;
      marker.icon.rotation.y += dt * 0.7;
      if (marker.halo && marker.halo.material) {
        const base = cooling ? 0.16 : busy ? 0.62 : 0.42;
        marker.halo.material.alpha = base + 0.12 * (0.5 + 0.5 * Math.sin(t * 2.8 + marker.phase));
      }
      if (marker.column && marker.column.material) {
        marker.column.material.alpha = cooling ? 0.07 : 0.20;
      }
      const pulse = 1 + Math.sin(t * 2.4 + marker.phase) * 0.045;
      marker.ring.scaling.set(pulse, pulse, pulse);
    }
  }

  // The held grid: the player's car is held at a standstill (the
  // main loop already drove it this frame, so the hold lands after
  // the fact), rivals stay formed up, the panel counts down, and
  // the race clock does not start until GO.
  updateCountdown(dt, player) {
    const race = this.race;
    race.countdown -= dt;
    if (player.car) {
      player.car.speed = 0;
      race.carUsed = player.car;
    }
    for (const rival of race.rivals) {
      rival.car.speed = 0;
      rival.car.syncMesh(0);
    }
    // The checkpoint column breathes while the grid waits, so the
    // first target is already part of the scene at GO.
    this.pulseCheckpoint();
    if (race.countdown <= 0) {
      this.phase = 'racing';
      if (this.hud && this.hud.toast) this.hud.toast('GO!', 1.1);
      if (this.fx && this.fx.success) this.fx.success();
    }
    this.renderPanel(player);
  }

  pulseCheckpoint() {
    const t = this.markerClock;
    if (this.cpRing) {
      const pulse = 1 + Math.sin(t * 3.2) * 0.06;
      this.cpRing.scaling.set(pulse, pulse, pulse);
    }
    if (this.cpOrb) {
      this.cpOrb.position.y = 3.1 + Math.sin(t * 2.6) * 0.35;
    }
    if (this.cpColumn && this.cpColumn.material) {
      this.cpColumn.material.alpha = 0.22 + 0.08 * (0.5 + 0.5 * Math.sin(t * 2.2));
    }
  }

  // The race proper: rivals move first (their progress is the
  // yardstick), then fail states, then the player's ring, then
  // the standings and the panel.
  updateRacing(dt, player) {
    const race = this.race;
    const def = race.def;
    race.elapsed += dt;
    race.timeLeft = Math.max(0, def.timeoutSec - race.elapsed);

    const colliders = G.colliders || [];
    for (const rival of race.rivals) this.updateRival(dt, rival, def, colliders);

    // Fail state: the clock. A generous timeout is still a timeout —
    // the rings do not wait forever, and neither do the rivals.
    if (race.timeLeft <= 0) {
      this.failRace('Out of time — the ' + def.name + ' grid went home without you');
      return;
    }
    // Fail state: the car. A wrecked car ends the race the moment
    // the wreck is real, whether Rina is still sitting in it or
    // standing next to it watching it burn.
    if (player.car) race.carUsed = player.car;
    if (race.carUsed && (race.carUsed.dead || race.carUsed.health <= 0)) {
      this.failRace('Your car was wrecked — the ' + def.name + ' is over');
      return;
    }
    // Fail state: abandonment. Leaving the car starts the grace
    // clock (a stolen replacement is fair racing); letting it run
    // out is walking away from the grid.
    if (!player.car) {
      race.outOfCarFor += dt;
      if (race.outOfCarFor >= RACE_EXIT_GRACE) {
        this.failRace('You left the race — out of the car too long');
        return;
      }
    } else {
      race.outOfCarFor = 0;
    }

    // The player's own next ring.
    const target = def.checkpoints[race.checkpointIndex];
    if (target && player.car) {
      const d = dist2d(player.x, player.z, target.x, target.z);
      race.gapMetres = d;
      if (d < RACE_CHECKPOINT_RADIUS) {
        this.advancePlayerCheckpoint(player);
        if (!this.race) return;   // the advance finished the race
      }
    } else if (target) {
      race.gapMetres = dist2d(player.x, player.z, target.x, target.z);
    }

    race.position = this.computePosition(player);
    this.pulseCheckpoint();
    this.renderPanel(player);
  }

  // One rival's frame: steer at its next ring through drive(),
  // count its rings, recover it when it wedges. A finished rival
  // rolls off the throttle and coasts out.
  updateRival(dt, rival, def, colliders) {
    const car = rival.car;
    if (rival.finished || car.dead || car.health <= 0) {
      if (!car.dead) car.drive(dt, 0, 0, colliders, {});
      return;
    }
    const target = def.checkpoints[rival.checkpointIndex];
    if (!target) { rival.finished = true; rival.finishElapsed = this.race.elapsed; return; }
    this.driveCarToward(car, dt, target.x, target.z, colliders, 1);
    if (dist2d(car.x, car.z, target.x, target.z) < RIVAL_CHECKPOINT_RADIUS) {
      rival.checkpointIndex++;
      rival.stuckFor = 0;
      if (rival.checkpointIndex >= def.checkpoints.length) {
        rival.finished = true;
        rival.finishElapsed = this.race.elapsed;
      }
      return;
    }
    // Stuck recovery: a rival that has barely moved for a long
    // stretch is wedged on furniture or a wall corner. Put it back
    // on the last ring it honestly passed (or the start), aimed at
    // the next one. It loses the time it spent wedged; it does not
    // gain a metre it did not drive.
    const moved = dist2d(car.x, car.z, rival.lastX, rival.lastZ);
    if (Math.abs(car.speed) < 1.1 && moved < 0.35) rival.stuckFor += dt;
    else rival.stuckFor = Math.max(0, rival.stuckFor - dt * 2);
    rival.lastX = car.x;
    rival.lastZ = car.z;
    if (rival.stuckFor > 4.5) {
      const back = rival.checkpointIndex > 0
        ? def.checkpoints[rival.checkpointIndex - 1]
        : def.start;
      car.pos.set(back.x, 0, back.z);
      car.heading = Math.atan2(target.x - back.x, target.z - back.z);
      car.mesh.rotation.y = car.heading;
      car.speed = 0;
      rival.stuckFor = 0;
    }
  }

  // Steer a car at a point with the arcade drive call — the same
  // desired-heading / clamped-steer / throttle-cap shape the mission
  // pace car is driven with, re-expressed for a rival that must also
  // back out of a face-full of wall rather than grind against it.
  driveCarToward(car, dt, tx, tz, colliders, cap) {
    const desired = Math.atan2(tx - car.x, tz - car.z);
    const diff = wrapAngleDelta(desired - car.heading);
    const steer = clamp(-diff * 1.45, -0.88, 0.88);
    let throttle = cap;
    if (Math.abs(diff) > 2.35) throttle = -0.5;         // nose the wrong way: reverse out
    else if (Math.abs(diff) > 1.15) throttle = cap * 0.45;  // hard turn: carry less speed
    car.drive(dt, throttle, steer, colliders, {});
  }

  // A single progress number for any driver in the race: rings
  // banked dominate, closeness to the next ring breaks the tie.
  // Two drivers on the same ring are separated by who is nearer it,
  // which is exactly how a spectator on the corner would call it.
  progressScore(checkpointIndex, distToNext) {
    return checkpointIndex * 10000 - Math.min(Math.max(distToNext, 0), 9999);
  }

  playerProgress(player) {
    const race = this.race;
    if (!race) return 0;
    const target = race.def.checkpoints[race.checkpointIndex];
    if (!target) return race.def.checkpoints.length * 10000;
    return this.progressScore(race.checkpointIndex,
      dist2d(player.x, player.z, target.x, target.z));
  }

  rivalProgress(rival) {
    const race = this.race;
    if (!race) return 0;
    const def = race.def;
    if (rival.finished) return def.checkpoints.length * 10000 + 1;
    const target = def.checkpoints[rival.checkpointIndex];
    if (!target) return def.checkpoints.length * 10000;
    return this.progressScore(rival.checkpointIndex,
      dist2d(rival.car.x, rival.car.z, target.x, target.z));
  }

  // Rina's live placing, 1st to 4th: one plus the number of rivals
  // whose progress is strictly ahead of hers right now.
  computePosition(player) {
    if (!this.race) return 1;
    const mine = this.playerProgress(player);
    let ahead = 0;
    for (const rival of this.race.rivals) {
      if (this.rivalProgress(rival) > mine) ahead++;
    }
    return ahead + 1;
  }

  // The rival directly ahead of the player, for the panel's gap
  // line — or null when Rina leads the race outright.
  rivalAhead(player) {
    if (!this.race) return null;
    const mine = this.playerProgress(player);
    let best = null;
    let bestScore = Infinity;
    for (const rival of this.race.rivals) {
      const score = this.rivalProgress(rival);
      if (score > mine && score < bestScore) { bestScore = score; best = rival; }
    }
    return best;
  }

  // The player crosses a ring: bank it, move the display to the next
  // ring, and either sing the small song of a checkpoint or resolve
  // the whole race when the ring was the finish.
  advancePlayerCheckpoint(player) {
    const race = this.race;
    const def = race.def;
    race.checkpointIndex++;
    if (this.fx && this.fx.pickup) this.fx.pickup();
    if (race.checkpointIndex >= def.checkpoints.length) {
      this.finishRace(player);
      return;
    }
    const next = def.checkpoints[race.checkpointIndex];
    this.placeCheckpoint(next);
    race.gapMetres = dist2d(player.x, player.z, next.x, next.z);
    if (race.checkpointIndex === def.checkpoints.length - 1) {
      if (this.hud && this.hud.toast) this.hud.toast('FINAL CHECKPOINT — bring it home!', 2.2);
    }
  }

  // ---------------------------------------------------------------
  // Resolution — finish, fail, cleanup
  // ---------------------------------------------------------------

  // The finish line: settle the placing (rivals who finished first
  // are ahead; nobody else is), pay the purse, bank the statistics
  // and best time, save, and sweep the grid away.
  finishRace(player) {
    const race = this.race;
    if (!race || race.finished) return;
    race.finished = true;
    const def = race.def;
    const elapsed = race.elapsed;
    let place = 1;
    for (const rival of race.rivals) if (rival.finished) place++;
    place = clamp(place, 1, RACE_RIVALS + 1);
    const prize = def.prizes[place - 1] || 0;

    G.racesDone = (G.racesDone || 0) + 1;
    if (place === 1) G.racesWon = (G.racesWon || 0) + 1;
    if (prize > 0) {
      G.money += prize;
      G.totalEarned = (G.totalEarned || 0) + prize;
      G.raceEarnings = (G.raceEarnings || 0) + prize;
    }
    if (!G.raceBestTimes || typeof G.raceBestTimes !== 'object') G.raceBestTimes = {};
    const previousBest = this.bestTimeFor(def);
    const isBest = !previousBest || elapsed < previousBest;
    if (isBest) G.raceBestTimes[def.id] = Math.round(elapsed * 10) / 10;

    const winner = place === 1 ? null
      : race.rivals.find((r) => r.finished && r.finishElapsed <= elapsed);
    if (this.hud && this.hud.banner) {
      if (place === 1) {
        this.hud.banner('RACE WON — ' + ordinal(place).toUpperCase(),
          def.name + ' · ' + formatRaceTime(elapsed)
          + (isBest ? ' · NEW BEST TIME' : '')
          + ' · +' + formatCash(prize).slice(1), '');
      } else {
        this.hud.banner(ordinal(place).toUpperCase() + ' PLACE',
          def.name + ' · ' + formatRaceTime(elapsed)
          + (winner ? ' · won by ' + winner.name : '')
          + (prize > 0 ? ' · +' + formatCash(prize).slice(1) : ' · no prize'), '');
      }
    }
    if (this.fx && this.fx.success && place <= 2) this.fx.success();
    if (this.fx && this.fx.fail && place > 2) this.fx.fail();
    saveGame();
    this.cleanupRace(def);
  }

  // A failed race: no purse, no refund, and no finish counted.
  failRace(reason) {
    const race = this.race;
    if (!race) return;
    const def = race.def;
    if (this.hud && this.hud.banner) {
      this.hud.banner('RACE FAILED', reason || def.name, 'failed');
    } else if (this.hud && this.hud.toast && reason) {
      this.hud.toast(reason, 3);
    }
    if (this.fx && this.fx.fail) this.fx.fail();
    saveGame();
    this.cleanupRace(def);
  }

  // Sweep a resolved race out of the world and start its cooldown.
  cleanupRace(def) {
    if (this.race) {
      for (const rival of this.race.rivals) {
        const car = rival.car;
        if (Array.isArray(G.rivalCars)) {
          const i = G.rivalCars.indexOf(car);
          if (i >= 0) G.rivalCars.splice(i, 1);
        }
        if (car.dispose) car.dispose();
        else removeNode(car.mesh);
      }
    }
    this.race = null;
    this.phase = 'idle';
    this.setCheckpointShown(false);
    this.hidePanel();
    if (def) this.cooldowns[def.id] = RACE_COOLDOWN;
  }

  // The run around the race ended (busted, wasted, a new game): the
  // race dissolves without a verdict and without a cooldown grudge.
  cancelActiveRace() {
    if (this.phase === 'idle' || !this.race) { this.hidePanel(); return; }
    const def = this.race.def;
    this.cleanupRace(null);
    if (def) this.cooldowns[def.id] = 0;
  }

  // ---------------------------------------------------------------
  // The race panel: a small owned card — countdown readout while
  // the grid is held, the full race contract while racing.
  // ---------------------------------------------------------------

  showPanel() {
    if (this.panelEl && !this.panelVisible) {
      this.panelEl.classList.remove('hidden');
      this.panelVisible = true;
    }
  }

  hidePanel() {
    if (this.panelEl && this.panelVisible) {
      this.panelEl.classList.add('hidden');
      this.panelVisible = false;
    }
  }

  setPanel(title, line, meta) {
    this.showPanel();
    if (this.panelTitleEl) this.panelTitleEl.textContent = title;
    if (this.panelLineEl) this.panelLineEl.textContent = line;
    if (this.panelMetaEl) this.panelMetaEl.textContent = meta;
  }

  renderPanel(player) {
    const race = this.race;
    if (!race) { this.hidePanel(); return; }
    const def = race.def;
    const total = def.checkpoints.length;
    if (this.phase === 'countdown') {
      const count = Math.max(1, Math.ceil(race.countdown));
      this.setPanel(
        def.name + ' — GRID FORMED',
        'Starting in ' + count + ' · ' + total + ' checkpoints · '
          + formatMetres(def.routeLength) + ' of Solmaris',
        'Win ' + formatCash(def.prizes[0]) + ' · 2nd ' + formatCash(def.prizes[1])
          + ' · 3rd ' + formatCash(def.prizes[2]) + ' · best '
          + (this.bestTimeFor(def) ? formatRaceTime(this.bestTimeFor(def)) : '—'),
      );
      return;
    }
    const cpShown = Math.min(race.checkpointIndex + 1, total);
    const ahead = this.rivalAhead(player);
    const awayNote = race.outOfCarFor > 0
      ? ' · back in a car within ' + Math.max(0, Math.ceil(RACE_EXIT_GRACE - race.outOfCarFor)) + 's!'
      : '';
    const gapText = ahead
      ? 'Chasing ' + ahead.name + ' · next ring ' + formatMetres(race.gapMetres)
      : 'Leading · next ring ' + formatMetres(race.gapMetres);
    this.setPanel(
      def.name + ' — POS ' + race.position + '/4',
      'Checkpoint ' + cpShown + '/' + total + ' · ' + formatRaceTime(race.elapsed),
      gapText + ' · limit ' + formatClock(race.timeLeft) + awayNote,
    );
  }

  // ---------------------------------------------------------------
  // Minimap, lifecycle, snapshot
  // ---------------------------------------------------------------

  // Blips drawn onto the minimap canvas after the HUD's own layer,
  // with the same transform (centre on the player, 300 m across):
  // orange start markers in range; during a race, the next ring
  // boldly and the rivals as small dots.
  drawMinimapBlips(player, hudInstance) {
    const ctx = hudInstance && hudInstance.mapCtx ? hudInstance.mapCtx : null;
    if (!ctx || !player) return;
    const S = 190;
    const C = S / 2;
    const scale = S / 300;
    const toMap = (x, z) => [C + (x - player.x) * scale, C + (z - player.z) * scale];
    ctx.save();
    ctx.beginPath();
    ctx.arc(C, C, C - 2, 0, Math.PI * 2);
    ctx.clip();
    const dot = (x, z, r, fill, stroke) => {
      const [mx, my] = toMap(x, z);
      if (mx < -8 || my < -8 || mx > S + 8 || my > S + 8) return;
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(mx, my, r, 0, Math.PI * 2);
      ctx.fill();
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(mx, my, r + 1.1, 0, Math.PI * 2);
        ctx.stroke();
      }
    };
    if (this.phase === 'idle') {
      for (const def of this.defs) {
        if (this.cooldownLeft(def) > 0) continue;
        const d = dist2d(player.x, player.z, def.start.x, def.start.z);
        if (d < 165) dot(def.start.x, def.start.z, 2.8, '#ff8c1a', 'rgba(0,0,0,0.55)');
      }
    }
    if (this.race) {
      const target = this.race.def.checkpoints[this.race.checkpointIndex];
      for (const rival of this.race.rivals) {
        if (!rival.car.dead) dot(rival.car.x, rival.car.z, 2.2, '#c9a0ff', null);
      }
      if (target) dot(target.x, target.z, 3.6, '#ffa02a', '#ffffff');
    }
    ctx.restore();
  }

  // A brand-new game: no races run, no purses banked, no best times
  // on the board, and any grid that was somehow live is dissolved.
  resetAll() {
    this.cancelActiveRace();
    G.racesWon = 0;
    G.racesDone = 0;
    G.raceEarnings = 0;
    G.raceBestTimes = {};
    this.cooldowns = {};
    this.hidePanel();
  }

  // A continued game: the save has already been folded into G by
  // state.js, so all that remains is to make sure no phantom grid
  // survives the load and the panel starts dark.
  restoreFromSave() {
    this.cancelActiveRace();
    if (!G.raceBestTimes || typeof G.raceBestTimes !== 'object') G.raceBestTimes = {};
    this.hidePanel();
  }

  // A plain-data picture of the whole system, for verification
  // harnesses: no meshes, no functions, safe to serialise.
  getSnapshot() {
    const race = this.race;
    const best = {};
    for (const def of this.defs) {
      const t = this.bestTimeFor(def);
      if (t) best[def.id] = Math.round(t * 10) / 10;
    }
    return {
      phase: this.phase,
      raceIds: this.defs.map((d) => d.id),
      raceNames: this.defs.map((d) => d.name),
      entryFees: this.defs.map((d) => d.entryFee),
      racesWon: G.racesWon || 0,
      racesDone: G.racesDone || 0,
      raceEarnings: G.raceEarnings || 0,
      bestTimes: best,
      activeRace: race ? race.def.id : null,
      checkpointIndex: race ? race.checkpointIndex : 0,
      checkpointTotal: race ? race.def.checkpoints.length : 0,
      position: race ? race.position : 0,
      elapsed: race ? Math.round(race.elapsed * 10) / 10 : 0,
      timeLeft: race ? Math.round(race.timeLeft * 10) / 10 : 0,
      rivals: race ? race.rivals.map((r) => ({
        name: r.name,
        checkpointIndex: r.checkpointIndex,
        finished: r.finished,
      })) : [],
      cooldowns: { ...this.cooldowns },
    };
  }
}
