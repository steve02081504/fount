/**
 * 预期内的 HTTP 失败：路由/async 处理函数中 throw，由全局 errorHandler 按 `code` / `json` 响应。
 */
export class HttpError extends Error {
	/**
	 * @param {number} code HTTP 状态码（如 404）
	 * @param {string} message Error 消息（日志）；未提供 `body.json` 时亦作为响应 `message`
	 * @param {Record<string, unknown>} [body] 附加字段：`json` 为响应体；`skip_report` 覆写默认 Sentry 行为（默认 code 小于 500 时为 true）
	 */
	constructor(code, message, body = {}) {
		super(message)
		this.code = code
		if (code < 500) this.skip_report = true
		Object.assign(this, body)
	}
}

/**
 * @param {number} code HTTP 状态码
 * @param {string} message Error 消息
 * @param {Record<string, unknown>} [body] 见 {@link HttpError}
 * @returns {HttpError}
 */
export function httpError(code, message, body = {}) {
	return new HttpError(code, message, body)
}
