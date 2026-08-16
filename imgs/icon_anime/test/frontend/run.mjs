/**
 * icon_anime 前端 Playwright driver：以仓库根为静态根 → spec → 关闭。
 */
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { REPO_ROOT } from 'fount/scripts/test/core/repo_root.mjs'
import { allocateTestPortBlock } from 'fount/scripts/test/node/launch.mjs'
import { resolveFrontendPort } from 'fount/scripts/test/playwright/env.mjs'
import { runPlaywright } from 'fount/scripts/test/playwright/run.mjs'
import express from 'npm:express'

/**
 * 以仓库根为静态根，让 `imgs/icon_anime` 用相对路径加载 `src/public/pages/scripts`。
 * @param {{ port: number, host: string }} options 监听
 * @returns {Promise<{ baseUrl: string, close: () => Promise<void> }>} 服务器
 */
function startStaticServer({ port, host }) {
	const app = express()
	/**
	 * template.mjs 会 `import { base_dir } from '../../base.mjs'`。
	 * 不挂整份 pages/base.mjs（Sentry / watch / 侧信道）。
	 */
	app.use((request, response, next) => {
		if (request.path === '/src/public/pages/base.mjs' || request.path === '/base.mjs')
			return response.type('js').send('export const base_dir = "/"\n')
		next()
	})
	app.use(express.static(REPO_ROOT))
	return new Promise((resolve, reject) => {
		const server = app.listen(port, host, () => {
			resolve({
				baseUrl: `http://${host}:${port}`,
				/**
				 * 关闭 HTTP server（掐断 keep-alive）。
				 * @returns {Promise<void>}
				 */
				close: () => new Promise((closeResolve, closeReject) => {
					server.closeAllConnections?.()
					server.close(error => error ? closeReject(error) : closeResolve())
				}),
			})
		})
		server.on('error', reject)
	})
}

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

/** @type {Awaited<ReturnType<typeof startStaticServer>> | null} */
let server = null
try {
	server = await startStaticServer({ port, host: '127.0.0.1' })
	if (commitPort) await commitPort(port)

	process.exitCode = await runPlaywright({
		configPath: join(dirname(fileURLToPath(import.meta.url)), 'playwright.config.mjs'),
		env: {
			FOUNT_TEST_BASE_URL: server.baseUrl,
			FOUNT_TEST_SCOPE: process.env.FOUNT_TEST_SCOPE || 'icon_anime',
		},
		playwrightArgs: process.argv.slice(2),
	})
	process.stdout.write(`[icon_anime] playwright exited code=${process.exitCode}\n`)
}
finally {
	try {
		if (server) {
			await server.close()
			process.stdout.write('[icon_anime] server closed\n')
		}
	}
	finally {
		if (releaseAll) try {
			await releaseAll()
		}
		catch (error) {
			console.error('[icon_anime] releaseAll failed', error)
			if (!process.exitCode) process.exitCode = 1
		}
	}
}
