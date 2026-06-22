import type { LoopPreset, LoopSafety, LoopSpec } from './types.js';

/**
 * Loop presets. Each preset is a safety/limits profile applied on top of
 * a generated spec, so users pick a posture ("Safe", "Aggressive", ...)
 * instead of hand-tuning numbers.
 */

const SECRET_FILES = [
  '.env',
  '.env.local',
  '.env.production',
  '.env.development',
  'credentials.json',
  '*.pem',
  'id_rsa',
];

const LOCKFILES = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'Cargo.lock', 'poetry.lock'];

export type PresetProfile = {
  label: string;
  description: string;
  limits: LoopSpec['limits'];
  safety: LoopSafety;
};

export const PRESETS: Record<LoopPreset, PresetProfile> = {
  safe: {
    label: 'Safe',
    description: 'Small edits only, no commits without approval, no network, tight caps. Best default.',
    limits: { maxIterations: 6, maxCostUsd: 2.5, maxFilesChanged: 6 },
    safety: {
      requireApprovalBeforeCommit: true,
      blockedFiles: [...SECRET_FILES, ...LOCKFILES],
      allowedPaths: [],
      allowNetwork: false,
    },
  },
  aggressive: {
    label: 'Aggressive',
    description: 'Can edit more files and refactor with a higher cost ceiling. For experienced users.',
    limits: { maxIterations: 12, maxCostUsd: 10, maxFilesChanged: 25 },
    safety: {
      requireApprovalBeforeCommit: true,
      blockedFiles: [...SECRET_FILES],
      allowedPaths: [],
      allowNetwork: false,
    },
  },
  'ci-repair': {
    label: 'CI Repair',
    description: 'Patch failing checks and stop when the verifier is green. Push only after approval.',
    limits: { maxIterations: 8, maxCostUsd: 5, maxFilesChanged: 15 },
    safety: {
      requireApprovalBeforeCommit: true,
      blockedFiles: [...SECRET_FILES, ...LOCKFILES],
      allowedPaths: [],
      allowNetwork: false,
    },
  },
  migration: {
    label: 'Migration',
    description: 'Larger changes verified module-by-module, with review after every step and milestone approvals.',
    limits: { maxIterations: 20, maxCostUsd: 25, maxFilesChanged: 60 },
    safety: {
      requireApprovalBeforeCommit: true,
      blockedFiles: [...SECRET_FILES],
      allowedPaths: [],
      allowNetwork: false,
    },
  },
};

/** Apply a preset's limits + safety onto a spec (spec values win when stricter). */
export function applyPreset(spec: LoopSpec, preset: LoopPreset): LoopSpec {
  const p = PRESETS[preset];
  return {
    ...spec,
    preset,
    limits: {
      maxIterations: Math.min(spec.limits?.maxIterations || p.limits.maxIterations, p.limits.maxIterations),
      maxCostUsd: Math.min(spec.limits?.maxCostUsd || p.limits.maxCostUsd, p.limits.maxCostUsd),
      maxFilesChanged: Math.min(spec.limits?.maxFilesChanged || p.limits.maxFilesChanged, p.limits.maxFilesChanged),
    },
    safety: {
      requireApprovalBeforeCommit: spec.safety?.requireApprovalBeforeCommit ?? p.safety.requireApprovalBeforeCommit,
      blockedFiles: Array.from(new Set([...(spec.safety?.blockedFiles ?? []), ...p.safety.blockedFiles])),
      allowedPaths: spec.safety?.allowedPaths?.length ? spec.safety.allowedPaths : p.safety.allowedPaths,
      allowNetwork: spec.safety?.allowNetwork ?? p.safety.allowNetwork,
    },
  };
}
