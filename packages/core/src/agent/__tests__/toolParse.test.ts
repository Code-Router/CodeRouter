import { describe, expect, it } from 'vitest';
import { parseTextualToolCalls } from '../orchestrator/toolParse.js';

const known = new Set(['web_search', 'read_file', 'write_file']);

describe('parseTextualToolCalls', () => {
  it('returns nothing for plain prose', () => {
    const r = parseTextualToolCalls('Here is a normal answer with no calls.', known);
    expect(r.toolCalls).toHaveLength(0);
    expect(r.cleanedContent).toBe('Here is a normal answer with no calls.');
  });

  it('parses the Qwen <function=>/<parameter=> XML format', () => {
    const content = [
      'Let me search for that.',
      '<tool_call>',
      '<function=web_search>',
      '<parameter=limit>',
      '5',
      '</parameter>',
      '<parameter=query>',
      'ISO 3166-1 numeric country codes',
      '</parameter>',
      '</function>',
      '</tool_call>',
    ].join('\n');
    const r = parseTextualToolCalls(content, known);
    expect(r.toolCalls).toHaveLength(1);
    expect(r.toolCalls[0]!.function.name).toBe('web_search');
    const args = JSON.parse(r.toolCalls[0]!.function.arguments);
    expect(args).toEqual({ limit: 5, query: 'ISO 3166-1 numeric country codes' });
    // The block is stripped; the lead-in prose survives.
    expect(r.cleanedContent).toBe('Let me search for that.');
  });

  it('parses the Hermes/Qwen JSON format', () => {
    const content =
      'thinking...\n<tool_call>\n{"name": "read_file", "arguments": {"path": "index.html"}}\n</tool_call>';
    const r = parseTextualToolCalls(content, known);
    expect(r.toolCalls).toHaveLength(1);
    expect(r.toolCalls[0]!.function.name).toBe('read_file');
    expect(JSON.parse(r.toolCalls[0]!.function.arguments)).toEqual({ path: 'index.html' });
  });

  it('tolerates a missing closing tag (model stopped at budget)', () => {
    const content = '<tool_call>\n<function=web_search>\n<parameter=query>\nhello\n';
    const r = parseTextualToolCalls(content, known);
    expect(r.toolCalls).toHaveLength(1);
    expect(JSON.parse(r.toolCalls[0]!.function.arguments)).toEqual({ query: 'hello' });
  });

  it('handles a bare <function=> block without the <tool_call> wrapper', () => {
    const content = '<function=read_file><parameter=path>a.txt</parameter></function>';
    const r = parseTextualToolCalls(content, known);
    expect(r.toolCalls).toHaveLength(1);
    expect(r.toolCalls[0]!.function.name).toBe('read_file');
  });

  it('parses multiple calls in one message', () => {
    const content =
      '<tool_call>{"name":"read_file","arguments":{"path":"a"}}</tool_call>' +
      '<tool_call>{"name":"read_file","arguments":{"path":"b"}}</tool_call>';
    const r = parseTextualToolCalls(content, known);
    expect(r.toolCalls).toHaveLength(2);
    expect(JSON.parse(r.toolCalls[1]!.function.arguments)).toEqual({ path: 'b' });
  });

  it('ignores calls to unknown tools when a known-tool set is given', () => {
    const content = '<tool_call>{"name":"not_a_tool","arguments":{}}</tool_call>';
    const r = parseTextualToolCalls(content, known);
    expect(r.toolCalls).toHaveLength(0);
  });

  it('coerces typed parameter values', () => {
    const content =
      '<function=web_search><parameter=limit>3</parameter><parameter=flag>true</parameter></function>';
    const r = parseTextualToolCalls(content, known);
    const args = JSON.parse(r.toolCalls[0]!.function.arguments);
    expect(args).toEqual({ limit: 3, flag: true });
  });
});
