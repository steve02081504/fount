/** code shell 角色回复展示层的 Markdown 修复。 */

/**
 * 修复已完成回复里孤立的裸围栏：例如工具结果后多出三反引号，空行后却接着写报告。
 * 只修展示层中「有前文、无闭合围栏、首行为空、后文同时有段落/强调和列表」的形态；
 * 有语言标记的围栏和正常闭合的代码块必须原样保留。
 * @param {string} text - 原始展示文本。
 * @returns {string} 供 Markdown 渲染的文本。
 */
export function repairOrphanedReplyFence(text) {
	const lines = text.split('\n')
	let open = -1
	for (let i = 0; i < lines.length; i++) {
		const fence = lines[i].match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
		if (!fence) continue
		if (open < 0) {
			if (fence[1][0] === '`' && fence[2].includes('`')) continue
			open = i
		}
		else if (fence[1][0] === lines[open].trimStart()[0] && /^\s*$/.test(fence[2]))
			open = -1
	}
	if (open < 1 || !/^ {0,3}`{3,}\s*$/.test(lines[open]) || lines[open + 1]?.trim()) return text
	const tail = lines.slice(open + 2).join('\n')
	if (!lines.slice(0, open).some(line => line.trim())
		|| !/^(?:\*\*[^\n]+\*\*|#{1,6}\s+.+)$/m.test(tail)
		|| !/^\s*(?:[-*]\s|\d+[.)]\s)/m.test(tail)) return text
	lines.splice(open, 1)
	return lines.join('\n')
}
