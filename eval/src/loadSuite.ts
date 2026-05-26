import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import type { EvalSuite } from './types.js';

export async function loadSuite(root: string): Promise<EvalSuite> {
  const path = join(root, 'tasks.yaml');
  const raw = await readFile(path, 'utf8');
  return parse(raw) as EvalSuite;
}
