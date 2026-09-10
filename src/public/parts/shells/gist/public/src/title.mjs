/**
 * gist 标题统一提取：从 Markdown 内容生成显示标题。
 * 优先取 h1–h6 标题文本，无标题时 fallback 到正文纯文本前 30 字符并加省略号。
 * 仅依赖字符串操作，浏览器与 Deno 均可导入。
 */

/** 无标题 fallback 最大长度。 */
const FALLBACK_MAX_LEN = 30

/**
 * 去除常见 Markdown 行内标记，保留可读纯文本。
 * @param {string} text - 含 Markdown 行内标记的文本。
 * @returns {string} 清理后的文本。
 */
function stripInlineMarkdown(text) {
	return text
		.replace(/`([^`]+)`/g, '$1')
		.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
		.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
		.replace(/\*\*([^*]+)\*\*/g, '$1')
		.replace(/\*([^*]+)\*/g, '$1')
		.replace(/__([^_]+)__/g, '$1')
		.replace(/_([^_]+)_/g, '$1')
		.replace(/~~([^~]+)~~/g, '$1')
		.replace(/<[^>]+>/g, '')
}

/**
 * 定位首个非代码块内的非空 ATX 标题。
 * @param {string} source - Markdown 原文。
 * @returns {{ text: string, index: number } | null} 标题纯文本及其所在行号，无标题返回 null。
 */
function findFirstHeading(source) {
	const lines = source.split(/\r?\n/)
	let fence = null
	for (let index = 0; index < lines.length; index++) {
		const fenceMatch = lines[index].match(/^[ \t]*(`{3,}|~{3,})/)
		if (fenceMatch) {
			if (!fence) fence = fenceMatch[1][0]
			else if (fenceMatch[1][0] === fence) fence = null
			continue
		}
		if (fence) continue
		const headingMatch = lines[index].match(/^#{1,6}[ \t]+(.+?)\s*$/)
		if (!headingMatch) continue
		const text = stripInlineMarkdown(headingMatch[1]).trim()
		if (text) return { text, index }
	}
	return null
}

/**
 * 从 Markdown 内容推导显示标题及其来源。
 * 规则：h1 → h2 → h3 → h4 → h5 → h6 → 正文纯文本截断 + "..." → "Untitled"。
 * @param {string} markdown - Markdown 原文。
 * @returns {{ title: string, fromHeading: boolean }} 标题与是否取自标题元素（false 表示由正文截断生成）。
 */
export function extractTitleFromMarkdown(markdown) {
	const source = String(markdown ?? '')

	const heading = findFirstHeading(source)
	if (heading) return { title: heading.text, fromHeading: true }

	const plain = stripInlineMarkdown(source
		.replace(/```[\s\S]*?```/g, ' ')
		.replace(/~~~[\s\S]*?~~~/g, ' ')
		.replace(/^#{1,6}\s+/gm, '')
		.replace(/^[ \t]*[>*+-][ \t]+/gm, '')
		.replace(/\s+/g, ' ')
	).trim()

	if (plain)
		return {
			title: plain.length > FALLBACK_MAX_LEN
				? `${plain.slice(0, FALLBACK_MAX_LEN)}...`
				: plain,
			fromHeading: false,
		}

	return { title: 'Untitled', fromHeading: false }
}

/**
 * 从 Markdown 中删除作为标题来源的首个标题行（供列表摘要去重）。
 * 无标题（标题由正文截断生成）时原样返回，避免误删正文。
 * @param {string} markdown - Markdown 原文。
 * @returns {string} 删除标题行后的 Markdown。
 */
export function removeTitleHeadingLine(markdown) {
	const source = String(markdown ?? '')
	const heading = findFirstHeading(source)
	if (!heading) return source
	const lines = source.split(/\r?\n/)
	lines.splice(heading.index, 1)
	return lines.join('\n')
}

/**
 * 从 Markdown 内容推导显示标题（`extractTitleFromMarkdown` 的标题部分）。
 * @param {string} markdown - Markdown 原文。
 * @returns {string} 推导出的标题。
 */
export function deriveTitleFromMarkdown(markdown) {
	return extractTitleFromMarkdown(markdown).title
}
