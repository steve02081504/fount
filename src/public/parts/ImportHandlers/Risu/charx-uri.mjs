/**
 * CHARX / Risu 内嵌资源 URI 前缀。
 * 'embeded://'是 RisuAI 那边的天才干的。
 */
export const CHARX_EMBEDDED_URI_PREFIXES = ['embeded://', 'embedded://', '__asset:']

/**
 * 若 uri 以任一内嵌前缀开头，返回 { prefix, path }，否则返回 null。
 * @param {string} uri - 资源 URI。
 * @returns {{ prefix: string, path: string } | null} - 若 uri 以任一内嵌前缀开头，返回 { prefix, path }，否则返回 null。
 */
export function matchCharxEmbeddedPrefix(uri) {
	if (!uri) return null
	for (const p of CHARX_EMBEDDED_URI_PREFIXES)
		if (uri.startsWith(p))
			return { prefix: p, path: uri.substring(p.length) }
	return null
}

/** 仅表示“路径型”内嵌（embeded/embedded），不含 __asset: */
export const CHARX_EMBEDDED_PATH_PREFIXES = ['embeded://', 'embedded://']

/**
 * 若 uri 以任一路径型内嵌前缀开头，返回路径部分，否则返回 null。
 * @param {string} uri - 资源 URI。
 * @returns {string | null} - 若 uri 以任一路径型内嵌前缀开头，返回路径部分，否则返回 null。
 */
export function stripCharxEmbeddedPathPrefix(uri) {
	if (!uri) return null
	for (const p of CHARX_EMBEDDED_PATH_PREFIXES)
		if (uri.startsWith(p))
			return uri.substring(p.length)
	return null
}
