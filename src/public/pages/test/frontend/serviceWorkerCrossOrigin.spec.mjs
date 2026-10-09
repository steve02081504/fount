/**
 * 跨域 `Access-Control-Allow-Origin: *` 资源必须能被 Service Worker 读成可读响应并写进缓存。
 *
 * 浏览器给 no-cors 子资源（`<img>` / `<link>`，未声明 `crossorigin`）设的凭据模式是 include，
 * 而 CDN / 头像这类主机只回 `ACAO: *`：带凭据的 cors 抓取会被 CORS 拒绝
 *（控制台那条 "The value of the 'Access-Control-Allow-Origin' header ... must not be the wildcard '*'"）。
 * 旧实现「cors 失败 → 退回原模式抓一次」的结果是每个冷启动都白报一条 CORS 错、且什么都缓存不下来。
 *
 * 这里把**真实的** `service_worker.mjs`（连同它的 policy 模块）跑在一个临时 mini-site 上，
 * 断言它缓存了那两份跨域资源，且没有任何抓取失败 / 不缓存的警告。
 */
import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'

import { expect, test } from './fixtures.mjs'

const PAGES_DIR = new URL('../../', import.meta.url)

const INDEX_HTML = `<!doctype html><meta charset="utf-8"><title>ready</title>
<script>navigator.serviceWorker.register('/service_worker.mjs', { scope: '/', type: 'module' })</script>ready`
const PAGE_HTML = `<!doctype html><meta charset="utf-8"><title>page</title>
<link rel="stylesheet" href="CROSS_ORIGIN/asset.css">
<img src="CROSS_ORIGIN/pic.png">
page`

/**
 * 起一个监听回环随机端口的 HTTP server。
 * @param {(request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse) => void} handler 请求处理函数
 * @returns {Promise<{ server: import('node:http').Server, origin: string }>} server 与它的 origin
 */
function listen(handler) {
	return new Promise(resolve => {
		const server = createServer(handler)
		server.listen(0, '127.0.0.1', () => {
			const { port } = server.address()
			resolve({ server, origin: `http://127.0.0.1:${port}` })
		})
	})
}

/**
 * 关闭 HTTP server（含 keep-alive 连接）。
 * @param {import('node:http').Server} server server
 * @returns {Promise<void>} 关闭完成
 */
async function close(server) {
	server.closeAllConnections()
	await new Promise(resolve => server.close(resolve))
}

/**
 * 跨域资源服务：样式表与图片都只回 `Access-Control-Allow-Origin: *`。
 * @param {import('node:http').IncomingMessage} request 请求
 * @param {import('node:http').ServerResponse} response 响应
 * @returns {void}
 */
function serveCrossOrigin(request, response) {
	const headers = { 'access-control-allow-origin': '*', 'cache-control': 'no-store' }
	if (request.url.startsWith('/asset.css')) {
		response.writeHead(200, { ...headers, 'content-type': 'text/css' })
		response.end('body { color: rgb(1, 2, 3) }')
	}
	else if (request.url.startsWith('/pic.png')) {
		response.writeHead(200, { ...headers, 'content-type': 'image/png' })
		response.end(Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000050001', 'hex'))
	}
	else {
		response.writeHead(404, headers)
		response.end('not found')
	}
}

test('cross-origin wildcard ACAO assets end up readable in the worker cache', async ({ browser }) => {
	const crossOrigin = await listen(serveCrossOrigin)
	const app = await listen(async (request, response) => {
		const pathname = request.url.split('?')[0]
		if (pathname.startsWith('/service_worker')) {
			response.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' })
			response.end(await readFile(new URL(`.${pathname}`, PAGES_DIR), 'utf8'))
		}
		else {
			response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
			response.end((pathname.startsWith('/page') ? PAGE_HTML : INDEX_HTML).replaceAll('CROSS_ORIGIN', crossOrigin.origin))
		}
	})

	// 自己的 context：fixture 的 context 刻意 `serviceWorkers: 'block'`，这里要真的跑 worker。
	const context = await browser.newContext({ locale: 'zh-CN' })
	const workerComplaints = []
	context.on('serviceworker', worker => {
		worker.on('console', message => {
			if (/\[SW fount\].*(failed|Not caching)/.test(message.text())) workerComplaints.push(message.text())
		})
	})

	try {
		const page = await context.newPage()
		await page.goto(`${app.origin}/`, { waitUntil: 'load', timeout: 30_000 })
		await page.waitForFunction(() => navigator.serviceWorker.controller != null, null, { timeout: 30_000 })
		await page.goto(`${app.origin}/page/`, { waitUntil: 'load', timeout: 30_000 })

		await expect.poll(async () => page.evaluate(async () => {
			const cache = await caches.open('fount')
			return (await cache.keys()).map(request => request.url)
		}), { timeout: 20_000 }).toEqual(expect.arrayContaining([
			`${crossOrigin.origin}/asset.css`,
			`${crossOrigin.origin}/pic.png`,
		]))

		// 消费方照旧拿到内容：样式表真的被应用了。
		const applied = await page.evaluate(() => [...document.styleSheets].map(sheet => sheet.href))
		expect(applied).toContain(`${crossOrigin.origin}/asset.css`)
		expect(workerComplaints).toEqual([])
	}
	finally {
		await context.close()
		await close(app.server)
		await close(crossOrigin.server)
	}
})
