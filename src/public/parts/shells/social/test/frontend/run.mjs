/**
 * Social 前端 Playwright 测试 driver。
 *
 *   deno run -A src/public/parts/shells/social/test/frontend/run.mjs
 */
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { pickAvailablePortBlock } from 'fount/scripts/test/launch_node.mjs'
import { resolveFrontendPort } from 'fount/scripts/test/playwright_env.mjs'
import { runPlaywrightWithNode } from 'fount/scripts/test/playwright_run.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CONFIG = join(__dirname, 'playwright.config.mjs')
/** 三阶段各需一口（步长 2）；未指定 env 时从 8941 起找连续空闲块。 */
const PORT = await resolveFrontendPort(
	process.env.FOUNT_TEST_FRONTEND_PORT,
	() => pickAvailablePortBlock(8941, 3, 2),
)

const TEST_USERNAME = 'social-fe-user'

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
		apiKey: process.env.FOUNT_TEST_FRONTEND_KEY || `fount-social-fe-key-${port}`,
		loadParts: ['shells/social'],
		p2p: true,
		bootstrap: join(__dirname, '../node_bootstrap.mjs'),
	}
}

/** 各阶段独立端口（步长 2 降低 Windows TIME_WAIT 占用相邻口风险；8941–8945 与 chat 默认 8950 错开）。 */
/** @type {Array<{ project: string, portOffset: number }>} */
const phases = [
	{ project: 'actions', portOffset: 0 },
	{ project: 'core', portOffset: 2 },
	{ project: 'tail', portOffset: 4 },
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
