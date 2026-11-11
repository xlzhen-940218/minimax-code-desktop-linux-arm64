import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';

const repoRoot = resolve(import.meta.dirname, '../../..');
const cli = resolve(repoRoot, 'packages/local-runtime-v2/scripts/diff-coverage.mjs');
const sourcePath = 'packages/local-runtime-v2/src/example.ts';

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function write(cwd, path, contents) {
  const target = resolve(cwd, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
}

function writeCoverage(cwd, hits, relativePath = 'coverage-final.json') {
  const statementMap = Object.fromEntries(
    hits.map((_, index) => [
      index,
      {
        start: { line: index + 2, column: 0 },
        end: { line: index + 2, column: 20 },
      },
    ]),
  );
  const coveragePath = resolve(cwd, relativePath);
  write(
    cwd,
    relativePath,
    JSON.stringify({
      [resolve(cwd, sourcePath)]: {
        path: resolve(cwd, sourcePath),
        statementMap,
        s: Object.fromEntries(hits.map((hit, index) => [index, hit])),
      },
    }),
  );
  return coveragePath;
}

function runGate(cwd, base, coveragePath) {
  return spawnSync(
    process.execPath,
    [cli, '--repo-root', cwd, '--base', base, '--coverage', coveragePath, '--threshold', '60'],
    { encoding: 'utf8' },
  );
}

function runGateWithCiDefaults(cwd, base) {
  return spawnSync(process.execPath, [cli, '--threshold', '60'], {
    cwd: resolve(cwd, 'packages/local-runtime-v2'),
    encoding: 'utf8',
    env: {
      ...process.env,
      CI_PROJECT_DIR: cwd,
      CI_MERGE_REQUEST_DIFF_BASE_SHA: base,
    },
  });
}

function createChangedRepo(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'local-runtime-v2-diff-coverage-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  git(cwd, 'init', '--quiet');
  git(cwd, 'config', 'user.email', 'test@example.com');
  git(cwd, 'config', 'user.name', 'Test');
  write(cwd, sourcePath, 'export function value() {\n  return 0;\n}\n');
  git(cwd, 'add', sourcePath);
  git(cwd, 'commit', '--quiet', '-m', 'base');
  const base = git(cwd, 'rev-parse', 'HEAD');
  write(
    cwd,
    sourcePath,
    [
      'export function value() {',
      '  const one = 1;',
      '  const two = 2;',
      '  const three = 3;',
      '  const four = 4;',
      '  return one + two + three + four;',
      '}',
      '',
    ].join('\n'),
  );
  git(cwd, 'add', sourcePath);
  git(cwd, 'commit', '--quiet', '-m', 'change');
  return { cwd, base };
}

test('enforces 60% coverage across changed executable lines', (t) => {
  const { cwd, base } = createChangedRepo(t);

  const passing = runGate(cwd, base, writeCoverage(cwd, [1, 1, 1, 0, 0]));
  assert.equal(passing.status, 0, passing.stderr);
  assert.match(passing.stdout, /PASS 60\.00% \(3\/5 changed executable lines\)/);

  const failing = runGate(cwd, base, writeCoverage(cwd, [1, 1, 0, 0, 0]));
  assert.equal(failing.status, 1);
  assert.match(failing.stderr, /FAIL 40\.00% \(2\/5 changed executable lines\), required 60%/);
  assert.match(failing.stderr, new RegExp(`${sourcePath}:4`));
});

test('supports merge request diffs larger than the child process default buffer', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'local-runtime-v2-diff-coverage-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  git(cwd, 'init', '--quiet');
  git(cwd, 'config', 'user.email', 'test@example.com');
  git(cwd, 'config', 'user.name', 'Test');
  write(cwd, sourcePath, "export const payload = 'before';\n");
  git(cwd, 'add', sourcePath);
  git(cwd, 'commit', '--quiet', '-m', 'base');
  const base = git(cwd, 'rev-parse', 'HEAD');
  write(cwd, sourcePath, `export const payload = '${'x'.repeat(2 * 1024 * 1024)}';\n`);
  git(cwd, 'add', sourcePath);
  git(cwd, 'commit', '--quiet', '-m', 'change');
  write(
    cwd,
    'coverage-final.json',
    JSON.stringify({
      [resolve(cwd, sourcePath)]: {
        path: resolve(cwd, sourcePath),
        statementMap: {
          0: {
            start: { line: 1, column: 0 },
            end: { line: 1, column: 20 },
          },
        },
        s: { 0: 1 },
      },
    }),
  );

  const result = runGate(cwd, base, resolve(cwd, 'coverage-final.json'));

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PASS 100\.00% \(1\/1 changed executable lines\)/);
});

test('counts changed lines inside a multiline statement', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'local-runtime-v2-diff-coverage-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  git(cwd, 'init', '--quiet');
  git(cwd, 'config', 'user.email', 'test@example.com');
  git(cwd, 'config', 'user.name', 'Test');
  write(cwd, sourcePath, 'export const value = [\n  1,\n  2,\n];\n');
  git(cwd, 'add', sourcePath);
  git(cwd, 'commit', '--quiet', '-m', 'base');
  const base = git(cwd, 'rev-parse', 'HEAD');
  write(cwd, sourcePath, 'export const value = [\n  1,\n  3,\n];\n');
  git(cwd, 'add', sourcePath);
  git(cwd, 'commit', '--quiet', '-m', 'change');
  write(
    cwd,
    'coverage-final.json',
    JSON.stringify({
      [resolve(cwd, sourcePath)]: {
        path: resolve(cwd, sourcePath),
        statementMap: {
          0: {
            start: { line: 1, column: 0 },
            end: { line: 4, column: 2 },
          },
        },
        s: { 0: 0 },
      },
    }),
  );

  const result = runGate(cwd, base, resolve(cwd, 'coverage-final.json'));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /FAIL 0\.00% \(0\/1 changed executable lines\), required 60%/);
  assert.match(result.stderr, new RegExp(`${sourcePath}:3`));
});

test('fails closed when changed production source is absent from coverage', (t) => {
  const { cwd, base } = createChangedRepo(t);
  write(cwd, 'coverage-final.json', '{}');

  const result = runGate(cwd, base, resolve(cwd, 'coverage-final.json'));

  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(`missing coverage for ${sourcePath}`));
});

test('requires coverage for the migrated workspace file controller', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'local-runtime-v2-diff-coverage-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  git(cwd, 'init', '--quiet');
  git(cwd, 'config', 'user.email', 'test@example.com');
  git(cwd, 'config', 'user.name', 'Test');
  const controller = 'packages/local-runtime-v2/src/http/controllers/workspace-file.controller.ts';
  write(cwd, controller, 'export const value = 1;\n');
  git(cwd, 'add', controller);
  git(cwd, 'commit', '--quiet', '-m', 'base');
  const base = git(cwd, 'rev-parse', 'HEAD');
  write(cwd, controller, 'export const value = 2;\n');
  git(cwd, 'add', controller);
  git(cwd, 'commit', '--quiet', '-m', 'change');
  write(cwd, 'coverage-final.json', '{}');
  const result = runGate(cwd, base, resolve(cwd, 'coverage-final.json'));
  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(`missing coverage for ${controller}`));
});

test('ignores only the exact files excluded from the coverage baseline', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'local-runtime-v2-diff-coverage-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  git(cwd, 'init', '--quiet');
  git(cwd, 'config', 'user.email', 'test@example.com');
  git(cwd, 'config', 'user.name', 'Test');
  const ignoredPaths = [
    'packages/local-runtime-v2/src/example.test.ts',
    'packages/local-runtime-v2/src/index.ts',
    'packages/local-runtime-v2/src/http/controllers/agent.controller.ts',
    'packages/local-runtime-v2/src/http/controllers/channel.controller.ts',
    'packages/local-runtime-v2/src/http/controllers/cron.controller.ts',
    'packages/local-runtime-v2/src/http/controllers/goal.controller.ts',
    'packages/local-runtime-v2/src/http/controllers/memory.controller.ts',
    'packages/local-runtime-v2/src/http/controllers/model-provider.controller.ts',
    'packages/local-runtime-v2/src/http/controllers/permission.controller.ts',
    'packages/local-runtime-v2/src/http/controllers/pin.controller.ts',
    'packages/local-runtime-v2/src/http/controllers/project.controller.ts',
    'packages/local-runtime-v2/src/http/controllers/questionnaire.controller.ts',
    'packages/local-runtime-v2/src/http/controllers/session.controller.ts',
    'packages/local-runtime-v2/src/http/controllers/skill.controller.ts',
    'packages/local-runtime-v2/src/http/routing/bindings.gen.ts',
    'packages/local-runtime-v2/src/http/routing/contracts.gen.ts',
    'packages/local-runtime-v2/src/http/generated/demo-controller-base.gen.ts',
    'packages/local-runtime-v2/src/service/matrix/contracts.ts',
    'packages/local-runtime-v2/src/service/turn-system/agent-host/contracts.ts',
    'packages/local-runtime-v2/src/service/turn-system/agent-host/execution/contracts.ts',
    'packages/local-runtime-v2/src/service/turn-system/agent-host/history/contracts.ts',
    'packages/local-runtime-v2/src/service/turn-system/agent-host/runner/contracts.ts',
  ];
  for (const path of ignoredPaths) write(cwd, path, 'export const value = 1;\n');
  git(cwd, 'add', ...ignoredPaths);
  git(cwd, 'commit', '--quiet', '-m', 'base');
  const base = git(cwd, 'rev-parse', 'HEAD');
  for (const path of ignoredPaths) write(cwd, path, 'export const value = 2;\n');
  git(cwd, 'add', ...ignoredPaths);
  git(cwd, 'commit', '--quiet', '-m', 'change');
  write(cwd, 'coverage-final.json', '{}');

  const result = runGate(cwd, base, resolve(cwd, 'coverage-final.json'));

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PASS 100\.00% \(0\/0 changed executable lines\)/);
});

test('uses GitLab MR variables and the package coverage directory by default', (t) => {
  const { cwd, base } = createChangedRepo(t);
  writeCoverage(cwd, [1, 1, 1, 0, 0], 'packages/local-runtime-v2/coverage/coverage-final.json');

  const result = runGateWithCiDefaults(cwd, base);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PASS 60\.00% \(3\/5 changed executable lines\)/);
});

test('fetches a missing GitLab MR diff base in a shallow clone', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'local-runtime-v2-diff-coverage-shallow-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const origin = join(root, 'origin.git');
  const source = join(root, 'source');
  const shallowClone = join(root, 'clone');
  git(root, 'init', '--quiet', '--bare', origin);
  git(root, 'init', '--quiet', source);
  git(source, 'config', 'user.email', 'test@example.com');
  git(source, 'config', 'user.name', 'Test');
  write(source, sourcePath, 'export function value() {\n  return 0;\n}\n');
  git(source, 'add', sourcePath);
  git(source, 'commit', '--quiet', '-m', 'base');
  const base = git(source, 'rev-parse', 'HEAD');
  write(
    source,
    sourcePath,
    [
      'export function value() {',
      '  const one = 1;',
      '  const two = 2;',
      '  const three = 3;',
      '  const four = 4;',
      '  return one + two + three + four;',
      '}',
      '',
    ].join('\n'),
  );
  git(source, 'add', sourcePath);
  git(source, 'commit', '--quiet', '-m', 'change');
  for (let index = 0; index < 24; index += 1) {
    git(source, 'commit', '--quiet', '--allow-empty', '-m', `follow-up-${index}`);
  }
  git(source, 'remote', 'add', 'origin', `file://${origin}`);
  git(source, 'push', '--quiet', 'origin', 'HEAD:master');
  git(origin, 'symbolic-ref', 'HEAD', 'refs/heads/master');
  execFileSync('git', ['clone', '--quiet', '--depth=1', `file://${origin}`, shallowClone]);
  writeCoverage(
    shallowClone,
    [1, 1, 1, 0, 0],
    'packages/local-runtime-v2/coverage/coverage-final.json',
  );

  const result = runGateWithCiDefaults(shallowClone, base);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PASS 60\.00% \(3\/5 changed executable lines\)/);
  assert.equal(git(shallowClone, 'cat-file', '-t', base), 'commit');
});

test('fails closed when a missing GitLab MR diff base cannot be fetched', (t) => {
  const { cwd } = createChangedRepo(t);
  writeCoverage(cwd, [1, 1, 1, 0, 0], 'packages/local-runtime-v2/coverage/coverage-final.json');

  const result = runGateWithCiDefaults(cwd, '0'.repeat(40));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /ERROR Command failed: git/);
});

test('passes when production changes contain no executable lines', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'local-runtime-v2-diff-coverage-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  git(cwd, 'init', '--quiet');
  git(cwd, 'config', 'user.email', 'test@example.com');
  git(cwd, 'config', 'user.name', 'Test');
  write(cwd, sourcePath, '// before\nexport const value = 1;\n');
  git(cwd, 'add', sourcePath);
  git(cwd, 'commit', '--quiet', '-m', 'base');
  const base = git(cwd, 'rev-parse', 'HEAD');
  write(cwd, sourcePath, '// after\nexport const value = 1;\n');
  git(cwd, 'add', sourcePath);
  git(cwd, 'commit', '--quiet', '-m', 'change');
  const coveragePath = writeCoverage(cwd, [1]);

  const result = runGate(cwd, base, coveragePath);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PASS 100\.00% \(0\/0 changed executable lines\)/);
});

test('handles a production diff larger than the child process default buffer', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'local-runtime-v2-diff-coverage-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  git(cwd, 'init', '--quiet');
  git(cwd, 'config', 'user.email', 'test@example.com');
  git(cwd, 'config', 'user.name', 'Test');
  write(cwd, sourcePath, 'export const value = 1;\n');
  git(cwd, 'add', sourcePath);
  git(cwd, 'commit', '--quiet', '-m', 'base');
  const base = git(cwd, 'rev-parse', 'HEAD');
  const commentLine = `// ${'large-diff-content-'.repeat(7)}\n`;
  const comments = commentLine.repeat(10_000);
  const executableLine = 10_001;
  write(cwd, sourcePath, `${comments}export const value = 2;\n`);
  git(cwd, 'add', sourcePath);
  git(cwd, 'commit', '--quiet', '-m', 'change');
  write(
    cwd,
    'coverage-final.json',
    JSON.stringify({
      [resolve(cwd, sourcePath)]: {
        path: resolve(cwd, sourcePath),
        statementMap: {
          0: {
            start: { line: executableLine, column: 0 },
            end: { line: executableLine, column: 23 },
          },
        },
        s: { 0: 1 },
      },
    }),
  );

  const result = runGate(cwd, base, resolve(cwd, 'coverage-final.json'));

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PASS 100\.00% \(1\/1 changed executable lines\)/);
});

test('fails closed when the Git diff cannot be computed', (t) => {
  const { cwd } = createChangedRepo(t);

  const result = runGate(cwd, 'missing-base', writeCoverage(cwd, [1, 1, 1, 0, 0]));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /ERROR Command failed: git/);
});
