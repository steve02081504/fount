/**
 * 匿名页面的 Service Worker 不应尝试升级需要认证的通知 WebSocket。
 *
 * 登录/注册页也会注册真实 worker；旧实现一启动就连接 `/ws/notify`，因此注册期间服务端
 * 每 5 秒记录一次 401。worker 应先确认 `/api/whoami`，并在登录后的页面导航中重新检查再连接。
 */
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'

import { expect, test } from './fixtures.mjs'

const PAGES_DIR = new URL('../../', import.meta.url)
const INDEX_HTML = `<!doctype html><meta charset="utf-8"><title>auth gate</title>
<script>navigator.serviceWorker.register('/service_worker.mjs', { scope: '/', type: 'module' })</script>`

/**
 * 关闭 HTTP server（含 keep-alive 连接）。
 * @param {import('node:http').Server} server server
 * @returns {Promise<void>} 关闭完成
 */
async function close(server) {
	server.closeAllConnections()
	await new Promise(resolve => server.close(resolve))
}

test('notification WebSocket waits for authentication', async ({ browser }) => {
	let authenticated = false
	let whoamiRequests = 0
	let upgradeRequests = 0
	const server = createServer(async (request, response) => {
		const pathname = request.url.split('?')[0]
		if (pathname.startsWith('/service_worker')) {
			response.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' })
			response.end(await readFile(new URL(`.${pathname}`, PAGES_DIR), 'utf8'))
		}
		else if (pathname === '/api/whoami') {
			whoamiRequests++
			response.writeHead(authenticated ? 200 : 401, { 'content-type': 'application/json', 'cache-control': 'no-store' })
			response.end(authenticated ? '{"username":"test"}' : '{"message":"unauthorized"}')
		}
		else if (pathname === '/api/login') {
			authenticated = true
			response.writeHead(204, { 'cache-control': 'no-store' })
			response.end()
		}
		else {
			response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
			response.end(INDEX_HTML)
		}
	})
	server.on('upgrade', (_request, socket) => {
		upgradeRequests++
		socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
	})
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
	const { port } = server.address()
	const origin = `http://127.0.0.1:${port}`
	const context = await browser.newContext({ locale: 'zh-CN' })

	try {
		const page = await context.newPage()
		await page.goto(origin, { waitUntil: 'load', timeout: 30_000 })
		await page.waitForFunction(() => navigator.serviceWorker.controller != null, null, { timeout: 30_000 })

		await expect.poll(() => ({ whoamiRequests, upgradeRequests })).toEqual({ whoamiRequests: 1, upgradeRequests: 0 })
		await page.evaluate(() => Promise.all([fetch('/asset-a'), fetch('/asset-b')]).then(responses => responses.map(response => response.status)))
		await expect.poll(() => ({ whoamiRequests, upgradeRequests })).toEqual({ whoamiRequests: 1, upgradeRequests: 0 })

		await page.evaluate(() => fetch('/api/login', { method: 'POST' }).then(response => response.status))
		await expect.poll(() => ({ whoamiRequests, upgradeRequests })).toEqual({ whoamiRequests: 1, upgradeRequests: 0 })
		await page.goto(`${origin}/app`, { waitUntil: 'load', timeout: 30_000 })
		await expect.poll(() => upgradeRequests).toBe(1)
	}
	finally {
		await context.close()
		await close(server)
	}
})
