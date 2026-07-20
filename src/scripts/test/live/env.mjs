/**
 * live E2E 脚本环境变量（须由 test/live/run.mjs 注入）。
 */
import { requireTrimmedUrl, wsBaseUrl } from '../core/url.mjs'

/**
 * 返回 live 测试节点根 URL。
 * @returns {string} 节点根 URL
 */
export function requireLiveBaseUrl() {
	return requireTrimmedUrl(
		process.env.FOUNT_TEST_BASE_URL,
		'FOUNT_TEST_BASE_URL',
		'FOUNT_TEST_BASE_URL is required; run via test/live/run.mjs',
	)
}

/**
 * 返回 live 测试 Node A API key。
 * @returns {string} Node A API key
 */
export function requireLiveApiKey() {
	const apiKey = process.env.FOUNT_API_KEY?.trim()
	if (!apiKey) throw new Error('FOUNT_API_KEY is required; run via test/live/run.mjs')
	return apiKey
}

/**
 * 由 HTTP 根 URL 派生 WS(S) 根 URL。
 * @returns {string} WS(S) 根 URL
 */
export function liveWsBaseUrl() {
	return wsBaseUrl(requireLiveBaseUrl())
}
