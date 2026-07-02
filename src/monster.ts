import * as THREE from 'three';
import { CONFIG } from './config';
import { furTexture } from './textures';

/**
 * A "quake monster": a procedurally-built white vampire rabbit that hops toward
 * a target (a base, or the player if no bases remain) and deals contact damage.
 * Monsters do NOT respawn — the assault is a finite wave to be cleared.
 *
 * The model is a THREE.Group of primitive meshes (no external assets). The root
 * group carries userData.monster = this so the shooting raycast (recursive, so
 * it hits child meshes) can walk up to the owning Monster.
 */

// Palette + hop tuning (visual only; gameplay numbers live in CONFIG).
const FUR = 0xf2f2f2; // off-white fur
const INNER_EAR = 0x9b30ff; // purple ear lining
const EYE = 0xcc1133; // vampire red
const NOSE = 0xff7bbf; // pink nose
const BASE_Y = 0.7; // body-center height above the floor when grounded
const HOP_HEIGHT = 0.55;
const HOP_RATE = 7; // hop cycles speed (radians/sec)

export class Monster {
  readonly mesh: THREE.Group;
  readonly radius = CONFIG.monster.radius;
  readonly damagePerSecond = CONFIG.monster.damagePerSecond;
  health: number = CONFIG.monster.maxHealth;
  alive = true;

  private hopPhase = Math.random() * Math.PI * 2; // desync hops between monsters
  private ears: THREE.Object3D[] = [];
  private groundHeight: (x: number, z: number) => number;

  constructor(
    scene: THREE.Scene,
    spawn: THREE.Vector3,
    groundHeight: (x: number, z: number) => number = () => 0
  ) {
    this.groundHeight = groundHeight;
    this.mesh = this.buildRabbit();
    this.mesh.position.set(spawn.x, groundHeight(spawn.x, spawn.z) + BASE_Y, spawn.z);
    this.mesh.userData.monster = this;
    scene.add(this.mesh);
  }

  /** Assemble the rabbit from primitives. Head faces local +z (travel dir). */
  private buildRabbit(): THREE.Group {
    const g = new THREE.Group();
    const fur = new THREE.MeshStandardMaterial({ color: FUR, map: furTexture(), roughness: 0.85 });

    const body = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 12), fur);
    body.scale.set(1, 0.9, 1.3); // egg-shaped, longer front-to-back
    body.position.z = -0.1;
    body.castShadow = true;
    g.add(body);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.38, 16, 12), fur);
    head.position.set(0, 0.35, 0.55);
    head.castShadow = true;
    g.add(head);

    const snout = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), fur);
    snout.scale.set(1, 0.8, 1.1);
    snout.position.set(0, 0.22, 0.85);
    g.add(snout);

    const nose = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 8, 8),
      new THREE.MeshStandardMaterial({ color: NOSE, roughness: 0.6 })
    );
    nose.position.set(0, 0.26, 1.02);
    g.add(nose);

    const eyeMat = new THREE.MeshStandardMaterial({
      color: EYE,
      emissive: 0x440008,
      roughness: 0.3,
    });
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 10), eyeMat);
      eye.position.set(0.16 * sx, 0.45, 0.82);
      g.add(eye);
    }

    // Vampire fangs: two white cones pointing down from the mouth.
    const fangMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 });
    for (const sx of [-1, 1]) {
      const fang = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.17, 8), fangMat);
      fang.position.set(0.07 * sx, 0.06, 0.95);
      fang.rotation.x = Math.PI; // apex points down
      g.add(fang);
    }

    // Tall ears: white outer shell + raised purple inner lining.
    const innerMat = new THREE.MeshStandardMaterial({
      color: INNER_EAR,
      roughness: 0.6,
      emissive: 0x2a0a40,
    });
    for (const sx of [-1, 1]) {
      const ear = new THREE.Group();
      const outer = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.5, 4, 8), fur);
      outer.castShadow = true;
      ear.add(outer);
      const inner = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.42, 4, 8), innerMat);
      inner.position.z = 0.06; // sit the purple on the front face
      ear.add(inner);
      ear.position.set(0.18 * sx, 0.75, 0.45);
      ear.rotation.set(-0.25, 0, 0.18 * sx); // tilt back + splay outward
      g.add(ear);
      this.ears.push(ear);
    }

    // Big hind feet + cotton tail.
    for (const sx of [-1, 1]) {
      const foot = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), fur);
      foot.scale.set(0.7, 0.5, 1.5);
      foot.position.set(0.28 * sx, -0.42, 0.05);
      foot.castShadow = true;
      g.add(foot);
    }
    const tail = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), fur);
    tail.position.set(0, 0.05, -0.72);
    g.add(tail);

    return g;
  }

  /** Returns true if this hit killed the monster. */
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
   * Hop toward `target` on the XZ plane. Returns true if within contact range
   * of a target of the given radius (so the caller can apply damage).
   */
  update(dt: number, target: THREE.Vector3, targetRadius: number): boolean {
    if (!this.alive) return false;

    const dx = target.x - this.mesh.position.x;
    const dz = target.z - this.mesh.position.z;
    const dist = Math.hypot(dx, dz);
    const contact = CONFIG.monster.radius + targetRadius;

    if (dist > contact) {
      const inv = 1 / (dist || 1);
      this.mesh.position.x += dx * inv * CONFIG.monster.speed * dt;
      this.mesh.position.z += dz * inv * CONFIG.monster.speed * dt;
      this.mesh.rotation.y = Math.atan2(dx, dz); // head leads the hop

      // Hop: vertical bounce + a little squash/stretch, ears flick back at apex.
      this.hopPhase += dt * HOP_RATE;
      const hop = Math.abs(Math.sin(this.hopPhase));
      const groundY = this.groundHeight(this.mesh.position.x, this.mesh.position.z);
      this.mesh.position.y = groundY + BASE_Y + hop * HOP_HEIGHT;
      this.mesh.scale.y = 1 + Math.sin(this.hopPhase) * 0.06;
      for (const ear of this.ears) ear.rotation.x = -0.25 - hop * 0.25;
      return false;
    }

    // Grounded and biting: settle the hop.
    this.mesh.position.y = this.groundHeight(this.mesh.position.x, this.mesh.position.z) + BASE_Y;
    this.mesh.scale.y = 1;
    return true;
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
