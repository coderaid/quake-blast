/**
 * DOM-based heads-up display: crosshair, a top status banner (phase + timer or
 * monsters-left), bottom stats (HP / bases), damage flash, and the
 * click-to-play / victory / defeat overlays. Kept out of the WebGL canvas so
 * it's cheap and easy to restyle.
 *
 * The start overlay carries a level-select row (one button per level); the
 * victory overlay advances to the next level. Both resolve through the two
 * callbacks wired via onPlayClick / onLevelSelect.
 */
export interface HudState {
  phase: 'build' | 'assault' | 'won' | 'lost';
  timeLeft: number; // build phase seconds remaining
  budget: number; // bases left to place
  health: number;
  basesAlive: number;
  basesTotal: number;
  monstersLeft: number;
  levelName: string;
}

export class Hud {
  private bannerEl: HTMLElement;
  private subEl: HTMLElement;
  private healthEl: HTMLElement;
  private basesEl: HTMLElement;
  private overlayEl: HTMLElement;
  private damageFlash: HTMLElement;
  private playCb: (() => void) | null = null;
  private levelCb: ((index: number) => void) | null = null;

  constructor(root: HTMLElement, private isTouch = false, private levelNames: string[] = []) {
    root.insertAdjacentHTML(
      'beforeend',
      `
      <div id="crosshair"></div>
      <div id="hud-banner">
        <div id="hud-title">BUILD PHASE</div>
        <div id="hud-sub">Place your bases</div>
      </div>
      <div id="hud-stats">
        <span id="hud-health">HP 100</span>
        <span id="hud-bases">BASES 0</span>
      </div>
      <div id="hud-damage"></div>
      <div id="hud-overlay"></div>
      <style>
        #crosshair {
          position: fixed; left: 50%; top: 50%; width: 6px; height: 6px;
          margin: -3px 0 0 -3px; border: 1px solid #fff; border-radius: 50%;
          box-shadow: 0 0 4px #000; pointer-events: none;
        }
        #hud-banner {
          position: fixed; top: 18px; left: 0; right: 0; text-align: center;
          pointer-events: none; font-family: monospace; text-shadow: 0 2px 6px #000;
        }
        #hud-title { font-size: 30px; font-weight: 700; letter-spacing: 3px; color: #6cf; }
        #hud-sub { font-size: 16px; opacity: 0.85; color: #fff; margin-top: 4px; }
        #hud-stats {
          position: fixed; left: 0; bottom: 0; right: 0;
          display: flex; justify-content: space-between;
          padding: 16px 24px; font: 700 22px/1 monospace; color: #fff;
          text-shadow: 0 2px 4px #000; pointer-events: none; letter-spacing: 1px;
        }
        #hud-health { color: #6f6; }
        #hud-bases { color: #6cf; }
        #hud-damage {
          position: fixed; inset: 0; pointer-events: none; opacity: 0;
          background: radial-gradient(circle, transparent 40%, rgba(255,0,0,0.55));
          transition: opacity 0.1s ease-out;
        }
        #hud-overlay {
          position: fixed; inset: 0; z-index: 10; display: flex; flex-direction: column;
          align-items: center; justify-content: center; gap: 12px;
          background: rgba(8,8,15,0.82); color: #fff; cursor: pointer;
          font-family: system-ui, sans-serif; text-align: center;
        }
        #hud-overlay h1 { font-size: 60px; letter-spacing: 4px; }
        #hud-overlay p { font-size: 18px; opacity: 0.85; max-width: 560px; }
        #hud-overlay .cta { font-size: 22px; opacity: 1; margin-top: 16px; animation: pulse 1.2s infinite; }
        @keyframes pulse { 50% { opacity: 0.4; } }
        #hud-overlay.hidden { display: none; }
        #lvl-row { display: flex; gap: 12px; margin: 6px 0; }
        #lvl-row button {
          font: 700 16px/1 monospace; letter-spacing: 2px; padding: 12px 26px;
          background: rgba(255,255,255,0.06); color: #9cf; cursor: pointer;
          border: 1px solid #46a; border-radius: 6px;
        }
        #lvl-row button.sel { background: #1c3a5e; color: #fff; border-color: #6cf; }
      </style>
    `
    );

    this.bannerEl = root.querySelector('#hud-title')!;
    this.subEl = root.querySelector('#hud-sub')!;
    this.healthEl = root.querySelector('#hud-health')!;
    this.basesEl = root.querySelector('#hud-bases')!;
    this.overlayEl = root.querySelector('#hud-overlay')!;
    this.damageFlash = root.querySelector('#hud-damage')!;

    // One dispatcher: level buttons pick (and start) a level, anywhere else plays.
    this.overlayEl.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('button[data-lvl]') as HTMLElement | null;
      if (btn) {
        this.levelCb?.(Number(btn.dataset.lvl));
        return;
      }
      this.playCb?.();
    });

    this.showStart(0);
  }

  onPlayClick(cb: () => void): void {
    this.playCb = cb;
  }

  onLevelSelect(cb: (index: number) => void): void {
    this.levelCb = cb;
  }

  setLocked(locked: boolean): void {
    this.overlayEl.classList.toggle('hidden', locked);
  }

  update(s: HudState): void {
    if (s.phase === 'build') {
      const total = Math.max(0, Math.ceil(s.timeLeft));
      const secs = total % 60;
      const mins = Math.floor(total / 60);
      this.bannerEl.textContent = `BUILD PHASE — ${mins}:${secs.toString().padStart(2, '0')}`;
      this.bannerEl.style.color = secs <= 5 ? '#fc6' : '#6cf';
      const verb = this.isTouch ? 'tap FIRE to build' : 'click to build';
      this.subEl.textContent =
        s.budget > 0
          ? `${s.levelName} · Aim at the ground, ${verb} · ${s.budget} base${s.budget === 1 ? '' : 's'} left`
          : `${s.levelName} · All bases placed — brace for the assault!`;
    } else if (s.phase === 'assault') {
      this.bannerEl.textContent = `DEFEND! — ${s.monstersLeft} monster${s.monstersLeft === 1 ? '' : 's'} left`;
      this.bannerEl.style.color = '#f66';
      this.subEl.textContent = 'Shoot the monsters before they raze your bases';
    }

    this.healthEl.textContent = `HP ${Math.ceil(s.health)}`;
    this.healthEl.style.color = s.health > 50 ? '#6f6' : s.health > 25 ? '#fc6' : '#f55';
    this.basesEl.textContent = `BASES ${s.basesAlive}/${s.basesTotal}`;
    this.basesEl.style.color = s.basesAlive === 0 ? '#f55' : '#6cf';
  }

  flashDamage(): void {
    this.damageFlash.style.opacity = '1';
    setTimeout(() => (this.damageFlash.style.opacity = '0'), 90);
  }

  showStart(levelIndex: number): void {
    this.overlayEl.classList.remove('hidden');
    const controls = this.isTouch
      ? 'Left thumb: move · right side: drag to look · FIRE to build, then to shoot · JUMP to jump'
      : 'WASD move · SHIFT sprint · mouse look · click to build, then to shoot';
    const buttons = this.levelNames
      .map((n, i) => `<button data-lvl="${i}" class="${i === levelIndex ? 'sel' : ''}">${n}</button>`)
      .join('');
    this.overlayEl.innerHTML = `
      <h1 style="color:#6cf">Quake Blast</h1>
      <p>Build phase: place bases. Then survive the assault and keep them standing.</p>
      ${buttons ? `<div id="lvl-row">${buttons}</div>` : ''}
      <p style="opacity:0.7">${controls}</p>
      <p class="cta">${this.isTouch ? 'Tap' : 'Click'} to play</p>`;
  }

  showVictory(saved: number, total: number, nextLevelName: string | null): void {
    this.overlayEl.classList.remove('hidden');
    const perfect = saved === total;
    const cta = nextLevelName
      ? `${this.isTouch ? 'Tap' : 'Click'} for the next level — ${nextLevelName}`
      : `All levels cleared! ${this.isTouch ? 'Tap' : 'Click'} to start over`;
    this.overlayEl.innerHTML = `
      <h1 style="color:#6f6">VICTORY</h1>
      <p>${perfect ? 'Flawless — every base survived!' : `You saved ${saved} of ${total} bases.`}</p>
      <p class="cta">${cta}</p>`;
  }

  showDefeat(reason: string): void {
    this.overlayEl.classList.remove('hidden');
    this.overlayEl.innerHTML = `
      <h1 style="color:#f55">DEFEAT</h1>
      <p>${reason}</p>
      <p class="cta">${this.isTouch ? 'Tap' : 'Click'} to try again</p>`;
  }
}
