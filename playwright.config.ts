import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/browser',
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  use: {
    channel: process.env.BROWSER_CHANNEL,
    baseURL: 'http://127.0.0.1:5173',
    viewport: { width: 1440, height: 900 },
    launchOptions: { args: ['--enable-unsafe-swiftshader'] },
    trace: { mode: 'retain-on-failure', screenshots: false, snapshots: true },
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'npm run dev:client -- --port 5173 --strictPort',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: true,
    },
    {
      command: 'npm run start:server',
      url: 'http://127.0.0.1:8080/healthz',
      reuseExistingServer: true,
    },
  ],
});
