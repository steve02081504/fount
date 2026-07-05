import { defaultSignalingRuntimeConfig } from 'fount/scripts/p2p/node/signaling_config.mjs'

/**
 * @param {string} url relay URL
 * @returns {boolean} 是否为 loopback ws/wss
 */
function isLoopbackRelayUrl(url) {
	try {
		const parsed = new URL(String(url || '').trim())
		if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') return false
		const host = parsed.hostname.toLowerCase()
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
 * @returns {import('fount/scripts/p2p/node/signaling_config.mjs').SignalingRuntimeConfig} 测试信令配置
 */
export function testSignalingFromRelayUrls(relayUrls) {
	const raw = Array.isArray(relayUrls) ? relayUrls.join(',') : relayUrls
	const relayOverride = parseLoopbackRelayOverride(raw)
	if (!relayOverride) return defaultSignalingRuntimeConfig()
	return {
		relayOverride,
		mdnsPolicy: 'rewrite-loopback',
		trickleIceOff: true,
	}
}
