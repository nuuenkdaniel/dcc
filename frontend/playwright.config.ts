import { defineConfig } from '@playwright/test'
const port=process.env.E2E_PORT??'5173'
const origin=process.env.DCC_TEST_ORIGIN??`http://127.0.0.1:${port}`
export default defineConfig({ testDir: './e2e', testIgnore:'production.spec.ts', use: { browserName: 'chromium',baseURL:origin }, webServer: { command: `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`, url: origin, reuseExistingServer: !process.env.CI } })
