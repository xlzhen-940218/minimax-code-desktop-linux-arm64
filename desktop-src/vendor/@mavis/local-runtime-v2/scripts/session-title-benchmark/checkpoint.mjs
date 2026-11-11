import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export function checkpointIdentity(input) {
  return [input.schemaVersion, input.modelRef, input.promptSha256, input.corpusSha256].join(':');
}

export async function loadCheckpoint(path, expectedIdentity) {
  let raw;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }

  const checkpoint = JSON.parse(raw);
  const expected = checkpointIdentity(expectedIdentity);
  const actual = checkpoint.resumeKey ?? checkpointIdentity(checkpoint);
  if (actual !== expected) {
    throw new Error(
      `checkpoint resume identity mismatch: expected ${expected}, received ${actual}`,
    );
  }
  if (!Array.isArray(checkpoint.results)) {
    throw new Error('checkpoint results must be an array');
  }
  return checkpoint;
}

export async function saveCheckpoint(path, checkpoint) {
  await writeJsonAtomic(path, {
    ...checkpoint,
    resumeKey: checkpointIdentity(checkpoint),
  });
}

export async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const payload = `${JSON.stringify(value, null, 2)}\n`;
  try {
    await writeFile(temporaryPath, payload, { encoding: 'utf8', flag: 'wx' });
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}
