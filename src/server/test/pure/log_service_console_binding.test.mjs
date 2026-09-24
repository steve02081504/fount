/**
 * 回归：日志线路服务的历史快照与 append 监听必须绑定到同一个具体控制台。
 * 全局 `console` 是按 `AsyncLocalStorage` 解析的代理；若把代理交给 wire 处理器，
 * 连接请求期解析到的活动控制台可能与构造期不同，导致快照恒为空而 append 照常工作。
 */
/* global Deno */
import EventEmitter from 'node:events'

import { assert, assertEquals } from 'jsr:@std/assert'

/**
 * 最小 WebSocket 替身：记录发送帧并支持 wire 处理器注册的事件。
 */
class FakeWebSocket extends EventEmitter {
	readyState = 1
	sent = []
	/**
	 * 记录待发帧。
	 * @param {string} data - 帧正文。
	 * @returns {void}
	 */
	send(data) { this.sent.push(String(data)) }
	/**
	 * 关闭连接并触发 `close`。
	 * @returns {void}
	 */
	close() { this.readyState = 3; this.emit('close') }
}

Deno.test('log_service snapshot and append bind to the same concrete console', async () => {
	const {
		consoleAsyncStorage,
		getGlobalConsoleResolver,
		VirtualConsole,
	} = await import('npm:@steve02081504/virtual-console/node')
	const { logServiceWebSocketHandler } = await import('../../web_server/log_service/logs.mjs')

	const bound = getGlobalConsoleResolver().getActiveConsole()
	// 生产由 `src/server/index.mjs` 打开缓冲记录，测试环境需显式开启才能产生快照条目。
	const previousRecordOutput = bound.options.recordOutput
	bound.options.recordOutput = true
	const ws = new FakeWebSocket()
	try {
		bound.log('log-service-binding-marker')

		const decoy = new VirtualConsole()
		// 在另一个活动控制台上下文中处理连接：修复前快照会读到空的 decoy。
		consoleAsyncStorage.run(decoy, () => logServiceWebSocketHandler(ws, {}))

		const snapshot = JSON.parse(ws.sent[0])
		assertEquals(snapshot.type, 'vc_log_snapshot')
		assert(
			snapshot.entries.some(entry => JSON.stringify(entry.segments).includes('log-service-binding-marker')),
			'snapshot must read the console the service was bound to',
		)

		bound.log('log-service-append-marker')
		const append = ws.sent.map(frame => JSON.parse(frame)).find(frame =>
			frame.type === 'vc_log_append' && JSON.stringify(frame.entry.segments).includes('log-service-append-marker'))
		assert(append, 'append listener must fire from the bound console')
	}
	finally {
		bound.options.recordOutput = previousRecordOutput
		ws.close()
	}
})
