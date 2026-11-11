import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { agentRuntimeVitestAliases } from '../agent-runtime/src/testing/vitest.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const agentModulesDir = path.resolve(here, '../agent-modules');

export default defineConfig({
  resolve: {
    alias: {
      ...agentRuntimeVitestAliases(here),
      '@mavis/session-report': path.resolve(agentModulesDir, 'session-report/src/index.ts'),
      '@mavis/context-manager': path.resolve(agentModulesDir, 'context-manager/src/index.ts'),
      '@mavis/permission': path.resolve(agentModulesDir, 'permission/src/index.ts'),
      '@mavis/runaway-guard': path.resolve(agentModulesDir, 'runaway-guard/src/index.ts'),
      '@mavis/skills': path.resolve(agentModulesDir, 'skills/src/index.ts'),
      '@mavis/system-reminder': path.resolve(agentModulesDir, 'system-reminder/src/index.ts'),
    },
  },
  test: {
    name: 'agent-extension:unit',
    include: ['test/**/*.test.ts'],
    environment: 'node',
    globals: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'cobertura', 'html'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
    },
  },
});
