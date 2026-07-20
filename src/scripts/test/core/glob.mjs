/**
 * 简易 glob 匹配（*、**、?）。
 */

/**
 * 将字面字符转义为正则安全片段。
 * @param {string} char 单字符
 * @returns {string} 转义后的正则片段
 */
function escapeRegexChar(char) {
	return /[\\^$.+()|[\]{}]/.test(char) ? `\\${char}` : char
}

/**
 * 判断路径是否匹配 glob pattern。
 * @param {string} pattern glob（*、**、?）
 * @param {string} path 待匹配路径（正斜杠）
 * @returns {boolean} 路径是否匹配 pattern
 */
export function matchGlob(pattern, path) {
	const norm = path.replace(/\\/g, '/')
	const pat = pattern.replace(/\\/g, '/')
	if (pat === norm) return true
	let body = ''
	for (let i = 0; i < pat.length; i++) {
		const char = pat[i]
		if (char === '*' && pat[i + 1] === '*') {
			body += '.*'
			i++
			continue
		}
		if (char === '*') {
			body += '[^/]*'
			continue
		}
		if (char === '?') {
			body += '[^/]'
			continue
		}
		body += escapeRegexChar(char)
	}
	return new RegExp(`^${body}$`).test(norm)
}
