import { copyFileSync, existsSync, renameSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { SqliteRepository } from "./repository";

// Main owns the brief workspace lock and installs the replacement service.
// Candidates and recovery files remain available for diagnosis/manual recovery.
export async function restoreWorkspace(
  active: SqliteRepository,
  activePath: string,
  selectedPath: string,
  adopt: (repository: SqliteRepository) => void,
  openReplacement = (path: string) => new SqliteRepository(path, true),
): Promise<{ recoveryPath: string }> {
  if (resolve(activePath).toLowerCase() === resolve(selectedPath).toLowerCase())
    throw Error("Choose a saved backup, not the active database");
  const folder = dirname(activePath);
  const candidatePath = join(folder, `restore-${randomUUID()}.db`);
  copyFileSync(selectedPath, candidatePath);
  let candidate: SqliteRepository | undefined;
  try {
    candidate = new SqliteRepository(candidatePath, true);
    candidate.verifyAll();
    candidate.sqlite.pragma("wal_checkpoint(TRUNCATE)");
  } finally {
    candidate?.close();
  }
  const recoveryPath = join(folder, `recovery-${randomUUID()}.db`);
  await active.backup(recoveryPath);
  active.sqlite.pragma("wal_checkpoint(TRUNCATE)");
  active.close();
  const previousPath = join(folder, `previous-${randomUUID()}.db`);
  let replacement: SqliteRepository | undefined;
  try {
    renameSync(activePath, previousPath);
    renameSync(candidatePath, activePath);
    replacement = openReplacement(activePath);
    replacement.verifyAll();
    adopt(replacement);
  } catch (error) {
    if (replacement?.sqlite.open) {
      replacement.sqlite.pragma("wal_checkpoint(TRUNCATE)");
      replacement.close();
    }
    if (existsSync(previousPath)) {
      if (existsSync(activePath))
        renameSync(activePath, join(folder, `failed-${randomUUID()}.db`));
      renameSync(previousPath, activePath);
    }
    adopt(new SqliteRepository(activePath, true));
    throw error;
  }
  return { recoveryPath };
}
