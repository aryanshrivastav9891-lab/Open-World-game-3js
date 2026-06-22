import { defineConfig } from 'vite';

// Plain Vite config — no framework plugins. Three.js is bundled from npm.
export default defineConfig({
  base: './',
  server: {
    port: 5173,
    open: true,
  },
  build: {
    target: 'es2020',
    sourcemap: true,
    chunkSizeWarningLimit: 1500,
  },
  // GLTF/DRACO/KTX2 assets (if you drop any into /src/assets) are served as-is.
  assetsInclude: ['**/*.glb', '**/*.gltf', '**/*.ktx2', '**/*.basis', '**/*.hdr'],
});
