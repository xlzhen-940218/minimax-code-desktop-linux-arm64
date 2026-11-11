import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'agent-tools:unit',
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
