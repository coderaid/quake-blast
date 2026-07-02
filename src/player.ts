import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { CONFIG } from './config';

/** Analog input source (the touch joystick/buttons) — see src/touch.ts. */
export interface TouchInput {
  moveX: number; // strafe right, -1..1
  moveY: number; // forward, -1..1
  jumpHeld: boolean;
}

const TOUCH_LOOK_SPEED = 0.0045; // radians of look per px of touch drag

/**
 * First-person player: pointer-lock mouse look + WASD movement with wall
 * clamping, a hitscan weapon, and a ground-aim ray used to place bases during
 * the build phase. The camera IS the player; movement is applied to the
 * controls object (camera rig).
 *
 * On touch devices there is no pointer lock: Game sets `touchPlaying` when the
 * player taps play, `touch` supplies analog movement/jump, and `applyLook()`
 * receives drag deltas. Desktop pointer-lock flow is unchanged.
 */
export class Player {
  readonly controls: PointerLockControls;
  health: number = CONFIG.player.maxHealth;

  /** Analog movement source; merged with WASD each frame when attached. */
  touch: TouchInput | null = null;
  /** Touch-mode "in gameplay" flag (pointer lock's stand-in), set by Game. */
  touchPlaying = false;

  private velocity = new THREE.Vector3();
  private keys = new Set<string>();
  private cooldown = 0;
  private raycaster = new THREE.Raycaster();
  private euler = new THREE.Euler(0, 0, 0, 'YXZ'); // touch look, same order as PointerLockControls
  private footY = 0; // ground-height of the player's feet (drives jump/gravity)
  private vVel = 0; // vertical velocity
  private onGround = true;

  constructor(
    private camera: THREE.PerspectiveCamera,
    domElement: HTMLElement,
    private bound: number,
    private groundHeight: (x: number, z: number) => number = () => 0,
    private pond: { x: number; z: number; r: number } | null = null,
    private solids: () => { x: number; z: number; half: number; top: number; bottom: number }[] = () => []
  ) {
    this.controls = new PointerLockControls(camera, domElement);
    camera.position.set(0, CONFIG.player.eyeHeight, CONFIG.arena.halfSize * 0.7);

    window.addEventListener('keydown', (e) => this.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
  }

  get position(): THREE.Vector3 {
    return this.camera.position;
  }

  get isLocked(): boolean {
    return this.controls.isLocked;
  }

  /** True while gameplay input should apply: pointer-locked, or touch play. */
  get active(): boolean {
    return this.controls.isLocked || this.touchPlaying;
  }

  /** Touch look: apply drag deltas as yaw/pitch, matching PointerLockControls' feel. */
  applyLook(dx: number, dy: number): void {
    if (!this.active) return;
    this.euler.setFromQuaternion(this.camera.quaternion);
    this.euler.y -= dx * TOUCH_LOOK_SPEED;
    this.euler.x -= dy * TOUCH_LOOK_SPEED;
    this.euler.x = THREE.MathUtils.clamp(this.euler.x, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05);
    this.camera.quaternion.setFromEuler(this.euler);
  }

  /** Returns true if a shot was fired (respects cooldown + active gameplay). */
  tryShoot(targets: THREE.Object3D[]): THREE.Intersection | null {
    if (!this.active || this.cooldown > 0) return null;
    this.cooldown = CONFIG.weapon.cooldown;

    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    this.raycaster.far = CONFIG.weapon.range;
    const hits = this.raycaster.intersectObjects(targets, true);
    return hits.length > 0 ? hits[0] : null;
  }

  /**
   * Intersect the center-screen ray with the ground plane (y=0), writing the
   * hit point into `out`. Returns false when looking at/above the horizon.
   */
  aimGroundPoint(out: THREE.Vector3): boolean {
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    const ray = this.raycaster.ray;
    if (ray.direction.y >= -1e-5) return false; // looking up or flat
    const t = -ray.origin.y / ray.direction.y;
    out.copy(ray.origin).addScaledVector(ray.direction, t);
    return true;
  }

  damage(amount: number): void {
    this.health = Math.max(0, this.health - amount);
  }

  update(dt: number): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (!this.active) return;

    const { moveSpeed, damping, radius } = CONFIG.player;

    // Input → desired direction in camera-local space (WASD + touch joystick).
    const kForward = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
    const kRight = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
    const forward = THREE.MathUtils.clamp(kForward + (this.touch?.moveY ?? 0), -1, 1);
    const right = THREE.MathUtils.clamp(kRight + (this.touch?.moveX ?? 0), -1, 1);

    this.velocity.x -= this.velocity.x * damping * dt;
    this.velocity.z -= this.velocity.z * damping * dt;
    this.velocity.z -= forward * moveSpeed * dt;
    this.velocity.x -= right * moveSpeed * dt;

    this.controls.moveRight(-this.velocity.x * dt);
    this.controls.moveForward(-this.velocity.z * dt);

    // Clamp inside the arena walls.
    const limit = this.bound - radius;
    this.camera.position.x = THREE.MathUtils.clamp(this.camera.position.x, -limit, limit);
    this.camera.position.z = THREE.MathUtils.clamp(this.camera.position.z, -limit, limit);

    // Stop at the pond's bank instead of striding across the water.
    if (this.pond) {
      const dx = this.camera.position.x - this.pond.x;
      const dz = this.camera.position.z - this.pond.z;
      const d = Math.hypot(dx, dz);
      const rr = this.pond.r + radius;
      if (d < rr) {
        const inv = 1 / (d || 1);
        this.camera.position.x = this.pond.x + dx * inv * rr;
        this.camera.position.z = this.pond.z + dz * inv * rr;
      }
    }

    // Bricks you can climb: a brick whose top is within STEP of your feet is a
    // floor you stand on; a taller one is a solid wall you must jump onto.
    const STEP = 0.6;
    const bodyTop = this.footY + CONFIG.player.eyeHeight;
    const bricks = this.solids();
    for (const b of bricks) {
      if (b.top <= this.footY + STEP) continue; // low enough to step onto — not a wall
      if (bodyTop <= b.bottom || this.footY >= b.top) continue; // no vertical overlap
      const hx = b.half + radius;
      const hz = b.half + radius;
      const dx = this.camera.position.x - b.x;
      const dz = this.camera.position.z - b.z;
      if (Math.abs(dx) < hx && Math.abs(dz) < hz) {
        // Push out along the axis of least penetration.
        if (hx - Math.abs(dx) < hz - Math.abs(dz)) {
          this.camera.position.x = b.x + Math.sign(dx || 1) * hx;
        } else {
          this.camera.position.z = b.z + Math.sign(dz || 1) * hz;
        }
      }
    }

    // Support height: the terrain, or the tallest brick top you can stand on.
    let support = this.groundHeight(this.camera.position.x, this.camera.position.z);
    for (const b of bricks) {
      if (b.top > this.footY + STEP) continue;
      if (
        Math.abs(this.camera.position.x - b.x) <= b.half &&
        Math.abs(this.camera.position.z - b.z) <= b.half &&
        b.top > support
      ) {
        support = b.top;
      }
    }

    // Jump + gravity over that support height.
    if (this.onGround && (this.keys.has('Space') || this.touch?.jumpHeld)) {
      this.vVel = CONFIG.player.jumpSpeed;
      this.onGround = false;
    }
    this.vVel -= CONFIG.player.gravity * dt;
    this.footY += this.vVel * dt;
    if (this.footY <= support) {
      this.footY = support; // landed / walking
      this.vVel = 0;
      this.onGround = true;
    }
    this.camera.position.y = this.footY + CONFIG.player.eyeHeight;
  }
}
