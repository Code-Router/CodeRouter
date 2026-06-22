import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectPromptImages, imageMimeFromPath, imageToDataUrl } from './images.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cr-img-'));
  await writeFile(join(dir, 'screenshot.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  await writeFile(join(dir, 'photo.jpg'), Buffer.from([0xff, 0xd8, 0xff]));
  await writeFile(join(dir, 'diagram.webp'), Buffer.alloc(16));
  await writeFile(join(dir, 'Screenshot 2026-06-07 at 10.30.00 AM.png'), Buffer.alloc(8));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('imageMimeFromPath', () => {
  it('returns correct MIME for known extensions', () => {
    expect(imageMimeFromPath('/foo/bar.png')).toBe('image/png');
    expect(imageMimeFromPath('/foo/bar.jpg')).toBe('image/jpeg');
    expect(imageMimeFromPath('/foo/bar.jpeg')).toBe('image/jpeg');
    expect(imageMimeFromPath('/foo/bar.gif')).toBe('image/gif');
    expect(imageMimeFromPath('/foo/bar.webp')).toBe('image/webp');
  });

  it('is case insensitive', () => {
    expect(imageMimeFromPath('/foo/bar.PNG')).toBe('image/png');
    expect(imageMimeFromPath('/foo/bar.JPG')).toBe('image/jpeg');
  });

  it('returns octet-stream for unknown', () => {
    expect(imageMimeFromPath('/foo/bar.bmp')).toBe('application/octet-stream');
  });
});

describe('imageToDataUrl', () => {
  it('converts a small image to base64 data URL', () => {
    const url = imageToDataUrl(join(dir, 'screenshot.png'));
    expect(url).toMatch(/^data:image\/png;base64,/);
  });

  it('returns null for non-existent file', () => {
    expect(imageToDataUrl(join(dir, 'nope.png'))).toBeNull();
  });

  it('returns null for files over 5MB', async () => {
    const bigPath = join(dir, 'huge.png');
    await writeFile(bigPath, Buffer.alloc(6 * 1024 * 1024));
    expect(imageToDataUrl(bigPath)).toBeNull();
  });
});

describe('detectPromptImages', () => {
  it('detects a simple unquoted path', () => {
    const result = detectPromptImages(`look at ${join(dir, 'screenshot.png')}`, dir);
    expect(result).toContain(join(dir, 'screenshot.png'));
  });

  it('detects a quoted path', () => {
    const result = detectPromptImages(`look at "${join(dir, 'photo.jpg')}"`, dir);
    expect(result).toContain(join(dir, 'photo.jpg'));
  });

  it('resolves relative paths against cwd', () => {
    const result = detectPromptImages('look at screenshot.png', dir);
    expect(result).toContain(join(dir, 'screenshot.png'));
  });

  it('ignores non-existent image paths', () => {
    const result = detectPromptImages('look at nonexistent.png', dir);
    expect(result).toHaveLength(0);
  });

  it('deduplicates results', () => {
    const prompt = `look at screenshot.png and also screenshot.png`;
    const result = detectPromptImages(prompt, dir);
    const pngCount = result.filter((p) => p.endsWith('screenshot.png'));
    expect(pngCount).toHaveLength(1);
  });

  it('detects paths with spaces via greedy fallback', () => {
    const result = detectPromptImages(
      `check this Screenshot 2026-06-07 at 10.30.00 AM.png please`,
      dir,
    );
    expect(result).toContain(join(dir, 'Screenshot 2026-06-07 at 10.30.00 AM.png'));
  });

  it('handles multiple images in one prompt', () => {
    const prompt = `compare screenshot.png and photo.jpg`;
    const result = detectPromptImages(prompt, dir);
    expect(result.length).toBe(2);
    expect(result).toContain(join(dir, 'screenshot.png'));
    expect(result).toContain(join(dir, 'photo.jpg'));
  });
});
