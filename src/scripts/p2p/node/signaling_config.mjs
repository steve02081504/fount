import process from 'node:process'

/** @typedef {'none' | 'rewrite-loopback' | 'drop'} MdnsCandidatePolicy */

/**
 * @typedef {{
 *   relayOverride: string[] | null
 *   mdnsPolicy: MdnsCandidatePolicy
 *   trickleIceOff: boolean
 * }} SignalingRuntimeConfig
 */

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
 * 解析 FOUNT_TEST_RELAY_URLS（仅 loopback，非 loopback 条目丢弃并 warn）。
 * @param {string | undefined} raw 逗号分隔 URL
 * @returns {string[] | null} 合法 relay 列表
 */
function parseLoopbackRelayOverride(raw) {
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
 * 生产默认：win32 丢弃 .local host candidate；其它平台不过滤。
 * @returns {SignalingRuntimeConfig} 生产默认信令配置
 */
export function defaultSignalingRuntimeConfig() {
	const mdnsPolicy = process.platform === 'win32' ? 'drop' : 'none'
	return {
		relayOverride: null,
		mdnsPolicy,
		trickleIceOff: mdnsPolicy !== 'none',
	}
}

/**
 * 在 initNode 边界解析一次信令传输策略（测试 env 仅在此读取）。
 * @returns {SignalingRuntimeConfig} 解析后的信令配置（含测试 env）
 */
export function resolveSignalingRuntimeConfig() {
	const base = defaultSignalingRuntimeConfig()
	if (process.env.FOUNT_TEST !== '1') return base

	const relayOverride = parseLoopbackRelayOverride(process.env.FOUNT_TEST_RELAY_URLS)
	if (!relayOverride) return base

	return {
		relayOverride,
		mdnsPolicy: 'rewrite-loopback',
		trickleIceOff: true,
	}
}
