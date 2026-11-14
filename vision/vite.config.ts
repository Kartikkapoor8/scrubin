import { defineConfig } from 'vite';

// The app is served by server/index.mjs (which mounts Vite in middleware mode for `npm run dev`),
// so there is no separate Vite port to think about.
export default defineConfig({
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 1500 },
});
