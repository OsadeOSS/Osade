import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    // e2e spawns a real herdr and a real agent; gate it behind OSADE_E2E=1 (§20.2).
    testTimeout: 30_000,
    environment: 'node',
    // Integration tests touch real sqlite files; keep them off one another.
    pool: 'forks',
  },
});
