import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    // Resolve the workspace package to source so unit tests run without a
    // prior build of @aglotrends/database.
    alias: {
      '@aglotrends/database': fileURLToPath(new URL('../../database/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
