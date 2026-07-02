import * as THREE from 'three';

/**
 * Fire feedback — no visible weapon (it's a kids' game): each shot shows a
 * brief energy-streak tracer from just under the camera to wherever the shot
 * landed, plus an impact spark when something was hit. Purely visual —
 * damage/cooldown stay in Player/Game.
 */

const TRACER_TIME = 0.07;
const IMPACT_TIME = 0.14;
const TRACER_POOL = 4;
const IMPACT_POOL = 4;
// The tracer starts slightly below/right of the eye so it reads as "from you"
// without a gun model drawn on screen.
const ORIGIN_OFFSET = new THREE.Vector3(0.12, -0.18, -0.3);

export class WeaponView {
  private tracers: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; t: number }[] = [];
  private tracerIdx = 0;
  private impacts: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; t: number }[] = [];
  private impactIdx = 0;
  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();

  constructor(private camera: THREE.PerspectiveCamera, scene: THREE.Scene) {
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

  /** Fade the active effects. Call every frame, in every phase. */
  update(dt: number): void {
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
   * Fire feedback for a shot that just broke: a tracer streak out to `end`,
   * and an impact spark there when something was hit.
   */
  fireEffects(end: THREE.Vector3, impact: boolean): void {
    const from = this.tmpA.copy(ORIGIN_OFFSET).applyQuaternion(this.camera.quaternion).add(this.camera.position);
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
