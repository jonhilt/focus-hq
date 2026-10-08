import { defineConfig } from 'vitest/config';

// Unit tests for the pure decision code (QA verdicts, badges, prompts). Kept apart from vite.config.ts, whose root is
// the client.
export default defineConfig({
  test: {
    root: '.',
    include: ['server/**/*.test.ts', 'shared/**/*.test.ts', 'client/src/**/*.test.ts', 'scripts/**/*.test.ts'],
    environment: 'node',
  },
});
