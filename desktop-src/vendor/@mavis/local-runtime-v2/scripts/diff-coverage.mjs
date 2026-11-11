#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

const SOURCE_PREFIX = 'packages/local-runtime-v2/src/';
const GIT_DIFF_MAX_BUFFER_BYTES = 64 * 1024 * 1024;
// Keep this exact list aligned with vitest.config.ts. Files leave the list in the
// same MR that adds them to the coverage baseline.
const COVERAGE_EXCLUDED_FILES = new Set([
  `${SOURCE_PREFIX}index.ts`,
  `${SOURCE_PREFIX}http/controllers/agent.controller.ts`,
  `${SOURCE_PREFIX}http/controllers/channel.controller.ts`,
  `${SOURCE_PREFIX}http/controllers/cron.controller.ts`,
  `${SOURCE_PREFIX}http/controllers/goal.controller.ts`,
  `${SOURCE_PREFIX}http/controllers/memory.controller.ts`,
  `${SOURCE_PREFIX}http/controllers/model-provider.controller.ts`,
  `${SOURCE_PREFIX}http/controllers/permission.controller.ts`,
  `${SOURCE_PREFIX}http/controllers/pin.controller.ts`,
  `${SOURCE_PREFIX}http/controllers/project.controller.ts`,
  `${SOURCE_PREFIX}http/controllers/questionnaire.controller.ts`,
  `${SOURCE_PREFIX}http/controllers/session.controller.ts`,
  `${SOURCE_PREFIX}http/controllers/skill.controller.ts`,
  `${SOURCE_PREFIX}http/routing/bindings.gen.ts`,
  `${SOURCE_PREFIX}http/routing/contracts.gen.ts`,
  // Type-only contracts emit no runtime statements for V8 to instrument.
  `${SOURCE_PREFIX}service/matrix/contracts.ts`,
  `${SOURCE_PREFIX}service/turn-system/agent-host/contracts.ts`,
  `${SOURCE_PREFIX}service/turn-system/agent-host/execution/contracts.ts`,
  `${SOURCE_PREFIX}service/turn-system/agent-host/history/contracts.ts`,
  `${SOURCE_PREFIX}service/turn-system/agent-host/runner/contracts.ts`,
]);
const COVERAGE_EXCLUDED_PREFIXES = [`${SOURCE_PREFIX}http/generated/`];

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) throw new Error(`Invalid argument: ${key}`);
    options[key.slice(2)] = value;
  }
  return options;
}

function normalizeCoveragePath(filePath) {
  const normalized = filePath.replaceAll('\\', '/');
  const markerIndex = normalized.lastIndexOf(`/${SOURCE_PREFIX}`);
  if (markerIndex >= 0) return normalized.slice(markerIndex + 1);
  return normalized.startsWith(SOURCE_PREFIX) ? normalized : null;
}

function changedLines(diff) {
  const files = new Map();
  let currentPath;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ b/')) {
      currentPath = line.slice(6);
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!hunk || !currentPath) continue;
    const start = Number(hunk[1]);
    const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
    const lines = files.get(currentPath) ?? new Set();
    for (let offset = 0; offset < count; offset += 1) lines.add(start + offset);
    files.set(currentPath, lines);
  }
  return files;
}

function coverageByLine(report) {
  const files = new Map();
  for (const [key, entry] of Object.entries(report)) {
    const filePath = normalizeCoveragePath(entry.path ?? key);
    if (!filePath) continue;
    const hits = new Map();
    for (const [statementId, location] of Object.entries(entry.statementMap ?? {})) {
      const statementHits = entry.s?.[statementId] ?? 0;
      for (let line = location.start.line; line <= location.end.line; line += 1) {
        hits.set(line, Math.max(hits.get(line) ?? 0, statementHits));
      }
    }
    files.set(filePath, hits);
  }
  return files;
}

function hasCommit(repoRoot, ref) {
  return (
    spawnSync('git', ['-C', repoRoot, 'cat-file', '-e', `${ref}^{commit}`], {
      stdio: 'ignore',
    }).status === 0
  );
}

function ensureMergeRequestBase(repoRoot, base) {
  if (hasCommit(repoRoot, base)) return;
  const mergeRequestBase = process.env.CI_MERGE_REQUEST_DIFF_BASE_SHA;
  if (base !== mergeRequestBase || !/^[0-9a-f]{40}$/i.test(base)) return;
  execFileSync('git', ['-C', repoRoot, 'fetch', '--no-tags', '--depth=1', 'origin', base], {
    stdio: 'pipe',
  });
  if (!hasCommit(repoRoot, base)) {
    throw new Error(`GitLab MR diff base is unavailable after fetch: ${base}`);
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const threshold = Number(options.threshold ?? 60);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
    throw new Error(`invalid threshold: ${options.threshold}`);
  }
  const repoRoot =
    options['repo-root'] ??
    process.env.CI_PROJECT_DIR ??
    execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const base = options.base ?? process.env.CI_MERGE_REQUEST_DIFF_BASE_SHA ?? 'origin/preview_train';
  const coveragePath = options.coverage ?? resolve(process.cwd(), 'coverage/coverage-final.json');
  ensureMergeRequestBase(repoRoot, base);
  const diff = execFileSync(
    'git',
    [
      '-C',
      repoRoot,
      'diff',
      '--unified=0',
      '--no-ext-diff',
      '--diff-filter=ACMRT',
      `${base}..HEAD`,
      '--',
      'packages/local-runtime-v2/src',
    ],
    { encoding: 'utf8', maxBuffer: GIT_DIFF_MAX_BUFFER_BYTES },
  );
  const coverage = coverageByLine(JSON.parse(readFileSync(coveragePath, 'utf8')));
  const uncovered = [];
  let total = 0;
  let covered = 0;

  for (const [filePath, lines] of changedLines(diff)) {
    if (
      !filePath.endsWith('.ts') ||
      filePath.endsWith('.test.ts') ||
      COVERAGE_EXCLUDED_FILES.has(filePath) ||
      COVERAGE_EXCLUDED_PREFIXES.some((prefix) => filePath.startsWith(prefix))
    ) {
      continue;
    }
    const hits = coverage.get(filePath);
    if (!hits) throw new Error(`missing coverage for ${filePath}`);
    for (const line of lines) {
      if (!hits.has(line)) continue;
      total += 1;
      if (hits.get(line) > 0) covered += 1;
      else uncovered.push(`${filePath}:${line}`);
    }
  }

  const percent = total === 0 ? 100 : (covered / total) * 100;
  const summary = `${percent.toFixed(2)}% (${covered}/${total} changed executable lines)`;
  if (percent >= threshold) {
    console.log(`[local-runtime-v2-diff-coverage] PASS ${summary}`);
    return;
  }
  console.error(
    `[local-runtime-v2-diff-coverage] FAIL ${summary}, required ${threshold}%\n${uncovered
      .slice(0, 50)
      .join('\n')}${uncovered.length > 50 ? `\n... ${uncovered.length - 50} more` : ''}`,
  );
  process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error(`[local-runtime-v2-diff-coverage] ERROR ${error.message}`);
  process.exitCode = 1;
}
