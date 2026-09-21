import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { maxWorkers: 2, include: ['tests/**/*.test.ts'], testTimeout: 20000, hookTimeout: 20000 },
});
