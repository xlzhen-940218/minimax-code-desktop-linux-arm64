import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'system-reminder:unit',
    include: ['test/**/*.test.ts'],
    environment: 'node',
    globals: false,
    setupFiles: ['test/setup-system-reminder.ts'],
  },
});
