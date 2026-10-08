import net from 'node:net'

import WebSocket from 'npm:ws'

import { API_PREFIX } from './client.mjs'

/** 令牌续期失败前的等待上限。 */
const RENEW_TIMEOUT_MS = 5000
/** 事件订阅断线重连的退避上限。 */
const MAX_RECONNECT_DELAY_MS = 15_000

/**
 * 创建 CLI 传输层：cookie 认证、IPC 令牌续期，以及 HTTP / WS 请求。
 * @param {object} root0 - 连接参数。
 * @param {string} root0.baseUrl - 服务端地址。
 * @param {string} [root0.accessToken] - 服务端发放的短期访问令牌。
 * @param {string} [root0.apiKey] - 直接使用的 API key，优先于访问令牌。
 * @param {string} [root0.username] - 令牌续期所需的用户名。
 * @param {number} [root0.ipcPort] - IPC 端口；调用方总是传入服务端自己的值。
 * @returns {object} 传输层句柄（`request` / `stream` / `renew` / `events` / `close` 与 HTTP 快捷方法）。
 */
export function createTransport({ baseUrl, accessToken, apiKey, username, ipcPort }) {
	let token = accessToken
	const connections = new Set()
	const lifetime = new AbortController()
	/**
	 * 当前请求使用的 Cookie 头。
	 * @returns {string} Cookie 头值。
	 */
	const cookie = () => apiKey ? `fount-apikey=${apiKey}` : `accessToken=${token}`
	/**
	 * 通过 IPC 向服务端换取新的访问令牌。
	 * @returns {Promise<string>} 访问令牌。
	 */
	async function renew() {
		if (apiKey) return apiKey
		const reply = await new Promise((resolve, reject) => {
			const socket = net.createConnection({ host: 'localhost', port: ipcPort })
			let text = ''
			const timer = setTimeout(() => { socket.destroy(); reject(new Error('CLI authentication refresh timed out')) }, RENEW_TIMEOUT_MS)
			socket.setEncoding('utf8')
			socket.on('connect', () => socket.write(JSON.stringify({
				type: 'invokepart', data: {
					username, partpath: 'shells/code', data: { operation: 'cli-token' },
				}
			}) + '\n'))
			socket.on('data', chunk => {
				text += chunk
				if (!text.includes('\n')) return
				clearTimeout(timer)
				socket.end()
				resolve(JSON.parse(text.slice(0, text.indexOf('\n'))))
			})
			socket.once('close', () => { clearTimeout(timer); reject(new Error('CLI authentication refresh closed early')) })
			socket.once('error', reject)
		})
		if (reply.status !== 'ok') throw new Error(reply.message)
		token = reply.data.accessToken
		return token
	}
	/**
	 * 发送一次 HTTP 请求；401 时先续期令牌再重试一次。
	 * @param {string} method - HTTP 方法。
	 * @param {string} path - 以 `/` 开头时视为完整路径，否则拼在 code API 前缀之后。
	 * @param {object} [body] - JSON 请求体。
	 * @param {boolean} [retry] - 是否允许续期后重试。
	 * @returns {Promise<unknown>} 解析后的响应体。
	 */
	async function request(method, path, body, retry = true) {
		const response = await fetch(new URL(path.startsWith('/') ? path : API_PREFIX + path, baseUrl), {
			method, headers: { Cookie: cookie(), ...body === undefined ? {} : { 'content-type': 'application/json' } },
			body: body === undefined ? undefined : JSON.stringify(body),
		})
		if (response.status === 401 && retry) { await renew(); return request(method, path, body, false) }
		if (!response.ok) throw Object.assign(new Error(`${response.status} ${await response.text()}`), { status: response.status })
		return response.json()
	}
	/**
	 * 建立带认证的 WebSocket 连接。
	 * @param {string} path - WS 路径。
	 * @param {AbortSignal} [signal] - 连接期间的取消信号。
	 * @returns {Promise<import('npm:ws').WebSocket>} 已连接的 socket。
	 */
	function socket(path, signal) {
		return new Promise((resolve, reject) => {
			if (lifetime.signal.aborted || signal?.aborted) { reject(new Error('transport closed or interrupted')); return }
			const url = new URL(path, baseUrl)
			url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
			const connection = new WebSocket(url, { headers: { Cookie: cookie() } })
			connections.add(connection)
			/** @returns {void} 终止尚未完成的握手。 */
			const stop = () => { try { connection.terminate() } catch { /* already closed */ } }
			/** @returns {void} 释放连接监听。 */
			const cleanup = () => { connections.delete(connection); signal?.removeEventListener('abort', stop) }
			signal?.addEventListener('abort', stop, { once: true })
			connection.once('close', cleanup)
			connection.once('open', () => resolve(connection))
			connection.once('error', reject)
			connection.once('close', () => reject(new Error('connection closed before opening')))
		})
	}
	/**
	 * 建立 WS、发送载荷并等待终态帧；连接失败时先续期令牌再重试一次。
	 * @param {string} path - WS 路径。
	 * @param {object} payload - 发送载荷。
	 * @param {object} [root0] - 流选项。
	 * @param {(frame: object) => void} [root0.onFrame] - 每帧回调。
	 * @param {AbortSignal} [root0.signal] - 中断信号。
	 * @param {string} [root0.runId] - 本运行 ID；已发送载荷时用它发出定向 abort。
	 * @returns {Promise<object>} 终态帧（done / aborted / error）。
	 */
	async function stream(path, payload, { onFrame = () => { }, signal, runId } = {}) {
		if (signal?.aborted || lifetime.signal.aborted) throw Object.assign(new Error('interrupted'), { code: 130 })
		let connection
		try { connection = await socket(path, signal) }
		catch (error) {
			if (signal?.aborted || lifetime.signal.aborted) throw Object.assign(new Error('interrupted'), { code: 130 })
			await renew()
			connection = await socket(path, signal)
		}
		if (signal?.aborted || lifetime.signal.aborted) {
			connection.close()
			throw Object.assign(new Error('interrupted'), { code: 130 })
		}
		return new Promise((resolve, reject) => {
			let settled = false
			let sent = false
			/**
			 * 结束本次流并释放监听。
			 * @param {Error} error - 失败原因。
			 * @returns {void} 无返回值。
			 */
			const fail = error => {
				if (settled) return
				settled = true
				signal?.removeEventListener('abort', onAbort)
				connection.close()
				reject(error)
			}
			/**
			 * 中断处理：已发送载荷时发送定向 abort，否则直接结束。
			 * @returns {void} 无返回值。
			 */
			const onAbort = () => {
				if (sent && runId) connection.send(JSON.stringify({ type: 'abort', sessionId: payload.sessionId || payload.session?.id, runId, machine: payload.machine, workdir: payload.workdir }))
				else fail(Object.assign(new Error('interrupted'), { code: 130 }))
			}
			signal?.addEventListener('abort', onAbort, { once: true })
			connection.on('message', bytes => {
				let frame
				try { frame = JSON.parse(String(bytes)) } catch { return }
				if (frame.sessionId && frame.sessionId !== (payload.sessionId || payload.session?.id)) return
				if (frame.runId && runId && frame.runId !== runId && payload.type !== 'attach') return
				onFrame(frame)
				if (settled || !['done', 'aborted', 'error'].includes(frame.type)) return
				settled = true
				signal?.removeEventListener('abort', onAbort)
				connection.close()
				resolve(frame)
			})
			connection.once('error', fail)
			connection.once('close', () => fail(new Error('connection closed before run settled')))
			if (signal?.aborted || lifetime.signal.aborted) onAbort()
			else { connection.send(JSON.stringify(payload)); sent = true }
		})
	}
	/**
	 * 订阅用户事件总线（`/ws/notify`）；断线后按退避重连，直到中断。
	 * @param {object} [root0] - 订阅选项。
	 * @param {(type: string, data: object) => void} [root0.onEvent] - 每帧回调（服务端事件类型与负载）。
	 * @param {AbortSignal} [root0.signal] - 中断信号。
	 * @returns {Promise<void>} 中断后结束。
	 */
	async function events({ onEvent = () => { }, signal } = {}) {
		let delay = 1000
		while (!signal?.aborted && !lifetime.signal.aborted) {
			try {
				const connection = await socket('/ws/notify', signal)
				delay = 1000
				await new Promise(resolve => {
					/**
					 * 结束本次订阅连接。
					 * @returns {void} 无返回值。
					 */
					const finish = () => { signal?.removeEventListener('abort', finish); lifetime.signal.removeEventListener('abort', finish); connection.close(); resolve() }
					connection.on('message', bytes => {
						let frame
						try { frame = JSON.parse(String(bytes)) } catch { return }
						if (frame?.type) onEvent(frame.type, frame.data)
					})
					connection.once('close', finish)
					connection.once('error', finish)
					signal?.addEventListener('abort', finish, { once: true })
					lifetime.signal.addEventListener('abort', finish, { once: true })
				})
			}
			catch {
				// 连接或续期失败：先在还能续期时换一次令牌，再交给下面的退避重试（服务端重启后自动恢复订阅）。
				if (!signal?.aborted && !lifetime.signal.aborted) await renew().catch(() => { })
			}
			if (signal?.aborted || lifetime.signal.aborted) return
			await new Promise(resolve => {
				/**
				 * 退避结束或订阅被中断时释放监听。
				 * @returns {void} 无返回值。
				 */
				const finish = () => {
					clearTimeout(timer)
					signal?.removeEventListener('abort', finish)
					lifetime.signal.removeEventListener('abort', finish)
					resolve()
				}
				const timer = setTimeout(finish, delay)
				signal?.addEventListener('abort', finish, { once: true })
				lifetime.signal.addEventListener('abort', finish, { once: true })
			})
			delay = Math.min(delay * 2, MAX_RECONNECT_DELAY_MS)
		}
	}
	/**
	 * 关闭全部已建立的连接。
	 * @returns {void} 无返回值。
	 */
	const close = () => { lifetime.abort(); for (const connection of connections) try { connection.terminate() } catch { /* already closed */ } }
	/**
	 * 发送 GET 请求。
	 * @param {string} path - 请求路径。
	 * @returns {Promise<unknown>} 响应体。
	 */
	const get = path => request('GET', path)
	/**
	 * 发送 POST 请求。
	 * @param {string} path - 请求路径。
	 * @param {object} [body] - JSON 请求体。
	 * @returns {Promise<unknown>} 响应体。
	 */
	const post = (path, body) => request('POST', path, body)
	/**
	 * 发送 PUT 请求。
	 * @param {string} path - 请求路径。
	 * @param {object} [body] - JSON 请求体。
	 * @returns {Promise<unknown>} 响应体。
	 */
	const put = (path, body) => request('PUT', path, body)
	/**
	 * 发送 DELETE 请求。
	 * @param {string} path - 请求路径。
	 * @returns {Promise<unknown>} 响应体。
	 */
	const deleteRequest = path => request('DELETE', path)
	return { request, stream, renew, events, close, get, post, put, delete: deleteRequest }
}
