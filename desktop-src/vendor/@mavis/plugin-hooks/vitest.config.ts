import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'plugin-hooks:unit',
    include: ['test/**/*.test.ts'],
    environment: 'node',
    globals: false,
  },
});
