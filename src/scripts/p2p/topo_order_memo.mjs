import { eventsToMetas, topologicalCanonicalOrder } from './dag/index.mjs'

/** @type {Map<string, { fp: string, order: string[] }>} */
const memoByKey = new Map()

/**
 * 进程内拓扑序 memo（key 由调用方提供，如 username:groupId）。
 * @param {string} memoKey 缓存键
 * @param {string} fingerprint 文件 stat + 事件数指纹
 * @param {object[]} events 全量事件
 * @param {{ force?: boolean }} [opts] 强制重算
 * @returns {string[]} 拓扑序 event id
 */
export function resolveTopologicalOrderMemo(memoKey, fingerprint, events, opts = {}) {
	return resolveTopologicalOrderMemoCached(memoKey, fingerprint, () =>
		topologicalCanonicalOrder(eventsToMetas(events)), opts)
}

/**
 * 进程内拓扑序 memo；`resolveOrder` 可接入磁盘缓存等实现。
 * @param {string} memoKey 缓存键
 * @param {string} fingerprint 文件 stat + 事件数指纹
 * @param {() => string[]} resolveOrder 实际求序（含磁盘层）
 * @param {{ force?: boolean }} [opts] 强制重算
 * @returns {string[]} 拓扑序 event id
 */
export function resolveTopologicalOrderMemoCached(memoKey, fingerprint, resolveOrder, opts = {}) {
	if (!opts.force) {
		const cached = memoByKey.get(memoKey)
		if (cached?.fp === fingerprint && cached.order.length)
			return cached.order
	}
	const order = resolveOrder()
	memoByKey.set(memoKey, { fp: fingerprint, order })
	return order
}

/**
 * @param {string} memoKey 缓存键
 * @returns {void}
 */
export function invalidateTopologicalOrderMemo(memoKey) {
	memoByKey.delete(memoKey)
}
