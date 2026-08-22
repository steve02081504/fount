/**
 * 检测 markdown 是否以未闭合的围栏代码块结尾并做安全终止。
 * 流式过程中正文常以未闭合的围栏结尾：remark 会把其后所有内容（含 details 闭合标签、后续 HTML 标记）
 * 吞进代码块，破坏 details 结构并在末尾留下空代码块。此处若结尾围栏内容为空则整行去掉（避免空代码块），
 * 否则补一个闭合围栏（保留已输出的片段且不再吞并后续标签）。
 * 调用方须传入字符串（不做空值兜底）。
 * @param {string} text - 正文。
 * @returns {string} 修正后的正文（正文完整时原样返回）。
 */
export function ensureClosedTrailingCodeFence(text) {
	const lines = text.split('\n')
	let fenceChar = ''
	let fenceLen = 0
	let fenceStart = -1
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].replace(/^ {0,3}/, '')
		const m = line.match(/^(`{3,}|~{3,})([^\n]*)$/)
		if (!m) continue
		const char = m[1][0]
		const info = m[2]
		if (!fenceChar) {
			// 反引号围栏的 info 串不得含反引号，否则不是开围栏
			if (char === '`' && info.includes('`')) continue
			fenceChar = char
			fenceLen = m[1].length
			fenceStart = i
		}
		else if (char === fenceChar && m[1].length >= fenceLen && /^\s*$/.test(info)) {
			fenceChar = ''
			fenceLen = 0
			fenceStart = -1
		}
	}
	if (!fenceChar) return text
	const content = lines.slice(fenceStart + 1).join('\n')
	if (content.trim() === '')
		return lines.slice(0, fenceStart).join('\n')
	return `${text}\n${fenceChar.repeat(fenceLen)}`
}
