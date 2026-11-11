import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const repoRoot = resolve(import.meta.dirname, '../../..');
const knipBinary = resolve(
  repoRoot,
  'node_modules/.bin',
  process.platform === 'win32' ? 'knip.cmd' : 'knip',
);

function runKnip(cwd) {
  return spawnSync(knipBinary, ['--production', '--include', 'exports'], {
    cwd,
    encoding: 'utf8',
  });
}

test('production dead-code analysis does not count test imports as usage', (t) => {
  const fixtureRoot = mkdtempSync(resolve(tmpdir(), 'local-runtime-v2-dead-code-'));
  const srcRoot = resolve(fixtureRoot, 'src');
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));
  mkdirSync(srcRoot);

  writeFileSync(
    resolve(fixtureRoot, 'package.json'),
    `${JSON.stringify(
      {
        name: 'dead-code-fixture',
        private: true,
        type: 'module',
        knip: {
          entry: ['src/index.ts!'],
          project: ['src/**/*.ts!', '!src/**/*.test.ts!'],
        },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(resolve(srcRoot, 'prod.ts'), [
    'export const usedByProduction = 1;',
    'export const usedOnlyByTest = 2;',
    '',
  ].join('\n'));
  writeFileSync(
    resolve(srcRoot, 'index.ts'),
    "import { usedByProduction } from './prod.js';\nvoid usedByProduction;\n",
  );
  writeFileSync(
    resolve(srcRoot, 'prod.test.ts'),
    "import { usedOnlyByTest } from './prod.js';\nvoid usedOnlyByTest;\n",
  );

  const testOnlyUsage = runKnip(fixtureRoot);
  const testOnlyOutput = `${testOnlyUsage.stdout}\n${testOnlyUsage.stderr}`;
  assert.equal(testOnlyUsage.status, 1, testOnlyOutput);
  assert.match(testOnlyOutput, /usedOnlyByTest/);
  assert.doesNotMatch(testOnlyOutput, /usedByProduction/);

  writeFileSync(
    resolve(srcRoot, 'index.ts'),
    [
      "import { usedByProduction, usedOnlyByTest } from './prod.js';",
      'void usedByProduction;',
      'void usedOnlyByTest;',
      '',
    ].join('\n'),
  );

  const productionUsage = runKnip(fixtureRoot);
  assert.equal(productionUsage.status, 0, `${productionUsage.stdout}\n${productionUsage.stderr}`);
});
