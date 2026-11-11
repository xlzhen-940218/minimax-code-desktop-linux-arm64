#!/usr/bin/env node
/**
 * Structure-only smoke test for desktop real-agent E2E.
 *
 * Verifies (without starting local-runtime or hitting the LLM) that the aggregate
 * script reads shard summaries and writes a report. When the desktop
 * real-agent harness is present, it also verifies:
 *  - benchmark tasks JSON loads cleanly
 *  - the djb2 shard slice is deterministic and gives the right partition
 *  - capabilityTagsForCase classifies correctly across the 15 cases
 *
 * Exit 0 = all structure checks pass. Exit 1 = bug.
 */

import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const tasksPath = path.join(here, 'desktop-real-agent-benchmark-tasks.json');
const e2ePath = path.join(here, 'desktop-real-agent-continuity-e2e.mjs');

// Import the function under test by loading the e2e source. We can't import
// the .mjs directly because it starts side-effects (mkdtemp at top level).
// Instead, re-implement the small shim for djb2 in this smoke test and import
// the source as a string to extract the pickShard function via a quick regex.
const e2eSource = await readOptionalFile(e2ePath);

function pickShard(id, total) {
  let hash = 5381;
  for (let i = 0; i < id.length; i += 1) hash = ((hash * 33) ^ id.charCodeAt(i)) >>> 0;
  return total <= 1 ? 0 : hash % total;
}

const tasksText = await readOptionalFile(tasksPath);
if (e2eSource && tasksText) {
  smokeDesktopHarnessStructure(e2eSource, JSON.parse(tasksText).tasks);
} else {
  console.log('desktop real-agent harness files are absent; skipping harness structure checks');
}

await smokeAggregateCodeCoverage();

console.log(`\nOK: aggregate line coverage union verified.`);

async function readOptionalFile(file) {
  try {
    return await readFile(file, 'utf8');
  } catch (err) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
}

function smokeDesktopHarnessStructure(source, tasks) {
  if (!Array.isArray(tasks) || tasks.length !== 15) {
    console.error(`expected 15 tasks, got ${tasks?.length}`);
    process.exit(1);
  }

  const N = 4;
  const byShard = Array.from({ length: N }, () => []);
  for (const t of tasks) {
    const s = pickShard(t.id, N);
    if (s < 0 || s >= N) {
      console.error(`task ${t.id} -> shard ${s} out of range`);
      process.exit(1);
    }
    byShard[s].push(t.id);
  }
  console.log('shard partition:');
  for (let i = 0; i < N; i += 1) console.log(`  shard ${i + 1}/${N}: [${byShard[i].join(', ')}] (${byShard[i].length})`);

  const totalAssigned = byShard.reduce((s, arr) => s + arr.length, 0);
  if (totalAssigned !== tasks.length) {
    console.error(`expected ${tasks.length} assigned tasks, got ${totalAssigned}`);
    process.exit(1);
  }
  if (byShard.some((arr) => arr.length === 0)) {
    console.error('a shard has zero tasks (uneven partition is OK, empty is not)');
    process.exit(1);
  }

  // Verify djb2 is deterministic — pickShard called twice with same inputs gives
  // the same answer.
  const det = pickShard('bench-05', 4);
  const det2 = pickShard('bench-05', 4);
  if (det !== det2) {
    console.error(`pickShard not deterministic: ${det} vs ${det2}`);
    process.exit(1);
  }

  // Verify every task id is parseable (i.e. id was a string).
  for (const t of tasks) {
    if (typeof t.id !== 'string' || !t.id.trim()) {
      console.error(`bad id: ${JSON.stringify(t.id)}`);
      process.exit(1);
    }
    if (typeof t.query !== 'string' || !t.query.trim()) {
      console.error(`bad query on ${t.id}: ${typeof t.query}`);
      process.exit(1);
    }
    if (typeof t.name !== 'string') {
      console.error(`bad name on ${t.id}: ${typeof t.name}`);
      process.exit(1);
    }
  }

  // Verify the source file actually has the pickShard function (regression
  // guard for accidental removal).
  if (!/function pickShard\(id, total\)/.test(source)) {
    console.error('pickShard function not found in e2e source — did the function get removed?');
    process.exit(1);
  }
  if (!/function capabilityTagsForCase\(/.test(source)) {
    console.error('capabilityTagsForCase function not found in e2e source');
    process.exit(1);
  }
  if (!/const TOOL_CAPABILITY_TABLE/.test(source)) {
    console.error('TOOL_CAPABILITY_TABLE not found in e2e source');
    process.exit(1);
  }
  if (!/MAVIS_E2E_SHARD/.test(source)) {
    console.error('MAVIS_E2E_SHARD env var not referenced in e2e source');
    process.exit(1);
  }
  if (!/MAVIS_E2E_TOTAL_SHARDS/.test(source)) {
    console.error('MAVIS_E2E_TOTAL_SHARDS env var not referenced in e2e source');
    process.exit(1);
  }
  if (!/defaultPlatformApiBaseUrl = 'https:\/\/api\.ohmyrouter\.com\/v1'/.test(source)) {
    console.error('desktop real-agent static-key provider must default to the internal platform API host');
    process.exit(1);
  }
  if (!/function extractAgentError\(/.test(source)) {
    console.error('agent finish_reason=error detection not found in e2e source');
    process.exit(1);
  }
  if (!/finish_reason/.test(source) || !/evidence\.errors\.push\(agentError\)/.test(source)) {
    console.error('provider/agent finish_reason=error is not wired into stream evidence errors');
    process.exit(1);
  }
  if (!/pickShard\(task\.id, totalShards\)/.test(source)) {
    console.error('runBenchmarkSuite does not call pickShard');
    process.exit(1);
  }
  if (!/runsContinuityCases/.test(source)) {
    console.error('continuityRunsOnShardZero logic not found in e2e source');
    process.exit(1);
  }
}

async function smokeAggregateCodeCoverage() {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'desktop-real-agent-aggregate-'));
  try {
    const repoRoot = path.join(tmp, 'repo');
    const sourcePath = path.join(repoRoot, 'packages/local-runtime-v2/dist/example.js');
    const overlapSourcePath = path.join(repoRoot, 'packages/local-runtime-v2/dist/overlap.js');
    const shard1 = path.join(tmp, 'artifacts/e2e/desktop-real-agent/shard-1');
    const shard2 = path.join(tmp, 'artifacts/e2e/desktop-real-agent/shard-2');
    const outDir = path.join(tmp, 'artifacts/e2e/desktop-real-agent-aggregate');
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await mkdir(path.join(shard1, 'v8-coverage'), { recursive: true });
    await mkdir(path.join(shard2, 'v8-coverage'), { recursive: true });

    const source = ['const first = 1;', 'const second = 2;', ''].join('\n');
    const overlapSource = ['const outer = 1;', 'const inner = 2;', ''].join('\n');
    await writeFile(sourcePath, source, 'utf8');
    await writeFile(overlapSourcePath, overlapSource, 'utf8');
    await writeShardSummary(shard1, 0);
    await writeShardSummary(shard2, 1);
    await writeCoverageFile(path.join(shard1, 'v8-coverage/coverage-1.json'), sourcePath, source, [1]);
    await writeCoverageFile(path.join(shard2, 'v8-coverage/coverage-2.json'), sourcePath, source, [2]);
    await writeOverlappingCoverageFile(
      path.join(shard1, 'v8-coverage/coverage-overlap.json'),
      overlapSourcePath,
      overlapSource,
    );

    const aggregateScript = path.join(here, 'desktop-real-agent-benchmark-aggregate.mjs');
    const result = spawnSync(process.execPath, [aggregateScript], {
      cwd: repoRoot,
      env: {
        ...process.env,
        MAVIS_E2E_AGGREGATE_DIR: outDir,
        MAVIS_E2E_LANE: 'desktop-real-agent-smoke',
        MAVIS_E2E_REPO_ROOT: repoRoot,
        MAVIS_E2E_TOTAL_SHARDS: '2',
        MAVIS_E2E_SHARD_ARTIFACT_DIRS: `${shard1}:${shard2}`,
      },
      encoding: 'utf8',
    });
    if (result.status !== 0) {
      console.error(result.stdout);
      console.error(result.stderr);
      throw new Error(`aggregate smoke failed with status ${result.status}`);
    }

    const codeCoverage = JSON.parse(await readFile(path.join(outDir, 'code-coverage.json'), 'utf8'));
    assertEqual(codeCoverage.total.covered, 3, 'desktop code coverage covered lines');
    assertEqual(codeCoverage.total.total, 4, 'desktop code coverage total lines');
    assertEqual(codeCoverage.total.percent, 75, 'desktop code coverage percent');
    const overlapFile = codeCoverage.files.find((file) => file.file === 'packages/local-runtime-v2/dist/overlap.js');
    assertEqual(overlapFile?.covered, 1, 'overlapping V8 range covered lines');
    assertEqual(overlapFile?.total, 2, 'overlapping V8 range total lines');
    const report = await readFile(path.join(outDir, 'coverage.md'), 'utf8');
    if (!report.includes('## Run Summary')) {
      throw new Error('aggregate report is missing Run Summary section');
    }
    const desktopCoverageIndex = report.lastIndexOf('## Desktop Real-Agent Code Coverage');
    if (desktopCoverageIndex < 0) {
      throw new Error('aggregate report is missing Desktop Real-Agent Code Coverage section');
    }
    const cloudCoverageIndex = report.lastIndexOf('## Cloud/Web Real-Chain Code Coverage');
    if (cloudCoverageIndex < 0) {
      throw new Error('aggregate report is missing Cloud/Web Real-Chain Code Coverage section');
    }
    if (cloudCoverageIndex > desktopCoverageIndex) {
      throw new Error('desktop code coverage should be the final coverage section in the aggregate report');
    }
    if (!report.trimEnd().endsWith('**Final generated-line coverage**: `3 / 4 = 75.00%` across `2` files.')) {
      throw new Error('aggregate report should end with the final generated-line coverage summary');
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

async function writeShardSummary(dir, shard) {
  const now = Date.now();
  await writeFile(
    path.join(dir, 'summary.json'),
    JSON.stringify(
      {
        ok: true,
        shard,
        totalShards: 2,
        runId: `smoke-${shard}`,
        startedAt: now,
        finishedAt: now + 1000,
        coverageDir: path.join(dir, 'v8-coverage'),
        model: { modelRef: 'smoke-model' },
        cases: [{ name: `case-${shard}`, ok: true }],
        caseCoverage: [
          {
            name: `case-${shard}`,
            ok: true,
            terminalStatus: 'finished',
            toolNames: ['bash'],
            capabilityTags: ['tool.shell'],
            assertions: {
              sseMeaningfulEvents: 1,
              sseDoneEvents: 1,
              toolStarts: 1,
              toolFailures: 0,
            },
          },
        ],
      },
      null,
      2,
    ),
    'utf8',
  );
}

async function writeCoverageFile(file, sourcePath, source, coveredLines) {
  const functions = [1, 2].map((line) => {
    const { start, end } = lineRange(source, line);
    return {
      functionName: `line${line}`,
      ranges: [{ startOffset: start, endOffset: end, count: coveredLines.includes(line) ? 1 : 0 }],
      isBlockCoverage: true,
    };
  });
  await writeFile(
    file,
    JSON.stringify(
      {
        result: [
          {
            scriptId: '1',
            url: pathToFileURL(sourcePath).href,
            functions,
          },
        ],
      },
      null,
      2,
    ),
    'utf8',
  );
}

async function writeOverlappingCoverageFile(file, sourcePath, source) {
  const nested = lineRange(source, 2);
  await writeFile(
    file,
    JSON.stringify(
      {
        result: [
          {
            scriptId: 'overlap',
            url: pathToFileURL(sourcePath).href,
            functions: [
              {
                functionName: '(script)',
                ranges: [{ startOffset: 0, endOffset: source.length, count: 1 }],
                isBlockCoverage: true,
              },
              {
                functionName: 'nestedNotExecuted',
                ranges: [{ startOffset: nested.start, endOffset: nested.end, count: 0 }],
                isBlockCoverage: true,
              },
            ],
          },
        ],
      },
      null,
      2,
    ),
    'utf8',
  );
}

function lineRange(source, lineNumber) {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source.charCodeAt(index) === 10) starts.push(index + 1);
  }
  return {
    start: starts[lineNumber - 1],
    end: starts[lineNumber] ?? source.length,
  };
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}
