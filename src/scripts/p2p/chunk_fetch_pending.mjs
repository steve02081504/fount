import { b64ToU8 } from './bytes_codec.mjs'
import { verifiedChunkBytes } from './files/chunk_fetch_verify.mjs'

/** @type {Map<string, { expectedHash: string, timer: ReturnType<typeof setTimeout>, resolve: (v: Uint8Array | null) => void, reject?: (e: Error) => void }>} */
export const pendingChunkFetches = new Map()

export const MAX_PENDING_CHUNK_FETCHES = 2048

/**
 * 注册 chunk 拉取等待槽（requestId 或 compositeKey）。
 * @param {string} key 唯一等待键
 * @param {string} expectedHash 期望 64 hex 密文哈希
 * @param {number} timeoutMs 超时毫秒
 * @param {{ rejectOnTimeout?: boolean }} [opts] rejectOnTimeout 时 Promise 以 Error 拒绝
 * @returns {{ done: Promise<Uint8Array | null>, cancel: () => void }} 等待 Promise 与取消函数
 */
export function registerChunkFetchWait(key, expectedHash, timeoutMs, opts = {}) {
	if (!key || pendingChunkFetches.size >= MAX_PENDING_CHUNK_FETCHES)
		return { done: Promise.resolve(null), cancel: () => {} }

	/** @type {(value: Uint8Array | null | Error) => void} */
	let settle
	const done = new Promise((resolve, reject) => {
		/**
		 * @param {Uint8Array | null | Error} value 块数据或错误
		 * @returns {void}
		 */
		function settleWait(value) {
			if (value instanceof Error) reject(value)
			else resolve(value)
		}
		settle = settleWait
	})
	const timer = setTimeout(() => {
		pendingChunkFetches.delete(key)
		if (opts.rejectOnTimeout)
			settle(new Error('chunk fetch timeout'))
		else
			settle(null)
	}, timeoutMs)

	/**
	 * @param {Uint8Array | null} data 块数据
	 * @returns {void}
	 */
	function finish(data) {
		clearTimeout(timer)
		pendingChunkFetches.delete(key)
		settle(data)
	}

	/**
	 * @param {Error | unknown} err 拒绝原因
	 * @returns {void}
	 */
	function rejectWait(err) {
		finish(err instanceof Error ? err : new Error(String(err)))
	}

	pendingChunkFetches.set(key, {
		expectedHash,
		timer,
		resolve: finish,
		reject: rejectWait,
	})

	return {
		done,
		cancel: () => {
			clearTimeout(timer)
			pendingChunkFetches.delete(key)
			settle(null)
		},
	}
}

/**
 * 按等待键解析入站 chunk 响应（校验哈希后 resolve）。
 * @param {string} key 等待键
 * @param {string} expectedHash 期望哈希
 * @param {Uint8Array | null} bytes 密文块
 * @returns {boolean} 是否命中并完成等待
 */
export function resolveChunkFetchWait(key, expectedHash, bytes) {
	const entry = pendingChunkFetches.get(key)
	if (!entry || entry.expectedHash !== expectedHash) return false
	const verified = bytes ? verifiedChunkBytes(expectedHash, bytes) : null
	if (bytes && !verified) return false
	clearTimeout(entry.timer)
	pendingChunkFetches.delete(key)
	entry.resolve(verified)
	return true
}

/**
 * 处理 fed_chunk_data / 带 requestId 的响应载荷。
 * @param {object} payload 入站载荷
 * @returns {boolean} 是否命中 pending
 */
export function resolvePendingChunkFetch(payload) {
	const requestId = String(payload?.requestId || '')
	if (!requestId) return false
	const entry = pendingChunkFetches.get(requestId)
	if (!entry) return false
	if (payload?.dataB64) {
		try {
			const bytes = b64ToU8(String(payload.dataB64))
			return resolveChunkFetchWait(requestId, entry.expectedHash, bytes)
		}
		catch { /* keep waiting */ }
		return false
	}
	clearTimeout(entry.timer)
	pendingChunkFetches.delete(requestId)
	entry.resolve(null)
	return true
}
