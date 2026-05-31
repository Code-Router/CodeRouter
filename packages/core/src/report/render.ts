import type { Report } from './types.js';

/**
 * Pure-string renderers (no ANSI). The CLI wraps these with kleur/chalk
 * colors; the MCP server emits the same strings unstyled.
 */

export function renderReportText(r: Report, opts?: { includeText?: boolean }): string {
  const lines: string[] = [];
  const includeText = opts?.includeText ?? true;

  // The plain-text rendering is optimised for "read the answer fast";
  // bookkeeping (run id, mode, classification, route, rationale, cost)
  // lives on the Report struct for JSON consumers and in the store
  // but we don't show it inline.
  //
  // Things we *do* show inline: the model's text answer (when not
  // already streamed live to the caller), anything the model actually
  // changed (validators, files), and any escalation hint.

  if (includeText && r.text && r.text.trim().length > 0) {
    for (const ln of indent(r.text.trim(), '  ').slice(0, 400)) {
      lines.push(ln);
    }
  }

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
    const heading = r.applied
      ? `files changed (${r.filesChanged.length}) - applied:`
      : `files changed (${r.filesChanged.length}) - NOT applied (apply=off):`;
    lines.push(heading);
    for (const f of r.filesChanged.slice(0, 30)) lines.push(`  - ${f}`);
    if (r.filesChanged.length > 30) lines.push(`  ... and ${r.filesChanged.length - 30} more`);
    if (!r.applied && r.artifactDir) {
      lines.push('');
      lines.push(`  the worktree was discarded; the diff is preserved at:`);
      lines.push(`    ${r.artifactDir}/changes.patch`);
      lines.push(`  to keep the changes either:`);
      lines.push(`    - rerun with apply on (toggle via /apply on, then re-prompt), or`);
      lines.push(`    - apply the saved patch:  git apply ${r.artifactDir}/changes.patch`);
    }
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

  if (r.securityFindings && r.securityFindings.length > 0) {
    lines.push('');
    lines.push(`security: ${r.securityFindings.length} prompt-injection finding(s)`);
    // Show the first few inline so the user sees the worst hits
    // without scrolling. The full list is available on the Report
    // struct for JSON consumers / downstream tools.
    const head = r.securityFindings.slice(0, 5);
    for (const f of head) {
      const src = f.source ? ` (${f.source})` : '';
      lines.push(
        `  - ${f.severity.toUpperCase()} [${f.ruleId}]${src}  ${truncate(f.excerpt, 80)}`,
      );
    }
    if (r.securityFindings.length > head.length) {
      lines.push(`  ... and ${r.securityFindings.length - head.length} more`);
    }
  }

  return lines.join('\n');
}

/**
 * Render only the report's "post-text" sections (validators, files,
 * citations, escalation hint). Used by streaming UIs that have
 * already rendered `r.text` live and don't want it duplicated at
 * the end of the run.
 */
export function renderReportFooterText(r: Report): string {
  return renderReportText(r, { includeText: false });
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n - 1)}...`;
}

function indent(text: string, prefix: string): string[] {
  return text.split('\n').map((line) => prefix + line);
}

export function renderReportJson(r: Report): string {
  return JSON.stringify(r, null, 2);
}
