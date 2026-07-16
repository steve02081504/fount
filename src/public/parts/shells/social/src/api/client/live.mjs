import { makeViewerOptions } from './helpers.mjs'

/**
 * @param {import('./helpers.mjs').SocialApiContext} apiContext API 上下文
 * @returns {object} 直播方法
 */
export function createLiveMethods(apiContext) {
	const viewerOptions = makeViewerOptions(apiContext)
	return {
		/**
		 * @param {object} draft 开播草稿
		 * @returns {Promise<object>} live 会话
		 */
		async startLive(draft = {}) {
			const { startLiveSession } = await import('../../live/session.mjs')
			return startLiveSession(apiContext.username, apiContext.entityHash, draft)
		},
		/**
		 * @param {string} liveId 直播 id
		 * @returns {Promise<object>} 结束结果
		 */
		async stopLive(liveId) {
			const { stopLiveSession } = await import('../../live/session.mjs')
			return stopLiveSession(apiContext.username, apiContext.entityHash, liveId)
		},
		/**
		 * @param {{ limit?: number, cursor?: string, scope?: string }} [options] 选项
		 * @returns {Promise<object>} 在播列表
		 */
		async liveFeed(options = {}) {
			const { buildLiveFeed } = await import('../../live/feed.mjs')
			options = { ...options, ...viewerOptions() }
			let result = await buildLiveFeed(apiContext.username, options)
			if (!options.cursor && !result.items.length && String(options.scope || 'local') !== 'nearby') {
				const { buildNearbyLiveFeed } = await import('../../live/network.mjs')
				result = await buildNearbyLiveFeed(apiContext.username, options)
			}
			return result
		},
		/**
		 * @param {string} liveId 本端直播
		 * @param {{ peerEntityHash: string, peerLiveId: string, bridgeOrigin?: string }} target 对端
		 * @returns {Promise<object>} 连线结果
		 */
		async inviteLiveLink(liveId, target = {}) {
			const { inviteLiveLink } = await import('../../live/link.mjs')
			return inviteLiveLink(apiContext.username, apiContext.entityHash, liveId, target)
		},
		/**
		 * @param {string} liveId 本端直播
		 * @returns {Promise<object>} 结果
		 */
		async stopLiveLink(liveId) {
			const { tearDownLiveLink } = await import('../../live/link.mjs')
			return tearDownLiveLink(apiContext.username, apiContext.entityHash, liveId)
		},
	}
}
