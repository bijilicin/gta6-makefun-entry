// Solmaris Heat — side activities module (round 3, authored in-session).
//
// Two self-contained free-roam systems live in this file:
//
//   1. Ledger Pages — thirty loose pages from Sal Prumo's ledger, lost
//      all over Solmaris. Walk or drive through one to pocket it. Each
//      page pays a small finder's fee, the halfway mark pays a bonus,
//      and a full set pays a much larger one and closes the book.
//
//   2. Taxi fares — while Rina is driving, passengers flag her down at
//      the kerb. Stop close, press T, and the fare is aboard: a named
//      destination across town, a countdown, a fare that grows with the
//      trip distance, and a tip that rewards arriving early in a car
//      that is still in one piece.
//
// Design notes, written for whoever maintains this next:
//
//   * This module owns no lights. The scene already runs at the
//     twelve-light shader ceiling (sun, fill, hemisphere, the street
//     lamp pool and the player headlight), so every glow here is an
//     unlit billboard or an emissive sphere — never a PointLight.
//   * It also owns no randomness from state.js. The city builder uses
//     that seeded stream to lay out Solmaris itself, and pulling from
//     it here would reshuffle the city. The scatter below runs on a
//     private generator with its own seed, so the page layout is the
//     same on every boot and never disturbs anyone else's layout.
//   * Persistence is deliberately boring: the module reads and writes
//     plain fields on the shared G object (ledgerPages, faresDone,
//     taxiEarned and friends) and asks state.js to save. Old saves
//     simply do not have those fields; state.js fills in empty
//     defaults when it loads, and this module tolerates the same.
//   * Nothing in here touches missions, police, traffic lights, the
//     camera, speeds or ammunition. It reads the player's position and
//     current car, pays money, shows toasts, and minds its own timers.

import { G, WORLD, clamp, dist2d, nearestRoadCoord, saveGame } from './state.js';
import {
  LANDMARKS, basicMat, pbrMat, boxMesh, sphereMesh, groupNode,
  removeNode, setShown, markShadow, uid, glowTexture, makeBillboard,
} from './world.js';
import { makePersonMesh } from './peds.js';

// ---------------------------------------------------------------------
// Tunables. Kept together at the top so balancing a system never means
// hunting through the class body for a stray number.
// ---------------------------------------------------------------------

const PAGE_TOTAL = 30;              // pages in a complete ledger set
const PAGE_REWARD = 25;             // cash for a single page
const PAGE_PICKUP_RADIUS = 2.7;     // metres: close enough to grab it
const PAGE_REVEAL_RADIUS = 58;      // metres: minimap blip range
const PAGE_MID_COUNT = 15;          // halfway milestone
const PAGE_MID_BONUS = 500;         // halfway bonus cash
const PAGE_FULL_BONUS = 1500;       // full-set bonus cash
const PAGE_BOB_SPEED = 2.1;         // hover bob, radians per second
const PAGE_SPIN_SPEED = 1.35;       // hover spin, radians per second

const TAXI_FIRST_DELAY = 7;         // seconds before the first fare offer
const TAXI_COOLDOWN_MIN = 13;       // shortest pause between fares
const TAXI_COOLDOWN_MAX = 24;       // longest pause between fares
const TAXI_WAIT_LIMIT = 110;        // a waiting passenger gives up after this
const TAXI_PICKUP_RADIUS = 7.5;     // stop within this of the passenger
const TAXI_DROP_RADIUS = 9.5;       // arrival radius at the destination
const TAXI_EXIT_GRACE = 5;          // seconds out of the car before a fail
const TAXI_BASE_FARE = 18;          // flag-fall component of every fare
const TAXI_PER_METRE = 0.34;        // distance component of every fare
const TAXI_TIP_CEILING = 0.45;      // best tip, as a fraction of the fare
const TAXI_TIME_PER_METRE = 0.62;   // countdown seconds per metre of trip
const TAXI_TIME_MIN = 45;           // no fare ever gets less time than this
const TAXI_TIME_MAX = 210;          // and no fare gets more

// ---------------------------------------------------------------------
// Ledger Page placement.
//
// Eighteen pages are hand-placed: behind the cafe, under the pier
// boards, in the alley by the pawn shop, up on low awnings where a
// page could plausibly have blown and stuck. The remaining twelve are
// scattered by the seeded routine further down, which keeps every one
// of them on a kerb line — pages rest where the wind dropped them,
// along streets, never in the sea and never inside a city block where
// no driver or walker could reasonably reach them.
// ---------------------------------------------------------------------

const HAND_SPOTS = [
  { x: -44, z: -27, y: 1.1, label: 'the alley behind the cafe' },
  { x: -28, z: -44, y: 1.1, label: 'the cafe service yard' },
  { x: 24, z: 228, y: 1.1, label: 'under the pier boards' },
  { x: 31, z: 244, y: 1.1, label: 'the end of the pier' },
  { x: -118, z: 188, y: 1.1, label: 'the marina lot fence' },
  { x: -131, z: 205, y: 3.4, label: 'a marina awning' },
  { x: 118, z: 36, y: 1.1, label: 'behind Rico\'s garage' },
  { x: 132, z: 52, y: 3.4, label: 'the garage forecourt canopy' },
  { x: 38, z: -116, y: 1.1, label: 'the hospital ambulance bay' },
  { x: 52, z: -132, y: 1.1, label: 'the hospital garden wall' },
  { x: -128, z: -144, y: 1.1, label: 'the PD HQ back steps' },
  { x: 45, z: -58, y: 1.1, label: 'the pawn shop doorway' },
  { x: 53, z: -43, y: 3.4, label: 'the pawn shop sign ledge' },
  { x: -160, z: -160, y: 1.1, label: 'the lighthouse path' },
  { x: 158, z: 156, y: 1.1, label: 'the Beach Sprint start line' },
  { x: -8, z: 8, y: 1.1, label: 'the downtown fountain kerb' },
  { x: 88, z: -88, y: 1.1, label: 'a downtown loading bay' },
  { x: -88, z: 88, y: 1.1, label: 'the west arcade steps' },
];

// A tiny linear congruential generator, private to this module. The
// constants are the classic Numerical Recipes pair; the seed is fixed,
// so the scatter is a layout decision, not a dice roll — playtesters
// and screenshot staging see the same city every single run.
function makeScatterRandom(seed) {
  let state = (seed >>> 0) || 1;
  return function nextScatterValue() {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

// True when a candidate point sits too close to a page we already
// placed. Pages are a scavenger hunt, not a breadcrumb trail: two of
// them in the same eyeline would waste both.
function spotCrowdsExisting(candidate, placed, minGap) {
  for (const other of placed) {
    if (dist2d(candidate.x, candidate.z, other.x, other.z) < minGap) return true;
  }
  return false;
}

// Build the scattered share of the page layout. Each candidate snaps
// one axis onto a street's kerb line (half the road width plus a
// pavement margin from the road centre line) and ranges freely along
// the other, which is what keeps pages reachable: a page on a kerb can
// always be collected by rolling or walking up to it, whatever the
// buildings behind that kerb are doing.
function buildScatterSpots(handSpots, wanted) {
  const placed = handSpots.slice();
  const scattered = [];
  const next = makeScatterRandom(20261119);
  const roadLines = [];
  for (let c = -WORLD.half; c <= WORLD.half; c += WORLD.roadEvery) roadLines.push(c);
  const kerbOffset = WORLD.roadWidth / 2 + 2.6;
  let guard = 0;
  while (scattered.length < wanted && guard < 900) {
    guard++;
    const alongVertical = next() < 0.5;
    const line = roadLines[Math.floor(next() * roadLines.length) % roadLines.length];
    const side = next() < 0.5 ? -1 : 1;
    const along = -192 + next() * 384;
    const candidate = alongVertical
      ? { x: line + side * kerbOffset, z: along, y: 1.1, label: 'a windy kerb' }
      : { x: along, z: line + side * kerbOffset, y: 1.1, label: 'a windy kerb' };
    if (candidate.z > 198) continue;                    // never in the sand or sea
    if (Math.abs(candidate.x) > 198 || Math.abs(candidate.z) > 198) continue;
    if (spotCrowdsExisting(candidate, placed, 17)) continue;
    placed.push(candidate);
    scattered.push(candidate);
  }
  // The guard should never bite — the grid has room for far more than
  // twelve kerb spots — but if it ever did, top up along the beach
  // road rather than ship a ledger with pages missing.
  while (scattered.length < wanted) {
    const x = -180 + scattered.length * 33;
    const fallback = { x, z: 188, y: 1.1, label: 'the boardwalk kerb' };
    scattered.push(fallback);
    placed.push(fallback);
  }
  return scattered;
}

function buildPageSpots() {
  const scattered = buildScatterSpots(HAND_SPOTS, PAGE_TOTAL - HAND_SPOTS.length);
  const all = HAND_SPOTS.concat(scattered);
  return all.map((spot, index) => ({
    id: index,
    x: spot.x,
    z: spot.z,
    y: spot.y || 1.1,
    label: spot.label,
  }));
}

// Small formatting helpers, shared by the taxi panel and the toasts.
function formatClock(totalSeconds) {
  const s = Math.max(0, Math.ceil(totalSeconds));
  const minutes = Math.floor(s / 60);
  const rest = s % 60;
  return minutes + ':' + String(rest).padStart(2, '0');
}

function formatMetres(metres) {
  if (metres >= 1000) return (metres / 1000).toFixed(2) + ' km';
  return Math.round(metres) + ' m';
}

function formatCash(amount) {
  return '$' + Math.round(amount).toLocaleString('en-US');
}

// Passenger flavour. A fare is a person before it is a payment: each
// waiting passenger gets a name, a shirt colour for their kerbside
// figure, and a line for the moment they climb in. None of this feeds
// any other system; it exists so the tenth fare does not feel like the
// first one wearing a false moustache.
const PASSENGERS = [
  { name: 'Old Tomas', shirt: 0x8a8f98, line: 'The lighthouse road, driver. Slow is fine, we are both retired.' },
  { name: 'Priya', shirt: 0xe63946, line: 'Hospital, please — my shift starts whether I am in it or not.' },
  { name: 'Marco the florist', shirt: 0x74c69d, line: 'The cafe, and mind the bumps — these lilies bruise easier than I do.' },
  { name: 'Auntie Bea', shirt: 0xffd166, line: 'The pier, love. The fish will not wait and neither shall we.' },
  { name: 'Jonas', shirt: 0x457b9d, line: 'Marina lot. My boat, my debt, my problem — you just drive.' },
  { name: 'Selin', shirt: 0x9d4edd, line: 'Downtown, anywhere with lights. I am done with walking home.' },
  { name: 'Captain Ruiz (ret.)', shirt: 0xf1faee, line: 'PD HQ. Do not ask, and I shall not tell.' },
  { name: 'The twins', shirt: 0xef476f, line: 'Beach Sprint start! Loser of our bet pays the fare, so — quickly.' },
  { name: 'Hana', shirt: 0x2a9d8f, line: 'Rico\'s garage. My scooter died exactly where his tow truck cannot be bothered.' },
  { name: 'Mr Okafor', shirt: 0xf4a261, line: 'The pawn shop. One errand, no questions, a generous tip for both.' },
  { name: 'Lucia', shirt: 0xff7b54, line: 'Mama Rosa\'s. She is holding a table and absolutely no grudges.' },
  { name: 'Deshawn', shirt: 0x118ab2, line: 'Hospital steps — my sister is being discharged and I refuse to be late.' },
];

// Named places a fare can ask for, beyond the landmark list itself:
// a spread of street corners described the way a passenger would
// describe them, snapped to intersections so the destination marker
// always stands somewhere a car can actually stop.
const EXTRA_DESTINATIONS = [
  { x: 80, z: -160, name: 'the north downtown corner' },
  { x: -160, z: 80, name: 'the west arcade corner' },
  { x: 160, z: -80, name: 'the east market corner' },
  { x: -80, z: -160, name: 'the old town north corner' },
  { x: 0, z: 160, name: 'the boardwalk steps' },
  { x: -160, z: -80, name: 'the warehouse district corner' },
  { x: 160, z: 160, name: 'the Beach Sprint corner' },
  { x: 0, z: -80, name: 'the central plaza corner' },
];

// ---------------------------------------------------------------------
// The activities system itself.
// ---------------------------------------------------------------------

export class Activities {
  constructor(scene, hud, fx) {
    this.scene = scene;
    this.hud = hud || null;
    this.fx = fx || null;

    // DOM handles for the two small HUD additions this module owns.
    // Both are optional: if the page shell ever drops them, the game
    // still runs — the systems just lose their dedicated readouts and
    // fall back to toasts alone.
    this.panelEl = document.getElementById('taxipanel');
    this.panelTitleEl = document.getElementById('taxititle');
    this.panelLineEl = document.getElementById('taxiline');
    this.panelMetaEl = document.getElementById('taximeta');
    this.counterEl = document.getElementById('pagecounter');
    this.panelVisible = false;
    this.counterText = '';

    // Ledger pages.
    this.spots = buildPageSpots();
    this.pages = [];
    this.buildAllPageMeshes();
    this.syncPageVisibility();

    // Taxi fares. The state machine has three resting shapes:
    //   cooldown — nobody is waiting; the timer runs down to the
    //              next offer (and pressing T in a car hurries it).
    //   waiting  — a passenger stands at a kerb with a marker; the
    //              player must stop near them and press T.
    //   riding   — the passenger is aboard; destination, countdown,
    //              fare and damage watch are all live.
    this.taxi = {
      phase: 'cooldown',
      timer: TAXI_FIRST_DELAY,
      waitLeft: 0,
      passenger: null,       // { x, z, name, shirt, line, mesh, halo, ring }
      destination: null,     // { x, z, name }
      beacon: null,          // destination column mesh
      beaconRing: null,      // destination ground ring mesh
      timeLeft: 0,
      timeTotal: 0,
      tripDistance: 0,
      distanceLeft: 0,
      fare: 0,
      damageTaken: 0,
      lastCarHealth: 100,
      outOfCarFor: 0,
      carUsed: null,
    };
    this.fareIndex = 0;      // rotates the passenger flavour table
    this.pickupHintShownFor = null;
  }

  // ---------------------------------------------------------------
  // Ledger Pages — meshes
  // ---------------------------------------------------------------

  buildAllPageMeshes() {
    const glowTex = glowTexture(this.scene);
    for (const spot of this.spots) {
      const entry = {
        spot,
        group: null,
        sheet: null,
        halo: null,
        phase: (spot.id * 0.83) % (Math.PI * 2),
        taken: false,
      };
      entry.group = this.buildOnePageMesh(spot, glowTex);
      entry.sheet = entry.group.metadata ? entry.group.metadata.sheet : null;
      entry.halo = entry.group.metadata ? entry.group.metadata.halo : null;
      this.pages.push(entry);
    }
  }

  // One page, built from primitives: a thin bright sheet with a darker
  // ruled band (the ledger's red margin line, suggested rather than
  // drawn), floating inside a warm halo billboard. The sheet is a box
  // because everything in Solmaris is honestly built from boxes — and
  // because a box catches the sun on its edge as it turns, which a flat
  // plane never quite manages.
  buildOnePageMesh(spot, glowTex) {
    const scene = this.scene;
    const group = groupNode(scene);
    const sheetMat = pbrMat(scene, {
      color: 0xfff6da, roughness: 0.55, metalness: 0.05,
      emissive: 0xffdf8a, emissiveIntensity: 0.28,
    });
    const sheet = boxMesh(scene, 0.56, 0.76, 0.05, sheetMat);
    sheet.position.y = 0;
    markShadow(sheet, true, false);
    sheet.parent = group;
    const marginMat = pbrMat(scene, { color: 0xc94f4f, roughness: 0.6, metalness: 0.0 });
    const margin = boxMesh(scene, 0.05, 0.7, 0.056, marginMat);
    margin.position.set(-0.19, 0, 0);
    margin.parent = group;
    const bandMat = pbrMat(scene, { color: 0x3a4a5a, roughness: 0.6, metalness: 0.1 });
    const band = boxMesh(scene, 0.4, 0.06, 0.056, bandMat);
    band.position.set(0.03, 0.22, 0);
    band.parent = group;
    const halo = makeBillboard(scene, glowTex, 1.9, 1.9, { color: 0xffc93e, opacity: 0.5 });
    halo.position.y = 0;
    halo.parent = group;
    group.position.set(spot.x, spot.y, spot.z);
    group.metadata = { sheet, halo };
    return group;
  }

  // A page that has been collected leaves the world entirely — no
  // greyed-out ghost, because a found page is a page Rina is carrying.
  syncPageVisibility() {
    const held = Array.isArray(G.ledgerPages) ? G.ledgerPages : [];
    for (const entry of this.pages) {
      entry.taken = held.includes(entry.spot.id);
      setShown(entry.group, !entry.taken);
    }
    this.refreshCounter();
  }

  collectedCount() {
    return Array.isArray(G.ledgerPages) ? G.ledgerPages.length : 0;
  }

  refreshCounter() {
    if (!this.counterEl) return;
    const text = 'LEDGER PAGES ' + this.collectedCount() + ' / ' + PAGE_TOTAL;
    if (text !== this.counterText) {
      this.counterText = text;
      this.counterEl.textContent = text;
    }
  }

  // ---------------------------------------------------------------
  // Ledger Pages — collection
  // ---------------------------------------------------------------

  // Award one page by id. Returns true when the page was genuinely
  // new. This is the single doorway every collection passes through —
  // the proximity check in the update loop, and any test harness that
  // invokes a pickup directly — so the money, the milestones and the
  // save can never drift apart.
  collectPage(id) {
    if (!Array.isArray(G.ledgerPages)) G.ledgerPages = [];
    if (G.ledgerPages.includes(id)) return false;
    const entry = this.pages[id];
    if (!entry) return false;
    G.ledgerPages.push(id);
    G.ledgerPages.sort((a, b) => a - b);
    entry.taken = true;
    setShown(entry.group, false);
    G.money += PAGE_REWARD;
    G.totalEarned = (G.totalEarned || 0) + PAGE_REWARD;
    if (this.fx && this.fx.pickup) this.fx.pickup();
    const count = G.ledgerPages.length;
    if (this.hud && this.hud.toast) {
      this.hud.toast('Ledger Page ' + count + '/' + PAGE_TOTAL + ' · +'
        + formatCash(PAGE_REWARD).slice(1) + ' — found at ' + entry.spot.label, 2.6);
    }
    this.checkPageMilestones(count);
    this.refreshCounter();
    saveGame();
    return true;
  }

  // Milestones pay once, ever. The flags live on G (and therefore in
  // the save), so quitting at fourteen pages and finding the fifteenth
  // next week still pays — and re-finding it can never pay twice.
  checkPageMilestones(count) {
    if (count >= PAGE_MID_COUNT && !G.ledgerBonusMid) {
      G.ledgerBonusMid = true;
      G.money += PAGE_MID_BONUS;
      G.totalEarned = (G.totalEarned || 0) + PAGE_MID_BONUS;
      if (this.hud && this.hud.banner) {
        this.hud.banner('HALF THE LEDGER', 'Pages ' + PAGE_MID_COUNT + '/' + PAGE_TOTAL
          + ' · bonus ' + formatCash(PAGE_MID_BONUS), '');
      }
      if (this.fx && this.fx.success) this.fx.success();
    }
    if (count >= PAGE_TOTAL && !G.ledgerBonusFull) {
      G.ledgerBonusFull = true;
      G.money += PAGE_FULL_BONUS;
      G.totalEarned = (G.totalEarned || 0) + PAGE_FULL_BONUS;
      if (this.hud && this.hud.banner) {
        this.hud.banner('LEDGER COMPLETE', 'All ' + PAGE_TOTAL + ' pages · bonus '
          + formatCash(PAGE_FULL_BONUS) + ' — Sal\'s book, closed', '');
      }
      if (this.fx && this.fx.success) this.fx.success();
    }
  }

  // The nearest page Rina has not found yet, and how far it is. The
  // update loop uses it for the proximity check; the snapshot at the
  // bottom of the file exposes it to verification harnesses.
  nearestUncollected(player) {
    let best = null;
    let bestDist = Infinity;
    for (const entry of this.pages) {
      if (entry.taken) continue;
      const d = dist2d(player.x, player.z, entry.spot.x, entry.spot.z);
      if (d < bestDist) { bestDist = d; best = entry; }
    }
    return best ? { entry: best, distance: bestDist } : null;
  }

  updatePages(dt, player) {
    const t = G.time;
    for (const entry of this.pages) {
      if (entry.taken) continue;
      const group = entry.group;
      group.rotation.y += dt * PAGE_SPIN_SPEED;
      group.position.y = entry.spot.y + Math.sin(t * PAGE_BOB_SPEED + entry.phase) * 0.16;
      if (entry.halo && entry.halo.material) {
        const pulse = 0.42 + 0.16 * (0.5 + 0.5 * Math.sin(t * 2.6 + entry.phase));
        entry.halo.material.alpha = pulse;
      }
    }
    const near = this.nearestUncollected(player);
    if (near && near.distance < PAGE_PICKUP_RADIUS) {
      this.collectPage(near.entry.spot.id);
    }
  }

  // ---------------------------------------------------------------
  // Taxi fares — spawning
  // ---------------------------------------------------------------

  // A kerb point a few blocks from the player: snap to a nearby street
  // intersection, then step off the asphalt by a pavement margin, on
  // whichever side faces the city. Retries keep the point inside the
  // built city and off the beach; the final fallback is the cafe kerb,
  // which is always dry land and always reachable.
  choosePickupPoint(player) {
    const avenue = nearestRoadCoord(player.x);
    const street = nearestRoadCoord(player.z);
    const kerb = WORLD.roadWidth / 2 + 2.4;
    const tries = [
      { x: avenue + kerb, z: street + 55 },
      { x: avenue - kerb, z: street - 55 },
      { x: avenue + 55, z: street + kerb },
      { x: avenue - 55, z: street - kerb },
      { x: avenue + kerb, z: street + 120 },
      { x: avenue - kerb, z: street - 120 },
    ];
    for (const point of tries) {
      if (Math.abs(point.x) > 196 || point.z < -196 || point.z > 196) continue;
      if (dist2d(player.x, player.z, point.x, point.z) < 26) continue;
      return point;
    }
    return { x: LANDMARKS.cafe.x + 6, z: LANDMARKS.cafe.z + 6 };
  }

  // Destinations are drawn from the landmark table plus the extra
  // named corners, filtered hard: a fare must cross a real slice of
  // town (at least 120 metres), because a thirty-metre taxi ride is a
  // favour, not a fare. After a handful of unlucky draws we simply
  // take the farthest candidate on the list, so a destination is
  // always found.
  chooseDestination(fromX, fromZ) {
    const pool = [];
    for (const key of Object.keys(LANDMARKS)) {
      const lm = LANDMARKS[key];
      pool.push({ x: lm.x, z: lm.z, name: lm.name });
    }
    for (const extra of EXTRA_DESTINATIONS) pool.push(extra);
    let farthest = null;
    let farthestDist = -1;
    for (let attempt = 0; attempt < 14; attempt++) {
      const pick = pool[(this.fareIndex * 5 + attempt * 3) % pool.length];
      const d = dist2d(fromX, fromZ, pick.x, pick.z);
      if (d > farthestDist) { farthestDist = d; farthest = pick; }
      if (d >= 120) return { point: pick, distance: d };
    }
    return { point: farthest, distance: Math.max(farthestDist, 0) };
  }

  fareForDistance(distance) {
    return Math.round(TAXI_BASE_FARE + distance * TAXI_PER_METRE);
  }

  timeForDistance(distance) {
    return clamp(Math.round(30 + distance * TAXI_TIME_PER_METRE), TAXI_TIME_MIN, TAXI_TIME_MAX);
  }

  // The tip, computed live so the panel can show what is at stake:
  // arriving with most of the clock left and an unbent car earns the
  // ceiling rate; every point of damage and every burned second
  // shaves it. A wrecked or crawling fare tips nothing at all.
  liveTip() {
    const t = this.taxi;
    if (t.phase !== 'riding') return 0;
    const timeShare = t.timeTotal > 0 ? clamp(t.timeLeft / t.timeTotal, 0, 1) : 0;
    const careShare = clamp(1 - t.damageTaken / 26, 0, 1);
    return Math.round(t.fare * TAXI_TIP_CEILING * timeShare * careShare);
  }

  // Build the waiting passenger: a cube-built figure in the passenger's
  // shirt colour (the same person builder the rest of the cast uses —
  // characters in Solmaris are boxes, and a fare is no exception), a
  // ground ring so the stopping point reads at speed, and a small
  // floating halo sphere that bobs above their head like a thought.
  buildPassengerFigure(passenger, point) {
    const scene = this.scene;
    const mesh = makePersonMesh(scene, passenger.shirt, 0xc98d5a, {});
    mesh.position.set(point.x, 0, point.z);
    const ring = BABYLON.MeshBuilder.CreateTorus(uid('fareRing'), {
      diameter: 3.4, thickness: 0.3, tessellation: 24,
    }, scene);
    ring.material = basicMat(scene, { color: 0x5ef2ff });
    ring.isPickable = false;
    ring.rotation.x = Math.PI / 2;
    ring.position.set(point.x, 0.35, point.z);
    const halo = sphereMesh(scene, 0.34, 10, basicMat(scene, { color: 0x5ef2ff }));
    halo.position.set(point.x, 2.6, point.z);
    halo.isPickable = false;
    return { mesh, ring, halo };
  }

  clearPassengerFigure() {
    const t = this.taxi;
    if (!t.passenger) return;
    if (t.passenger.mesh) removeNode(t.passenger.mesh);
    if (t.passenger.ring) removeNode(t.passenger.ring);
    if (t.passenger.halo) removeNode(t.passenger.halo);
    t.passenger = null;
  }

  // The destination gets a tall soft column and a ground ring, in a
  // warm pink that no mission marker uses, so a fare never gets
  // mistaken for a story job (gold) or for the older side markers
  // (cyan) at a glance.
  buildDestinationMarker(point) {
    const scene = this.scene;
    const column = BABYLON.MeshBuilder.CreateCylinder(uid('fareBeacon'), {
      diameterTop: 5.2, diameterBottom: 5.2, height: 30, tessellation: 16,
    }, scene);
    column.material = basicMat(scene, { color: 0xff5ea8, opacity: 0.30, depthWrite: false, backFace: true });
    column.isPickable = false;
    column.position.set(point.x, 15, point.z);
    const ring = BABYLON.MeshBuilder.CreateTorus(uid('fareDropRing'), {
      diameter: 6.2, thickness: 0.42, tessellation: 28,
    }, scene);
    ring.material = basicMat(scene, { color: 0xff5ea8 });
    ring.isPickable = false;
    ring.rotation.x = Math.PI / 2;
    ring.position.set(point.x, 0.4, point.z);
    this.taxi.beacon = column;
    this.taxi.beaconRing = ring;
  }

  clearDestinationMarker() {
    const t = this.taxi;
    if (t.beacon) { removeNode(t.beacon); t.beacon = null; }
    if (t.beaconRing) { removeNode(t.beaconRing); t.beaconRing = null; }
  }

  // Put a fare on the street. Returns false when the moment is wrong
  // (not driving, wanted, a story job is live) so the caller can leave
  // the cooldown running instead of forcing a spawn into a gunfight.
  spawnFare(player, force) {
    const t = this.taxi;
    if (t.phase === 'waiting' || t.phase === 'riding') return false;
    if (!force) {
      if (!player || !player.car || player.boat) return false;
      if (G.wanted > 0 || G.aiDriver) return false;
    }
    if (!player) return false;
    const flavour = PASSENGERS[this.fareIndex % PASSENGERS.length];
    this.fareIndex++;
    const point = this.choosePickupPoint(player);
    const figures = this.buildPassengerFigure(flavour, point);
    t.passenger = {
      x: point.x, z: point.z,
      name: flavour.name, line: flavour.line,
      mesh: figures.mesh, ring: figures.ring, halo: figures.halo,
    };
    t.phase = 'waiting';
    t.waitLeft = TAXI_WAIT_LIMIT;
    this.pickupHintShownFor = null;
    if (this.hud && this.hud.toast) {
      this.hud.toast('TAXI — ' + flavour.name + ' is flagging you down nearby', 2.8);
    }
    return true;
  }

  // ---------------------------------------------------------------
  // Taxi fares — the T key and the ride
  // ---------------------------------------------------------------

  // What T means depends on the moment, and the key handler in main.js
  // simply forwards here:
  //   waiting + near + stopped-ish  -> the passenger climbs in.
  //   cooldown + driving             -> impatience: the next fare is
  //                                     offered almost immediately.
  //   anything else                  -> a short explanatory toast.
  handleTKey(player) {
    const t = this.taxi;
    if (!player) return false;
    if (t.phase === 'waiting') {
      if (!player.car) {
        if (this.hud && this.hud.toast) this.hud.toast('Your fare is waiting — you need a car to pick them up', 2.2);
        return false;
      }
      return this.tryPickup(player);
    }
    if (t.phase === 'riding') {
      if (this.hud && this.hud.toast) {
        this.hud.toast('Fare aboard — ' + t.destination.name + ' · '
          + formatMetres(t.distanceLeft) + ' · ' + formatClock(t.timeLeft) + ' left', 2.0);
      }
      return true;
    }
    if (player.car) {
      t.timer = Math.min(t.timer, 0.6);
      if (this.hud && this.hud.toast) this.hud.toast('You put the word out — a fare will flag you down shortly', 2.0);
      return true;
    }
    if (this.hud && this.hud.toast) this.hud.toast('Taxi fares need a car — grab one, then press T', 2.2);
    return false;
  }

  nearPassenger(player) {
    const t = this.taxi;
    if (t.phase !== 'waiting' || !t.passenger || !player) return false;
    return dist2d(player.x, player.z, t.passenger.x, t.passenger.z) < TAXI_PICKUP_RADIUS;
  }

  // Board the passenger. The destination, fare and countdown are all
  // fixed in this moment, from the real distance across town, so the
  // panel the player reads is the contract the payment honours.
  tryPickup(player) {
    const t = this.taxi;
    if (t.phase !== 'waiting' || !t.passenger || !player || !player.car) return false;
    if (!this.nearPassenger(player)) {
      if (this.hud && this.hud.toast) this.hud.toast('Stop closer to your fare to pick them up', 1.8);
      return false;
    }
    const chosen = this.chooseDestination(t.passenger.x, t.passenger.z);
    if (!chosen.point) return false;
    t.destination = { x: chosen.point.x, z: chosen.point.z, name: chosen.point.name };
    t.tripDistance = chosen.distance;
    t.distanceLeft = chosen.distance;
    t.fare = this.fareForDistance(chosen.distance);
    t.timeTotal = this.timeForDistance(chosen.distance);
    t.timeLeft = t.timeTotal;
    t.damageTaken = 0;
    t.lastCarHealth = player.car.health;
    t.carUsed = player.car;
    t.outOfCarFor = 0;
    const passengerName = t.passenger.name;
    const passengerLine = t.passenger.line;
    this.clearPassengerFigure();
    this.buildDestinationMarker(t.destination);
    t.phase = 'riding';
    if (this.fx && this.fx.door) this.fx.door();
    if (this.hud && this.hud.toast) {
      this.hud.toast(passengerName + ': "' + passengerLine + '"', 3.4);
    }
    return true;
  }

  // A fare that ends badly: timeout, abandonment, a wrecked car, or
  // the run itself ending around the passenger. No payment, a counted
  // failure, a cooldown — and the street furniture is always cleaned
  // up, whatever the reason was.
  failFare(reason) {
    const t = this.taxi;
    if (t.phase !== 'waiting' && t.phase !== 'riding') return false;
    const wasRiding = t.phase === 'riding';
    this.clearPassengerFigure();
    this.clearDestinationMarker();
    t.phase = 'cooldown';
    t.timer = TAXI_COOLDOWN_MIN + 4;
    t.destination = null;
    t.carUsed = null;
    if (wasRiding) {
      G.taxiFails = (G.taxiFails || 0) + 1;
      if (this.fx && this.fx.fail) this.fx.fail();
      saveGame();
    }
    if (reason && this.hud && this.hud.toast) this.hud.toast(reason, 2.8);
    this.hidePanel();
    return true;
  }

  // A fare that ends well. Payment is the fare agreed at pickup plus
  // the live tip at the moment of arrival; both the count and the
  // lifetime earnings persist, and a best-fare record is kept for the
  // pause-menu stats line.
  completeFare() {
    const t = this.taxi;
    if (t.phase !== 'riding' || !t.destination) return false;
    const tip = this.liveTip();
    const paid = t.fare + tip;
    G.money += paid;
    G.totalEarned = (G.totalEarned || 0) + paid;
    G.faresDone = (G.faresDone || 0) + 1;
    G.taxiEarned = (G.taxiEarned || 0) + paid;
    G.taxiTips = (G.taxiTips || 0) + tip;
    if (paid > (G.taxiBestFare || 0)) G.taxiBestFare = paid;
    const destName = t.destination.name;
    this.clearDestinationMarker();
    t.phase = 'cooldown';
    t.timer = TAXI_COOLDOWN_MIN + Math.random() * (TAXI_COOLDOWN_MAX - TAXI_COOLDOWN_MIN);
    t.destination = null;
    t.carUsed = null;
    if (this.fx && this.fx.success) this.fx.success();
    if (this.hud && this.hud.banner) {
      this.hud.banner('FARE PAID', destName + ' · fare ' + formatCash(paid - tip)
        + (tip > 0 ? ' + tip ' + formatCash(tip) : ' · no tip'), '');
    }
    this.hidePanel();
    saveGame();
    return true;
  }

  // Called when the whole run ends (busted / wasted): a passenger does
  // not survive the fade to the hospital steps, and neither does a
  // waiting fare.
  cancelActiveFare() {
    if (this.taxi.phase === 'waiting' || this.taxi.phase === 'riding') {
      this.failFare(null);
    }
  }

  // ---------------------------------------------------------------
  // Taxi fares — per-frame work
  // ---------------------------------------------------------------

  updateTaxi(dt, player, canOffer) {
    const t = this.taxi;
    if (t.phase === 'cooldown') {
      this.hidePanel();
      if (!canOffer) return;
      t.timer -= dt;
      if (t.timer <= 0) {
        if (!this.spawnFare(player, false)) {
          // Wrong moment (on foot, wanted, a story driver at the
          // wheel): check again shortly rather than giving up.
          t.timer = 2.5;
        }
      }
      return;
    }
    if (t.phase === 'waiting') {
      t.waitLeft -= dt;
      // The waiting figure idles like a person, not a statue: a slow
      // turn toward the road, and the halo bobbing over their head.
      if (t.passenger) {
        if (t.passenger.mesh) {
          t.passenger.mesh.rotation.y = Math.sin(G.time * 0.7) * 0.5 + Math.PI * 0.25;
        }
        if (t.passenger.halo) {
          t.passenger.halo.position.y = 2.6 + Math.sin(G.time * 3.1) * 0.14;
        }
        if (t.passenger.ring) {
          const pulse = 1 + Math.sin(G.time * 3.4) * 0.07;
          t.passenger.ring.scaling.set(pulse, pulse, pulse);
        }
      }
      if (t.waitLeft <= 0) {
        this.failFare('Your fare gave up waiting and hailed someone else');
        return;
      }
      this.renderWaitingPanel(player);
      return;
    }
    if (t.phase === 'riding') {
      this.updateRide(dt, player);
    }
  }

  updateRide(dt, player) {
    const t = this.taxi;
    if (!t.destination) { this.failFare(null); return; }
    // Leaving the car starts the grace clock; getting back in — any
    // car, the passenger is not sentimental — stops it again.
    if (!player.car) {
      t.outOfCarFor += dt;
      if (t.outOfCarFor >= TAXI_EXIT_GRACE) {
        this.failFare('You walked away mid-fare — the passenger took another cab');
        return;
      }
    } else {
      t.outOfCarFor = 0;
      if (t.carUsed !== player.car) {
        // A fresh car mid-fare: the damage watch restarts from this
        // car's health, so swapping wrecks cannot launder a tip.
        t.carUsed = player.car;
        t.lastCarHealth = player.car.health;
      }
      const drop = t.lastCarHealth - player.car.health;
      if (drop > 0) {
        t.damageTaken += drop;
        t.lastCarHealth = player.car.health;
      }
      if (player.car.dead || player.car.health <= 0) {
        this.failFare('The car died mid-fare — no tip covers that');
        return;
      }
    }
    t.timeLeft -= dt;
    if (t.timeLeft <= 0) {
      this.failFare('Out of time — the fare walked the last stretch');
      return;
    }
    t.distanceLeft = dist2d(player.x, player.z, t.destination.x, t.destination.z);
    // The destination column breathes gently so it can be picked out
    // of the skyline at distance without strobing.
    if (t.beacon && t.beacon.material) {
      t.beacon.material.alpha = 0.24 + 0.10 * (0.5 + 0.5 * Math.sin(G.time * 2.2));
    }
    if (t.beaconRing) {
      const pulse = 1 + Math.sin(G.time * 3.0) * 0.08;
      t.beaconRing.scaling.set(pulse, pulse, pulse);
    }
    if (player.car && t.distanceLeft < TAXI_DROP_RADIUS) {
      this.completeFare();
      return;
    }
    this.renderRidePanel();
  }

  // ---------------------------------------------------------------
  // Taxi fares — the dedicated panel
  //
  // The panel is a small card the module owns outright. It is hidden
  // whenever no fare is live, shows the pickup prompt while waiting,
  // and becomes the contract readout while riding: destination,
  // distance left, countdown, fare, and the tip currently on the
  // table. The main HUD prompt line stays free for everything else.
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

  renderWaitingPanel(player) {
    const t = this.taxi;
    if (!t.passenger) return;
    const d = dist2d(player.x, player.z, t.passenger.x, t.passenger.z);
    if (player.car && d < TAXI_PICKUP_RADIUS) {
      this.setPanel(
        'TAXI FARE — ' + t.passenger.name.toUpperCase(),
        'Press T to pick up',
        formatMetres(d) + ' away · they can wait ' + formatClock(t.waitLeft) + ' more',
      );
    } else if (player.car) {
      this.setPanel(
        'TAXI FARE — ' + t.passenger.name.toUpperCase(),
        'Stop at the cyan ring to pick them up',
        formatMetres(d) + ' away · they can wait ' + formatClock(t.waitLeft) + ' more',
      );
    } else {
      this.setPanel(
        'TAXI FARE — ' + t.passenger.name.toUpperCase(),
        'Get in a car, stop at the cyan ring, press T',
        formatMetres(d) + ' away · they can wait ' + formatClock(t.waitLeft) + ' more',
      );
    }
  }

  renderRidePanel() {
    const t = this.taxi;
    if (!t.destination) return;
    const urgent = t.timeLeft < 20 ? ' — hurry' : '';
    const awayNote = t.outOfCarFor > 0
      ? ' · back in a car within ' + Math.max(0, Math.ceil(TAXI_EXIT_GRACE - t.outOfCarFor)) + 's!'
      : '';
    this.setPanel(
      'TAXI — ' + t.destination.name.toUpperCase(),
      formatMetres(t.distanceLeft) + ' to go · ' + formatClock(t.timeLeft) + ' left' + urgent,
      'Fare ' + formatCash(t.fare) + ' · tip on the table ' + formatCash(this.liveTip()) + awayNote,
    );
  }

  // The prompt main.js shows while driving, when this module has the
  // more urgent thing to say. Returns an HTML string, or null when the
  // main prompt should speak for itself.
  pickupPromptHtml(player) {
    if (!this.nearPassenger(player)) return null;
    return 'Press <b>T</b> to pick up your fare';
  }

  // ---------------------------------------------------------------
  // Frame entry point, minimap, lifecycle
  // ---------------------------------------------------------------

  // Called once per frame from the main loop, after missions have had
  // their turn. canOffer is false while a story job is active, so a
  // fare never spawns into the middle of one.
  update(dt, player, opts) {
    if (!player) return;
    const canOffer = !opts || opts.canOffer !== false;
    this.updatePages(dt, player);
    this.updateTaxi(dt, player, canOffer);
    this.refreshCounter();
  }

  // Blips are drawn straight onto the minimap canvas after the HUD has
  // drawn its own layer, using the same world-to-map transform the HUD
  // uses (centre on the player, 300 world metres across the disc).
  // Pages appear only inside their reveal radius — the hunt is the
  // point — while a live fare is always charted.
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
    for (const entry of this.pages) {
      if (entry.taken) continue;
      const d = dist2d(player.x, player.z, entry.spot.x, entry.spot.z);
      if (d < PAGE_REVEAL_RADIUS) dot(entry.spot.x, entry.spot.z, 2.3, '#ffe98a', 'rgba(0,0,0,0.55)');
    }
    const t = this.taxi;
    if (t.phase === 'waiting' && t.passenger) {
      dot(t.passenger.x, t.passenger.z, 3.1, '#5ef2ff', '#ffffff');
    }
    if (t.phase === 'riding' && t.destination) {
      dot(t.destination.x, t.destination.z, 3.4, '#ff5ea8', '#ffffff');
    }
    ctx.restore();
  }

  // A brand-new game: the ledger is whole again and no fare has ever
  // been run. Meshes follow the state, the taxi machine returns to its
  // first cooldown, and any live fare furniture is swept away.
  resetAll() {
    if (!Array.isArray(G.ledgerPages)) G.ledgerPages = [];
    G.ledgerPages = [];
    G.ledgerBonusMid = false;
    G.ledgerBonusFull = false;
    G.faresDone = 0;
    G.taxiEarned = 0;
    G.taxiTips = 0;
    G.taxiFails = 0;
    G.taxiBestFare = 0;
    this.clearPassengerFigure();
    this.clearDestinationMarker();
    this.taxi.phase = 'cooldown';
    this.taxi.timer = TAXI_FIRST_DELAY;
    this.taxi.destination = null;
    this.taxi.carUsed = null;
    this.hidePanel();
    this.syncPageVisibility();
  }

  // A continued game: the save has already been folded into G by
  // state.js, so all that remains is to make the world agree with it.
  restoreFromSave() {
    if (!Array.isArray(G.ledgerPages)) G.ledgerPages = [];
    this.syncPageVisibility();
    this.hidePanel();
  }

  // A plain-data picture of both systems, for verification harnesses
  // and for anyone debugging from the console. No meshes, no
  // functions — just the facts, safe to serialise.
  getSnapshot() {
    const t = this.taxi;
    return {
      pagesTotal: PAGE_TOTAL,
      pagesCollected: this.collectedCount(),
      pageIds: Array.isArray(G.ledgerPages) ? G.ledgerPages.slice() : [],
      bonusMid: !!G.ledgerBonusMid,
      bonusFull: !!G.ledgerBonusFull,
      faresDone: G.faresDone || 0,
      taxiEarned: G.taxiEarned || 0,
      taxiTips: G.taxiTips || 0,
      taxiFails: G.taxiFails || 0,
      taxiBestFare: G.taxiBestFare || 0,
      taxiPhase: t.phase,
      taxiTimeLeft: Math.round(t.timeLeft * 10) / 10,
      taxiFare: t.fare || 0,
      taxiDestination: t.destination ? t.destination.name : null,
      passengerWaiting: t.passenger ? t.passenger.name : null,
    };
  }
}
