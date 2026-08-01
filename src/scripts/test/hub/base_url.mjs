/**
 * 测试 hub 根 URL（Deno / Node / 浏览器共用）。
 * `process.env.FOUNT_TEST_HUB_URL` 或 `globalThis.fount.test.hubUrl`；皆无则空串。
 */

/**
 * @returns {string} hub base（无尾斜杠）；不可用时为空串
 */
export function getTestHubBaseUrl() {
	const fromEnv = typeof process !== 'undefined' && process.env?.FOUNT_TEST_HUB_URL
		? String(process.env.FOUNT_TEST_HUB_URL).trim()
		: ''
	const fromPage = globalThis.fount?.test?.hubUrl
		? String(globalThis.fount.test.hubUrl).trim()
		: ''
	return (fromEnv || fromPage).replace(/\/$/, '')
}
