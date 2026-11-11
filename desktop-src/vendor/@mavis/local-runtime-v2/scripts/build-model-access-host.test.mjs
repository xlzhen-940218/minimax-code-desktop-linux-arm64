import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { buildModelAccessHost } from './build-model-access-host.mjs';
import { prepareModelAccessHostResource } from '../../../apps/electron/scripts/model-access-host-package.mjs';
import { createTuiBundleModuleLocationConfig } from '../../../scripts/lib/tui-npm-bundle-profile.mjs';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const entrySource = path.join(
  repositoryRoot,
  'packages/local-runtime-v2/src/service/model-access-extension/host-process/entry-path.ts',
);
const execFileAsync = promisify(execFile);

test(
  'compiled proxy sends large JSON and binary through compiled child without network',
  { timeout: 20_000 },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'model-access-upload-'));
    try {
      const host = path.join(root, 'host-entry.mjs');
      await buildModelAccessHost(host);
      const fixture = path.join(root, 'fixture.mjs');
      await writeFile(
        fixture,
        `import { createHash } from 'node:crypto';
      export default { providers: { fixture: {
        models: async () => [], classifyError: () => ({ category: 'request', code: 'fixture', retryable: false }),
        bindTransport: async () => ({ api: 'openai-completions', modelId: 'fixture', baseUrl: 'https://synthetic.invalid',
          fetch: async (_input, init) => new Response(JSON.stringify({
            bytes: init.body.byteLength, hash: createHash('sha256').update(init.body).digest('hex')
          })) })
      } }, sources: { fixture: {} } };`,
      );
      const directory = path.join(
        repositoryRoot,
        'packages/local-runtime-v2/src/service/model-access-extension/host-process',
      );
      const driver = path.join(root, 'driver.mjs');
      await build({
        stdin: {
          resolveDir: repositoryRoot,
          contents: `
        import assert from 'node:assert/strict';
        import { createHash } from 'node:crypto';
        import { launchModelAccessHost } from ${JSON.stringify(path.join(directory, 'launcher.ts'))};
        import { createModelAccessHostTransport } from ${JSON.stringify(path.join(directory, 'proxy.ts'))};
        const host = await launchModelAccessHost({ entryPath: ${JSON.stringify(host)},
          moduleUrl: ${JSON.stringify(pathToFileURL(fixture).href)}, cwd: ${JSON.stringify(root)}, environment: {},
          manifest: { schemaVersion: 1, name: '@fixture/body', version: '1.0.0', entry: './fixture.mjs',
            engines: { mcodeSdk: '^1' }, trust: 'native-code', platforms: ['darwin','linux','win32'],
            providers: [{ id: 'fixture', credentialSchema: 1, credentialKinds: ['public'] }],
            sources: [{ id: 'fixture', hostAgentId: 'fixture', capabilities: {} }] } });
        try {
          const metadata = await host.peer.request('bindTransport', { providerId: 'fixture',
            context: { profileId: 'synthetic', installationId: 'synthetic', generation: 1, operationId: 'synthetic', dataDir: ${JSON.stringify(root)}, hostDataDir: ${JSON.stringify(root)} },
            binding: {}, credential: {}, model: {} });
          const transport = createModelAccessHostTransport(host.peer, metadata);
          for (const body of [JSON.stringify({ image: 'A'.repeat(33 * 1024 * 1024) }), Buffer.from([0,255,128,254])]) {
            const response = await transport.fetch('https://synthetic.invalid', { method: 'POST', body });
            assert.deepEqual(await response.json(), { bytes: Buffer.byteLength(body), hash: createHash('sha256').update(body).digest('hex') });
          }
          await transport.dispose();
          console.log('compiled body roundtrip passed');
        } finally { await host.stop(); }
      `,
        },
        outfile: driver,
        bundle: true,
        platform: 'node',
        format: 'esm',
        target: 'node22',
      });
      const result = await execFileAsync(process.execPath, [driver], {
        cwd: root,
        env: {},
        timeout: 15_000,
      });
      assert.match(result.stdout, /compiled body roundtrip passed/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  'compiled host is self-contained and starts with synthetic extension without a TS loader',
  { timeout: 20_000 },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'model-access-compiled-'));
    let child;
    let exited;
    let deadline;
    try {
      const entry = path.join(root, 'host-entry.mjs');
      const metadata = await buildModelAccessHost(entry);
      const builtins = new Set([
        ...builtinModules,
        ...builtinModules.map((name) => `node:${name}`),
      ]);
      for (const output of Object.values(metadata.outputs)) {
        for (const dependency of output.imports) {
          assert.ok(!dependency.external || builtins.has(dependency.path), dependency.path);
        }
      }
      const extension = path.join(root, 'fixture.mjs');
      await writeFile(
        extension,
        `export default {
      providers: { fixture: {
        models: async () => [{ id: 'synthetic-model', api: 'openai-completions' }],
        bindTransport: async () => ({ api: 'openai-completions', modelId: 'synthetic-model', baseUrl: 'https://fixture.invalid' }),
        classifyError: () => ({ category: 'request', retryable: false })
      } }, sources: { fixture: {} }
    };`,
      );
      const epoch = 'synthetic-compiled-smoke';
      child = spawn(process.execPath, [entry, `--model-access-epoch=${epoch}`], {
        cwd: root,
        env: {},
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      exited = once(child, 'exit');
      deadline = setTimeout(() => child.kill('SIGKILL'), 10_000);
      child.stderr.resume();
      const lines = createInterface({ input: child.stdout });
      const iterator = lines[Symbol.asyncIterator]();
      const nextMessage = async () => {
        const next = await iterator.next();
        assert.equal(next.done, false);
        return JSON.parse(next.value);
      };
      assert.equal((await nextMessage()).event, 'hello');
      const request = async (id, method, params) => {
        child.stdin.write(
          `${JSON.stringify({ type: 'request', version: 1, epoch, id, method, params })}\n`,
        );
        for (;;) {
          const message = await nextMessage();
          if (message.id !== id) continue;
          assert.equal(message.error, undefined);
          return message.result;
        }
      };
      await request('init', 'init', {
        moduleUrl: pathToFileURL(extension).href,
        manifest: {
          schemaVersion: 1,
          name: '@fixture/compiled',
          version: '1.0.0',
          entry: './fixture.mjs',
          engines: { mcodeSdk: '^1' },
          trust: 'native-code',
          platforms: ['darwin', 'win32', 'linux'],
          providers: [{ id: 'fixture', credentialSchema: 1, credentialKinds: ['public'] }],
          sources: [{ id: 'fixture', hostAgentId: 'fixture', capabilities: {} }],
        },
      });
      assert.ok((await request('describe', 'describe', {})).providers.fixture.includes('models'));
      assert.deepEqual(
        await request('models', 'models', {
          providerId: 'fixture',
          context: {
            profileId: 'synthetic',
            installationId: 'fixture',
            generation: 1,
            operationId: 'smoke',
            dataDir: root,
            hostDataDir: root,
          },
          binding: {},
          credential: {},
        }),
        [{ id: 'synthetic-model', api: 'openai-completions' }],
      );
      await request('shutdown', 'shutdown', {});
      assert.deepEqual(await exited, [0, null]);
    } finally {
      clearTimeout(deadline);
      if (child && child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await exited;
      }
      await rm(root, { recursive: true, force: true });
    }
  },
);

test('Electron packaging copies the compiled asset and refuses a missing build', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'model-access-electron-'));
  try {
    const input = path.join(
      root,
      'packages/local-runtime-v2/dist/model-access-host/host-entry.mjs',
    );
    const stageElectronRoot = path.join(root, 'stage/apps/electron');
    assert.throws(() => prepareModelAccessHostResource({ repoRoot: root, stageElectronRoot }));
    await mkdir(path.dirname(input), { recursive: true });
    await writeFile(input, 'synthetic compiled host');
    const destination = prepareModelAccessHostResource({ repoRoot: root, stageElectronRoot });
    assert.equal(await readFile(destination, 'utf8'), 'synthetic compiled host');
    assert.equal(
      destination,
      path.join(stageElectronRoot, 'resources/model-access-host/host-entry.mjs'),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('build and packaging entry points include the host artifact', async () => {
  const runtimePackage = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  );
  assert.ok(runtimePackage.scripts.build.includes('pnpm run build:model-access-host'));
  const electronPack = await readFile(
    path.join(repositoryRoot, 'apps/electron/scripts/package-from-deploy.mjs'),
    'utf8',
  );
  assert.match(electronPack, /prepareModelAccessHostResource\(\{ repoRoot, stageElectronRoot \}\)/);
  const tuiBuild = await readFile(path.join(repositoryRoot, 'scripts/build-tui-npm.mjs'), 'utf8');
  assert.match(
    tuiBuild,
    /buildModelAccessHost\(path.join\(outDir, 'assets\/model-access-host\/host-entry.mjs'\)\)/,
  );
  for (const locale of ['en', 'zh']) {
    for (const variant of ['', '.test', '.staging', '.internal', '.inside']) {
      const config = JSON.parse(
        await readFile(
          path.join(repositoryRoot, `apps/electron/electron-builder.${locale}${variant}.json`),
          'utf8',
        ),
      );
      assert.ok(
        config.extraResources.some(
          (resource) =>
            resource.from === 'resources' &&
            resource.to === 'resources' &&
            resource.filter.includes('**/*'),
        ),
      );
    }
  }
});

test('compiled local-runtime module resolves its package host without cwd fallback', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'model-access-runtime-'));
  try {
    const entry = path.join(
      root,
      'dist/service/model-access-extension/host-process/entry-path.mjs',
    );
    await build({
      entryPoints: [entrySource],
      outfile: entry,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
    });
    const asset = path.join(root, 'dist/model-access-host/host-entry.mjs');
    await buildModelAccessHost(asset);
    const { locateModelAccessHostEntry } = await import(pathToFileURL(entry).href);
    assert.equal(await realpath(await locateModelAccessHostEntry()), await realpath(asset));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('split TUI bundle finds the host asset outside the repository', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'model-access-tui-'));
  try {
    const bundle = path.join(root, 'bundle');
    const workspace = path.join(root, 'workspace');
    await mkdir(workspace);
    const asset = path.join(bundle, 'assets/model-access-host/host-entry.mjs');
    await buildModelAccessHost(asset);
    const location = createTuiBundleModuleLocationConfig();
    await build({
      stdin: {
        contents: `const { locateModelAccessHostEntry } = await import(${JSON.stringify(entrySource)}); console.log(await locateModelAccessHostEntry());`,
        resolveDir: repositoryRoot,
        sourcefile: 'cli.js',
      },
      outdir: bundle,
      entryNames: 'cli',
      chunkNames: 'chunks/[name]-[hash]',
      outExtension: { '.js': '.mjs' },
      bundle: true,
      splitting: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      banner: { js: location.banner },
      define: { ...location.define, __IS_NPM_BUILD__: 'true' },
    });
    const { stdout } = await execFileAsync(process.execPath, [path.join(bundle, 'cli.mjs')], {
      cwd: workspace,
      env: {},
      timeout: 10_000,
    });
    assert.equal(await realpath(stdout.trim()), await realpath(asset));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
