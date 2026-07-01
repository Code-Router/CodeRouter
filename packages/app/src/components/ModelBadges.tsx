import React from 'react';
import { cls } from './common';

/**
 * Split a route label into its provider and model parts. Recent-run
 * routes are `provider,model`; the `byProvider` breakdown uses
 * `provider · model`. Falls back to treating the whole string as a model.
 */
export function splitRoute(label: string): { provider: string; model: string } {
  const sep = label.includes(' · ') ? ' · ' : label.includes(',') ? ',' : '';
  if (!sep) return { provider: '', model: label };
  const idx = label.indexOf(sep);
  return { provider: label.slice(0, idx).trim(), model: label.slice(idx + sep.length).trim() };
}

/**
 * Shorten a provider handle for a compact chip: keep the recognizable
 * vendor and drop CodeRouter's routing suffixes (e.g. `openrouter_agent`
 * -> `openrouter`, `anthropic` -> `anthropic`).
 */
function shortProvider(provider: string): string {
  return provider.replace(/[_-](agent|chat|code|cli)$/i, '');
}

/** One model chip: dim provider prefix + prominent model name. */
function ModelChip({ label }: { label: string }): React.ReactElement {
  const { provider, model } = splitRoute(label);
  return (
    <span
      className="inline-flex max-w-full items-baseline gap-1 rounded-md border border-border bg-panel2 px-1.5 py-0.5"
      title={label}
    >
      {provider && <span className="shrink-0 text-[10px] text-muted/70">{shortProvider(provider)}</span>}
      <span className="truncate font-mono text-[11px] text-text/90">{model || '—'}</span>
    </span>
  );
}

/**
 * Render the set of models a run used. A single task frequently fans out
 * across several models (classifier judge, main agent, escalated fixer),
 * so we show each as its own chip and collapse the overflow into a
 * "+N" pill (hover reveals the full list).
 */
export function ModelBadges({
  routes,
  max = 3,
  className,
}: {
  routes: string[];
  max?: number;
  className?: string;
}): React.ReactElement {
  const list = routes.filter(Boolean);
  if (list.length === 0) return <span className="text-xs text-muted/70">—</span>;
  const visible = list.slice(0, max);
  const overflow = list.length - visible.length;
  return (
    <span className={cls('flex min-w-0 flex-wrap items-center gap-1', className)}>
      {visible.map((r, i) => (
        <ModelChip key={`${r}-${i}`} label={r} />
      ))}
      {overflow > 0 && (
        <span
          className="shrink-0 rounded-md border border-border bg-panel2 px-1.5 py-0.5 text-[10px] text-muted"
          title={list.slice(max).join('\n')}
        >
          +{overflow}
        </span>
      )}
    </span>
  );
}
