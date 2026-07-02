import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build works from any subpath — required for GitHub
  // Pages project sites (https://<user>.github.io/quake-blast/).
  base: './',
});
