#!/usr/bin/env tsx
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateDesktopService } from '../src/generator/index.js';

interface CliArgs {
  idlDir?: string;
  idlRef?: string;
  clientOutDir?: string;
  localRuntimeRoutesOut?: string;
  v2Dir?: string;
  help: boolean;
}

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const args = parseArgs(process.argv.slice(2));
const contractOutDir = join(packageRoot, 'src/generated/desktop-service');
const clientOutDir = args.clientOutDir
  ? resolve(process.cwd(), args.clientOutDir)
  : resolve(packageRoot, '../thrift-gen-client/src/generated/desktop-service');
const localRuntimeRoutesOut = args.localRuntimeRoutesOut
  ? resolve(process.cwd(), args.localRuntimeRoutesOut)
  : resolve(packageRoot, '../local-runtime-v2/src/http/desktop/routes.ts');

const defaultV2PkgDir = resolve(packageRoot, '../local-runtime-v2');
const v2Dir = args.v2Dir
  ? resolve(process.cwd(), args.v2Dir)
  : existsSync(defaultV2PkgDir)
    ? resolve(defaultV2PkgDir, 'src/http')
    : undefined;

if (args.help) {
  printHelp();
  process.exit(0);
}

if (!args.v2Dir && !v2Dir) {
  console.log('[thrift-gen] Skipping v2 output: packages/local-runtime-v2 not found.');
}

const result = await generateDesktopService({
  cwd: process.cwd(),
  explicitIdlDir: args.idlDir,
  idlRef: args.idlRef,
  outDir: contractOutDir,
  clientOutDir,
  localRuntimeRoutesOut,
  v2OutDir: v2Dir,
});

console.log(
  `Generated DesktopService contract from ${result.source.idlFile} (${result.source.source}) into ${resolve(contractOutDir)}, ${clientOutDir}, and ${localRuntimeRoutesOut}` +
    (v2Dir ? `\nGenerated v2 outputs into ${v2Dir}` : ''),
);
if (result.warnings.length > 0) {
  console.log(`Warnings:\n${result.warnings.map((w) => `  - ${w}`).join('\n')}`);
}

function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = { help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
      continue;
    }
    if (arg === '--idl-dir') {
      parsed.idlDir = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--idl-ref') {
      parsed.idlRef = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--client-out-dir') {
      parsed.clientOutDir = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--local-runtime-routes-out') {
      parsed.localRuntimeRoutesOut = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--v2-dir') {
      parsed.v2Dir = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function readValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value) throw new Error(`${flag} requires a value`);
  return value;
}

function printHelp(): void {
  console.log(`Usage: pnpm --filter @mavis/thrift-gen generate -- [options]

Options:
  --idl-dir <path>                    Use an explicit local weaver/idl checkout or worktree.
  --idl-ref <ref>                     When falling back to clone, checkout this branch/tag/commit.
  --client-out-dir <path>             Write the renderer-safe generated client package files here. Defaults to packages/thrift-gen-client/src/generated/desktop-service.
  --local-runtime-routes-out <path>   Write the generated local-runtime routes shim here. Defaults to packages/local-runtime-v2/src/http/desktop/routes.ts.
  --v2-dir <path>                     Write v2 contracts, bindings, and generated controller bases here. Defaults to packages/local-runtime-v2/src/http (skipped when that package does not exist).
  -h, --help                          Show this help.

Without --idl-dir the resolver searches nearby weaver/idl checkouts first. If none contains matrix/desktop_service/desktop_service.thrift, it fresh-clones git@gitlab.xaminim.com:weaver/idl.git into /tmp for this generation.`);
}
