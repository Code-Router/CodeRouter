/**
 * Tests for ConversationHistory — multi-turn memory accumulation,
 * condensation trigger, message injection via priorMessages, and
 * /clear reset.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { ConversationHistory } from '../history.js';
import type { ChatTransport, ChatTurnRequest, ChatTurnResponse } from '../transport/types.js';

class FakeCondenseTransport implements ChatTransport {
  readonly kind = 'fake-condense';
  public calls: ChatTurnRequest[] = [];
  public summaryResponse = 'Summary of prior conversation.';

  async sendTurn(req: ChatTurnRequest): Promise<ChatTurnResponse> {
    this.calls.push(req);
    return {
      message: { role: 'assistant', content: this.summaryResponse },
      tokensIn: 100,
      tokensOut: 50,
    };
  }
}

describe('ConversationHistory', () => {
  let history: ConversationHistory;

  beforeEach(() => {
    history = new ConversationHistory();
  });

  it('starts empty', () => {
    expect(history.length()).toBe(0);
    expect(history.tokenCount()).toBe(0);
    expect(history.getMessages()).toEqual([]);
  });

  it('append accumulates messages and tracks tokens', () => {
    history.append([
      { role: 'user', content: 'hello world' },
      { role: 'assistant', content: 'hi there' },
    ]);
    expect(history.length()).toBe(2);
    expect(history.tokenCount()).toBeGreaterThan(0);
    expect(history.getMessages()).toHaveLength(2);
    expect(history.getMessages()[0]).toEqual({ role: 'user', content: 'hello world' });
  });

  it('getMessages returns a copy, not a reference', () => {
    history.append([{ role: 'user', content: 'test' }]);
    const msgs = history.getMessages();
    msgs.push({ role: 'assistant', content: 'injected' });
    expect(history.length()).toBe(1);
  });

  it('reset clears everything', () => {
    history.append([
      { role: 'user', content: 'something' },
      { role: 'assistant', content: 'response' },
    ]);
    expect(history.length()).toBe(2);
    history.reset();
    expect(history.length()).toBe(0);
    expect(history.tokenCount()).toBe(0);
    expect(history.getMessages()).toEqual([]);
  });

  describe('condense', () => {
    it('does nothing when under threshold', async () => {
      history.append([
        { role: 'user', content: 'short message' },
        { role: 'assistant', content: 'short reply' },
      ]);
      const transport = new FakeCondenseTransport();
      await history.condense(transport, 128_000);
      expect(transport.calls).toHaveLength(0);
      expect(history.length()).toBe(2);
    });

    it('condenses when over threshold, keeping recent messages', async () => {
      // Fill history with many messages to exceed the threshold.
      // With a tiny context window (100 tokens), even a few messages
      // will trigger condensation.
      const msgs = [];
      for (let i = 0; i < 30; i++) {
        msgs.push({ role: 'user' as const, content: `Message number ${i} with some padding text to take up tokens` });
        msgs.push({ role: 'assistant' as const, content: `Response number ${i} with additional padding` });
      }
      history.append(msgs);

      const transport = new FakeCondenseTransport();
      // Use a very small context window so threshold is easily exceeded.
      await history.condense(transport, 100, 0.75, 10);

      expect(transport.calls).toHaveLength(1);
      // After condensation: summary pair (2) + kept recent (10) = 12
      expect(history.length()).toBe(12);
      // First message should be the summary.
      const result = history.getMessages();
      expect(result[0]!.content).toContain('Summary of prior conversation');
      expect(result[1]!.content).toContain('Understood');
    });

    it('gracefully degrades on transport failure', async () => {
      const msgs = [];
      for (let i = 0; i < 30; i++) {
        msgs.push({ role: 'user' as const, content: `Msg ${i} padding padding padding padding` });
        msgs.push({ role: 'assistant' as const, content: `Reply ${i} padding padding padding` });
      }
      history.append(msgs);

      const transport: ChatTransport = {
        kind: 'failing',
        sendTurn: async () => { throw new Error('network error'); },
      };

      // Should not throw.
      await history.condense(transport, 100, 0.75, 10);
      // Falls back to keeping only recent messages.
      expect(history.length()).toBe(10);
    });

    it('does nothing when fewer messages than keepRecent', async () => {
      history.append([
        { role: 'user', content: 'a'.repeat(1000) },
        { role: 'assistant', content: 'b'.repeat(1000) },
      ]);
      const transport = new FakeCondenseTransport();
      // Even if tokens exceed threshold, if length <= keepRecent we skip.
      await history.condense(transport, 10, 0.75, 20);
      expect(transport.calls).toHaveLength(0);
    });
  });

  describe('integration with runAgent priorMessages', () => {
    it('messages from history can be injected as priorMessages', async () => {
      history.append([
        { role: 'user', content: 'first question' },
        { role: 'assistant', content: 'first answer' },
      ]);

      const priorMessages = history.getMessages();
      expect(priorMessages).toHaveLength(2);
      expect(priorMessages[0]!.role).toBe('user');
      expect(priorMessages[1]!.role).toBe('assistant');
    });
  });
});
