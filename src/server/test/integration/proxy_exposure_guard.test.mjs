/* global Deno */
import http from 'node:http'
import net from 'node:net'

import { assertEquals } from 'jsr:@std/assert'

import { createExposureDetector, PROXY_EXPOSURE_PAGE } from '../../../scripts/proxy_exposure.mjs'
import { createProxyExposureGuard } from '../../../scripts/proxy_exposure_guard.mjs'

/**
 * 造出守卫依赖：记录提示服务器与停用通知。
 * @param {Function} detect 检测请求。
 * @returns {{ notices: object[], reports: Error[], guard: object }} 已创建的守卫与收集数组。
 */
function createRecordingGuard(detect) {
	const notices = []
	const reports = []
	/**
	 * 创建并记录提示服务器。
	 * @param {Function} listener 请求处理器。
	 * @returns {object} 新服务器。
	 */
	const createServer = listener => {
		const notice = http.createServer(listener)
		notices.push(notice)
		return notice
	}
	/**
	 * 收集停用通知。
	 * @param {Error} error 通知错误。
	 * @returns {number} 已收集的通知数。
	 */
	const report = error => reports.push(error)
	return { notices, reports, guard: createProxyExposureGuard({ createServer, report, detect }) }
}

Deno.test('exposure replaces the application listener and closes upgraded connections', async () => {
	const { notices, reports, guard } = createRecordingGuard(createExposureDetector(async () => [{ address: '8.8.8.8' }]))
	let dispatched = 0
	const server = http.createServer(async (req, res) => {
		if (await guard.http(req, res)) return
		dispatched++
		res.end('application')
	})
	server.on('upgrade', async (req, socket) => {
		if (await guard.upgrade(req, socket)) return
		socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n')
	})
	await new Promise(resolve => server.listen({ host: '127.0.0.1', port: 0 }, resolve))
	const { port } = server.address()
	guard.register(server, { host: '127.0.0.1', port })
	const second = http.createServer(async (req, res) => {
		if (!await guard.http(req, res)) res.end('second application')
	})
	await new Promise(resolve => second.listen({ host: '127.0.0.1', port: 0 }, resolve))
	const { port: secondPort } = second.address()
	guard.register(second, { host: '127.0.0.1', port: 0 })
	/**
	 * @param {object} headers 请求头。
	 * @returns {Promise<object>} HTTP 响应。
	 */
	const request = headers => new Promise((resolve, reject) => {
		const req = http.get({ host: '127.0.0.1', port, headers, agent: false }, res => {
			res.resume()
			res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location }))
		})
		req.on('error', reject)
	})
	const upgraded = net.connect(port, '127.0.0.1')
	try {
		await new Promise((resolve, reject) => {
			upgraded.once('error', reject)
			upgraded.once('data', resolve)
			upgraded.write('GET /ws/eval HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n')
		})
		const closed = new Promise(resolve => upgraded.once('close', resolve))
		assertEquals((await request({ host: 'public.example', forwarded: 'for=remote' })).status, 200)
		assertEquals(await request({ host: 'public.example', accept: 'text/html, */*;q=0.8' }), { status: 303, location: PROXY_EXPOSURE_PAGE })
		await guard.replacement
		await closed
		assertEquals(server.listening, false)
		assertEquals(second.listening, false)
		assertEquals(notices.length, 2)
		assertEquals(reports.length, 1)
		const secondResponse = await fetch(`http://127.0.0.1:${secondPort}/api/ping`)
		assertEquals(secondResponse.status, 500)
		await secondResponse.body.cancel()
		assertEquals((await request({ host: 'localhost' })).status, 500)
		assertEquals((await request({ host: 'localhost', accept: 'text/html;q=0' })).status, 500)
		assertEquals((await request({ host: 'localhost', accept: '*/*' })).status, 500)
		assertEquals((await request({ host: 'localhost', accept: 'text/html' })).status, 303)
		assertEquals(dispatched, 1)
	}
	finally {
		upgraded.destroy()
		for (const item of [server, second, ...notices]) {
			item.closeAllConnections()
			if (item.listening) await new Promise(resolve => item.close(resolve))
		}
	}
})

Deno.test('WebSocket exposure probe receives 500 and replaces the listener', async () => {
	const { notices, reports, guard } = createRecordingGuard(async () => true)
	const server = http.createServer()
	server.on('upgrade', (req, socket) => guard.upgrade(req, socket))
	await new Promise(resolve => server.listen({ host: '127.0.0.1', port: 0 }, resolve))
	guard.register(server, { host: '127.0.0.1', port: 0 })
	const { port } = server.address()
	/** @returns {Promise<string>} 升级响应。 */
	async function upgrade() {
		const socket = net.connect(port, '127.0.0.1')
		try {
			return await new Promise((resolve, reject) => {
				socket.on('error', reject)
				socket.once('data', chunk => resolve(chunk.toString()))
				socket.write('GET /ws/eval HTTP/1.1\r\nHost: public.example\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n')
			})
		}
		finally { socket.destroy() }
	}
	try {
		assertEquals((await upgrade()).startsWith('HTTP/1.1 500'), true)
		await guard.replacement
		assertEquals((await upgrade()).startsWith('HTTP/1.1 500'), true)
		assertEquals(reports.length, 1)
		assertEquals(server.listening, false)
	}
	finally {
		for (const item of [server, ...notices]) {
			item.closeAllConnections()
			if (item.listening) await new Promise(resolve => item.close(resolve))
		}
	}
})
