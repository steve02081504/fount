/** Social 直播：feed、开播/停播、连线邀请。 */
import { socialRequest } from './client.mjs'

/**
 * 直播大厅分页。
 * @param {{ scope?: 'local' | 'nearby', limit?: number, cursor?: string }} [options] 范围与分页
 * @returns {Promise<{ items: object[], nextCursor: string | null }>} 直播 feed 页
 */
export function getLiveFeed({ scope = 'local', limit = 20, cursor } = {}) {
	return socialRequest(`/live/feed?limit=${limit}&scope=${encodeURIComponent(scope)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
}

/**
 * 开播。
 * @param {{ title?: string, bridgeOrigin: string, mediaKind: 'av' | 'audio' | 'whip' }} body 开播参数
 * @returns {Promise<{ liveId: string, entityHash: string, ingestSecret?: string }>} 直播态
 */
export function startLive(body) {
	return socialRequest('/live/start', { method: 'POST', body: JSON.stringify(body) })
}

/**
 * 停播。
 * @param {string} liveId 直播 id
 * @returns {Promise<void>}
 */
export function stopLive(liveId) {
	return socialRequest('/live/stop', { method: 'POST', body: JSON.stringify({ liveId }) })
}

/**
 * 邀请连线。
 * @param {string} liveId 本机直播 id
 * @param {{ peerEntityHash: string, peerLiveId: string, bridgeOrigin: string }} body 连线邀请参数
 * @returns {Promise<{ status: string }>} 连线结果
 */
export function inviteLiveLink(liveId, body) {
	return socialRequest(`/live/${encodeURIComponent(liveId)}/link/invite`, {
		method: 'POST',
		body: JSON.stringify(body),
	})
}
