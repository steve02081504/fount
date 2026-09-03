/**
 * 【文件】playwright/transient_error.mjs
 * 【职责】判定 Playwright API 请求抛出的瞬时网络错误；纯函数，供 api.mjs 重试与测试共享。
 */

/** Playwright API 请求的瞬时网络错误码集合（node errno，大小写敏感的精确 token）。 */
const TRANSIENT_NET_ERROR_TOKENS = new Set(['ECONNRESET', 'ECONNREFUSED', 'EPIPE'])

/**
 * 判定 Playwright API 请求抛出的是否为瞬时网络错误。
 * Playwright 跨进程回传的错误不保留 node `code`（自有字段仅 stack/message/log/name），
 * 底层错误码只落在 message 首行（如 `apiRequestContext.post: read ECONNRESET`、
 * `… connect ECONNREFUSED host:port`），故按首行精确 token 匹配，不扫 Call log 全文。
 * node premature close 无 errno，message 固定为 `socket hang up`，单独比对。
 * @param {unknown} err 捕获的错误
 * @returns {boolean} 是瞬时网络错误则为 true
 */
export function isTransientNetError(err) {
	if (!(err instanceof Error)) return false
	const firstLine = err.message.split('\n', 1)[0]
	return firstLine
		.split(/[\s:]+/)
		.some(token => TRANSIENT_NET_ERROR_TOKENS.has(token))
	|| firstLine.includes('socket hang up')
}
