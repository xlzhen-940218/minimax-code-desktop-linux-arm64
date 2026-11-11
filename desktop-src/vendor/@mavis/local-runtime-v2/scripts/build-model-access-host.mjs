import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));

export async function buildModelAccessHost(
  outfile = path.join(packageRoot, 'dist/model-access-host/host-entry.mjs'),
) {
  await mkdir(path.dirname(outfile), { recursive: true });
  const result = await build({
    absWorkingDir: packageRoot,
    entryPoints: ['src/service/model-access-extension/host-process/shim/host-entry.ts'],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    sourcemap: false,
    metafile: true,
    logLevel: 'silent',
  });
  return result.metafile;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await buildModelAccessHost();
}
