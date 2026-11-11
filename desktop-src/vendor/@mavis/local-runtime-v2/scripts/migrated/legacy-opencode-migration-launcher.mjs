#!/usr/bin/env node
/**
 * Legacy opencode migration acceptance launcher.
 *
 * Starts a standalone local-runtime-v2 instance against a chosen dataDir (default
 * `/tmp/mavis-opencode-pi-test`) and exposes its HTTP API on a fixed port
 * (default 15324) so legacy-opencode migration acceptance scenarios can
 * exercise the real migrator end-to-end without spinning up the full Electron
 * shell.
 *
 * The launcher uses the local-runtime-v2 dist build (NOT ts-node) on purpose:
 * the acceptance run validates the V2-owned legacy importer that desktop ships.
 *
 * Pre-launch sanity check: a stale dist would silently swallow the
 * V2 importer behavior — so before calling `createLocalRuntimeHostV2` we
 * compare the newest mtime under `src/**` against
 * `dist/**`. If src is newer, the launcher prints a rebuild hint and exits 2
 * without opening the HTTP server. Pair this launcher with
 * `pnpm --filter @mavis/local-runtime-v2 build` and the guard stays quiet.
 *
 * Usage:
 *   MAVIS_DATA_DIR=/tmp/mavis-opencode-pi-test \
 *     MAVIS_LAUNCHER_PORT=15324 \
 *     node packages/local-runtime-v2/scripts/migrated/legacy-opencode-migration-launcher.mjs
 *
 * Env:
 *   MAVIS_DATA_DIR                  — runtime dataDir; required to point at the
 *                                      reflink fixture so we never write to the
 *                                      user's real ~/.minimax/sqlite.db.
 *   MAVIS_LAUNCHER_PORT             — HTTP port (default 15324).
 *   MAVIS_LAUNCHER_HOST             — bind host (default 127.0.0.1).
 *   MAVIS_LAUNCHER_SKIP_DIST_CHECK  — set to '1' to bypass the dist staleness
 *                                      guard (e.g. CI with prebuilt dist).
 *   XDG_DATA_HOME / XDG_STATE_HOME  — strongly recommended; point at an empty
 *                                      tmp dir during acceptance to prevent the
 *                                      native DB fallback chain (see I4) from
 *                                      reading the user's real opencode.db.
 */

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { readdir, stat, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const LAUNCHER_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGES_ROOT = resolve(LAUNCHER_DIR, '..', '..', '..');
const PKG_ROOT = join(PACKAGES_ROOT, 'local-runtime-v2');
const SRC_ROOT = join(PKG_ROOT, 'src');
const DIST_ROOT = join(PKG_ROOT, 'dist');
const DIST_ENTRY = join(DIST_ROOT, 'index.js');

const DATA_DIR = process.env.MAVIS_DATA_DIR;
if (!DATA_DIR) {
  console.error(
    '[legacy-migration-launcher] FATAL: MAVIS_DATA_DIR is required (point it at a reflink fixture, NOT $HOME/.mavis).',
  );
  process.exit(2);
}

const PORT = Number(process.env.MAVIS_LAUNCHER_PORT ?? 15324);
const HOST = process.env.MAVIS_LAUNCHER_HOST ?? '127.0.0.1';
const SKIP_DIST_CHECK = process.env.MAVIS_LAUNCHER_SKIP_DIST_CHECK === '1';

/**
 * Walk a directory tree and return the newest mtime (ms) of any file matching
 * `predicate`. Skips node_modules, .turbo, and any hidden dir to keep noise out
 * of the comparison.
 */
async function newestMtimeMs(root, predicate) {
  let newest = 0;
  let newestPath = null;

  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      if (err?.code === 'ENOENT') return;
      throw err;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const p = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        if (entry.name === '.turbo') continue;
        if (entry.name.startsWith('.')) continue;
        await walk(p);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!predicate(entry.name, p)) continue;
      const s = await stat(p);
      if (s.mtimeMs > newest) {
        newest = s.mtimeMs;
        newestPath = p;
      }
    }
  }

  await walk(root);
  return { newest, newestPath };
}

async function assertDistFresh() {
  if (SKIP_DIST_CHECK) {
    console.warn(
      '[legacy-migration-launcher] WARN: MAVIS_LAUNCHER_SKIP_DIST_CHECK=1; dist staleness guard bypassed.',
    );
    return;
  }

  const distStat = await stat(DIST_ENTRY).catch(() => null);
  if (!distStat) {
    console.error(`[legacy-migration-launcher] FATAL: dist entry not found at ${DIST_ENTRY}.`);
    console.error('  run: pnpm --filter @mavis/local-runtime-v2 build');
    process.exit(2);
  }

  // Newest source file across packages/local-runtime-v2/src/**.
  const src = await newestMtimeMs(
    SRC_ROOT,
    (name) => /\.(ts|tsx|js|mjs|cjs|json)$/.test(name) && !name.endsWith('.d.ts'),
  );
  // Newest dist artefact across packages/local-runtime-v2/dist/**.
  const dist = await newestMtimeMs(
    DIST_ROOT,
    (name) => /\.(js|mjs|cjs)$/.test(name) && !name.endsWith('.d.ts'),
  );

  // Allow 1s slack to absorb filesystem mtime granularity / copy operations.
  const STALE_THRESHOLD_MS = 1000;
  if (src.newest > dist.newest + STALE_THRESHOLD_MS) {
    const skew = ((src.newest - dist.newest) / 1000).toFixed(1);
    console.error('[legacy-migration-launcher] FATAL: dist/ is stale relative to src/.');
    console.error(`  newest src : ${new Date(src.newest).toISOString()}  ${src.newestPath}`);
    console.error(`  newest dist: ${new Date(dist.newest).toISOString()}  ${dist.newestPath}`);
    console.error(`  src is ${skew}s newer than dist.`);
    console.error('');
    console.error('  Rebuild before relaunching:');
    console.error('    pnpm --filter @mavis/local-runtime-v2 build');
    console.error('');
    console.error(
      '  (This guard prevents a stale V2 dist from silently dropping the legacy importer behavior under acceptance.)',
    );
    console.error(
      '  Use MAVIS_LAUNCHER_SKIP_DIST_CHECK=1 only when you have an externally-validated prebuilt dist (CI image).',
    );
    process.exit(2);
  }

  console.log(
    `[legacy-migration-launcher] dist freshness OK (src ${new Date(src.newest).toISOString()}, dist ${new Date(dist.newest).toISOString()}).`,
  );
}

await assertDistFresh();

/**
 * Best-effort `local-runtime.auth.json` reader for managed-login providers.
 * The launcher is mostly used to validate migration + observability with no
 * real LLM call, but when an acceptance run wants to send a turn through
 * the minimax managed gateway it can drop a `local-runtime.auth.json` file
 * (the same shape `@mavis/config` writes) into the fixture dataDir. We pick
 * it up here so the LLM provider resolver sees a synced token instead of
 * throwing "managed auth token is not synced".
 */
async function loadAuthContext() {
  const candidate = join(DATA_DIR, 'local-runtime.auth.json');
  try {
    const raw = await readFile(candidate, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed?.version !== 1 || !parsed.auth?.accessToken) return undefined;
    const auth = parsed.auth;
    console.log(
      `[legacy-migration-launcher] auth context loaded (tokenLen=${auth.accessToken.length}, realUserID=${auth.realUserID ?? 'n/a'}).`,
    );
    return {
      accessToken: auth.accessToken,
      ...(auth.realUserID ? { realUserID: auth.realUserID } : {}),
      ...(auth.userEmail ? { userEmail: auth.userEmail } : {}),
      ...(auth.userName ? { userName: auth.userName } : {}),
      ...(auth.subUserName ? { subUserName: auth.subUserName } : {}),
    };
  } catch (err) {
    if (err?.code !== 'ENOENT') {
      console.warn(`[legacy-migration-launcher] auth context unreadable: ${err.message}`);
    }
    return undefined;
  }
}

const initialAuthContext = await loadAuthContext();
let cachedAuthContext = initialAuthContext;

const runtime = await import(pathToFileURL(DIST_ENTRY).href);

/**
 * Prefer the fixture's `config.yaml` (provider blocks, defaultModel, …) when
 * present so acceptance runs can swap LLM providers / models without rebuilding
 * dist. Falls back to the hard-coded `getDefaultLocalRuntimeConfig()` when
 * `@mavis/config.getConfig()` throws (e.g. fixture has no config.yaml).
 */
function buildConfigGetter() {
  try {
    // @mavis/config reads `<MAVIS_DATA_DIR>/config.yaml` via getConfigPath();
    // we already exported MAVIS_DATA_DIR for this process before importing.
    process.env.MAVIS_DATA_DIR = DATA_DIR;
    return async () => {
      const cfgPkg = await import('@mavis/config');
      const cfg = cfgPkg.getConfig();
      return { ...cfg, dataDir: DATA_DIR };
    };
  } catch (err) {
    console.warn(
      `[legacy-migration-launcher] @mavis/config unavailable, falling back to default config (${err.message}).`,
    );
    return () => ({ ...runtime.getDefaultLocalRuntimeConfig(), dataDir: DATA_DIR });
  }
}

const configGetter = buildConfigGetter();
// Eagerly resolve once so any yaml parse error fails fast at startup.
const resolvedConfig = await Promise.resolve(configGetter());
console.log(
  `[legacy-migration-launcher] config providers loaded: ${Object.keys(resolvedConfig?.provider ?? {}).join(', ') || '<none>'}`,
);

const host = await runtime.createLocalRuntimeHostV2({
  dataDir: DATA_DIR,
  runtimeMode: 'clean',
  capabilities: { cliEmbedded: true, diagnosticSidecar: true },
  runtimeOwnerKind: 'cli',
  runtimeStartupToken: randomUUID(),
  configGetter: () => resolvedConfig,
  ...(initialAuthContext ? { authContextGetter: () => cachedAuthContext } : {}),
});

const server = createServer(async (req, res) => {
  try {
    const init = { method: req.method, headers: new Headers(req.headers) };
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      init.body = Readable.toWeb(req);
      init.duplex = 'half';
    }
    const response = await host.apiHost.handleRequest(
      new Request(`http://${HOST}:${PORT}${req.url}`, init),
    );
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    if (response.body) {
      for await (const chunk of response.body) res.write(Buffer.from(chunk));
    }
    res.end();
  } catch (err) {
    console.error('[legacy-migration-launcher] request failed:', err);
    if (!res.headersSent) res.statusCode = 500;
    res.end(JSON.stringify({ error: 'launcher_request_failed', message: String(err) }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[legacy-migration-launcher] listening on http://${HOST}:${PORT}`);
  console.log(`[legacy-migration-launcher] dataDir=${DATA_DIR}`);
  console.log(
    `[legacy-migration-launcher] runtime V2 dist entry=${DIST_ENTRY} (mode=clean, owner=cli)`,
  );
});

const shutdown = (signal) => {
  console.log(`[legacy-migration-launcher] received ${signal}, shutting down`);
  server.close(() => process.exit(0));
  // Force-exit fallback if close hangs.
  setTimeout(() => process.exit(0), 5_000).unref();
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
