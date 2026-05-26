import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/runner.ts'],
  format: ['esm'],
  dts: false,
  splitting: false,
  sourcemap: true,
  clean: true,
  target: 'node20',
  platform: 'node',
  shims: false,
  external: ['@coderouter/core', 'better-sqlite3'],
});
