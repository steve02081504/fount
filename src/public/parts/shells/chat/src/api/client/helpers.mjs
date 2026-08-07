/**
 * @typedef {import('../internal.mjs').ChatApiContext} ChatApiContext
 */

/**
 * 实体 shell JSON 私有态命名空间（load/assign 样板）。
 * @param {string} username replica 登录名
 * @param {string} shell shell 名（如 `'chat'`）
 * @param {string} entityHash 实体
 * @param {string} dataName setting 名
 * @param {(stored: object) => object} shape 读出规范化；set 时写入该对象
 * @returns {{ list: Function, set: Function, update: Function }} list/set/update 命名空间
 */
export function createShellJsonNamespace(username, shell, entityHash, dataName, shape) {
	return {
		/**
		 * @returns {Promise<object>} 读出
		 */
		async list() {
			const { loadEntityShellData } = await import('../../../../../../../server/setting_loader.mjs')
			return shape(loadEntityShellData(username, shell, entityHash, dataName) || {})
		},
		/**
		 * @param {object} value 写入值（已是最终 shape）
		 * @returns {Promise<object>} 写入后的值
		 */
		async set(value) {
			const { assignEntityShellData } = await import('../../../../../../../server/setting_loader.mjs')
			const next = shape(value || {})
			assignEntityShellData(username, shell, entityHash, dataName, next)
			return next
		},
		/**
		 * 单次读改写：在同一 tick 内 load → mutator → assign，避免 list/set 之间的并发覆盖。
		 * @param {(current: object) => object} mutator 基于当前值计算下一值
		 * @returns {Promise<object>} 写入后的值
		 */
		async update(mutator) {
			const { loadEntityShellData, assignEntityShellData } = await import('../../../../../../../server/setting_loader.mjs')
			const current = shape(loadEntityShellData(username, shell, entityHash, dataName) || {})
			const next = shape(mutator(current))
			assignEntityShellData(username, shell, entityHash, dataName, next)
			return next
		},
	}
}

/**
 * Chat 壳私有 JSON 命名空间（`shell='chat'`）。
 * @param {ChatApiContext} apiContext API 上下文
 * @param {string} dataName setting 名
 * @param {(stored: object) => object} shape 读出规范化
 * @returns {{ list: Function, set: Function, update: Function }} list/set/update 命名空间
 */
export function createChatShellJsonNamespace(apiContext, dataName, shape) {
	return createShellJsonNamespace(apiContext.username, 'chat', apiContext.entityHash, dataName, shape)
}
