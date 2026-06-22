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
  shims: true,
  // We bundle CJS deps (commander, etc.) into an ESM output. Those
  // call `require(...)` for Node built-ins, which ESM has no ambient
  // `require` for - so define one via createRequire. Without this the
  // bundled CLI throws `Dynamic require of "events" is not supported`.
  banner: {
    js: [
      '#!/usr/bin/env node',
      "import { createRequire as __crCreateRequire } from 'node:module';",
      'const require = __crCreateRequire(import.meta.url);',
    ].join('\n'),
  },
  // Bundle our own code (including @coderouter/core) into a single
  // self-contained cli.js so the published package has no private
  // workspace dependency. Only true runtime deps that either can't be
  // bundled or must be resolved at runtime stay external + declared in
  // package.json `dependencies`:
  //   - ink / react: the TUI renderer (kept external to avoid React
  //     duplication issues when bundling).
  //   - @vscode/ripgrep: ships a per-platform `rg` binary launched as a
  //     subprocess via its `rgPath`, so it must live in node_modules.
  external: ['ink', 'react', '@vscode/ripgrep'],
});
