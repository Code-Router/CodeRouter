import React, { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Static, Text, render, useApp, useInput } from 'ink';
import type {
  ActivityEvent,
  InjectionFinding,
  Mode,
  ProgressNotifier,
} from '@coderouter/core';
import {
  renderReportFooterText,
  renderReportText,
  sandbox,
  scanForInjection,
  summarizeInjectionScan,
} from '@coderouter/core';
import {
  applyArtifact,
  discardArtifact,
  findArtifact,
  listArtifacts,
  loadArtifact,
  type FileStats,
  type RecordedRun,
} from './artifacts.js';
import { isDirectoryTrusted, trustDirectory } from './trust.js';
import { executeRun } from '../runtime.js';
import {
  BRAND_GLYPH,
  BRAND_NAME,
  WORDMARK_PIXEL,
  WORDMARK_SMALL,
  WORDMARK_TAGLINE,
} from '../branding/index.js';
import {
  CREDENTIALS_PATH,
  SETUP_PROVIDERS,
  type SetupProvider,
  detectConfiguredProviders,
  loadCredentialsIntoEnv,
  removeCredential,
  saveCredential,
  setHostEnabled,
} from './setup.js';
import type { DetectedHost } from './hosts.js';

/**
 * One row in the unified /setup manager. Local CLI rows toggle on/off
 * with space; provider rows take an API key via enter, drop one via
 * delete/backspace. Each row knows its own affordances so the input
 * handler stays a flat dispatch table.
 */
type ManagerRow =
  | { kind: 'host'; host: DetectedHost }
  | { kind: 'provider'; provider: SetupProvider; hasKey: boolean };

type Effort = 'low' | 'medium' | 'high' | 'max';

type CommandDef = {
  name: string;
  hint: string;
  desc: string;
};

const COMMANDS: CommandDef[] = [
  { name: 'plan', hint: '<prompt>', desc: 'quick planning (Cursor-style)' },
  { name: 'masterplan', hint: '<prompt>', desc: '6-phase research-grade plan' },
  { name: 'agent', hint: '<prompt>', desc: 'decisive execution' },
  { name: 'debug', hint: '<prompt>', desc: 'investigation + hypothesis tree' },
  { name: 'review', hint: '', desc: 'review the current diff' },
  { name: 'route', hint: '<prompt>', desc: 'classify a prompt (no execution)' },
  { name: 'setup', hint: '', desc: 'manage local CLIs + cloud API keys' },
  { name: 'effort', hint: 'low|medium|high|max', desc: 'set planner/agent effort' },
  { name: 'apply', hint: '', desc: 'toggle: apply diff on success' },
  { name: 'fast', hint: '', desc: 'toggle: skip classifier/context' },
  { name: 'scan', hint: '<text>', desc: 'check text for prompt-injection markers' },
  { name: 'security', hint: 'warn|block', desc: 'set prompt-injection policy' },
  { name: 'runs', hint: '', desc: 'list saved run patches' },
  { name: 'accept', hint: '[runId]', desc: 'apply a saved run (latest if omitted)' },
  { name: 'reject', hint: '[runId]', desc: 'discard a saved run' },
  { name: 'trust', hint: '', desc: "trust edits for this session (don't ask again)" },
  { name: 'clear', hint: '', desc: 'clear scrollback' },
  { name: 'help', hint: '', desc: 'show this help' },
  { name: 'exit', hint: '', desc: 'quit the REPL' },
];

const MODE_COMMANDS = new Set(['plan', 'masterplan', 'agent', 'debug', 'review']);

type HistoryItem =
  | { id: number; kind: 'welcome' }
  | { id: number; kind: 'user'; text: string }
  | { id: number; kind: 'system'; text: string; tone?: 'info' | 'warn' | 'error' | 'success' }
  | { id: number; kind: 'report'; text: string }
  | { id: number; kind: 'log'; entries: LogEntry[] }
  | { id: number; kind: 'changes'; stats: FileStats[] };

type WizardStep = 'idle' | 'trust' | 'confirm' | 'pick' | 'key' | 'review';

/**
 * One entry in the unified live log: text spoken by the model and
 * tool calls it makes are appended to the *same* array in arrival
 * order, so the rendered output reads as one continuous narration
 * instead of a split-pane "text up here, activity over there".
 *
 * Three kinds:
 *   - `text`      a stretch of natural-language model output
 *                 (deltas from the streaming adapter accumulate
 *                 into the trailing entry of this kind so we don't
 *                 explode the array with one row per token)
 *   - `tool`      a tool_use, optionally merged with its matching
 *                 tool_result (`ok` flips from undefined -> true/false
 *                 once the result lands)
 *   - `thinking`  reasoning summaries from codex; rendered dim
 */
type LogEntry =
  | { id: number; kind: 'text'; text: string }
  | {
      id: number;
      kind: 'tool';
      tool: string;
      description: string;
      ok?: boolean;
      body?: string;
    }
  | { id: number; kind: 'thinking'; text: string };

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/**
 * Human-readable label for each progress phase emitted by the core
 * pipeline. Keys are the `phase` strings the core's notifier sends;
 * unknown keys fall through to the raw phase name so we don't lie
 * about progress.
 */
const PHASE_LABELS: Record<string, string> = {
  'agent/instant': 'matching instant patterns',
  'agent/worktree': 'preparing worktree',
  'agent/context': 'scanning context',
  'agent/run': 'running model',
  'agent/validate': 'validating changes',
  'agent/handoff': 'handing off to fix-pass',
  'plan/classify': 'classifying prompt',
  'plan/research': 'researching',
  'plan/draft': 'drafting plan',
  'plan/validate': 'validating plan',
  'masterplan/research': 'researching (deep)',
  'masterplan/decompose': 'decomposing',
  'masterplan/critique': 'self-critique pass',
  'masterplan/refine': 'refining',
  'debug/hypothesize': 'building hypothesis tree',
  'debug/test': 'testing hypothesis',
  'review/scan': 'scanning diff',
  'review/critique': 'reviewing changes',
};

function describeProgress(phase: string): string {
  return PHASE_LABELS[phase] ?? phase.replace(/^[a-z]+\//, '').replace(/_/g, ' ');
}

type AppProps = {
  cwd: string;
  initialMode?: Mode;
};

function App({ cwd, initialMode }: AppProps): React.ReactElement {
  const { exit } = useApp();

  // Hydrate env from the credentials file once on mount. We do it inside
  // useState's initializer so the very first detectConfiguredProviders()
  // call sees the loaded keys (no "Setup required" flash for users who
  // already saved their keys).
  const [setupState, setSetupState] = useState(() => {
    loadCredentialsIntoEnv();
    return detectConfiguredProviders();
  });

  // Sweep stale worktrees once on launch. Any session that crashed or
  // got SIGKILL'd before destroyWorktree could run would leak `cr/<id>`
  // refs into the host repo's `git worktree list`; left unchecked they
  // accumulate over weeks of usage. Best-effort: errors are swallowed.
  useEffect(() => {
    void sandbox.pruneStaleWorktrees(cwd).catch(() => {
      // best-effort; we never want pruning failure to fail the REPL.
    });
  }, [cwd]);

  // The welcome item is seeded at id=-1 so it lives above everything
  // else: real history items use ids handed out by idRef (starting at
  // 0) and therefore sort and key cleanly below it. Once <Static>
  // commits the welcome row to scrollback it stays there for the
  // whole session - new user prompts and answers just stack below.
  const [history, setHistory] = useState<HistoryItem[]>([
    { id: -1, kind: 'welcome' },
  ]);
  const idRef = useRef(0);
  const [input, setInput] = useState('');
  const [cursor, setCursor] = useState(0);
  const [mode, setMode] = useState<Mode>(initialMode ?? 'agent');
  const [effort, setEffort] = useState<Effort>(initialMode === 'masterplan' ? 'high' : 'medium');
  const [apply, setApply] = useState(false);
  const [fast, setFast] = useState(false);
  // Prompt-injection enforcement policy. 'warn' (default) records
  // findings on the report but still runs the model; 'block' refuses
  // to run when any high-severity finding is present.
  const [securityPolicy, setSecurityPolicy] = useState<'warn' | 'block'>('warn');
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState('');
  // Animated spinner index + elapsed-time counter for the in-flight
  // progress line. Both update on intervals while `busy` is true and
  // are reset between runs.
  const [spinFrame, setSpinFrame] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  // Tracks the in-flight AbortController so esc-while-busy can cancel
  // the run. Held in a ref so updates don't re-render the spinner.
  const abortRef = useRef<AbortController | null>(null);
  // Unified live log for the in-flight run: every text chunk and
  // every tool call lands here in arrival order, so the rendered
  // output reads as one continuous narration. The mutable canonical
  // copy lives on `liveLogRef` so successive React renders never
  // race chunk callbacks; the state value is set after each push so
  // the tree re-renders with the latest content. Cleared between
  // runs and committed to scrollback as a single 'log' history item.
  const [liveLog, setLiveLog] = useState<LogEntry[]>([]);
  const liveLogRef = useRef<LogEntry[]>([]);
  const logIdRef = useRef(0);
  // Pending prompt queued while a previous run was still in flight.
  // Submitted automatically once the current run finishes; mirrors
  // Claude Code's "type ahead" behaviour.
  const queuedRef = useRef<string | null>(null);
  const [suggIdx, setSuggIdx] = useState(0);
  // Pending review (approve/discard/trust) artifact shown
  // automatically after a run that produced changes when apply=off
  // and the user hasn't already trusted edits for this session.
  const [reviewRun, setReviewRun] = useState<RecordedRun | null>(null);
  const [reviewChoice, setReviewChoice] = useState<'approve' | 'discard' | 'trust'>('approve');

  useEffect(() => {
    if (!busy) {
      setSpinFrame(0);
      setElapsedMs(0);
      return;
    }
    const start = Date.now();
    const spinId = setInterval(() => {
      setSpinFrame((f) => (f + 1) % SPINNER_FRAMES.length);
    }, 80);
    const timeId = setInterval(() => {
      setElapsedMs(Date.now() - start);
    }, 200);
    return () => {
      clearInterval(spinId);
      clearInterval(timeId);
    };
  }, [busy]);

  // Has the user trusted this directory? Persisted across sessions
  // in `~/.coderouter/trust.json`. When false on launch we open the
  // 'trust' wizard step before anything else; the user can either
  // grant trust (we store the path and proceed) or quit. Mirrors how
  // Cursor / Claude Code gate first-time access to a workspace so
  // CodeRouter never silently runs an agent in a directory the user
  // didn't explicitly opt into.
  const [trusted, setTrusted] = useState(() => isDirectoryTrusted(cwd));
  // First-run setup is forced when there's no usable provider key.
  // Wizard order on launch: trust -> confirm (yes/no setup) -> pick
  // (manage hosts/keys) -> idle. Each step gates input so we can't
  // accidentally route an agent run through an empty registry or an
  // untrusted directory.
  const [wizardStep, setWizardStep] = useState<WizardStep>(
    !trusted
      ? 'trust'
      : setupState.configured
        ? 'idle'
        : 'confirm',
  );
  // True after the user picks "trust this session" in the post-run
  // approve panel. Until set, every change-producing run pauses on
  // an inline approve prompt; once set we auto-apply silently for
  // the rest of the REPL session (effectively `/apply on`).
  const [sessionTrustEdits, setSessionTrustEdits] = useState(false);
  // Highlighted row in the unified /setup manager. Indexes into the
  // flattened `managerRows` list (hosts first, then API providers).
  const [wizardPick, setWizardPick] = useState(0);
  const [wizardKey, setWizardKey] = useState('');
  // The provider whose key the user is currently entering. Set when
  // transitioning from the picker into the key step so we don't have
  // to dig through `managerRows` from the input handler.
  const [wizardProvider, setWizardProvider] = useState<SetupProvider | null>(null);
  // Highlighted button in the yes/no confirm. Arrows move between
  // 'yes' and 'no'; enter activates the highlighted one. 'y' / 'n' also
  // work as direct shortcuts for users who already know the answer.
  const [confirmChoice, setConfirmChoice] = useState<'yes' | 'no'>('yes');

  // Flattened list of rows shown in /setup. Recomputed whenever the
  // user toggles a host or saves/removes a key so the checkboxes /
  // "key set" markers stay in sync without a manual refresh.
  const managerRows = useMemo<ManagerRow[]>(() => {
    const apiKeySet = new Set(setupState.apiKeys);
    const hostRows: ManagerRow[] = setupState.hosts.map((host) => ({ kind: 'host', host }));
    const providerRows: ManagerRow[] = SETUP_PROVIDERS.map((provider) => ({
      kind: 'provider',
      provider,
      hasKey: apiKeySet.has(provider.name),
    }));
    return [...hostRows, ...providerRows];
  }, [setupState]);

  // Keep wizardPick in range when the list shrinks (e.g. host newly
  // disabled removes it from view? - currently it doesn't, but this
  // future-proofs the guard).
  useEffect(() => {
    if (wizardPick >= managerRows.length && managerRows.length > 0) {
      setWizardPick(managerRows.length - 1);
    }
  }, [managerRows.length, wizardPick]);

  // Slash-command palette: visible while the user is typing the command
  // name (no space yet). Once they hit space, we switch to "arg entry" and
  // hide the menu so the prompt area is unobstructed.
  const showSuggestions =
    wizardStep === 'idle' && input.startsWith('/') && !input.includes(' ');
  const filter = showSuggestions ? input.slice(1).toLowerCase() : '';
  const suggestions = useMemo(
    () => (showSuggestions ? COMMANDS.filter((c) => c.name.startsWith(filter)) : []),
    [filter, showSuggestions],
  );

  useEffect(() => {
    if (suggIdx >= suggestions.length) setSuggIdx(0);
  }, [suggestions.length, suggIdx]);

  /**
   * Append a streaming text chunk to the live log. Consecutive
   * chunks coalesce into the trailing `text` entry so the rendered
   * markdown stays stable; a new `text` entry only starts when an
   * activity event has interrupted in between (which guarantees
   * arrival order in the visual log).
   */
  function appendLogText(chunk: string): void {
    if (!chunk) return;
    const log = liveLogRef.current;
    const last = log.length > 0 ? log[log.length - 1] : undefined;
    if (last && last.kind === 'text') {
      const merged: LogEntry = { id: last.id, kind: 'text', text: last.text + chunk };
      liveLogRef.current = [...log.slice(0, -1), merged];
    } else {
      liveLogRef.current = [
        ...log,
        { id: logIdRef.current++, kind: 'text', text: chunk },
      ];
    }
    setLiveLog(liveLogRef.current);
  }

  /**
   * Append (or merge) an activity event into the live log. tool_use
   * always pushes a fresh `tool` entry. tool_result finds the most
   * recent unresolved `tool` row with the same tool name and folds
   * the outcome into it; if there isn't one, we still append a
   * standalone row so the user sees something rather than dropping
   * the event silently.
   */
  function appendLogActivity(event: ActivityEvent): void {
    const log = liveLogRef.current;
    if (event.kind === 'tool_result') {
      let target = -1;
      for (let i = log.length - 1; i >= 0; i--) {
        const row = log[i]!;
        if (row.kind === 'tool' && row.tool === event.tool && row.ok === undefined) {
          target = i;
          break;
        }
      }
      if (target >= 0) {
        const orig = log[target]! as Extract<LogEntry, { kind: 'tool' }>;
        const updated: LogEntry = { ...orig, ok: event.ok, body: event.body };
        liveLogRef.current = [...log.slice(0, target), updated, ...log.slice(target + 1)];
      } else {
        liveLogRef.current = [
          ...log,
          {
            id: logIdRef.current++,
            kind: 'tool',
            tool: event.tool,
            description: event.tool,
            ok: event.ok,
            body: event.body,
          },
        ];
      }
    } else if (event.kind === 'tool_use') {
      liveLogRef.current = [
        ...log,
        {
          id: logIdRef.current++,
          kind: 'tool',
          tool: event.tool,
          description: event.description,
        },
      ];
    } else {
      liveLogRef.current = [
        ...log,
        { id: logIdRef.current++, kind: 'thinking', text: event.text },
      ];
    }
    setLiveLog(liveLogRef.current);
  }

  function appendHistory(item: HistoryItem): void {
    setHistory((h) => [...h, item]);
  }
  function pushUser(text: string): void {
    appendHistory({ id: idRef.current++, kind: 'user', text });
  }
  function pushSystem(text: string, tone?: 'info' | 'warn' | 'error' | 'success'): void {
    appendHistory({ id: idRef.current++, kind: 'system', text, tone });
  }
  function pushReport(text: string): void {
    if (!text.trim()) return;
    appendHistory({ id: idRef.current++, kind: 'report', text });
  }
  /**
   * Promote the entire live log (text + tool calls in arrival
   * order) to a frozen history item so it stays in scrollback after
   * the run completes. Snapshots the array so the next run's
   * mutations don't reach back into existing scrollback.
   */
  function pushLog(entries: LogEntry[]): void {
    if (entries.length === 0) return;
    appendHistory({ id: idRef.current++, kind: 'log', entries: [...entries] });
  }
  /**
   * Compact per-file diff summary appended after a run that produced
   * changes. Lives in scrollback so the user can scroll up and see
   * what each run touched without re-running `/runs`.
   */
  function pushChanges(stats: FileStats[]): void {
    if (stats.length === 0) return;
    appendHistory({ id: idRef.current++, kind: 'changes', stats: [...stats] });
  }

  /**
   * Single-line status banner for what happened to the run's
   * changes. The detailed per-file stats live in the dedicated
   * `changes` history item; this is just the verb summary so the
   * user can tell apply/discard/applied/pending at a glance.
   */
  function pushApplyBanner(report: {
    filesChanged?: string[];
    applied?: boolean;
  }): void {
    const n = report.filesChanged?.length ?? 0;
    if (n === 0) return;
    if (report.applied) {
      pushSystem(`  applied ${n} file(s)`, 'success');
    }
  }

  /**
   * Push a multi-line system block summarising security findings.
   * Worst severity drives the tone (high → red, warn → yellow,
   * info → gray) so the user can spot trouble at a glance.
   */
  function pushFindingsBanner(findings: InjectionFinding[]): void {
    if (findings.length === 0) return;
    const head = findings.slice(0, 5);
    const lines = [
      `  ! ${findings.length} prompt-injection finding(s):`,
      ...head.map((f) => {
        const src = f.source ? ` (${f.source})` : '';
        return `    - ${f.severity.toUpperCase()} [${f.ruleId}]${src} ${f.excerpt}`;
      }),
    ];
    if (findings.length > head.length) {
      lines.push(`    ... and ${findings.length - head.length} more`);
    }
    const worst = findings.some((f) => f.severity === 'high')
      ? 'error'
      : findings.some((f) => f.severity === 'warn')
        ? 'warn'
        : 'info';
    pushSystem(lines.join('\n'), worst);
  }

  async function dispatch(prompt: string, modeOverride?: Mode): Promise<void> {
    const m = modeOverride ?? mode;
    setBusy(true);
    setPhase('preparing');
    liveLogRef.current = [];
    setLiveLog([]);
    const controller = new AbortController();
    abortRef.current = controller;
    // Auto-apply when the user has said "trust this session"; this
    // is identical to having `/apply on`. Otherwise honour whatever
    // toggle the user has set explicitly.
    const effectiveApply = apply || sessionTrustEdits;
    const notifier: ProgressNotifier = (u) => {
      // Friendly label per phase; ignore the `stage` (`start`/`done`)
      // because the animated spinner already conveys "still running"
      // and bouncing between "running ✓" / "running" reads as flicker.
      setPhase(describeProgress(u.phase));
    };
    try {
      const { report, store } = await executeRun({
        prompt,
        cwd,
        mode: m,
        effort,
        apply: effectiveApply,
        fast,
        injectionPolicy: securityPolicy,
        progress: { notifier, close: () => {} },
        signal: controller.signal,
        onChunk: (chunk) => {
          // Coalesce consecutive text chunks into the trailing log
          // entry so the rendered narration stays stable; an
          // intervening tool_use breaks the run automatically.
          appendLogText(chunk);
        },
        onActivity: (event) => {
          appendLogActivity(event);
        },
      });

      // Surface prompt-injection findings before rendering the answer
      // so the operator sees them clearly even if they later scroll
      // past the report footer.
      if (report.securityFindings && report.securityFindings.length > 0) {
        pushFindingsBanner(report.securityFindings);
        if (report.status === 'failed' && report.rationale.startsWith('blocked:')) {
          pushSystem(
            '  run blocked by /security policy (block). use `/security warn` to override.',
            'error',
          );
        }
      }

      // Commit the unified live log (text + tool calls in arrival
      // order) to scrollback as a single ordered entry. If streaming
      // didn't fire at all (HTTP adapter without SSE) but the report
      // carries text, fall back to a synthetic single-text-entry log
      // so the user still sees the answer.
      const finalLog = liveLogRef.current;
      if (controller.signal.aborted) {
        if (finalLog.length > 0) pushLog(finalLog);
        pushSystem('  interrupted', 'warn');
      } else if (finalLog.length > 0) {
        pushLog(finalLog);
      } else if (report.text && report.text.trim()) {
        pushLog([{ id: logIdRef.current++, kind: 'text', text: report.text }]);
      }

      // Compact per-file change summary. Pulled from the persisted
      // patch artifact when one exists (apply=off path) and from the
      // ad-hoc `diff` when not (apply=on, worktree merged).
      let postRunArtifact: RecordedRun | null = null;
      if (report.artifactDir) {
        postRunArtifact = loadArtifact(report.artifactDir);
      }
      if (postRunArtifact && postRunArtifact.fileStats.length > 0) {
        pushChanges(postRunArtifact.fileStats);
      }

      // Validators / citations / escalation hints still live in the
      // report footer; the answer body has already been streamed.
      const footer = renderReportFooterText({
        ...report,
        // Strip filesChanged so the renderer doesn't re-emit a
        // textual list - the `changes` history item now owns that.
        filesChanged: undefined,
      } as typeof report);
      if (footer.trim()) pushReport(footer);

      if (!controller.signal.aborted) {
        pushApplyBanner(report);
      }

      // If the run produced changes that weren't auto-applied, open
      // the inline approve prompt (small three-button panel). When
      // `sessionTrustEdits` is on we already passed apply=true above
      // and won't reach this branch.
      if (
        !controller.signal.aborted &&
        report.applied === false &&
        (report.filesChanged?.length ?? 0) > 0 &&
        postRunArtifact
      ) {
        setReviewRun(postRunArtifact);
        setReviewChoice('approve');
        setWizardStep('review');
      }

      try {
        store.db.close();
      } catch {
        // best-effort
      }
    } catch (err) {
      // Whatever we've already streamed is committed to scrollback so
      // the user still sees what the model said before failing.
      if (liveLogRef.current.length > 0) {
        pushLog(liveLogRef.current);
      }
      if (controller.signal.aborted) {
        pushSystem('  interrupted', 'warn');
      } else {
        pushSystem(`  error: ${(err as Error).message}`, 'error');
      }
    } finally {
      abortRef.current = null;
      liveLogRef.current = [];
      setLiveLog([]);
      setBusy(false);
      setPhase('');
      // If the user typed-ahead while the previous run was in flight,
      // fire it now. setTimeout ensures the in-flight setState calls
      // above have committed before we start the next dispatch.
      const queued = queuedRef.current;
      queuedRef.current = null;
      if (queued) {
        setTimeout(() => {
          void submit(queued);
        }, 0);
      }
    }
  }

  /**
   * Apply or discard the pending review artifact. Three choices:
   *   - `approve`: git apply this run only; keep prompting on
   *                future runs so the user retains per-run veto.
   *   - `discard`: delete the artifact; nothing lands in the repo.
   *   - `trust`:   apply this run AND flip session trust on so we
   *                stop prompting for the rest of the REPL session
   *                (effectively `/apply on` going forward). This
   *                is what the user wants once they've decided
   *                CodeRouter is doing the right thing.
   *
   * In every case we close the review wizard and return to idle so
   * the user can keep typing immediately.
   */
  function resolveReview(choice: 'approve' | 'discard' | 'trust'): void {
    const run = reviewRun;
    if (!run) {
      setWizardStep('idle');
      return;
    }
    if (choice === 'approve' || choice === 'trust') {
      const result = applyArtifact(cwd, run);
      if (result.ok) {
        const note = result.strategy === '3way' ? ' (with 3-way merge)' : '';
        pushSystem(`  applied ${run.files.length} file(s)${note}`, 'success');
        try {
          discardArtifact(run);
        } catch {
          // best-effort
        }
        if (choice === 'trust') {
          setSessionTrustEdits(true);
          setApply(true);
          pushSystem(
            '  trusted edits for this session - future runs will auto-apply (toggle off with /apply off)',
            'info',
          );
        }
      } else {
        pushSystem(
          `  failed to apply run ${run.runId}: ${result.error}\n  patch is preserved at ${run.patchPath}`,
          'error',
        );
      }
    } else {
      try {
        discardArtifact(run);
        pushSystem(`  discarded ${run.files.length} file(s)`, 'warn');
      } catch (err) {
        pushSystem(`  failed to discard artifact: ${(err as Error).message}`, 'error');
      }
    }
    setReviewRun(null);
    setWizardStep('idle');
  }

  function startSetupWizard(): void {
    // Skip the yes/no confirm when the user opts in explicitly via /setup -
    // go straight to the picker.
    setWizardStep('pick');
    setWizardPick(0);
    setWizardKey('');
    setInput('');
    setCursor(0);
  }

  function toggleHostRow(host: DetectedHost): void {
    const next = !host.enabled;
    try {
      setHostEnabled(host.provider, next);
      setSetupState(detectConfiguredProviders());
      pushSystem(
        `  ${host.cli} ${next ? 'enabled' : 'disabled'}${next ? '' : ' (router will skip it)'}`,
        next ? 'success' : 'warn',
      );
    } catch (err) {
      pushSystem(`  failed to toggle ${host.cli}: ${(err as Error).message}`, 'error');
    }
  }

  function removeProviderRow(provider: SetupProvider): void {
    try {
      const { wasInShellEnv } = removeCredential(provider);
      setSetupState(detectConfiguredProviders());
      if (wasInShellEnv) {
        pushSystem(
          `  ${provider.label} key cleared from credentials.json, but $${provider.envVar} is still set by your shell - unset it there to fully remove.`,
          'warn',
        );
      } else {
        pushSystem(`  ${provider.label} key removed`, 'success');
      }
    } catch (err) {
      pushSystem(`  failed to remove ${provider.label} key: ${(err as Error).message}`, 'error');
    }
  }

  function skipSetup(): void {
    setWizardStep('idle');
    setWizardKey('');
    pushSystem(
      '  ok - skipped setup. run /setup any time to configure a provider key.',
      'warn',
    );
  }

  function cancelWizard(): void {
    setWizardStep('idle');
    setWizardKey('');
    pushSystem('  setup cancelled');
  }

  function finishWizard(): void {
    const provider = wizardProvider;
    if (!provider) {
      setWizardStep('idle');
      return;
    }
    try {
      saveCredential(provider, wizardKey);
      setSetupState(detectConfiguredProviders());
      pushSystem(
        `  ${provider.label} key saved (~/.coderouter/credentials.json) and exported as $${provider.envVar}`,
        'success',
      );
    } catch (err) {
      pushSystem(`  failed to save key: ${(err as Error).message}`, 'error');
    }
    // Return to the manager so the user can configure more providers
    // in one /setup session. Esc still closes from there.
    setWizardStep('pick');
    setWizardKey('');
    setWizardProvider(null);
  }

  async function handleSlash(cmd: string, arg: string): Promise<void> {
    switch (cmd) {
      case 'exit':
      case 'quit':
        exit();
        return;
      case 'help':
        pushSystem(renderHelp());
        return;
      case 'clear':
        setHistory([]);
        return;
      case 'setup':
        startSetupWizard();
        return;
      case 'effort':
        if (['low', 'medium', 'high', 'max'].includes(arg)) {
          setEffort(arg as Effort);
          pushSystem(`  effort set to ${arg}`);
        } else {
          pushSystem('  usage: /effort low|medium|high|max', 'warn');
        }
        return;
      case 'apply': {
        const next = !apply;
        setApply(next);
        pushSystem(`  apply ${next ? 'on' : 'off'}`);
        return;
      }
      case 'fast': {
        const next = !fast;
        setFast(next);
        pushSystem(`  fast ${next ? 'on' : 'off'}`);
        return;
      }
      case 'route':
        pushSystem('  use `coderouter route <prompt>` from your shell');
        return;
      case 'scan': {
        if (!arg) {
          pushSystem(
            '  usage: /scan <text>  (checks the text for prompt-injection markers)',
            'warn',
          );
          return;
        }
        const result = scanForInjection(arg, { source: 'user-scan' });
        if (result.findings.length === 0) {
          pushSystem('  scan: clean — no injection markers found', 'success');
          return;
        }
        pushFindingsBanner(result.findings);
        const summary = summarizeInjectionScan(result);
        if (summary) pushSystem(`  scan: ${summary}`, 'warn');
        return;
      }
      case 'security': {
        if (arg === 'warn' || arg === 'block') {
          setSecurityPolicy(arg);
          pushSystem(
            arg === 'block'
              ? '  security: high-severity findings will block runs (use /security warn to relax)'
              : '  security: findings are recorded as warnings, runs continue',
            arg === 'block' ? 'success' : 'info',
          );
        } else {
          pushSystem(
            `  prompt-injection policy: ${securityPolicy}.  usage: /security warn|block`,
          );
        }
        return;
      }
      case 'runs': {
        const all = listArtifacts(cwd);
        if (all.length === 0) {
          pushSystem('  no saved runs found in .coderouter/runs/', 'info');
          return;
        }
        const lines = ['  saved runs (newest first):'];
        for (const run of all.slice(0, 20)) {
          const when = new Date(run.completedAt).toLocaleString();
          const stats = `+${run.stats.insertions}/-${run.stats.deletions}`;
          const files = `${run.files.length} file${run.files.length === 1 ? '' : 's'}`;
          lines.push(`    ${run.runId}  ${when}  ${files}  ${stats}`);
        }
        if (all.length > 20) lines.push(`    ... and ${all.length - 20} more`);
        lines.push('  use /accept <runId> to apply or /reject <runId> to discard');
        pushSystem(lines.join('\n'));
        return;
      }
      case 'accept': {
        const run = arg ? findArtifact(cwd, arg) : (listArtifacts(cwd)[0] ?? null);
        if (!run) {
          pushSystem(
            arg
              ? `  no saved run matches '${arg}' - try /runs to see what's available`
              : '  no saved runs to accept - try /runs to see what is available',
            'warn',
          );
          return;
        }
        setReviewRun(run);
        setReviewChoice('approve');
        setWizardStep('review');
        return;
      }
      case 'reject': {
        const run = arg ? findArtifact(cwd, arg) : (listArtifacts(cwd)[0] ?? null);
        if (!run) {
          pushSystem(
            arg
              ? `  no saved run matches '${arg}'`
              : '  no saved runs to reject',
            'warn',
          );
          return;
        }
        setReviewRun(run);
        setReviewChoice('discard');
        setWizardStep('review');
        return;
      }
      case 'trust': {
        if (sessionTrustEdits) {
          pushSystem('  edits already trusted for this session', 'info');
        } else {
          setSessionTrustEdits(true);
          setApply(true);
          pushSystem(
            '  trusted edits for this session - future runs will auto-apply (toggle off with /apply off)',
            'success',
          );
        }
        return;
      }
    }
    if (MODE_COMMANDS.has(cmd)) {
      const nextMode = cmd as Mode;
      setMode(nextMode);
      if (nextMode === 'masterplan' && effort === 'medium') setEffort('high');
      if (arg) await dispatch(arg, nextMode);
      else pushSystem(`  mode set to ${nextMode}`);
      return;
    }
    pushSystem(`  unknown command: /${cmd}`, 'warn');
  }

  async function submit(line: string): Promise<void> {
    pushUser(line);
    if (line.startsWith('/')) {
      const parts = line.slice(1).split(' ');
      const cmd = parts[0] ?? '';
      const arg = parts.slice(1).join(' ').trim();
      await handleSlash(cmd, arg);
    } else {
      await dispatch(line);
    }
  }

  useInput((char, key) => {
    // Ctrl+C is the only globally-overriding shortcut: aborts any
    // running adapter call and tears the REPL down regardless of
    // mode/wizard state.
    if (key.ctrl && char === 'c') {
      if (busy) abortRef.current?.abort();
      exit();
      return;
    }

    // Wizard: directory trust (shown on first launch in a new
    // directory). Yes/Enter grants trust + persists to
    // ~/.coderouter/trust.json; No/Esc/Ctrl+C exits the REPL since
    // we refuse to operate in an untrusted directory.
    if (wizardStep === 'trust') {
      if (char === 'y' || char === 'Y' || key.return) {
        try {
          trustDirectory(cwd);
        } catch {
          // Persistence failure shouldn't block the session; the
          // user just gets re-prompted next time.
        }
        setTrusted(true);
        setWizardStep(setupState.configured ? 'idle' : 'confirm');
        pushSystem(`  trusted ${cwd}`, 'success');
        return;
      }
      if (char === 'n' || char === 'N' || key.escape) {
        exit();
        return;
      }
      return;
    }

    // Wizard: yes/no confirm (shown automatically on first run when no
    // provider key is configured).
    if (wizardStep === 'confirm') {
      if (key.escape) {
        skipSetup();
        return;
      }
      if (key.leftArrow) {
        setConfirmChoice('yes');
        return;
      }
      if (key.rightArrow) {
        setConfirmChoice('no');
        return;
      }
      if (key.tab) {
        setConfirmChoice((c) => (c === 'yes' ? 'no' : 'yes'));
        return;
      }
      if (char === 'y' || char === 'Y') {
        setConfirmChoice('yes');
        setWizardStep('pick');
        setWizardPick(0);
        return;
      }
      if (char === 'n' || char === 'N') {
        setConfirmChoice('no');
        skipSetup();
        return;
      }
      if (key.return) {
        if (confirmChoice === 'yes') {
          setWizardStep('pick');
          setWizardPick(0);
        } else {
          skipSetup();
        }
        return;
      }
      if (key.ctrl && char === 'c') {
        exit();
        return;
      }
      return;
    }

    // Wizard: unified manager. Rows are either a detected host CLI
    // (toggle with space) or an API provider (enter to add/replace
    // key, delete/backspace to remove). Esc closes without a "save"
    // step because every mutation is persisted immediately.
    if (wizardStep === 'pick') {
      if (key.escape) {
        setWizardStep('idle');
        return;
      }
      if (managerRows.length === 0) return;
      if (key.upArrow) {
        setWizardPick((i) => (i - 1 + managerRows.length) % managerRows.length);
        return;
      }
      if (key.downArrow) {
        setWizardPick((i) => (i + 1) % managerRows.length);
        return;
      }
      const row = managerRows[wizardPick];
      if (!row) return;
      if (row.kind === 'host') {
        if (char === ' ' || key.return) {
          toggleHostRow(row.host);
        }
        return;
      }
      // provider row
      if (key.return) {
        setWizardProvider(row.provider);
        setWizardStep('key');
        setWizardKey('');
        return;
      }
      if (key.delete || key.backspace) {
        if (row.hasKey) removeProviderRow(row.provider);
        return;
      }
      if (key.ctrl && char === 'c') {
        setWizardStep('idle');
        return;
      }
      return;
    }

    // Wizard: post-run approve / discard / trust-this-session.
    // Compact three-button panel (no big modal). Single-letter
    // shortcuts (`a`, `d`, `t`) match Cursor's accept-edit pattern.
    if (wizardStep === 'review') {
      if (key.escape) {
        // Esc treats as discard - the safer default so an accidental
        // dismiss never silently lands changes the user didn't see.
        // The patch artifact is already on disk if they change their
        // mind; they can rerun `/accept` to recover.
        resolveReview('discard');
        return;
      }
      if (key.leftArrow) {
        setReviewChoice((c) => (c === 'approve' ? 'trust' : c === 'discard' ? 'approve' : 'discard'));
        return;
      }
      if (key.rightArrow || key.tab) {
        setReviewChoice((c) => (c === 'approve' ? 'discard' : c === 'discard' ? 'trust' : 'approve'));
        return;
      }
      if (char === 'a' || char === 'A' || char === 'y' || char === 'Y') {
        resolveReview('approve');
        return;
      }
      if (char === 'd' || char === 'D' || char === 'n' || char === 'N') {
        resolveReview('discard');
        return;
      }
      if (char === 't' || char === 'T') {
        resolveReview('trust');
        return;
      }
      if (key.return) {
        resolveReview(reviewChoice);
        return;
      }
      return;
    }

    // Wizard: api key entry (masked)
    if (wizardStep === 'key') {
      if (key.escape) {
        // Back out to the manager rather than fully cancelling, so the
        // user can pick a different provider without re-running /setup.
        setWizardStep('pick');
        setWizardKey('');
        setWizardProvider(null);
        return;
      }
      if (key.return) {
        if (wizardKey.trim().length < 8) {
          pushSystem('  key looks too short - try again or press esc to cancel', 'warn');
          return;
        }
        finishWizard();
        return;
      }
      if (key.backspace || key.delete) {
        setWizardKey((s) => s.slice(0, -1));
        return;
      }
      if (key.ctrl && char === 'u') {
        setWizardKey('');
        return;
      }
      if (key.ctrl && char === 'c') {
        cancelWizard();
        return;
      }
      if (char && !key.ctrl && !key.meta) {
        setWizardKey((s) => s + char);
      }
      return;
    }

    // Normal command/prompt input. Enter submits when idle; while busy
    // it queues the prompt to fire after the in-flight run finishes
    // (so the chatbox below the streaming output reads like a real
    // follow-up entry, not a dead element).
    if (key.return) {
      const line = input.trim();
      if (!line) return;
      setInput('');
      setCursor(0);
      if (busy) {
        queuedRef.current = line;
        pushSystem(`  queued: ${line}  (will run when the current step finishes)`, 'info');
      } else {
        void submit(line);
      }
      return;
    }

    if (!busy && showSuggestions && (key.upArrow || key.downArrow)) {
      const max = suggestions.length;
      if (max === 0) return;
      setSuggIdx((i) => (key.upArrow ? (i - 1 + max) % max : (i + 1) % max));
      return;
    }

    if (!busy && key.tab) {
      if (showSuggestions && suggestions.length > 0) {
        const sel = suggestions[suggIdx];
        if (sel) {
          const next = `/${sel.name}${sel.hint ? ' ' : ''}`;
          setInput(next);
          setCursor(next.length);
        }
      }
      return;
    }

    // Escape: cancels an in-flight run when busy; clears the input
    // buffer otherwise. Keeps the two semantics from clashing.
    if (key.escape) {
      if (busy) {
        abortRef.current?.abort();
      } else {
        setInput('');
        setCursor(0);
      }
      return;
    }

    if (key.backspace || key.delete) {
      if (cursor > 0) {
        setInput(input.slice(0, cursor - 1) + input.slice(cursor));
        setCursor(cursor - 1);
      }
      return;
    }

    if (key.leftArrow) {
      setCursor(Math.max(0, cursor - 1));
      return;
    }
    if (key.rightArrow) {
      setCursor(Math.min(input.length, cursor + 1));
      return;
    }

    if (key.ctrl && char === 'u') {
      setInput('');
      setCursor(0);
      return;
    }
    if (key.ctrl && char === 'a') {
      setCursor(0);
      return;
    }
    if (key.ctrl && char === 'e') {
      setCursor(input.length);
      return;
    }
    if (key.ctrl && char === 'c') {
      exit();
      return;
    }

    if (char && !key.ctrl && !key.meta) {
      // Insert character(s) at the cursor. Ink may batch multi-byte input
      // into a single `char` payload, so handle length > 1 as well.
      setInput(input.slice(0, cursor) + char + input.slice(cursor));
      setCursor(cursor + char.length);
    }
  });

  return (
    <Box flexDirection="column">
      <Static items={history}>
        {(item) => (
          <Box key={item.id} flexDirection="column" marginBottom={1}>
            {/* The welcome row is committed once at mount via the
                seed history item. Putting wordmark + detected hosts
                + tips inside <Static> means Ink writes them to
                scrollback exactly once and never repaints them, so
                they stay pinned at the top of the session while user
                prompts, streamed answers, and reports stack below. */}
            {item.kind === 'welcome' && (
              <Box flexDirection="column">
                <WordmarkPanel />
                {setupState.hosts.length > 0 && (
                  <DetectedHostsPanel hosts={setupState.hosts} />
                )}
                <TipsPanel mode={mode} />
              </Box>
            )}
            {item.kind === 'user' && (
              <Text>
                <Text color="green" bold>{'▸ '}</Text>
                <Text bold>{item.text}</Text>
              </Text>
            )}
            {item.kind === 'system' && (
              <Text
                color={
                  item.tone === 'error' ? 'red'
                    : item.tone === 'warn' ? 'yellow'
                    : item.tone === 'success' ? 'green'
                    : 'gray'
                }
              >
                {item.text}
              </Text>
            )}
            {item.kind === 'log' && <LogStream entries={item.entries} frozen />}
            {item.kind === 'changes' && <ChangesPanel stats={item.stats} />}
            {item.kind === 'report' && (
              <Box flexDirection="column">
                {item.text.split('\n').map((l, i) => (
                  <Text key={`${item.id}-${i}`}>{colorizeReportLine(l)}</Text>
                ))}
              </Box>
            )}
          </Box>
        )}
      </Static>

      {/* Single unified live log: text streamed by the model and
          tool calls it makes are interleaved here in arrival order
          so the user reads one continuous narration instead of two
          separate panels. Cleared between runs and committed to
          scrollback as a frozen 'log' history item when the run
          completes. */}
      {busy && liveLog.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <LogStream entries={liveLog} />
        </Box>
      )}

      {wizardStep === 'trust' && <TrustPanel cwd={cwd} />}
      {wizardStep === 'confirm' && <WizardConfirmPanel choice={confirmChoice} />}
      {wizardStep === 'pick' && (
        <SetupManagerPanel rows={managerRows} selectedIdx={wizardPick} />
      )}
      {wizardStep === 'key' && wizardProvider && (
        <WizardKeyPanel provider={wizardProvider} maskedKey={mask(wizardKey)} />
      )}
      {wizardStep === 'review' && reviewRun && (
        <ApprovePromptPanel run={reviewRun} choice={reviewChoice} />
      )}

      {showSuggestions && !busy && suggestions.length > 0 && (
        <SuggestionsList items={suggestions} selectedIdx={suggIdx} />
      )}

      {/* The chatbox + status/hint footer are intentionally hidden while
          the wizard owns input. Bringing them back at this point would
          just confuse — the wizard panels already carry their own hints. */}
      {wizardStep === 'idle' && (
        <>
          {!setupState.configured && !busy && <NoProviderReminder />}
          <InputBox
            value={input}
            cursor={cursor}
            busy={busy}
            configured={setupState.configured}
          />
          {busy ? (
            // While running we collapse the footer to just the
            // spinner + a single "esc to interrupt" hint. Mirrors
            // Claude Code's UX and avoids the visual noise of a
            // settings row the user can't change anyway.
            <Box flexDirection="column">
              <ProgressLine frame={spinFrame} phase={phase} elapsedMs={elapsedMs} />
              <Box paddingX={1}>
                <Text color="gray" dimColor>esc to interrupt</Text>
              </Box>
            </Box>
          ) : (
            <Box marginTop={1} paddingX={1} flexDirection="column">
              <StatusRow
                mode={mode}
                effort={effort}
                apply={apply}
                fast={fast}
                security={securityPolicy}
                apiKeys={setupState.apiKeys}
                hosts={setupState.hosts}
              />
              <HintRow />
            </Box>
          )}
        </>
      )}
    </Box>
  );
}

/**
 * Unified live log rendered as a sequence of self-contained blocks
 * separated by a single blank line, mirroring how Codex renders
 * the agent's narration in its own UI.
 *
 * Each entry kind becomes one block:
 *   - `text`      a markdown-rendered paragraph (or many) of model
 *                 narration. No leading glyph - the surrounding
 *                 margin is enough separation since adjacent tool
 *                 blocks all start with `›`/`✓`/`✗`.
 *   - `tool`      a header line ("`› Ran git status`") + an
 *                 optional indented body showing the captured
 *                 output. Status of the leading glyph encodes
 *                 progress: `›` pending, `✓` ok, `✗` error.
 *   - `thinking`  a single dim-italic line ("`… <summary>`").
 *
 * `frozen` slightly tones down dynamic colors when the block is
 * being committed to scrollback (vs. the live in-flight feed), so
 * the user's eye gravitates to the active run rather than older
 * blocks above it.
 */
function LogStream({
  entries,
  frozen,
}: {
  entries: LogEntry[];
  frozen?: boolean;
}): React.ReactElement {
  return (
    <Box flexDirection="column">
      {entries.map((entry, idx) => (
        <Box
          key={entry.id}
          flexDirection="column"
          marginTop={idx === 0 ? 0 : 1}
        >
          {entry.kind === 'text' && <MarkdownBlock text={entry.text} />}
          {entry.kind === 'thinking' && (
            <Text color="gray" italic dimColor={frozen}>
              {`  … ${entry.text}`}
            </Text>
          )}
          {entry.kind === 'tool' && <ToolBlock entry={entry} frozen={frozen} />}
        </Box>
      ))}
    </Box>
  );
}

/**
 * Maximum body lines we render inline per tool block. Anything
 * beyond gets truncated with a `...and N more lines` footer; the
 * full output is still on disk in the run artifact for any
 * post-mortem the user wants.
 */
const MAX_BODY_LINES = 12;

function ToolBlock({
  entry,
  frozen,
}: {
  entry: Extract<LogEntry, { kind: 'tool' }>;
  frozen?: boolean;
}): React.ReactElement {
  const pending = entry.ok === undefined;
  const glyph = pending ? '›' : entry.ok ? '›' : '✗';
  // Use cyan for in-flight (catch the eye), default for completed
  // ok blocks (so they recede into the log), red for failures.
  const glyphColor = pending ? 'cyan' : entry.ok ? 'gray' : 'red';
  const headerColor = entry.ok === false ? 'red' : undefined;
  return (
    <Box flexDirection="column">
      <Text dimColor={frozen}>
        <Text color={glyphColor} bold>{`${glyph} `}</Text>
        <Text bold color={headerColor}>{entry.description}</Text>
      </Text>
      {entry.body && entry.body.trim().length > 0 && (
        <ToolBlockBody body={entry.body} ok={entry.ok !== false} />
      )}
    </Box>
  );
}

function ToolBlockBody({
  body,
  ok,
}: {
  body: string;
  ok: boolean;
}): React.ReactElement {
  // Strip ANSI escape sequences so styled bash output (colors etc.)
  // doesn't double-render through Ink's own pipeline. Cheap regex
  // covers the common CSI sequences models actually emit.
  const stripped = body.replace(/\x1B\[[0-9;]*[A-Za-z]/g, '');
  const lines = stripped.split('\n');
  const shown = lines.slice(0, MAX_BODY_LINES);
  const truncated = lines.length - shown.length;
  return (
    <Box flexDirection="column">
      {shown.map((line, i) => (
        <Text key={i} color={ok ? 'gray' : 'red'}>
          {`  ${line}`}
        </Text>
      ))}
      {truncated > 0 && (
        <Text color="gray" dimColor>
          {`  ... and ${truncated} more line${truncated === 1 ? '' : 's'}`}
        </Text>
      )}
    </Box>
  );
}

/**
 * Compact per-file change summary. Replaces the old "render the
 * entire raw patch" review panel with a tabular view: one line per
 * file, path on the left, green +N and red -M counts on the right,
 * binary patches flagged inline. Lives in scrollback so the user
 * can scroll up and see what each run touched without re-running
 * `/runs`.
 */
function ChangesPanel({ stats }: { stats: FileStats[] }): React.ReactElement {
  const widest = Math.max(...stats.map((s) => s.file.length), 12);
  const total = stats.reduce(
    (acc, s) => ({
      ins: acc.ins + s.insertions,
      del: acc.del + s.deletions,
    }),
    { ins: 0, del: 0 },
  );
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>
        {`changes (${stats.length} file${stats.length === 1 ? '' : 's'})`}
      </Text>
      {stats.map((s) => (
        <Text key={s.file}>
          {'  '}
          <Text>{s.file.padEnd(widest)}</Text>
          {'  '}
          {s.binary ? (
            <Text color="gray">binary</Text>
          ) : (
            <>
              <Text color="green">{`+${s.insertions}`}</Text>
              {'  '}
              <Text color="red">{`-${s.deletions}`}</Text>
            </>
          )}
        </Text>
      ))}
      {stats.length > 1 && (
        <Text color="gray">
          {`  total  `}
          <Text color="green">{`+${total.ins}`}</Text>
          {`  `}
          <Text color="red">{`-${total.del}`}</Text>
        </Text>
      )}
    </Box>
  );
}

/**
 * Compact post-run approve panel. Three inline buttons; the
 * selected one is highlighted. Replaces the giant raw-diff modal
 * the previous version used so users can't fall into "just smash
 * accept" autopilot. The "trust" choice flips session-wide auto-
 * apply, mirroring how Claude Code / Cursor stop prompting once a
 * user has signed off on the agent.
 */
function ApprovePromptPanel({
  run,
  choice,
}: {
  run: RecordedRun;
  choice: 'approve' | 'discard' | 'trust';
}): React.ReactElement {
  const filesLine = `${run.files.length} file${run.files.length === 1 ? '' : 's'}`;
  const stats = `+${run.stats.insertions} / -${run.stats.deletions}`;
  return (
    <Box
      borderStyle="round"
      borderColor="green"
      paddingX={2}
      paddingY={0}
      marginBottom={1}
      flexDirection="column"
    >
      <Text bold color="green">{`apply changes? (${filesLine}, ${stats})`}</Text>
      <Box marginTop={1}>
        <ApproveButton label="approve" selected={choice === 'approve'} />
        <Text>  </Text>
        <ApproveButton label="discard" selected={choice === 'discard'} />
        <Text>  </Text>
        <ApproveButton label="trust this session" selected={choice === 'trust'} />
      </Box>
      <Text color="gray">
        ← → to choose · enter to confirm · a / d / t for shortcuts · esc discards
      </Text>
    </Box>
  );
}

function ApproveButton({
  label,
  selected,
}: {
  label: string;
  selected: boolean;
}): React.ReactElement {
  if (selected) {
    return (
      <Text backgroundColor="green" color="black" bold>
        {`  ${label}  `}
      </Text>
    );
  }
  return <Text color="gray">{`  ${label}  `}</Text>;
}

/**
 * Directory-trust prompt shown on first launch in a workspace the
 * user hasn't explicitly opted into. Mirrors Cursor/Claude Code's
 * "Do you trust this folder?" dialog. y/Enter persists the answer
 * to ~/.coderouter/trust.json and continues; n/Esc exits the REPL.
 */
function TrustPanel({ cwd }: { cwd: string }): React.ReactElement {
  return (
    <Box
      borderStyle="round"
      borderColor="yellow"
      paddingX={2}
      paddingY={1}
      marginBottom={1}
      flexDirection="column"
    >
      <Text bold color="yellow">! Trust this directory?</Text>
      <Box marginTop={1} flexDirection="column">
        <Text>{`  ${cwd}`}</Text>
        <Text color="gray">
          {'  CodeRouter will read files here and (when you approve) run agents that edit them.'}
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text color="green" bold>{'  [y] yes, trust this directory'}</Text>
      </Box>
      <Text color="gray">{'  [n / esc] no, quit'}</Text>
    </Box>
  );
}

function WordmarkPanel(): React.ReactElement {
  const width = process.stdout.columns ?? 80;
  // Pixel-block wordmark needs ~96 cols once you account for the Box's
  // border + padding; fall back to the compact ANSI wordmark below that.
  const wordmark = width >= 102 ? WORDMARK_PIXEL : WORDMARK_SMALL;
  const wordmarkLines = wordmark.split('\n');
  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
      {wordmarkLines.map((line, i) => (
        <Text key={`wm-${i}`} color="green" bold>
          {line}
        </Text>
      ))}
      <Box marginTop={1}>
        <Text color="green">
          {'  '}{BRAND_GLYPH}{'  '}
        </Text>
        <Text color="gray">{WORDMARK_TAGLINE}</Text>
        <Text color="gray">{`   ${BRAND_NAME} v0.1.0`}</Text>
      </Box>
    </Box>
  );
}

function TipsPanel({ mode }: { mode: Mode }): React.ReactElement {
  return (
    <Box
      borderStyle="round"
      borderColor="green"
      paddingX={2}
      paddingY={1}
      marginBottom={1}
      flexDirection="column"
    >
      <Box flexDirection="column">
        <Text bold>Tips for getting started</Text>
        <Text>
          <Text color="gray">{'  Type '}</Text>
          <Text bold color="green">/</Text>
          <Text color="gray">{' to browse all commands'}</Text>
        </Text>
        <Text>
          <Text color="gray">{'  Type '}</Text>
          <Text bold color="green">/help</Text>
          <Text color="gray">{' for the full reference'}</Text>
        </Text>
        <Text>
          <Text color="gray">{'  Plain text runs in the current mode ('}</Text>
          <Text bold>{mode}</Text>
          <Text color="gray">{')'}</Text>
        </Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text bold>Modes</Text>
        <Text color="gray">  /plan · /masterplan · /agent · /debug · /review</Text>
      </Box>
    </Box>
  );
}

function DetectedHostsPanel({ hosts }: { hosts: DetectedHost[] }): React.ReactElement | null {
  // Blue-bordered callout (distinct from the green wordmark / yellow
  // warnings) shown above the tips when at least one local CLI is on
  // PATH. Lead copy is in the *active* voice so the user immediately
  // understands these CLIs are already being used as primary routes -
  // they're not a passive "detected" notice.
  //
  // Each row is a single <Text> so Ink can wrap it as one block; an
  // earlier version used sibling <Text> elements which made ink wrap
  // mid-word ("/setu" + "p", "API" / "keys" on different lines).
  //
  // Disabled hosts (toggled off via /hosts) are still detected but
  // shown with a dim "skipped" marker so the user can see *why* their
  // local CLI isn't being used.
  const enabled = hosts.filter((h) => h.enabled);
  const disabled = hosts.filter((h) => !h.enabled);
  if (enabled.length === 0 && disabled.length === 0) return null;
  const headline = enabled.length > 0
    ? 'Using your local CLIs to route — no API keys needed'
    : 'All local CLIs are disabled — routing will use cloud APIs only';
  return (
    <Box
      borderStyle="round"
      borderColor="blue"
      paddingX={2}
      paddingY={0}
      marginBottom={1}
      flexDirection="column"
    >
      <Text bold color="blue">{headline}</Text>
      {enabled.map((h) => (
        <Text key={h.provider}>
          <Text color="blue" bold>{'  ✓ '}</Text>
          <Text bold>{h.cli}</Text>
          <Text color="gray">{`  —  ${h.label} · ${h.blurb}`}</Text>
        </Text>
      ))}
      {disabled.map((h) => (
        <Text key={h.provider} color="gray" dimColor>
          {`  · ${h.cli}  —  ${h.label} (disabled)`}
        </Text>
      ))}
      <Text color="gray">
        {'  '}
        <Text bold color="blue">/setup</Text>
        {' to toggle CLIs or add cloud API keys'}
      </Text>
    </Box>
  );
}

function SetupManagerPanel({
  rows,
  selectedIdx,
}: {
  rows: ManagerRow[];
  selectedIdx: number;
}): React.ReactElement {
  // One unified panel for both kinds of routing source. The split is
  // visual only (a "Local CLIs" subheader above the host rows and a
  // "Cloud API providers" subheader above the provider rows) - the
  // underlying selection cursor walks the flat list so up/down feels
  // like a single coherent menu.
  const hostRows = rows.filter((r): r is Extract<ManagerRow, { kind: 'host' }> => r.kind === 'host');
  const providerRows = rows.filter(
    (r): r is Extract<ManagerRow, { kind: 'provider' }> => r.kind === 'provider',
  );
  const selectedRow = rows[selectedIdx];

  // Column widths chosen to keep names + labels aligned across both
  // sections (longest cli is 'claude' = 6; longest provider is
  // 'openrouter' = 10).
  const nameWidth = 11;

  const hintForSelection = (): string => {
    if (!selectedRow) return '';
    if (selectedRow.kind === 'host') {
      return selectedRow.host.enabled
        ? 'space to disable this CLI'
        : 'space to re-enable this CLI';
    }
    return selectedRow.hasKey
      ? 'enter to replace key · del to remove'
      : 'enter to add API key';
  };

  return (
    <Box
      borderStyle="round"
      borderColor="blue"
      paddingX={2}
      paddingY={1}
      marginBottom={1}
      flexDirection="column"
    >
      <Text bold color="blue">Manage routing sources</Text>
      <Text color="gray">
        {'  Toggle the local CLIs and add or remove cloud API keys.'}
      </Text>

      {hostRows.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text bold color="gray">{'  LOCAL CLIs'}</Text>
          {hostRows.map((row) => {
            const flatIdx = rows.indexOf(row);
            const isSel = flatIdx === selectedIdx;
            const box = row.host.enabled ? '[x]' : '[ ]';
            return (
              <Text key={`h-${row.host.provider}`} color={isSel ? 'blue' : undefined} bold={isSel}>
                {isSel ? '  ▸ ' : '    '}
                <Text color={row.host.enabled ? 'green' : 'gray'}>{box}</Text>
                {'  '}
                <Text bold={row.host.enabled} dimColor={!row.host.enabled}>
                  {row.host.cli.padEnd(nameWidth)}
                </Text>
                <Text color="gray">{row.host.label}</Text>
                {!row.host.enabled && <Text color="gray" dimColor>{'  (disabled)'}</Text>}
              </Text>
            );
          })}
        </Box>
      )}

      <Box marginTop={1} flexDirection="column">
        <Text bold color="gray">{'  CLOUD API PROVIDERS'}</Text>
        {providerRows.map((row) => {
          const flatIdx = rows.indexOf(row);
          const isSel = flatIdx === selectedIdx;
          const box = row.hasKey ? '[✓]' : '[ ]';
          return (
            <Text key={`p-${row.provider.name}`} color={isSel ? 'blue' : undefined} bold={isSel}>
              {isSel ? '  ▸ ' : '    '}
              <Text color={row.hasKey ? 'green' : 'gray'}>{box}</Text>
              {'  '}
              <Text bold={row.hasKey}>{row.provider.name.padEnd(nameWidth)}</Text>
              <Text color="gray">{row.provider.label}</Text>
              {row.hasKey && <Text color="green">{'  key set'}</Text>}
            </Text>
          );
        })}
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text color="blue">{`  ${hintForSelection()}`}</Text>
        <Text color="gray">
          ↑ ↓ to move · esc to close
        </Text>
      </Box>
    </Box>
  );
}

function WizardConfirmPanel({ choice }: { choice: 'yes' | 'no' }): React.ReactElement {
  return (
    <Box
      borderStyle="round"
      borderColor="yellow"
      paddingX={2}
      paddingY={1}
      marginBottom={1}
      flexDirection="column"
    >
      <Text bold color="yellow">! No provider API key detected</Text>
      <Box marginTop={1} flexDirection="column">
        <Text color="gray">
          {'CodeRouter needs at least one provider key to run agent, planner, debug, or review modes.'}
        </Text>
        <Box marginTop={1}>
          <Text>Would you like to configure a provider now?</Text>
        </Box>
        <Box marginTop={1}>
          <Text>  </Text>
          <ConfirmButton label="Yes" selected={choice === 'yes'} />
          <Text>   </Text>
          <ConfirmButton label="No" selected={choice === 'no'} />
        </Box>
      </Box>
      <Box marginTop={1}>
        <Text color="gray">
          ← → to choose · enter to confirm · y / n for shortcut · esc to skip
        </Text>
      </Box>
    </Box>
  );
}

function ConfirmButton({
  label,
  selected,
}: {
  label: string;
  selected: boolean;
}): React.ReactElement {
  // Selected button is shown inverse-on-green so it pops against the
  // yellow panel; unselected is plain text with brackets so it still
  // reads as a clickable choice.
  if (selected) {
    return (
      <Text backgroundColor="green" color="black" bold>
        {`  ${label}  `}
      </Text>
    );
  }
  return <Text color="gray">{`  ${label}  `}</Text>;
}

function WizardKeyPanel({
  provider,
  maskedKey,
}: {
  provider: SetupProvider;
  maskedKey: string;
}): React.ReactElement {
  return (
    <Box
      borderStyle="round"
      borderColor="green"
      paddingX={2}
      paddingY={1}
      marginBottom={1}
      flexDirection="column"
    >
      <Text bold color="green">Paste your {provider.label} API key</Text>
      <Box marginTop={1} flexDirection="column">
        <Text color="gray">
          {'  expected format: '}
          <Text>{provider.example}</Text>
        </Text>
        <Box marginTop={1}>
          <Text color="green" bold>{'  > '}</Text>
          <Text>{maskedKey || ' '}</Text>
          <Text inverse> </Text>
        </Box>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text color="gray">{`will be saved to ${CREDENTIALS_PATH} (chmod 600)`}</Text>
        <Text color="gray">enter to save · esc to cancel</Text>
      </Box>
    </Box>
  );
}

function SuggestionsList({
  items,
  selectedIdx,
}: {
  items: CommandDef[];
  selectedIdx: number;
}): React.ReactElement {
  const nameWidth = Math.max(...items.map((i) => i.name.length), 10);
  const hintWidth = Math.max(...items.map((i) => i.hint.length), 0);
  return (
    <Box flexDirection="column" marginBottom={1} paddingX={1}>
      {items.map((s, i) => {
        const isSel = i === selectedIdx;
        // Unselected items use the terminal's default foreground (white-ish
        // on dark themes) so they read like Claude Code; only descriptions
        // stay dimmed. Selected item gets the brand-green accent.
        return (
          <Box key={s.name}>
            <Text color={isSel ? 'green' : undefined} bold={isSel}>
              {isSel ? '▸ ' : '  '}
              {'/' + s.name.padEnd(nameWidth + 1)}
            </Text>
            <Text color="gray">
              {s.hint.padEnd(hintWidth + 2)}
              {s.desc}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

function InputBox({
  value,
  cursor,
  busy,
  configured,
}: {
  value: string;
  cursor: number;
  busy: boolean;
  configured: boolean;
}): React.ReactElement {
  // Border color encodes session health: green while a run is in
  // flight, yellow when no provider is configured (so the user can't
  // miss it sitting in the chat), gray otherwise.
  const borderColor = busy ? 'green' : configured ? 'gray' : 'yellow';
  // The placeholder copy adapts to context. While a run is streaming we
  // hint that typing here will queue a follow-up; while idle we point
  // at /setup if no provider is configured, otherwise the standard
  // prompt-or-slash hint.
  const placeholder = busy
    ? 'type a follow-up to queue it (or esc to interrupt)'
    : configured
      ? 'prompt the agent — or type / for commands'
      : 'no provider configured — type /setup to add one (or / for commands)';
  return (
    <Box borderStyle="round" borderColor={borderColor} paddingX={1}>
      <Text color="green" bold>{'> '}</Text>
      {value.length === 0 ? (
        <Text>
          <Text inverse> </Text>
          <Text color="gray">{`  ${placeholder}`}</Text>
        </Text>
      ) : (
        renderInputWithCursor(value, cursor)
      )}
    </Box>
  );
}

function NoProviderReminder(): React.ReactElement {
  return (
    <Box marginBottom={1} paddingX={1}>
      <Text bold color="yellow">! </Text>
      <Text color="yellow">no provider configured</Text>
      <Text color="gray">{'  —  agent / plan / debug / review runs will fail until you '}</Text>
      <Text bold color="green">/setup</Text>
      <Text color="gray"> a provider key</Text>
    </Box>
  );
}

function StatusRow({
  mode,
  effort,
  apply,
  fast,
  security,
  apiKeys,
  hosts,
}: {
  mode: Mode;
  effort: Effort;
  apply: boolean;
  fast: boolean;
  security: 'warn' | 'block';
  apiKeys: string[];
  hosts: DetectedHost[];
}): React.ReactElement {
  const Sep = (): React.ReactElement => <Text color="gray">{'     '}</Text>;
  // Local CLIs come first because they're "free" routes the user
  // already paid for via their Codex/Claude subscriptions; the API
  // keys are the cloud fallback layer. Disabled hosts are hidden -
  // they're shown separately in the welcome panel + /hosts picker.
  const labels = [
    ...hosts.filter((h) => h.enabled).map((h) => h.cli),
    ...apiKeys,
  ];
  return (
    <Box>
      <Text color="gray">mode </Text>
      <Text bold>{mode}</Text>
      <Sep />
      <Text color="gray">effort </Text>
      <Text bold>{effort}</Text>
      <Sep />
      <Text color="gray">apply </Text>
      <Text bold color={apply ? 'green' : undefined}>{apply ? 'on' : 'off'}</Text>
      <Sep />
      <Text color="gray">fast </Text>
      <Text bold color={fast ? 'green' : undefined}>{fast ? 'on' : 'off'}</Text>
      <Sep />
      <Text color="gray">security </Text>
      <Text bold color={security === 'block' ? 'green' : undefined}>{security}</Text>
      <Sep />
      <Text color="gray">providers </Text>
      <Text bold color={labels.length > 0 ? 'green' : 'yellow'}>
        {labels.length > 0 ? labels.join(', ') : 'none'}
      </Text>
    </Box>
  );
}

function HintRow(): React.ReactElement {
  return (
    <Text color="gray">
      tab to complete   ·   /   for commands   ·   esc to clear
    </Text>
  );
}

function ProgressLine({
  frame,
  phase,
  elapsedMs,
}: {
  frame: number;
  phase: string;
  elapsedMs: number;
}): React.ReactElement {
  // Single dim line sitting directly under the input box. Mirrors the
  // Claude Code spinner: rotating braille frame + a verb + an elapsed
  // counter that ticks up while the run is in flight. We keep
  // everything inline (no Box border) so the layout doesn't shift when
  // the spinner appears/disappears.
  const label = phase || 'thinking';
  return (
    <Box paddingX={1}>
      <Text color="green">{SPINNER_FRAMES[frame % SPINNER_FRAMES.length]}</Text>
      <Text color="gray">{`  ${label}`}</Text>
      <Text color="gray" dimColor>{`   ·   ${formatElapsed(elapsedMs)}`}</Text>
    </Box>
  );
}

function formatElapsed(ms: number): string {
  if (ms < 1_000) return `${ms}ms`;
  const s = ms / 1_000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.floor(s % 60);
  return `${m}m${rem.toString().padStart(2, '0')}s`;
}

function renderInputWithCursor(value: string, cursor: number): React.ReactElement {
  const before = value.slice(0, cursor);
  const at = value[cursor] ?? ' ';
  const after = value.slice(cursor + 1);
  return (
    <Text>
      {before}
      <Text inverse>{at}</Text>
      {after}
    </Text>
  );
}

function mask(s: string): string {
  if (s.length === 0) return '';
  if (s.length <= 4) return '•'.repeat(s.length);
  // Show a short prefix so the user can spot a typo at the start of
  // their key without exposing the secret in scrollback.
  const prefix = s.slice(0, 4);
  return `${prefix}${'•'.repeat(s.length - 4)}`;
}

function renderHelp(): string {
  const nameW = Math.max(...COMMANDS.map((c) => c.name.length));
  const hintW = Math.max(...COMMANDS.map((c) => c.hint.length));
  const lines = ['commands:'];
  for (const c of COMMANDS) {
    lines.push(`  /${c.name.padEnd(nameW + 1)} ${c.hint.padEnd(hintW + 1)} ${c.desc}`);
  }
  return lines.join('\n');
}

function colorizeReportLine(line: string): React.ReactElement {
  // The metadata lines (run/cost/classified/route) no longer come out
  // of renderReportText - we only need to style the side-effect
  // sections (validators, files changed) and any escalation hint.
  if (line.startsWith('files changed') || line.startsWith('validators:')) {
    return <Text bold>{line}</Text>;
  }
  if (line.startsWith('hint:')) return <Text color="yellow">{line}</Text>;
  if (line.includes('PASS')) {
    const [pre, post] = line.split('PASS');
    return (
      <Text>
        {pre}
        <Text color="green" bold>PASS</Text>
        {post}
      </Text>
    );
  }
  if (line.includes('FAIL')) {
    const [pre, post] = line.split('FAIL');
    return (
      <Text>
        {pre}
        <Text color="red" bold>FAIL</Text>
        {post}
      </Text>
    );
  }
  if (line.includes('SKIP')) {
    const [pre, post] = line.split('SKIP');
    return (
      <Text>
        {pre}
        <Text color="yellow">SKIP</Text>
        {post}
      </Text>
    );
  }
  return <Text>{line}</Text>;
}

/**
 * Lightweight markdown renderer for streamed/finished model answers.
 * Recognises:
 *   - fenced code blocks (```...```), rendered as cyan plain text
 *   - ATX headers (#, ##, ###), bold cyan with underline for h1/h2
 *   - unordered list bullets (-, *) with a styled bullet glyph
 *   - inline **bold** and `code` runs
 * Anything else falls through as plain text. Intentionally tolerant -
 * malformed markdown never throws, we just render the literal source.
 */
function MarkdownBlock({ text }: { text: string }): React.ReactElement {
  const lines = text.split('\n');
  // Track whether we're inside a fenced code block as we walk lines top
  // to bottom; flipped on every ``` we encounter. Local mutable state
  // is fine here because each render is a fresh pass over `lines`.
  let inCode = false;
  return (
    <Box flexDirection="column">
      {lines.map((line, i) => {
        if (line.trimStart().startsWith('```')) {
          inCode = !inCode;
          return (
            <Text key={i} color="gray">
              {line}
            </Text>
          );
        }
        if (inCode) {
          return (
            <Text key={i} color="cyan">
              {line}
            </Text>
          );
        }
        return <MarkdownLine key={i} line={line} />;
      })}
    </Box>
  );
}

function MarkdownLine({ line }: { line: string }): React.ReactElement {
  const trimmed = line.trimStart();
  const leading = line.slice(0, line.length - trimmed.length);

  if (trimmed.startsWith('### ')) {
    return (
      <Text bold color="cyan">
        {leading}
        {trimmed.slice(4)}
      </Text>
    );
  }
  if (trimmed.startsWith('## ')) {
    return (
      <Text bold color="cyan" underline>
        {leading}
        {trimmed.slice(3)}
      </Text>
    );
  }
  if (trimmed.startsWith('# ')) {
    return (
      <Text bold color="cyan" underline>
        {leading}
        {trimmed.slice(2)}
      </Text>
    );
  }
  // Unordered bullet (-, *, +). Doesn't match e.g. **bold** at line start
  // because that needs whitespace after the marker.
  const bulletMatch = /^(\s*)[-*+]\s+(.*)$/.exec(line);
  if (bulletMatch) {
    return (
      <Text>
        {bulletMatch[1]}
        <Text color="cyan">{'• '}</Text>
        {renderInline(bulletMatch[2] ?? '')}
      </Text>
    );
  }
  // Ordered list - render as-is but with inline formatting.
  if (/^\s*\d+\.\s/.test(line)) {
    return <Text>{renderInline(line)}</Text>;
  }
  // Blockquote.
  if (trimmed.startsWith('> ')) {
    return (
      <Text color="gray" italic>
        {line}
      </Text>
    );
  }
  return <Text>{renderInline(line)}</Text>;
}

/**
 * Walk an inline-markdown string left to right, peeling off **bold**
 * and `code` runs into styled <Text> nodes. We intentionally don't
 * support nested emphasis (e.g. `**bold *with italic***`) because real
 * model output almost never uses it and a proper parser would dwarf
 * this file. Unclosed markers (`**foo` without a closing `**`) fall
 * through to plain text so partially-streamed lines render cleanly.
 */
function renderInline(text: string): React.ReactNode {
  if (!text) return text;
  const nodes: React.ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < text.length) {
    if (text.startsWith('**', i)) {
      const end = text.indexOf('**', i + 2);
      if (end === -1) {
        nodes.push(text.slice(i));
        break;
      }
      nodes.push(
        <Text key={key++} bold>
          {text.slice(i + 2, end)}
        </Text>,
      );
      i = end + 2;
      continue;
    }
    if (text[i] === '`') {
      const end = text.indexOf('`', i + 1);
      if (end === -1) {
        nodes.push(text.slice(i));
        break;
      }
      nodes.push(
        <Text key={key++} color="cyan">
          {text.slice(i + 1, end)}
        </Text>,
      );
      i = end + 1;
      continue;
    }
    // Skip ahead to the next markup marker (or end of string).
    let next = text.length;
    const b = text.indexOf('**', i);
    const c = text.indexOf('`', i);
    if (b !== -1) next = Math.min(next, b);
    if (c !== -1) next = Math.min(next, c);
    nodes.push(text.slice(i, next));
    i = next;
  }
  if (nodes.length === 0) return text;
  if (nodes.length === 1) return nodes[0];
  return <Fragment>{nodes}</Fragment>;
}

export async function runInkRepl(opts: AppProps): Promise<void> {
  const instance = render(<App {...opts} />);
  await instance.waitUntilExit();
}
