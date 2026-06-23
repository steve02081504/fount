/**
 * Chat 前端 Playwright 测试 driver。
 *
 *   deno run -A src/public/parts/shells/chat/test/frontend/run.mjs
 */
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { pickAvailablePortBlock } from 'fount/scripts/test/launch_node.mjs'
import { resolveFrontendPort } from 'fount/scripts/test/playwright_env.mjs'
import { runPlaywrightWithNode } from 'fount/scripts/test/playwright_run.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CONFIG = join(__dirname, 'playwright.config.mjs')
/** 五 project 各需一口（步长 2）；未指定 env 时从 8950 起找连续空闲块。 */
const PORT = await resolveFrontendPort(
	process.env.FOUNT_TEST_FRONTEND_PORT,
	() => pickAvailablePortBlock(8950, 5, 2),
)

const TEST_USERNAME = 'chat-fe-user'

const extraArgs = process.argv.slice(2).join(' ')
const env = {
	FOUNT_TEST_ISOLATED: '1',
	FOUNT_TEST_USERNAME: TEST_USERNAME,
}

/**
 * @param {number} port 监听端口
 * @returns {object} launchNode 选项
 */
function nodeOpts(port) {
	return {
		port,
		username: TEST_USERNAME,
		apiKey: process.env.FOUNT_TEST_FRONTEND_KEY || `fount-chat-fe-key-${port}`,
		loadParts: ['shells/chat'],
		p2p: true,
		bootstrap: join(__dirname, '../node_bootstrap.mjs'),
	}
}

/** @type {Array<{ project: string, portOffset: number }>} */
const phases = [
	{ project: 'deeplink', portOffset: 0 },
	{ project: 'hub-core', portOffset: 2 },
	{ project: 'hub', portOffset: 4 },
	{ project: 'secondary', portOffset: 6 },
	{ project: 'shell', portOffset: 8 },
]

for (const phase of phases) {
	const port = PORT + phase.portOffset
	const playwrightArgs = [extraArgs, `--project=${phase.project}`].filter(Boolean).join(' ')
	const code = await runPlaywrightWithNode({
		configPath: CONFIG,
		playwrightArgs,
		env,
		node: nodeOpts(port),
	})
	if (code !== 0) process.exit(code)
}

process.exit(0)
