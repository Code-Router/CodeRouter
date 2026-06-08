import type { AskUserQuestionPayload } from '../../adapters/types.js';
import type { Tool, ToolArgs } from '../types.js';
import { oneLine } from './helpers.js';

export const askUserQuestionTool: Tool = {
  name: 'ask_user_question',
  description:
    'Ask the user a clarifying question with multiple-choice options when requirements ' +
    'are ambiguous. The run will pause and the operator answers in the REPL. ' +
    'Each `questions[]` entry has the question text plus 2-4 `options` (label + ' +
    'description). Use this sparingly - prefer to make a reasonable assumption and ' +
    'mention it instead of stalling on every minor uncertainty.',
  parameters: {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        description: 'One or more questions to ask. Each must have `question` and `options`.',
        items: {
          type: 'object',
          properties: {
            question: { type: 'string' },
            header: { type: 'string', description: 'Short label, max 12 chars.' },
            multiSelect: {
              type: 'boolean',
              description: 'Allow the user to pick more than one option.',
            },
            options: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string' },
                  description: { type: 'string' },
                },
                required: ['label'],
              },
            },
          },
          required: ['question'],
        },
      },
    },
    required: ['questions'],
  },
  describe: (args) => {
    const questions = Array.isArray(args.questions) ? args.questions : [];
    const first = questions[0] as Record<string, unknown> | undefined;
    const text = first && typeof first.question === 'string' ? first.question : '';
    return text ? `Asked: ${oneLine(text, 80)}` : 'Asked the user a question';
  },
  run: async (args, ctx) => {
    const payload = parseAskUserQuestionArgs(args);
    if (payload.questions.length > 0 && ctx.onUserQuestion) {
      ctx.onUserQuestion(payload);
    }
    return {
      body: 'paused: question forwarded to the user; the run will abort and resume with the user reply',
      ok: true,
      display: 'awaiting user reply',
    };
  },
};

/** Best-effort parse of the tool args into the shared payload shape. */
function parseAskUserQuestionArgs(args: ToolArgs): AskUserQuestionPayload {
  const raw = args.questions;
  if (!Array.isArray(raw)) return { questions: [] };
  const out: AskUserQuestionPayload['questions'] = [];
  for (const q of raw) {
    if (!q || typeof q !== 'object') continue;
    const obj = q as Record<string, unknown>;
    const question = typeof obj.question === 'string' ? obj.question : null;
    if (!question) continue;
    const header = typeof obj.header === 'string' ? obj.header : undefined;
    const multiSelect = obj.multiSelect === true;
    const optsRaw = Array.isArray(obj.options) ? obj.options : [];
    const options: Array<{ label: string; description?: string }> = [];
    for (const o of optsRaw) {
      if (!o || typeof o !== 'object') continue;
      const oo = o as Record<string, unknown>;
      const label = typeof oo.label === 'string' ? oo.label : null;
      if (!label) continue;
      const description = typeof oo.description === 'string' ? oo.description : undefined;
      options.push(description !== undefined ? { label, description } : { label });
    }
    out.push({
      question,
      header,
      multiSelect,
      options: options.length > 0 ? options : undefined,
    });
  }
  return { questions: out };
}
