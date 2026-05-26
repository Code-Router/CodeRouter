import type { Report } from './types.js';

/**
 * Pure-string renderers (no ANSI). The CLI wraps these with kleur/chalk
 * colors; the MCP server emits the same strings unstyled.
 */

export function renderReportText(r: Report): string {
  const lines: string[] = [];
  lines.push(`run ${r.runId}  •  mode=${r.mode}  •  status=${r.status}`);
  lines.push('');
  lines.push(`prompt: ${truncate(r.prompt, 200)}`);
  lines.push('');

  if (r.classification) {
    lines.push(
      `classified as ${r.classification.taskType} (confidence ${r.classification.confidence.toFixed(2)}, via ${r.classification.source})`,
    );
  }
  if (r.routes.length > 0) {
    lines.push(`route: ${r.routes.map((rt) => `${rt.via ?? rt.provider},${rt.model}`).join(' -> ')}`);
  }
  if (r.rationale) lines.push(`why: ${r.rationale}`);
  lines.push('');

  lines.push(
    `cost: $${r.costUsd.toFixed(4)}  tokens in/out: ${r.tokensIn}/${r.tokensOut}  duration: ${r.durationMs.toFixed(0)}ms`,
  );

  if (r.validators.length > 0) {
    lines.push('');
    lines.push('validators:');
    for (const v of r.validators) {
      lines.push(`  ${pad(v.name, 10)} ${v.status.toUpperCase()}  (${v.command})`);
      const head = v.failures.slice(0, 3);
      for (const f of head) {
        const loc = f.file ? ` ${f.file}${f.line ? `:${f.line}` : ''}` : '';
        lines.push(`     - ${f.severity.toUpperCase()}${loc} ${f.rule ? `[${f.rule}] ` : ''}${truncate(f.message, 80)}`);
      }
      if (v.failures.length > head.length) {
        lines.push(`     ... and ${v.failures.length - head.length} more`);
      }
    }
  }

  if (r.filesChanged?.length) {
    lines.push('');
    lines.push(`files changed (${r.filesChanged.length}):`);
    for (const f of r.filesChanged.slice(0, 30)) lines.push(`  - ${f}`);
    if (r.filesChanged.length > 30) lines.push(`  ... and ${r.filesChanged.length - 30} more`);
  }

  if (r.citations?.length) {
    lines.push('');
    lines.push('citations:');
    for (const c of r.citations.slice(0, 8)) {
      lines.push(`  [${c.id}] ${truncate(c.title, 80)} (${c.source})`);
    }
  }

  if (r.escalationHint) {
    lines.push('');
    lines.push(`hint: ${r.escalationHint}`);
  }

  return lines.join('\n');
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n - 1)}...`;
}

export function renderReportJson(r: Report): string {
  return JSON.stringify(r, null, 2);
}
