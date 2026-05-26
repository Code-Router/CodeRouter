import type { AdapterCapabilities, ProviderId } from '../types.js';

export type AdapterCallInput = {
  prompt: string;
  systemPrompt?: string;
  cwd?: string;
  maxTokens?: number;
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
  transformer?: string[];
  files?: string[];
  contextManifest?: import('../types.js').ContextManifest;
  signal?: AbortSignal;
};

export type AdapterCallResult = {
  text: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  durationMs: number;
  filesChanged?: string[];
  raw?: unknown;
};

export type Adapter = {
  id: ProviderId;
  name: string;
  capabilities: AdapterCapabilities;
  run: (input: AdapterCallInput) => Promise<AdapterCallResult>;
  plan?: (input: AdapterCallInput) => Promise<AdapterCallResult>;
  score?: (input: AdapterCallInput) => Promise<number>;
  estimateCost: (tokensIn: number, tokensOut: number) => number;
};
