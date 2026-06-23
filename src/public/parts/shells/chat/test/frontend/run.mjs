/**
 * Chat 前端 Playwright 测试 driver。
 *
 *   deno run -A src/public/parts/shells/chat/test/frontend/run.mjs
 */
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { pickAvailablePort } from '../../../../../../scripts/test/launch_node.mjs'
import { resolveFrontendPort } from '../../../../../../scripts/test/playwright_env.mjs'
import { runPlaywrightWithNode } from '../../../../../../scripts/test/playwright_run.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CONFIG = join(__dirname, 'playwright.config.mjs')
/** 默认从 8950 起扫描空闲口，避开 social 套件常用段。 */
const PORT = await resolveFrontendPort(process.env.FOUNT_TEST_FRONTEND_PORT, () => pickAvailablePort(8950))

const TEST_USERNAME = 'chat-fe-user'

const playwrightArgs = process.argv.slice(2).join(' ')

const code = await runPlaywrightWithNode({
	configPath: CONFIG,
	playwrightArgs,
	env: {
		FOUNT_TEST_ISOLATED: '1',
		FOUNT_TEST_USERNAME: TEST_USERNAME,
	},
	node: {
		port: PORT,
		username: TEST_USERNAME,
		apiKey: process.env.FOUNT_TEST_FRONTEND_KEY || `fount-chat-fe-key-${PORT}`,
		loadParts: ['shells/chat'],
		p2p: true,
		bootstrap: join(__dirname, '../node_bootstrap.mjs'),
	},
})

process.exit(code)
