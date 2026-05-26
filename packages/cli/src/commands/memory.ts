import { writeFile, readFile } from 'node:fs/promises';
import { loadProjectMemory, openStore, resolveDbPath } from '@coderouter/core';
import { c } from '../ui/colors.js';

export type MemoryOpts = {
  action: string;
  key?: string;
  cwd: string;
};

/**
 * `coderouter memory <action>`
 *
 *   show         summarize loaded project memory + recent runs
 *   forget <k>   delete a project fact by key
 *   reset        drop the local L5 database (.coderouter/memory.db)
 *   export [p]   dump store contents as JSON (default stdout)
 *   import <p>   restore from an export JSON file
 */
export async function runMemoryCommand(opts: MemoryOpts): Promise<void> {
  switch (opts.action) {
    case 'show':
      await showMemory(opts.cwd);
      return;
    case 'forget':
      await forgetFact(opts.cwd, opts.key);
      return;
    case 'reset':
      await resetMemory(opts.cwd);
      return;
    case 'export':
      await exportMemory(opts.cwd, opts.key);
      return;
    case 'import':
      await importMemory(opts.cwd, opts.key);
      return;
    default:
      process.stderr.write(`unknown memory action: ${opts.action}\n`);
      process.exit(2);
  }
}

async function showMemory(cwd: string): Promise<void> {
  const projectMem = await loadProjectMemory(cwd);
  process.stdout.write(`${c.bold('project memory files:')}\n`);
  for (const f of projectMem.fragments) {
    process.stdout.write(`  ${c.primaryDim(f.source.padEnd(12))} ${f.path}\n`);
  }
  process.stdout.write(`\n${c.bold('extracted facts:')}\n`);
  for (const [k, v] of Object.entries(projectMem.facts)) {
    process.stdout.write(`  ${c.muted(k)} = ${String(v)}\n`);
  }

  try {
    const store = await openStore(resolveDbPath(cwd));
    const runs = store.runs.list(10);
    process.stdout.write(`\n${c.bold(`recent runs (${runs.length}):`)}\n`);
    for (const r of runs) {
      process.stdout.write(
        `  ${new Date(r.createdAt).toISOString()}  ${r.mode}  ${r.status}  ${r.routes
          .map((rt) => `${rt.via ?? rt.provider},${rt.model}`)
          .join('+')}\n`,
      );
    }
    process.stdout.write(`\n${c.bold('learned examples:')} ${store.learned.count()}\n`);
    store.db.close();
  } catch {
    process.stdout.write(c.muted('\n  (no local store yet)\n'));
  }
}

async function forgetFact(cwd: string, key: string | undefined): Promise<void> {
  if (!key) {
    process.stderr.write('error: forget requires <key>\n');
    process.exit(2);
  }
  const store = await openStore(resolveDbPath(cwd));
  store.facts.delete(key);
  store.db.close();
  process.stdout.write(c.muted(`  forgot ${key}\n`));
}

async function resetMemory(cwd: string): Promise<void> {
  const path = resolveDbPath(cwd);
  try {
    const { unlink } = await import('node:fs/promises');
    await unlink(path);
    process.stdout.write(c.muted(`  removed ${path}\n`));
  } catch (err: unknown) {
    process.stderr.write(`  reset failed: ${(err as Error).message}\n`);
  }
}

async function exportMemory(cwd: string, dest: string | undefined): Promise<void> {
  const store = await openStore(resolveDbPath(cwd));
  const dump = {
    facts: store.facts.list(),
    overrides: store.overrides.list(),
    runs: store.runs.list(500),
    learnedExamples: store.learned.list(500),
  };
  store.db.close();
  const json = JSON.stringify(dump, null, 2);
  if (dest && dest !== '-') {
    await writeFile(dest, json, 'utf8');
    process.stdout.write(c.muted(`  exported to ${dest}\n`));
  } else {
    process.stdout.write(`${json}\n`);
  }
}

async function importMemory(cwd: string, source: string | undefined): Promise<void> {
  if (!source) {
    process.stderr.write('error: import requires <path>\n');
    process.exit(2);
  }
  const raw = await readFile(source, 'utf8');
  const data = JSON.parse(raw) as {
    facts?: Array<{ key: string; value: string }>;
    overrides?: Array<{ pattern: string; route: string }>;
    learnedExamples?: Array<unknown>;
  };
  const store = await openStore(resolveDbPath(cwd));
  if (data.facts) {
    for (const f of data.facts) store.facts.set(f.key, f.value, 'import');
  }
  if (data.overrides) {
    for (const o of data.overrides) {
      store.overrides.add({ promptPattern: o.pattern, route: o.route, reason: 'imported' });
    }
  }
  store.db.close();
  process.stdout.write(c.muted(`  imported from ${source}\n`));
}
