import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'agent-core:unit',
    include: ['test/**/*.test.ts'],
    environment: 'node',
    globals: false,
  },
});
