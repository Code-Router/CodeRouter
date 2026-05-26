import { BRAND_GLYPH, BRAND_NAME, WORDMARK_PIXEL, WORDMARK_SMALL, WORDMARK_TAGLINE } from '../branding/index.js';
import { c } from './colors.js';

/**
 * Banner shown at REPL start and after `coderouter init`.
 * Picks the wordmark variant by terminal width so it never wraps.
 */
export function renderBanner(): string {
  const width = process.stdout.columns ?? 80;
  const lines: string[] = [];
  if (width >= 96) {
    for (const line of WORDMARK_PIXEL.split('\n')) lines.push(c.primary(line));
  } else if (width >= 40) {
    for (const line of WORDMARK_SMALL.split('\n')) lines.push(c.primary(line));
  } else {
    lines.push(`${c.primary(BRAND_GLYPH)} ${c.bold(BRAND_NAME)}`);
  }
  lines.push('');
  lines.push(`  ${c.primaryDim(BRAND_GLYPH)}  ${c.muted(WORDMARK_TAGLINE)}`);
  lines.push('');
  return lines.join('\n');
}

export function renderPromptPrefix(): string {
  return c.primary(`${BRAND_GLYPH} `);
}
