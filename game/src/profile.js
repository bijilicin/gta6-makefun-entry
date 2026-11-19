// Solmaris Heat — career profile module (round 5, authored in-session).
//
// Two proof-of-depth systems live in this file, and both read nothing
// but real game state:
//
//   1. The career stats screen — a full-screen view (pause menu ->
//      CAREER STATS, or the window.__profile staging handle) whose
//      completion percentage and every single number are computed
//      from the live G object at render time: story missions, Ledger
//      Pages, taxi fares, street races, the Beach Sprint side job and
//      hidden stashes for the checklist, plus the lifetime counters
//      (cash earned, distance driven, vehicles entered, times busted,
//      highest wanted, time played) for the career panel. Nothing on
//      the screen is hardcoded; change G and the screen changes.
//
//   2. The police dispatch panel — a HUD card shown while the wanted
//      level is 1 or more. Its rows are built, a few times a second,
//      from the police system's actual unit lists: pursuit/searching
//      cars from police.units, roadblock cars from police.blockers,
//      and the helicopter only while it is genuinely airborne at
//      five stars. Each row carries the unit's label, its true role
//      and its live distance to Rina. At wanted 0 the panel hides.
//
// This module also owns the per-frame bookkeeping for the round-5
// counters that state.js persists (distanceDrivenM, vehiclesEntered,
// highestWanted, timePlayedSec): it watches the live frame — car
// entry edges, driven distance while in a car, wanted peaks and
// played time — so no other system had to change its behaviour.
// Cash earned and times busted were already tracked truthfully by
// the older systems (G.totalEarned, G.timesBusted) and are read
// from there. The module owns no lights and no meshes: it is DOM
// and arithmetic only.

import { G, clamp, dist2d } from './state.js';

// ---------------------------------------------------------------------
// Targets. A completion percentage needs denominators, and these are
// the game's real ones where they exist (10 story missions, 30 Ledger
// Pages, 3 race courses, 10 hidden stashes) plus two sensible career
// goals where the game itself is open-ended (10 taxi fares is a solid
// working week for a cabbie; the Beach Sprint is a single side job).
// ---------------------------------------------------------------------

export const STORY_TOTAL = 10;
export const LEDGER_TOTAL = 30;
export const TAXI_TARGET = 10;
export const RACE_COURSES = 3;
export const STASH_TOTAL = 10;

// The Beach Sprint is story mission index 1 (Tito's checkpoint race,
// the job that wins Rina her pistol): it counts as done once the
// campaign has moved past it.
export function beachSprintDone() {
  return (G.missionIndex || 0) >= 2;
}

// ---------------------------------------------------------------------
// Small formatting helpers, shared by the screen and the snapshot.
// ---------------------------------------------------------------------

function formatCash(amount) {
  return '$' + Math.round(amount || 0).toLocaleString('en-US');
}

function formatKm(metres) {
  return ((metres || 0) / 1000).toFixed(1) + ' km';
}

function formatPlayed(sec) {
  const totalMin = Math.floor((sec || 0) / 60);
  if (totalMin < 60) return totalMin + ' min';
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h + ' h ' + String(m).padStart(2, '0') + ' min';
}

// ---------------------------------------------------------------------
// The career computation — the single source the screen, the staging
// handle and the verification harness all read, so the numbers can
// never drift apart. Pure: it reads G and returns plain data.
// ---------------------------------------------------------------------

export function computeCareerStats() {
  const storyDone = clamp(Math.floor(G.missionIndex) || 0, 0, STORY_TOTAL);
  const ledgerDone = Array.isArray(G.ledgerPages)
    ? clamp(G.ledgerPages.length, 0, LEDGER_TOTAL) : 0;
  const faresDone = Math.max(0, Math.floor(G.faresDone) || 0);
  const racesWon = Math.max(0, Math.floor(G.racesWon) || 0);
  const racesDone = Math.max(0, Math.floor(G.racesDone) || 0);
  const coursesTimed = (G.raceBestTimes && typeof G.raceBestTimes === 'object')
    ? Object.keys(G.raceBestTimes).length : 0;
  const stashes = clamp(Math.floor(G.stashesFound) || 0, 0, STASH_TOTAL);
  const beach = beachSprintDone() ? 1 : 0;

  const rows = [
    { key: 'story', label: 'Story missions', value: storyDone, target: STORY_TOTAL, frac: storyDone / STORY_TOTAL },
    { key: 'ledger', label: 'Ledger Pages', value: ledgerDone, target: LEDGER_TOTAL, frac: ledgerDone / LEDGER_TOTAL },
    { key: 'taxi', label: 'Taxi fares', value: faresDone, target: TAXI_TARGET, frac: clamp(faresDone / TAXI_TARGET, 0, 1) },
    { key: 'racewins', label: 'Street races won', value: racesWon, target: RACE_COURSES, frac: clamp(racesWon / RACE_COURSES, 0, 1) },
    { key: 'beach', label: 'Side job — Beach Sprint', value: beach, target: 1, frac: beach },
    { key: 'stashes', label: 'Hidden stashes', value: stashes, target: STASH_TOTAL, frac: stashes / STASH_TOTAL },
  ];
  const mean = rows.reduce((sum, r) => sum + r.frac, 0) / rows.length;
  const completionPct = Math.round(mean * 100);

  const counters = {
    cashEarned: Math.max(0, Math.floor(G.totalEarned) || 0),
    distanceKm: Math.round(((G.distanceDrivenM || 0) / 1000) * 10) / 10,
    distanceM: Math.max(0, G.distanceDrivenM || 0),
    vehiclesEntered: Math.max(0, Math.floor(G.vehiclesEntered) || 0),
    timesBusted: Math.max(0, Math.floor(G.timesBusted) || 0),
    highestWanted: clamp(Math.floor(G.highestWanted) || 0, 0, 5),
    timePlayedSec: Math.max(0, G.timePlayedSec || 0),
    timePlayedMin: Math.floor((G.timePlayedSec || 0) / 60),
    racesDone,
    coursesTimed,
    taxiEarned: Math.max(0, Math.floor(G.taxiEarned) || 0),
    raceEarnings: Math.max(0, Math.floor(G.raceEarnings) || 0),
    cashOnHand: Math.floor(G.money) || 0,
  };
  return { completionPct, rows, counters };
}

// ---------------------------------------------------------------------
// The profile system: owns the two DOM cards (stats screen + dispatch
// panel), the counter bookkeeping, and the staging handle's data.
// DOM handles are optional throughout — if the page shell ever drops
// a container, the arithmetic still runs and the game never breaks.
// ---------------------------------------------------------------------

export class ProfileSystem {
  constructor(opts) {
    const options = opts || {};
    this.onCloseStats = typeof options.onCloseStats === 'function'
      ? options.onCloseStats : null;

    this.screenEl = document.getElementById('statsscreen');
    this.completionEl = document.getElementById('statscompletion');
    this.barFillEl = document.getElementById('statsbarfill');
    this.checklistEl = document.getElementById('statschecklist');
    this.countersEl = document.getElementById('statscounters');
    this.dispatchEl = document.getElementById('dispatchpanel');
    this.dispatchTitleEl = document.getElementById('dispatchtitle');
    this.dispatchRowsEl = document.getElementById('dispatchrows');

    this.statsOpen = false;
    this.dispatchVisible = false;
    this.lastDispatchRows = [];
    this._dispatchTimer = 0;
    this._statsTimer = 0;
    this._wasInCar = false;
    this._lastCar = null;

    const closeBtn = document.getElementById('btn-stats-close');
    if (closeBtn) closeBtn.addEventListener('click', () => this.closeStats());
    this.hideDispatch();
    if (this.screenEl) this.screenEl.classList.add('hidden');
  }

  // ---------------------------------------------------------------
  // Career stats screen
  // ---------------------------------------------------------------

  isOpen() { return this.statsOpen; }

  openStats() {
    this.statsOpen = true;
    this.renderStats();
    if (this.screenEl) this.screenEl.classList.remove('hidden');
    return true;
  }

  closeStats() {
    if (!this.statsOpen) return false;
    this.statsOpen = false;
    if (this.screenEl) this.screenEl.classList.add('hidden');
    if (this.onCloseStats) this.onCloseStats();
    return true;
  }

  // Render the whole screen from a fresh computeCareerStats() call.
  // Every figure lands in the DOM twice — as the text the player
  // reads and as a data-value attribute — so a verification harness
  // can compare the screen against state without parsing prose.
  renderStats() {
    const stats = computeCareerStats();
    if (this.completionEl) {
      this.completionEl.textContent = stats.completionPct + '%';
      this.completionEl.dataset.value = String(stats.completionPct);
    }
    if (this.barFillEl) {
      this.barFillEl.style.width = stats.completionPct + '%';
    }
    if (this.checklistEl) {
      this.checklistEl.innerHTML = '';
      for (const row of stats.rows) {
        const div = document.createElement('div');
        div.className = 'statsrow';
        div.dataset.stat = row.key;
        div.dataset.value = String(row.value);
        div.dataset.target = String(row.target);
        const label = document.createElement('span');
        label.className = 'statsrowlabel';
        label.textContent = row.label;
        const val = document.createElement('span');
        val.className = 'statsrowvalue';
        val.textContent = row.value + ' / ' + row.target;
        const track = document.createElement('div');
        track.className = 'statsrowtrack';
        const fill = document.createElement('div');
        fill.className = 'statsrowfill';
        fill.style.width = Math.round(row.frac * 100) + '%';
        track.appendChild(fill);
        div.appendChild(label);
        div.appendChild(val);
        div.appendChild(track);
        this.checklistEl.appendChild(div);
      }
    }
    if (this.countersEl) {
      const c = stats.counters;
      const cells = [
        { key: 'cashEarned', label: 'CASH EARNED', text: formatCash(c.cashEarned), value: c.cashEarned },
        { key: 'distanceKm', label: 'DISTANCE DRIVEN', text: formatKm(c.distanceM), value: c.distanceKm },
        { key: 'vehiclesEntered', label: 'VEHICLES ENTERED', text: String(c.vehiclesEntered), value: c.vehiclesEntered },
        { key: 'timesBusted', label: 'TIMES BUSTED', text: String(c.timesBusted), value: c.timesBusted },
        { key: 'highestWanted', label: 'HIGHEST WANTED', text: '★'.repeat(c.highestWanted) || '—', value: c.highestWanted },
        { key: 'timePlayed', label: 'TIME PLAYED', text: formatPlayed(c.timePlayedSec), value: c.timePlayedMin },
      ];
      this.countersEl.innerHTML = '';
      for (const cell of cells) {
        const div = document.createElement('div');
        div.className = 'statscell';
        div.dataset.counter = cell.key;
        div.dataset.value = String(cell.value);
        const lab = document.createElement('div');
        lab.className = 'statscelllabel';
        lab.textContent = cell.label;
        const val = document.createElement('div');
        val.className = 'statscellvalue';
        val.textContent = cell.text;
        div.appendChild(lab);
        div.appendChild(val);
        this.countersEl.appendChild(div);
      }
    }
    this.lastStats = stats;
    return stats;
  }

  // A believable mid-game career, written purely through state
  // fields (the same fields a real run would have produced): six
  // story jobs done, the ledger part-collected, a working taxi
  // record, one race win on the board, and counters that have
  // clearly lived. Used by the ?shot=stats staging; the caller in
  // main.js re-syncs the page/stash meshes to match afterwards.
  stageMidGameState() {
    G.missionIndex = 6;
    G.storyDone = false;
    G.campaignDone = false;
    G.hasGun = true;
    G.ammoMag = G.magSize;
    G.ammoReserve = 36;
    G.reloading = 0;
    G.ledgerPages = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
    G.ledgerBonusMid = false;
    G.ledgerBonusFull = false;
    G.faresDone = 7;
    G.taxiEarned = 612;
    G.taxiTips = 148;
    G.taxiFails = 1;
    G.taxiBestFare = 121;
    G.racesWon = 1;
    G.racesDone = 3;
    G.raceEarnings = 320;
    G.raceBestTimes = { 'harbor-sprint': 132.4 };
    G.stashesFound = 4;
    G.stashTaken = [0, 1, 2, 3];
    G.totalEarned = 4850;
    G.money = 1240;
    G.displayedMoney = 1240;
    G.distanceDrivenM = 18400;
    G.vehiclesEntered = 23;
    G.timesBusted = 2;
    G.timesWasted = 1;
    G.highestWanted = 4;
    G.timePlayedSec = 47 * 60 + 24;
    G.carsStolen = 9;
    G.resprayCount = 3;
    G.shotsFired = 86;
    return computeCareerStats();
  }

  // A brand-new game wipes the round-5 counters (the older lifetime
  // fields are reset by main.js alongside them).
  resetCareer() {
    G.distanceDrivenM = 0;
    G.vehiclesEntered = 0;
    G.highestWanted = 0;
    G.timePlayedSec = 0;
    this._wasInCar = false;
    this._lastCar = null;
    this.hideDispatch();
    if (this.statsOpen) this.renderStats();
  }

  // ---------------------------------------------------------------
  // Police dispatch panel
  //
  // Roles are the ones the police code actually implements: a unit
  // in police.units is PURSUIT while the PD has eyes on Rina and
  // SEARCHING once wantedState flips to 'searching' (the same flag
  // the wanted stars flash on); a unit in police.blockers is a
  // ROADBLOCK car, parked across an avenue; the helicopter joins
  // only at five stars, while its group is enabled in the scene.
  // Dead units are not dispatched units and never get a row.
  // ---------------------------------------------------------------

  buildDispatchRows(police, player) {
    const rows = [];
    if (!police || !player) return rows;
    const searching = G.wantedState === 'searching';
    const units = Array.isArray(police.units) ? police.units : [];
    units.forEach((u, i) => {
      if (!u || u.dead || u.health <= 0) return;
      rows.push({
        label: 'UNIT ' + String(i + 1).padStart(2, '0'),
        role: searching ? 'SEARCHING' : 'PURSUIT',
        distance: Math.round(dist2d(player.x, player.z, u.x, u.z)),
      });
    });
    const blockers = Array.isArray(police.blockers) ? police.blockers : [];
    blockers.forEach((b, i) => {
      if (!b || b.dead || b.health <= 0) return;
      rows.push({
        label: 'BLOCK ' + (i + 1),
        role: 'ROADBLOCK',
        distance: Math.round(dist2d(player.x, player.z, b.x, b.z)),
      });
    });
    const heli = police.heli;
    if (heli && heli.group && G.wanted >= 5) {
      const grp = heli.group;
      const enabled = typeof grp.isEnabled === 'function'
        ? grp.isEnabled() : grp.isVisible !== false;
      if (enabled && grp.position) {
        rows.push({
          label: 'HELI 1',
          role: searching ? 'SEARCHING' : 'PURSUIT',
          distance: Math.round(dist2d(player.x, player.z, grp.position.x, grp.position.z)),
        });
      }
    }
    rows.sort((a, b) => a.distance - b.distance);
    return rows;
  }

  renderDispatch(police, player) {
    const rows = this.buildDispatchRows(police, player);
    this.lastDispatchRows = rows;
    if (!this.dispatchEl) return rows;
    if (G.wanted < 1) { this.hideDispatch(); return rows; }
    this.dispatchVisible = true;
    this.dispatchEl.classList.remove('hidden');
    if (this.dispatchTitleEl) {
      this.dispatchTitleEl.textContent =
        'SOLMARIS PD — ' + rows.length + (rows.length === 1 ? ' UNIT' : ' UNITS');
      this.dispatchTitleEl.dataset.count = String(rows.length);
    }
    if (this.dispatchRowsEl) {
      this.dispatchRowsEl.innerHTML = '';
      for (const row of rows) {
        const div = document.createElement('div');
        div.className = 'dispatchrow';
        div.dataset.label = row.label;
        div.dataset.role = row.role;
        div.dataset.distance = String(row.distance);
        const lab = document.createElement('span');
        lab.className = 'dispatchlabel';
        lab.textContent = row.label;
        const role = document.createElement('span');
        role.className = 'dispatchrole';
        role.textContent = row.role;
        const dist = document.createElement('span');
        dist.className = 'dispatchdist';
        dist.textContent = row.distance + ' m';
        div.appendChild(lab);
        div.appendChild(role);
        div.appendChild(dist);
        this.dispatchRowsEl.appendChild(div);
      }
    }
    return rows;
  }

  hideDispatch() {
    this.dispatchVisible = false;
    this.lastDispatchRows = G.wanted >= 1 ? this.lastDispatchRows : [];
    if (this.dispatchEl) this.dispatchEl.classList.add('hidden');
  }

  getDispatchSnapshot() {
    return {
      visible: this.dispatchVisible && G.wanted >= 1,
      wanted: G.wanted,
      wantedState: G.wantedState,
      rows: this.lastDispatchRows.map((r) => ({ ...r })),
    };
  }

  // ---------------------------------------------------------------
  // Per-frame bookkeeping + panel refresh
  //
  // Called from the main loop (and from the ?shot= settle loop) with
  // the live player and police system. Counter work runs only in
  // live play (running, unpaused, not over); the dispatch panel and
  // an open stats screen refresh on throttles — a few times a second
  // is live enough for a roster, and exact enough for a screenshot.
  // ---------------------------------------------------------------

  // Align the car-entry detector with a staged scene, so a
  // screenshot setup that begins inside a car does not bank a
  // phantom vehicle entry on its first frame.
  syncCarEdge(player) {
    this._wasInCar = !!(player && player.car);
    this._lastCar = player ? (player.car || null) : null;
  }

  update(dt, player, police) {
    if (G.running && !G.paused && !G.over && player) {
      G.timePlayedSec = (G.timePlayedSec || 0) + dt;
      // A vehicle entry is counted when the car Rina sits in changes
      // to one she was not already driving — foot-to-car, or a swap
      // straight into a different car. Watching the car's identity
      // (not just the in-car flag) means an exit and a fresh entry
      // that land between two frames still register as an entry.
      const carNow = player.car || null;
      if (carNow && carNow !== this._lastCar) {
        G.vehiclesEntered = (G.vehiclesEntered || 0) + 1;
      }
      this._lastCar = carNow;
      this._wasInCar = !!carNow;
      if (player.car) {
        G.distanceDrivenM = (G.distanceDrivenM || 0)
          + Math.abs(player.car.speed || 0) * dt;
      }
      if (G.wanted > (G.highestWanted || 0)) G.highestWanted = G.wanted;
    }
    if (G.wanted < 1) {
      if (this.dispatchVisible) this.hideDispatch();
    } else {
      this._dispatchTimer -= dt;
      if (this._dispatchTimer <= 0) {
        this._dispatchTimer = 0.25;
        this.renderDispatch(police, player);
      }
    }
    if (this.statsOpen) {
      this._statsTimer -= dt;
      if (this._statsTimer <= 0) {
        this._statsTimer = 0.5;
        this.renderStats();
      }
    }
  }

  // A plain-data picture of both systems, for verification harnesses
  // and the staging handle: no DOM, no functions, safe to serialise.
  getSnapshot() {
    return {
      statsOpen: this.statsOpen,
      stats: computeCareerStats(),
      dispatch: this.getDispatchSnapshot(),
    };
  }
}
