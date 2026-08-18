/**
 * Telegram bot 前端 Playwright driver。
 */
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { runShellFrontendTests } from 'fount/scripts/test/playwright/shell_frontend.mjs'

const testDir = dirname(fileURLToPath(import.meta.url))

process.exit(await runShellFrontendTests({
	configPath: join(testDir, 'playwright.config.mjs'),
	testUsername: 'telegrambot-fe-user',
	apiKeyPrefix: 'fount-telegrambot-fe-key',
	loadParts: ['shells/telegrambot', 'shells/chat'],
	bootstrapPath: join(testDir, '../node_bootstrap.mjs'),
	fixtureCopies: [
		{ from: join(testDir, 'fixtures/chars/urlChar'), to: 'chars/urlChar' },
	],
}))
