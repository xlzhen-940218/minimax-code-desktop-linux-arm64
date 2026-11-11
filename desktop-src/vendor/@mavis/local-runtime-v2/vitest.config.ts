import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'local-runtime-v2',
    include: [
      'src/**/*.test.ts',
      'test/unit/**/*.test.ts',
      'test/architecture/**/*.architecture.test.ts',
      'test/integration/**/*.integration.test.ts',
      'test/parity/**/*.parity.test.ts',
    ],
    // 历史 E2E 由显式执行配置承接，不进入默认单测或 MR coverage 收集。
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.e2e.integration.test.ts'],
    environment: 'node',
    globals: false,
    testTimeout: 15_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/index.ts',
        'src/http/routing/bindings.gen.ts',
        'src/http/routing/contracts.gen.ts',
        'src/http/generated/**',
        // Type-only contracts emit no runtime statements for V8 to instrument.
        'src/service/matrix/contracts.ts',
        'src/service/turn-system/agent-host/contracts.ts',
        'src/service/turn-system/agent-host/execution/contracts.ts',
        'src/service/turn-system/agent-host/history/contracts.ts',
        'src/service/turn-system/agent-host/runner/contracts.ts',
        // Remove a path in the same MR that first migrates one of its methods.
        'src/http/controllers/agent.controller.ts',
        'src/http/controllers/goal.controller.ts',
        'src/http/controllers/memory.controller.ts',
        'src/http/controllers/model-provider.controller.ts',
        'src/http/controllers/permission.controller.ts',
        'src/http/controllers/pin.controller.ts',
        'src/http/controllers/project.controller.ts',
        'src/http/controllers/questionnaire.controller.ts',
        'src/**/*.test.ts',
      ],
      thresholds: {
        lines: 90,
        // IM MR3 migration debt (2026-09-20): channel-system absorbed the v1
        // channel implementation (~34k lines, ~6.8k branches at ~74%). Its
        // previous jurisdiction (packages/local-runtime) gated branches at 55;
        // the migration already added assertion-style twins of the deleted v1
        // suites (package branches 88.0 -> 88.4). Branch coverage of the
        // package therefore sits at 88.x until the transport deep error
        // branches get dedicated suites. Ratchet this floor back up towards
        // 90 as follow-up suites land; never lower it below 88.
        branches: 88,
        functions: 80,
        statements: 90,
      },
    },
  },
});
