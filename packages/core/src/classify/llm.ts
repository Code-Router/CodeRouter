import type { Adapter } from '../adapters/types.js';
import { extractJsonBlock } from '../transformers/tooluse.js';
import type { CognitiveShape, TaskType } from '../types.js';
import type { ClassifierInput, ClassifierStageResult } from './types.js';

const SYSTEM_PROMPT = `You are a coding-task classifier.
Output STRICT JSON only, matching this schema:
{
  "taskType": "feature|bugfix|refactor|test|docs|investigation|review|trivial",
  "shape": {
    "deepReasoning": <0..1>,
    "multiFileTaste": <0..1>,
    "hugeContext": <0..1>,
    "adversarial": <0..1>,
    "algorithmic": <0..1>,
    "exploratory": <0..1>
  },
  "confidence": <0..1>,
  "rationale": "<one short sentence>"
}
No prose, no fences if possible; if you must, fence the JSON only.`;

const VALID_TASKS: TaskType[] = [
  'feature',
  'bugfix',
  'refactor',
  'test',
  'docs',
  'investigation',
  'review',
  'trivial',
];

/**
 * Stage 3: LLM judge. Called only when stages 1+2 are both inconclusive,
 * or when the caller forces it. Designed for a small, cheap model
 * (Haiku / GPT-4o-mini / DeepSeek-Chat). The system prompt + extract-
 * JSON pattern is the only way we get reliable structure from these
 * models at this size.
 */
export async function classifyByLLM(
  input: ClassifierInput,
  adapter: Adapter,
): Promise<ClassifierStageResult | null> {
  const prompt = `Classify the following coding task. Output ONLY the JSON object.\n\n---\n${input.prompt.slice(0, 4_000)}\n---`;
  const result = await adapter.run({
    prompt,
    systemPrompt: SYSTEM_PROMPT,
    maxTokens: 400,
  });
  const json = extractJsonBlock<{
    taskType?: string;
    shape?: Partial<CognitiveShape>;
    confidence?: number;
    rationale?: string;
  }>(result.text);
  if (!json) return null;
  const taskType = VALID_TASKS.includes(json.taskType as TaskType)
    ? (json.taskType as TaskType)
    : 'feature';
  const shape: CognitiveShape = {
    deepReasoning: clamp01(json.shape?.deepReasoning ?? 0.3),
    multiFileTaste: clamp01(json.shape?.multiFileTaste ?? 0.3),
    hugeContext: clamp01(json.shape?.hugeContext ?? 0.1),
    adversarial: clamp01(json.shape?.adversarial ?? 0.2),
    algorithmic: clamp01(json.shape?.algorithmic ?? 0.1),
    exploratory: clamp01(json.shape?.exploratory ?? 0.3),
  };
  return {
    stage: 'llm',
    confidence: clamp01(json.confidence ?? 0.6),
    taskType,
    shape,
    rationale: `llm:${(json.rationale ?? 'judge classification').slice(0, 240)}`,
  };
}

function clamp01(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
