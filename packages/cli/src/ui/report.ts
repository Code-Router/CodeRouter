import type { Report } from '@coderouter/core';
import { renderReportText, renderReportJson } from '@coderouter/core';
import { c } from './colors.js';

/**
 * Colorized terminal report. Falls back to JSON when `--json` is set.
 */
export function printReport(report: Report, opts: { json?: boolean }): void {
  if (opts.json) {
    process.stdout.write(`${renderReportJson(report)}\n`);
    return;
  }
  const text = renderReportText(report);
  for (const line of text.split('\n')) {
    process.stdout.write(`${colorizeLine(line)}\n`);
  }
}

function colorizeLine(line: string): string {
  if (line.startsWith('run ')) return c.primary(line);
  if (line.startsWith('cost:')) return c.muted(line);
  if (line.startsWith('classified as')) return c.primaryDim(line);
  if (line.startsWith('route:')) return c.primary(line);
  if (line.startsWith('files changed')) return c.bold(line);
  if (line.startsWith('validators:')) return c.bold(line);
  if (line.includes('PASS')) return line.replace('PASS', c.primary('PASS'));
  if (line.includes('FAIL')) return line.replace('FAIL', c.err('FAIL'));
  if (line.includes('SKIP')) return line.replace('SKIP', c.warn('SKIP'));
  if (line.startsWith('hint:')) return c.warn(line);
  return line;
}
