import { defineConfig } from 'tsup';

// Compile the Electron main + preload to CommonJS (Electron's main
// process runs CJS). `electron` is provided by the runtime.
export default defineConfig({
  entry: { main: 'electron/main.ts', preload: 'electron/preload.ts' },
  outDir: 'dist-electron',
  format: ['cjs'],
  platform: 'node',
  target: 'node20',
  clean: true,
  external: ['electron'],
});
