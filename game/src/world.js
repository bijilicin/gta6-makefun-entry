// World building for Solmaris v2 — Babylon.js port (v3 engine rewrite).
// A golden-hour coastal city built for depth and light. One shadow-casting
// sun follows the player, a gradient sky dome and warm haze set the hour,
// and every surface is a procedural canvas texture authored here at
// runtime — facades in four families with shopfronts and lit windows,
// asphalt with lane paint and crosswalks, sand, boardwalk planks and
// scrolling water. Props (palms, lamps, benches, hydrants, cycling traffic
// lights, neon signs) sell the street level.
//
// Realism pass (carried over from the three.js v2.1 build, re-expressed in
// Babylon terms): image-based lighting from a procedural equirect sky
// (EquiRectangularCubeTexture as scene.environmentTexture), PBR materials
// with Sobel-derived bump maps and per-surface roughness maps (packed as
// metallic-roughness: G = roughness, B = metalness), blob-shadow / base-AO
// grounding, sun disc + drifting cloud billboards, and damp reflective
// patches on the beach road. All still 100% procedural, zero asset files.
// City layout, landmark positions, collider set and the seeded random
// sequence are IDENTICAL to the three.js build — only the renderer changed.

import { WORLD, G, rand, randRange, randPick, roadLines, lampScale } from './state.js';

export const LANDMARKS = {
  cafe:     { x: -36, z: -36, name: "Mama Rosa's Cafe" },
  pier:     { x: 24,  z: 236, name: 'Solmaris Pier' },
  garage:   { x: 124, z: 44,  name: "Rico's Garage" },
  respray:  { x: 124, z: 44,  name: "Rico's Respray" },
  marina:   { x: -124, z: 196, name: 'Marina Lot' },
  hideout:  { x: -168, z: -168, name: 'Old Lighthouse' },
  hospital: { x: 44,  z: -124, name: 'Solmaris General' },
  station:  { x: -136, z: -136, name: 'Solmaris PD HQ' },
  raceStart:{ x: 164, z: 164, name: 'Beach Sprint Start' },
  pawn:     { x: 45,  z: -50, name: 'Pawn Shop' },
};

// ---------------------------------------------------------------------------
// Babylon plumbing shared by every module. The scene runs right-handed
// (scene.useRightHandedSystem, set in main.js) so every heading, rotation
// and Euler value from the three.js build carries over unchanged.
let MAX_ANISO = 4;
// main.js hands us the engine's real anisotropy cap before the world is
// built, so ground/road detail maps stay crisp at grazing angles.
export function setTextureAnisotropy(v) { MAX_ANISO = Math.max(1, Math.min(16, v || 4)); }

let _uid = 0;
export function uid(prefix) { return (prefix || 'node') + '_' + (++_uid); }
// three.js hex int (0xRRGGBB) -> Babylon Color3
export function C3(hex) {
  return new BABYLON.Color3(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);
}
export function C4(hex, a) { const c = C3(hex); return new BABYLON.Color4(c.r, c.g, c.b, a === undefined ? 1 : a); }

// The shadow generator is registered by buildWorld; markShadow() is a
// no-op before that (e.g. the headless traffic test, which has no world).
let shadowGen = null;
export function registerShadowGenerator(sg) { shadowGen = sg; }
export function markShadow(mesh, cast = false, receive = false) {
  if (!mesh) return mesh;
  if (cast && shadowGen && mesh instanceof BABYLON.Mesh) shadowGen.addShadowCaster(mesh);
  if (receive && mesh instanceof BABYLON.Mesh) mesh.receiveShadows = true;
  return mesh;
}
// Show/hide a node subtree (three.js group.visible): Babylon hides a
// TransformNode's children via setEnabled, a Mesh via isVisible — do both.
export function setShown(node, shown) {
  if (!node) return;
  if (node.setEnabled) node.setEnabled(!!shown);
  if ('isVisible' in node) node.isVisible = !!shown;
}
// Babylon equivalent of scene.remove(x): dispose a node and its subtree.
export function removeNode(root) {
  if (!root) return;
  const all = [root];
  if (root.getDescendants) for (const d of root.getDescendants(false)) all.push(d);
  for (let i = all.length - 1; i >= 0; i--) { if (all[i].dispose) all[i].dispose(); }
}

// Canvas -> Babylon texture. DynamicTexture keeps the exact canvas pixels
// (no encode/decode round trip) and matches three.js CanvasTexture flipY.
const texCanvas = new WeakMap();
const texEmissive = new WeakMap();
export function texFromCanvas(canvas, scene, opts = {}) {
  const t = new BABYLON.DynamicTexture(uid('tex'), canvas, scene, true,
    BABYLON.Texture.TRILINEAR_SAMPLINGMODE, BABYLON.Engine.TEXTUREFORMAT_RGBA, true);
  t.update(); // this build leaves canvas-backed textures not-ready until updated
  texCanvas.set(t, canvas);
  t.anisotropicFilteringLevel = MAX_ANISO;
  if (opts.repeat) {
    t.wrapU = t.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
    t.uScale = opts.repeat[0]; t.vScale = opts.repeat[1];
  }
  if (opts.hasAlpha) t.hasAlpha = true;
  return t;
}
function canvasTex(scene, w, h, draw, repeat) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d', { willReadFrequently: true }), w, h);
  return texFromCanvas(c, scene, repeat ? { repeat: [repeat[0], repeat[1]] } : {});
}

// Unlit material (three.js MeshBasicMaterial): signs, bulbs, glows, decals.
// Babylon 9.37 quirk (verified by probe): a StandardMaterial with
// disableLighting=true renders textured surfaces BLACK, and PBR with
// disableLighting does the same. The working unlit path in this build is
// PBR emissive (albedo black, emissive = colour / emissiveTexture = map).
// Alpha-mapped decals (blob shadows, particle puffs, glow sprites) instead
// use a lit StandardMaterial diffuse, whose alpha-from-diffuse path works.
export function basicMat(scene, opts = {}) {
  const tint = opts.color !== undefined ? C3(opts.color) : new BABYLON.Color3(1, 1, 1);
  if (opts.map && opts.map.hasAlpha) {
    const m = new BABYLON.StandardMaterial(uid('basicA'), scene);
    m.maxSimultaneousLights = 12;
    m.diffuseColor = tint;
    m.diffuseTexture = opts.map;
    m.useAlphaFromDiffuseTexture = true;
    m.specularColor = new BABYLON.Color3(0, 0, 0);
    if (opts.opacity !== undefined) m.alpha = opts.opacity;
    if (opts.depthWrite === false) m.disableDepthWrite = true;
    if (opts.fog === false) m.fogEnabled = false;
    if (opts.backFace) m.backFaceCulling = false;
    return m;
  }
  const m = new BABYLON.PBRMaterial(uid('basic'), scene);
  m.albedoColor = new BABYLON.Color3(0, 0, 0);
  m.emissiveColor = tint;
  if (opts.map) m.emissiveTexture = opts.map;
  m.roughness = 1;
  m.metallic = 0;
  m.environmentIntensity = 0;
  if (opts.opacity !== undefined) {
    m.alpha = opts.opacity;
    if (opts.opacity < 1) m.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
  }
  if (opts.depthWrite === false) m.disableDepthWrite = true;
  if (opts.fog === false) m.fogEnabled = false;
  if (opts.backFace) m.backFaceCulling = false;
  return m;
}
// Lit standard material for cheap props and characters.
export function stdMat(scene, opts = {}) {
  const m = new BABYLON.StandardMaterial(uid('std'), scene);
  // 12 simultaneous lights: sun + fill + hemi + the 8-light street pool
  // + the player headlight must all reach the shader (Babylon's default
  // cap of 4 silently drops the pool — lighting pass). 12 is also the
  // ceiling the SwiftShader GL stack tolerates for these PBR shaders:
  // 16 made vertex uniform blocks overflow (GL_MAX_VERTEX_UNIFORM_BUFFERS
  // = 14) and flooded the console with shader-compile errors.
  m.maxSimultaneousLights = 12;
  m.diffuseColor = opts.color !== undefined ? C3(opts.color) : new BABYLON.Color3(1, 1, 1);
  if (opts.map) m.diffuseTexture = opts.map;
  m.specularColor = new BABYLON.Color3(0.12, 0.12, 0.12);
  if (opts.emissive !== undefined) m.emissiveColor = C3(opts.emissive).scale(opts.emissiveIntensity !== undefined ? opts.emissiveIntensity : 1);
  if (opts.opacity !== undefined) m.alpha = opts.opacity;
  if (opts.backFace) m.backFaceCulling = false;
  return m;
}
// PBR material (three.js MeshStandard/PhysicalMaterial): albedo, bump,
// metallic-roughness map, emissive map, per-material environment intensity.
// Clearcoat is applied when the vendored Babylon build exposes it.
export function pbrMat(scene, opts = {}) {
  const m = new BABYLON.PBRMaterial(uid('pbr'), scene);
  m.maxSimultaneousLights = 12;   // see stdMat: the street pool must count
  m.albedoColor = opts.color !== undefined ? C3(opts.color) : new BABYLON.Color3(1, 1, 1);
  if (opts.map) m.albedoTexture = opts.map;
  m.roughness = opts.roughness !== undefined ? opts.roughness : 1;
  m.metallic = opts.metalness !== undefined ? opts.metalness : 0;
  m.environmentIntensity = opts.envMapIntensity !== undefined ? opts.envMapIntensity : 1;
  if (opts.normalMap) { m.bumpTexture = opts.normalMap; m.bumpScale = opts.normalScale !== undefined ? opts.normalScale : 0.5; }
  if (opts.roughnessMap) m.metallicRoughnessTexture = opts.roughnessMap;
  if (opts.emissive !== undefined) m.emissiveColor = C3(opts.emissive);
  if (opts.emissiveMap) m.emissiveTexture = opts.emissiveMap;
  if (opts.emissiveIntensity !== undefined) m.emissiveIntensity = opts.emissiveIntensity;
  if (opts.opacity !== undefined) m.alpha = opts.opacity;
  if (opts.alphaTest !== undefined) {
    m.transparencyMode = BABYLON.Material.MATERIAL_ALPHATEST !== undefined ? BABYLON.Material.MATERIAL_ALPHATEST : 1;
    m.alphaCutOff = opts.alphaTest;
  }
  if (opts.backFace) m.backFaceCulling = false;
  if (opts.clearcoat && m.clearcoat) {
    m.clearcoat.isEnabled = true;
    m.clearcoat.roughness = opts.clearcoatRoughness !== undefined ? opts.clearcoatRoughness : 0.08;
    m.clearcoat.intensity = 1;
  }
  return m;
}
// A camera-facing glow/billboard quad (three.js Sprite equivalent).
export function makeBillboard(scene, tex, w, h, opts = {}) {
  const mesh = BABYLON.MeshBuilder.CreatePlane(uid('bill'), { width: w, height: h }, scene);
  mesh.material = basicMat(scene, { map: tex, color: opts.color, opacity: opts.opacity !== undefined ? opts.opacity : 1, depthWrite: false, fog: opts.fog });
  mesh.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
  mesh.isPickable = false;
  return mesh;
}
// Flat ground quad (three.js PlaneGeometry rotated -PI/2 about X).
export function groundQuad(scene, w, d, mat) {
  const m = BABYLON.MeshBuilder.CreateGround(uid('gnd'), { width: w, height: d, subdivisions: 1 }, scene);
  if (mat) m.material = mat;
  m.isPickable = false;
  return m;
}
export function boxMesh(scene, w, h, d, mat, faceUV) {
  const opts = { width: w, height: h, depth: d };
  if (faceUV) opts.faceUV = faceUV;
  const m = BABYLON.MeshBuilder.CreateBox(uid('box'), opts, scene);
  if (mat) m.material = mat;
  m.isPickable = false;
  return m;
}
// Babylon box UVs in a right-handed scene: the -z face needs a U flip and
// the +z face a 180 (probe-verified) so facade lettering reads correctly;
// the +-x faces keep Babylon's orientation, where the shop band runs as
// vertical signage. Face order: [+z, -z, +x, -x, +y, -y].
export const FACADE_FACE_UV = [
  new BABYLON.Vector4(1, 1, 0, 0), new BABYLON.Vector4(1, 0, 0, 1),
  new BABYLON.Vector4(0, 0, 1, 1), new BABYLON.Vector4(0, 0, 1, 1),
  new BABYLON.Vector4(0, 0, 1, 1), new BABYLON.Vector4(0, 0, 1, 1),
];
export function cylMesh(scene, diameterTop, diameterBottom, h, tessellation, mat) {
  const m = BABYLON.MeshBuilder.CreateCylinder(uid('cyl'), { diameterTop, diameterBottom, height: h, tessellation }, scene);
  if (mat) m.material = mat;
  m.isPickable = false;
  return m;
}
export function sphereMesh(scene, diameter, segments, mat) {
  const m = BABYLON.MeshBuilder.CreateSphere(uid('sph'), { diameter, segments }, scene);
  if (mat) m.material = mat;
  m.isPickable = false;
  return m;
}
export function groupNode(scene, parent) {
  const g = new BABYLON.TransformNode(uid('grp'), scene);
  if (parent) g.parent = parent;
  return g;
}

// ---- procedural detail maps ----------------------------------------------
// Sobel filter over a height canvas -> tangent-space normal (bump) map.
// Runs once per source texture at startup; the canvases are small.
function heightToNormal(canvas, strength, scene) {
  const w = canvas.width, h = canvas.height;
  const src = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const ctx = out.getContext('2d');
  const img = ctx.createImageData(w, h);
  const lum = (x, y) => {
    x = (x + w) % w; y = (y + h) % h;
    const i = (y * w + x) * 4;
    return (src[i] * 0.299 + src[i + 1] * 0.587 + src[i + 2] * 0.114) / 255;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (lum(x - 1, y - 1) + 2 * lum(x - 1, y) + lum(x - 1, y + 1))
               - (lum(x + 1, y - 1) + 2 * lum(x + 1, y) + lum(x + 1, y + 1));
      const dy = (lum(x - 1, y + 1) + 2 * lum(x, y + 1) + lum(x + 1, y + 1))
               - (lum(x - 1, y - 1) + 2 * lum(x, y - 1) + lum(x + 1, y - 1));
      let nx = dx * strength, ny = dy * strength, nz = 1;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      const i = (y * w + x) * 4;
      img.data[i] = ((nx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((nz / len) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = texFromCanvas(out, scene, { repeat: [1, 1] });
  return t;
}
// Roughness map from the same height canvas, packed for Babylon's
// metallic-roughness convention: G channel = roughness, B = metalness (0).
function roughnessFromCanvas(canvas, base, mix, scene) {
  const w = canvas.width, h = canvas.height;
  const src = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const ctx = out.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < src.length; i += 4) {
    const lum = (src[i] * 0.299 + src[i + 1] * 0.587 + src[i + 2] * 0.114) / 255;
    const v = Math.max(30, Math.min(250, base + (lum - 0.5) * mix));
    img.data[i] = 255;
    img.data[i + 1] = v;
    img.data[i + 2] = 0;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = texFromCanvas(out, scene, { repeat: [1, 1] });
  return t;
}
// Derived-map cache so the 12 facade variants each pay the Sobel cost once.
const derivedCache = new Map();
function derivedMaps(tex, normalStrength, roughBase, roughMix, scene) {
  if (derivedCache.has(tex)) return derivedCache.get(tex);
  const canvas = texCanvas.get(tex);
  const maps = {
    normalMap: heightToNormal(canvas, normalStrength, scene),
    roughnessMap: roughnessFromCanvas(canvas, roughBase, roughMix, scene),
  };
  derivedCache.set(tex, maps);
  return maps;
}
function setRepeat(tex, u, v) { tex.uScale = u; tex.vScale = v; return tex; }

// ---- blob shadows / contact AO -------------------------------------------
let blobTexShared = null;
export function blobTexture(scene) {
  if (blobTexShared) return blobTexShared;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 6, 64, 64, 62);
  grad.addColorStop(0, 'rgba(10,6,4,0.88)');
  grad.addColorStop(0.62, 'rgba(10,6,4,0.45)');
  grad.addColorStop(1, 'rgba(10,6,4,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  blobTexShared = texFromCanvas(c, scene, { hasAlpha: true });
  return blobTexShared;
}
// A soft dark contact patch that grounds a car / ped / palm on the street
// even where the shadow camera does not reach. Never writes depth, and
// renders after opaque ground decals (renderingGroupId 2).
export function makeBlobShadow(scene, w, d, opacity = 0.4) {
  const m = groundQuad(scene, w, d, null);
  m.material = basicMat(scene, { map: blobTexture(scene), opacity, depthWrite: false });
  m.renderingGroupId = 2;
  return m;
}
function speckle(g, w, h, n, colors, aMax) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[Math.floor(rand() * colors.length)];
    g.globalAlpha = rand() * aMax;
    g.fillRect(rand() * w, rand() * h, 1 + rand() * 3, 1 + rand() * 3);
  }
  g.globalAlpha = 1;
}

// ---- facade families: 0 glass tower, 1 brick shops, 2 deco pastel, 3 concrete
const FAMILY_BASE = [
  ['#5d7d95', '#748fa8', '#48657e'],
  ['#a9603f', '#bb7748', '#96502f'],
  ['#f2c094', '#eeb4c8', '#bfe3dd'],
  ['#cfc8bb', '#bfb49e', '#d8d2c4'],
];
const SIGN_WORDS = ['CAFE', 'HOTEL', '24H', 'BAR SOL', 'TACOS', 'SURF', 'PAWN', 'DISCO', 'GYM', 'DELI'];
function facadeTexture(scene, family, colorway) {
  const litRects = [];   // lit window rects, reused for the emissive map
  // Realism pass: 512x1024 canvases (was 256x512) — framed windows with
  // mullion crosses, individual shop units with doors and ribbed
  // awnings, a cornice band, brick/panel coursing per family. All
  // randomness inside the painter is a private LCG seeded per facade,
  // so growing the detail never touches the shared game rand.
  let seed = (family * 7919 + colorway * 104729 + 12345) >>> 0;
  const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const tex = canvasTex(scene, 512, 1024, (g, w, h) => {
    const base = FAMILY_BASE[family][colorway];
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    const shade = g.createLinearGradient(0, 0, w, 0);
    shade.addColorStop(0, 'rgba(0,0,0,0.10)'); shade.addColorStop(0.5, 'rgba(255,255,255,0.05)'); shade.addColorStop(1, 'rgba(0,0,0,0.10)');
    g.fillStyle = shade; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = rng() > 0.5 ? '#000000' : '#ffffff';
      g.globalAlpha = rng() * 0.05;
      g.fillRect(rng() * w, rng() * h, 1 + rng() * 4, 1 + rng() * 4);
    }
    g.globalAlpha = 1;
    // surface coursing: brick courses, tower panel joints, stucco seams
    g.globalAlpha = 0.07; g.fillStyle = '#000000';
    if (family === 1) { for (let y = 0; y < h; y += 10) g.fillRect(0, y, w, 1.5); }
    else if (family === 0) { for (let x = 0; x < w; x += 86) g.fillRect(x, 0, 2, h); for (let y = 0; y < h; y += 128) g.fillRect(0, y, w, 2); }
    else { for (let y = 0; y < h; y += 128) g.fillRect(0, y, w, 2); }
    g.globalAlpha = 1;
    // cornice band at the top
    g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(0, 0, w, 26);
    g.fillStyle = 'rgba(255,255,255,0.20)'; g.fillRect(0, 26, w, 5);
    // ground floor: shopfront units on shop families, a lobby otherwise
    const shop = family === 1 || family === 2;
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, h - 148, w, 148);
    if (shop) {
      const awn = pick(['#d84040', '#1f8a70', '#e9a13b', '#3867b7']);
      const uw = w / 4;
      for (let u = 0; u < 4; u++) {
        const ux = u * uw;
        g.fillStyle = '#20242c'; g.fillRect(ux + 6, h - 92, uw - 12, 92);
        g.fillStyle = 'rgba(140,200,255,0.75)'; g.fillRect(ux + 12, h - 84, uw - 60, 76);
        g.fillStyle = 'rgba(0,0,0,0.35)';
        for (let mx = 1; mx < 3; mx++) g.fillRect(ux + 12 + (uw - 60) * mx / 3, h - 84, 3, 76);
        g.fillStyle = 'rgba(20,24,30,0.92)'; g.fillRect(ux + uw - 42, h - 84, 30, 76);   // door
        g.fillStyle = 'rgba(255,220,130,0.9)'; g.fillRect(ux + uw - 28, h - 48, 4, 4);
        g.fillStyle = awn;
        g.beginPath(); g.moveTo(ux + 2, h - 104); g.lineTo(ux + uw - 2, h - 104); g.lineTo(ux + uw - 14, h - 132); g.lineTo(ux + 14, h - 132); g.fill();
        g.fillStyle = 'rgba(0,0,0,0.16)';
        for (let sx = 8; sx < uw - 8; sx += 16) g.fillRect(ux + sx, h - 130, 2, 24);
      }
      g.fillStyle = '#171a20'; g.fillRect(0, h - 192, w, 52);
      g.fillStyle = '#ffd76e'; g.font = 'bold 38px Verdana'; g.textAlign = 'center';
      g.fillText(pick(SIGN_WORDS) + '  ·  ' + pick(SIGN_WORDS), w / 2, h - 155);
    } else {
      g.fillStyle = 'rgba(160,210,255,0.55)'; g.fillRect(28, h - 124, w - 56, 96);
      g.fillStyle = 'rgba(0,0,0,0.3)';
      for (let x = 80; x < w - 40; x += 104) g.fillRect(x, h - 124, 6, 96);
      g.fillRect(28, h - 80, w - 56, 5);
      g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(8, h - 140, w - 16, 12);
    }
    // window floors: framed windows with a mullion cross; lit windows
    // are recorded for the emissive map, as before
    const cols = family === 0 ? 6 : 5, rows = family === 0 ? 12 : 10;
    const cw = w / cols, ch = (h - 264) / rows;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const px = x * cw + cw * 0.22, py = 44 + y * ch, pw = cw * 0.56, ph = ch * 0.58;
        const lit = rng() > 0.52;
        if (lit) litRects.push([px - 3, py - 3, pw + 6, ph + 6]);
        if (family === 0) {
          g.fillStyle = 'rgba(210,225,235,0.9)'; g.fillRect(px - 5, py - 4, pw + 10, ph + 8);
          g.fillStyle = lit ? 'rgba(255,205,110,0.95)' : 'rgba(120,180,225,0.85)';
          g.fillRect(px, py, pw, ph);
          g.fillStyle = 'rgba(70,90,105,0.8)';
          g.fillRect(px + pw / 2 - 2, py, 4, ph); g.fillRect(px, py + ph / 2 - 2, pw, 4);
        } else {
          g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(px - 4, py - 3, pw + 8, ph + 9); // ledge shadow
          g.fillStyle = 'rgba(235,232,225,0.85)'; g.fillRect(px - 3, py - 3, pw + 6, ph + 6); // frame
          g.fillStyle = lit ? 'rgba(255,214,120,0.95)' : 'rgba(34,48,68,0.92)';
          g.fillRect(px, py, pw, ph);
          g.fillStyle = 'rgba(20,26,34,0.55)'; g.fillRect(px + pw / 2 - 1.5, py, 3, ph);
          if (family === 3 && y % 2 === 0) { // balcony slab
            g.fillStyle = 'rgba(90,84,72,0.9)'; g.fillRect(px - 8, py + ph + 6, pw + 16, 7);
          }
          if (rng() > 0.72) { // AC unit under some windows
            g.fillStyle = '#9aa0a4'; g.fillRect(px + pw - 14, py + ph + 8, 24, 16);
            g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(px + pw - 11, py + ph + 11, 18, 3);
          }
        }
      }
    }
    // grime at the base, sun-bleach at the top
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(255,235,200,0.20)');
    grad.addColorStop(0.75, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.30)');
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
  });
  // emissive map: black except the lit windows, so a minority of windows
  // actually glow at golden hour instead of the whole wall washing warm
  const ec = document.createElement('canvas');
  ec.width = 512; ec.height = 1024;
  const eg = ec.getContext('2d');
  eg.fillStyle = '#000000'; eg.fillRect(0, 0, 512, 1024);
  eg.fillStyle = '#ffca7a';
  for (const [x, y, rw, rh] of litRects) eg.fillRect(x, y, rw, rh);
  const emissiveMap = texFromCanvas(ec, scene, {});
  texEmissive.set(tex, emissiveMap);
  return tex;
}

function asphaltTexture(scene) {
  // Realism pass: 512x512 (was 256) with tyre-polish bands, hairline
  // cracks and a tar repair strip; painter randomness is a private LCG.
  let seed = 424243 >>> 0;
  const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  return canvasTex(scene, 512, 512, (g, w, h) => {
    g.fillStyle = '#33363d'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) {
      g.fillStyle = ['#22242a', '#454a52', '#5a6068'][Math.floor(rng() * 3)];
      g.globalAlpha = rng() * 0.22;
      g.fillRect(rng() * w, rng() * h, 1 + rng() * 4, 1 + rng() * 4);
    }
    g.globalAlpha = 1;
    // twin polish bands where tyres actually run
    g.fillStyle = 'rgba(16,17,21,0.20)';
    g.fillRect(w * 0.17, 0, w * 0.17, h); g.fillRect(w * 0.66, 0, w * 0.17, h);
    // hairline cracks: short random walks
    g.strokeStyle = 'rgba(12,13,16,0.5)'; g.lineWidth = 1.6;
    for (let c = 0; c < 6; c++) {
      let cx = rng() * w, cy = rng() * h;
      g.beginPath(); g.moveTo(cx, cy);
      for (let s = 0; s < 6; s++) { cx += (rng() - 0.5) * 46; cy += rng() * 26; g.lineTo(cx, cy); }
      g.stroke();
    }
    g.fillStyle = '#c8ccd2'; g.fillRect(8, 0, 9, h); g.fillRect(w - 17, 0, 9, h);   // edge lines
    g.fillStyle = '#e8c85a';                                                        // centre dash
    g.fillRect(w / 2 - 6, 36, 12, 184);
    g.fillStyle = 'rgba(15,16,20,0.5)';                                             // manhole
    g.beginPath(); g.arc(w * 0.72, h * 0.68, 26, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(200,205,215,0.35)'; g.lineWidth = 3;
    g.beginPath(); g.arc(w * 0.72, h * 0.68, 26, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(w * 0.72, h * 0.68, 15, 0, Math.PI * 2); g.stroke();
    g.fillStyle = 'rgba(0,0,0,0.16)'; g.fillRect(w * 0.2, h * 0.3, 88, 52);         // patch / grate
    g.fillStyle = 'rgba(10,10,12,0.28)'; g.fillRect(0, h * 0.52, w, 20);            // tar repair strip
  }, [1, 1]);
}
// Sidewalk concrete (realism pass): slab joints + speckle, replacing the
// flat colour the pavements used to wear.
function concreteTexture(scene) {
  let seed = 777001 >>> 0;
  const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  return canvasTex(scene, 256, 256, (g, w, h) => {
    g.fillStyle = '#b9b2a4'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1500; i++) {
      g.fillStyle = rng() > 0.5 ? '#8f887a' : '#d6d0c2';
      g.globalAlpha = rng() * 0.13;
      g.fillRect(rng() * w, rng() * h, 1 + rng() * 3, 1 + rng() * 3);
    }
    g.globalAlpha = 1;
    for (let i = 0; i < 5; i++) {   // faint stains
      g.fillStyle = 'rgba(90,84,70,0.06)';
      g.beginPath(); g.arc(rng() * w, rng() * h, 18 + rng() * 30, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = 'rgba(60,56,48,0.55)';
    for (let x = 0; x <= w; x += 64) g.fillRect(x - 1, 0, 3, h);
    for (let y = 0; y <= h; y += 64) g.fillRect(0, y - 1, w, 3);
  }, [1, 1]);
}
function crosswalkTexture(scene) {
  return canvasTex(scene, 256, 256, (g, w, h) => {
    g.fillStyle = '#33363d'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 1600, ['#22242a', '#454a52'], 0.22);
    g.fillStyle = 'rgba(235,238,242,0.85)';
    for (let i = 0; i < 5; i++) g.fillRect(18, 16 + i * 48, w - 36, 24);
  });
}
function sandTexture(scene) {
  return canvasTex(scene, 256, 256, (g, w, h) => {
    g.fillStyle = '#eed49b'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 2200, ['#d9ba72', '#fff3c4', '#c8a45e'], 0.3);
    g.strokeStyle = 'rgba(180,150,90,0.25)';
    for (let i = 0; i < 7; i++) { g.beginPath(); g.arc(rand() * w, rand() * h, 14 + rand() * 22, 0.4, 2.4); g.stroke(); }
  }, [1, 1]);
}
function plankTexture(scene) {
  return canvasTex(scene, 256, 256, (g, w, h) => {
    g.fillStyle = '#9a6f47'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 32) {
      g.fillStyle = ['#a5794f', '#8f6640', '#b08256'][Math.floor(rand() * 3)];
      g.fillRect(0, y, w, 29);
      g.fillStyle = 'rgba(0,0,0,0.4)'; g.fillRect(0, y + 29, w, 3);
      g.fillStyle = 'rgba(0,0,0,0.5)';
      g.fillRect(10, y + 13, 4, 4); g.fillRect(w - 14, y + 13, 4, 4);
    }
  }, [1, 1]);
}
function waterTexture(scene) {
  return canvasTex(scene, 256, 256, (g, w, h) => {
    g.fillStyle = '#1b6f9e'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 46; i++) {
      g.strokeStyle = `rgba(140,220,255,${0.10 + rand() * 0.22})`;
      g.lineWidth = 1 + rand() * 2;
      const y = rand() * h, x = rand() * w, len = 18 + rand() * 46;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + len, y); g.stroke();
    }
    for (let i = 0; i < 20; i++) {
      g.strokeStyle = 'rgba(255,190,110,0.20)'; g.lineWidth = 2;
      const y = rand() * h; g.beginPath(); g.moveTo(rand() * w, y); g.lineTo(rand() * w + 30, y); g.stroke();
    }
  }, [1, 1]);
}
function skyTexture(scene) {
  return canvasTex(scene, 64, 512, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#2d5a9e');
    grad.addColorStop(0.38, '#7fb0dd');
    grad.addColorStop(0.62, '#f7c98a');
    grad.addColorStop(0.78, '#ffb877');
    grad.addColorStop(1, '#ff9a5c');
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
  });
}
function signTexture(scene, text, fg, bg) {
  const t = canvasTex(scene, 512, 128, (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.strokeStyle = fg; g.lineWidth = 6; g.strokeRect(8, 8, w - 16, h - 16);
    g.fillStyle = fg; g.font = 'bold 52px Verdana'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 2);
  });
  // Babylon RH plane UVs mirror U (probe-verified): flip U back so sign
  // text reads correctly from the plane's front face.
  t.uScale = -1;
  t.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
  t.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
  return t;
}
// A tiny procedural environment (six gradient canvases) so car paint and
// glass pick up warm sky / dark street reflections without any asset
// files. Kept as the fallback when the equirect environment cannot load.
export function makeEnvMap(scene) {
  const face = (top, mid, bot) => {
    const c = document.createElement('canvas'); c.width = 32; c.height = 32;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 32);
    grad.addColorStop(0, top); grad.addColorStop(0.55, mid); grad.addColorStop(1, bot);
    g.fillStyle = grad; g.fillRect(0, 0, 32, 32);
    return c.toDataURL('image/png');
  };
  const side = () => face('#7fb0dd', '#f7c98a', '#3a3f46');
  const files = [side(), side(), face('#8fc0ee', '#a8c8e8', '#a8c8e8'), face('#3a3f46', '#33363d', '#22242a'), side(), side()];
  return BABYLON.CubeTexture.CreateFromImages(files, scene);
}

// Equirectangular environment canvas for image-based lighting: the same
// golden-hour gradient as the sky dome, a bright sun blob placed where
// the directional sun lives, a warm sea glint band and a dark warm
// ground bounce. Babylon's equirect-to-cube conversion blurs this into
// the soft reflections PBR needs (the PMREM role from the three build).
function envEquirectTexture(scene) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#2d5a9e');
  grad.addColorStop(0.34, '#7fb0dd');
  grad.addColorStop(0.5, '#f7c98a');
  grad.addColorStop(0.56, '#ffb877');
  grad.addColorStop(0.62, '#8a6a4e');   // warm ground bounce
  grad.addColorStop(1, '#3a2e24');
  g.fillStyle = grad; g.fillRect(0, 0, 512, 256);
  // pale building glints along the horizon so paint picks up city shapes.
  // A private LCG (not the shared game rand) keeps the seeded city layout
  // byte-identical to the three.js build — the environment must not
  // consume any of the world's random sequence.
  let envSeed = 987654321;
  const envRand = () => { envSeed = (envSeed * 1664525 + 1013904223) >>> 0; return envSeed / 4294967296; };
  for (let i = 0; i < 42; i++) {
    g.fillStyle = `rgba(255,230,190,${0.05 + envRand() * 0.13})`;
    const bw = 4 + envRand() * 10;
    g.fillRect(envRand() * 512, 118 + envRand() * 10, bw, 14 + envRand() * 12);
  }
  // sun blob: direction of the key light (-90, 120, 150) in equirect UV
  const sunDir = new BABYLON.Vector3(-90, 120, 150).normalize();
  const su = (Math.atan2(sunDir.z, sunDir.x) / (Math.PI * 2) + 0.5) * 512;
  const sv = (Math.acos(Math.max(-1, Math.min(1, sunDir.y))) / Math.PI) * 256;
  const halo = g.createRadialGradient(su, sv, 2, su, sv, 64);
  halo.addColorStop(0, 'rgba(255,246,214,1)');
  halo.addColorStop(0.25, 'rgba(255,205,120,0.85)');
  halo.addColorStop(1, 'rgba(255,160,80,0)');
  g.fillStyle = halo; g.fillRect(su - 64, sv - 64, 128, 128);
  const t = new BABYLON.EquiRectangularCubeTexture(c.toDataURL('image/png'), scene, 256);
  return t;
}

export function buildWorld(scene) {
  const colliders = [];
  // ---- image-based lighting: equirect sky -> scene.environmentTexture.
  // It lights every PBR material; per-material environmentIntensity
  // values tune it per surface class.
  let envMap = null;
  try {
    envMap = envEquirectTexture(scene);
  } catch (e) { envMap = null; }
  if (!envMap) {
    try { envMap = makeEnvMap(scene); } catch (e) { envMap = null; }
  }
  if (envMap) scene.environmentTexture = envMap;

  // ---- sky, fog, light
  const sky = BABYLON.MeshBuilder.CreateSphere(uid('sky'), { diameter: 1760, segments: 24 }, scene);
  sky.material = basicMat(scene, { map: skyTexture(scene), fog: false, backFace: true });
  sky.material.disableDepthWrite = true;
  sky.isPickable = false;
  scene.fogMode = BABYLON.Scene.FOGMODE_LINEAR;
  scene.fogColor = C3(0xf7b183);   // matched to the sky horizon so the far skyline fades warm
  scene.fogStart = 185;
  scene.fogEnd = 700;
  scene.clearColor = C4(0xf7b98a, 1);

  const hemi = new BABYLON.HemisphericLight(uid('hemi'), new BABYLON.Vector3(0, 1, 0), scene);
  hemi.diffuse = C3(0xbdd8ff);
  hemi.groundColor = C3(0x8a6a4e);
  hemi.intensity = 0.42;
  const sun = new BABYLON.DirectionalLight(uid('sun'), new BABYLON.Vector3(90, -120, -150).normalize(), scene);
  sun.position = new BABYLON.Vector3(-90, 120, 150);
  sun.diffuse = C3(0xffc98a);
  sun.intensity = 1.3;
  sun.autoUpdateExtents = false;
  sun.orthoLeft = -95; sun.orthoRight = 95;
  sun.orthoTop = 95; sun.orthoBottom = -95;
  sun.shadowMinZ = 10; sun.shadowMaxZ = 520;
  const shadowGen = new BABYLON.ShadowGenerator(2048, sun);
  shadowGen.useCloseExponentialShadowMap = true;
  shadowGen.bias = -0.0003;
  if ('normalBias' in shadowGen) shadowGen.normalBias = 0.5;   // shadows sit tight without acne
  registerShadowGenerator(shadowGen);
  const sunTarget = new BABYLON.Vector3(0, 0, 0);
  const fill = new BABYLON.DirectionalLight(uid('fill'), new BABYLON.Vector3(-120, -140, 100).normalize(), scene);
  fill.position = new BABYLON.Vector3(120, 140, -100);
  fill.diffuse = C3(0x88aaff);
  fill.intensity = 0.18;
  buildSunSprite(scene);
  const clouds = buildClouds(scene);

  // ---- ground + sidewalks
  const groundMat = pbrMat(scene, { color: 0x5d7263, roughness: 1, envMapIntensity: 0.12 });
  const ground = groundQuad(scene, 820, 820, groundMat);
  ground.position.y = -0.06;
  markShadow(ground, false, true);
  const walkTex = concreteTexture(scene); setRepeat(walkTex, 2, 30);
  const walkMat = pbrMat(scene, { map: walkTex, roughness: 0.95, envMapIntensity: 0.18 });
  const lines = roadLines();
  for (const c of lines) {
    for (const vertical of [true, false]) {
      const walk = groundQuad(scene, WORLD.roadWidth + 7, WORLD.half * 2 + 34, walkMat);
      if (!vertical) walk.rotation.y = Math.PI / 2;
      walk.position.set(vertical ? c : 0, 0.005, vertical ? 0 : c);
      markShadow(walk, false, true);
    }
  }

  // ---- roads with painted texture + crosswalks (PBR detail maps)
  const asphalt = asphaltTexture(scene);
  setRepeat(asphalt, 1, 26);
  const asphaltMaps = derivedMaps(asphalt, 1.6, 218, -70, scene);   // dark patches read smoother
  setRepeat(asphaltMaps.normalMap, 1, 26);
  setRepeat(asphaltMaps.roughnessMap, 1, 26);
  const roadMat = pbrMat(scene, {
    map: asphalt, normalMap: asphaltMaps.normalMap, normalScale: 0.55,
    roughnessMap: asphaltMaps.roughnessMap, roughness: 1.0, metalness: 0.0, envMapIntensity: 0.25,
  });
  for (const c of lines) {
    for (const vertical of [true, false]) {
      const road = groundQuad(scene, WORLD.roadWidth, WORLD.half * 2 + 30, roadMat);
      if (vertical) road.position.set(c, 0.02, 0);
      else { road.rotation.y = Math.PI / 2; road.position.set(0, 0.02, c); }
      markShadow(road, false, true);
    }
  }
  const crossTex = crosswalkTexture(scene);
  const crossMaps = derivedMaps(crossTex, 1.2, 215, -60, scene);
  const crossMat = pbrMat(scene, {
    map: crossTex, normalMap: crossMaps.normalMap, normalScale: 0.4,
    roughnessMap: crossMaps.roughnessMap, roughness: 1.0, envMapIntensity: 0.25,
  });
  for (const cx of lines) for (const cz of lines) {
    for (const [ox, oz, rot] of [[0, 12.5, 0], [0, -12.5, 0], [12.5, 0, Math.PI / 2], [-12.5, 0, Math.PI / 2]]) {
      const m = groundQuad(scene, WORLD.roadWidth - 1, WORLD.roadWidth - 1, crossMat);
      m.rotation.y = rot;
      m.position.set(cx + ox, 0.03, cz + oz);
      markShadow(m, false, true);
    }
  }
  // damp patches on the beach road: near-mirror roughness so the sky
  // reflects and the asphalt reads wet near the sand (life detail)
  const dampMat = pbrMat(scene, {
    color: 0x23262c, roughness: 0.07, metalness: 0.0, envMapIntensity: 1.3, opacity: 0.5,
  });
  dampMat.disableDepthWrite = true;
  for (let i = 0; i < 7; i++) {
    const damp = groundQuad(scene, randRange(10, 20), randRange(5, 8), dampMat);
    damp.rotation.y = randRange(-0.2, 0.2);
    damp.position.set(-176 + i * 56 + randRange(-10, 10), 0.032, 200 + randRange(-4.5, 4.5));
    damp.renderingGroupId = 1;
  }

  // ---- beach, boardwalk, sea
  const sandTex = sandTexture(scene); setRepeat(sandTex, 18, 2);
  const sand = groundQuad(scene, 820, 74, pbrMat(scene, { map: sandTex, roughness: 1, envMapIntensity: 0.1 }));
  sand.position.set(0, 0.015, WORLD.beachZ + 24);
  markShadow(sand, false, true);
  const plankTex = plankTexture(scene); setRepeat(plankTex, 30, 1);
  const board = groundQuad(scene, 640, 9, pbrMat(scene, { map: plankTex, roughness: 0.9, envMapIntensity: 0.22 }));
  board.position.set(0, 0.04, 200);
  markShadow(board, false, true);
  const waterTex = waterTexture(scene); setRepeat(waterTex, 10, 3);
  const sea = groundQuad(scene, 940, 300, pbrMat(scene, { map: waterTex, opacity: 0.94, roughness: 0.16, metalness: 0.0, envMapIntensity: 1.0 }));
  sea.position.set(0, 0.1, WORLD.oceanZ + 140);
  sea.name = 'sea';

  buildBuildings(scene, colliders, lines);
  buildPalms(scene);
  buildBeachProps(scene);
  buildSmashables(scene);
  buildPier(scene);
  buildLandmarkProps(scene, colliders);
  const lights = buildStreetLights(scene);
  const trafficLights = buildTrafficLights(scene);

  // ---- real street lighting (adapted from the Vice County lamp pool,
  // re-expressed in Solmaris terms): eight warm PointLights, never one
  // per lamp. update() re-seats the pool on the lamp heads nearest the
  // player roughly four times a second. Range 19 m matches the lamp
  // spacing rhythm; intensity follows lampScale() — partial at dusk,
  // full at night, exactly 0 (lights parked below ground) all day.
  const lightPool = [];
  for (let i = 0; i < 8; i++) {
    const pl = new BABYLON.PointLight(uid('streetPool'), new BABYLON.Vector3(0, -10, 0), scene);
    pl.diffuse = new BABYLON.Color3(1, 0.72, 0.42);
    pl.specular = new BABYLON.Color3(0.4, 0.3, 0.18);
    pl.range = 19;
    pl.intensity = 0;
    pl.shadowEnabled = false;
    lightPool.push(pl);
  }
  let poolTimer = 0;
  let poolScale = -1;   // last lampScale() applied (disc/bulb garnish cache)
  function updateLightPool(dt, playerPos) {
    const scale = lampScale();
    // emissive garnish follows the same factor: bulbs burn brighter and
    // the fake ground discs deepen as the real pool comes up
    if (scale !== poolScale) {
      poolScale = scale;
      if (streetBulbMat) streetBulbMat.emissiveIntensity = 0.85 + scale * 1.5;
      if (streetDiscMat) streetDiscMat.alpha = 0.06 + scale * 0.10;
    }
    poolTimer -= dt;
    if (poolTimer > 0) return;
    poolTimer = 0.25;
    if (scale <= 0 || !playerPos) {
      for (const L of lightPool) L.intensity = 0;
      return;
    }
    const sorted = lights.slice().sort((a, b) => {
      const da = (a.x - playerPos.x) * (a.x - playerPos.x) + (a.z - playerPos.z) * (a.z - playerPos.z);
      const db = (b.x - playerPos.x) * (b.x - playerPos.x) + (b.z - playerPos.z) * (b.z - playerPos.z);
      return da - db;
    });
    for (let i = 0; i < lightPool.length; i++) {
      const L = lightPool[i];
      const head = sorted[i];
      if (head) {
        L.position.set(head.x, 6.45, head.z);
        L.intensity = 40 * scale;
      } else L.intensity = 0;
    }
  }

  let waterClock = 0;
  function update(dt, playerPos) {
    waterClock += dt;
    for (const cl of clouds) {   // billboard clouds drift slowly east
      cl.position.x += dt * 0.8;
      if (cl.position.x > 760) cl.position.x = -760;
    }
    waterTex.uOffset = (waterClock * 0.008) % 1;
    waterTex.vOffset = (waterClock * 0.02) % 1;
    sea.position.y = 0.1 + Math.sin(waterClock * 0.7) * 0.05;
    // the shadow camera rides with the player so shadows stay crisp
    if (playerPos) {
      sun.position.set(playerPos.x - 90, 130, playerPos.z + 110);
      sunTarget.set(playerPos.x, 0, playerPos.z);
      sun.setDirectionToTarget(sunTarget);
    }
    // traffic lights: 12s cycle, NS green 0-5, amber 5-6, EW green 6-11, amber 11-12
    const ph = G.time % 12;
    const nsGo = ph < 5, nsAmber = ph >= 5 && ph < 6, ewGo = ph >= 6 && ph < 11;
    for (const tl of trafficLights) {
      const go = tl.ns ? nsGo : ewGo;
      const amber = tl.ns ? nsAmber : (!nsGo && !ewGo && !nsAmber ? true : (ph >= 11 && ph < 12));
      tl.r.material = (go || amber) ? tl.dimMat : tl.redMat;
      tl.g.material = go ? tl.greenMat : tl.dimMat;
      tl.a.material = amber ? tl.amberMat : tl.dimMat;
    }
    G.trafficPhase = ph;
    updateLightPool(dt, playerPos);
    return lights;
  }
  return { colliders, sea, sun, update, lightPool, lampHeads: lights, hemi, fill, sky };
}

function buildBuildings(scene, colliders, lines) {
  const facades = [];
  for (let f = 0; f < 4; f++) for (let c = 0; c < 3; c++) facades.push(facadeTexture(scene, f, c));
  const roofMat = pbrMat(scene, { color: 0x74584a, roughness: 1, envMapIntensity: 0.15 });
  const parapetMat = pbrMat(scene, { color: 0x8a7466, roughness: 1, envMapIntensity: 0.15 });
  const baseAoMat = basicMat(scene, { map: blobTexture(scene), opacity: 0.5, depthWrite: false });
  const acMat = pbrMat(scene, { color: 0x9aa0a4, roughness: 0.7, metalness: 0.35 });
  const tankMat = pbrMat(scene, { color: 0x7a5c40, roughness: 0.9 });
  for (let bx = 0; bx < lines.length - 1; bx++) {
    for (let bz = 0; bz < lines.length - 1; bz++) {
      const cx = (lines[bx] + lines[bx + 1]) / 2;
      const cz = (lines[bz] + lines[bz + 1]) / 2;
      const perBlock = 2 + Math.floor(rand() * 2);
      for (let i = 0; i < perBlock; i++) {
        const w = randRange(13, 23), d = randRange(13, 23);
        const tall = rand() > 0.82;
        const h = randRange(13, 46) * (tall ? 1.7 : 1);
        const x = cx + randRange(-17, 17), z = cz + randRange(-17, 17);
        const tex = facades[Math.floor(rand() * facades.length)];
        const maps = derivedMaps(tex, 1.1, 205, 55, scene);   // window frames read rougher than glass
        const side = pbrMat(scene, {
          map: tex, normalMap: maps.normalMap, normalScale: 0.38,
          roughnessMap: maps.roughnessMap, roughness: 1.0, metalness: 0.04, envMapIntensity: 0.35,
          emissive: 0xffbe78, emissiveMap: texEmissive.get(tex) || null, emissiveIntensity: 0.85,
        });
        const b = boxMesh(scene, w, h, d, side, FACADE_FACE_UV);
        b.position.set(x, h / 2, z);
        markShadow(b, true, true);
        // roof cap: a flat quad in roof material covers the box's top
        // face (Babylon port of the three.js multi-material box)
        const roof = groundQuad(scene, w + 0.1, d + 0.1, roofMat);
        roof.position.set(x, h + 0.03, z);
        // parapet lip + rooftop clutter on the bigger roofs
        const par = boxMesh(scene, w + 0.9, 1.1, d + 0.9, parapetMat);
        par.position.set(x, h + 0.4, z);
        markShadow(par, true, false);
        if (w > 15 && rand() > 0.35) {
          const ac = boxMesh(scene, 2.2, 1.3, 2.2, acMat);
          ac.position.set(x + randRange(-w / 4, w / 4), h + 1.4, z + randRange(-d / 4, d / 4));
          markShadow(ac, true, false);
        }
        if (h > 30 && rand() > 0.55) {
          const tank = cylMesh(scene, 3.4, 3.4, 3.6, 9, tankMat);
          tank.position.set(x - w / 4, h + 2.6, z - d / 4);
          markShadow(tank, true, false);
          const cone = BABYLON.MeshBuilder.CreateCylinder(uid('cone'), { diameterTop: 0, diameterBottom: 4.2, height: 1.2, tessellation: 9 }, scene);
          cone.material = tankMat;
          cone.isPickable = false;
          cone.position.set(x - w / 4, h + 5, z - d / 4);
        }
        colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, h });
        // contact AO: a soft dark skirt where the wall meets the pavement
        const baseAo = groundQuad(scene, w + 8, d + 8, baseAoMat);
        baseAo.position.set(x, 0.028, z);
        baseAo.renderingGroupId = 1;
        // setback annex on some corner plots
        if (rand() > 0.78) {
          const aw = w * 0.55, ad = d * 0.55, ah = h * randRange(0.3, 0.5);
          const ax = x + (rand() > 0.5 ? w / 2 + aw / 2 - 0.5 : -(w / 2 + aw / 2 - 0.5));
          const annex = boxMesh(scene, aw, ah, ad, side);
          annex.position.set(ax, ah / 2, z);
          markShadow(annex, true, true);
          const annexRoof = groundQuad(scene, aw + 0.1, ad + 0.1, roofMat);
          annexRoof.position.set(ax, ah + 0.03, z);
          colliders.push({ minX: ax - aw / 2, maxX: ax + aw / 2, minZ: z - ad / 2, maxZ: z + ad / 2, h: ah });
        }
      }
    }
  }
}

function frondTexture(scene) {
  return canvasTex(scene, 128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = '#2e8f57'; g.lineWidth = 5; g.lineCap = 'round';
    g.beginPath(); g.moveTo(6, h - 8); g.quadraticCurveTo(w * 0.5, h * 0.35, w - 8, h * 0.55); g.stroke();
    // realism pass: denser, finer leaflets (19 pairs, was 11) so the
    // frond reads as foliage instead of a green comb
    g.lineWidth = 1.9; g.strokeStyle = '#37a866';
    for (let i = 0; i < 19; i++) {
      const t = 0.08 + i * 0.047;
      const x = 6 + (w - 14) * t, y = (h - 8) - Math.sin(t * 2.4) * 42 + t * 18;
      const droop = 13 + Math.sin(i * 2.7) * 4;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + 10, y + droop + 5); g.stroke();
      g.beginPath(); g.moveTo(x, y); g.lineTo(x - 5, y + droop + 3); g.stroke();
    }
    g.lineWidth = 1.2; g.strokeStyle = '#4cc47c';
    for (let i = 0; i < 19; i++) {
      const t = 0.1 + i * 0.047;
      const x = 6 + (w - 14) * t, y = (h - 8) - Math.sin(t * 2.4) * 42 + t * 18;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + 6, y + 10); g.stroke();
    }
  });
}
const frondTexShared = { tex: null };
function palmTree(scene, x, z, s) {
  if (!frondTexShared.tex) { frondTexShared.tex = frondTexture(scene); frondTexShared.tex.hasAlpha = true; }
  const grp = groupNode(scene);
  const trunkMat = pbrMat(scene, { color: 0x8a6844, roughness: 1 });
  const bend = randRange(-0.16, 0.16);
  let px = 0, py = 0;
  for (let i = 0; i < 3; i++) {
    const seg = cylMesh(scene, (0.30 * s - i * 0.04) * 2, (0.42 * s - i * 0.04) * 2, 2.6 * s, 6, trunkMat);
    px += bend * i * s;
    seg.position.set(px, py + 1.3 * s, 0);
    seg.rotation.z = -bend;
    markShadow(seg, true, false);
    seg.parent = grp;
    py += 2.45 * s;
  }
  const topX = px + bend * 1.4 * s, topY = py + 0.5 * s;
  const frondMat = pbrMat(scene, { map: frondTexShared.tex, alphaTest: 0.35, backFace: true, roughness: 1 });
  for (let i = 0; i < 7; i++) {
    const f = BABYLON.MeshBuilder.CreatePlane(uid('frond'), { width: 5.6 * s, height: 5.6 * s }, scene);
    f.material = frondMat;
    f.isPickable = false;
    const a = (i / 7) * Math.PI * 2 + randRange(-0.2, 0.2);
    f.position.set(topX + Math.cos(a) * 0.7 * s, topY, Math.sin(a) * 0.7 * s);
    f.rotation.set(-0.5 - rand() * 0.35, a, 0);
    markShadow(f, true, false);
    f.parent = grp;
  }
  const nutMat = pbrMat(scene, { color: 0x6b4a2a, roughness: 1 });
  for (let i = 0; i < 3; i++) {
    const nut = sphereMesh(scene, 0.56 * s, 6, nutMat);
    nut.position.set(topX + randRange(-0.4, 0.4) * s, topY - 0.3 * s, randRange(-0.4, 0.4) * s);
    nut.parent = grp;
  }
  const blob = makeBlobShadow(scene, 5.2 * s, 5.2 * s, 0.34);
  blob.position.y = 0.03;
  blob.parent = grp;
  grp.position.set(x, 0, z);
  return grp;
}
function buildPalms(scene) {
  const lines = roadLines();
  for (const c of lines) {
    for (let d = -WORLD.half + 12; d < WORLD.half; d += 34) {
      if (rand() > 0.4) palmTree(scene, c + 12.5, d + randRange(-4, 4), randRange(0.85, 1.25));
      if (rand() > 0.55) palmTree(scene, d + randRange(-4, 4), c - 12.5, randRange(0.85, 1.2));
    }
  }
  for (let x = -WORLD.half; x < WORLD.half; x += 15) {
    palmTree(scene, x + randRange(-3, 3), WORLD.beachZ + randRange(3, 18), randRange(0.95, 1.4));
  }
}
function buildBeachProps(scene) {
  const poleMat = pbrMat(scene, { color: 0xe8e2d4, roughness: 0.8 });
  const cols = [0xff5a7a, 0xffb347, 0x3ec6d8, 0xffd23e, 0x9d6bff];
  for (let i = 0; i < 22; i++) {
    const x = randRange(-WORLD.half + 6, WORLD.half - 6), z = WORLD.beachZ + randRange(6, 30);
    const pole = cylMesh(scene, 0.18, 0.18, 2.6, 5, poleMat);
    pole.position.set(x, 1.3, z);
    markShadow(pole, true, false);
    const top = BABYLON.MeshBuilder.CreateCylinder(uid('cone'), { diameterTop: 0, diameterBottom: 3.8, height: 1.0, tessellation: 8 }, scene);
    top.material = pbrMat(scene, { color: randPick(cols), roughness: 0.8 });
    top.isPickable = false;
    top.position.set(x, 2.8, z);
    markShadow(top, true, false);
    const towel = groundQuad(scene, 2.2, 1.1, pbrMat(scene, { color: randPick(cols), roughness: 1 }));
    towel.rotation.y = randRange(0, 3);
    towel.position.set(x + randRange(-1.6, 1.6), 0.05, z + randRange(1, 2.4));
    markShadow(towel, false, true);
  }
}
// Smashable beachfront property for the Act 2 rampage (story addendum):
// boardwalk umbrellas and rival club signs along the beach road. Cars pass
// straight through them; the mission system tips them over and pays out
// "damage" dollars. resetSmashables() stands them all back up.
export const SMASHABLES = [];
function buildSmashables(scene) {
  const poleMat = pbrMat(scene, { color: 0xd8d2c2, roughness: 0.8 });
  const cols = [0xff5a7a, 0xffb347, 0x3ec6d8, 0xffd23e, 0x9d6bff, 0x53d769];
  for (let i = 0; i < 12; i++) {
    const x = -176 + i * 32 + randRange(-4, 4);
    const z = WORLD.beachZ - randRange(2, 6);
    const grp = groupNode(scene);
    const pole = cylMesh(scene, 0.18, 0.18, 2.6, 5, poleMat);
    pole.position.y = 1.3;
    markShadow(pole, true, false);
    pole.parent = grp;
    const top = BABYLON.MeshBuilder.CreateCylinder(uid('cone'), { diameterTop: 0, diameterBottom: 3.8, height: 1.0, tessellation: 8 }, scene);
    top.material = pbrMat(scene, { color: cols[i % cols.length], roughness: 0.8 });
    top.isPickable = false;
    top.position.y = 2.8;
    markShadow(top, true, false);
    top.parent = grp;
    grp.position.set(x, 0, z);
    SMASHABLES.push({ x, z, mesh: grp, value: 1500, smashed: false, kind: 'umbrella' });
  }
  const signCols = [0x53d769, 0x3ec6d8, 0xff5a7a];
  for (let i = 0; i < 5; i++) {
    const x = -160 + i * 80 + randRange(-6, 6);
    const z = WORLD.beachZ - 9;
    const grp = groupNode(scene);
    const post = boxMesh(scene, 0.35, 4.4, 0.35, poleMat);
    post.position.y = 2.2;
    markShadow(post, true, false);
    post.parent = grp;
    const board = boxMesh(scene, 4.6, 1.5, 0.3,
      pbrMat(scene, { color: signCols[i % signCols.length], roughness: 0.5, emissive: signCols[i % signCols.length], emissiveIntensity: 0.25 }));
    board.position.y = 4.6;
    markShadow(board, true, false);
    board.parent = grp;
    grp.position.set(x, 0, z);
    SMASHABLES.push({ x, z, mesh: grp, value: 2600, smashed: false, kind: 'sign' });
  }
}
export function resetSmashables() {
  for (const s of SMASHABLES) {
    s.smashed = false;
    setShown(s.mesh, true);
    s.mesh.rotation.set(0, 0, 0);
  }
}

function buildPier(scene) {
  const woodMat = pbrMat(scene, { color: 0x9a6b48, roughness: 0.95 });
  const pier = boxMesh(scene, 14, 1.2, 64, woodMat);
  pier.position.set(LANDMARKS.pier.x, 0.8, 252);
  markShadow(pier, true, true);
  for (let i = 0; i < 6; i++) {
    for (const sx of [-6, 6]) {
      const post = cylMesh(scene, 0.8, 0.8, 3, 6, woodMat);
      post.position.set(LANDMARKS.pier.x + sx, 0, 228 + i * 11);
    }
  }
  const hull = boxMesh(scene, 5, 1.8, 11, pbrMat(scene, { color: 0xf4f6f8, roughness: 0.4, metalness: 0.1 }));
  hull.position.set(LANDMARKS.pier.x + 11, 0.7, 282);
  markShadow(hull, true, false);
  const cabin = boxMesh(scene, 3.4, 1.6, 4, pbrMat(scene, { color: 0x2277aa, roughness: 0.35, metalness: 0.15 }));
  cabin.position.set(LANDMARKS.pier.x + 11, 2.2, 280);
  markShadow(cabin, true, false);
}
function buildLandmarkProps(scene, colliders) {
  const std = (color, rough = 0.85) => pbrMat(scene, { color, roughness: rough });
  // Old Lighthouse (hideout)
  const lh = groupNode(scene);
  const tower = cylMesh(scene, 6.4, 8.8, 26, 10, std(0xf6f0e6));
  tower.position.y = 13;
  markShadow(tower, true, false);
  tower.parent = lh;
  const band = cylMesh(scene, 7.4, 7.8, 5, 10, std(0xd84040));
  band.position.y = 17;
  band.parent = lh;
  const lamp = sphereMesh(scene, 4, 10, basicMat(scene, { color: 0xffe98a }));
  lamp.position.y = 27.5;
  lamp.parent = lh;
  const lampGlow = makeBillboard(scene, glowTexture(scene), 16, 16, { color: 0xffe98a, opacity: 0.55 });
  lampGlow.position.y = 27.5;
  lampGlow.parent = lh;
  lh.position.set(LANDMARKS.hideout.x, 0, LANDMARKS.hideout.z);
  colliders.push({ minX: LANDMARKS.hideout.x - 4.5, maxX: LANDMARKS.hideout.x + 4.5, minZ: LANDMARKS.hideout.z - 4.5, maxZ: LANDMARKS.hideout.z + 4.5, h: 26 });

  // Rico's Garage + Respray bay: building behind, open bay in front of the
  // landmark point, neon sign, painted bay floor the player drives onto.
  const garage = boxMesh(scene, 26, 9, 16, std(0x3f6d8e));
  garage.position.set(LANDMARKS.garage.x, 4.5, LANDMARKS.garage.z - 15);
  markShadow(garage, true, true);
  colliders.push({ minX: LANDMARKS.garage.x - 13, maxX: LANDMARKS.garage.x + 13, minZ: LANDMARKS.garage.z - 23, maxZ: LANDMARKS.garage.z - 7, h: 9 });
  const doorDark = boxMesh(scene, 11, 6.4, 0.6, std(0x14181e, 0.6));
  doorDark.position.set(LANDMARKS.garage.x, 3.2, LANDMARKS.garage.z - 6.8);
  const bay = groundQuad(scene, 11, 13, pbrMat(scene, { color: 0x4a5058, roughness: 0.7 }));
  bay.position.set(LANDMARKS.garage.x, 0.045, LANDMARKS.garage.z);
  markShadow(bay, false, true);
  const bayEdge = BABYLON.MeshBuilder.CreateTorus(uid('ring'), { diameter: 9.7, thickness: 0.5, tessellation: 4 }, scene);
  bayEdge.material = basicMat(scene, { color: 0xffd23e });
  bayEdge.isPickable = false;
  bayEdge.rotation.x = Math.PI / 2;
  bayEdge.rotation.y = Math.PI / 4;
  bayEdge.position.set(LANDMARKS.garage.x, 0.06, LANDMARKS.garage.z);
  const ricoSign = BABYLON.MeshBuilder.CreatePlane(uid('sign'), { width: 17, height: 4.2 }, scene);
  ricoSign.material = basicMat(scene, { map: signTexture(scene, "RICO'S RESPRAY", '#5ef2ff', '#101820') });
  ricoSign.isPickable = false;
  ricoSign.rotation.y = Math.PI;   // Babylon planes face -z; +PI restores the three.js +z facing
  ricoSign.position.set(LANDMARKS.garage.x, 8.2, LANDMARKS.garage.z - 6.6);
  const ricoSignBack = BABYLON.MeshBuilder.CreatePlane(uid('sign'), { width: 17, height: 4.2 }, scene);
  ricoSignBack.material = basicMat(scene, { map: signTexture(scene, "RICO'S GARAGE", '#ffb347', '#181008') });
  ricoSignBack.isPickable = false;
  ricoSignBack.position.set(LANDMARKS.garage.x, 7.6, LANDMARKS.garage.z - 23.2);
  ricoSignBack.rotation.y = 0;   // was PI in three.js; Babylon's flipped plane facing cancels it
  // shutter doors on the north face so the block never reads as a blank slab
  const shutterMat = pbrMat(scene, { color: 0x707880, roughness: 0.55, metalness: 0.55 });
  for (const off of [-6.5, 0, 6.5]) {
    const shutter = boxMesh(scene, 4.6, 5.2, 0.3, shutterMat);
    shutter.position.set(LANDMARKS.garage.x + off, 2.6, LANDMARKS.garage.z - 23.1);
  }

  // Mama Rosa's cafe: cream base, red awning, pink neon
  const cafeBase = boxMesh(scene, 12, 3.4, 8, std(0xf3e2c7));
  cafeBase.position.set(LANDMARKS.cafe.x, 1.7, LANDMARKS.cafe.z);
  markShadow(cafeBase, true, true);
  colliders.push({ minX: LANDMARKS.cafe.x - 6, maxX: LANDMARKS.cafe.x + 6, minZ: LANDMARKS.cafe.z - 4, maxZ: LANDMARKS.cafe.z + 4, h: 3.4 });
  const cafeTop = boxMesh(scene, 13, 1, 9, std(0xd84040));
  cafeTop.position.set(LANDMARKS.cafe.x, 3.6, LANDMARKS.cafe.z);
  markShadow(cafeTop, true, false);
  const cafeSign = BABYLON.MeshBuilder.CreatePlane(uid('sign'), { width: 11, height: 2.6 }, scene);
  cafeSign.material = basicMat(scene, { map: signTexture(scene, "MAMA ROSA'S", '#ff8ac2', '#241016') });
  cafeSign.isPickable = false;
  cafeSign.position.set(LANDMARKS.cafe.x, 5.4, LANDMARKS.cafe.z + 2);
  cafeSign.rotation.y = 0.5 + Math.PI;   // +PI: Babylon plane facing flip (see ricoSign)

  // Hospital with a red-cross sign; the door is the full-heal spot
  const hosp = boxMesh(scene, 17, 13, 12, std(0xeef2f4, 0.7));
  hosp.position.set(LANDMARKS.hospital.x, 6.5, LANDMARKS.hospital.z - 12);
  markShadow(hosp, true, true);
  colliders.push({ minX: LANDMARKS.hospital.x - 8.5, maxX: LANDMARKS.hospital.x + 8.5, minZ: LANDMARKS.hospital.z - 18, maxZ: LANDMARKS.hospital.z - 6, h: 13 });
  const cross = BABYLON.MeshBuilder.CreatePlane(uid('sign'), { width: 7, height: 7 }, scene);
  cross.material = basicMat(scene, { map: signTexture(scene, '+', '#e03040', '#f4f6f8') });
  cross.isPickable = false;
  cross.rotation.y = Math.PI;   // Babylon plane facing flip (see ricoSign)
  cross.position.set(LANDMARKS.hospital.x, 10, LANDMARKS.hospital.z - 5.8);

  // Solmaris PD HQ: dark block, blue sign — police dispatch rolls out of here
  const hq = boxMesh(scene, 18, 11, 13, std(0x2c3a4e, 0.8));
  hq.position.set(LANDMARKS.station.x, 5.5, LANDMARKS.station.z);
  markShadow(hq, true, true);
  colliders.push({ minX: LANDMARKS.station.x - 9, maxX: LANDMARKS.station.x + 9, minZ: LANDMARKS.station.z - 6.5, maxZ: LANDMARKS.station.z + 6.5, h: 11 });
  const hqSign = BABYLON.MeshBuilder.CreatePlane(uid('sign'), { width: 13, height: 3 }, scene);
  hqSign.material = basicMat(scene, { map: signTexture(scene, 'SOLMARIS PD', '#bcd6ff', '#101c2e') });
  hqSign.isPickable = false;
  hqSign.position.set(LANDMARKS.station.x + 4, 9.4, LANDMARKS.station.z + 6.7);
  hqSign.rotation.y = 0.35 + Math.PI;   // +PI: Babylon plane facing flip (see ricoSign)

  // Pawn Shop: the ammo store. A small corner shop just east of the
  // LANDMARKS.pawn door point (45,-50) on the south sidewalk of the
  // east-west avenue — teal block, orange roof trim, PAWN signs on its
  // west and north faces so it reads from the intersection. The door
  // point itself stays clear; E there buys 24 rounds for $50 (main.js).
  const pawnBase = boxMesh(scene, 7, 3.6, 5, std(0x2e6f6a));
  pawnBase.position.set(50, 1.8, -50);
  markShadow(pawnBase, true, true);
  colliders.push({ minX: 46.5, maxX: 53.5, minZ: -52.5, maxZ: -47.5, h: 3.6 });
  const pawnTop = boxMesh(scene, 7.6, 0.7, 5.6, std(0xe07b2a));
  pawnTop.position.set(50, 3.95, -50);
  markShadow(pawnTop, true, false);
  const pawnSignW = BABYLON.MeshBuilder.CreatePlane(uid('sign'), { width: 5.6, height: 1.5 }, scene);
  pawnSignW.material = basicMat(scene, { map: signTexture(scene, 'PAWN', '#ffb02a', '#14201e') });
  pawnSignW.isPickable = false;
  pawnSignW.position.set(46.4, 2.9, -50);
  pawnSignW.rotation.y = Math.PI / 2;   // face west, toward the door point and the avenue crossing
  const pawnSignN = BABYLON.MeshBuilder.CreatePlane(uid('sign'), { width: 5.6, height: 1.5 }, scene);
  pawnSignN.material = basicMat(scene, { map: signTexture(scene, 'PAWN · HOTEL', '#ffb02a', '#14201e') });
  pawnSignN.isPickable = false;
  pawnSignN.position.set(50, 2.9, -47.4);
  pawnSignN.rotation.y = 0;   // north face: Babylon's default plane facing reads correctly here (see ricoSignBack)
}
let glowTexShared = null;
export function glowTexture(scene) {
  if (glowTexShared) return glowTexShared;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.32)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  glowTexShared = texFromCanvas(c, scene, { hasAlpha: true });
  return glowTexShared;
}
// Shared street-lamp materials + head registry (lighting adaptation):
// every lamp head built below registers its {x,z} here so buildWorld's
// real PointLight pool can seat itself on the heads nearest the player.
// The bulb / ground-disc materials stay emissive decoration; the pool
// lights below are what actually illuminate people, cars and asphalt.
let streetBulbMat = null;
let streetDiscMat = null;
function buildStreetLights(scene) {
  const poleMat = pbrMat(scene, { color: 0x394048, roughness: 0.6, metalness: 0.5 });
  const bulbMat = basicMat(scene, { color: 0xffdf9e });
  streetBulbMat = bulbMat;
  const poolMat = basicMat(scene, { color: 0xffc978, opacity: 0.06, depthWrite: false });
  streetDiscMat = poolMat;
  poolMat.backFaceCulling = false;
  const heads = [];
  const lines = roadLines();
  for (const c of lines) {
    for (let d = -WORLD.half + 20; d < WORLD.half; d += 40) {
      for (const [x, z] of [[c + 9.5, d], [d, c - 9.5]]) {
        heads.push({ x, z });
        const pole = cylMesh(scene, 0.32, 0.4, 6.6, 5, poleMat);
        pole.position.set(x, 3.3, z);
        markShadow(pole, true, false);
        const bulb = sphereMesh(scene, 0.84, 6, bulbMat);
        bulb.position.set(x, 6.7, z);
        // realism detail: a metal shade cone over the bulb (the PointLight
        // pool still seats on the same head position, unchanged)
        const shade = BABYLON.MeshBuilder.CreateCylinder(uid('shade'), { diameterTop: 0.3, diameterBottom: 1.35, height: 0.5, tessellation: 10 }, scene);
        shade.material = poleMat;
        shade.isPickable = false;
        shade.position.set(x, 7.05, z);
        const pool = BABYLON.MeshBuilder.CreateDisc(uid('disc'), { radius: 4.6, tessellation: 12 }, scene);
        pool.material = poolMat;
        pool.isPickable = false;
        pool.rotation.x = -Math.PI / 2;
        pool.position.set(x, 0.05, z);
        pool.renderingGroupId = 1;
      }
    }
  }
  // benches, bins and hydrants sprinkled along the sidewalks
  const benchMat = pbrMat(scene, { color: 0x7a5230, roughness: 0.9 });
  const binMat = pbrMat(scene, { color: 0x2e6b46, roughness: 0.8 });
  const hydMat = pbrMat(scene, { color: 0xd84040, roughness: 0.6 });
  for (let i = 0; i < 60; i++) {
    const vertical = rand() > 0.5;
    const line = randPick(lines) + (rand() > 0.5 ? 11 : -11);
    const along = randRange(-WORLD.half + 10, WORLD.half - 10);
    const x = vertical ? line : along, z = vertical ? along : line;
    const kind = rand();
    if (kind < 0.4) {
      const b = boxMesh(scene, 2.4, 0.18, 0.7, benchMat);
      b.position.set(x, 0.55, z); b.rotation.y = vertical ? Math.PI / 2 : 0;
      markShadow(b, true, false);
    } else if (kind < 0.75) {
      const b = cylMesh(scene, 0.9, 0.8, 1.05, 7, binMat);
      b.position.set(x, 0.52, z);
      markShadow(b, true, false);
    } else {
      const hgeo = cylMesh(scene, 0.44, 0.56, 0.8, 6, hydMat);
      hgeo.position.set(x, 0.4, z);
      markShadow(hgeo, true, false);
    }
  }
  return heads;
}
function buildTrafficLights(scene) {
  const poleMat = pbrMat(scene, { color: 0x2c3138, roughness: 0.6, metalness: 0.4 });
  const headMat = pbrMat(scene, { color: 0x171a1f, roughness: 0.7 });
  const redMat = basicMat(scene, { color: 0xff2a30 });
  const greenMat = basicMat(scene, { color: 0x2aff66 });
  const amberMat = basicMat(scene, { color: 0xffb02a });
  const dimMat = basicMat(scene, { color: 0x2a2d33 });
  const out = [];
  const lines = roadLines();
  for (const cx of lines) for (const cz of lines) {
    // one head per intersection corner pair, alternating orientation
    const ns = ((cx + cz) / 80) % 2 === 0;
    const pole = cylMesh(scene, 0.28, 0.28, 5.4, 5, poleMat);
    pole.position.set(cx + 10.2, 2.7, cz - 10.2);
    const head = boxMesh(scene, 0.55, 1.5, 0.55, headMat);
    head.position.set(cx + 10.2, 5.6, cz - 10.2);
    const mk = (dy, mat) => {
      const s = sphereMesh(scene, 0.38, 6, mat);
      s.position.set(cx + 10.2, 5.6 + dy, cz - 9.9);
      return s;
    };
    const r = mk(0.48, redMat), a = mk(0, dimMat), g = mk(-0.48, greenMat);
    out.push({ ns, r, a, g, redMat, greenMat, amberMat, dimMat });
  }
  return out;
}
function buildSunSprite(scene) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,244,205,1)');
  grad.addColorStop(0.3, 'rgba(255,196,110,0.9)');
  grad.addColorStop(1, 'rgba(255,150,80,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  const spr = makeBillboard(scene, texFromCanvas(c, scene, { hasAlpha: true }), 230, 230, { fog: false });
  spr.position.set(-420, 150, 660);
  // the sun's hard disc inside the glow
  const dc = document.createElement('canvas');
  dc.width = dc.height = 64;
  const dg = dc.getContext('2d');
  const dgrad = dg.createRadialGradient(32, 32, 8, 32, 32, 30);
  dgrad.addColorStop(0, 'rgba(255,252,230,1)');
  dgrad.addColorStop(0.8, 'rgba(255,240,190,0.95)');
  dgrad.addColorStop(1, 'rgba(255,220,150,0)');
  dg.fillStyle = dgrad; dg.fillRect(0, 0, 64, 64);
  const disc = makeBillboard(scene, texFromCanvas(dc, scene, { hasAlpha: true }), 52, 52, { fog: false });
  disc.position.set(-452, 162, 712);
}
// Soft billboard clouds: each is a cluster of blurred blobs on one canvas,
// tinted warm underneath by the hour. They drift in world.update.
function buildClouds(scene) {
  const out = [];
  for (let i = 0; i < 6; i++) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 128;
    const g = c.getContext('2d');
    for (let b = 0; b < 9; b++) {
      const bx = 52 + rand() * 152, by = 48 + rand() * 30, br = 16 + rand() * 26;
      const grad = g.createRadialGradient(bx, by, 2, bx, by, br);
      grad.addColorStop(0, 'rgba(255,246,238,0.55)');
      grad.addColorStop(0.7, 'rgba(255,214,180,0.28)');
      grad.addColorStop(1, 'rgba(255,200,170,0)');
      g.fillStyle = grad;
      g.beginPath(); g.arc(bx, by, br, 0, Math.PI * 2); g.fill();   // disc, never a clipped square edge
    }
    const sc = randRange(120, 220);
    const spr = makeBillboard(scene, texFromCanvas(c, scene, { hasAlpha: true }), sc, sc * 0.42, { opacity: 0.75, fog: false });
    spr.position.set(randRange(-700, 700), randRange(120, 210), randRange(-650, 650));
    out.push(spr);
  }
  return out;
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
