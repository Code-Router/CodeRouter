/**
 * CodeRouter brand kit: pixel-block ASCII wordmark + variants.
 *
 * Rendered with kleur (no hard dependency on truecolor support; falls
 * back to bright green on 16-color terminals).
 */

export const WORDMARK_PIXEL = String.raw`
  ██████╗  ██████╗ ██████╗ ███████╗    ██████╗  ██████╗ ██╗   ██╗████████╗███████╗██████╗
 ██╔════╝ ██╔═══██╗██╔══██╗██╔════╝    ██╔══██╗██╔═══██╗██║   ██║╚══██╔══╝██╔════╝██╔══██╗
 ██║      ██║   ██║██║  ██║█████╗      ██████╔╝██║   ██║██║   ██║   ██║   █████╗  ██████╔╝
 ██║      ██║   ██║██║  ██║██╔══╝      ██╔══██╗██║   ██║██║   ██║   ██║   ██╔══╝  ██╔══██╗
 ╚██████╗ ╚██████╔╝██████╔╝███████╗    ██║  ██║╚██████╔╝╚██████╔╝   ██║   ███████╗██║  ██║
  ╚═════╝  ╚═════╝ ╚═════╝ ╚══════╝    ╚═╝  ╚═╝ ╚═════╝  ╚═════╝    ╚═╝   ╚══════╝╚═╝  ╚═╝
`.trimEnd();

export const WORDMARK_SMALL = String.raw`
  ╔═╗╔═╗╔╦╗╔═╗  ╦═╗╔═╗╦ ╦╔╦╗╔═╗╦═╗
  ║  ║ ║ ║║║╣   ╠╦╝║ ║║ ║ ║ ║╣ ╠╦╝
  ╚═╝╚═╝═╩╝╚═╝  ╩╚═╚═╝╚═╝ ╩ ╚═╝╩╚═
`.trimEnd();

export const WORDMARK_TAGLINE = 'route smarter. build faster.';

/** Used in headers and prompt-line prefixes. */
export const BRAND_GLYPH = '◢◤';
export const BRAND_NAME = 'CodeRouter';
export const BRAND_NAME_LOWER = 'coderouter';

/** Default symbol palette - kept ASCII-portable. */
export const SYMBOLS = {
  thinking: '✱',
  routed: '▸',
  success: '✓',
  failed: '✗',
  warn: '!',
  bullet: '•',
  arrow: '→',
  spinner: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
} as const;

export const COLORS = {
  primary: '#39d353',
  primaryDim: '#1a7f37',
  warn: '#facc15',
  err: '#f87171',
  muted: '#6e7681',
} as const;
