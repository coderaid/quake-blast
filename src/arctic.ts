import * as THREE from 'three';
import { CONFIG } from './config';
import { rockTexture, rockTextureTiled, noiseTexture, skyGradientTexture } from './textures';
import type { LevelHandle } from './level';

/**
 * Builds the ARCTIC level: a snowbound clearing ringed by dark spruce forest,
 * a glaciated crag on the north edge where the jungle's waterfall has frozen
 * into a solid cascade, and a frozen lake where the pond was — the ice is
 * WALKABLE (pondBlocksMovement: false) but nearly frictionless (slipAt → 1),
 * so crossing it at speed turns into a slide.
 *
 * Same construction philosophy as the jungle: everything procedural, forests
 * as InstancedMesh rings with per-instance color fading into the fog, one
 * group for whole-level teardown, and the level owns its own atmosphere —
 * a low golden sun, pale dense fog, drifting snowfall and an aurora overhead.
 */

// Palette / feel constants (visual only; gameplay numbers live in CONFIG).
const FOG_COLOR = 0xdbe9f5;
const SPRUCE_GREENS = [0x1d4a33, 0x24573b, 0x173d2a, 0x2c6344, 0x1a4530, 0x21503a];
const SNOW_WHITE = 0xf4f8fc;
const TRUNK_BROWN = 0x4a382a;
const ICE_COLOR = 0xbfe4f5;
const SNOWFLAKES = 2600;

export function buildArctic(scene: THREE.Scene): LevelHandle {
  const { halfSize } = CONFIG.arena;
  const bound = halfSize - 0.5;
  const group = new THREE.Group();
  scene.add(group);

  // --- Atmosphere (level-owned): pale, dense, cold ------------------------
  scene.background = new THREE.Color(0xcfe2f3);
  scene.fog = new THREE.Fog(FOG_COLOR, 38, halfSize * 3.4);

  // --- Terrain height field: same glacial crag footprint as the jungle ----
  const HILL_CX = 0;
  const HILL_CZ = -30;
  const HILL_R = 13;
  const HILL_H = 15;
  const PLATEAU_H = 12.5;
  const heightAt = (x: number, z: number): number => {
    const d = Math.hypot(x - HILL_CX, z - HILL_CZ);
    if (d >= HILL_R) return 0;
    return Math.min(PLATEAU_H, HILL_H * 0.5 * (1 + Math.cos((Math.PI * d) / HILL_R)));
  };

  const pond = { x: 0, z: -7, r: 5 };
  // Sheet ice on the lake, feathering back to grip over ~1.5 units of bank.
  const slipAt = (x: number, z: number): number => {
    const d = Math.hypot(x - pond.x, z - pond.z);
    if (d < pond.r) return 1;
    if (d < pond.r + 1.5) return 1 - (d - pond.r) / 1.5;
    return 0;
  };

  // --- Ground: deep snow, with a packed-snow clearing ----------------------
  const snowTex = noiseTexture(['#e9f1f8', '#dde8f2', '#f7fbff', '#d3e0ec'], 256);
  snowTex.wrapS = snowTex.wrapT = THREE.RepeatWrapping;
  snowTex.repeat.set(22, 22);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(halfSize * 8, halfSize * 8),
    new THREE.MeshStandardMaterial({ map: snowTex, roughness: 0.92 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  ground.receiveShadow = true;
  group.add(ground);

  const packedTex = noiseTexture(['#dce7f1', '#d0deea', '#e6eff7', '#c6d6e5'], 128);
  packedTex.wrapS = packedTex.wrapT = THREE.RepeatWrapping;
  packedTex.repeat.set(6, 6);
  const clearing = new THREE.Mesh(
    new THREE.CircleGeometry(18, 48),
    new THREE.MeshStandardMaterial({ map: packedTex, roughness: 0.85 })
  );
  clearing.rotation.x = -Math.PI / 2;
  clearing.position.set(0, 0.0, 10);
  clearing.receiveShadow = true;
  group.add(clearing);

  // --- Lighting: a low winter sun raking long shadows across the snow ------
  group.add(new THREE.HemisphereLight(0xcadeff, 0x8fa3b8, 0.85));
  const sun = new THREE.DirectionalLight(0xffe3b8, 1.25);
  sun.position.set(-32, 16, 24); // low over the southwest treeline
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -halfSize;
  sun.shadow.camera.right = halfSize;
  sun.shadow.camera.top = halfSize;
  sun.shadow.camera.bottom = -halfSize;
  sun.shadow.camera.far = 150;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.5;
  group.add(sun);
  group.add(sun.target);

  // --- Sky dome, visible sun disc + halo -----------------------------------
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(halfSize * 7, 24, 16),
    new THREE.MeshBasicMaterial({
      map: skyGradientTexture('#3f7cc4', '#9cc2e8', '#e8f1f8'),
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
    })
  );
  group.add(sky);

  const sunDir = sun.position.clone().normalize();
  const sunDisc = new THREE.Mesh(
    new THREE.CircleGeometry(10, 24),
    new THREE.MeshBasicMaterial({ color: 0xfff2d0, fog: false, depthWrite: false })
  );
  sunDisc.position.copy(sunDir).multiplyScalar(halfSize * 6.2);
  sunDisc.lookAt(0, 0, 0);
  group.add(sunDisc);
  const halo = new THREE.Mesh(
    new THREE.CircleGeometry(24, 24),
    new THREE.MeshBasicMaterial({
      color: 0xffe9c4,
      transparent: true,
      opacity: 0.22,
      fog: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  halo.position.copy(sunDir).multiplyScalar(halfSize * 6.15);
  halo.lookAt(0, 0, 0);
  group.add(halo);

  // --- Aurora: two waving additive ribbons high over the crag --------------
  const auroraTex = makeAuroraTexture();
  auroraTex.wrapS = THREE.RepeatWrapping;
  const auroraMats: THREE.MeshBasicMaterial[] = [];
  for (const [y, rotY, phase] of [
    [78, 0.35, 0],
    [92, -0.5, 2.1],
  ] as const) {
    const geo = new THREE.PlaneGeometry(halfSize * 6.5, 26, 48, 1);
    const ap = geo.attributes.position;
    for (let i = 0; i < ap.count; i++) {
      // Bend the ribbon into a slow S-curve so it doesn't read as a flat billboard.
      ap.setZ(i, Math.sin(ap.getX(i) * 0.025 + phase) * 22);
    }
    geo.computeVertexNormals();
    const mat = new THREE.MeshBasicMaterial({
      map: auroraTex,
      transparent: true,
      opacity: 0.42,
      side: THREE.DoubleSide,
      fog: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const ribbon = new THREE.Mesh(geo, mat);
    ribbon.position.set(0, y, -halfSize * 1.6);
    ribbon.rotation.y = rotY;
    group.add(ribbon);
    auroraMats.push(mat);
  }

  // --- Glaciated crag -------------------------------------------------------
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
    new THREE.MeshStandardMaterial({
      color: 0xc9d3de, // snow-crusted rock
      map: rockTextureTiled(10),
      roughness: 0.9,
      flatShading: true,
    })
  );
  hill.position.set(HILL_CX, 0, HILL_CZ);
  hill.receiveShadow = true;
  hill.castShadow = true;
  group.add(hill);

  // Boulders — cold grey rock wearing flattened white snow caps.
  const rockGeo = new THREE.IcosahedronGeometry(1, 0);
  const rockMat = new THREE.MeshStandardMaterial({
    color: 0x77808c,
    map: rockTexture(),
    roughness: 0.95,
    flatShading: true,
  });
  const snowCapMat = new THREE.MeshStandardMaterial({ color: SNOW_WHITE, roughness: 0.85, flatShading: true });
  const addBoulder = (x: number, z: number, s: number, ys: number) => {
    const rock = new THREE.Mesh(rockGeo, rockMat);
    rock.position.set(x, heightAt(x, z) + s * 0.3, z);
    rock.scale.set(s, s * ys, s);
    rock.rotation.set(Math.random(), Math.random(), Math.random());
    rock.castShadow = true;
    group.add(rock);
    const cap = new THREE.Mesh(rockGeo, snowCapMat);
    cap.position.set(x, heightAt(x, z) + s * (0.3 + ys * 0.65), z);
    cap.scale.set(s * 0.85, s * 0.3, s * 0.85);
    cap.rotation.y = Math.random() * Math.PI;
    group.add(cap);
  };
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * Math.PI * 2;
    const rr = Math.random() * (HILL_R - 2);
    const bx = HILL_CX + Math.cos(a) * rr;
    const bz = HILL_CZ + Math.sin(a) * rr;
    if (Math.abs(bx) < 4.5 && bz > -29) continue; // keep the frozen cascade clear
    addBoulder(bx, bz, 0.6 + Math.random() * 1.8, 0.6 + Math.random() * 0.5);
  }
  for (const sx of [-1, 1]) {
    for (let k = 0; k < 5; k++) {
      const z = -12 - k * 3.2;
      const x = sx * (4.8 + Math.random() * 1.8);
      addBoulder(x, z, 1.5 + Math.random() * 1.6, 0.75 + Math.random() * 0.5);
    }
  }

  // --- Spruce forest (instanced conifers with snow-laden tips) -------------
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.32, 2.6, 6);
  const tierGeo = new THREE.ConeGeometry(1.9, 3.4, 7);
  const snowTipGeo = new THREE.ConeGeometry(1.0, 1.5, 7);
  const driftGeo = new THREE.IcosahedronGeometry(0.9, 0);
  const shrubGeo = new THREE.IcosahedronGeometry(0.55, 0);
  const shardGeo = new THREE.ConeGeometry(0.22, 1.1, 5);

  const fogColor = new THREE.Color(FOG_COLOR);
  const maxR = bound * 3.6;
  const greens = SPRUCE_GREENS.map((c) => new THREE.Color(c));
  const snowColor = new THREE.Color(SNOW_WHITE);
  const trunkColor = new THREE.Color(TRUNK_BROWN);
  const tint = (base: THREE.Color, r: number) =>
    base.clone().lerp(fogColor, Math.min(0.65, (r / maxR) * 0.8));

  type Inst = { m: THREE.Matrix4; c: THREE.Color };
  const trunkI: Inst[] = [];
  const tierS: Inst[] = []; // shadow-casting (near ring)
  const tierN: Inst[] = [];
  const snowS: Inst[] = [];
  const snowN: Inst[] = [];
  const driftI: Inst[] = [];
  const shrubI: Inst[] = [];
  const shardI: Inst[] = [];

  const parent = new THREE.Object3D();
  const child = new THREE.Object3D();
  const worldMatrix = (): THREE.Matrix4 => {
    parent.updateMatrix();
    child.updateMatrix();
    return new THREE.Matrix4().multiplyMatrices(parent.matrix, child.matrix);
  };

  /** A spruce: trunk + three green tiers + a snow-dusted tip. Returns the perch point. */
  const placeSpruce = (x: number, z: number, s: number, shadow: boolean): THREE.Vector3 => {
    const y0 = heightAt(x, z);
    const r = Math.hypot(x, z);
    parent.position.set(x, y0, z);
    parent.rotation.set(0, Math.random() * Math.PI * 2, 0);
    parent.scale.set(1, 1, 1);

    child.rotation.set(0, 0, 0);
    child.position.set(0, 1.1 * s, 0);
    child.scale.setScalar(s);
    trunkI.push({ m: worldMatrix(), c: trunkColor.clone().multiplyScalar(0.85 + Math.random() * 0.3) });

    const green = tint(greens[(Math.random() * greens.length) | 0], r);
    const tiers = shadow ? tierS : tierN;
    const caps = shadow ? snowS : snowN;
    for (let i = 0; i < 3; i++) {
      const spread = 1 - i * 0.26; // tighter toward the top
      child.position.set(0, (2.6 + i * 1.7) * s, 0);
      child.scale.set(s * spread, s, s * spread);
      tiers.push({ m: worldMatrix(), c: green.clone().multiplyScalar(0.92 + i * 0.06) });
    }
    child.position.set(0, 7.4 * s, 0);
    child.scale.setScalar(s * (0.85 + Math.random() * 0.25));
    caps.push({ m: worldMatrix(), c: tint(snowColor, r) });

    return new THREE.Vector3(x, y0 + 8.1 * s, z);
  };

  const excluded = (x: number, z: number) =>
    heightAt(x, z) > 0.3 ||
    Math.hypot(x - pond.x, z - pond.z) < pond.r + 4 ||
    (z < -2 && Math.abs(x) < 7);

  const scatter = (count: number, rMin: number, rMax: number, shadow: boolean) => {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const jitter = 1 + (Math.random() - 0.5) * 0.3;
      const r = Math.sqrt(rMin * rMin + Math.random() * (rMax * rMax - rMin * rMin)) * jitter;
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;
      if (excluded(x, z)) continue;
      placeSpruce(x, z, 0.9 + Math.random() * 1.2, shadow);
    }
  };
  scatter(180, bound * 0.74, bound * 1.5, true); // near, shadowed
  scatter(400, bound * 1.25, bound * 2.5, false); // mid
  scatter(400, bound * 2.2, bound * 3.6, false); // far backdrop

  const perches: THREE.Vector3[] = [];
  const PERCH_TREES = 8;
  for (let i = 0; i < PERCH_TREES; i++) {
    const angle = (i / PERCH_TREES) * Math.PI * 2 + 0.4;
    const r = bound * 0.72;
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    if (excluded(x, z)) continue;
    perches.push(placeSpruce(x, z, 1.5, true));
  }

  // Understory: snow drifts, frost-killed shrubs, ice shards near the lake.
  for (let i = 0; i < 520; i++) {
    const angle = Math.random() * Math.PI * 2;
    const r = Math.sqrt((bound * 0.6) ** 2 + Math.random() * ((bound * 2.4) ** 2 - (bound * 0.6) ** 2));
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    if (excluded(x, z)) continue;
    const y0 = heightAt(x, z);
    parent.position.set(x, y0, z);
    parent.rotation.set(0, Math.random() * Math.PI * 2, 0);
    parent.scale.set(1, 1, 1);
    child.rotation.set(0, 0, 0);
    const roll = Math.random();
    if (roll < 0.6) {
      child.position.set(0, 0.15, 0);
      child.scale.set(1 + Math.random() * 1.4, 0.3 + Math.random() * 0.25, 1 + Math.random() * 1.4);
      driftI.push({ m: worldMatrix(), c: tint(snowColor, r) });
    } else {
      child.position.set(0, 0.3, 0);
      child.scale.set(0.8 + Math.random(), 0.8 + Math.random() * 0.8, 0.8 + Math.random());
      shrubI.push({ m: worldMatrix(), c: tint(new THREE.Color(0x5d4a36), r) });
    }
  }
  // Ice shards jutting up around the frozen lake's rim.
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * Math.PI * 2;
    const rr = pond.r + 0.4 + Math.random() * 1.2;
    parent.position.set(pond.x + Math.cos(a) * rr, 0, pond.z + Math.sin(a) * rr);
    parent.rotation.set((Math.random() - 0.5) * 0.5, Math.random() * Math.PI, (Math.random() - 0.5) * 0.5);
    parent.scale.set(1, 1, 1);
    child.rotation.set(0, 0, 0);
    child.position.set(0, 0.4, 0);
    child.scale.set(0.7 + Math.random(), 0.6 + Math.random() * 1.5, 0.7 + Math.random());
    shardI.push({ m: worldMatrix(), c: new THREE.Color(ICE_COLOR) });
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
    mesh.frustumCulled = false;
    group.add(mesh);
  };

  // Stiff conifers barely move — a fraction of the jungle's sway sells the cold still air.
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
            'float wPhase = uTime * 1.1 + instanceMatrix[3][0] * 0.25 + instanceMatrix[3][2] * 0.25;',
            'float wWeight = max(position.y, 0.0) * 0.045;',
            'transformed.x += sin(wPhase) * wWeight;',
            'transformed.z += cos(wPhase * 0.9) * wWeight * 0.7;',
          ].join('\n')
        );
    };
    m.customProgramCacheKey = () => 'arctic-wind';
    return m;
  };

  const barkMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true });
  const needleMat = windify(
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true })
  );
  const snowMat = windify(
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, flatShading: true })
  );
  const driftMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true });
  const shrubMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });
  const shardMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.15,
    metalness: 0.1,
    flatShading: true,
    transparent: true,
    opacity: 0.85,
  });

  buildInstanced(trunkGeo, trunkI, false, barkMat);
  buildInstanced(tierGeo, tierS, true, needleMat);
  buildInstanced(tierGeo, tierN, false, needleMat);
  buildInstanced(snowTipGeo, snowS, true, snowMat);
  buildInstanced(snowTipGeo, snowN, false, snowMat);
  buildInstanced(driftGeo, driftI, false, driftMat);
  buildInstanced(shrubGeo, shrubI, false, shrubMat);
  buildInstanced(shardGeo, shardI, false, shardMat);

  // --- Frozen lake (walkable, slippery — see slipAt) ------------------------
  const iceTex = makeIceTexture();
  const lake = new THREE.Mesh(
    new THREE.CircleGeometry(pond.r, 48),
    new THREE.MeshStandardMaterial({
      map: iceTex,
      color: 0xdff0fa,
      roughness: 0.12,
      metalness: 0.15,
      emissive: 0x36586e,
      emissiveIntensity: 0.12,
    })
  );
  lake.rotation.x = -Math.PI / 2;
  lake.position.set(pond.x, 0.04, pond.z);
  lake.receiveShadow = true;
  group.add(lake);

  // --- Frozen cascade: the waterfall, stopped mid-fall ----------------------
  const FALL_Z0 = -28;
  const FALL_Z1 = -12;
  const fallCenterZ = (FALL_Z0 + FALL_Z1) / 2;
  const fallLen = FALL_Z1 - FALL_Z0;
  const fallsGeo = new THREE.PlaneGeometry(6, fallLen, 6, 60);
  fallsGeo.rotateX(-Math.PI / 2);
  const fpos = fallsGeo.attributes.position;
  for (let i = 0; i < fpos.count; i++) {
    // Drape over the crag with frozen ripples bulging out of the sheet.
    const x = fpos.getX(i);
    const z = fpos.getZ(i) + fallCenterZ;
    const ripple = Math.sin(z * 2.1 + x * 1.3) * 0.1;
    fpos.setY(i, heightAt(x, z) + 0.14 + ripple);
  }
  fallsGeo.computeVertexNormals();
  const falls = new THREE.Mesh(
    fallsGeo,
    new THREE.MeshStandardMaterial({
      map: iceTex,
      color: ICE_COLOR,
      transparent: true,
      opacity: 0.92,
      side: THREE.DoubleSide,
      roughness: 0.18,
      metalness: 0.1,
      emissive: 0x5f93b5,
      emissiveIntensity: 0.18,
    })
  );
  falls.position.set(0, 0, fallCenterZ);
  group.add(falls);

  // Icicles fringing the cascade's lower lip.
  const icicleMat = new THREE.MeshStandardMaterial({
    color: ICE_COLOR,
    transparent: true,
    opacity: 0.9,
    roughness: 0.1,
    metalness: 0.1,
  });
  for (let i = 0; i < 10; i++) {
    const x = -2.6 + (i / 9) * 5.2;
    const z = -12.4 - Math.random() * 0.8;
    const len = 0.4 + Math.random() * 0.9;
    const icicle = new THREE.Mesh(new THREE.ConeGeometry(0.06 + Math.random() * 0.07, len, 6), icicleMat);
    icicle.position.set(x, heightAt(x, z) + 0.15 - len / 2, z);
    icicle.rotation.x = Math.PI; // apex points down
    group.add(icicle);
  }

  // Summit pool, frozen solid.
  const source = new THREE.Mesh(
    new THREE.CircleGeometry(3, 28),
    new THREE.MeshStandardMaterial({ map: iceTex, color: 0xcfe8f4, roughness: 0.15, metalness: 0.15 })
  );
  source.rotation.x = -Math.PI / 2;
  source.position.set(0, PLATEAU_H + 0.14, -30);
  group.add(source);

  // --- Snowfall --------------------------------------------------------------
  const SNOW_R = bound * 1.8;
  const SNOW_H = 26;
  const snowPos = new Float32Array(SNOWFLAKES * 3);
  const snowSeed = new Float32Array(SNOWFLAKES);
  for (let i = 0; i < SNOWFLAKES; i++) {
    snowPos[i * 3] = (Math.random() * 2 - 1) * SNOW_R;
    snowPos[i * 3 + 1] = Math.random() * SNOW_H;
    snowPos[i * 3 + 2] = (Math.random() * 2 - 1) * SNOW_R;
    snowSeed[i] = Math.random() * Math.PI * 2;
  }
  const snowGeo = new THREE.BufferGeometry();
  snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPos, 3));
  const snow = new THREE.Points(
    snowGeo,
    new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.13,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      sizeAttenuation: true,
    })
  );
  snow.frustumCulled = false;
  group.add(snow);

  let t = 0;
  const update = (dt: number): void => {
    t += dt;
    windUniforms.time.value = t;
    // Snowflakes sink with per-flake flutter, wrapping back to the top.
    const p = snowGeo.attributes.position.array as Float32Array;
    for (let i = 0; i < SNOWFLAKES; i++) {
      const s = snowSeed[i];
      p[i * 3] += Math.sin(t * 0.8 + s) * dt * 0.5;
      p[i * 3 + 1] -= (1.3 + (s % 1) * 0.9) * dt;
      p[i * 3 + 2] += Math.cos(t * 0.7 + s * 1.3) * dt * 0.4;
      if (p[i * 3 + 1] < 0) {
        p[i * 3 + 1] = SNOW_H;
        p[i * 3] = (Math.random() * 2 - 1) * SNOW_R;
        p[i * 3 + 2] = (Math.random() * 2 - 1) * SNOW_R;
      }
    }
    snowGeo.attributes.position.needsUpdate = true;
    // Aurora breathes and drifts.
    auroraTex.offset.x += dt * 0.012;
    auroraMats[0].opacity = 0.34 + Math.sin(t * 0.35) * 0.12;
    auroraMats[1].opacity = 0.3 + Math.sin(t * 0.27 + 1.4) * 0.12;
  };

  return {
    group,
    bound,
    update,
    perches,
    heightAt,
    pond,
    pondBlocksMovement: false, // frozen solid — walk (and slide) across it
    slipAt,
  };
}

/** Pale blue ice with pressure cracks and refrozen white veins. */
function makeIceTexture(): THREE.CanvasTexture {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#cfe8f4';
  ctx.fillRect(0, 0, s, s);
  // Soft depth blotches (darker water trapped under the sheet).
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(90,140,175,${0.1 + Math.random() * 0.15})`;
    ctx.beginPath();
    ctx.arc(Math.random() * s, Math.random() * s, 8 + Math.random() * 30, 0, Math.PI * 2);
    ctx.fill();
  }
  // Long pressure cracks radiating in random directions.
  for (let i = 0; i < 22; i++) {
    let x = Math.random() * s;
    let y = Math.random() * s;
    let a = Math.random() * Math.PI * 2;
    ctx.strokeStyle = `rgba(255,255,255,${0.35 + Math.random() * 0.4})`;
    ctx.lineWidth = 0.8 + Math.random() * 1.2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const segs = 4 + Math.floor(Math.random() * 5);
    for (let k = 0; k < segs; k++) {
      a += (Math.random() - 0.5) * 0.9; // cracks kink as they propagate
      x += Math.cos(a) * (10 + Math.random() * 22);
      y += Math.sin(a) * (10 + Math.random() * 22);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Vertical curtain gradient for the aurora: green core fading to teal/violet edges. */
function makeAuroraTexture(): THREE.CanvasTexture {
  const w = 512;
  const h = 128;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, w, h);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(120,60,200,0)');
  g.addColorStop(0.25, 'rgba(80,220,170,0.5)');
  g.addColorStop(0.55, 'rgba(60,255,140,0.85)');
  g.addColorStop(0.85, 'rgba(40,200,120,0.3)');
  g.addColorStop(1, 'rgba(40,180,120,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // Vertical curtain rays of varying brightness.
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * w;
    ctx.fillStyle = `rgba(160,255,200,${0.05 + Math.random() * 0.14})`;
    ctx.fillRect(x, 0, 2 + Math.random() * 6, h);
  }
  return new THREE.CanvasTexture(c);
}
