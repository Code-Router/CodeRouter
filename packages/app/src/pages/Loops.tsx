import React, { useEffect, useState } from 'react';
import { Check, Pause, Play, Square, X } from 'lucide-react';
import type { LoopIteration, LoopRecord, LoopSpec, LoopValidation } from '@coderouter/core';
import { api, type PresetInfo, type ProjectSummary } from '../lib/api';
import { useLoopEvents } from '../lib/events';
import { EmptyState, Section, Spinner, StatusBadge, cls, money, timeAgo } from '../components/common';

type View = { kind: 'list' } | { kind: 'new' } | { kind: 'detail'; cwd: string; id: string };

export function LoopsPage({
  projects,
  project,
}: {
  projects: ProjectSummary[];
  project: string | null;
}): React.ReactElement {
  const [view, setView] = useState<View>({ kind: 'list' });

  if (view.kind === 'new')
    return (
      <NewLoop
        projects={projects}
        defaultProject={project}
        onCancel={() => setView({ kind: 'list' })}
        onOpen={(cwd, id) => setView({ kind: 'detail', cwd, id })}
      />
    );
  if (view.kind === 'detail')
    return <LoopDetail cwd={view.cwd} id={view.id} onBack={() => setView({ kind: 'list' })} />;
  return <LoopList onNew={() => setView({ kind: 'new' })} onOpen={(cwd, id) => setView({ kind: 'detail', cwd, id })} />;
}

// ---- list ----------------------------------------------------------

function LoopList({
  onNew,
  onOpen,
}: {
  onNew: () => void;
  onOpen: (cwd: string, id: string) => void;
}): React.ReactElement {
  const [loops, setLoops] = useState<Array<LoopRecord & { project: string }> | null>(null);

  const refresh = (): void => {
    void api.loopsAll().then((r) => setLoops(r.loops)).catch(() => setLoops([]));
  };
  useEffect(refresh, []);
  useLoopEvents(() => refresh(), []);

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <p className="max-w-2xl text-sm text-muted">
          Describe an outcome in plain English. CodeRouter generates a bounded, self-verifying loop, you approve it,
          and it runs — verify → plan → edit → review → re-verify — until the check passes or a limit is hit.
        </p>
        <button className="btn btn-primary" onClick={onNew}>
          + New loop
        </button>
      </div>
      {!loops && <Spinner />}
      {loops && loops.length === 0 && (
        <EmptyState title="No loops yet" hint="Create one with “New loop” — e.g. “fix the failing auth tests”." />
      )}
      <div className="grid gap-3">
        {loops?.map((l) => (
          <button
            key={l.id}
            onClick={() => onOpen(l.cwd, l.id)}
            className="card flex items-center justify-between text-left transition-colors hover:border-accent"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium">{l.name}</span>
                <StatusBadge status={l.status} />
              </div>
              <div className="mt-1 truncate text-sm text-muted">{l.goal}</div>
              <div className="mt-1 text-xs text-muted">
                {l.project} · {l.iterationsDone} iters · {money(l.costUsd)} · {timeAgo(l.updatedAt)}
              </div>
            </div>
            <span className="text-muted">›</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---- new loop ------------------------------------------------------

function NewLoop({
  projects,
  defaultProject,
  onCancel,
  onOpen,
}: {
  projects: ProjectSummary[];
  defaultProject: string | null;
  onCancel: () => void;
  onOpen: (cwd: string, id: string) => void;
}): React.ReactElement {
  const [cwd, setCwd] = useState(defaultProject ?? projects[0]?.cwd ?? '');
  const [request, setRequest] = useState('');
  const [preset, setPreset] = useState('safe');
  const [presets, setPresets] = useState<PresetInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [spec, setSpec] = useState<LoopSpec | null>(null);
  const [validation, setValidation] = useState<LoopValidation | null>(null);
  const [generated, setGenerated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.presets().then((r) => setPresets(r.presets)).catch(() => {});
  }, []);

  const generate = async (): Promise<void> => {
    if (!cwd || !request.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.generate(cwd, request, preset);
      setSpec(r.spec);
      setValidation(r.validation);
      setGenerated(r.generated);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const save = async (run: boolean): Promise<void> => {
    if (!spec) return;
    setBusy(true);
    setError(null);
    try {
      const { record } = await api.createFromSpec(cwd, spec);
      if (run) await api.startLoop(cwd, record.id);
      onOpen(cwd, record.id);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <button className="mb-4 text-sm text-muted hover:text-text" onClick={onCancel}>
        ← back
      </button>

      <Section title="What do you want done?">
        <div className="card space-y-3">
          <select className="input" value={cwd} onChange={(e) => setCwd(e.target.value)}>
            {projects.length === 0 && <option value="">no projects — run CodeRouter in a repo first</option>}
            {projects.map((p) => (
              <option key={p.cwd} value={p.cwd}>
                {p.name} — {p.cwd}
              </option>
            ))}
          </select>
          <textarea
            className="input min-h-[90px] resize-y"
            placeholder="e.g. Fix the failing auth tests and keep changes minimal."
            value={request}
            onChange={(e) => setRequest(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-2">
            {presets.map((p) => (
              <button
                key={p.id}
                onClick={() => setPreset(p.id)}
                title={p.description}
                className={cls('chip cursor-pointer', preset === p.id && 'border-accent text-text')}
              >
                {p.label}
              </button>
            ))}
            <div className="flex-1" />
            <button className="btn btn-primary" disabled={busy || !cwd || !request.trim()} onClick={() => void generate()}>
              {busy && !spec ? <Spinner /> : null} Generate spec
            </button>
          </div>
          {error && <div className="text-sm text-bad">{error}</div>}
        </div>
      </Section>

      {spec && validation && (
        <Section
          title="Generated loop"
          right={
            <span className={cls('chip', validation.valid ? 'border-ok text-ok' : 'border-bad text-bad')}>
              {validation.valid ? 'valid' : 'needs attention'}
            </span>
          }
        >
          <SpecEditor spec={spec} onChange={setSpec} />
          {!generated && (
            <div className="mt-2 text-xs text-warn">Generated from repo heuristics — no model was available.</div>
          )}
          {validation.issues.length > 0 && (
            <ul className="mt-3 list-disc pl-5 text-sm text-bad">
              {validation.issues.map((i, idx) => (
                <li key={idx}>{i}</li>
              ))}
            </ul>
          )}
          {validation.warnings.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-sm text-warn">
              {validation.warnings.map((w, idx) => (
                <li key={idx}>{w}</li>
              ))}
            </ul>
          )}
          <div className="mt-4 flex gap-2">
            <button className="btn" disabled={busy} onClick={() => void save(false)}>
              Save as draft
            </button>
            <button
              className="btn btn-primary"
              disabled={busy || spec.verifier.commands.length === 0}
              onClick={() => void save(true)}
            >
              {busy ? <Spinner /> : <Play className="h-4 w-4" />} Approve & run
            </button>
          </div>
        </Section>
      )}
    </div>
  );
}

function SpecEditor({ spec, onChange }: { spec: LoopSpec; onChange: (s: LoopSpec) => void }): React.ReactElement {
  const set = (patch: Partial<LoopSpec>): void => onChange({ ...spec, ...patch });
  return (
    <div className="card space-y-3">
      <Field label="Name">
        <input className="input" value={spec.name} onChange={(e) => set({ name: e.target.value })} />
      </Field>
      <Field label="Goal">
        <textarea className="input resize-y" value={spec.goal} onChange={(e) => set({ goal: e.target.value })} />
      </Field>
      <Field label="Verifier commands (one per line)">
        <textarea
          className="input min-h-[70px] resize-y font-mono text-xs"
          value={spec.verifier.commands.join('\n')}
          onChange={(e) =>
            set({
              verifier: { ...spec.verifier, commands: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) },
            })
          }
        />
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Max iterations">
          <input
            type="number"
            className="input"
            value={spec.limits.maxIterations}
            onChange={(e) => set({ limits: { ...spec.limits, maxIterations: Number(e.target.value) } })}
          />
        </Field>
        <Field label="Max cost ($)">
          <input
            type="number"
            step="0.5"
            className="input"
            value={spec.limits.maxCostUsd}
            onChange={(e) => set({ limits: { ...spec.limits, maxCostUsd: Number(e.target.value) } })}
          />
        </Field>
        <Field label="Max files">
          <input
            type="number"
            className="input"
            value={spec.limits.maxFilesChanged}
            onChange={(e) => set({ limits: { ...spec.limits, maxFilesChanged: Number(e.target.value) } })}
          />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm text-muted">
        <input
          type="checkbox"
          checked={spec.safety.requireApprovalBeforeCommit}
          onChange={(e) => set({ safety: { ...spec.safety, requireApprovalBeforeCommit: e.target.checked } })}
        />
        Require approval before merging changes
      </label>
      <div className="flex flex-wrap gap-2 text-xs text-muted">
        <span className="chip">planner: {spec.models.planner}</span>
        <span className="chip">executor: {spec.models.executor}</span>
        <span className="chip">reviewer: {spec.models.reviewer}</span>
        <span className="chip">{spec.safety.blockedFiles.length} blocked files</span>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-muted">{label}</span>
      {children}
    </label>
  );
}

// ---- detail --------------------------------------------------------

function LoopDetail({ cwd, id, onBack }: { cwd: string; id: string; onBack: () => void }): React.ReactElement {
  const [loop, setLoop] = useState<LoopRecord | null>(null);
  const [iterations, setIterations] = useState<LoopIteration[]>([]);
  const [phase, setPhase] = useState<string>('');
  const [busy, setBusy] = useState(false);

  const refresh = (): void => {
    void api.loop(cwd, id).then(setLoop).catch(() => {});
    void api.iterations(cwd, id).then((r) => setIterations(r.iterations)).catch(() => {});
  };
  useEffect(refresh, [cwd, id]);

  useLoopEvents(
    (e) => {
      if (!('loopId' in e) || e.loopId !== id) return;
      if (e.type === 'phase') setPhase(`iter ${e.index} · ${e.phase}: ${e.message}`);
      if (e.type === 'iteration' || e.type === 'status' || e.type === 'done') refresh();
    },
    [id],
  );

  const act = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    try {
      await fn();
      refresh();
    } finally {
      setBusy(false);
    }
  };

  if (!loop) return <Spinner />;
  const s = loop.spec;
  const running = loop.status === 'running' || loop.status === 'queued';

  return (
    <div className="mx-auto max-w-4xl">
      <button className="mb-4 text-sm text-muted hover:text-text" onClick={onBack}>
        ← all loops
      </button>

      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">{loop.name}</h2>
            <StatusBadge status={loop.status} />
          </div>
          <p className="mt-1 max-w-2xl text-sm text-muted">{loop.goal}</p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {(loop.status === 'draft' || loop.status === 'paused' || loop.status === 'stopped' || loop.status === 'failed') && (
            <button className="btn btn-primary" disabled={busy} onClick={() => void act(() => api.startLoop(cwd, id))}>
              <Play className="h-4 w-4" /> Run
            </button>
          )}
          {running && (
            <>
              <button className="btn" disabled={busy} onClick={() => void act(() => api.pauseLoop(cwd, id))}>
                <Pause className="h-4 w-4" /> Pause
              </button>
              <button className="btn btn-danger" disabled={busy} onClick={() => void act(() => api.stopLoop(cwd, id))}>
                <Square className="h-4 w-4" /> Stop
              </button>
            </>
          )}
          {loop.status === 'awaiting_approval' && (
            <>
              <button className="btn btn-primary" disabled={busy} onClick={() => void act(() => api.approveLoop(cwd, id))}>
                <Check className="h-4 w-4" /> Approve & merge
              </button>
              <button className="btn btn-danger" disabled={busy} onClick={() => void act(() => api.rejectLoop(cwd, id))}>
                <X className="h-4 w-4" /> Reject
              </button>
            </>
          )}
          <button className="btn btn-danger" disabled={busy} onClick={() => void act(() => api.deleteLoop(cwd, id)).then(onBack)}>
            Delete
          </button>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-4 gap-3">
        <Stat label="Iterations" value={`${loop.iterationsDone}/${s.limits.maxIterations}`} />
        <Stat label="Cost" value={`${money(loop.costUsd)} / ${money(s.limits.maxCostUsd)}`} />
        <Stat label="Files" value={`${loop.filesChanged.length} / ${s.limits.maxFilesChanged}`} />
        <Stat label="Verifier" value={s.verifier.commands.length ? `${s.verifier.commands.length} cmd` : 'none'} />
      </div>

      {running && phase && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-sm">
          <Spinner /> {phase}
        </div>
      )}
      {loop.error && <div className="mb-4 rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{loop.error}</div>}

      <Section title="Verifier">
        <div className="card font-mono text-xs text-muted">
          {s.verifier.commands.length ? s.verifier.commands.map((c, i) => <div key={i}>$ {c}</div>) : 'no commands'}
        </div>
      </Section>

      <Section title={`Iterations (${iterations.length})`}>
        {iterations.length === 0 && <div className="text-sm text-muted">No iterations recorded yet.</div>}
        <div className="space-y-2">
          {iterations.map((it) => (
            <IterationRow key={it.id} it={it} />
          ))}
        </div>
      </Section>

      {loop.lastDiff && (
        <Section title="Latest diff">
          <pre className="card max-h-96 overflow-auto whitespace-pre-wrap font-mono text-xs text-muted">{loop.lastDiff}</pre>
        </Section>
      )}
    </div>
  );
}

function IterationRow({ it }: { it: LoopIteration }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const failed = it.status === 'fail' || it.status === 'error';
  return (
    <div className="card">
      <button className="flex w-full items-center justify-between text-left" onClick={() => setOpen((o) => !o)}>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">#{it.index}</span>
          <span className={cls('chip', failed ? 'border-bad text-bad' : 'border-ok text-ok')}>{it.status}</span>
          <span className="text-sm text-muted">{it.phase}</span>
        </div>
        <span className="text-xs text-muted">{money(it.costUsd)} · {open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {it.summary && <div className="text-sm text-muted">{it.summary}</div>}
          {it.verifier.map((v, i) => (
            <div key={i} className="rounded-md border border-border bg-panel2 p-2">
              <div className="flex items-center gap-1.5 font-mono text-xs">
                {v.ok ? (
                  <Check className="h-3.5 w-3.5 shrink-0 text-ok" />
                ) : (
                  <X className="h-3.5 w-3.5 shrink-0 text-bad" />
                )}
                <span>$ {v.command}</span>
                <span className="text-muted">(exit {v.exitCode})</span>
              </div>
              {!v.ok && v.output && (
                <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-muted">{v.output}</pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="card py-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}
