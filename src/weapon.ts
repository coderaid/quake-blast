import * as THREE from 'three';

/**
 * First-person weapon viewmodel + fire feedback. A procedural energy blaster
 * is parented to the camera so it lives in view space, and every visual cue an
 * FPS shot needs is layered on top of the hitscan:
 *
 *  - bob synced to the player's stride phase, plus an idle "breathing" drift
 *  - sway that lags behind mouse-look (derived from camera yaw/pitch velocity)
 *  - recoil kick (slide back + muzzle rise) with exponential recovery
 *  - a muzzle flash sprite + a brief point light that actually lights the scene
 *  - a hitscan tracer streak from the muzzle to the impact point
 *  - an impact spark where the shot lands
 *
 * Purely visual — damage/cooldown stay in Player/Game. All constants below are
 * feel-tuning, not gameplay.
 */

const BASE_POS = new THREE.Vector3(0.34, -0.3, -0.58);
const BASE_YAW = -0.05;
const BOB_X = 0.012;
const BOB_Y = 0.01;
const SWAY_RESPONSE = 10; // how fast the gun catches up to the camera
const SWAY_YAW = 0.02; // lateral lag per rad/s of look yaw
const SWAY_PITCH = 0.014; // vertical lag per rad/s of look pitch
const RECOIL_SLIDE = 0.09; // backward slide at full recoil
const RECOIL_RISE = 0.16; // muzzle rise at full recoil (radians)
const RECOIL_RECOVER = 12;
const FLASH_TIME = 0.05;
const TRACER_TIME = 0.07;
const IMPACT_TIME = 0.14;
const TRACER_POOL = 4;
const IMPACT_POOL = 4;

export class WeaponView {
  private group = new THREE.Group();
  private muzzle = new THREE.Object3D();
  private flash: THREE.Mesh;
  private flashMat: THREE.MeshBasicMaterial;
  private flashLight: THREE.PointLight;
  private flashT = 0;

  private tracers: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; t: number }[] = [];
  private tracerIdx = 0;
  private impacts: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; t: number }[] = [];
  private impactIdx = 0;

  private recoil = 0;
  private swayX = 0;
  private swayY = 0;
  private prevYaw = 0;
  private prevPitch = 0;
  private euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();
  private idleT = 0;

  constructor(private camera: THREE.PerspectiveCamera, scene: THREE.Scene) {
    this.buildBlaster();
    this.group.position.copy(BASE_POS);
    this.group.rotation.y = BASE_YAW;
    this.group.scale.setScalar(0.85); // keep the viewmodel from crowding the screen
    camera.add(this.group);

    // Muzzle flash: an additive star sprite at the barrel tip + a light pulse.
    this.flashMat = new THREE.MeshBasicMaterial({
      map: makeFlashTexture(),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), this.flashMat);
    this.flash.visible = false;
    this.muzzle.add(this.flash);
    this.flashLight = new THREE.PointLight(0xaef0ff, 0, 8, 2);
    this.muzzle.add(this.flashLight);

    // World-space effect pools (tracers/impacts live in the scene, not the camera).
    const tracerGeo = new THREE.BoxGeometry(0.02, 0.02, 1);
    for (let i = 0; i < TRACER_POOL; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0x9fe8ff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(tracerGeo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.tracers.push({ mesh, mat, t: 0 });
    }
    const impactGeo = new THREE.SphereGeometry(0.06, 8, 8);
    for (let i = 0; i < IMPACT_POOL; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffc46a,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(impactGeo, mat);
      mesh.visible = false;
      scene.add(mesh);
      this.impacts.push({ mesh, mat, t: 0 });
    }
  }

  /** Assemble the blaster from primitives: receiver, barrel, grip, glowing cell. */
  private buildBlaster(): void {
    // Low metalness on purpose: there is no environment map, and metal without
    // reflections renders as a black silhouette. This reads as gunmetal polymer.
    const body = new THREE.MeshStandardMaterial({ color: 0x6a7280, metalness: 0.3, roughness: 0.42 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x454b55, metalness: 0.25, roughness: 0.55 });
    const glow = new THREE.MeshStandardMaterial({
      color: 0x113344,
      emissive: 0x33ddff,
      emissiveIntensity: 2.2,
      roughness: 0.4,
    });

    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.34), body);
    receiver.position.set(0, 0, -0.05);
    this.group.add(receiver);

    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.34, 10), dark);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.045, -0.3);
    this.group.add(barrel);

    const shroud = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.16), body);
    shroud.position.set(0, 0.04, -0.2);
    this.group.add(shroud);

    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.15, 0.09), dark);
    grip.position.set(0, -0.11, 0.07);
    grip.rotation.x = 0.35;
    this.group.add(grip);

    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.03, 0.06), dark);
    sight.position.set(0, 0.075, -0.02);
    this.group.add(sight);

    // Energy cell — the emissive strip bloom picks up.
    const cell = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.035, 0.14), glow);
    cell.position.set(0.052, 0.005, -0.03);
    this.group.add(cell);

    this.muzzle.position.set(0, 0.045, -0.49);
    this.group.add(this.muzzle);
  }

  /**
   * Per-frame feel: stride bob (synced to the player's phase), look-lag sway,
   * recoil recovery, and effect fading. Call every frame, in every phase.
   */
  update(dt: number, speedNorm: number, bobPhase: number, active: boolean): void {
    this.idleT += dt;

    // Look velocity → the gun trails a beat behind the camera.
    this.euler.setFromQuaternion(this.camera.quaternion);
    let dYaw = this.euler.y - this.prevYaw;
    if (dYaw > Math.PI) dYaw -= Math.PI * 2;
    else if (dYaw < -Math.PI) dYaw += Math.PI * 2;
    const dPitch = this.euler.x - this.prevPitch;
    this.prevYaw = this.euler.y;
    this.prevPitch = this.euler.x;
    const yawVel = THREE.MathUtils.clamp(dt > 0 ? dYaw / dt : 0, -4, 4);
    const pitchVel = THREE.MathUtils.clamp(dt > 0 ? dPitch / dt : 0, -4, 4);
    const ease = Math.min(1, SWAY_RESPONSE * dt);
    this.swayX += (yawVel * SWAY_YAW - this.swayX) * ease;
    this.swayY += (-pitchVel * SWAY_PITCH - this.swayY) * ease;

    this.recoil *= Math.exp(-RECOIL_RECOVER * dt);

    const bob = active ? speedNorm : 0;
    this.group.position.set(
      BASE_POS.x + Math.sin(bobPhase) * BOB_X * bob + this.swayX,
      BASE_POS.y -
        Math.abs(Math.cos(bobPhase)) * BOB_Y * bob +
        Math.sin(this.idleT * 1.7) * 0.0025 +
        this.swayY,
      BASE_POS.z + this.recoil * RECOIL_SLIDE
    );
    this.group.rotation.set(this.recoil * RECOIL_RISE, BASE_YAW + this.swayX * 0.6, this.swayX * 0.4);

    // Muzzle flash fade.
    if (this.flashT > 0) {
      this.flashT -= dt;
      const k = Math.max(0, this.flashT / FLASH_TIME);
      this.flashMat.opacity = k;
      this.flashLight.intensity = 26 * k;
      this.flash.visible = this.flashT > 0;
      if (this.flashT <= 0) this.flashLight.intensity = 0;
    }

    for (const tr of this.tracers) {
      if (tr.t <= 0) continue;
      tr.t -= dt;
      tr.mat.opacity = Math.max(0, tr.t / TRACER_TIME) * 0.9;
      if (tr.t <= 0) tr.mesh.visible = false;
    }
    for (const im of this.impacts) {
      if (im.t <= 0) continue;
      im.t -= dt;
      const k = Math.max(0, im.t / IMPACT_TIME);
      im.mat.opacity = k * 0.9;
      im.mesh.scale.setScalar(1 + (1 - k) * 2.4);
      if (im.t <= 0) im.mesh.visible = false;
    }
  }

  /**
   * Fire feedback for a shot that just broke: recoil + flash, a tracer from
   * the muzzle to `end`, and an impact spark there when something was hit.
   */
  fireEffects(end: THREE.Vector3, impact: boolean): void {
    this.recoil = Math.min(1, this.recoil + 0.75);
    this.flashT = FLASH_TIME;
    this.flash.visible = true;
    this.flash.rotation.z = Math.random() * Math.PI * 2;
    this.flashMat.opacity = 1;
    this.flashLight.intensity = 26;

    const from = this.muzzle.getWorldPosition(this.tmpA);
    const tr = this.tracers[this.tracerIdx];
    this.tracerIdx = (this.tracerIdx + 1) % TRACER_POOL;
    const mid = this.tmpB.copy(from).add(end).multiplyScalar(0.5);
    tr.mesh.position.copy(mid);
    tr.mesh.lookAt(end);
    tr.mesh.scale.set(1, 1, Math.max(0.001, from.distanceTo(end)));
    tr.mesh.visible = true;
    tr.t = TRACER_TIME;
    tr.mat.opacity = 0.9;

    if (impact) {
      const im = this.impacts[this.impactIdx];
      this.impactIdx = (this.impactIdx + 1) % IMPACT_POOL;
      im.mesh.position.copy(end);
      im.mesh.scale.setScalar(1);
      im.mesh.visible = true;
      im.t = IMPACT_TIME;
      im.mat.opacity = 0.9;
    }
  }
}

/** A soft radial burst with four spikes — the classic muzzle-flash star. */
function makeFlashTexture(): THREE.CanvasTexture {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, s, s);
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.3, 'rgba(190,240,255,0.8)');
  g.addColorStop(1, 'rgba(120,200,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  ctx.strokeStyle = 'rgba(220,250,255,0.9)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI;
    ctx.beginPath();
    ctx.moveTo(s / 2 - Math.cos(a) * (s / 2), s / 2 - Math.sin(a) * (s / 2));
    ctx.lineTo(s / 2 + Math.cos(a) * (s / 2), s / 2 + Math.sin(a) * (s / 2));
    ctx.stroke();
  }
  return new THREE.CanvasTexture(c);
}
