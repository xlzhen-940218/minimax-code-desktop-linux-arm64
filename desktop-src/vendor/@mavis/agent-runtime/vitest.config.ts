import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));
const agentCoreDir = path.resolve(here, '../agent-core');

export default defineConfig({
  resolve: {
    alias: {
      // agent-core 的 subpath exports 需要显式 alias 到 src——vitest 走 esm 源码加载
      // 时不会消费 package.json exports.import 的 dist 路径。
      '@mavis/agent-core/tools': path.resolve(agentCoreDir, 'src/tools/index.ts'),
      '@mavis/agent-core/pi-turn-runner': path.resolve(agentCoreDir, 'src/pi-turn-runner/index.ts'),
      '@mavis/agent-core/protocol/agent-message': path.resolve(
        agentCoreDir,
        'src/protocol/agent-message.ts',
      ),
      '@mavis/agent-core/protocol/runtime-event': path.resolve(
        agentCoreDir,
        'src/protocol/runtime-event.ts',
      ),
      '@mavis/agent-core/protocol': path.resolve(agentCoreDir, 'src/protocol/index.ts'),
      '@mavis/agent-core/event-bridge': path.resolve(agentCoreDir, 'src/event-bridge/index.ts'),
      '@mavis/agent-core': path.resolve(agentCoreDir, 'src/index.ts'),
    },
  },
  test: {
    name: 'agent-runtime:unit',
    include: ['test/**/*.test.ts'],
    environment: 'node',
    globals: false,
  },
});
