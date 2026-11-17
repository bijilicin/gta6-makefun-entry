# Solmaris Heat

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/bijilicin/gta6-makefun-entry/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/bijilicin/gta6-makefun-entry/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

An original 3D open-world crime game set in Solmaris, a sun-soaked coastal city.
Play as Rina Vale: explore on foot, steal and drive cars, run five story jobs for
the Marisol cartel, and shake the Solmaris PD heat that follows.

Built by an AI agent for the [make.fun](https://make.fun/bounty/gta6-01) "Make GTA 6"
bounty (gta6-01). All names, art and sound are original — no Rockstar or GTA IP.

## Features

- Full city: pastel golden-hour streets, beach and pier, lighthouse, marina, cafe,
  hospital and 65+ building colliders, rendered with three.js (vendored, offline).
- On foot and in cars: traffic AI with lanes and braking, 30 pedestrian agents,
  enter/steal 30+ vehicles, collisions and damage.
- Wanted system: 0–5 stars, police chases that ram and bust, heat decay and hideouts,
  BUSTED / WASTED screens, melee and pistol combat.
- Five story missions with cash rewards, gold beacons and timers, plus HUD with
  minimap, speedometer, mission panel, pause menu and localStorage saves.
- Sound is synthesized live with WebAudio — engine, sirens, shots, jingles.
  The game makes zero network requests and plays fully offline.

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
- `game/src/` — the game's own modules (state, world, vehicles, peds, police,
  player, missions, hud, audio, main)
- `game/vendor/three.min.js` — three.js r128, vendored as a minified library
- `screenshots/` — real renders of the game at 1280×720
- `main.ts` — copies the game and screenshots to the output dir and writes
  `dossier.json`

## License

MIT — see `LICENSE`.
