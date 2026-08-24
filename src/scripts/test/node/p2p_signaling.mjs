import { defaultSignalingRuntimeConfig, disableAllChannels } from 'npm:@steve02081504/fount-p2p/node/signaling_config'

/**
 * @param {string} url relay URL
 * @returns {boolean} 是否为 loopback ws/wss
 */
function isLoopbackRelayUrl(url) {
	try {
		const parsed = new URL(String(url || '').trim())
		if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') return false
		const host = parsed.hostname
		return host === '127.0.0.1' || host === 'localhost' || host === '[::1]' || host === '::1'
	}
	catch {
		return false
	}
}

/**
 * @param {string | undefined} raw 逗号分隔 URL
 * @returns {string[] | null} 合法 loopback relay 列表
 */
export function parseLoopbackRelayOverride(raw) {
	const text = String(raw || '').trim()
	if (!text) return null
	const urls = text.split(',').map(url => url.trim()).filter(Boolean)
	const loopback = urls.filter(isLoopbackRelayUrl)
	for (const url of urls)
		if (!isLoopbackRelayUrl(url))
			console.warn('p2p: ignoring non-loopback test relay URL', url)
	return loopback.length ? loopback : null
}

/**
 * @param {string | string[] | undefined} relayUrls 单 URL 或逗号分隔
 * @returns {import('npm:@steve02081504/fount-p2p/node/signaling_config').SignalingRuntimeConfig} 测试信令配置
 */
export function testSignalingFromRelayUrls(relayUrls) {
	const raw = Array.isArray(relayUrls) ? relayUrls.join(',') : relayUrls
	const relayOverride = parseLoopbackRelayOverride(raw)
	if (!relayOverride) return defaultSignalingRuntimeConfig()
	return {
		channels: disableAllChannels({
			// 仅走 loopback 测试 relay 的 nostr；其余通道全关，避免测试节点与真实节点同机互连。
			nostr: { relay: relayOverride },
			// 联邦测试仍需建数据链；webrtc 只拨已发现的节点（nostr 已隔离），不会触达真实节点。
			webrtc: {
				iceLocalHostnamePolicy: 'rewrite-loopback',
				trickleIceOff: true,
			},
		}),
	}
}
