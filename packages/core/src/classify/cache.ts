import type { Classification } from '../types.js';

export type ClassifierCache = {
  get: (hash: string) => Classification | undefined;
  set: (hash: string, value: Classification) => void;
};

/** Simple in-memory LRU. Replaced by a SQLite-backed cache in the store layer. */
export class MemoryClassifierCache implements ClassifierCache {
  private readonly map = new Map<string, Classification>();
  constructor(private readonly cap: number = 1024) {}

  get(hash: string): Classification | undefined {
    const v = this.map.get(hash);
    if (!v) return undefined;
    this.map.delete(hash);
    this.map.set(hash, v);
    return { ...v, source: 'cache' };
  }

  set(hash: string, value: Classification): void {
    if (this.map.size >= this.cap) {
      const first = this.map.keys().next().value;
      if (first !== undefined) this.map.delete(first);
    }
    this.map.set(hash, value);
  }
}
