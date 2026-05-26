import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  dts: false,
  splitting: false,
  sourcemap: true,
  clean: true,
  target: 'node20',
  platform: 'node',
  shims: false,
  banner: { js: '#!/usr/bin/env node' },
  external: [
    '@coderouter/core',
    'better-sqlite3',
    'ink',
    'react',
  ],
});
