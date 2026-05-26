import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Static, Text, render, useApp, useInput } from 'ink';
import type { Mode, ProgressNotifier } from '@coderouter/core';
import { renderReportText } from '@coderouter/core';
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
  saveCredential,
} from './setup.js';

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
  { name: 'setup', hint: '', desc: 'configure provider API keys' },
  { name: 'effort', hint: 'low|medium|high|max', desc: 'set planner/agent effort' },
  { name: 'apply', hint: '', desc: 'toggle: apply diff on success' },
  { name: 'fast', hint: '', desc: 'toggle: skip classifier/context' },
  { name: 'clear', hint: '', desc: 'clear scrollback' },
  { name: 'help', hint: '', desc: 'show this help' },
  { name: 'exit', hint: '', desc: 'quit the REPL' },
];

const MODE_COMMANDS = new Set(['plan', 'masterplan', 'agent', 'debug', 'review']);

type HistoryItem =
  | { id: number; kind: 'user'; text: string }
  | { id: number; kind: 'system'; text: string; tone?: 'info' | 'warn' | 'error' | 'success' }
  | { id: number; kind: 'report'; text: string };

type WizardStep = 'idle' | 'confirm' | 'pick' | 'key';

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

  const [history, setHistory] = useState<HistoryItem[]>([]);
  const idRef = useRef(0);
  const [input, setInput] = useState('');
  const [cursor, setCursor] = useState(0);
  const [mode, setMode] = useState<Mode>(initialMode ?? 'agent');
  const [effort, setEffort] = useState<Effort>(initialMode === 'masterplan' ? 'high' : 'medium');
  const [apply, setApply] = useState(false);
  const [fast, setFast] = useState(false);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState('');
  const [suggIdx, setSuggIdx] = useState(0);

  // Force the setup flow on first run when there's no usable provider
  // key. The wizard owns input until the user either configures a key
  // or explicitly skips, so they can't accidentally try /agent against
  // an empty registry.
  const [wizardStep, setWizardStep] = useState<WizardStep>(
    setupState.configured ? 'idle' : 'confirm',
  );
  const [wizardPick, setWizardPick] = useState(0);
  const [wizardKey, setWizardKey] = useState('');
  // Highlighted button in the yes/no confirm. Arrows move between
  // 'yes' and 'no'; enter activates the highlighted one. 'y' / 'n' also
  // work as direct shortcuts for users who already know the answer.
  const [confirmChoice, setConfirmChoice] = useState<'yes' | 'no'>('yes');
  // Once the user has explicitly declined the setup confirm, don't keep
  // re-popping the yellow "no key" panel - that looks identical to the
  // confirm and makes it feel like `n` did nothing.
  const [setupDismissed, setSetupDismissed] = useState(false);

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
    appendHistory({ id: idRef.current++, kind: 'report', text });
  }

  async function dispatch(prompt: string, modeOverride?: Mode): Promise<void> {
    const m = modeOverride ?? mode;
    setBusy(true);
    setPhase('preparing');
    const notifier: ProgressNotifier = (u) => {
      const head = u.phase.replace(/^[a-z]+\//, '').replace(/_/g, ' ');
      const tail = u.message ? ` · ${u.message}` : '';
      setPhase(`${head} · ${u.stage}${tail}`);
    };
    try {
      const { report, store } = await executeRun({
        prompt,
        cwd,
        mode: m,
        effort,
        apply,
        fast,
        progress: { notifier, close: () => {} },
      });
      pushReport(renderReportText(report));
      try {
        store.db.close();
      } catch {
        // best-effort
      }
    } catch (err) {
      pushSystem(`  error: ${(err as Error).message}`, 'error');
    } finally {
      setBusy(false);
      setPhase('');
    }
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

  function skipSetup(): void {
    setWizardStep('idle');
    setWizardKey('');
    setSetupDismissed(true);
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
    const provider = SETUP_PROVIDERS[wizardPick];
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
    setWizardStep('idle');
    setWizardKey('');
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
    if (busy) return;

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

    // Wizard: provider picker
    if (wizardStep === 'pick') {
      if (key.escape) {
        cancelWizard();
        return;
      }
      if (key.upArrow) {
        setWizardPick((i) => (i - 1 + SETUP_PROVIDERS.length) % SETUP_PROVIDERS.length);
        return;
      }
      if (key.downArrow) {
        setWizardPick((i) => (i + 1) % SETUP_PROVIDERS.length);
        return;
      }
      if (key.return) {
        setWizardStep('key');
        setWizardKey('');
        return;
      }
      return;
    }

    // Wizard: api key entry (masked)
    if (wizardStep === 'key') {
      if (key.escape) {
        cancelWizard();
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

    // Normal command/prompt input. Enter always submits; users autocomplete
    // from the slash menu with Tab.
    if (key.return) {
      const line = input.trim();
      if (!line) return;
      setInput('');
      setCursor(0);
      void submit(line);
      return;
    }

    if (showSuggestions && (key.upArrow || key.downArrow)) {
      const max = suggestions.length;
      if (max === 0) return;
      setSuggIdx((i) => (key.upArrow ? (i - 1 + max) % max : (i + 1) % max));
      return;
    }

    if (key.tab) {
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

    if (key.escape) {
      setInput('');
      setCursor(0);
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

  const showWelcome = history.length === 0;

  return (
    <Box flexDirection="column">
      <Static items={history}>
        {(item) => (
          <Box key={item.id} flexDirection="column" marginBottom={1}>
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

      {showWelcome && <WelcomePanel mode={mode} />}
      {showWelcome && !setupState.configured && !setupDismissed && wizardStep === 'idle' && (
        <SetupHint />
      )}

      {busy && (
        <Box marginBottom={1}>
          <Text color="green">✱ </Text>
          <Text color="gray">{phase || 'thinking…'}</Text>
        </Box>
      )}

      {wizardStep === 'confirm' && <WizardConfirmPanel choice={confirmChoice} />}
      {wizardStep === 'pick' && <WizardPickPanel selectedIdx={wizardPick} />}
      {wizardStep === 'key' && (
        <WizardKeyPanel provider={SETUP_PROVIDERS[wizardPick]!} maskedKey={mask(wizardKey)} />
      )}

      {showSuggestions && !busy && suggestions.length > 0 && (
        <SuggestionsList items={suggestions} selectedIdx={suggIdx} />
      )}

      {/* The chatbox + status/hint footer are intentionally hidden while
          the wizard owns input. Bringing them back at this point would
          just confuse — the wizard panels already carry their own hints. */}
      {wizardStep === 'idle' && (
        <>
          <InputBox value={input} cursor={cursor} busy={busy} />
          <Box marginTop={1} paddingX={1} flexDirection="column">
            <StatusRow mode={mode} effort={effort} apply={apply} fast={fast} ready={setupState.ready} />
            <HintRow />
          </Box>
        </>
      )}
    </Box>
  );
}

function WelcomePanel({ mode }: { mode: Mode }): React.ReactElement {
  const width = process.stdout.columns ?? 80;
  // Pixel-block wordmark needs ~96 cols once you account for the Box's
  // border + padding; fall back to the compact ANSI wordmark below that.
  const wordmark = width >= 102 ? WORDMARK_PIXEL : WORDMARK_SMALL;
  const wordmarkLines = wordmark.split('\n');
  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
      <Box flexDirection="column" marginBottom={1}>
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
      <Box
        borderStyle="round"
        borderColor="green"
        paddingX={2}
        paddingY={1}
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
    </Box>
  );
}

function SetupHint(): React.ReactElement {
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
          {'CodeRouter needs at least one provider key to run agent / planner / debug modes.'}
        </Text>
        <Text>
          <Text color="gray">{'Run '}</Text>
          <Text bold color="green">/setup</Text>
          <Text color="gray">{' to paste a key — or export one of:'}</Text>
        </Text>
        <Text color="gray">
          {'  '}
          {SETUP_PROVIDERS.map((p) => `$${p.envVar}`).join('  ')}
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

function WizardPickPanel({ selectedIdx }: { selectedIdx: number }): React.ReactElement {
  const nameW = Math.max(...SETUP_PROVIDERS.map((p) => p.label.length));
  return (
    <Box
      borderStyle="round"
      borderColor="green"
      paddingX={2}
      paddingY={1}
      marginBottom={1}
      flexDirection="column"
    >
      <Text bold color="green">Pick a provider to configure</Text>
      <Box marginTop={1} flexDirection="column">
        {SETUP_PROVIDERS.map((p, i) => {
          const isSel = i === selectedIdx;
          return (
            <Box key={p.name}>
              <Text color={isSel ? 'green' : undefined} bold={isSel}>
                {isSel ? '▸ ' : '  '}
                {p.label.padEnd(nameW + 2)}
              </Text>
              <Text color="gray">{`$${p.envVar}`}</Text>
            </Box>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text color="gray">↑ ↓ to move · enter to choose · esc to cancel</Text>
      </Box>
    </Box>
  );
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
}: {
  value: string;
  cursor: number;
  busy: boolean;
}): React.ReactElement {
  return (
    <Box borderStyle="round" borderColor={busy ? 'green' : 'gray'} paddingX={1}>
      <Text color="green" bold>{'> '}</Text>
      {busy ? (
        <Text color="gray">{value || 'working…'}</Text>
      ) : value.length === 0 ? (
        <Text>
          <Text inverse> </Text>
          <Text color="gray">{'  try "/agent rename getCwd" — or type / to browse commands'}</Text>
        </Text>
      ) : (
        renderInputWithCursor(value, cursor)
      )}
    </Box>
  );
}

function StatusRow({
  mode,
  effort,
  apply,
  fast,
  ready,
}: {
  mode: Mode;
  effort: Effort;
  apply: boolean;
  fast: boolean;
  ready: string[];
}): React.ReactElement {
  const Sep = (): React.ReactElement => <Text color="gray">{'     '}</Text>;
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
      <Text color="gray">providers </Text>
      <Text bold color={ready.length > 0 ? 'green' : 'yellow'}>
        {ready.length > 0 ? ready.join(', ') : 'none'}
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
  if (line.startsWith('run ')) return <Text color="green" bold>{line}</Text>;
  if (line.startsWith('cost:')) return <Text color="gray">{line}</Text>;
  if (line.startsWith('classified as')) return <Text color="green">{line}</Text>;
  if (line.startsWith('route:')) return <Text color="green" bold>{line}</Text>;
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

export async function runInkRepl(opts: AppProps): Promise<void> {
  const instance = render(<App {...opts} />);
  await instance.waitUntilExit();
}
