#!/usr/bin/env node
/**
 * Gate-verification fixture for the soft-gate change in
 * `desktop-real-agent-benchmark-aggregate.mjs`. NOT a CI step — a local
 * owner-authored regression check that the aggregate's `noSseErrors` gate
 * distinguishes impacted vs. non-impacted SSE error cases correctly.
 *
 * What it covers:
 *  1. PASS + sawSseError  -> raw>0, impacted=0, gate PASS, exit 0
 *     (provider transient noise; case still answered correctly)
 *  2. PASS-clean + FAIL+impacted  -> gate FAIL, exit 1
 *  3. FAIL+impacted  -> gate FAIL, exit 1
 *     (regression: SSE-caused failure must still hard-fail)
 *
 * Run from repo root:
 *   node packages/local-runtime-v2/scripts/migrated/desktop-real-agent-benchmark-aggregate.soft-gate.verify.mjs
 *
 * Exit 0 = all three scenarios behave as expected. Exit 1 = bug.
 */
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..', '..');
const aggregateScript = path.join(here, 'desktop-real-agent-benchmark-aggregate.mjs');

if (!existsSync(aggregateScript)) {
  console.error(`[verify] aggregate script not found at ${aggregateScript}`);
  process.exit(2);
}

const cases = [
  {
    name: 'PASS-with-sse-noise',
    summary: {
      shard: 0, totalShards: 1, model: 'm', runId: 'r',
      startedAt: 1, finishedAt: 100, ok: true,
      cases: [{ name: 'pass-with-sse', ok: true }, { name: 'pass-clean', ok: true }],
      caseCoverage: [
        {
          name: 'pass-with-sse', ok: true, terminalStatus: 'finished', sawSseError: true,
          sseErrorImpactedCase: false, durationMs: 1000, startedAt: 1, finishedAt: 1001,
          toolNames: ['bash'],
          assertions: { sseMeaningfulEvents: 5, sseDoneEvents: 1, toolStarts: 1, toolFailures: 0, firstMeaningfulLatencyMs: 200, finalSessionFinished: true, finalHistoryMarker: true, finalFileMarker: true, maxSseIdleGapMs: 100 },
        },
        {
          name: 'pass-clean', ok: true, terminalStatus: 'finished', sawSseError: false,
          sseErrorImpactedCase: false, durationMs: 800, startedAt: 1, finishedAt: 801,
          toolNames: ['bash'],
          assertions: { sseMeaningfulEvents: 5, sseDoneEvents: 1, toolStarts: 1, toolFailures: 0, firstMeaningfulLatencyMs: 100, finalSessionFinished: true, finalHistoryMarker: true, finalFileMarker: true, maxSseIdleGapMs: 50 },
        },
      ],
      artifactDir: '',
    },
    expectExit: 0,
    expectGate: { noSseErrors: true },
    breakdown: { raw: 1, impacted: 0 },
  },
  {
    name: 'mixed-pass-and-fail',
    summary: {
      shard: 0, totalShards: 2, model: 'm', runId: 'r',
      startedAt: 1, finishedAt: 100, ok: false,
      cases: [{ name: 'case-A', ok: true }, { name: 'case-B', ok: false }],
      caseCoverage: [
        {
          name: 'case-A', ok: true, terminalStatus: 'finished', sawSseError: true,
          sseErrorImpactedCase: false, durationMs: 1000, startedAt: 1, finishedAt: 1001,
          toolNames: ['bash'],
          assertions: { sseMeaningfulEvents: 5, sseDoneEvents: 1, toolStarts: 2, toolFailures: 0, firstMeaningfulLatencyMs: 200, finalSessionFinished: true, finalHistoryMarker: true, finalFileMarker: false, maxSseIdleGapMs: 100 },
        },
        {
          name: 'case-B', ok: false, terminalStatus: 'error', sawSseError: true,
          sseErrorImpactedCase: true, durationMs: 500, startedAt: 1, failedAt: 501,
          toolNames: [],
          assertions: { sseMeaningfulEvents: 1, sseDoneEvents: 0, toolStarts: 0, toolFailures: 0, firstMeaningfulLatencyMs: null, finalSessionFinished: false, finalHistoryMarker: false, finalFileMarker: false, maxSseIdleGapMs: 0 },
        },
        {
          name: 'case-C', ok: true, terminalStatus: 'finished', sawSseError: false,
          sseErrorImpactedCase: false, durationMs: 1000, startedAt: 2, finishedAt: 1002,
          toolNames: ['bash'],
          assertions: { sseMeaningfulEvents: 5, sseDoneEvents: 1, toolStarts: 1, toolFailures: 0, firstMeaningfulLatencyMs: 200, finalSessionFinished: true, finalHistoryMarker: true, finalFileMarker: true, maxSseIdleGapMs: 100 },
        },
      ],
      artifactDir: '',
    },
    // Three cases across two "shards" (we'll split into 2 directories below).
    expectExit: 1,
    expectGate: { noSseErrors: false },
    breakdown: { raw: 2, impacted: 1 },
  },
  {
    name: 'fail-with-impacted-sse',
    summary: {
      shard: 0, totalShards: 1, model: 'm', runId: 'r',
      startedAt: 1, finishedAt: 100, ok: false,
      cases: [{ name: 'fail-with-sse', ok: false }],
      caseCoverage: [
        {
          name: 'fail-with-sse', ok: false, terminalStatus: 'error', sawSseError: true,
          sseErrorImpactedCase: true, durationMs: 500, startedAt: 1, failedAt: 501,
          toolNames: [],
          assertions: { sseMeaningfulEvents: 1, sseDoneEvents: 0, toolStarts: 0, toolFailures: 0, firstMeaningfulLatencyMs: null, finalSessionFinished: false, finalHistoryMarker: false, finalFileMarker: false, maxSseIdleGapMs: 0 },
        },
      ],
      artifactDir: '',
    },
    expectExit: 1,
    expectGate: { noSseErrors: false },
    breakdown: { raw: 1, impacted: 1 },
  },
];

let failures = 0;

for (const c of cases) {
  console.log(`\n[verify] case: ${c.name}`);
  const tmp = await mkdtemp(path.join(os.tmpdir(), `soft-gate-verify-${c.name}-`));
  try {
    let shardDirs;
    if (c.name === 'mixed-pass-and-fail') {
      const s1 = path.join(tmp, 'shard1');
      const s2 = path.join(tmp, 'shard2');
      await mkdir(path.join(s1, 'v8-coverage'), { recursive: true });
      await mkdir(path.join(s2, 'v8-coverage'), { recursive: true });
      // Split: case-A,B on shard 1; case-C on shard 2.
      const s1Summary = { ...c.summary, caseCoverage: c.summary.caseCoverage.slice(0, 2), artifactDir: s1 };
      const s2Summary = {
        ...c.summary, shard: 1,
        caseCoverage: c.summary.caseCoverage.slice(2),
        artifactDir: s2,
        cases: [c.summary.cases[2]],
      };
      await writeFile(path.join(s1, 'summary.json'), JSON.stringify(s1Summary));
      await writeFile(path.join(s2, 'summary.json'), JSON.stringify(s2Summary));
      await writeFile(path.join(s1, 'v8-coverage/coverage-1.json'), '[]');
      await writeFile(path.join(s2, 'v8-coverage/coverage-2.json'), '[]');
      shardDirs = `${s1}:${s2}`;
    } else {
      const s1 = path.join(tmp, 'shard1');
      await mkdir(path.join(s1, 'v8-coverage'), { recursive: true });
      const s1Summary = { ...c.summary, artifactDir: s1 };
      await writeFile(path.join(s1, 'summary.json'), JSON.stringify(s1Summary));
      await writeFile(path.join(s1, 'v8-coverage/coverage-1.json'), '[]');
      shardDirs = s1;
    }

    const r = spawnSync(process.execPath, [aggregateScript], {
      cwd: repoRoot,
      env: {
        ...process.env,
        MAVIS_E2E_AGGREGATE_DIR: tmp,
        MAVIS_E2E_LANE: `soft-gate-verify-${c.name}`,
        MAVIS_E2E_REPO_ROOT: repoRoot,
        MAVIS_E2E_SHARD_ARTIFACT_DIRS: shardDirs,
        MAVIS_E2E_TOTAL_SHARDS: String(shardDirs.split(':').length),
      },
      encoding: 'utf8',
    });

    const stderr = r.stderr || '';
    const stdout = r.stdout || '';
    const exit = r.status;

    const gateMatch = stdout.match(/\[aggregate\] gate: (\{[^\n]+\})/);
    const breakdownMatch = stdout.match(/\[aggregate\] SSE error breakdown: raw=(\d+), impacted=(\d+), passing-with-error=(\d+)/);

    const gateObj = gateMatch ? JSON.parse(gateMatch[1]) : null;
    const breakdownObj = breakdownMatch
      ? { raw: Number(breakdownMatch[1]), impacted: Number(breakdownMatch[2]), passing: Number(breakdownMatch[3]) }
      : null;

    let ok = exit === c.expectExit;
    if (gateObj && c.expectGate) {
      for (const [k, v] of Object.entries(c.expectGate)) {
        if (gateObj[k] !== v) {
          console.error(`[verify] FAIL: gate.${k} = ${gateObj[k]} (expected ${v})`);
          ok = false;
        }
      }
    }
    if (breakdownObj && c.breakdown) {
      if (breakdownObj.raw !== c.breakdown.raw || breakdownObj.impacted !== c.breakdown.impacted) {
        console.error(`[verify] FAIL: breakdown ${JSON.stringify(breakdownObj)} (expected raw=${c.breakdown.raw}, impacted=${c.breakdown.impacted})`);
        ok = false;
      }
    }

    console.log(`[verify] exit=${exit} (expected ${c.expectExit}) gate=${JSON.stringify(gateObj)} breakdown=${JSON.stringify(breakdownObj)} -> ${ok ? 'OK' : 'FAIL'}`);
    if (!ok) {
      failures += 1;
      console.error('[verify] STDOUT:', stdout);
      console.error('[verify] STDERR:', stderr);
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

if (failures > 0) {
  console.error(`\n[verify] ${failures} case(s) failed`);
  process.exit(1);
}
console.log(`\nOK: soft-gate behavior verified (${cases.length}/${cases.length} cases).`);
