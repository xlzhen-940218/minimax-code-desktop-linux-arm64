import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'remote-control-bridge:unit',
    include: ['test/**/*.test.ts'],
    environment: 'node',
    globals: false,
  },
});
