/**
 * Build a lightweight "what's changing" preview for a file-editing tool
 * call, surfaced on the `tool_use` ActivityEvent so the UI can stream a
 * per-file change card the moment the agent decides to edit a file
 * (Cursor-style), before the authoritative worktree diff exists.
 *
 * The preview is intentionally NOT a real unified diff: for an
 * edit/replace we render the old text as `-` lines and the new text as
 * `+` lines; for a full write we render the content as `+` lines. It's a
 * readable approximation, size-capped so a huge write can't blow up the
 * IPC/SSE channel.
 */

export type EditPreview = { path?: string; patch?: string };

const EDIT_TOOLS = new Set([
  'edit',
  'edit_file',
  'write',
  'write_file',
  'multiedit',
  'multi_edit',
  'notebookedit',
]);

const MAX_PREVIEW_LINES = 80;

/** True when the tool name denotes a file-editing operation. */
export function isEditTool(tool: string): boolean {
  return EDIT_TOOLS.has(tool.toLowerCase());
}

/**
 * Produce `{ path, patch }` for edit-family tools. Tolerant of the
 * different argument shapes used by the first-party agent (`path`,
 * `old_string`/`new_string`, `edits`, `content`) and Claude Code
 * (`file_path`, ...). Returns `{}` for non-edit tools.
 */
export function buildEditPreview(tool: string, args: Record<string, unknown>): EditPreview {
  if (!isEditTool(tool)) return {};
  const str = (k: string): string | undefined => (typeof args[k] === 'string' ? (args[k] as string) : undefined);
  const path = str('file_path') ?? str('path') ?? str('filename');
  const t = tool.toLowerCase();

  let lines: string[] = [];
  if (t === 'write' || t === 'write_file') {
    const content = str('content') ?? str('contents') ?? '';
    lines = content ? content.split('\n').map((l) => `+${l}`) : [];
  } else if (t === 'multiedit' || t === 'multi_edit') {
    const edits = Array.isArray(args.edits) ? (args.edits as unknown[]) : [];
    const blocks: string[] = [];
    edits.forEach((raw, i) => {
      if (!raw || typeof raw !== 'object') return;
      const e = raw as Record<string, unknown>;
      const oldStr = typeof e.old_string === 'string' ? e.old_string : '';
      const newStr = typeof e.new_string === 'string' ? e.new_string : '';
      if (i > 0) blocks.push('@@');
      blocks.push(...changeLines(oldStr, newStr));
    });
    lines = blocks;
  } else {
    // edit / edit_file / notebookedit
    lines = changeLines(str('old_string') ?? '', str('new_string') ?? str('new_source') ?? '');
  }

  if (lines.length === 0) return { path };
  return { path, patch: clamp(lines, MAX_PREVIEW_LINES).join('\n') };
}

function changeLines(oldStr: string, newStr: string): string[] {
  const out: string[] = [];
  if (oldStr) for (const l of oldStr.split('\n')) out.push(`-${l}`);
  if (newStr) for (const l of newStr.split('\n')) out.push(`+${l}`);
  return out;
}

function clamp(lines: string[], max: number): string[] {
  if (lines.length <= max) return lines;
  return [...lines.slice(0, max), `… ${lines.length - max} more lines`];
}
