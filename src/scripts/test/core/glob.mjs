/**
 * 简易 glob 匹配（* 与 **）。
 */

/**
 * 判断路径是否匹配 glob pattern。
 * @param {string} pattern glob（* 与 **）
 * @param {string} path 待匹配路径（正斜杠）
 * @returns {boolean} 路径是否匹配 pattern
 */
export function matchGlob(pattern, path) {
	const norm = path.replace(/\\/g, '/')
	const pat = pattern.replace(/\\/g, '/')
	if (pat === norm) return true
	const re = new RegExp('^' + pat
		.replace(/\./g, '\\.')
		.replace(/\?/g, '\\?')
		.replace(/\*\*/g, '{{GLOBSTAR}}')
		.replace(/\*/g, '[^/]*')
		.replace(/{{GLOBSTAR}}/g, '.*')
		+ '$')
	return re.test(norm)
}
