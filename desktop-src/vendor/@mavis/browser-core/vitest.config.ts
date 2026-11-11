import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'browser-core:unit',
    include: ['test/**/*.test.ts'],
    environment: 'node',
    globals: false,
  },
});
