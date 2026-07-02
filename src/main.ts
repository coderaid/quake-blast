/// <reference types="vite/client" />
import { Game } from './game';

const root = document.getElementById('app');
if (!root) throw new Error('#app root element not found');

const game = new Game(root);
game.start();

// Offline/PWA support (production only — caching fights the dev server's HMR).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* offline support is best-effort; the game still runs without it */
    });
  });
}
