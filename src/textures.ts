import * as THREE from 'three';

/**
 * Shared procedural "skin" textures for the game's shapes. They are grayscale
 * DETAIL maps with a LIGHT base (keeps the underlying color bright) and BOLD
 * dark features (visible grooves/veins/blotches) so they multiply each mesh's
 * color or per-instance color into a clearly textured surface. Built once and
 * cached, so thousands of instanced meshes share a single texture.
 */

function makeTex(
  draw: (ctx: CanvasRenderingContext2D, s: number) => void,
  size: number,
  repeat: [number, number]
): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  draw(c.getContext('2d')!, size);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  return tex;
}

let _bark: THREE.CanvasTexture | null = null;
export function barkTexture(): THREE.CanvasTexture {
  if (_bark) return _bark;
  _bark = makeTex(
    (ctx, s) => {
      ctx.fillStyle = '#f2f2f2';
      ctx.fillRect(0, 0, s, s);
      for (let i = 0; i < 90; i++) {
        ctx.fillStyle = `rgba(20,20,20,${0.35 + Math.random() * 0.4})`; // deep grooves
        ctx.fillRect(Math.random() * s, 0, 1 + Math.random() * 4, s);
      }
      for (let i = 0; i < 30; i++) {
        ctx.fillStyle = 'rgba(255,255,255,0.6)'; // ridge highlights
        ctx.fillRect(Math.random() * s, 0, 1, s);
      }
    },
    128,
    [1, 4]
  );
  return _bark;
}

let _leaf: THREE.CanvasTexture | null = null;
export function leafTexture(): THREE.CanvasTexture {
  if (_leaf) return _leaf;
  _leaf = makeTex(
    (ctx, s) => {
      ctx.fillStyle = '#eaeaea';
      ctx.fillRect(0, 0, s, s);
      for (let i = 0; i < 55; i++) {
        ctx.fillStyle = `rgba(35,45,25,${0.3 + Math.random() * 0.35})`; // leaf clumps
        ctx.beginPath();
        ctx.arc(Math.random() * s, Math.random() * s, 4 + Math.random() * 12, 0, Math.PI * 2);
        ctx.fill();
      }
      for (let i = 0; i < 200; i++) {
        ctx.fillStyle = `rgba(20,30,15,${0.3 + Math.random() * 0.4})`; // speckle
        ctx.beginPath();
        ctx.arc(Math.random() * s, Math.random() * s, 1 + Math.random() * 2, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    128,
    [3, 3]
  );
  return _leaf;
}

let _rock: THREE.CanvasTexture | null = null;
export function rockTexture(): THREE.CanvasTexture {
  if (_rock) return _rock;
  _rock = makeTex(rockDraw, 128, [2, 2]);
  return _rock;
}

/** A separate rock texture tiled tighter, for large surfaces like the hill. */
export function rockTextureTiled(repeat: number): THREE.CanvasTexture {
  return makeTex(rockDraw, 128, [repeat, repeat]);
}

function rockDraw(ctx: CanvasRenderingContext2D, s: number): void {
  ctx.fillStyle = '#e6e6e6';
  ctx.fillRect(0, 0, s, s);
  for (let i = 0; i < 130; i++) {
    ctx.fillStyle = `rgba(45,45,50,${0.3 + Math.random() * 0.4})`; // dark rock patches
    ctx.beginPath();
    ctx.arc(Math.random() * s, Math.random() * s, 3 + Math.random() * 14, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(15,15,15,0.6)'; // cracks
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 16; i++) {
    ctx.beginPath();
    ctx.moveTo(Math.random() * s, Math.random() * s);
    ctx.lineTo(Math.random() * s, Math.random() * s);
    ctx.stroke();
  }
}

let _fur: THREE.CanvasTexture | null = null;
export function furTexture(): THREE.CanvasTexture {
  if (_fur) return _fur;
  _fur = makeTex(
    (ctx, s) => {
      ctx.fillStyle = '#f2f2f2';
      ctx.fillRect(0, 0, s, s);
      for (let i = 0; i < 1400; i++) {
        const g = 140 + Math.random() * 90;
        ctx.fillStyle = `rgba(${g},${g},${g},0.55)`;
        ctx.fillRect(Math.random() * s, Math.random() * s, 1, 2 + Math.random() * 3); // strands
      }
    },
    128,
    [4, 4]
  );
  return _fur;
}

let _feather: THREE.CanvasTexture | null = null;
export function featherTexture(): THREE.CanvasTexture {
  if (_feather) return _feather;
  _feather = makeTex(
    (ctx, s) => {
      ctx.fillStyle = '#ececec';
      ctx.fillRect(0, 0, s, s);
      for (let i = 0; i < 70; i++) {
        ctx.fillStyle = `rgba(30,30,30,${0.3 + Math.random() * 0.35})`; // barbs
        ctx.fillRect(0, Math.random() * s, s, 1 + Math.random() * 2);
      }
    },
    128,
    [1, 3]
  );
  return _feather;
}

/**
 * True for the cached singleton textures above. Level teardown disposes every
 * texture a level created, but must leave these shared ones alone — they are
 * reused by entities (rabbits, eagles, bricks) and by the next level.
 */
export function isSharedTexture(t: THREE.Texture): boolean {
  return t === _bark || t === _leaf || t === _rock || t === _fur || t === _feather;
}

/** A mottled noise texture from a small palette — cheap ground/dirt/snow variation. */
export function noiseTexture(palette: string[], size: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = palette[0];
  ctx.fillRect(0, 0, size, size);
  const blotches = size * 6;
  for (let i = 0; i < blotches; i++) {
    ctx.fillStyle = palette[Math.floor(Math.random() * palette.length)];
    ctx.globalAlpha = 0.25 + Math.random() * 0.5;
    const r = 1 + Math.random() * (size / 18);
    ctx.beginPath();
    ctx.arc(Math.random() * size, Math.random() * size, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  return new THREE.CanvasTexture(c);
}

/** Vertical sky gradient (zenith → mid → horizon) for a backside sky dome. */
export function skyGradientTexture(zenith: string, mid: string, horizon: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, zenith);
  g.addColorStop(0.5, mid);
  g.addColorStop(1, horizon);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 16, 256);
  return new THREE.CanvasTexture(c);
}

/** A procedural water normal map: gentle bluish wave perturbations, tileable. */
export function waterNormalsTexture(): THREE.CanvasTexture {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = 'rgb(128,128,255)'; // flat normal
  ctx.fillRect(0, 0, s, s);
  for (let i = 0; i < 48; i++) {
    const x = Math.random() * s;
    const y = Math.random() * s;
    const r = 10 + Math.random() * 45;
    const ang = Math.random() * Math.PI * 2;
    const nx = Math.round(128 + Math.cos(ang) * 60);
    const ny = Math.round(128 + Math.sin(ang) * 60);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgb(${nx},${ny},255)`);
    g.addColorStop(1, 'rgba(128,128,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
