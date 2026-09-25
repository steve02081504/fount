/**
 * 校验并解析 WebView 引导页的站内跳转目标。
 *
 * `value` 来自 `URLSearchParams.get('redirect')`，已经被解码过一次，
 * 这里不能再 `decodeURIComponent`，否则含裸 `%` 的地址会抛 URIError。
 * @param {string} value - redirect 查询参数（已解码）。
 * @param {string} origin - 允许的同源 origin。
 * @returns {string} 站内绝对地址。
 * @throws {Error} 当目标跨源时抛出。
 */
export function resolveRedirect(value, origin) {
	const url = new URL(value, origin)
	if (url.origin !== origin) throw new Error('Invalid redirect')
	return url.href
}
