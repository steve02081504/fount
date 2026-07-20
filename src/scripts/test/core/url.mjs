/**
 * 读取并校验环境变量中的根 URL。
 * @param {string | undefined} raw 环境变量原始值
 * @param {string} name 环境变量名
 * @param {string} hint 缺失时的错误提示
 * @returns {string} 去掉尾部斜杠的 URL
 */
export function requireTrimmedUrl(raw, name, hint) {
	const url = raw?.trim()
	if (!url) throw new Error(hint || `${name} is required`)
	return url.replace(/\/$/, '')
}

/**
 * 将 HTTP(S) 根 URL 转换为 WS(S)。
 * @param {string} httpUrl HTTP(S) 根 URL
 * @returns {string} 对应的 WS(S) 根 URL
 */
export function wsBaseUrl(httpUrl) {
	return httpUrl.replace(/^http/, 'ws')
}
