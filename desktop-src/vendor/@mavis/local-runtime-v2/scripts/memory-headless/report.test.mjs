import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  summarizeEvents,
  candidateSummary,
  roundOutcome,
  positiveInteger,
  reasoningEffort,
} from './report.mjs';

const usage = { input: 100, output: 20, cacheRead: 50, cacheWrite: 10, totalTokens: 180 };
const inspection = (statuses) => ({
  captures: statuses.map((status) => ({ inspection: { status, historyInputTokens: 120 } })),
  consolidation: { documents: [], notes: [] },
});
const completed = (operation, status) => ({
  event: 'operation.completed',
  payload: { operation, result: { status } },
});

test('counts each response once, including failed responses, and reports missing usage', () => {
  const result = summarizeEvents([
    { event: 'llm.request' },
    { event: 'llm.response', payload: { kind: 'capture', response: { usage } } },
    { event: 'llm.usage', payload: { usage } },
    {
      event: 'llm.response',
      payload: { kind: 'consolidation', response: { usage, stopReason: 'error' } },
    },
    { event: 'llm.response', payload: { kind: 'migration', response: {} } },
  ]);
  assert.equal(result.usage.totalTokens, 360);
  assert.equal(result.usage.missingUsage, 1);
  assert.equal(result.usage.byStage.capture.totalTokens, 180);
  assert.equal(result.usage.byStage.consolidation.output, 20);
  assert.equal(result.usage.requests, 1);
});

test('estimates ready input only and retains backed off, invalid and stale backlog', () => {
  const summary = candidateSummary(
    inspection(['ready', 'ready', 'unchanged', 'ineligible', 'backoff', 'deferred', 'stale-input']),
  );
  assert.equal(summary.pending, 5);
  assert.equal(summary.historyInputTokens, 240);
});

test('draining distinguishes progress, incomplete backlog, failures and successful final consolidation', () => {
  const report = summarizeEvents([
    completed('capture.capture', 'updated'),
    completed('consolidation.rebuild', 'published'),
  ]);
  assert.equal(roundOutcome(report, inspection(['ready'])), 'more');
  assert.equal(roundOutcome(report, inspection(['unchanged'])), 'completed');
  assert.equal(
    roundOutcome(
      summarizeEvents([completed('consolidation.rebuild', 'unchanged')]),
      inspection(['backoff']),
    ),
    'no-progress',
  );
  assert.equal(
    roundOutcome(summarizeEvents([completed('capture.capture', 'updated')]), inspection([])),
    'deferred',
  );
  assert.equal(
    roundOutcome(summarizeEvents([completed('consolidation.rebuild', 'deferred')]), inspection([])),
    'deferred',
  );
  assert.equal(roundOutcome({ ...report, failures: [{}] }, inspection([])), 'failed');
  assert.equal(roundOutcome(report, inspection(['ready']), true), 'completed');
});

test('rejects invalid budgets', () => {
  for (const value of ['0', '-1', '1.5', 'no', 'Infinity'])
    assert.throws(() => positiveInteger(value, 'rounds'));
  assert.equal(positiveInteger('2', 'rounds'), 2);
});

test('reports selection limits instead of declaring every document consolidated', () => {
  const after = inspection(['unchanged']);
  after.consolidation.documents.push({ selected: false });
  assert.equal(
    roundOutcome(summarizeEvents([completed('consolidation.rebuild', 'published')]), after),
    'selection-limited',
  );
});

test('continues ready work while isolated capture failures remain backed off', () => {
  const report = summarizeEvents([
    completed('capture.capture', 'updated'),
    completed('capture.capture', 'deferred'),
    completed('consolidation.rebuild', 'published'),
  ]);
  assert.equal(roundOutcome(report, inspection(['ready', 'backoff'])), 'more');
  assert.equal(roundOutcome(report, inspection(['backoff'])), 'deferred');
});

test('reasoning effort preserves configured defaults and rejects unsupported overrides', () => {
  assert.equal(reasoningEffort(undefined), undefined);
  for (const effort of ['low', 'medium', 'high']) assert.equal(reasoningEffort(effort), effort);
  for (const effort of ['', 'off', 'max']) assert.throws(() => reasoningEffort(effort));
});
