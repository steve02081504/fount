/**
 * Social 前端 Playwright 测试 driver。
 *
 *   deno run -A src/public/parts/shells/social/test/frontend/run.mjs
 */
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { runPlaywrightWithNode } from '../../../../../../../.github/workflows/test_lib/playwright_run.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CONFIG = join(__dirname, 'playwright.config.mjs')
const PORT = Number(process.env.FOUNT_TEST_FRONTEND_PORT) || 8941

const TEST_USERNAME = 'social-fe-user'

const code = await runPlaywrightWithNode({
	configPath: CONFIG,
	env: {
		FOUNT_TEST_ISOLATED: '1',
		FOUNT_TEST_USERNAME: TEST_USERNAME,
	},
	node: {
		port: PORT,
		username: TEST_USERNAME,
		apiKey: process.env.FOUNT_TEST_FRONTEND_KEY || `fount-social-fe-key-${PORT}`,
		loadParts: ['shells/social'],
		p2p: true,
		bootstrap: join(__dirname, '../node_bootstrap.mjs'),
	},
})

process.exit(code)
