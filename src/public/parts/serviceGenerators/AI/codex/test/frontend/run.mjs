import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { runShellFrontendTests } from 'fount/scripts/test/playwright/shell_frontend.mjs'

const testDir = dirname(fileURLToPath(import.meta.url))

process.exit(await runShellFrontendTests({
	configPath: join(testDir, 'playwright.config.mjs'),
	testUsername: 'codex-fe-user',
	apiKeyPrefix: 'fount-codex-fe-key',
	loadParts: ['shells/serviceSourceManage', 'serviceGenerators/AI/codex'],
	fixtureCopies: [
		{ from: join(testDir, '../fixtures/source'), to: 'serviceSources/AI/test-codex-source' },
	],
}))
