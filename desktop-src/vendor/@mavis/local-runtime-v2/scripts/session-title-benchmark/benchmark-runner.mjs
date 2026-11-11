import { corpusSha256 } from './case-format.mjs';
import { loadCheckpoint, saveCheckpoint, writeJsonAtomic } from './checkpoint.mjs';
import { buildReport } from './report.mjs';
import { probeProductionPrompt, promptIdentity } from './production-runner.mjs';

export const BENCHMARK_SCHEMA_VERSION = 1;

export async function runBenchmark(options) {
  const prompt = options.prompt ?? (await probeProductionPrompt());
  const promptData = promptIdentity(prompt);
  const identity = {
    schemaVersion: BENCHMARK_SCHEMA_VERSION,
    modelRef: options.modelRef,
    promptSha256: promptData.promptSha256,
    corpusSha256: corpusSha256(options.cases),
  };
  const checkpoint = await loadCheckpoint(options.checkpointPath, identity);
  const resultByCaseId = new Map(
    (checkpoint?.results ?? []).map((result) => [result.caseId, result]),
  );

  for (const item of options.cases) {
    if (resultByCaseId.has(item.id)) continue;
    let result;
    try {
      result = await options.runner.runCase(item);
    } catch {
      result = {
        caseId: item.id,
        status: 'error',
        marker: '【ERROR】runner_error',
        attempts: 0,
      };
    }
    resultByCaseId.set(item.id, result);
    await saveCheckpoint(options.checkpointPath, {
      ...identity,
      results: orderedResults(options.cases, resultByCaseId),
    });
    options.onProgress?.({ completed: resultByCaseId.size, total: options.cases.length, result });
  }

  const report = buildReport({
    ...identity,
    prompt,
    generatedAtMs: Date.now(),
    cases: options.cases,
    results: orderedResults(options.cases, resultByCaseId),
  });
  if (options.reportPath) {
    await writeJsonAtomic(options.reportPath, report);
  }
  return report;
}

function orderedResults(cases, resultByCaseId) {
  return cases.flatMap((item) => {
    const result = resultByCaseId.get(item.id);
    return result ? [result] : [];
  });
}
