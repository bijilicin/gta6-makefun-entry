// World building for Solmaris: a sun-soaked coastal city on a regular road
// grid, with pastel tower blocks, palm-lined streets, a marina pier, a sandy
// beach and open water to the south. Golden-hour light is fixed so the city
// always reads warm. Buildings register AABB colliders the player and cars
// collide with; named landmarks anchor the story missions.

import { WORLD, rand, randRange, roadLines } from './state.js';

export const LANDMARKS = {
  cafe:     { x: -36, z: -36, name: "Mama Rosa's Cafe" },
  pier:     { x: 24,  z: 236, name: 'Solmaris Pier' },
  garage:   { x: 124, z: 44,  name: "Rico's Garage" },
  marina:   { x: -124, z: 196, name: 'Marina Lot' },
  hideout:  { x: -168, z: -168, name: 'Old Lighthouse' },
  hospital: { x: 44,  z: -124, name: 'Solmaris General' },
  raceStart:{ x: 164, z: 164, name: 'Beach Sprint Start' },
};

const FACADE_TINTS = [0xffd9b0, 0xffb4a2, 0xa2d2ff, 0xb9fbc0, 0xfdfcdc, 0xffc6ff, 0xfdffb6, 0xcaffbf];

function facadeTexture(tintHex) {
  // A canvas-painted facade: rows of windows, some lit by the evening sun.
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const g = c.getContext('2d');
  const col = '#' + tintHex.toString(16).padStart(6, '0');
  g.fillStyle = col; g.fillRect(0, 0, 128, 256);
  g.fillStyle = 'rgba(0,0,0,0.16)'; g.fillRect(0, 0, 128, 14);
  for (let y = 0; y < 9; y++) {
    for (let x = 0; x < 5; x++) {
      const lit = rand() > 0.45;
      g.fillStyle = lit ? 'rgba(255,214,120,0.95)' : 'rgba(38,52,74,0.9)';
      g.fillRect(10 + x * 23, 24 + y * 25, 14, 16);
    }
  }
  return new THREE.CanvasTexture(c);
}

export function buildWorld(scene) {
  const colliders = [];

  scene.fog = new THREE.Fog(0xf7a56b, 120, 520);
  scene.background = new THREE.Color(0xffb877);

  const hemi = new THREE.HemisphereLight(0xffe3b3, 0x35424e, 0.85);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffb36b, 1.25);
  sun.position.set(-140, 90, 190);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x88aaff, 0.25);
  fill.position.set(120, 140, -100);
  scene.add(fill);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(760, 760),
    new THREE.MeshLambertMaterial({ color: 0x51665a })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  scene.add(ground);

  const roadMat = new THREE.MeshLambertMaterial({ color: 0x2e3138 });
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xffd76e });
  const lines = roadLines();
  for (const c of lines) {
    for (const vertical of [true, false]) {
      const road = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.roadWidth, WORLD.half * 2 + 30), roadMat);
      road.rotation.x = -Math.PI / 2;
      if (vertical) road.position.set(c, 0.01, 0);
      else { road.rotation.z = Math.PI / 2; road.position.set(0, 0.01, c); }
      scene.add(road);
      for (let d = -WORLD.half; d < WORLD.half; d += 14) {
        const dash = new THREE.Mesh(new THREE.PlaneGeometry(vertical ? 0.5 : 5, vertical ? 5 : 0.5), lineMat);
        dash.rotation.x = -Math.PI / 2;
        dash.position.set(vertical ? c : d, 0.03, vertical ? d : c);
        scene.add(dash);
      }
    }
  }
  const shore = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.half * 2 + 60, 14), roadMat);
  shore.rotation.x = -Math.PI / 2; shore.position.set(0, 0.012, 196);
  scene.add(shore);

  const sand = new THREE.Mesh(new THREE.PlaneGeometry(760, 70), new THREE.MeshLambertMaterial({ color: 0xf2d492 }));
  sand.rotation.x = -Math.PI / 2; sand.position.set(0, 0.02, WORLD.beachZ + 22);
  scene.add(sand);
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(900, 260), new THREE.MeshPhongMaterial({ color: 0x1e7fa8, shininess: 120, specular: 0xffcc88 }));
  sea.rotation.x = -Math.PI / 2; sea.position.set(0, 0.06, WORLD.oceanZ + 120);
  sea.name = 'sea';
  scene.add(sea);

  const texCache = FACADE_TINTS.map(facadeTexture);
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x6b4a3a });
  for (let bx = 0; bx < lines.length - 1; bx++) {
    for (let bz = 0; bz < lines.length - 1; bz++) {
      const cx = (lines[bx] + lines[bx + 1]) / 2;
      const cz = (lines[bz] + lines[bz + 1]) / 2;
      const perBlock = 2 + Math.floor(rand() * 2);
      for (let i = 0; i < perBlock; i++) {
        const w = randRange(13, 22), d = randRange(13, 22);
        const h = randRange(14, 58) * (rand() > 0.82 ? 1.5 : 1);
        const x = cx + randRange(-17, 17), z = cz + randRange(-17, 17);
        const tex = texCache[Math.floor(rand() * texCache.length)];
        const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ map: tex }));
        b.position.set(x, h / 2, z);
        scene.add(b);
        const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 1, 1.2, d + 1), roofMat);
        roof.position.set(x, h + 0.6, z);
        scene.add(roof);
        colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, h });
      }
    }
  }

  buildPalms(scene);
  buildPier(scene);
  buildLandmarkProps(scene, colliders);
  buildStreetLights(scene);
  buildSunSprite(scene);
  return { colliders, sea };
}

function palmTree(x, z, s) {
  const grp = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.32 * s, 0.5 * s, 7 * s, 6),
    new THREE.MeshLambertMaterial({ color: 0x8a6844 })
  );
  trunk.position.y = 3.5 * s;
  trunk.rotation.z = randRange(-0.09, 0.09);
  grp.add(trunk);
  const leafMat = new THREE.MeshLambertMaterial({ color: 0x2e9e5b, side: THREE.DoubleSide });
  for (let i = 0; i < 6; i++) {
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.7 * s, 5.4 * s, 4), leafMat);
    const a = (i / 6) * Math.PI * 2;
    leaf.position.set(Math.cos(a) * 1.7 * s, 7.4 * s, Math.sin(a) * 1.7 * s);
    leaf.rotation.set(Math.sin(a) * 1.15, 0, -Math.cos(a) * 1.15);
    grp.add(leaf);
  }
  grp.position.set(x, 0, z);
  return grp;
}

function buildPalms(scene) {
  const lines = roadLines();
  for (const c of lines) {
    for (let d = -WORLD.half + 12; d < WORLD.half; d += 34) {
      if (rand() > 0.4) scene.add(palmTree(c + 12.5, d + randRange(-4, 4), randRange(0.85, 1.25)));
      if (rand() > 0.55) scene.add(palmTree(d + randRange(-4, 4), c - 12.5, randRange(0.85, 1.2)));
    }
  }
  for (let x = -WORLD.half; x < WORLD.half; x += 16) {
    scene.add(palmTree(x + randRange(-3, 3), WORLD.beachZ + randRange(2, 16), randRange(0.95, 1.4)));
  }
}

function buildPier(scene) {
  const woodMat = new THREE.MeshLambertMaterial({ color: 0x9a6b48 });
  const pier = new THREE.Mesh(new THREE.BoxGeometry(14, 1.2, 64), woodMat);
  pier.position.set(LANDMARKS.pier.x, 0.8, 252);
  scene.add(pier);
  for (let i = 0; i < 6; i++) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 3, 6), woodMat);
    post.position.set(LANDMARKS.pier.x - 6, 0, 228 + i * 11);
    scene.add(post);
    const post2 = post.clone(); post2.position.x = LANDMARKS.pier.x + 6; scene.add(post2);
  }
  const hull = new THREE.Mesh(new THREE.BoxGeometry(5, 1.8, 11), new THREE.MeshLambertMaterial({ color: 0xf4f6f8 }));
  hull.position.set(LANDMARKS.pier.x + 11, 0.7, 282);
  scene.add(hull);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.6, 4), new THREE.MeshLambertMaterial({ color: 0x2277aa }));
  cabin.position.set(LANDMARKS.pier.x + 11, 2.2, 280);
  scene.add(cabin);
}

function buildLandmarkProps(scene, colliders) {
  const lh = new THREE.Group();
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 4.4, 26, 10), new THREE.MeshLambertMaterial({ color: 0xf6f0e6 }));
  tower.position.y = 13; lh.add(tower);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(3.7, 3.9, 5, 10), new THREE.MeshLambertMaterial({ color: 0xd84040 }));
  band.position.y = 17; lh.add(band);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(2, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffe98a }));
  lamp.position.y = 27.5; lh.add(lamp);
  lh.position.set(LANDMARKS.hideout.x, 0, LANDMARKS.hideout.z);
  scene.add(lh);
  colliders.push({ minX: LANDMARKS.hideout.x - 4.5, maxX: LANDMARKS.hideout.x + 4.5, minZ: LANDMARKS.hideout.z - 4.5, maxZ: LANDMARKS.hideout.z + 4.5, h: 26 });

  const garage = new THREE.Mesh(new THREE.BoxGeometry(24, 8, 16), new THREE.MeshLambertMaterial({ color: 0x3f6d8e }));
  garage.position.set(LANDMARKS.garage.x, 4, LANDMARKS.garage.z - 14);
  scene.add(garage);
  colliders.push({ minX: LANDMARKS.garage.x - 12, maxX: LANDMARKS.garage.x + 12, minZ: LANDMARKS.garage.z - 22, maxZ: LANDMARKS.garage.z - 6, h: 8 });

  // Mama Rosa's cafe: a low cream building under a red awning
  const cafeBase = new THREE.Mesh(new THREE.BoxGeometry(12, 3.2, 8), new THREE.MeshLambertMaterial({ color: 0xf3e2c7 }));
  cafeBase.position.set(LANDMARKS.cafe.x, 1.6, LANDMARKS.cafe.z);
  scene.add(cafeBase);
  colliders.push({ minX: LANDMARKS.cafe.x - 6, maxX: LANDMARKS.cafe.x + 6, minZ: LANDMARKS.cafe.z - 4, maxZ: LANDMARKS.cafe.z + 4, h: 3.2 });
  const cafe = new THREE.Mesh(new THREE.BoxGeometry(13, 1, 9), new THREE.MeshLambertMaterial({ color: 0xd84040 }));
  cafe.position.set(LANDMARKS.cafe.x, 3.4, LANDMARKS.cafe.z);
  scene.add(cafe);

  const hosp = new THREE.Mesh(new THREE.BoxGeometry(16, 12, 12), new THREE.MeshLambertMaterial({ color: 0xeef2f4 }));
  hosp.position.set(LANDMARKS.hospital.x, 6, LANDMARKS.hospital.z - 12);
  scene.add(hosp);
  colliders.push({ minX: LANDMARKS.hospital.x - 8, maxX: LANDMARKS.hospital.x + 8, minZ: LANDMARKS.hospital.z - 18, maxZ: LANDMARKS.hospital.z - 6, h: 12 });
}

function buildStreetLights(scene) {
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x394048 });
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffdf9e });
  const lines = roadLines();
  for (const c of lines) {
    for (let d = -WORLD.half + 20; d < WORLD.half; d += 40) {
      for (const [x, z] of [[c + 9.5, d], [d, c - 9.5]]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 6.4, 5), poleMat);
        pole.position.set(x, 3.2, z);
        scene.add(pole);
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.42, 6, 5), bulbMat);
        bulb.position.set(x, 6.5, z);
        scene.add(bulb);
      }
    }
  }
}

function buildSunSprite(scene) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,240,200,1)');
  grad.addColorStop(0.35, 'rgba(255,190,110,0.85)');
  grad.addColorStop(1, 'rgba(255,150,80,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  spr.scale.set(190, 190, 1);
  spr.position.set(-260, 95, 430);
  scene.add(spr);
}

// Circle-vs-AABB push-out used by the player and every vehicle.
export function collideCircle(pos, radius, colliders) {
  let hit = false;
  for (const b of colliders) {
    const nx = Math.max(b.minX, Math.min(pos.x, b.maxX));
    const nz = Math.max(b.minZ, Math.min(pos.z, b.maxZ));
    const dx = pos.x - nx, dz = pos.z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 < radius * radius) {
      hit = true;
      if (d2 > 0.0001) {
        const d = Math.sqrt(d2);
        pos.x = nx + (dx / d) * radius;
        pos.z = nz + (dz / d) * radius;
      } else {
        const left = pos.x - b.minX, right = b.maxX - pos.x;
        const top = pos.z - b.minZ, bot = b.maxZ - pos.z;
        const m = Math.min(left, right, top, bot);
        if (m === left) pos.x = b.minX - radius;
        else if (m === right) pos.x = b.maxX + radius;
        else if (m === top) pos.z = b.minZ - radius;
        else pos.z = b.maxZ + radius;
      }
    }
  }
  return hit;
}
