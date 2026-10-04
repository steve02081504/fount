import { randomUUID } from 'node:crypto'

/**
 * 本机会话与分机会话共用初始化、事件及取消接口，无网络租约。
 * @param {Function} evaluate 在目标上下文执行初始化。
 * @param {string} script 初始化脚本。
 * @param {import('./callback_sessions.mjs').CallbackSessionOptions} [root0] 会话消费者选项。
 * @param {Function} [root0.onEvent] 事件消费者。
 * @param {Function} [root0.onClose] 结束通知。
 * @param {AbortSignal} [root0.signal] 外部取消信号。
 * @returns {import('./callback_sessions.mjs').CallbackSessionHandle} 初始化 Promise 与取消句柄。
 */
export function openLocalCallbackSession(evaluate, script, { onEvent, onClose, signal } = {}) {
	const controller = new AbortController()
	const cleanups = new Set()
	const pending = []
	let closed = false, started = false, consuming = false, queuedBytes = 0, rejectReady
	let setupTimer
	let ending
	/**
	 * 立即释放资源，生产者正常结束时仍允许消费已排队事件。
	 * @param {string} [reason] 取消原因。
	 * @returns {void} 无返回值。
	 */
	function release(reason = ending || 'cancelled') {
		if (!controller.signal.aborted) controller.abort(reason)
		for (const cleanup of cleanups) try { Promise.resolve(cleanup()).catch(() => {}) } catch { /* ignore */ }
		cleanups.clear()
	}
	/**
	 * 同步释放本地资源，隔离异步清理失败；已结束的会话不再重复通知。
	 * @param {string} [reason] 结束原因。
	 * @returns {any} 操作结果。
	 */
	const dispose = (reason = 'cancelled') => {
		if (closed) return
		// 正常结束时原因已定：此后取消只是守卫，而不是新的结束事件
		reason = ending ?? reason
		closed = true
		clearTimeout(setupTimer)
		release(reason)
		signal?.removeEventListener('abort', abort)
		pending.length = 0
		rejectReady?.(Object.assign(new Error(reason), { reason }))
		try { Promise.resolve(onClose?.(reason)).catch(() => {}) } catch { /* ignore */ }
	}
	/**
	 * 处理会话回调。
	 * @returns {any} 操作结果。
	 */
	const abort = () => dispose()
	/** 串行调用异步消费者，初始化期间的事件在 ready 后派发。 @returns {Promise<void>} 派发完成。 */
	async function consume() {
		if (consuming || !started || closed) return
		consuming = true
		try {
			while (!closed && pending.length) {
				const { data, bytes } = pending.shift()
				queuedBytes -= bytes
				await onEvent?.(data)
			}
			if (ending && !closed) dispose(ending)
		}
		catch { dispose('consumer-error') }
		finally { consuming = false }
	}
	const callbackSession = {
		signal: controller.signal,
		/**
		 * 处理会话回调。
		 * @param {Function} cleanup 资源清理函数。
		 * @returns {any} 操作结果。
		 */
		onDispose: cleanup => {
			if (typeof cleanup !== 'function') throw new TypeError('Cleanup must be a function')
			if (closed || ending)  try { Promise.resolve(cleanup()).catch(() => {}) } catch { /* ignore */ } 
			else cleanups.add(cleanup)
		},
		/**
		 * 正常结束先消费已接收事件，再发送结束通知；取消仍立即丢弃队列。
		 * @param {string} [reason] 结束原因。
		 * @returns {void} 无返回值。
		 */
		close: (reason = 'completed') => {
			if (closed || ending) return
			ending = String(reason) || 'completed'
			release()
			void consume()
		},
		/**
		 * 处理会话回调。
		 * @param {any} data 事件载荷。
		 * @returns {any} 操作结果。
		 */
		emit: data => {
			if (closed || ending) return false
			try {
				const encoded = JSON.stringify(data)
				if (typeof encoded !== 'string') throw new Error('Invalid callback payload')
				const bytes = new TextEncoder().encode(encoded).length
				if (pending.length >= 64 || bytes > 262144 || queuedBytes + bytes > 1048576) throw new Error('Callback overflow')
				queuedBytes += bytes
				pending.push({ data: JSON.parse(encoded), bytes })
				void consume()
			}
			catch { dispose('callback-overflow') }
			return !closed
		},
	}
	const ready = new Promise((resolve, reject) => {
		rejectReady = reject
		signal?.addEventListener('abort', abort, { once: true })
		if (signal?.aborted) { dispose(); return }
		setupTimer = setTimeout(() => dispose('setup-timeout'), 30000)
		Promise.resolve().then(() => {
			if (closed) return
			return evaluate(script, { callbackSession })
		}).then(result => {
			if (closed) return
			const encoded = JSON.stringify(result ?? null)
			if (new TextEncoder().encode(encoded).length > 262144) throw new Error('Ready payload too large')
			clearTimeout(setupTimer)
			resolve(JSON.parse(encoded))
			queueMicrotask(() => { started = true; void consume() })
		}).catch(error => { reject(error); dispose(`setup-error: ${error.message}`) })
	})
	ready.catch(() => {})
	return { id: randomUUID(), ready, dispose: abort }
}
