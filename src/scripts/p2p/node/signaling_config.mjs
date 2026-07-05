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
 * 生产默认信令配置；测试通过 initNode({ signaling }) 注入。
 * @returns {SignalingRuntimeConfig} 生产默认信令配置
 */
export function resolveSignalingRuntimeConfig() {
	return defaultSignalingRuntimeConfig()
}
