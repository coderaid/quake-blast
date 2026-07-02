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
