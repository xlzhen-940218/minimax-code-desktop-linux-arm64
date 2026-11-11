#!/usr/bin/env node

import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

import { loadCases, validateCases } from './case-format.mjs';
import { runBenchmark } from './benchmark-runner.mjs';
import { createProductionTitleRunner } from './production-runner.mjs';

const MODELS = {
  m3: 'minimax/MiniMax-M3',
  'm3.05': 'custom_provider:innerTest/MiniMax-M3',
};

const USAGE =
  'Usage: pnpm benchmark:session-title -- --model <m3|m3.05|model-ref> [--smoke N] [--output-dir PATH]\n';

export async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  if (options.help) {
    process.stderr.write(USAGE);
    return;
  }
  const casesPath = new URL('./cases.json', import.meta.url);
  const allCases = await loadCases(casesPath);
  const errors = validateCases(allCases);
  if (errors.length > 0) throw new Error(`invalid benchmark corpus:\n${errors.join('\n')}`);
  const selectedCases = options.smoke ? allCases.slice(0, options.smoke) : allCases;
  const modelRef = MODELS[options.model] ?? options.model;
  const outputDir = options.outputDir;
  await mkdir(outputDir, { recursive: true });
  const slug = options.model.replace(/[^a-z0-9.]+/giu, '-').toLowerCase();
  const runKind = options.smoke ? `smoke-${options.smoke}` : 'full';
  const checkpointPath = join(outputDir, `${slug}.${runKind}.checkpoint.json`);
  const reportPath = join(outputDir, `${slug}.${runKind}.report.json`);
  const runner = await createProductionTitleRunner({ modelRef });
  const report = await runBenchmark({
    modelRef,
    cases: selectedCases,
    runner,
    checkpointPath,
    reportPath,
    onProgress: ({ completed, total, result }) => {
      process.stdout.write(`[${completed}/${total}] ${result.caseId}: ${result.status}\n`);
    },
  });
  process.stdout.write(
    `${JSON.stringify({ modelRef, reportPath, checkpointPath, summary: report.summary })}\n`,
  );
}

export function parseArgs(args) {
  const parsed = {
    model: '',
    smoke: 0,
    outputDir: join(tmpdir(), 'session-title-benchmark'),
    help: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === '--') continue;
    if (value === '--model') parsed.model = requiredValue(args, ++index, '--model');
    else if (value === '--smoke')
      parsed.smoke = positiveInteger(requiredValue(args, ++index, '--smoke'));
    else if (value === '--output-dir')
      parsed.outputDir = requiredValue(args, ++index, '--output-dir');
    else if (value === '--help') parsed.help = true;
    else throw new Error(`unsupported argument: ${value}`);
  }
  if (!parsed.help && !parsed.model) throw new Error(`--model is required\n${USAGE}`);
  parsed.outputDir = resolve(parsed.outputDir);
  return parsed;
}

function requiredValue(args, index, flag) {
  const value = args[index];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function positiveInteger(value) {
  if (!/^[1-9]\d*$/u.test(value)) throw new Error('--smoke must be a positive integer');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error('--smoke must be a positive integer');
  return parsed;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
