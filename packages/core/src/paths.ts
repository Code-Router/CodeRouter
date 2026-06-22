import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * CodeRouter's per-user home directory. Holds machine-wide state that
 * isn't tied to a single repo: the project registry, plugin marketplace
 * cache, and global customize assets. Overridable via `CODEROUTER_HOME`
 * (primarily for tests).
 */
export function coderouterHome(): string {
  return process.env.CODEROUTER_HOME || join(homedir(), '.coderouter');
}
