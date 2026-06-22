/**
 * Conversation history for multi-turn REPL sessions.
 *
 * Stores messages across agent turns so the model has awareness of
 * prior work. Implements context-window-aware summarization: when
 * history grows past a threshold, older turns are condensed into a
 * compact summary via an LLM call (like Cursor's context condensation).
 */

import { encode as encodeTokens } from 'gpt-tokenizer';
import type { ChatMessage, ChatTransport, ContentBlock } from './transport/types.js';

const SUMMARIZE_SYSTEM = `You are a conversation summarizer. Summarize the preceding conversation history into a compact form. Preserve:
- All file paths mentioned or edited
- Key decisions and their rationale
- Current state of the task (what's done, what's left)
- Any errors encountered and their resolution
- Tool results that inform the current context
Be concise but lose nothing a coding assistant would need to continue the work.`;

/**
 * Extract the text content from a message, handling both plain string
 * and multimodal ContentBlock[] formats.
 */
function extractTextContent(msg: ChatMessage): string {
  if (msg.role === 'assistant') {
    return (msg.content ?? '') + (msg.tool_calls?.map((tc) => tc.function.arguments).join('') ?? '');
  }
  if (!('content' in msg)) return '';
  const c = (msg as { content: string | ContentBlock[] }).content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
  }
  return '';
}

/**
 * Approximate token count for a message. Uses gpt-tokenizer for the
 * content string; adds a small overhead for role/structure.
 */
function messageTokens(msg: ChatMessage): number {
  return encodeTokens(extractTextContent(msg)).length + 4;
}

/**
 * Replace image_url blocks in a user message with a lightweight
 * `[image: filename]` placeholder so base64 data isn't stored
 * indefinitely in conversation history.
 */
function stripImageBlocks(msg: ChatMessage): ChatMessage {
  if (msg.role !== 'user') return msg;
  const c = msg.content;
  if (typeof c === 'string' || !Array.isArray(c)) return msg;
  const stripped: ContentBlock[] = c.map((block) => {
    if (block.type === 'image_url') {
      const url = block.image_url.url;
      const name = url.startsWith('data:') ? 'inline-image' : url.split('/').pop() ?? 'image';
      return { type: 'text' as const, text: `[image: ${name}]` };
    }
    return block;
  });
  return { role: 'user', content: stripped };
}

export class ConversationHistory {
  private messages: ChatMessage[] = [];
  private tokens = 0;

  /** Current approximate token count of stored history. */
  tokenCount(): number {
    return this.tokens;
  }

  /** Number of stored messages. */
  length(): number {
    return this.messages.length;
  }

  /** Get full history to prepend into the next agent turn. */
  getMessages(): ChatMessage[] {
    return this.messages.slice();
  }

  /** Append messages from a completed turn (excludes system prompt). */
  append(msgs: ChatMessage[]): void {
    for (const m of msgs) {
      const stored = stripImageBlocks(m);
      this.messages.push(stored);
      this.tokens += messageTokens(stored);
    }
  }

  /** Clear all history (e.g. on /clear). */
  reset(): void {
    this.messages = [];
    this.tokens = 0;
  }

  /**
   * If history exceeds the threshold, condense older turns into a
   * summary. Keeps the most recent `keepRecent` messages verbatim so
   * the model can handle immediate follow-ups.
   *
   * @param transport - LLM transport to use for the summarization call
   * @param contextWindow - model's total context window in tokens
   * @param threshold - fraction of context window that triggers condensation (default 0.75)
   * @param keepRecent - number of recent messages to keep verbatim (default 20)
   */
  async condense(
    transport: ChatTransport,
    contextWindow: number,
    threshold = 0.75,
    keepRecent = 20,
  ): Promise<void> {
    const limit = Math.floor(contextWindow * threshold);
    if (this.tokens <= limit) return;
    if (this.messages.length <= keepRecent) return;

    const toSummarize = this.messages.slice(0, this.messages.length - keepRecent);
    const kept = this.messages.slice(this.messages.length - keepRecent);

    // Build a text representation of the old messages for summarization.
    const historyText = toSummarize
      .map((m) => {
        if (m.role === 'system') return `[system] ${m.content}`;
        if (m.role === 'user') return `[user] ${m.content}`;
        if (m.role === 'tool') return `[tool result] ${m.content.slice(0, 500)}`;
        // assistant
        const content = m.content ?? '';
        const tools = m.tool_calls?.map((tc) => `${tc.function.name}(${tc.function.arguments.slice(0, 200)})`).join(', ') ?? '';
        return `[assistant] ${content}${tools ? ` | tools: ${tools}` : ''}`;
      })
      .join('\n');

    try {
      const result = await transport.sendTurn({
        messages: [
          { role: 'system', content: SUMMARIZE_SYSTEM },
          { role: 'user', content: `Here is the conversation history to summarize:\n\n${historyText}` },
        ],
        tools: [],
      });

      const summary = result.message.content ?? '(conversation history)';

      // Replace history with summary pair + kept messages.
      this.messages = [
        { role: 'user', content: `[Prior conversation summary]\n${summary}` },
        { role: 'assistant', content: 'Understood. I have full context from our prior conversation and will continue from here.' },
        ...kept,
      ];
    } catch {
      // Summarization failed (network error, etc.) — graceful
      // degradation: just keep the recent messages and drop old ones.
      this.messages = kept;
    }

    // Recompute token count.
    this.tokens = 0;
    for (const m of this.messages) {
      this.tokens += messageTokens(m);
    }
  }
}
