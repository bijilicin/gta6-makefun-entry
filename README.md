# Solmaris Heat

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/bijilicin/gta6-makefun-entry/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/bijilicin/gta6-makefun-entry/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

An original 3D open-world crime game set in Solmaris, a sun-soaked coastal
city. Play as Rina Vale, with boat mechanic Nico Herrera at your side: one
easy marina pickup goes wrong, and the cash bag holds a ledger chip that
half the city — Captain Voss's task force included — would kill for. Ten
jobs, three acts: get out alive, together.

Built by an AI agent for the [make.fun](https://make.fun/bounty/gta6-01) "Make GTA 6"
bounty (gta6-01). All names, art and sound are original — no Rockstar or GTA IP.

## Engine

**v3 runs on Babylon.js** (vendored UMD build in `game/vendor/`, fully
offline), ported from the earlier three.js build with gameplay, story and
mechanics unchanged. The scene runs right-handed so the original heading
and rotation model carries over exactly.

- Image-based lighting: a procedural golden-hour equirect sky becomes the
  scene environment (`EquiRectangularCubeTexture`), lighting every PBR
  material; a shadow-casting directional sun (close-exponential shadow
  map) rides with the player, plus a hemispheric fill.
- PBR surfaces throughout: Sobel-derived bump maps and per-surface
  roughness maps (packed metallic-roughness) generated at runtime from
  the procedural canvas textures — facades, asphalt, crosswalks — plus
  blob contact shadows, a sun disc, drifting cloud billboards and damp
  reflective patches on the beach road.
- `DefaultRenderingPipeline`: ACES tone mapping, FXAA, low bloom (sun
  glints and lightbars only), vignette and a whisper of animated grain.
  The screenshot scenes render through the same pipeline.

## Features

- Full city: pastel golden-hour streets, beach and pier, lighthouse,
  marina, cafe, hospital and 65+ building colliders.
- On foot and in cars: traffic AI with lanes, perception probes, IDM-style
  car-following, junction yield and anti-interpenetration push-out (cars
  no longer rear-end or drive through each other), 30 pedestrian agents,
  enter/steal 30+ vehicles, collisions and staged damage (smoke, fire,
  blown tires that pull the car sideways).
- Information-based wanted system: 0–5 stars that stay solid only while a
  unit actually sees you, a search zone around your last known position,
  roadblocks and spike strips at 3–4 stars, a helicopter at 5, and
  Rico's Respray bay to ditch the heat.
- A 10-mission, three-act campaign (courier, checkpoint race, theft to
  order, an ambush escape, a spook-meter tail, a marina robbery, an
  escort with a shooter-seat leg, a destruction rampage, a boat run and
  a multi-stage finale), a persistent companion (Nico: follow, shotgun,
  aiDriver stages), a drivable motorboat, and side activities — taxi
  fares, Rosa's debt collection and 10 hidden stashes.
- HUD with GPS minimap, speedometer, mission panel, dialogue and chapter
  cards, pause menu and `solmaris-save-v2` localStorage saves.
- Sound is synthesized live with WebAudio — engine, sirens, shots,
  jingles and a 3-station radio. The game makes zero network requests
  and plays fully offline.

## Side activities (round 3)

Two new free-roam systems live in `game/src/activities.js`, written for
this round:

- **Ledger Pages** — 30 pages from Sal Prumo's ledger are scattered
  across Solmaris: some hand-placed at landmarks, alleys and awnings,
  the rest dropped along the kerbs by a seeded scatter. A page glows
  gold, bobs and spins, and pings on the minimap when you are close.
  Walk or drive through one to collect it: +$25 a page, a +$500 bonus
  at 15 pages, and +$1,500 with a "LEDGER COMPLETE" banner at all 30.
  The counter sits under the weapon box, and collected pages persist
  in the usual `solmaris-save-v2` save.
- **Taxi fares** — while you are driving, a passenger flags you down
  at a kerb (cyan ring, and a panel naming them). Stop close and press
  **T** to pick them up: you get a named destination across town (pink
  marker), a countdown, and a fare of base + distance shown live on
  the taxi panel. Arrive in time for the fare plus a tip that grows
  with the time left and shrinks with every dent; run out of time, or
  leave the car for more than a few seconds, and the fare walks.
  Pressing **T** in a car with no fare waiting puts the word out and
  hurries the next one. Fares completed and lifetime taxi earnings
  persist in the save and appear in the pause-menu stats.

## Street races (round 4)

A third free-roam system lives in `game/src/races.js`, written for
this round: checkpoint street races under the Harbor Sprint banner.

- **Three start markers** stand across the city — an orange ring, a
  soft column and a floating flag icon: Harbor Sprint on the beach
  road in the south-east, Downtown Dash around the central blocks,
  and the Lighthouse Run from the south-east corner clear across
  town. Drive into a ring in any car and press **G** to enter.
- **Entry fees scale with route length** (measured leg by leg when
  the courses are built): the longer the course, the dearer the
  grid and the richer the purse — 1st pays four times the fee, 2nd
  doubles it, 3rd refunds it, 4th pays nothing.
- **Three rival drivers** in ordinary street cars run the same
  checkpoint route: Vex Marlowe, Sana Iqbal and Bruno Fenn, each
  with their own pace and line, including honest recovery when one
  of them wedges a corner.
- **Checkpoints** are large glowing orange rings shown one at a
  time, with a skyline column, a next-ring blip and the rivals
  charted on the minimap. A dedicated race panel shows your live
  position (1st–4th), checkpoint x of y, the elapsed clock with
  tenths, and the gap in metres to the next ring, plus the time
  limit and the car you are chasing.
- **Fail states** end a race cleanly with no refund: out of time,
  your car wrecked, or out of the car for more than six seconds.
  Finished races bank wins, finishes and lifetime prize earnings,
  and your **best time per course persists** in the usual
  `solmaris-save-v2` save (older saves load with an empty racing
  record). Each grid reopens after a short cooldown.

## Career profile & dispatch (round 5)

A proof-of-depth round lives in `game/src/profile.js`, written for
this round:

- **Career stats screen** — from the pause menu's **CAREER STATS**
  button (or the `window.__profile` staging handle): a full-screen
  "SOLMARIS — CAREER" view over the dimmed city, headed by a big
  completion percentage and progress bar. The percentage is the mean
  of six real completion fractions, every one computed from live
  state at render time — story missions /10, Ledger Pages /30, taxi
  fares against a 10-fare career goal, street races won /3 courses,
  the Beach Sprint side job (done once the campaign has passed it),
  and hidden stashes /10. Beside the checklist, a career counters
  panel reads the lifetime record: total cash earned
  (`G.totalEarned`, fed by mission, side-activity, race, stash and
  fare income), distance driven in km, vehicles entered, times
  busted, highest wanted level reached, and time played.
- **New persisted counters** — `distanceDrivenM`, `vehiclesEntered`,
  `highestWanted` and `timePlayedSec` join the existing
  `solmaris-save-v2` save in `state.js`, with clean zero defaults so
  older saves load as an empty career. `profile.js` advances them
  from the live frame: a counter ticks on each foot-to-car entry
  edge, distance accrues from the driven car's real speed, the
  wanted peak follows `G.wanted`, and played time accrues while the
  game runs unpaused.
- **Police dispatch panel** — while the wanted level is 1 or more, a
  HUD card at the top left lists the *actual* response: one row per
  live unit in the police system's own lists, built a few times a
  second. Pursuit cars are `PURSUIT` while the PD has eyes on Rina
  and `SEARCHING` once the wanted state flips to searching (the same
  flag that flashes the stars), roadblock cars are `ROADBLOCK`, and
  the helicopter appears only while it is genuinely airborne at
  five stars — each row with the unit's live distance in metres.
  The header counts the real units ("SOLMARIS PD — N UNITS") and
  the panel hides completely at wanted 0. No row is ever invented.

The screenshot set was recomposed around these systems: the cover
is a wanted-3 chase with the dispatch panel live, the city shot
pairs a Ledger Page pickup with a waiting taxi fare, the race shot
keeps the round-4 Harbor Sprint composition, and the fourth shot is
the career stats screen itself at a staged mid-game record.

## Run it

Requires Node.js 22+ and a desktop browser.

```sh
node serve.ts            # serves game/ at http://127.0.0.1:8080
```

Then open http://127.0.0.1:8080 in Chrome. WASD to move, E to enter cars,
T to pick up a taxi fare, G to enter a street race at an orange ring,
F to punch, click/Space to shoot (once armed), P or Esc to pause.

To build the submission dossier instead:

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts
```

## Layout

- `game/index.html` — page shell, HUD and menus
- `game/src/` — the game's own modules (state, world, vehicles, peds,
  police, player, missions, hud, audio, nico, particles, activities, races, profile, main)
- `game/vendor/babylon.min.js` — Babylon.js, vendored as a minified library
- `screenshots/` — real renders of the game at 1280×720
- `main.ts` — copies the game and screenshots to the output dir and writes
  `dossier.json`

## License

MIT — see `LICENSE`.
