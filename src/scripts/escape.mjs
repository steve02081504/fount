/**
 * 转义字符串中的特殊字符，以便在正则表达式中使用。
 *
 * @param {string} string - 要转义的字符串。
 * @return {string} 转义后的字符串。
 */
export function escapeRegExp(string) {
	return string.replace(/[$()*+./?[\\-^{|}]/g, '\\$&')
}
/**
 * 反转义在正则表达式中使用的已转义字符串中的特殊字符。
 *
 * @param {string} string - 要反转义的字符串。
 * @return {string} 反转义后的字符串。
 */
export function unescapeRegExp(string) {
	return string.replace(/\\(.)/g, '$1')
}

/**
 * 将字符串中的 Unicode 转义序列替换为相应的字符。
 *
 * @param {string} str - 可能包含 Unicode 转义序列的输入字符串。
 * @return {string} Unicode 转义序列被替换为实际字符的字符串。
 */
export function unicodeEscapeToChar(str) {
	return str.replace(/\\u[\dA-Fa-f]{4}/g, match => String.fromCharCode(parseInt(match.replace('\\u', ''), 16)))
}

/**
 * 将字符串中的 Unicode 转义序列替换为相应的字符。
 *
 * @param {string} str - 可能包含 Unicode 转义序列的输入字符串。
 * @return {string} Unicode 转义序列被替换为实际字符的字符串。
 */
export function unescapeUnicode(str) {
	if (!(Object(str) instanceof String)) str = str.toString()
	return str.replace(/\\u([\da-f]{4})/gi, (match, p1) => String.fromCharCode(parseInt(p1, 16)))
}
