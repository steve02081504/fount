/**
 * 从斜线分隔的正则表达式字符串中获取一个真实的正则表达式对象。
 *
 * 此函数使用 `/` 作为分隔符，正则表达式内部出现的每个 `/` 都必须进行转义。
 * 标志是可选的，但只能是 JavaScript 的 `RegExp` 支持的有效标志（`g`、`i`、`m`、`s`、`u`、`y`）。
 *
 * @param {string} input - 一个带分隔符的正则表达式字符串。
 * @returns {RegExp} 正则表达式对象。
 */
export function parseRegexFromString(input) {
	// 提取正则表达式模式和标志
	const match = input.match(/^\/([\W\w]+?)\/([gimsuy]*)$/)
	if (!match) throw new Error(`Invalid regex string: ${input}`)

	let [, pattern, flags] = match

	// 如果我们发现任何未转义的斜线分隔符，我们也会退出。
	// JS 不关心正则表达式模式内部的分隔符，但为了使其在我们的实现之外成为一个有效的正则表达式，
	// 我们必须确保我们的分隔符被正确转义。否则其他所有引擎都会失败。
	if (pattern.match(/(^|[^\\])\//)) throw new Error(`There is an unescaped slash in the regex: ${input}`)

	// 现在我们需要实际地反转义斜线分隔符，因为 JS 不关心分隔符
	pattern = pattern.replace('\\/', '/')

	// 然后我们返回正则表达式。如果失败，则表示语法无效。
	return new RegExp(pattern, flags)
}

/**
 * Escapes special characters in a string to be used in a regular expression.
 *
 * @param {string} string - The string to escape.
 * @returns {string} The escaped string.
 */
export function escapeRegExp(string) {
	return string.replace(/[$()*+./?[\\-^{|}]/g, '\\$&')
}
/**
 * 将字符串中的 Unicode 转义序列替换为其对应的字符。
 *
 * @param {string} string - 可能包含 Unicode 转义序列的输入字符串。
 * @returns {string} Unicode 转义序列被替换为实际字符的字符串。
 */
export function unescapeRegExp(string) {
	return string.replace(/\\(.)/g, '$1')
}
