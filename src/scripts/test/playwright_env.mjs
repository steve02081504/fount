/**
 * 前端 E2E 环境变量解析（须由 test/frontend/run.mjs 注入）。
 */

/**
 * @returns {string} 去掉尾部斜杠的测试根 URL
 * @throws {Error} 未设置 FOUNT_TEST_BASE_URL 时
 */
export function requireTestBaseUrl() {
	const url = process.env.FOUNT_TEST_BASE_URL?.trim()
	if (!url)
		throw new Error(
			'FOUNT_TEST_BASE_URL is required for fount frontend tests; '
			+ 'run via test/frontend/run.mjs (isolated node), not raw playwright CLI against localhost:8931.',
		)
	return url.replace(/\/$/, '')
}

/**
 * 解析 FOUNT_TEST_FRONTEND_PORT；未设置时调用 fallback。
 * @param {string | undefined} raw env 原始值
 * @param {() => number | Promise<number>} fallback 未设置时的端口选择器
 * @returns {Promise<number>} 监听端口
 */
export async function resolveFrontendPort(raw, fallback) {
	if (raw != null && raw !== '') {
		const port = Number(raw)
		if (!Number.isInteger(port) || port <= 0)
			throw new Error(`invalid FOUNT_TEST_FRONTEND_PORT: ${raw}`)
		return port
	}
	return await fallback()
}
