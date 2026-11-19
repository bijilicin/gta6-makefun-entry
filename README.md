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

## Run it

Requires Node.js 22+ and a desktop browser.

```sh
node serve.ts            # serves game/ at http://127.0.0.1:8080
```

Then open http://127.0.0.1:8080 in Chrome. WASD to move, E to enter cars,
F to punch, click/Space to shoot (once armed), P or Esc to pause.

To build the submission dossier instead:

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts
```

## Layout

- `game/index.html` — page shell, HUD and menus
- `game/src/` — the game's own modules (state, world, vehicles, peds,
  police, player, missions, hud, audio, nico, particles, main)
- `game/vendor/babylon.min.js` — Babylon.js, vendored as a minified library
- `screenshots/` — real renders of the game at 1280×720
- `main.ts` — copies the game and screenshots to the output dir and writes
  `dossier.json`

## License

MIT — see `LICENSE`.
