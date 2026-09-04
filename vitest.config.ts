import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    environment: 'node',
    // Integration tests touch real sqlite files; keep them off one another.
    pool: 'forks',
  },
});
