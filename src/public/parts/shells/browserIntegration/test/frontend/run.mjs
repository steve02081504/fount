/**
 * BrowserIntegration 前端 Playwright driver。
 */
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { runShellFrontendTests } from 'fount/scripts/test/playwright/shell_frontend.mjs'

const testDir = dirname(fileURLToPath(import.meta.url))

process.exit(await runShellFrontendTests({
	configPath: join(testDir, 'playwright.config.mjs'),
	testUsername: 'browserint-fe-user',
	apiKeyPrefix: 'fount-browserint-fe-key',
	loadParts: ['shells/browserIntegration'],
	bootstrapPath: join(testDir, '../node_bootstrap.mjs'),
}))
