import * as THREE from 'three';
import { Water } from 'three/examples/jsm/objects/Water.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CONFIG } from './config';
import { barkTexture, leafTexture, rockTexture, rockTextureTiled } from './textures';

/**
 * Builds the Level 1 jungle: a flat central clearing (the playable build area),
 * a thick multi-ring treeline receding into haze, and a steep climbable rocky
 * hill on the north edge with a waterfall that hugs the rock face and spills
 * into a pond — all inside the playable bound so the player can reach and climb.
 *
 * Vegetation is rendered with InstancedMesh (one draw call per part type), so
 * the jungle can be very dense (~900 trees + understory ≈ thousands of meshes)
 * at a handful of draw calls. Per-instance colors give foliage variety and a
 * distance-fade tint so far trees melt into the fog.
 *
 * Returns:
 *  - `bound`    : the clearing half-extent movement clamps against.
 *  - `update`   : per-frame hook the game loop calls to animate the water.
 *  - `perches`  : tree-top points eagles roost on.
 *  - `heightAt` : terrain elevation at (x,z); the clearing is 0, the hill rises.
 *  - `pond`     : the pond's footprint so the player stops at its bank.
 */
export function buildArena(scene: THREE.Scene): {
  bound: number;
  update: (dt: number) => void;
  perches: THREE.Vector3[];
  heightAt: (x: number, z: number) => number;
  pond: { x: number; z: number; r: number };
} {
  const { halfSize } = CONFIG.arena;
  const bound = halfSize - 0.5;

  // --- Terrain height field ----------------------------------------------
  const HILL_CX = 0;
  const HILL_CZ = -30;
  const HILL_R = 13;
  const HILL_H = 15;
  const PLATEAU_H = 12.5; // flat summit cap → flat pool at the top of the falls
  const heightAt = (x: number, z: number): number => {
    const d = Math.hypot(x - HILL_CX, z - HILL_CZ);
    if (d >= HILL_R) return 0;
    return Math.min(PLATEAU_H, HILL_H * 0.5 * (1 + Math.cos((Math.PI * d) / HILL_R)));
  };

  const pond = { x: 0, z: -7, r: 5 };

  // --- Ground -------------------------------------------------------------
  const groundTex = makeNoiseTexture(['#3a5f29', '#46763a', '#314f24', '#5a4a2c'], 256);
  groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping;
  groundTex.repeat.set(26, 26);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(halfSize * 8, halfSize * 8),
    new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  ground.receiveShadow = true;
  scene.add(ground);

  const dirtTex = makeNoiseTexture(['#6b5634', '#7a623c', '#5e4c2e', '#534228'], 128);
  dirtTex.wrapS = dirtTex.wrapT = THREE.RepeatWrapping;
  dirtTex.repeat.set(6, 6);
  const clearing = new THREE.Mesh(
    new THREE.CircleGeometry(18, 48),
    new THREE.MeshStandardMaterial({ map: dirtTex, roughness: 1 })
  );
  clearing.rotation.x = -Math.PI / 2;
  clearing.position.set(0, 0.0, 10);
  clearing.receiveShadow = true;
  scene.add(clearing);

  // --- Lighting -----------------------------------------------------------
  scene.add(new THREE.HemisphereLight(0xbfe6ff, 0x2c4a1e, 0.9));
  const sun = new THREE.DirectionalLight(0xfff2d0, 1.3);
  sun.position.set(25, 45, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -halfSize;
  sun.shadow.camera.right = halfSize;
  sun.shadow.camera.top = halfSize;
  sun.shadow.camera.bottom = -halfSize;
  sun.shadow.camera.far = 150;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.5;
  scene.add(sun);

  // --- Sky dome (blue at the zenith, pale at the horizon) -----------------
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(halfSize * 7, 24, 16),
    new THREE.MeshBasicMaterial({ map: makeSkyGradient(), side: THREE.BackSide, fog: false, depthWrite: false })
  );
  scene.add(sky);

  // --- Isolated puffy clouds (clusters of white blobs that drift) ---------
  const cloudMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 1,
    flatShading: true,
    emissive: 0x8fa6c0,
    emissiveIntensity: 0.18,
    fog: false,
  });
  const cloudGeo = new THREE.IcosahedronGeometry(1, 1);
  const clouds: THREE.Group[] = [];
  for (let i = 0; i < 11; i++) {
    const cloud = new THREE.Group();
    const puffs = 4 + Math.floor(Math.random() * 4);
    for (let j = 0; j < puffs; j++) {
      const puff = new THREE.Mesh(cloudGeo, cloudMat);
      const s = 3 + Math.random() * 4;
      puff.position.set((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 7);
      puff.scale.set(s, s * 0.6, s);
      cloud.add(puff);
    }
    const a = Math.random() * Math.PI * 2;
    const rad = halfSize * 1.2 + Math.random() * halfSize * 3;
    cloud.position.set(Math.cos(a) * rad, 34 + Math.random() * 18, Math.sin(a) * rad);
    scene.add(cloud);
    clouds.push(cloud);
  }
  const cloudWrap = halfSize * 5;

  const rockMat = new THREE.MeshStandardMaterial({
    color: 0x8a857c,
    map: rockTexture(),
    roughness: 0.95,
    flatShading: true,
  });
  const rockGeo = new THREE.IcosahedronGeometry(1, 0);

  // --- Rocky hill ---------------------------------------------------------
  const seg = 72;
  const hillGeo = new THREE.PlaneGeometry(HILL_R * 2.1, HILL_R * 2.1, seg, seg);
  hillGeo.rotateX(-Math.PI / 2);
  const hp = hillGeo.attributes.position;
  for (let i = 0; i < hp.count; i++) {
    hp.setY(i, heightAt(hp.getX(i) + HILL_CX, hp.getZ(i) + HILL_CZ));
  }
  hillGeo.computeVertexNormals();
  const hill = new THREE.Mesh(
    hillGeo,
    new THREE.MeshStandardMaterial({ color: 0x6e6a63, map: rockTextureTiled(10), roughness: 1, flatShading: true })
  );
  hill.position.set(HILL_CX, 0, HILL_CZ);
  hill.receiveShadow = true;
  hill.castShadow = true;
  scene.add(hill);

  const mossMat = new THREE.MeshStandardMaterial({ color: 0x3c6b2f, roughness: 1, flatShading: true });
  for (let i = 0; i < 30; i++) {
    const a = Math.random() * Math.PI * 2;
    const rr = Math.random() * (HILL_R - 2);
    const bx = HILL_CX + Math.cos(a) * rr;
    const bz = HILL_CZ + Math.sin(a) * rr;
    if (Math.abs(bx) < 4.5 && bz > -29) continue; // keep the waterfall channel clear
    const s = 0.6 + Math.random() * 1.8;
    const rock = new THREE.Mesh(rockGeo, i % 4 === 0 ? mossMat : rockMat);
    rock.position.set(bx, heightAt(bx, bz) + s * 0.3, bz);
    rock.scale.set(s, s * (0.6 + Math.random() * 0.5), s);
    rock.rotation.set(Math.random(), Math.random(), Math.random());
    rock.castShadow = true;
    scene.add(rock);
  }
  // Rounded boulders framing the falls on either side — clear of the water channel.
  for (const sx of [-1, 1]) {
    for (let k = 0; k < 5; k++) {
      const z = -12 - k * 3.2;
      const x = sx * (4.8 + Math.random() * 1.8);
      const s = 1.5 + Math.random() * 1.6;
      const rock = new THREE.Mesh(rockGeo, k % 3 === 0 ? mossMat : rockMat);
      rock.position.set(x, heightAt(x, z) + s * 0.35, z);
      rock.scale.set(s, s * (0.75 + Math.random() * 0.5), s);
      rock.rotation.set(Math.random(), Math.random(), Math.random());
      rock.castShadow = true;
      scene.add(rock);
    }
  }

  // --- Trees & understory (instanced) ------------------------------------
  const trunkGeo = new THREE.CylinderGeometry(0.35, 0.6, 9, 8);
  const palmTrunkGeo = new THREE.CylinderGeometry(0.18, 0.34, 10, 7);
  const canopyGeo = makeLeafCard(); // crossed alpha-cutout leaf planes
  const frondGeo = new THREE.ConeGeometry(0.32, 3, 5);
  const fernGeo = new THREE.ConeGeometry(0.7, 1.4, 5);
  const bushGeo = new THREE.IcosahedronGeometry(0.9, 0);

  const fogColor = new THREE.Color(0xbcdcf2); // matches scene fog / sky horizon (game.ts)
  const maxR = bound * 3.8;
  const greenColors = [0x2f7d32, 0x3f9142, 0x276b2b, 0x4caf50, 0x1f5a23, 0x356d2a, 0x4e7a2a].map(
    (c) => new THREE.Color(c)
  );
  const trunkColor = new THREE.Color(0x5b3a21);
  // Foliage desaturates toward fog with distance so the rings read as depth.
  const tint = (base: THREE.Color, r: number) =>
    base.clone().lerp(fogColor, Math.min(0.6, (r / maxR) * 0.75));

  type Inst = { m: THREE.Matrix4; c: THREE.Color };
  const trunkS: Inst[] = []; // shadow-casting (near)
  const trunkN: Inst[] = []; // no shadow (mid/far)
  const canopyS: Inst[] = [];
  const canopyN: Inst[] = [];
  const palmTrunkI: Inst[] = [];
  const frondI: Inst[] = [];
  const fernI: Inst[] = [];
  const bushI: Inst[] = [];

  const parent = new THREE.Object3D();
  const child = new THREE.Object3D();
  const worldMatrix = (): THREE.Matrix4 => {
    parent.updateMatrix();
    child.updateMatrix();
    return new THREE.Matrix4().multiplyMatrices(parent.matrix, child.matrix);
  };

  const placeTree = (x: number, z: number, s: number, palm: boolean, blobs: number, shadow: boolean): THREE.Vector3 => {
    const y0 = heightAt(x, z);
    const r = Math.hypot(x, z);
    parent.position.set(x, y0, z);
    parent.rotation.set(0, Math.random() * Math.PI * 2, 0);
    parent.scale.set(1, 1, 1);

    if (palm) {
      child.position.set(0, 5 * s, 0);
      child.rotation.set(0, 0, 0);
      child.scale.setScalar(s);
      palmTrunkI.push({ m: worldMatrix(), c: trunkColor.clone().multiplyScalar(0.85 + Math.random() * 0.3) });
      const crown = tint(greenColors[(Math.random() * greenColors.length) | 0], r);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        child.position.set(Math.cos(a) * 1.3 * s, 9.5 * s, Math.sin(a) * 1.3 * s);
        child.rotation.set(Math.PI / 2.2 + (Math.random() - 0.5) * 0.5, -a, 0);
        child.scale.set(s, s * (0.8 + Math.random() * 0.6), s);
        frondI.push({ m: worldMatrix(), c: crown.clone() });
      }
      return new THREE.Vector3(x, y0 + 9.5 * s, z);
    }

    child.position.set(0, 4.5 * s, 0);
    child.rotation.set(0, 0, 0);
    child.scale.setScalar(s);
    (shadow ? trunkS : trunkN).push({
      m: worldMatrix(),
      c: trunkColor.clone().multiplyScalar(0.85 + Math.random() * 0.3),
    });
    for (let i = 0; i < blobs; i++) {
      const cs = s * (0.85 + Math.random() * 0.5);
      child.position.set((Math.random() - 0.5) * 2.4 * s, (7 + Math.random() * 3) * s, (Math.random() - 0.5) * 2.4 * s);
      child.rotation.set(0, Math.random() * Math.PI, 0);
      child.scale.set(cs * 1.3, cs * 0.85, cs * 1.3);
      (shadow ? canopyS : canopyN).push({
        m: worldMatrix(),
        c: tint(greenColors[(Math.random() * greenColors.length) | 0], r),
      });
    }
    return new THREE.Vector3(x, y0 + 8 * s, z);
  };

  const excluded = (x: number, z: number) =>
    heightAt(x, z) > 0.3 ||
    Math.hypot(x - pond.x, z - pond.z) < pond.r + 4 ||
    (z < -2 && Math.abs(x) < 7);

  const scatter = (count: number, rMin: number, rMax: number, shadow: boolean, palmChance: number, blobs: number) => {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const jitter = 1 + (Math.random() - 0.5) * 0.3;
      const r = Math.sqrt(rMin * rMin + Math.random() * (rMax * rMax - rMin * rMin)) * jitter;
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;
      if (excluded(x, z)) continue;
      placeTree(x, z, 1.0 + Math.random() * 1.3, Math.random() < palmChance, blobs, shadow);
    }
  };
  scatter(190, bound * 0.74, bound * 1.5, true, 0.18, 5); // near, lush, shadowed
  scatter(430, bound * 1.25, bound * 2.5, false, 0.22, 3); // mid
  scatter(430, bound * 2.2, bound * 3.8, false, 0.15, 2); // far backdrop

  const perches: THREE.Vector3[] = [];
  const PERCH_TREES = 8;
  for (let i = 0; i < PERCH_TREES; i++) {
    const angle = (i / PERCH_TREES) * Math.PI * 2 + 0.4;
    const r = bound * 0.72;
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    if (excluded(x, z)) continue;
    perches.push(placeTree(x, z, 1.6, false, 6, true));
  }

  // Dense low understory so the floor isn't bare between trunks.
  for (let i = 0; i < 700; i++) {
    const angle = Math.random() * Math.PI * 2;
    const r = Math.sqrt((bound * 0.6) ** 2 + Math.random() * ((bound * 2.4) ** 2 - (bound * 0.6) ** 2));
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    if (excluded(x, z)) continue;
    const y0 = heightAt(x, z);
    const fern = Math.random() < 0.5;
    parent.position.set(x, y0, z);
    parent.rotation.set(0, Math.random() * Math.PI * 2, 0);
    parent.scale.set(1, 1, 1);
    child.rotation.set(0, 0, 0);
    if (fern) {
      child.position.set(0, 0.7, 0);
      child.scale.set(1 + Math.random(), 1 + Math.random() * 0.8, 1 + Math.random());
      fernI.push({ m: worldMatrix(), c: tint(greenColors[(Math.random() * greenColors.length) | 0], r) });
    } else {
      child.position.set(0, 0.4, 0);
      child.scale.set(1 + Math.random(), 0.7 + Math.random() * 0.5, 1 + Math.random());
      bushI.push({ m: worldMatrix(), c: tint(greenColors[(Math.random() * greenColors.length) | 0], r) });
    }
  }

  const buildInstanced = (
    geo: THREE.BufferGeometry,
    items: Inst[],
    castShadow: boolean,
    material: THREE.Material
  ) => {
    if (!items.length) return;
    const mesh = new THREE.InstancedMesh(geo, material, items.length);
    for (let i = 0; i < items.length; i++) {
      mesh.setMatrixAt(i, items[i].m);
      mesh.setColorAt(i, items[i].c);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false; // instances span the whole map; avoid false culling
    scene.add(mesh);
  };

  // Foliage sways in the wind via a shared time uniform injected into the shader.
  const windUniforms = { time: { value: 0 } };
  const windify = (m: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial => {
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = windUniforms.time;
      shader.vertexShader =
        'uniform float uTime;\n' +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          [
            '#include <begin_vertex>',
            'float wPhase = uTime * 1.4 + instanceMatrix[3][0] * 0.25 + instanceMatrix[3][2] * 0.25;',
            'float wWeight = max(position.y, 0.0) * 0.15;',
            'transformed.x += sin(wPhase) * wWeight;',
            'transformed.z += cos(wPhase * 0.9) * wWeight * 0.7;',
          ].join('\n')
        );
    };
    m.customProgramCacheKey = () => 'wind';
    return m;
  };

  const bark = barkTexture();
  const leaf = leafTexture();
  const barkMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: bark, roughness: 0.9, flatShading: true });
  const leafCardMat = windify(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: makeLeafCardTexture(),
      alphaTest: 0.5, // cutout — no transparency sorting
      side: THREE.DoubleSide,
      roughness: 0.9,
    })
  );
  const frondMat = windify(
    new THREE.MeshStandardMaterial({ color: 0xffffff, map: leaf, roughness: 0.9, flatShading: true })
  );
  const fernMat = windify(
    new THREE.MeshStandardMaterial({ color: 0xffffff, map: leaf, roughness: 0.9, flatShading: true })
  );
  const bushMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: leaf, roughness: 0.9, flatShading: true });

  buildInstanced(trunkGeo, trunkS, true, barkMat);
  buildInstanced(trunkGeo, trunkN, false, barkMat);
  buildInstanced(palmTrunkGeo, palmTrunkI, false, barkMat);
  buildInstanced(canopyGeo, canopyS, true, leafCardMat);
  buildInstanced(canopyGeo, canopyN, false, leafCardMat);
  buildInstanced(frondGeo, frondI, false, frondMat);
  buildInstanced(fernGeo, fernI, false, fernMat);
  buildInstanced(bushGeo, bushI, false, bushMat);

  // --- Pond (reflective/refractive Water) ---------------------------------
  const waterNormals = makeWaterNormals();
  const pondWater = new Water(new THREE.CircleGeometry(pond.r, 48), {
    textureWidth: 512,
    textureHeight: 512,
    waterNormals,
    sunDirection: sun.position.clone().normalize(),
    sunColor: 0xffffff,
    waterColor: 0x184e5e,
    distortionScale: 2.2,
    fog: scene.fog !== undefined,
  });
  pondWater.rotation.x = -Math.PI / 2;
  pondWater.position.set(pond.x, 0.1, pond.z);
  scene.add(pondWater);
  const pondUniforms = (pondWater.material as THREE.ShaderMaterial).uniforms;

  for (let i = 0; i < 16; i++) {
    const a = Math.PI * (0.05 + (i / 15) * 0.9);
    const rock = new THREE.Mesh(rockGeo, rockMat);
    rock.position.set(pond.x + Math.cos(a) * (pond.r + 0.6), 0.3, pond.z + Math.sin(a) * (pond.r + 0.6));
    rock.scale.set(1 + Math.random(), 0.6 + Math.random() * 0.6, 1 + Math.random());
    rock.rotation.set(Math.random(), Math.random(), Math.random());
    scene.add(rock);
  }

  // --- Waterfall ----------------------------------------------------------
  const FALL_Z0 = -28;
  const FALL_Z1 = -12;
  const fallCenterZ = (FALL_Z0 + FALL_Z1) / 2;
  const fallLen = FALL_Z1 - FALL_Z0;
  const waterTex = makeWaterTexture();
  waterTex.repeat.set(1, fallLen / 3);
  const fallNormals = makeWaterNormals();
  fallNormals.repeat.set(1, fallLen / 3);
  const fallsGeo = new THREE.PlaneGeometry(6, fallLen, 4, 60);
  fallsGeo.rotateX(-Math.PI / 2);
  const fpos = fallsGeo.attributes.position;
  for (let i = 0; i < fpos.count; i++) {
    fpos.setY(i, heightAt(fpos.getX(i), fpos.getZ(i) + fallCenterZ) + 0.12);
  }
  fallsGeo.computeVertexNormals();
  const falls = new THREE.Mesh(
    fallsGeo,
    new THREE.MeshStandardMaterial({
      map: waterTex,
      normalMap: fallNormals, // moving ripples across the sheet
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      roughness: 0.25,
      metalness: 0,
      emissive: 0x9fd8ff,
      emissiveIntensity: 0.35,
    })
  );
  falls.position.set(0, 0, fallCenterZ);
  scene.add(falls);

  const source = new THREE.Mesh(
    new THREE.CircleGeometry(3, 28),
    new THREE.MeshStandardMaterial({ color: 0x2a86a5, roughness: 0.12, metalness: 0.25 })
  );
  source.rotation.x = -Math.PI / 2;
  source.position.set(0, PLATEAU_H + 0.14, -30); // flat pool on the summit plateau
  scene.add(source);

  const sprayMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false });
  const spray = new THREE.Mesh(new THREE.CircleGeometry(2.4, 24), sprayMat);
  spray.rotation.x = -Math.PI / 2;
  spray.position.set(0, 0.14, -12.5);
  scene.add(spray);

  let t = 0;
  const update = (dt: number): void => {
    t += dt;
    waterTex.offset.y += dt * 0.6; // scroll downhill (toward the pond)
    waterTex.offset.x = Math.sin(t * 2) * 0.02;
    fallNormals.offset.y += dt * 0.9; // ripples flow down the falls
    pondUniforms.time.value += dt; // animate the reflective pond
    windUniforms.time.value = t; // sway the foliage
    sprayMat.opacity = 0.4 + Math.abs(Math.sin(t * 3)) * 0.25;
    for (const c of clouds) {
      c.position.x += dt * 0.7; // slow drift
      if (c.position.x > cloudWrap) c.position.x = -cloudWrap;
    }
  };

  return { bound, update, perches, heightAt, pond };
}

/** Vertical water streaks, tiled + scrolled for the falls. */
function makeWaterTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#bfe6ff';
  ctx.fillRect(0, 0, 64, 256);
  for (let i = 0; i < 45; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.2 + Math.random() * 0.5})`;
    ctx.fillRect(Math.random() * 64, 0, 1 + Math.random() * 3, 256);
  }
  for (let i = 0; i < 30; i++) {
    ctx.fillStyle = `rgba(150,210,255,${0.3 + Math.random() * 0.4})`;
    ctx.fillRect(Math.random() * 64, Math.random() * 256, 1 + Math.random() * 2, 10 + Math.random() * 40);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/**
 * A volumetric "leaf card" canopy: crossed vertical planes PLUS a horizontal
 * one, so it reads as a full leafy blob from any angle instead of a thin sheet
 * when a plane is edge-on to the camera.
 */
function makeLeafCard(): THREE.BufferGeometry {
  const planes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    const p = new THREE.PlaneGeometry(3.6, 3.6);
    p.rotateY((i / 4) * Math.PI); // 0/45/90/135° — always one facing the camera
    planes.push(p);
  }
  const top = new THREE.PlaneGeometry(3.6, 3.6);
  top.rotateX(-Math.PI / 2); // horizontal cap fills the top-down view
  top.translate(0, 0.6, 0);
  planes.push(top);
  return mergeGeometries(planes)!;
}

/** A leaf-cluster texture with transparent background for alpha-cutout canopies. */
function makeLeafCardTexture(): THREE.CanvasTexture {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, s, s); // transparent
  const cx = s / 2;
  const cy = s / 2;
  // A dense filled core so the card is a solid blob, not a sparse spray of leaves.
  ctx.fillStyle = 'rgba(220,225,210,0.98)';
  ctx.beginPath();
  ctx.arc(cx, cy, s * 0.38, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 0; i < 150; i++) {
    // Leafy silhouette around the edge so it doesn't read as a hard disc.
    const a = Math.random() * Math.PI * 2;
    const rr = s * (0.28 + Math.random() * 0.2);
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    const light = 200 + Math.random() * 45;
    ctx.fillStyle = `rgba(${light},${light},${Math.round(light * 0.95)},0.96)`;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a + Math.PI / 2);
    ctx.beginPath();
    ctx.ellipse(0, 0, 4 + Math.random() * 5, 8 + Math.random() * 9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  return new THREE.CanvasTexture(c);
}

/** A procedural water normal map: gentle bluish wave perturbations, tileable. */
function makeWaterNormals(): THREE.CanvasTexture {
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

/** Vertical sky gradient: deep blue at the zenith fading to pale at the horizon. */
function makeSkyGradient(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#1e6fd0'); // zenith — deep blue
  g.addColorStop(0.5, '#4f9fe0');
  g.addColorStop(1, '#a9d3ef'); // horizon — pale blue (not white)
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 16, 256);
  return new THREE.CanvasTexture(c);
}

/** A mottled noise texture from a small palette — cheap ground/dirt variation. */
function makeNoiseTexture(palette: string[], size: number): THREE.CanvasTexture {
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
