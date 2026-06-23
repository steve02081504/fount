/**
 * live E2E 脚本环境变量（须由 test/live/run.mjs 注入）。
 */

/**
 * @returns {string} 去掉尾部斜杠的节点根 URL
 */
export function requireLiveBaseUrl() {
	const url = process.env.FOUNT_TEST_BASE_URL?.trim()
	if (!url)
		throw new Error('FOUNT_TEST_BASE_URL is required; run via test/live/run.mjs')
	return url.replace(/\/$/, '')
}

/**
 * @returns {string} Node A API key
 */
export function requireLiveApiKey() {
	const key = process.env.FOUNT_API_KEY?.trim()
	if (!key)
		throw new Error('FOUNT_API_KEY is required; run via test/live/run.mjs')
	return key
}

/**
 * @returns {string} 与 requireLiveBaseUrl 对应的 ws/wss 根 URL
 */
export function liveWsBaseUrl() {
	return requireLiveBaseUrl().replace(/^http/, 'ws')
}
