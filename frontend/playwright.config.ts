import { defineConfig } from '@playwright/test'
const port=process.env.E2E_PORT??'5174'
export default defineConfig({ testDir: './e2e', use: { browserName: 'chromium' }, webServer: { command: `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`, url: `http://127.0.0.1:${port}`, reuseExistingServer: !process.env.CI } })
