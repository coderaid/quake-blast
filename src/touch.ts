/**
 * Touch controls for tablets/phones (built for iPad Safari, where there is no
 * keyboard, mouse, or pointer lock): a floating virtual joystick on the left
 * half of the screen for movement, drag-to-look on the right half, and FIRE /
 * JUMP buttons. Like the Hud this is a DOM/CSS overlay, not WebGL.
 *
 * The class only OWNS the DOM + gesture state; it reports intent outward the
 * same way other systems do — Player reads `moveX`/`moveY`/`jumpHeld` each
 * frame, Game polls `fireHeld` (hold-to-autofire) and gets `onFire` presses
 * (single build placements), and look drags call back into `onLook`.
 */

const STICK_RADIUS = 48; // px the knob can travel from the stick base center
const LOOK_SENSITIVITY = 1; // px of drag are passed through raw; Player scales to radians

export interface TouchHooks {
  onLook: (dx: number, dy: number) => void; // pixel deltas from the look-drag zone
  onFire: () => void; // one call per FIRE press (Game routes: build=place, assault=shoot)
}

/** True on touch-first devices (iPad/phone) — or with ?touch=1 for desktop testing. */
export function isTouchDevice(): boolean {
  return (
    new URLSearchParams(window.location.search).has('touch') ||
    (navigator.maxTouchPoints ?? 0) > 0 ||
    window.matchMedia('(pointer: coarse)').matches
  );
}

export class TouchControls {
  /** Analog movement, -1..1: x = strafe right, y = forward. Read by Player. */
  moveX = 0;
  moveY = 0;
  jumpHeld = false;
  fireHeld = false;

  private stickPointer: number | null = null;
  private lookPointer: number | null = null;
  private baseX = 0;
  private baseY = 0;
  private lastLookX = 0;
  private lastLookY = 0;

  private baseEl: HTMLElement;
  private knobEl: HTMLElement;

  constructor(root: HTMLElement, private hooks: TouchHooks) {
    root.insertAdjacentHTML(
      'beforeend',
      `
      <div id="touch-ui">
        <div id="ts-move"></div>
        <div id="ts-look"></div>
        <div id="ts-base"><div id="ts-knob"></div></div>
        <button id="ts-jump">JUMP</button>
        <button id="ts-fire">FIRE</button>
      </div>
      <style>
        #touch-ui, #touch-ui * {
          -webkit-user-select: none; user-select: none; -webkit-touch-callout: none;
        }
        #ts-move { position: fixed; left: 0; top: 0; bottom: 0; width: 45%; touch-action: none; z-index: 5; }
        #ts-look { position: fixed; right: 0; top: 0; bottom: 0; width: 55%; touch-action: none; z-index: 4; }
        #ts-base {
          position: fixed; width: 112px; height: 112px; margin: -56px 0 0 -56px;
          border: 2px solid rgba(255,255,255,0.5); border-radius: 50%;
          background: rgba(255,255,255,0.08); display: none; pointer-events: none; z-index: 6;
        }
        #ts-knob {
          position: absolute; left: 50%; top: 50%; width: 52px; height: 52px; margin: -26px 0 0 -26px;
          border-radius: 50%; background: rgba(255,255,255,0.55); box-shadow: 0 2px 8px rgba(0,0,0,0.4);
        }
        #ts-fire, #ts-jump {
          position: fixed; border-radius: 50%; touch-action: none; z-index: 7;
          border: 2px solid rgba(255,255,255,0.6); color: #fff;
          font: 700 15px/1 monospace; letter-spacing: 1px;
          text-shadow: 0 1px 3px #000; -webkit-tap-highlight-color: transparent;
        }
        #ts-fire {
          right: calc(22px + env(safe-area-inset-right)); bottom: calc(30px + env(safe-area-inset-bottom));
          width: 92px; height: 92px; background: rgba(255,90,40,0.45);
        }
        #ts-fire:active { background: rgba(255,120,60,0.75); }
        #ts-jump {
          right: calc(44px + env(safe-area-inset-right)); bottom: calc(140px + env(safe-area-inset-bottom));
          width: 66px; height: 66px; font-size: 12px; background: rgba(120,180,255,0.35);
        }
        #ts-jump:active { background: rgba(150,200,255,0.65); }
      </style>
    `
    );

    this.baseEl = root.querySelector('#ts-base')!;
    this.knobEl = root.querySelector('#ts-knob')!;
    this.wireStick(root.querySelector('#ts-move')!);
    this.wireLook(root.querySelector('#ts-look')!);
    this.wireButton(root.querySelector('#ts-fire')!, (held) => {
      this.fireHeld = held;
      if (held) this.hooks.onFire();
    });
    this.wireButton(root.querySelector('#ts-jump')!, (held) => (this.jumpHeld = held));
  }

  /** Capture may throw for pointers the browser no longer tracks — never fatal. */
  private capture(el: HTMLElement, pointerId: number): void {
    try {
      el.setPointerCapture(pointerId);
    } catch {
      /* keep zone-scoped events only */
    }
  }

  /** Floating joystick: the base appears wherever the thumb lands in the zone. */
  private wireStick(zone: HTMLElement): void {
    zone.addEventListener('pointerdown', (e) => {
      if (this.stickPointer !== null) return;
      e.preventDefault();
      this.stickPointer = e.pointerId;
      this.capture(zone, e.pointerId);
      this.baseX = e.clientX;
      this.baseY = e.clientY;
      this.baseEl.style.left = `${this.baseX}px`;
      this.baseEl.style.top = `${this.baseY}px`;
      this.baseEl.style.display = 'block';
      this.moveKnob(0, 0);
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stickPointer) return;
      let dx = e.clientX - this.baseX;
      let dy = e.clientY - this.baseY;
      const len = Math.hypot(dx, dy);
      if (len > STICK_RADIUS) {
        dx *= STICK_RADIUS / len;
        dy *= STICK_RADIUS / len;
      }
      this.moveKnob(dx, dy);
      this.moveX = dx / STICK_RADIUS;
      this.moveY = -dy / STICK_RADIUS; // screen-up = forward
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.stickPointer) return;
      this.stickPointer = null;
      this.moveX = 0;
      this.moveY = 0;
      this.baseEl.style.display = 'none';
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  }

  private moveKnob(dx: number, dy: number): void {
    this.knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  /** Drag anywhere on the right side to look; deltas stream to the hook. */
  private wireLook(zone: HTMLElement): void {
    zone.addEventListener('pointerdown', (e) => {
      if (this.lookPointer !== null) return;
      e.preventDefault();
      this.lookPointer = e.pointerId;
      this.capture(zone, e.pointerId);
      this.lastLookX = e.clientX;
      this.lastLookY = e.clientY;
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.lookPointer) return;
      const dx = (e.clientX - this.lastLookX) * LOOK_SENSITIVITY;
      const dy = (e.clientY - this.lastLookY) * LOOK_SENSITIVITY;
      this.lastLookX = e.clientX;
      this.lastLookY = e.clientY;
      this.hooks.onLook(dx, dy);
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId === this.lookPointer) this.lookPointer = null;
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  }

  private wireButton(el: HTMLElement, set: (held: boolean) => void): void {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.capture(el, e.pointerId);
      set(true);
    });
    const off = () => set(false);
    el.addEventListener('pointerup', off);
    el.addEventListener('pointercancel', off);
  }
}
