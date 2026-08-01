/**
 * 测试 hub 根 URL（Deno / Node 共用；浏览器侧用 `fount.test.hubUrl`）。
 * `process.env.FOUNT_TEST_HUB_URL` 或 `globalThis.fount.test.hubUrl`；皆无则空串。
 */
import process from 'node:process'

/**
 * @returns {string} hub base（无尾斜杠）；不可用时为空串
 */
export function getTestHubBaseUrl() {
	return String(
		process.env.FOUNT_TEST_HUB_URL
		|| globalThis.fount?.test?.hubUrl
		|| '',
	).trim().replace(/\/$/, '')
}
