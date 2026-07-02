import * as THREE from 'three';
import { CONFIG } from './config';
import { featherTexture, furTexture } from './textures';

/**
 * A flying "quake eagle": a procedurally-built raptor with glowing red eyes that
 * soars in, dives to deal contact damage, and periodically lands on a jungle tree
 * to rest before resuming the attack. Like the rabbit Monster it does NOT respawn
 * — eagles are their own finite pool layered on top of the ground wave.
 *
 * Flight reads as alternating FLAP (fast wing-beats that gain altitude) and GLIDE
 * (wings held in a shallow dihedral, slowly sinking) phases. The root group carries
 * userData.monster = this so the shared shooting raycast in Game resolves a hit on
 * any child mesh back to its owning Eagle (Eagle structurally matches Monster's
 * damage()/alive contract used there).
 *
 * Perch points are injected via `perches` (the same array Game owns) so this entity
 * stays decoupled from however the jungle/tree geometry is built; while that list is
 * empty the eagle simply soars and attacks.
 */

// Palette (visual only; gameplay numbers live in CONFIG).
const BODY = 0x5a3a1a; // dark brown plumage
const HEAD = 0xf3f1e7; // pale "bald eagle" head
const BEAK = 0xffc23a; // yellow beak/talons
const EYE = 0xff1818; // glowing red eye
const FEATHER_TIP = 0x3a2510; // darker primaries

type State = 'soar' | 'toPerch' | 'perched';

export class Eagle {
  readonly mesh: THREE.Group;
  readonly radius = CONFIG.eagle.radius;
  readonly damagePerSecond = CONFIG.eagle.damagePerSecond;
  health: number = CONFIG.eagle.maxHealth;
  alive = true;

  /** Candidate tree-top sit points, owned/updated by Game (empty until trees exist). */
  perches: THREE.Vector3[] = [];

  private state: State = 'soar';
  private baseY: number = CONFIG.eagle.cruiseHeight; // altitude goal, before flap bob
  private timer = 0; // counts down a perched stay
  private cooldown: number = CONFIG.eagle.perchInterval; // soaring time before next perch
  private perchTarget: THREE.Vector3 | null = null;

  private wings: { group: THREE.Group; sx: number }[] = [];
  private flapPhase = Math.random() * Math.PI * 2; // desync wing-beats between eagles
  private flapping = true;
  private modeTimer: number = CONFIG.eagle.flapDuration;
  private groundHeight: (x: number, z: number) => number;

  constructor(
    scene: THREE.Scene,
    spawn: THREE.Vector3,
    groundHeight: (x: number, z: number) => number = () => 0
  ) {
    this.groundHeight = groundHeight;
    this.mesh = this.buildEagle();
    this.baseY = spawn.y;
    this.mesh.position.set(spawn.x, spawn.y, spawn.z);
    this.mesh.userData.monster = this; // shared raycast back-reference (see Game.shoot)
    scene.add(this.mesh);
  }

  /** Never let the bird pass through the rocky hill — keep it above the terrain. */
  private clampAltitude(): void {
    const floor = this.groundHeight(this.mesh.position.x, this.mesh.position.z) + CONFIG.eagle.radius + 1;
    if (this.mesh.position.y < floor) this.mesh.position.y = floor;
  }

  /** Assemble the eagle from primitives. Head/beak face local +z (travel dir). */
  private buildEagle(): THREE.Group {
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: BODY, map: featherTexture(), roughness: 0.8 });
    const headMat = new THREE.MeshStandardMaterial({ color: HEAD, map: furTexture(), roughness: 0.7 });
    const beakMat = new THREE.MeshStandardMaterial({ color: BEAK, roughness: 0.4 });

    const body = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), bodyMat);
    body.scale.set(1, 0.8, 1.7); // streamlined, longer front-to-back
    body.castShadow = true;
    g.add(body);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 12), headMat);
    head.position.set(0, 0.28, 0.72);
    head.castShadow = true;
    g.add(head);

    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.34, 10), beakMat);
    beak.position.set(0, 0.2, 1.02);
    beak.rotation.x = Math.PI / 2; // apex points forward (+z)
    g.add(beak);

    // Glowing red eyes.
    const eyeMat = new THREE.MeshStandardMaterial({
      color: EYE,
      emissive: 0xaa0000,
      emissiveIntensity: 1.4,
      roughness: 0.25,
    });
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 10), eyeMat);
      eye.position.set(0.14 * sx, 0.36, 0.92);
      g.add(eye);
    }

    // Wings: each a shoulder-pivoted group so it can flap about local z. The wing
    // extends outward from the group origin, with a darker primary-feather tip.
    const tipMat = new THREE.MeshStandardMaterial({ color: FEATHER_TIP, roughness: 0.85 });
    for (const sx of [-1, 1]) {
      const wing = new THREE.Group();
      wing.position.set(0.32 * sx, 0.16, 0);

      const inner = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.06, 0.85), bodyMat);
      inner.position.set(0.5 * sx, 0, 0);
      inner.castShadow = true;
      wing.add(inner);

      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.05, 0.55), tipMat);
      tip.position.set(1.35 * sx, 0, -0.1);
      tip.castShadow = true;
      wing.add(tip);

      g.add(wing);
      this.wings.push({ group: wing, sx });
    }

    // Fanned tail.
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.05, 0.75), bodyMat);
    tail.position.set(0, 0.02, -0.95);
    tail.castShadow = true;
    g.add(tail);

    return g;
  }

  /** Returns true if this hit killed the eagle. */
  damage(amount: number): boolean {
    if (!this.alive) return false;
    this.health -= amount;
    if (this.health <= 0) {
      this.alive = false;
      this.mesh.visible = false;
      return true;
    }
    return false;
  }

  /**
   * Fly toward `target` on the XZ plane, diving to strike. Returns true when within
   * contact range of a target of the given radius (so the caller can apply damage).
   * While perching (or flying to a perch) it never reports contact.
   */
  update(dt: number, target: THREE.Vector3, targetRadius: number): boolean {
    if (!this.alive) return false;

    // --- Wing flap/glide cycle (drives wing angle + a little vertical bob) ------
    this.modeTimer -= dt;
    if (this.modeTimer <= 0) {
      this.flapping = !this.flapping;
      this.modeTimer = this.flapping ? CONFIG.eagle.flapDuration : CONFIG.eagle.glideDuration;
    }
    let wingAngle: number;
    let bob: number;
    if (this.flapping) {
      this.flapPhase += dt * CONFIG.eagle.flapRate;
      const beat = Math.sin(this.flapPhase);
      wingAngle = 0.25 + beat * 0.8; // big symmetric sweep
      bob = beat * 0.18; // rises and falls with the beat
    } else {
      wingAngle = 0.3; // held shallow dihedral
      bob = 0;
    }

    // --- Perched: sitting on a tree, wings tucked up, not attacking -------------
    if (this.state === 'perched') {
      this.timer -= dt;
      for (const w of this.wings) w.group.rotation.z = 1.05 * w.sx; // folded
      if (this.timer <= 0) {
        this.state = 'soar';
        this.cooldown = CONFIG.eagle.perchInterval;
      }
      return false;
    }

    for (const w of this.wings) w.group.rotation.z = wingAngle * w.sx;

    // --- Flying to a chosen tree top -------------------------------------------
    if (this.state === 'toPerch' && this.perchTarget) {
      if (this.flyToward(this.perchTarget, dt)) {
        this.state = 'perched';
        this.timer = CONFIG.eagle.perchDuration;
        this.perchTarget = null;
      }
      return false;
    }

    // --- Soaring: maybe decide to peel off and perch ---------------------------
    this.cooldown -= dt;
    if (
      this.cooldown <= 0 &&
      this.perches.length > 0 &&
      Math.random() < CONFIG.eagle.perchChance * dt
    ) {
      this.perchTarget = this.nearestPerch();
      if (this.perchTarget) {
        this.state = 'toPerch';
        return false;
      }
    }

    // --- Soar toward target, easing altitude from cruise down to dive on approach
    const dx = target.x - this.mesh.position.x;
    const dz = target.z - this.mesh.position.z;
    const dist = Math.hypot(dx, dz);
    const contact = CONFIG.eagle.radius + targetRadius;

    const goalY = dist < contact * 2.5 ? CONFIG.eagle.diveHeight : CONFIG.eagle.cruiseHeight;
    this.baseY += (goalY - this.baseY) * Math.min(1, dt * CONFIG.eagle.climbRate);
    this.mesh.position.y = this.baseY + bob;

    if (dist > contact) {
      const inv = 1 / (dist || 1);
      this.mesh.position.x += dx * inv * CONFIG.eagle.speed * dt;
      this.mesh.position.z += dz * inv * CONFIG.eagle.speed * dt;
      this.mesh.rotation.y = Math.atan2(dx, dz); // beak leads the flight
      this.clampAltitude();
      return false;
    }
    this.clampAltitude();
    return true; // diving in contact — caller applies damage
  }

  /** Move toward a point in 3D; returns true once horizontally and vertically there. */
  private flyToward(p: THREE.Vector3, dt: number): boolean {
    const dx = p.x - this.mesh.position.x;
    const dz = p.z - this.mesh.position.z;
    const dist = Math.hypot(dx, dz);

    this.baseY += (p.y - this.baseY) * Math.min(1, dt * CONFIG.eagle.climbRate);
    this.mesh.position.y = this.baseY;

    if (dist > 0.4) {
      const inv = 1 / (dist || 1);
      this.mesh.position.x += dx * inv * CONFIG.eagle.speed * dt;
      this.mesh.position.z += dz * inv * CONFIG.eagle.speed * dt;
      this.mesh.rotation.y = Math.atan2(dx, dz);
      this.clampAltitude();
      return false;
    }
    return Math.abs(p.y - this.baseY) < 0.3;
  }

  private nearestPerch(): THREE.Vector3 | null {
    let best: THREE.Vector3 | null = null;
    let bestDist = Infinity;
    for (const p of this.perches) {
      const d = p.distanceToSquared(this.mesh.position);
      if (d < bestDist) {
        bestDist = d;
        best = p;
      }
    }
    return best;
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.mesh);
    this.mesh.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
  }
}
