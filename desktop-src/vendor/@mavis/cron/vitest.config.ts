import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'cron:unit',
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
