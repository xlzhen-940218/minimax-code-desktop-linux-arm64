import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveMemoryConfig } from './config.mjs';

const config = { maxCaptureSessionsPerWake: 6, maxCaptureConcurrency: 2 };

test('capture defaults and explicit production values survive omitted CLI overrides', () => {
  assert.deepEqual(resolveMemoryConfig(config, {}), {
    ...config,
    detailedLoggingEnabled: true,
    publicationCooldownMs: 0,
  });
  const custom = resolveMemoryConfig(
    { maxCaptureSessionsPerWake: 3, maxCaptureConcurrency: 1 },
    {},
  );
  assert.equal(custom.maxCaptureSessionsPerWake, 3);
  assert.equal(custom.maxCaptureConcurrency, 1);
});

test('capture CLI overrides remain independent', () => {
  const total = resolveMemoryConfig(config, { 'capture-limit': '10' });
  assert.equal(total.maxCaptureSessionsPerWake, 10);
  assert.equal(total.maxCaptureConcurrency, 2);
  const concurrent = resolveMemoryConfig(config, { 'capture-concurrency': '4' });
  assert.equal(concurrent.maxCaptureSessionsPerWake, 6);
  assert.equal(concurrent.maxCaptureConcurrency, 4);
});

test('rejects invalid capture limits and concurrency', () => {
  for (const flag of ['capture-limit', 'capture-concurrency'])
    for (const value of ['', '0', '-1', '1.5', 'no', 'Infinity'])
      assert.throws(() => resolveMemoryConfig(config, { [flag]: value }));
});
