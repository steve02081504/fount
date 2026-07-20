/**
 * Social live-av WebSocket URL（与 chat av-relay client 解耦）。
 * @param {string} entityHash 主播 entity hash
 * @param {string} liveId 直播场次 ID
 * @returns {string} Social live-av WebSocket URL
 */
export function buildSocialLiveAvWsUrl(entityHash, liveId) {
	const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
	return `${protocol}//${location.host}/ws/parts/shells:social/live-av/${encodeURIComponent(entityHash)}/${encodeURIComponent(liveId)}`
}
