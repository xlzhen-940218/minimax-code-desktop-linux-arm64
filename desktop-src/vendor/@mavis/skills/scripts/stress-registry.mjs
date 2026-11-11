#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { SkillRegistry, renderAvailableSkillsCatalog } from '../dist/index.js';

const sourceKinds = ['project', 'workspace', 'agent', 'global', 'user', 'builtin'];
const rootCount = numberArg('--roots', 24);
const skillsPerRoot = numberArg('--skills-per-root', 100);
const invalidPerRoot = numberArg('--invalid-per-root', 2);
const writeBatchSize = numberArg('--write-batch-size', 256);
const keepTemp = process.argv.includes('--keep-temp');
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mavis-skills-stress-'));

try {
  const roots = Array.from({ length: rootCount }, (_unused, index) => ({
    id: `stress-${index}`,
    kind: sourceKinds[index % sourceKinds.length],
    rootPath: path.join(tempDir, `root-${String(index).padStart(3, '0')}`),
    priority: index,
  }));
  const skillNames = Array.from(
    { length: skillsPerRoot },
    (_unused, index) => `shared-${String(index).padStart(4, '0')}`,
  );
  const totalFiles = rootCount * (skillsPerRoot + invalidPerRoot);

  await writeInBatches(
    roots.flatMap((root, rootIndex) => [
      ...skillNames.map(
        (name) => () =>
          writeSkill(
            root.rootPath,
            name,
            `---\nname: ${name}\ndescription: ${root.id} ${name} description.\n---\n# ${name}\n`,
          ),
      ),
      ...Array.from(
        { length: invalidPerRoot },
        (_unused, invalidIndex) => () =>
          writeSkill(
            root.rootPath,
            `invalid-${rootIndex}-${invalidIndex}`,
            `---\nname: invalid-${rootIndex}-${invalidIndex}\nnot-yaml\n# Invalid\n`,
          ),
      ),
    ]),
    writeBatchSize,
  );

  const registry = new SkillRegistry(roots);
  const first = await timedRefresh(registry);
  const second = await timedRefresh(registry);
  await fs.rm(path.join(roots[0].rootPath, skillNames[0], 'SKILL.md'));
  const afterDelete = await timedRefresh(registry);
  const rendered = renderAvailableSkillsCatalog(afterDelete.snapshot, { budgetChars: 4_000 });

  console.log(
    JSON.stringify(
      {
        scale: { rootCount, skillsPerRoot, invalidPerRoot, totalFiles, writeBatchSize },
        first: summarize(first),
        second: summarize(second),
        afterDelete: summarize(afterDelete),
        renderMetrics: rendered.metrics,
        tempDir: keepTemp ? tempDir : undefined,
      },
      null,
      2,
    ),
  );
} finally {
  if (!keepTemp) {
    await fs.rm(tempDir, { force: true, recursive: true });
  }
}

async function timedRefresh(registry) {
  const heapBefore = process.memoryUsage().heapUsed;
  const startedAt = performance.now();
  const snapshot = await registry.refresh();
  const elapsedMs = performance.now() - startedAt;
  const heapAfter = process.memoryUsage().heapUsed;

  return {
    snapshot,
    elapsedMs,
    heapDeltaMb: bytesToMb(heapAfter - heapBefore),
    heapUsedMb: bytesToMb(heapAfter),
  };
}

function summarize(result) {
  return {
    elapsedMs: Number(result.elapsedMs.toFixed(2)),
    heapDeltaMb: result.heapDeltaMb,
    heapUsedMb: result.heapUsedMb,
    metrics: result.snapshot.metrics,
  };
}

async function writeSkill(rootPath, name, content) {
  const filePath = path.join(rootPath, name, 'SKILL.md');
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
}

async function writeInBatches(tasks, batchSize) {
  for (let index = 0; index < tasks.length; index += batchSize) {
    await Promise.all(tasks.slice(index, index + batchSize).map((task) => task()));
  }
}

function numberArg(name, defaultValue) {
  const index = process.argv.indexOf(name);
  if (index === -1) return defaultValue;
  const value = Number(process.argv[index + 1]);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Expected a non-negative integer after ${name}`);
  }
  return value;
}

function bytesToMb(bytes) {
  return Number((bytes / 1024 / 1024).toFixed(2));
}
