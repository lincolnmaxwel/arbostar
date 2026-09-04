import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  webServer: {
    command: 'npm run build && npx next start -p 3100',
    // 3100 instead of 3000: a local Docker setup maps port 3000 on this
    // machine, and Playwright's reuseExistingServer would silently reuse a
    // stale listener there (see CLAUDE.md's stale-server warning).
    port: 3100,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
  use: { baseURL: 'http://localhost:3100' },
});