import { formatCaseInput } from './case-format.mjs';

export function buildReport(input) {
  const resultsByCaseId = new Map(input.results.map((result) => [result.caseId, result]));
  const results = input.cases.map((item) => {
    const result = resultsByCaseId.get(item.id);
    if (!result) throw new Error(`missing result for benchmark case: ${item.id}`);
    titleCell(result);
    return result;
  });
  const summary = { total: results.length, success: 0, skipped: 0, error: 0 };
  for (const result of results) {
    if (!(result.status in summary)) throw new Error(`unsupported result status: ${result.status}`);
    summary[result.status] += 1;
  }
  return {
    schemaVersion: input.schemaVersion,
    modelRef: input.modelRef,
    prompt: input.prompt,
    promptSha256: input.promptSha256,
    corpusSha256: input.corpusSha256,
    generatedAtMs: input.generatedAtMs,
    cases: input.cases,
    results,
    summary,
  };
}

export function reportRows(report) {
  const resultByCaseId = new Map(report.results.map((result) => [result.caseId, result]));
  return [
    ['query', 'current prompt', 'session title'],
    ...report.cases.map((item) => [
      formatCaseInput(item),
      report.prompt,
      titleCell(resultByCaseId.get(item.id)),
    ]),
  ];
}

function titleCell(result) {
  if (!result) throw new Error('benchmark result is required');
  if (result.status === 'success') {
    if (typeof result.title !== 'string' || result.title.length === 0) {
      throw new Error(`successful benchmark result has no title: ${result.caseId}`);
    }
    return result.title;
  }
  if (typeof result.marker !== 'string' || result.marker.length === 0) {
    throw new Error(`non-success benchmark result has no marker: ${result.caseId}`);
  }
  return result.marker;
}
