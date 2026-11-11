import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'thrift-gen:unit',
    include: ['test/**/*.test.ts'],
    environment: 'node',
    globals: false,
  },
});
