/**
 * Gets a real regex object from a slash-delimited regex string
 *
 * This function works with `/` as delimiter, and each occurance of it inside the regex has to be escaped.
 * Flags are optional, but can only be valid flags supported by JavaScript's `RegExp` (`g`, `i`, `m`, `s`, `u`, `y`).
 *
 * @param {string} input - A delimited regex string
 * @returns {RegExp} The regex object
 */
export function parseRegexFromString(input) {
	// Extracting the regex pattern and flags
	const match = input.match(/^\/([\W\w]+?)\/([gimsuy]*)$/)
	if (!match) throw new Error(`Invalid regex string: ${input}`)

	let [, pattern, flags] = match

	// If we find any unescaped slash delimiter, we also exit out.
	// JS doesn't care about delimiters inside regex patterns, but for this to be a valid regex outside of our implementation,
	// we have to make sure that our delimiter is correctly escaped. Or every other engine would fail.
	if (pattern.match(/(^|[^\\])\//)) throw new Error(`there is an unescaped slash in the regex: ${input}`)

	// Now we need to actually unescape the slash delimiters, because JS doesn't care about delimiters
	pattern = pattern.replace('\\/', '/')

	// Then we return the regex. If it fails, it was invalid syntax.
	return new RegExp(pattern, flags)
}

/**
 * Escapes special characters in a string to be used in a regular expression.
 *
 * @param {string} string - The string to escape.
 * @return {string} The escaped string.
 */
export function escapeRegExp(string) {
	return string.replace(/[$()*+./?[\\-^{|}]/g, '\\$&')
}
/**
 * Replaces Unicode escape sequences in a string with their corresponding characters.
 *
 * @param {string} str - The input string possibly containing Unicode escape sequences.
 * @return {string} The string with Unicode escape sequences replaced by actual characters.
 */
export function unescapeRegExp(string) {
	return string.replace(/\\(.)/g, '$1')
}
