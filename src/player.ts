import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { CONFIG } from './config';

/** Analog input source (the touch joystick/buttons) — see src/touch.ts. */
export interface TouchInput {
  moveX: number; // strafe right, -1..1
  moveY: number; // forward, -1..1
  jumpHeld: boolean;
}

/**
 * The world data the player moves through. Injected (and re-injected on level
 * change) by Game so Player never reaches into level internals.
 */
export interface PlayerWorld {
  bound: number;
  heightAt: (x: number, z: number) => number;
  /** Water footprint that blocks walking, or null when it's frozen/walkable. */
  pond: { x: number; z: number; r: number } | null;
  /** Ground grip at (x,z): 0 = full traction, 1 = sheet ice. */
  slipAt: (x: number, z: number) => number;
}

const TOUCH_LOOK_SPEED = 0.0045; // radians of look per px of touch drag

// Camera-feel constants (purely perceptual; speeds/physics live in CONFIG).
const BOB_FREQ = 2.4; // stride cycles per unit of horizontal speed
const BOB_HEIGHT = 0.05; // vertical bounce per step at full speed
const BOB_ROLL = 0.01; // rhythmic roll accompanying the steps (radians)
const STRAFE_LEAN = 0.03; // lean into a strafe (radians at full input)
const LEAN_EASE = 9; // how fast the lean follows input
const LAND_DIP_SCALE = 0.02; // crouch dip per unit of landing speed
const LAND_DIP_MAX = 0.34; // hardest possible landing dip
const LAND_RECOVER = 7; // dip recovery rate (per second, exponential)
const BASE_FOV = 75;
const RUN_FOV = 3; // FOV widening at full run speed
const SPRINT_FOV = 6; // extra widening while sprinting
const FOV_EASE = 7;
const RECOIL_PITCH = 0.006; // upward camera kick per shot (radians)

/**
 * First-person player: pointer-lock mouse look + WASD movement with wall
 * clamping, a hitscan weapon, and a ground-aim ray used to place bases during
 * the build phase. The camera IS the player; movement is applied to the
 * controls object (camera rig).
 *
 * Movement carries physical weight cues: velocity + damping locomotion, a
 * sprint (Shift), reduced air control while jumping, stride head-bob, a lean
 * into strafes, a crouch dip on hard landings, speed-widened FOV, recoil kick
 * when firing, and near-zero traction on ice (see PlayerWorld.slipAt).
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

  /** Stride cycle + normalized speed, read by the weapon view to sync its bob. */
  bobPhase = 0;
  speedNorm = 0;

  private world: PlayerWorld = {
    bound: CONFIG.arena.halfSize - 0.5,
    heightAt: () => 0,
    pond: null,
    slipAt: () => 0,
  };

  private velocity = new THREE.Vector3();
  private keys = new Set<string>();
  private cooldown = 0;
  private raycaster = new THREE.Raycaster();
  private euler = new THREE.Euler(0, 0, 0, 'YXZ'); // touch look, same order as PointerLockControls
  private footY = 0; // ground-height of the player's feet (drives jump/gravity)
  private vVel = 0; // vertical velocity
  private onGround = true;
  private lean = 0; // current camera roll (strafe lean + step roll)
  private dip = 0; // landing crouch dip, recovering toward 0
  private fov = BASE_FOV;

  constructor(
    private camera: THREE.PerspectiveCamera,
    domElement: HTMLElement,
    private solids: () => { x: number; z: number; half: number; top: number; bottom: number }[] = () => []
  ) {
    this.controls = new PointerLockControls(camera, domElement);
    camera.position.set(0, CONFIG.player.eyeHeight, CONFIG.arena.halfSize * 0.7);

    window.addEventListener('keydown', (e) => this.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
  }

  /** Swap in a new level's world data (terrain, bound, water, grip). */
  setWorld(world: PlayerWorld): void {
    this.world = world;
  }

  /** Reset to the spawn point with all motion state cleared (level load/restart). */
  resetPose(): void {
    const z = CONFIG.arena.halfSize * 0.7;
    this.velocity.set(0, 0, 0);
    this.vVel = 0;
    this.footY = this.world.heightAt(0, z);
    this.onGround = true;
    this.lean = 0;
    this.dip = 0;
    this.bobPhase = 0;
    this.speedNorm = 0;
    this.camera.position.set(0, this.footY + CONFIG.player.eyeHeight, z);
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

  /**
   * Attempt a shot. `fired` is true when the trigger actually broke (cooldown
   * elapsed + in gameplay) so the caller can play fire effects even on a miss;
   * `hit` is the first intersection with the given targets, if any.
   */
  tryShoot(targets: THREE.Object3D[]): { fired: boolean; hit: THREE.Intersection | null } {
    if (!this.active || this.cooldown > 0) return { fired: false, hit: null };
    this.cooldown = CONFIG.weapon.cooldown;

    // Recoil: the muzzle climbs a touch with every shot.
    this.euler.setFromQuaternion(this.camera.quaternion);
    this.euler.x = THREE.MathUtils.clamp(this.euler.x + RECOIL_PITCH, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05);
    this.camera.quaternion.setFromEuler(this.euler);

    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    this.raycaster.far = CONFIG.weapon.range;
    const hits = this.raycaster.intersectObjects(targets, true);
    return { fired: true, hit: hits.length > 0 ? hits[0] : null };
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

    const { moveSpeed, damping, radius, sprintMultiplier, airControl } = CONFIG.player;

    // Input → desired direction in camera-local space (WASD + touch joystick).
    const kForward = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
    const kRight = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
    const forward = THREE.MathUtils.clamp(kForward + (this.touch?.moveY ?? 0), -1, 1);
    const right = THREE.MathUtils.clamp(kRight + (this.touch?.moveX ?? 0), -1, 1);
    const sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');

    // Traction model: ice kills both grip (damping) and push-off (acceleration),
    // so momentum carries you across it; airborne you can barely steer.
    const slip = this.onGround ? this.world.slipAt(this.camera.position.x, this.camera.position.z) : 0;
    const grip = 1 - 0.88 * slip;
    const accel =
      moveSpeed * (sprint ? sprintMultiplier : 1) * (this.onGround ? 1 - 0.55 * slip : airControl);

    this.velocity.x -= this.velocity.x * damping * grip * dt;
    this.velocity.z -= this.velocity.z * damping * grip * dt;
    this.velocity.z -= forward * accel * dt;
    this.velocity.x -= right * accel * dt;

    this.controls.moveRight(-this.velocity.x * dt);
    this.controls.moveForward(-this.velocity.z * dt);

    // Clamp inside the arena walls.
    const limit = this.world.bound - radius;
    this.camera.position.x = THREE.MathUtils.clamp(this.camera.position.x, -limit, limit);
    this.camera.position.z = THREE.MathUtils.clamp(this.camera.position.z, -limit, limit);

    // Stop at the pond's bank instead of striding across the water. (A frozen
    // pond passes null here and is simply walkable ice.)
    const pond = this.world.pond;
    if (pond) {
      const dx = this.camera.position.x - pond.x;
      const dz = this.camera.position.z - pond.z;
      const d = Math.hypot(dx, dz);
      const rr = pond.r + radius;
      if (d < rr) {
        const inv = 1 / (d || 1);
        this.camera.position.x = pond.x + dx * inv * rr;
        this.camera.position.z = pond.z + dz * inv * rr;
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
    let support = this.world.heightAt(this.camera.position.x, this.camera.position.z);
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
      if (!this.onGround) {
        // Landing: the knees give a little, scaled by how hard you came down.
        const impact = Math.max(0, -this.vVel - 5);
        this.dip = Math.min(LAND_DIP_MAX, this.dip + impact * LAND_DIP_SCALE);
      }
      this.footY = support; // landed / walking
      this.vVel = 0;
      this.onGround = true;
    }

    // --- Camera feel: stride bob, landing dip, strafe lean, speed FOV -------
    const hSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    this.speedNorm = Math.min(1, hSpeed / 3.2);
    if (this.onGround && this.speedNorm > 0.04) this.bobPhase += dt * hSpeed * BOB_FREQ;
    const bobY = this.onGround ? Math.abs(Math.sin(this.bobPhase)) * BOB_HEIGHT * this.speedNorm : 0;
    this.dip *= Math.exp(-LAND_RECOVER * dt);
    this.camera.position.y = this.footY + CONFIG.player.eyeHeight + bobY - this.dip;

    const targetLean = -right * STRAFE_LEAN + Math.sin(this.bobPhase) * BOB_ROLL * this.speedNorm;
    this.lean += (targetLean - this.lean) * Math.min(1, LEAN_EASE * dt);
    this.euler.setFromQuaternion(this.camera.quaternion);
    this.euler.z = this.lean;
    this.camera.quaternion.setFromEuler(this.euler);

    const targetFov =
      BASE_FOV + this.speedNorm * RUN_FOV + (sprint && this.speedNorm > 0.3 ? SPRINT_FOV : 0);
    this.fov += (targetFov - this.fov) * Math.min(1, FOV_EASE * dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
