// `__CLI_VERSION__` is injected by tsup at build time from package.json
// (see tsup.config.ts `define`). In dev runs (tsx, no bundling) the token
// is undefined, so we fall back to a sentinel.
declare const __CLI_VERSION__: string | undefined;

export const CLI_VERSION: string =
  typeof __CLI_VERSION__ === 'string' ? __CLI_VERSION__ : '0.0.0-dev';
