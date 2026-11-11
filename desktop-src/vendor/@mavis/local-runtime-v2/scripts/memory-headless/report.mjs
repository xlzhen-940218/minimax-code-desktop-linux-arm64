import { createReadStream } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { join } from 'node:path';

export function positiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(`${name} 须为正整数`);
  return number;
}

export function reasoningEffort(value) {
  if (value === undefined || ['low', 'medium', 'high'].includes(value)) return value;
  throw new Error('reasoning-effort 须为 low、medium 或 high');
}

export function candidateSummary(inspection) {
  const states = {};
  let historyInputTokens = 0;
  for (const { inspection: item } of inspection.captures) {
    states[item.status] = (states[item.status] ?? 0) + 1;
    if (item.status === 'ready') historyInputTokens += item.historyInputTokens;
  }
  return {
    states,
    pending: inspection.captures.filter(
      ({ inspection: item }) => !['unchanged', 'ineligible'].includes(item.status),
    ).length,
    historyInputTokens,
    selectedDocuments: inspection.consolidation.documents.filter((doc) => doc.selected).length,
    excludedDocuments: inspection.consolidation.documents.filter((doc) => !doc.selected).length,
    notes: inspection.consolidation.notes.length,
  };
}

export function summarizeEvents(events) {
  const stages = [];
  const failures = [];
  const decisions = [];
  const usage = {
    requests: 0,
    responses: 0,
    missingUsage: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    byStage: {},
  };
  for (const event of events) {
    if (event.event === 'llm.request') usage.requests += 1;
    if (event.event === 'llm.response') {
      const kind = event.payload.kind ?? 'unknown';
      const stage = (usage.byStage[kind] ??= {
        responses: 0,
        missingUsage: 0,
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
      });
      usage.responses += 1;
      stage.responses += 1;
      const reported = event.payload.response?.usage;
      const fields = ['input', 'output', 'cacheRead', 'cacheWrite', 'totalTokens'];
      if (
        !reported ||
        fields.some((field) => !Number.isFinite(reported[field]) || reported[field] < 0)
      ) {
        usage.missingUsage += 1;
        stage.missingUsage += 1;
      } else {
        for (const field of fields) {
          usage[field] += reported[field];
          stage[field] += reported[field];
        }
      }
    }
    if (
      event.event === 'operation.completed' &&
      ['capture.capture', 'consolidation.rebuild'].includes(event.payload.operation)
    ) {
      stages.push({
        timestampMs: event.timestampMs,
        operation: event.payload.operation,
        result: event.payload.result,
      });
    }
    if (event.event === 'reconciler.failed' || event.event === 'operation.failed')
      failures.push(event);
    if (/skipped|batch-stopped|model.quota/u.test(event.event)) decisions.push(event);
  }
  return { stages, failures, decisions, usage };
}

export function roundOutcome(report, after, maintenanceOnly = false) {
  if (report.failures.length) return 'failed';
  const consolidation = report.stages
    .filter((stage) => stage.operation === 'consolidation.rebuild')
    .at(-1);
  const published =
    consolidation && ['published', 'unchanged', 'empty'].includes(consolidation.result?.status);
  if (!published) return 'deferred';
  const remaining = candidateSummary(after);
  if (maintenanceOnly || remaining.pending === 0)
    return remaining.excludedDocuments ? 'selection-limited' : 'completed';
  const madeProgress = report.stages.some(
    (stage) => stage.operation === 'capture.capture' && stage.result?.status === 'updated',
  );
  if (!madeProgress) return 'no-progress';
  if (!remaining.states.ready) return 'deferred';
  return 'more';
}

export async function logNames(dir) {
  try {
    return (await readdir(dir)).filter((name) => name.endsWith('.jsonl')).sort();
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

// 按行读取完整请求日志；报告只保留用量、阶段终态和调度决策，避免积累历史正文。
export async function readReport(dir, files) {
  const events = [];
  for (const name of files) {
    const input = createReadStream(join(dir, name), { encoding: 'utf8' });
    const lines = createInterface({ input, crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);
      if (event.event === 'llm.response')
        events.push({
          ...event,
          payload: { kind: event.payload.kind, response: { usage: event.payload.response?.usage } },
        });
      else if (event.event === 'llm.request') events.push({ event: event.event });
      else if (
        event.event === 'operation.completed' &&
        ['capture.capture', 'consolidation.rebuild'].includes(event.payload.operation)
      )
        events.push(event);
      else if (
        ['operation.failed', 'reconciler.failed'].includes(event.event) ||
        /skipped|batch-stopped|model.quota/u.test(event.event)
      )
        events.push(event);
    }
  }
  return summarizeEvents(events);
}
