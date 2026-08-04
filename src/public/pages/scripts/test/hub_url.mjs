/**
 * 浏览器侧测试 hub 基址（对应 Deno/Node 的 `hub/base_url.mjs`）。
 */

/**
 * 规范化 `fount.test.hubUrl`（去尾斜杠；未设则为空串）。
 * @returns {string} hub 根 URL
 */
export function testHubBaseUrl() {
	return String(globalThis.fount?.test?.hubUrl || '').replace(/\/$/, '')
}
