/**
 * @param {import('../internal.mjs').ChatApiContext} apiContext API 上下文
 * @returns {object} 桥接方法
 */
export function createBridgeMethods(apiContext) {
	return {
		/**
		 * @returns {Promise<object[]>} 本 user 运行中的 BridgeBot 列表
		 */
		async bridgeBots() {
			const { listBridgeBots } = await import('../../chat/bridge/operations.mjs')
			return listBridgeBots(apiContext.username).map(row => ({
				platform: row.platform,
				botname: row.botname,
				/**
				 * @returns {Promise<void>} 停止该 bot 实例
				 */
				async stop() {
					const { requireBridgeOperation } = await import('../../chat/bridge/operations.mjs')
					await requireBridgeOperation(apiContext.username, {
						platform: row.platform,
						botname: row.botname,
					}, 'stopSelf')()
				},
			}))
		},
	}
}
