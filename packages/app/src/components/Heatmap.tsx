import React from 'react';
import type { HeatmapDay } from '../lib/api';
import { cls } from './common';

/** GitHub-style contribution grid with native-title tooltips. */
export function Heatmap({ days }: { days: HeatmapDay[] }): React.ReactElement {
  if (!days || days.length === 0) return <div className="text-sm text-muted">No activity yet.</div>;
  const max = Math.max(1, ...days.map((d) => d.runs));
  const level = (runs: number): number => {
    if (runs === 0) return 0;
    const r = runs / max;
    if (r > 0.66) return 4;
    if (r > 0.33) return 3;
    if (r > 0.1) return 2;
    return 1;
  };
  const colors = ['bg-panel2', 'bg-accent/30', 'bg-accent/50', 'bg-accent/70', 'bg-accent'];

  // Group into weeks (columns of 7). Assume `days` is chronological.
  const weeks: HeatmapDay[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  return (
    <div className="flex gap-[3px] overflow-x-auto">
      {weeks.map((w, wi) => (
        <div key={wi} className="flex flex-col gap-[3px]">
          {w.map((d) => (
            <div
              key={d.date}
              title={`${d.date}: ${d.runs} run${d.runs === 1 ? '' : 's'}`}
              className={cls('h-[11px] w-[11px] rounded-[2px]', colors[level(d.runs)])}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
