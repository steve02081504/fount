import { randomUUID } from 'node:crypto'

/**
 * 长期回调会话句柄：初始化结果与持续事件分别结算。
 * @typedef {{id: string, ready: Promise<any>, dispose: () => void}} CallbackSessionHandle
 */
/**
 * 长期回调会话消费者选项。
 * @typedef {object} CallbackSessionOptions
 * @property {(data: any) => (void|Promise<void>)} [onEvent] 按顺序处理事件；异步失败结束会话。
 * @property {(reason: string) => void} [onClose] 会话结束通知，至多一次。
 * @property {AbortSignal} [signal] 外部取消信号。
 */

/**
 * 主机侧长期回调会话：源设备绑定、序列检查、心跳与显式取消。
 * @param {object} root0 会话依赖或选项。
 * @param {(message: object, peerId: string) => (void|Promise<void>)} root0.send 发送控制消息。
 * @param {number} [root0.heartbeatMs] 续租间隔毫秒。
 * @param {number} [root0.timeoutMs] 初始化及心跳超时毫秒。
 * @returns {{open: (peerId: string, script: string, options?: CallbackSessionOptions) => CallbackSessionHandle, receive: Function, disconnect: Function, dispose: () => void, size: number}} 会话客户端。
 */
export function createCallbackSessionClient({ send, heartbeatMs = 10000, timeoutMs = 30000 }) {
	const sessions = new Map()
	/**
	 * 结束本机会话；远端取消失败由租约兜底。
	 * @param {object} entry 内部会话状态。
	 * @param {string} reason 结束原因。
	 * @param {boolean} cancel 是否通知远端取消。
	 * @returns {void} 无返回值。
	 */
	function finish(entry, reason, cancel = true) {
		if (!sessions.delete(entry.id)) return
		clearInterval(entry.timer)
		entry.queue.length = 0
		entry.signal?.removeEventListener('abort', entry.abort)
		if (cancel) void Promise.resolve().then(() => send({ id: entry.id, op: 'cancel' }, entry.peerId)).catch(() => {})
		const error = Object.assign(new Error(reason), { reason })
		entry.reject(error)
		try { Promise.resolve(entry.onClose?.(reason)).catch(() => {}) } catch { /* 消费者异常不影响其它订阅 */ }
	}
	/**
	 * 创建会话，返回 ready Promise 与立即可用的取消句柄。
	 * @param {string} peerId 已认证来源设备。
	 * @param {string} script 初始化脚本。
	 * @param {CallbackSessionOptions} [root0] 会话消费者选项。
	 * @param {Function} [root0.onEvent] 事件消费者。
	 * @param {Function} [root0.onClose] 结束通知。
	 * @param {AbortSignal} [root0.signal] 外部取消信号。
	 * @returns {CallbackSessionHandle} 初始化 Promise 与取消句柄。
	 */
	function open(peerId, script, { onEvent, onClose, signal } = {}) {
		let resolve, reject
		const ready = new Promise((res, rej) => { resolve = res; reject = rej })
		// 调用方可能先保存句柄再等待；仍保留原 Promise 的拒绝语义。
		ready.catch(() => {})
		const entry = { id: randomUUID(), peerId, resolve, reject, onEvent, onClose, signal, seq: 0, ready: false, start: Date.now(), lastSeen: Date.now(), timer: null, abort: null, queue: [], queuedBytes: 0, consuming: false }
		sessions.set(entry.id, entry)
		/**
		 * 处理会话回调。
		 * @returns {any} 操作结果。
		 */
		entry.abort = () => finish(entry, 'cancelled')
		signal?.addEventListener('abort', entry.abort, { once: true })
		if (signal?.aborted) entry.abort()
		else {
			entry.timer = setInterval(() => {
				if (!entry.ready && Date.now() - entry.start >= timeoutMs) { finish(entry, 'setup-timeout'); return }
				if (Date.now() - entry.lastSeen >= timeoutMs) { finish(entry, 'heartbeat-timeout'); return }
				if (entry.ending) return
				void Promise.resolve().then(() => send({ id: entry.id, op: 'renew' }, peerId)).catch(() => finish(entry, 'transport-error'))
			}, heartbeatMs)
			void Promise.resolve().then(() => { if (sessions.has(entry.id)) return send({ id: entry.id, op: 'open', script }, peerId) }).catch(() => finish(entry, 'transport-error'))
		}
		return { id: entry.id, ready, dispose: entry.abort }
	}
	/**
	 * 串行等待异步消费者，异常或有界队列溢出结束会话。
	 * @param {object} entry 内部会话状态。
	 * @returns {Promise<void>} 队列处理完成。
	 */
	async function consume(entry) {
		if (entry.consuming) return
		entry.consuming = true
		try {
			while (sessions.has(entry.id) && entry.queue.length) {
				const { data, bytes } = entry.queue.shift()
				entry.queuedBytes -= bytes
				await entry.onEvent?.(data)
			}
			if (entry.ending && sessions.has(entry.id)) finish(entry, entry.ending, false)
		}
		catch { finish(entry, 'consumer-error') }
		finally { entry.consuming = false }
	}
	/**
	 * 处理已认证来源的会话帧；忽略其它设备、重复和迟到帧。
	 * @param {object} frame 会话事件帧。
	 * @param {string} peerId 已认证来源设备。
	 * @returns {any} 操作结果。
	 */
	function receive(frame, peerId) {
		const entry = sessions.get(frame?.id)
		if (!entry || entry.peerId !== peerId) return
		if (entry.ending) return
		if (!['ready', 'heartbeat', 'event', 'end'].includes(frame.type)) return
		if (frame.type === 'end') {
			if (!entry.ready) { finish(entry, String(frame.reason || 'completed'), false); return }
			entry.ending = String(frame.reason || 'completed')
			entry.lastSeen = Date.now()
			void consume(entry)
			return
		}
		if (frame.type === 'ready') {
			if (entry.ready) return
			entry.lastSeen = Date.now()
			entry.ready = true
			entry.resolve(frame.result)
			return
		}
		if (frame.type === 'heartbeat') { entry.lastSeen = Date.now(); return }
		if (!entry.ready || !Number.isSafeInteger(frame.seq) || frame.seq <= entry.seq) return
		if (frame.seq !== entry.seq + 1) { finish(entry, 'event-gap'); return }
		entry.lastSeen = Date.now()
		entry.seq = frame.seq
		try {
			const encoded = JSON.stringify(frame.data)
			const bytes = new TextEncoder().encode(encoded).length
			if (entry.queue.length >= 64 || bytes > 262144 || entry.queuedBytes + bytes > 1048576) { finish(entry, 'consumer-overflow'); return }
			entry.queuedBytes += bytes
			entry.queue.push({ data: frame.data, bytes })
			void consume(entry)
		}
		catch { finish(entry, 'consumer-error') }
	}
	return {
		open, receive,
		/**
		 * 来源设备断线，所有会话立即通知消费者。
		 * @param {string} peerId 已认证来源设备。
		 * @returns {any} 操作结果。
		 */
		disconnect(peerId) { for (const entry of sessions.values()) if (entry.peerId === peerId) finish(entry, 'disconnected', false) },
		/** 管理器替换或用户删除时清理所有会话。 */
		dispose() { for (const entry of sessions.values()) finish(entry, 'shutdown') },
		/**
		 * 处理会话回调。
		 * @returns {any} 操作结果。
		 */
		get size() { return sessions.size },
	}
}
