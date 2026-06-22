import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Renderer build. Output to dist/ which Electron loads from file:// in
// production; in dev the renderer is served by the Vite dev server and
// Electron loads VITE_DEV_SERVER_URL.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5273,
    strictPort: false,
  },
});
