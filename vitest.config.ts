import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@blockforge/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)) },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    testTimeout: 240000,
    hookTimeout: 240000,
  },
});
