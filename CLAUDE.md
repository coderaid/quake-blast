# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Quake Blast is a web-first, multi-platform **wave-defense FPS** built with Three.js + TypeScript and bundled by Vite. "Web-first" is the core architectural bet: the game runs in any browser (so it is multi-platform by default) and can later be wrapped with Electron/Capacitor for native desktop/mobile installs without rewriting the game logic.

**The game loop is a phase state machine** (`Phase` in `src/game.ts`):

1. `build` — a countdown during which the player places HP-bearing **bases** (gold bricks; aim at the ground, click; ghost preview shows green=valid / red=invalid). Bricks snap to a grid and **stack** into climbable columns (up to `CONFIG.build.maxStack`); the hill slope and pond are invalid placement.
2. `assault` — when the timer expires, a finite wave of **enemies** storms in from the arena edges and attacks the nearest base (or the player if no bases remain). Two enemy pools run at once: ground **monsters** (vampire rabbits) and flying **eagles** that dive and periodically perch on trees. The player shoots them all.
3. `won` — the wave is cleared with ≥1 base still standing (HUD reports how many of N bases survived) → the next click advances to the **next level**.
4. `lost` — all bases destroyed, or the player died → retry the same level.

Win/lose conditions and the forgiving "≥1 base = win" rule live in `Game.updateAssault`/`endGame` — adjust there if the goal should require *all* bases to survive.

**There are two levels** — JUNGLE and ARCTIC — registered in `LEVELS` (`src/level.ts`). The start overlay has a level-select button row, victory advances through the registry in order (wrapping to the first), and `?level=arctic` (or `?level=1`) in the URL jumps straight to a level for testing.

## Commands

Node is installed at a non-standard winget path and is **not on the default PATH**. Prepend it in every shell before running npm/node:

```powershell
$env:Path = "C:\Users\antho\AppData\Local\Microsoft\WinGet\Packages\OpenJS.NodeJS.LTS_Microsoft.Winget.Source_8wekyb3d8bbwe\node-v24.18.0-win-x64;" + $env:Path
```

| Task | Command |
| --- | --- |
| Install deps | `npm install` |
| Run dev server (HMR) | `npm run dev` → http://localhost:5173 |
| Typecheck only | `npm run typecheck` (`tsc --noEmit`) |
| Production build | `npm run build` (typechecks, then `vite build` → `dist/`) |
| Preview built output | `npm run preview` |

There is **no test runner or linter configured yet**. The typecheck (`tsc --noEmit`, strict mode with `noUnusedLocals`/`noUnusedParameters`) is the de-facto correctness gate — run it before considering a change done.

### Gotchas

- npm 11 gates dependency install scripts. esbuild (which Vite needs) is pre-approved via the `allowScripts` field in `package.json`. If esbuild fails to run, re-approve with `npm approve-scripts esbuild && npm rebuild esbuild`.
- The Vite build prints a "chunks larger than 500 kB" warning — that is just the Three.js bundle, not an error.
- The preview/screenshot tooling cannot capture the canvas because the game runs a continuous `requestAnimationFrame` loop that never settles. Verify rendering by opening the dev server in a real browser; verify correctness via `npm run typecheck` + the browser console (should be error-free).

## Architecture

The game is a small set of single-responsibility classes wired together by `Game`. Data flows one way each frame: input → `Player`/enemy state updates → post-processed render.

- `src/main.ts` — entry point. Grabs `#app`, constructs `Game`, calls `start()`.
- `src/config.ts` — **all gameplay tuning lives here** as a single `as const` `CONFIG` object (arena, player, weapon, build phase, building, `monster` wave, `eagle` wave). Change feel here, not in the systems. Because it is `as const`, fields read from it are literal types — annotate mutable class fields explicitly (e.g. `health: number = CONFIG.player.maxHealth`) or `tsc` will infer a literal type and reject reassignment.
- `src/game.ts` — `Game` orchestrator + `Phase` state machine. Owns the renderer, an `EffectComposer` post-processing chain, scene, camera, and the single `requestAnimationFrame` loop (`tick`), which dispatches per-phase (`updateGhost`/`updateAssault`). Renders via `composer.render()` (SSAO + bloom + tone-mapping/OutputPass), **not** `renderer.render()`. Holds all game state (phase, timers, budget, `buildings`, `monsters`, `eagles`, `stacks`, `kills`) and is the only place systems are coordinated. `dt` is clamped to 0.05s to avoid tunneling on lag spikes.
- `src/level.ts` — the **level system**: `LevelHandle` (the contract every level returns), the `LEVELS` registry (name + blurb + `build(scene)`), and `disposeLevel()` (removes the level's group and frees geometries/materials/textures, skipping the shared cached ones). A level owns its own atmosphere — it sets `scene.fog`/`scene.background` itself — and reports `pondBlocksMovement` (is the water liquid or frozen ice?) and `slipAt(x,z)` (0 = grip, 1 = sheet ice). `Game.loadLevel()` tears down the old level, builds the new one, and re-injects the world into `Player` via `setWorld()`.
- `src/arena.ts` — `buildJungle(scene)` builds the procedural **JUNGLE level**: flat clearing, multi-ring treeline, climbable rocky hill with a waterfall spilling into a reflective pond, drifting clouds, airborne pollen motes. `heightAt(x,z)` is the **terrain height field** (flat clearing = 0, rocky climbable hill rises) that the player, monsters, and brick placement all query. Foliage is drawn with `InstancedMesh` (thousands of trees/understory at a handful of draw calls) and sways via a shared time uniform injected into the standard material shader (`onBeforeCompile`). There is still **no general collision system** — just AABB/plane clamping. Everything is parented to one `THREE.Group` so `disposeLevel` can tear it down.
- `src/arctic.ts` — `buildArctic(scene)` builds the **ARCTIC level** with the same crag/pond footprint (gameplay parity): snowbound clearing, instanced snow-tipped spruce forest, the waterfall frozen into a static ice cascade with icicles, a **frozen lake that is walkable but slippery** (`pondBlocksMovement: false`, `slipAt` → 1 on the ice), falling snow (CPU-updated `THREE.Points`), a low raking winter sun with a visible disc/halo, and two additive aurora ribbons overhead.
- `src/textures.ts` — shared **procedural canvas textures** (bark, leaf, rock, fur, feather), each built once and **cached in a module-level singleton** so thousands of instanced meshes reuse one texture, plus uncached helpers (`noiseTexture`, `skyGradientTexture`, `waterNormalsTexture`) that levels own and dispose. Do **not** `dispose()` the cached ones per-entity — `isSharedTexture()` is how `disposeLevel` skips them.
- `src/player.ts` — `Player`. The camera **is** the player (via `PointerLockControls`). Movement is velocity + damping on the camera rig, then clamped to `bound`; on top of that it does **jump + gravity over a support height** computed from `heightAt` and the tops of climbable bricks, stops at the pond bank (unless frozen), and resolves AABB collision against tall bricks. The world (`bound`/`heightAt`/`pond`/`slipAt`) is injected via `setWorld()` on every level load; brick AABBs come from a `solids()` closure. **Movement feel**: Shift sprint, reduced air control, ice sliding (slip kills damping + acceleration), stride head-bob, strafe lean, landing crouch dip, speed-eased FOV, and a recoil pitch kick inside `tryShoot()` — feel constants are module-level, physics numbers in CONFIG. `tryShoot()` returns `{ fired, hit }` so Game can play fire effects on misses too; `aimGroundPoint()` intersects the center ray with y=0 for placement.
- `src/weapon.ts` — `WeaponView`, the first-person **viewmodel**: a procedural blaster parented to the camera with stride-synced bob, mouse-look sway lag, recoil recovery, muzzle flash (sprite + brief `PointLight`), pooled world-space hitscan tracers, and impact sparks. Purely visual — damage/cooldown stay in `Player`/`Game`; `Game.shoot()` calls `weapon.fireEffects(end, hitSomething)`.
- `src/building.ts` — `Building` (a "base"): a gold-brick box with HP. `position.y` is the brick **base** (bottom), so stacked bricks sit flush; tints gold→red as damaged, hides when destroyed. `Game.stacks` (a `cellKey → count` map) tracks how many bricks are in each grid column for stacking + climbing.
- `src/monster.ts` — `Monster`, a procedurally-built **vampire rabbit** that hops toward a target on the XZ plane (following `heightAt`) and reports contact via `update(dt, target, targetRadius) → boolean`. It does **not** decide what to attack — `Game` picks the target (nearest base, else player). Finite wave, no respawn.
- `src/eagle.ts` — `Eagle`, a flying attacker that soars at cruise altitude, dives to strike, and periodically flies to a `perch` to rest. **Structurally matches `Monster`'s contract** (`mesh`, `radius`, `damagePerSecond`, `health`, `alive`, `update()→boolean`, `damage()→boolean`, `dispose()`) so `Game` iterates `[...monsters, ...eagles]` uniformly. Its own pool, counted alongside monsters.
- `src/hud.ts` — `Hud`. DOM/CSS overlay (crosshair, phase banner, HP/bases stats, damage flash, start/victory/defeat screens) driven by a single `update(HudState)` call — deliberately **not** drawn in WebGL.
- `src/touch.ts` — `TouchControls` + `isTouchDevice()`. iPad/phone input (there is no keyboard/mouse/pointer-lock there): floating left-thumb joystick, right-half drag-to-look, FIRE/JUMP buttons — another DOM overlay like `Hud`. `Player` merges its analog `moveX/moveY/jumpHeld` with WASD and takes look deltas via `applyLook()`; `Game` polls `fireHeld` (hold-to-autofire) and gets single `onFire` presses for build placement. On touch there is no pointer lock, so `Player.touchPlaying` + the `active` getter stand in for `isLocked`; touch devices also skip SSAO and cap pixel ratio at 1.5 for perf. Test touch mode on desktop with `?touch=1`.

## PWA & deployment

The game ships as an installable PWA (built for "Add to Home Screen" on iPad): `public/manifest.webmanifest`, `public/sw.js` (network-first navigations, cache-first assets — fully offline after one online session), `apple-touch-icon.png`/`icon.svg`, and iOS meta in `index.html`. The SW registers in production only (`import.meta.env.PROD`) so it never fights dev HMR. `vite.config.ts` sets `base: './'` — required for GitHub Pages project sites; keep asset URLs relative. Deploys run via `.github/workflows/deploy.yml` (GitHub Actions → GitHub Pages) on every push to `main`.

### Conventions worth keeping

- One frame loop, owned by `Game`. Systems expose `update(dt, ...)` and report back up (an enemy returns whether it's in contact; `Game` decides its target and applies damage) rather than mutating each other directly.
- **Every shootable enemy shares one structural contract and tags its root group with `userData.monster = this`** — `Game.shoot()` raycasts one merged list and walks up from any child mesh to the owner. Follow both patterns for any new enemy so it drops into `[...monsters, ...eagles]` and the shoot path for free.
- Systems that need the world (terrain height, pond, brick AABBs, perches, grip) get it **injected** from `Game` — they don't reach into level internals. Keep new systems decoupled the same way.
- Entities created/destroyed at runtime (`Monster`, `Eagle`, `Building`) own a `dispose(scene)` that removes the mesh and frees geometry/material — call it in `Game.restart()`. Do **not** dispose shared cached textures from `textures.ts` there.
- **New levels**: write `buildX(scene): LevelHandle` in its own file, parent everything to one group, set the atmosphere on the scene, and add an entry to `LEVELS` in `level.ts` — the level select, victory progression, `?level=` param, and teardown all pick it up from the registry. Bump the `CACHE` version in `public/sw.js` when shipping content changes so installed PWAs refresh.
- Keep all tunable numbers in `config.ts`; avoid magic numbers in systems. (Purely visual palette/animation constants live as module-level `const`s at the top of each entity file.)
