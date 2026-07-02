import * as THREE from 'three';
import { CONFIG } from './config';

/**
 * A player-placed base — a gold brick block with HP that monsters attack during
 * the assault. Carries a shared procedural gold-brick texture "skin"; tints from
 * gold (healthy) toward red (damaged) and hides when destroyed. The mesh's
 * userData.building back-reference mirrors the Monster pattern.
 */
export class Building {
  readonly mesh: THREE.Mesh;
  health: number = CONFIG.building.maxHealth;
  alive = true;
  private mat: THREE.MeshStandardMaterial;

  constructor(scene: THREE.Scene, position: THREE.Vector3) {
    const { size, height } = CONFIG.building;
    this.mat = new THREE.MeshStandardMaterial({
      map: goldBrickTexture(),
      color: 0xffffff, // multiplies the gold texture; shifted on damage
      metalness: 0.6,
      roughness: 0.3,
      emissive: 0x2a1e00,
      emissiveIntensity: 0.25,
    });
    this.mesh = new THREE.Mesh(new THREE.BoxGeometry(size, height, size), this.mat);
    // position.y is the brick's base (bottom); the mesh centers half a brick up.
    this.mesh.position.set(position.x, position.y + height / 2, position.z);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.userData.building = this;
    scene.add(this.mesh);
  }

  get position(): THREE.Vector3 {
    return this.mesh.position;
  }

  damage(amount: number): void {
    if (!this.alive) return;
    this.health = Math.max(0, this.health - amount);
    const f = this.health / CONFIG.building.maxHealth; // 1 = healthy, 0 = dead
    this.mat.color.setRGB(1, 0.3 + f * 0.7, f * 0.3); // gold -> red as it takes damage
    if (this.health <= 0) {
      this.alive = false;
      this.mesh.visible = false;
    }
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mat.dispose(); // shared texture is cached, not disposed here
  }
}

/** Shared gold-brick texture, built once and reused by every base. */
let cachedGold: THREE.CanvasTexture | null = null;
function goldBrickTexture(): THREE.CanvasTexture {
  if (cachedGold) return cachedGold;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#c9a227'; // gold base
  ctx.fillRect(0, 0, 128, 128);
  // Brick courses (offset every other row).
  ctx.strokeStyle = '#8a6d12';
  ctx.lineWidth = 3;
  const bh = 32;
  const bw = 64;
  for (let row = 0; row * bh < 128; row++) {
    const y = row * bh;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(128, y);
    ctx.stroke();
    const off = (row % 2) * (bw / 2);
    for (let x = off; x <= 128; x += bw) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + bh);
      ctx.stroke();
    }
  }
  // Sparkly highlights so the gold reads as metal.
  for (let i = 0; i < 220; i++) {
    ctx.fillStyle = `rgba(255,240,180,${Math.random() * 0.16})`;
    ctx.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
  }
  cachedGold = new THREE.CanvasTexture(c);
  return cachedGold;
}
