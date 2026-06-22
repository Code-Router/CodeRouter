/**
 * Image detection and encoding for vision-aware routing.
 *
 * Scans a user prompt for references to image files (paths ending in
 * .png/.jpg/.jpeg/.gif/.webp), validates they exist on disk, and
 * provides helpers to convert them to base64 data URLs for the
 * OpenAI-compatible multimodal content block format.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, isAbsolute, resolve } from 'node:path';

const IMAGE_EXTS = /\.(png|jpe?g|gif|webp)$/i;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB

const MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

export function imageMimeFromPath(p: string): string {
  const ext = p.slice(p.lastIndexOf('.')).toLowerCase();
  return MIME_MAP[ext] ?? 'application/octet-stream';
}

/**
 * Convert an image file to a base64 data URL suitable for the
 * OpenAI `image_url` content block. Returns null if the file is
 * too large or unreadable.
 */
export function imageToDataUrl(absPath: string): string | null {
  try {
    const stat = statSync(absPath);
    if (stat.size > MAX_IMAGE_BYTES) return null;
    const buf = readFileSync(absPath);
    const mime = imageMimeFromPath(absPath);
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

/**
 * Detect image file paths referenced in the user's prompt.
 *
 * Strategy (applied in order, results deduped):
 *   1. Quoted paths: `"path/to/img.png"` or `'path/to/img.png'`
 *   2. Whitespace-free tokens ending in an image extension
 *   3. Greedy fallback for paths with spaces (macOS screenshots):
 *      find any substring ending at an image extension, trim leading
 *      words until existsSync succeeds.
 *
 * Only paths that actually exist on disk are returned (absolute).
 */
export function detectPromptImages(prompt: string, cwd: string): string[] {
  const found = new Set<string>();

  const tryAdd = (raw: string): void => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    const abs = isAbsolute(trimmed) ? trimmed : resolve(cwd, trimmed);
    if (found.has(abs)) return;
    try {
      if (existsSync(abs) && statSync(abs).isFile()) {
        found.add(abs);
      }
    } catch {
      // ignore
    }
  };

  // 1. Quoted paths
  const quotedRe = /["']([^"']*?\.(png|jpe?g|gif|webp))["']/gi;
  for (const m of prompt.matchAll(quotedRe)) {
    tryAdd(m[1]!);
  }

  // 2. Whitespace-free tokens
  const tokens = prompt.split(/\s+/);
  for (const tok of tokens) {
    if (IMAGE_EXTS.test(tok)) {
      // Strip surrounding quotes/punctuation
      const cleaned = tok.replace(/^["']+|["']+$/g, '');
      tryAdd(cleaned);
    }
  }

  // 3. Greedy fallback for paths with spaces (e.g. macOS screenshots)
  //    Find all occurrences of text ending at an image extension boundary.
  const greedyRe = /\S[^\n]*?\.(png|jpe?g|gif|webp)\b/gi;
  for (const m of prompt.matchAll(greedyRe)) {
    const candidate = m[0];
    // Trim leading words until the path resolves.
    const words = candidate.split(/\s+/);
    for (let start = 0; start < words.length; start++) {
      const attempt = words.slice(start).join(' ');
      if (!IMAGE_EXTS.test(attempt)) break;
      const abs = isAbsolute(attempt) ? attempt : resolve(cwd, attempt);
      if (found.has(abs)) break;
      try {
        if (existsSync(abs) && statSync(abs).isFile()) {
          found.add(abs);
          break;
        }
      } catch {
        // try shorter
      }
    }
  }

  return [...found];
}

/**
 * Strip the directory from the path for compact display/placeholder.
 */
export function imageBasename(absPath: string): string {
  return basename(absPath);
}
