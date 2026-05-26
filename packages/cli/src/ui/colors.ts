import kleur from 'kleur';
import { COLORS } from '../branding/index.js';

/**
 * Thin wrappers so the rest of the CLI never imports kleur directly.
 * Keeps the brand palette consistent across panels.
 */

export const c = {
  primary: (s: string) => kleur.green().bold(s),
  primaryDim: (s: string) => kleur.green(s),
  warn: (s: string) => kleur.yellow(s),
  err: (s: string) => kleur.red().bold(s),
  muted: (s: string) => kleur.gray(s),
  bold: (s: string) => kleur.bold(s),
  underline: (s: string) => kleur.underline(s),
  dim: (s: string) => kleur.dim(s),
} as const;

export { COLORS };
