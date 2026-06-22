import {
  LoopSupervisor,
  openStore,
  resolveDbPath,
  type LoopRunContext,
  type Store,
} from '@coderouter/core';
import { buildExecutionEnv } from '../runtime.js';

/**
 * Process-wide singleton LoopSupervisor for the daemon. Builds the same
 * registry/router wiring as interactive runs (so loops route identically)
 * and caches one sqlite store per project cwd.
 */

const storeCache = new Map<string, Promise<Store>>();

function storeFor(cwd: string): Promise<Store> {
  let p = storeCache.get(cwd);
  if (!p) {
    p = openStore(resolveDbPath(cwd));
    storeCache.set(cwd, p);
  }
  return p;
}

async function contextFactory(cwd: string): Promise<LoopRunContext> {
  const { registry, router } = await buildExecutionEnv(cwd);
  return { registry, router, cwd };
}

let singleton: LoopSupervisor | null = null;

export function getSupervisor(): LoopSupervisor {
  if (!singleton) {
    singleton = new LoopSupervisor({ contextFactory, storeFor });
  }
  return singleton;
}

export { storeFor };
