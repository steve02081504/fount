/**
 * code shell 前端 Playwright driver。
 */
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { runShellFrontendTests } from 'fount/scripts/test/playwright/shell_frontend.mjs'

const testDir = dirname(fileURLToPath(import.meta.url))

process.exit(await runShellFrontendTests({
	configPath: join(testDir, 'playwright.config.mjs'),
	testUsername: 'code-fe-user',
	apiKeyPrefix: 'fount-code-fe-key',
	loadParts: ['shells/code'],
	bootstrapPath: join(testDir, '../node_bootstrap.mjs'),
	fixtureCopies: [
		{ from: join(testDir, 'fixtures/chars/codeBuddy'), to: 'chars/codeBuddy' },
		{ from: join(testDir, 'fixtures/chars/testAgent'), to: 'chars/testAgent' },
		{ from: join(testDir, 'fixtures/chars/streamAgent'), to: 'chars/streamAgent' },
		{ from: join(testDir, 'fixtures/serviceSources/AI/stubAI'), to: 'serviceSources/AI/stubAI' },
	],
}))
