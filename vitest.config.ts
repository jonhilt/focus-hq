import { defineConfig } from 'vitest/config';

// Unit tests for the pure decision code (QA verdicts, badges, prompts). Kept apart from vite.config.ts, whose root is
// the client.
export default defineConfig({
  test: {
    root: '.',
    include: ['server/**/*.test.ts', 'shared/**/*.test.ts', 'client/src/**/*.test.ts', 'tools/**/*.test.ts', 'plugins/**/*.test.ts', 'plugin-api/**/*.test.ts'],
    environment: 'node',
    // seeds the server's random choices in every test (and prints the seed when one fails)
    setupFiles: ['vitest.setup.ts'],
  },
});
