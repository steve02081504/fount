/**
 * @param {import('../internal.mjs').ChatApiContext} _apiContext API 上下文（节点级 API 不依赖实体）
 * @returns {object} P2P 节点方法
 */
export function createNodeMethods(_apiContext) {
	return {
		/**
		 * @returns {Promise<object>} 节点级信誉账本
		 */
		async reputation() {
			const { loadReputation } = await import('npm:@steve02081504/fount-p2p/node/reputation_store')
			return loadReputation()
		},
		/**
		 * @returns {{ add: Function, list: Function }} 节点 denylist
		 */
		get nodeDenylist() {
			return {
				/**
				 * @param {{ scope: string, value: string, groupId?: string }} entry denylist 条目
				 * @returns {Promise<object>} 更新后的 denylist
				 */
				async add(entry) {
					const { addDenylistEntry, loadDenylist } = await import('npm:@steve02081504/fount-p2p/node/denylist')
					addDenylistEntry(entry)
					return loadDenylist()
				},
				/**
				 * @returns {Promise<object>} denylist
				 */
				async list() {
					const { loadDenylist } = await import('npm:@steve02081504/fount-p2p/node/denylist')
					return loadDenylist()
				},
			}
		},
	}
}
