import * as THREE from 'three';
import { isSharedTexture } from './textures';
import { buildJungle } from './arena';
import { buildArctic } from './arctic';

/**
 * The contract every level hands back to Game. A level owns its own look —
 * terrain, foliage, atmosphere (it sets scene.fog / scene.background itself) —
 * and exposes just enough world data for the systems to be wired into it:
 * movement clamping, terrain height, eagle roosts, water footprint, and how
 * grippy the ground is (the arctic's frozen lake is walkable but slippery).
 */
export interface LevelHandle {
  /** Everything the level added to the scene, so it can be torn down whole. */
  group: THREE.Group;
  /** Clearing half-extent that movement/placement clamp against. */
  bound: number;
  /** Per-frame hook: water, wind, snowfall, aurora, clouds. */
  update: (dt: number) => void;
  /** Tree-top sit points eagles roost on. */
  perches: THREE.Vector3[];
  /** Terrain elevation at (x,z); the flat clearing is 0. */
  heightAt: (x: number, z: number) => number;
  /** Water footprint — brick placement always avoids it. */
  pond: { x: number; z: number; r: number };
  /** Whether the pond bank blocks walking (liquid) or is frozen over (walkable). */
  pondBlocksMovement: boolean;
  /** Ground grip at (x,z): 0 = full traction, 1 = sheet ice (slide). */
  slipAt: (x: number, z: number) => number;
}

export interface LevelDef {
  name: string;
  blurb: string;
  build: (scene: THREE.Scene) => LevelHandle;
}

/** Playable levels, in campaign order (victory advances to the next one). */
export const LEVELS: LevelDef[] = [
  {
    name: 'JUNGLE',
    blurb: 'Rainforest clearing with a waterfall, a pond and a climbable crag.',
    build: buildJungle,
  },
  {
    name: 'ARCTIC',
    blurb: 'Frozen tundra under the aurora — the lake is solid ice: walk it, slide on it.',
    build: buildArctic,
  },
];

/**
 * Remove a level from the scene and free its GPU resources. Geometries and
 * materials are level-owned and disposed; textures are disposed unless they are
 * the shared cached ones from textures.ts (reused by entities and other levels).
 */
export function disposeLevel(scene: THREE.Scene, level: LevelHandle): void {
  scene.remove(level.group);
  const seen = new Set<object>();
  const texSlots = ['map', 'normalMap', 'emissiveMap', 'alphaMap', 'roughnessMap'] as const;
  level.group.traverse((obj) => {
    const o = obj as unknown as {
      geometry?: THREE.BufferGeometry;
      material?: THREE.Material | THREE.Material[];
    };
    if (o.geometry && !seen.has(o.geometry)) {
      seen.add(o.geometry);
      o.geometry.dispose();
    }
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      if (seen.has(m)) continue;
      seen.add(m);
      for (const slot of texSlots) {
        const t = (m as unknown as Record<string, THREE.Texture | null>)[slot];
        if (t && !seen.has(t) && !isSharedTexture(t)) {
          seen.add(t);
          t.dispose();
        }
      }
      m.dispose();
    }
  });
}
