# Quake Blast

A web-first, multi-platform **wave-defense FPS** built with **Three.js + TypeScript** (bundled by Vite). Runs in any modern browser — no install, multi-platform by default — with a path to native desktop/mobile via Electron/Capacitor later.

> **Build, then defend.** Place your bases during the build-phase countdown. When it expires, a wave of quake monsters storms the arena and attacks your bases. Shoot them down and keep your bases standing to win.

## Play

```bash
npm install
npm run dev
```

Open http://localhost:5173, **click to lock the mouse**, and play.

| Control | Action |
| --- | --- |
| `W` `A` `S` `D` | Move |
| Mouse | Look |
| Left click | **Build phase:** place a base · **Assault:** shoot |
| `Esc` | Release mouse |

Place your bases before the countdown ends, then gun down the wave. Survive with at least one base standing to win.

## Develop

```bash
npm run typecheck   # tsc --noEmit (strict)
npm run build       # typecheck + production bundle to dist/
npm run preview     # serve the built bundle
```

All gameplay tuning lives in [`src/config.ts`](src/config.ts). See [CLAUDE.md](CLAUDE.md) for the full architecture overview.

## Roadmap ideas

- Multiple waves of increasing difficulty between build phases
- Base variety (turrets that auto-fire, walls, resource generators)
- Smarter monster AI (pathfinding around bases, ranged attackers)
- Weapon variety + ammo, and base-repair between waves
- Multiplayer co-op defense (WebSocket/WebRTC)
- Native packaging (Electron desktop, Capacitor mobile)
