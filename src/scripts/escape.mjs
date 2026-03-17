/**
 * 转义字符串中的特殊字符，以便在正则表达式中使用。
 *
 * @param {string} string - 要转义的字符串。
 * @returns {string} 转义后的字符串。
 */
export function escapeRegExp(string) {
	return string.replace(/[$()*+./?[\\-^{|}]/g, '\\$&')
}
/**
 * 反转义在正则表达式中使用的已转义字符串中的特殊字符。
 *
 * @param {string} string - 要反转义的字符串。
 * @returns {string} 反转义后的字符串。
 */
export function unescapeRegExp(string) {
	return string.replace(/\\(.)/g, '$1')
}
