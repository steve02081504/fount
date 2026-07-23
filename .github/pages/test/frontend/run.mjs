/**
 * GitHub Pages 前端 Playwright driver：启动 pages-server → 跑 spec → 关闭。
 */
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { allocateTestPortBlock } from 'fount/scripts/test/node/launch.mjs'
import { resolveFrontendPort } from 'fount/scripts/test/playwright/env.mjs'
import { startPagesServer } from 'fount/scripts/test/playwright/pages_server.mjs'
import { runPlaywright } from 'fount/scripts/test/playwright/run.mjs'

const testDir = dirname(fileURLToPath(import.meta.url))
const configPath = join(testDir, 'playwright.config.mjs')

const { env: { FOUNT_TEST_FRONTEND_PORT: rawFrontendPort } } = process

/** @type {((port: number) => Promise<void>) | null} */
let releasePort = null
/** @type {((port: number) => Promise<void>) | null} */
let commitPort = null
/** @type {(() => Promise<void>) | null} */
let releaseAll = null

let port
if (rawFrontendPort)
	port = await resolveFrontendPort(rawFrontendPort, async () => {
		throw new Error('FOUNT_TEST_FRONTEND_PORT fallback should not run')
	})
else {
	const block = await allocateTestPortBlock({ count: 1, step: 1 })
	port = block.base
	releasePort = block.releasePort
	commitPort = block.commitPort
	releaseAll = block.releaseAll
}

if (releasePort) await releasePort(port)

/** @type {Awaited<ReturnType<typeof startPagesServer>> | null} */
let server = null
try {
	server = await startPagesServer({ port, host: '127.0.0.1' })
	if (commitPort) await commitPort(port)

	const code = await runPlaywright({
		configPath,
		env: {
			FOUNT_TEST_BASE_URL: server.baseUrl,
			FOUNT_TEST_SCOPE: process.env.FOUNT_TEST_SCOPE || 'pages',
		},
		playwrightArgs: process.argv.slice(2).join(' '),
	})
	process.exit(code)
}
finally {
	if (server) await server.close().catch(() => {})
	if (releaseAll) await releaseAll().catch(() => {})
}
