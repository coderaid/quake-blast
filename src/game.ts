import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { CONFIG } from './config';
import { LEVELS, disposeLevel, type LevelHandle } from './level';
import { Player } from './player';
import { WeaponView } from './weapon';
import { Monster } from './monster';
import { Eagle } from './eagle';
import { Building } from './building';
import { Hud } from './hud';
import { TouchControls, isTouchDevice } from './touch';

type Phase = 'build' | 'assault' | 'won' | 'lost';

/**
 * Top-level orchestrator and phase state machine.
 *
 *   build  → place bases against a countdown
 *   assault→ a finite wave of monsters storms in and attacks the nearest base
 *   won    → wave cleared with >=1 base standing → advance to the next level
 *   lost   → all bases destroyed, or the player died → retry the same level
 *
 * Owns the renderer, scene, the single rAF loop, and all game state. Systems
 * (Player/Monster/Building) expose update()/damage() and report back up here;
 * Game is the only place they are coordinated.
 *
 * Levels come from the LEVELS registry (level.ts). Each build populates the
 * scene and hands back a LevelHandle; switching levels tears the old one down
 * (disposeLevel) and re-injects the new world data into the player. The start
 * overlay's level buttons and `?level=arctic` in the URL both jump straight to
 * a specific level.
 */
export class Game {
  private renderer: THREE.WebGLRenderer;
  private composer!: EffectComposer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private clock = new THREE.Clock();

  private player: Player;
  private weapon: WeaponView;
  private hud: Hud;
  private touch: TouchControls | null = null;
  private isTouch = isTouchDevice();

  private levelIndex = 0;
  private level!: LevelHandle;
  private bound = CONFIG.arena.halfSize - 0.5;
  private heightAt: (x: number, z: number) => number = () => 0;

  private phase: Phase = 'build';
  private buildTimer = CONFIG.build.duration;
  private buildBudget = CONFIG.build.budget;

  private buildings: Building[] = [];
  private monsters: Monster[] = [];
  private eagles: Eagle[] = [];
  private kills = 0;
  private spawnedCount = 0;
  private spawnTimer = 0;
  private eaglesSpawned = 0;
  private eagleSpawnTimer = 0;

  // Tree-top sit points for eagles, refreshed by each level's perches.
  private perches: THREE.Vector3[] = [];

  private ghost: THREE.Mesh;
  private ghostMat: THREE.MeshStandardMaterial;
  private ghostPoint = new THREE.Vector3();
  private ghostValid = false;
  private ghostBaseY = 0;
  private stacks = new Map<string, number>(); // grid cell -> brick count (for stacking)
  private pond: { x: number; z: number; r: number } = { x: 0, z: 0, r: 0 };
  private tmpDir = new THREE.Vector3();

  constructor(root: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    // Tablets get a lower pixel-ratio cap — full retina + post-processing chugs on iPad.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.isTouch ? 1.5 : 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; // filmic, less "flat WebGL"
    this.renderer.toneMappingExposure = 1.1;
    root.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      500
    );

    this.player = new Player(
      this.camera,
      this.renderer.domElement,
      // Live brick AABBs so the player can collide with and climb the stacks.
      () =>
        this.buildings
          .filter((b) => b.alive)
          .map((b) => ({
            x: b.position.x,
            z: b.position.z,
            half: CONFIG.building.size / 2,
            top: b.position.y + CONFIG.building.height / 2,
            bottom: b.position.y - CONFIG.building.height / 2,
          }))
    );
    this.scene.add(this.player.controls.object);
    this.weapon = new WeaponView(this.camera, this.scene);

    this.loadLevel(initialLevelIndex());

    // Translucent placement preview, shown only during the build phase.
    const { size, height } = CONFIG.building;
    this.ghostMat = new THREE.MeshStandardMaterial({
      color: 0x44ff88,
      transparent: true,
      opacity: 0.4,
    });
    this.ghost = new THREE.Mesh(new THREE.BoxGeometry(size, height, size), this.ghostMat);
    this.ghost.visible = false;
    this.scene.add(this.ghost);

    this.hud = new Hud(root, this.isTouch, LEVELS.map((l) => l.name));
    this.hud.showStart(this.levelIndex);
    if (this.isTouch) {
      this.touch = new TouchControls(root, {
        onLook: (dx, dy) => this.player.applyLook(dx, dy),
        onFire: () => this.onFirePressed(),
      });
      this.player.touch = this.touch;
    }
    this.wireInput();
    this.setupComposer();

    window.addEventListener('resize', () => this.onResize());
  }

  /** Post-processing: SSAO (grounding) + subtle bloom, tone-mapped by OutputPass. */
  private setupComposer(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    // SSAO is too heavy for tablet GPUs — skip it there, keep bloom + tone mapping.
    if (!this.isTouch) {
      const ssao = new SSAOPass(this.scene, this.camera, w, h);
      ssao.kernelRadius = 8;
      ssao.minDistance = 0.004;
      ssao.maxDistance = 0.12;
      this.composer.addPass(ssao);
    }

    const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.3, 0.6, 0.9); // high threshold: don't bloom the sky
    this.composer.addPass(bloom);

    this.composer.addPass(new OutputPass()); // applies tone mapping + sRGB
  }

  /** Tear down the current level (if any), build the requested one, rewire systems. */
  private loadLevel(index: number): void {
    if (this.level) disposeLevel(this.scene, this.level);
    this.levelIndex = index;
    this.level = LEVELS[index].build(this.scene);
    this.bound = this.level.bound;
    this.heightAt = this.level.heightAt;
    this.pond = this.level.pond;
    this.setPerches(this.level.perches);
    this.player.setWorld({
      bound: this.bound,
      heightAt: this.heightAt,
      pond: this.level.pondBlocksMovement ? this.level.pond : null,
      slipAt: this.level.slipAt,
    });
    this.player.resetPose();
  }

  private wireInput(): void {
    this.hud.onPlayClick(() => {
      if (this.phase === 'won') this.restart((this.levelIndex + 1) % LEVELS.length);
      else if (this.phase === 'lost') this.restart();
      this.beginPlay();
    });
    // A level button both selects the level and drops straight into it.
    this.hud.onLevelSelect((index) => {
      this.restart(index);
      this.beginPlay();
    });

    this.player.controls.addEventListener('lock', () => this.hud.setLocked(true));
    this.player.controls.addEventListener('unlock', () => this.hud.setLocked(false));

    // Left click is context-sensitive: place a base during build, shoot during assault.
    // Gated on pointer lock, so synthetic mouse events from touch taps never double-fire.
    this.renderer.domElement.ownerDocument.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || !this.player.isLocked) return;
      if (this.phase === 'build') this.tryPlaceBuilding();
      else if (this.phase === 'assault') this.shoot();
    });
  }

  private beginPlay(): void {
    if (this.touch) {
      // No pointer lock on touch — a "playing" flag stands in for it.
      this.player.touchPlaying = true;
      this.hud.setLocked(true);
    } else {
      this.player.controls.lock();
    }
  }

  /** FIRE button (touch): same context-sensitivity as left click. */
  private onFirePressed(): void {
    if (!this.player.active) return;
    if (this.phase === 'build') this.tryPlaceBuilding();
    else if (this.phase === 'assault') this.shoot();
  }

  // --- Build phase ---------------------------------------------------------

  private cellKey(gx: number, gz: number): string {
    return `${gx},${gz}`;
  }

  private updateGhost(): void {
    const onGround = this.player.aimGroundPoint(this.ghostPoint);
    const S = CONFIG.building.size;
    let valid = onGround && this.buildBudget > 0;

    if (onGround) {
      // Snap to the brick grid and stack on whatever is already in that cell.
      const limit = this.bound - S / 2;
      const cx = THREE.MathUtils.clamp(Math.round(this.ghostPoint.x / S) * S, -limit, limit);
      const cz = THREE.MathUtils.clamp(Math.round(this.ghostPoint.z / S) * S, -limit, limit);
      const count = this.stacks.get(this.cellKey(cx, cz)) ?? 0;
      const terrain = this.heightAt(cx, cz);
      this.ghostBaseY = terrain + count * CONFIG.building.height;
      this.ghostPoint.set(cx, this.ghostBaseY, cz);

      if (terrain > 0.5) valid = false; // not on the rocky hill slope
      if (Math.hypot(cx - this.pond.x, cz - this.pond.z) < this.pond.r + S / 2) valid = false;
      if (count >= CONFIG.build.maxStack) valid = false;
    }

    this.ghost.visible = onGround;
    this.ghost.position.set(this.ghostPoint.x, this.ghostBaseY + CONFIG.building.height / 2, this.ghostPoint.z);
    this.ghostMat.color.set(valid ? 0x44ff88 : 0xff4444);
    this.ghostValid = valid;
  }

  private tryPlaceBuilding(): void {
    if (!this.ghostValid || this.buildBudget <= 0) return;
    const key = this.cellKey(this.ghostPoint.x, this.ghostPoint.z);
    this.buildings.push(new Building(this.scene, this.ghostPoint)); // ghostPoint.y is the base
    this.stacks.set(key, (this.stacks.get(key) ?? 0) + 1);
    this.buildBudget--;
  }

  /**
   * Hand the eagles their roosts. Expects tree-top sit points (a Vector3 per
   * perchable tree, y = where an eagle should rest). Called with each level's
   * perches on load; safe to call with [] to clear.
   */
  setPerches(points: THREE.Vector3[]): void {
    this.perches = points;
    for (const e of this.eagles) e.perches = this.perches;
  }

  private startAssault(): void {
    this.phase = 'assault';
    this.ghost.visible = false;
    this.spawnedCount = 0;
    this.spawnTimer = 0;
    this.eaglesSpawned = 0;
    this.eagleSpawnTimer = 0;
    this.kills = 0;
  }

  private spawnPoint(y = 1.3): THREE.Vector3 {
    const b = this.bound - 2;
    const t = (Math.random() * 2 - 1) * b;
    switch (Math.floor(Math.random() * 4)) {
      case 0:
        return new THREE.Vector3(t, y, -b);
      case 1:
        return new THREE.Vector3(t, y, b);
      case 2:
        return new THREE.Vector3(-b, y, t);
      default:
        return new THREE.Vector3(b, y, t);
    }
  }

  // --- Assault phase -------------------------------------------------------

  private shoot(): void {
    // Both ground monsters and eagles are shootable; both tag their root group
    // with userData.monster, so one raycast list and one resolve path covers them.
    const targets = [...this.monsters, ...this.eagles].filter((m) => m.alive).map((m) => m.mesh);
    const { fired, hit } = this.player.tryShoot(targets);
    if (!fired) return;

    // Fire feedback even on a miss: tracer to where the shot ends downrange.
    const end = hit
      ? hit.point
      : this.camera
          .getWorldDirection(this.tmpDir)
          .multiplyScalar(CONFIG.weapon.range)
          .add(this.camera.position);
    this.weapon.fireEffects(end, hit !== null);
    if (!hit) return;

    let obj: THREE.Object3D | null = hit.object;
    while (obj && !obj.userData.monster) obj = obj.parent;
    const enemy = obj?.userData.monster as { damage(n: number): boolean } | undefined;
    if (enemy && enemy.damage(CONFIG.weapon.damage)) {
      this.kills++;
    }
  }

  private nearestBuilding(pos: THREE.Vector3): Building | null {
    let best: Building | null = null;
    let bestDist = Infinity;
    for (const b of this.buildings) {
      if (!b.alive) continue;
      const d = b.position.distanceToSquared(pos);
      if (d < bestDist) {
        bestDist = d;
        best = b;
      }
    }
    return best;
  }

  private updateAssault(dt: number): void {
    // Holding FIRE on touch auto-fires; tryShoot's cooldown sets the rate.
    if (this.touch?.fireHeld) this.shoot();

    // Staggered spawning so the wave pours in rather than popping in at once.
    if (this.spawnedCount < CONFIG.monster.count) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawnTimer = CONFIG.monster.spawnInterval;
        this.monsters.push(new Monster(this.scene, this.spawnPoint(), this.heightAt));
        this.spawnedCount++;
      }
    }
    // Eagles are their own pool, entering at cruise altitude on their own cadence.
    if (this.eaglesSpawned < CONFIG.eagle.count) {
      this.eagleSpawnTimer -= dt;
      if (this.eagleSpawnTimer <= 0) {
        this.eagleSpawnTimer = CONFIG.eagle.spawnInterval;
        const eagle = new Eagle(this.scene, this.spawnPoint(CONFIG.eagle.cruiseHeight), this.heightAt);
        eagle.perches = this.perches;
        this.eagles.push(eagle);
        this.eaglesSpawned++;
      }
    }

    let playerHit = false;

    // Rabbits and eagles share the same drive: aim at the nearest base, else the
    // player; each entity reports its own contact and carries its own dps/radius.
    for (const m of [...this.monsters, ...this.eagles]) {
      if (!m.alive) continue;

      const dps = m.damagePerSecond;
      const target = this.nearestBuilding(m.mesh.position);
      if (target) {
        if (m.update(dt, target.position, CONFIG.building.size / 2)) {
          target.damage(dps * dt);
        }
      } else {
        // No bases left: attackers come for the player.
        if (m.update(dt, this.player.position, CONFIG.player.radius)) {
          this.player.damage(dps * dt);
          playerHit = true;
        }
      }

      // Brushing past the player always stings, even while it targets a base.
      const near = m.radius + CONFIG.player.radius;
      if (m.mesh.position.distanceToSquared(this.player.position) < near * near) {
        this.player.damage(dps * 0.5 * dt);
        playerHit = true;
      }
    }

    if (playerHit) this.hud.flashDamage();

    // Win / lose checks.
    const basesAlive = this.buildings.filter((b) => b.alive).length;
    const waveCleared =
      this.spawnedCount === CONFIG.monster.count &&
      this.eaglesSpawned === CONFIG.eagle.count &&
      this.monsters.every((m) => !m.alive) &&
      this.eagles.every((e) => !e.alive);

    if (this.player.health <= 0) {
      this.endGame('lost', 'You were overrun by the horde.');
    } else if (this.buildings.length > 0 && basesAlive === 0) {
      this.endGame('lost', 'Every base was razed.');
    } else if (waveCleared) {
      if (basesAlive > 0) this.endGame('won');
      else this.endGame('lost', 'The wave is gone, but so are all your bases.');
    }
  }

  // --- Lifecycle -----------------------------------------------------------

  private endGame(result: 'won' | 'lost', reason?: string): void {
    this.phase = result;
    this.player.touchPlaying = false;
    this.player.controls.unlock();
    if (result === 'won') {
      this.hud.showVictory(
        this.buildings.filter((b) => b.alive).length,
        this.buildings.length,
        LEVELS[this.levelIndex + 1]?.name ?? null
      );
    } else {
      this.hud.showDefeat(reason ?? 'Defeated.');
    }
  }

  /** Reset for a fresh round — optionally into a different level. */
  private restart(levelIndex = this.levelIndex): void {
    for (const m of this.monsters) m.dispose(this.scene);
    for (const e of this.eagles) e.dispose(this.scene);
    for (const b of this.buildings) b.dispose(this.scene);
    this.monsters = [];
    this.eagles = [];
    this.buildings = [];
    this.stacks.clear();
    if (levelIndex !== this.levelIndex) this.loadLevel(levelIndex);
    else this.player.resetPose();
    this.phase = 'build';
    this.buildTimer = CONFIG.build.duration;
    this.buildBudget = CONFIG.build.budget;
    this.kills = 0;
    this.spawnedCount = 0;
    this.eaglesSpawned = 0;
    this.player.health = CONFIG.player.maxHealth;
    this.hud.showStart(this.levelIndex);
  }

  private onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer.setSize(window.innerWidth, window.innerHeight);
  }

  private tick = (): void => {
    requestAnimationFrame(this.tick);
    const dt = Math.min(this.clock.getDelta(), 0.05); // clamp to avoid tunneling on lag spikes

    this.level.update(dt); // animate water/wind/snow/aurora every frame, in every phase
    // Weapon feel + fading fire effects run in every phase too.
    this.weapon.update(dt, this.player.speedNorm, this.player.bobPhase, this.player.active);

    if (this.phase === 'build') {
      this.player.update(dt);
      this.updateGhost();
      if (this.player.active) {
        this.buildTimer -= dt;
        if (this.buildTimer <= 0) this.startAssault();
      }
    } else if (this.phase === 'assault') {
      this.player.update(dt);
      this.updateAssault(dt);
    }

    this.hud.update({
      phase: this.phase,
      timeLeft: this.buildTimer,
      budget: this.buildBudget,
      health: this.player.health,
      basesAlive: this.buildings.filter((b) => b.alive).length,
      basesTotal: this.buildings.length,
      monstersLeft: CONFIG.monster.count + CONFIG.eagle.count - this.kills,
      levelName: LEVELS[this.levelIndex].name,
    });

    this.composer.render();
  };

  start(): void {
    this.tick();
  }
}

/** `?level=arctic` (or `?level=1`) jumps straight to a level — handy for testing. */
function initialLevelIndex(): number {
  const param = new URLSearchParams(window.location.search).get('level');
  if (!param) return 0;
  const byName = LEVELS.findIndex((l) => l.name.toLowerCase() === param.toLowerCase());
  if (byName >= 0) return byName;
  const n = Number(param);
  return Number.isInteger(n) && n >= 0 && n < LEVELS.length ? n : 0;
}
