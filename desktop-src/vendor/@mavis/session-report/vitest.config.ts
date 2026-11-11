import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { name: 'session-report:unit', include: ['test/**/*.test.ts'], environment: 'node' },
});
