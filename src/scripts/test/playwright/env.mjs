/**
 * 前端 E2E 环境变量（须由 test/frontend/run.mjs 注入）。
 */
import { requireTrimmedUrl } from '../core/url.mjs'

/**
 * 返回前端 E2E 测试根 URL。
 * @returns {string} 测试根 URL
 */
export function requireTestBaseUrl() {
	return requireTrimmedUrl(
		process.env.FOUNT_TEST_BASE_URL,
		'FOUNT_TEST_BASE_URL',
		'FOUNT_TEST_BASE_URL is required for fount frontend tests; run via test/frontend/run.mjs (isolated node), not raw playwright CLI.',
	)
}

/**
 * 解析前端测试监听端口（env 或 fallback）。
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
