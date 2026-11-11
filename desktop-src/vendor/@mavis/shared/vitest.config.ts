import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'shared:unit',
    include: ['test/unit/**/*.test.ts'],
    environment: 'node',
    globals: false,
    coverage: {
      provider: 'v8',
      // Use the same glob pattern as the other 8 packages so newly-added
      // source files are automatically covered. Previously this used an
      // explicit allow-list which silently dropped src/mavis-tags.ts (its
      // 33 tests ran but contributed 0% to the coverage report).
      include: ['src/**/*.ts'],
      // Exclude type-only files (no runtime code to cover)
      exclude: ['src/index.ts', 'src/channel-route.ts', 'src/channel-plugin.ts'],
      thresholds: {
        lines: 75,
        branches: 70,
        functions: 75,
        statements: 75,
      },
    },
  },
});
