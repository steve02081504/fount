/* global Deno */
import { assert, assertEquals, assertRejects } from 'jsr:@std/assert'
import { async_eval } from 'npm:@steve02081504/async-eval'

import { workspaceWatchScript } from '../../../code/src/workspace_watch.mjs'
import { createCallbackSessionClient } from '../../src/callback_sessions.mjs'
import { openLocalCallbackSession } from '../../src/local_callback_session.mjs'

Deno.test('callback client binds events to source, rejects gaps and ignores late frames', async () => {
	const sent = [], events = [], closed = []
	const client = createCallbackSessionClient({
		/**
		 * 处理会话回调。
		 * @param {object} frame 会话事件帧。
		 * @returns {any} 操作结果。
		 */
		send: frame => sent.push(frame) })
	try {
		const handle = client.open('device', 'producer', {
			/**
			 * 处理会话回调。
			 * @param {any} data 事件载荷。
			 * @returns {any} 操作结果。
			 */
			onEvent: data => events.push(data),
			/**
			 * 处理会话回调。
			 * @param {string} reason 结束原因。
			 * @returns {any} 操作结果。
			 */
			onClose: reason => closed.push(reason) })
		await Promise.resolve()
		client.receive({ id: handle.id, type: 'ready', result: 42 }, 'other')
		client.receive({ id: handle.id, type: 'ready', result: 7 }, 'device')
		assertEquals(await handle.ready, 7)
		client.receive({ id: handle.id, type: 'event', seq: 1, data: 'spoof' }, 'other')
		client.receive({ id: handle.id, type: 'event', seq: 1, data: 'first' }, 'device')
		client.receive({ id: handle.id, type: 'event', seq: 1, data: 'duplicate' }, 'device')
		client.receive({ id: handle.id, type: 'event', seq: 3, data: 'gap' }, 'device')
		client.receive({ id: handle.id, type: 'event', seq: 2, data: 'late' }, 'device')
		assertEquals(events, ['first'])
		assertEquals(closed, ['event-gap'])
		assertEquals(client.size, 0)
		await Promise.resolve()
		assertEquals(sent.at(-1).op, 'cancel')
	} finally { client.dispose() }
})

Deno.test('callback client disconnects immediately and cancellation during setup rejects ready', async () => {
	const client = createCallbackSessionClient({
		/**
		 * 处理会话回调。
		 * @returns {any} 操作结果。
		 */
		send: () => {} })
	try {
		const first = client.open('device', 'producer')
		client.disconnect('device')
		await assertRejects(() => first.ready, Error, 'disconnected')
		const controller = new AbortController()
		const second = client.open('device', 'producer', { signal: controller.signal })
		controller.abort()
		await assertRejects(() => second.ready, Error, 'cancelled')
		assertEquals(client.size, 0)
	} finally { client.dispose() }
})

Deno.test('callback client serializes asynchronous consumers and catches rejected callbacks', async () => {
	let release
	const events = [], reasons = []
	const client = createCallbackSessionClient({
		/**
		 * 处理会话测试回调。
		 * @returns {any} 操作结果。
		 */
		send: () => {} })
	try {
		const handle = client.open('device', 'producer', {
			/**
			 * 处理异步消费者测试回调。
			 * @param {any} data 会话参数。
			 * @returns {any} 操作结果。
			 */
			onEvent: async data => {
				events.push(data)
				if (data === 1) await new Promise(resolve => { release = resolve })
				else throw new Error('consumer failed')
			},
			/**
			 * 处理异步消费者测试回调。
			 * @param {string} reason 会话参数。
			 * @returns {any} 操作结果。
			 */
			onClose: reason => reasons.push(reason),
		})
		client.receive({ id: handle.id, type: 'ready' }, 'device')
		await handle.ready
		client.receive({ id: handle.id, type: 'event', seq: 1, data: 1 }, 'device')
		client.receive({ id: handle.id, type: 'event', seq: 2, data: 2 }, 'device')
		assertEquals(events, [1])
		release()
		await new Promise(resolve => setTimeout(resolve, 0))
		assertEquals(events, [1, 2])
		assertEquals(reasons, ['consumer-error'])
	} finally { release?.(); client.dispose() }
})

Deno.test('callback client times out stalled setup despite heartbeat and detects silent link loss', async () => {
	const reasons = []
	const client = createCallbackSessionClient({
		/**
		 * 处理会话回调。
		 * @param {object} frame 会话事件帧。
		 * @returns {any} 操作结果。
		 */
		send: frame => {
			if (frame.op === 'renew') client.receive({ id: frame.id, type: 'heartbeat' }, 'device')
		}, heartbeatMs: 5, timeoutMs: 20 })
	try {
		const setup = client.open('device', 'producer', {
			/**
			 * 处理会话回调。
			 * @param {string} reason 结束原因。
			 * @returns {any} 操作结果。
			 */
			onClose: reason => reasons.push(reason) })
		await assertRejects(() => setup.ready, Error, 'setup-timeout')
		assertEquals(reasons, ['setup-timeout'])
	} finally { client.dispose() }
	const silent = createCallbackSessionClient({
		/**
		 * 处理会话回调。
		 * @returns {any} 操作结果。
		 */
		send: () => {}, heartbeatMs: 5, timeoutMs: 20 })
	try {
		const handle = silent.open('device', 'producer', {
			/**
			 * 处理会话回调。
			 * @param {string} reason 结束原因。
			 * @returns {any} 操作结果。
			 */
			onClose: reason => reasons.push(reason) })
		silent.receive({ id: handle.id, type: 'ready' }, 'device')
		await handle.ready
		await new Promise(resolve => setTimeout(resolve, 60))
		assertEquals(reasons.at(-1), 'heartbeat-timeout')
	} finally { silent.dispose() }
})

Deno.test('callback client caps pending events while an asynchronous consumer stalls', async () => {
	let release
	const reasons = []
	const client = createCallbackSessionClient({
		/**
		 * 处理会话测试回调。
		 * @returns {any} 操作结果。
		 */
		send: () => {} })
	try {
		const handle = client.open('device', 'producer', {
			/**
			 * 处理会话测试回调。
			 * @returns {any} 操作结果。
			 */
			onEvent: () => new Promise(resolve => { release = resolve }),
			/**
			 * 处理会话测试回调。
			 * @param {string} reason 会话参数。
			 * @returns {any} 操作结果。
			 */
			onClose: reason => reasons.push(reason),
		})
		client.receive({ id: handle.id, type: 'ready' }, 'device')
		await handle.ready
		for (let seq = 1; seq <= 66; seq++) client.receive({ id: handle.id, type: 'event', seq, data: seq }, 'device')
		assertEquals(reasons, ['consumer-overflow'])
		assertEquals(client.size, 0)
	} finally { release?.(); client.dispose() }
})

Deno.test('callback completion waits for accepted async events on local and remote consumers', async () => {
	const delivered = []
	const client = createCallbackSessionClient({ /** 测试回调占位，不产生外部消息。 */
		send: () => {} })
	let release
	try {
		const handle = client.open('device', 'producer', {
			/** @param {any} data 事件载荷。 @returns {Promise<void>} 消费完成。 */
			onEvent: async data => { if (data === 1) await new Promise(resolve => { release = resolve }); delivered.push(data) },
			/** @param {string} reason 结束原因。 @returns {void} 无返回值。 */
			onClose: reason => { delivered.push(reason) },
		})
		client.receive({ id: handle.id, type: 'ready' }, 'device')
		await handle.ready
		client.receive({ id: handle.id, type: 'event', seq: 1, data: 1 }, 'device')
		client.receive({ id: handle.id, type: 'event', seq: 2, data: 2 }, 'device')
		client.receive({ id: handle.id, type: 'end', reason: 'completed' }, 'device')
		assertEquals(delivered, [])
		release()
		await new Promise(resolve => setTimeout(resolve, 0))
		assertEquals(delivered, [1, 2, 'completed'])
		const local = openLocalCallbackSession((_script, { callbackSession }) => {
			callbackSession.emit(3)
			callbackSession.emit(4)
			callbackSession.close()
			return 'initialized'
		}, '', {
			/** @param {any} data 事件载荷。 @returns {Promise<void>} 消费完成。 */
			onEvent: async data => { await Promise.resolve(); delivered.push(data) },
			/** @param {string} reason 结束原因。 @returns {void} 无返回值。 */
			onClose: reason => { delivered.push(reason) },
		})
		assertEquals(await local.ready, 'initialized')
		await new Promise(resolve => setTimeout(resolve, 0))
		assertEquals(delivered, [1, 2, 'completed', 3, 4, 'completed'])
		local.dispose()
		await new Promise(resolve => setTimeout(resolve, 0))
		assertEquals(delivered, [1, 2, 'completed', 3, 4, 'completed'])
	} finally { release?.(); client.dispose() }
})

Deno.test('workspace producer watches through generic session, enforces boundary and disposes handles', async () => {
	const root = await Deno.makeTempDir({ prefix: 'fount_generic_watch_' })
	let subscription
	try {
		await Deno.writeTextFile(`${root}/file.txt`, 'before')
		let changed
		const change = new Promise(resolve => { changed = resolve })
		/**
		 * 处理会话回调。
		 * @param {string} script 初始化脚本。
		 * @param {object} context 生产者上下文。
		 * @returns {any} 操作结果。
		 */
		const evaluate = async (script, context) => {
			const result = await async_eval(script, context)
			if (result.error) throw result.error
			return result.result
		}
		subscription = openLocalCallbackSession(evaluate, workspaceWatchScript({ workdir: root, paths: [''] }), { onEvent: changed })
		assertEquals((await subscription.ready).count, 1)
		await Deno.writeTextFile(`${root}/file.txt`, 'after')
		let timer
		try { assertEquals(await Promise.race([change, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('watch timed out')), 3000) })]), { type: 'change' }) }
		finally { clearTimeout(timer) }
		const invalid = openLocalCallbackSession(evaluate, workspaceWatchScript({ workdir: root, paths: ['../outside'] }))
		await assertRejects(() => invalid.ready, Error, 'Invalid workspace-relative')
		invalid.dispose()
		subscription.dispose()
		// Windows 删除成功也验证 watcher 的目录句柄已经释放。
		await Deno.remove(root, { recursive: true })
		assert(true)
	} finally { subscription?.dispose(); await Deno.remove(root, { recursive: true }).catch(() => {}) }
})
