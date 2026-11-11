import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'conversation-contract:unit',
    include: ['test/**/*.test.ts'],
    environment: 'node',
    globals: false,
  },
});
