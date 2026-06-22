import { randomUUID } from 'node:crypto';
import type { Store } from '../store/index.js';
import type { LoopRunContext } from './context.js';
import { generateLoopSpec, type GenerateOptions } from './generate.js';
import { approveLoopWorktree, discardLoopWorktree, runLoop } from './runner.js';
import type {
  LoopEvent,
  LoopPreset,
  LoopRecord,
  LoopSpec,
  LoopStatus,
  LoopValidation,
  LoopWorktree,
} from './types.js';
import { validateLoopSpec } from './validate.js';

/**
 * Loop supervisor.
 *
 * Owns the lifecycle of every loop: generates specs, persists records +
 * iterations to the project store, runs loops (one worker per loop),
 * streams live events to subscribers (the daemon's SSE hub), and exposes
 * pause / resume / stop / approve / reject controls.
 */

export type SupervisorDeps = {
  /** Build the execution context (registry + router) for a project cwd. */
  contextFactory: (cwd: string) => Promise<LoopRunContext>;
  /** Open (or reuse) the project-scoped store for a cwd. */
  storeFor: (cwd: string) => Promise<Store>;
};

type Active = {
  controller: AbortController;
  pauseRequested: boolean;
  stopRequested: boolean;
};

type Listener = (e: LoopEvent) => void;

export class LoopSupervisor {
  private readonly active = new Map<string, Active>();
  private readonly awaiting = new Map<string, LoopWorktree>();
  private readonly listeners = new Set<Listener>();

  constructor(private readonly deps: SupervisorDeps) {}

  // ---- events ------------------------------------------------------

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(e: LoopEvent): void {
    for (const l of this.listeners) {
      try {
        l(e);
      } catch {
        // never let a bad subscriber break the loop
      }
    }
  }

  // ---- generation --------------------------------------------------

  /** Generate + validate a spec and persist it as a draft loop. */
  async create(
    cwd: string,
    request: string,
    opts: GenerateOptions & { preset?: LoopPreset } = {},
  ): Promise<{ record: LoopRecord; validation: LoopValidation; generated: boolean }> {
    const ctx = await this.deps.contextFactory(cwd);
    const { spec, generated } = await generateLoopSpec(request, ctx, opts);
    const validation = validateLoopSpec(spec);
    const record = this.persistNew(await this.deps.storeFor(cwd), cwd, spec, request);
    return { record, validation, generated };
  }

  /** Persist a user-edited / preset spec directly as a draft. */
  async createFromSpec(cwd: string, spec: LoopSpec): Promise<{ record: LoopRecord; validation: LoopValidation }> {
    const validation = validateLoopSpec(spec);
    const record = this.persistNew(await this.deps.storeFor(cwd), cwd, spec, spec.goal);
    return { record, validation };
  }

  /** Replace the spec of an existing draft loop (from the spec editor). */
  async updateSpec(loopId: string, cwd: string, spec: LoopSpec): Promise<LoopRecord | undefined> {
    const store = await this.deps.storeFor(cwd);
    const rec = store.loops.get(loopId);
    if (!rec) return undefined;
    const next: LoopRecord = { ...rec, spec, name: spec.name || rec.name, goal: spec.goal || rec.goal, updatedAt: Date.now() };
    store.loops.update(next);
    return next;
  }

  private persistNew(store: Store, cwd: string, spec: LoopSpec, goal: string): LoopRecord {
    const now = Date.now();
    const record: LoopRecord = {
      id: randomUUID(),
      name: spec.name || 'coderouter-loop',
      goal: spec.goal || goal,
      cwd,
      status: 'draft',
      spec,
      iterationsDone: 0,
      costUsd: 0,
      filesChanged: [],
      lastDiff: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    };
    store.loops.insert(record);
    return record;
  }

  // ---- queries -----------------------------------------------------

  async get(cwd: string, loopId: string): Promise<LoopRecord | undefined> {
    return (await this.deps.storeFor(cwd)).loops.get(loopId);
  }

  async list(cwd: string): Promise<LoopRecord[]> {
    return (await this.deps.storeFor(cwd)).loops.list();
  }

  async iterations(cwd: string, loopId: string) {
    return (await this.deps.storeFor(cwd)).loops.iterations(loopId);
  }

  isRunning(loopId: string): boolean {
    return this.active.has(loopId);
  }

  // ---- lifecycle ---------------------------------------------------

  /** Start (or restart) a loop. Runs in the background; returns immediately. */
  async start(cwd: string, loopId: string): Promise<void> {
    if (this.active.has(loopId)) return; // already running
    const store = await this.deps.storeFor(cwd);
    const rec = store.loops.get(loopId);
    if (!rec) throw new Error(`loop ${loopId} not found`);
    const validation = validateLoopSpec(rec.spec);
    if (!validation.valid) {
      throw new Error(`loop is not valid: ${validation.issues.join('; ')}`);
    }
    void this.run(cwd, rec);
  }

  pause(loopId: string): void {
    const a = this.active.get(loopId);
    if (a) {
      a.pauseRequested = true;
      a.controller.abort();
    }
  }

  stop(loopId: string): void {
    const a = this.active.get(loopId);
    if (a) {
      a.stopRequested = true;
      a.controller.abort();
    }
  }

  async resume(cwd: string, loopId: string): Promise<void> {
    return this.start(cwd, loopId);
  }

  /** Approve a loop awaiting commit approval: merge its worktree. */
  async approve(cwd: string, loopId: string): Promise<{ applied: boolean; error?: string }> {
    const store = await this.deps.storeFor(cwd);
    const wt = this.awaiting.get(loopId);
    if (!wt) return { applied: false, error: 'no pending changes to approve' };
    const res = await approveLoopWorktree(wt);
    this.awaiting.delete(loopId);
    const rec = store.loops.get(loopId);
    if (rec) {
      store.loops.update({ ...rec, status: res.applied ? 'succeeded' : 'failed', error: res.error ?? null });
      this.emit({ type: 'status', loopId, status: res.applied ? 'succeeded' : 'failed', at: Date.now() });
    }
    return res;
  }

  /** Reject a loop awaiting approval: discard its worktree. */
  async reject(cwd: string, loopId: string): Promise<void> {
    const wt = this.awaiting.get(loopId);
    if (wt) await discardLoopWorktree(wt);
    this.awaiting.delete(loopId);
    const store = await this.deps.storeFor(cwd);
    const rec = store.loops.get(loopId);
    if (rec) {
      store.loops.update({ ...rec, status: 'stopped', error: 'changes rejected' });
      this.emit({ type: 'status', loopId, status: 'stopped', at: Date.now() });
    }
  }

  async deleteLoop(cwd: string, loopId: string): Promise<void> {
    this.stop(loopId);
    const wt = this.awaiting.get(loopId);
    if (wt) await discardLoopWorktree(wt);
    this.awaiting.delete(loopId);
    (await this.deps.storeFor(cwd)).loops.delete(loopId);
  }

  // ---- the worker --------------------------------------------------

  private async run(cwd: string, rec: LoopRecord): Promise<void> {
    const controller = new AbortController();
    const entry: Active = { controller, pauseRequested: false, stopRequested: false };
    this.active.set(rec.id, entry);

    const store = await this.deps.storeFor(cwd);
    const setStatus = (status: LoopStatus): void => {
      store.loops.setStatus(rec.id, status);
      this.emit({ type: 'status', loopId: rec.id, status, at: Date.now() });
    };
    setStatus('running');

    let ctx: LoopRunContext;
    try {
      ctx = await this.deps.contextFactory(cwd);
    } catch (e) {
      this.active.delete(rec.id);
      store.loops.update({ ...rec, status: 'failed', error: (e as Error).message });
      this.emit({ type: 'error', loopId: rec.id, message: (e as Error).message, at: Date.now() });
      this.emit({ type: 'status', loopId: rec.id, status: 'failed', at: Date.now() });
      return;
    }

    try {
      const result = await runLoop(rec.spec, ctx, {
        loopId: rec.id,
        signal: controller.signal,
        shouldStop: () => entry.pauseRequested || entry.stopRequested,
        callbacks: {
          onPhase: (index, phase, message) =>
            this.emit({ type: 'phase', loopId: rec.id, index, phase, message, at: Date.now() }),
          onChunk: (index, text) => this.emit({ type: 'chunk', loopId: rec.id, index, text, at: Date.now() }),
          onVerifier: (index, result) =>
            this.emit({ type: 'verifier', loopId: rec.id, index, result, at: Date.now() }),
          onIteration: (it) => {
            try {
              store.loops.insertIteration(it);
            } catch {
              // best-effort
            }
            this.emit({ type: 'iteration', loopId: rec.id, iteration: it, at: Date.now() });
          },
        },
      });

      // Map runner result -> loop status (honoring pause/stop intent).
      let status: LoopStatus;
      if (entry.stopRequested) status = 'stopped';
      else if (entry.pauseRequested) status = 'paused';
      else if (result.status === 'awaiting_approval') status = 'awaiting_approval';
      else if (result.status === 'succeeded') status = 'succeeded';
      else if (result.status === 'stopped') status = 'stopped';
      else status = 'failed';

      if (result.worktree) this.awaiting.set(rec.id, result.worktree);

      const updated: LoopRecord = {
        ...rec,
        status,
        iterationsDone: result.iterations.length,
        costUsd: result.costUsd,
        filesChanged: result.filesChanged,
        lastDiff: result.diff,
        error: status === 'failed' ? result.reason : null,
        updatedAt: Date.now(),
      };
      store.loops.update(updated);
      this.emit({ type: 'status', loopId: rec.id, status, at: Date.now() });
      this.emit({ type: 'done', loopId: rec.id, status, record: updated, at: Date.now() });
    } catch (e) {
      store.loops.update({ ...rec, status: 'failed', error: (e as Error).message, updatedAt: Date.now() });
      this.emit({ type: 'error', loopId: rec.id, message: (e as Error).message, at: Date.now() });
      this.emit({ type: 'status', loopId: rec.id, status: 'failed', at: Date.now() });
    } finally {
      this.active.delete(rec.id);
    }
  }
}
