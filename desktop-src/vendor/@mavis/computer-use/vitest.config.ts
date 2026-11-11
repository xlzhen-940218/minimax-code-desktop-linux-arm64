import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'computer-use:unit',
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
