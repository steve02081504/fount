/**
 * 读文件窗口与截断护栏（纯函数，无 I/O）。
 * 四维上限：起始行 / 读取行数 / 单行字符上限 / 总体字符上限。
 */

/** 默认最多读取行数。 */
export const DEFAULT_READ_MAX_LINES = 2000
/** 默认单行字符上限。 */
export const DEFAULT_READ_MAX_LINE_CHARS = 2000
/** 默认总体字符上限。 */
export const DEFAULT_READ_MAX_CHARS = 50000

/**
 * 读取窗口参数。
 * @typedef {object} readWindow_t
 * @property {number} offset - 起始行（1 基）。
 * @property {number} limit - 最多读取行数。
 * @property {number} maxLineChars - 单行字符上限（0 表示不限）。
 * @property {number} maxChars - 总体字符上限（0 表示不限）。
 */

/**
 * 读取窗口结果。
 * @typedef {object} readWindowResult_t
 * @property {string} text - 截取后的文本。
 * @property {number} totalLines - 文件总行数。
 * @property {number} startLine - 实际起始行（1 基）。
 * @property {number} endLine - 实际结束行（1 基，含；无内容时为 startLine-1）。
 * @property {boolean} outOfRange - 起始行越界。
 * @property {boolean} truncatedByLines - 因行数上限截断。
 * @property {boolean} truncatedByChars - 因总体字符上限截断。
 * @property {number} truncatedLineCount - 被单行上限截断的行数。
 */

/**
 * 解析标签属性中的读取窗口参数。
 * @param {Record<string, string>} [attrs] - 标签属性。
 * @returns {readWindow_t} 读取窗口。
 */
export function parseReadWindow(attrs = {}) {
	/**
	 * 将属性值解析为整数，失败时回退默认值。
	 * @param {string|undefined} value - 属性值。
	 * @param {number} fallback - 缺省值。
	 * @returns {number} 解析结果。
	 */
	const toInt = (value, fallback) => {
		if (value === undefined || value === '') return fallback
		const parsed = Number.parseInt(value, 10)
		return Number.isFinite(parsed) ? parsed : fallback
	}
	return {
		offset: Math.max(1, toInt(attrs.offset, 1)),
		limit: Math.max(1, toInt(attrs.limit, DEFAULT_READ_MAX_LINES)),
		maxLineChars: Math.max(0, toInt(attrs['max-line-chars'], DEFAULT_READ_MAX_LINE_CHARS)),
		maxChars: Math.max(0, toInt(attrs['max-chars'], DEFAULT_READ_MAX_CHARS)),
	}
}

/**
 * 按读取窗口截取文本（按 `\n` 计行，兼容 CRLF）。
 * @param {string} text - 原始文本。
 * @param {readWindow_t} [options] - 读取窗口。
 * @returns {readWindowResult_t} 截取结果。
 */
export function windowText(text, options = {}) {
	const {
		offset = 1,
		limit = DEFAULT_READ_MAX_LINES,
		maxLineChars = DEFAULT_READ_MAX_LINE_CHARS,
		maxChars = DEFAULT_READ_MAX_CHARS,
	} = options
	const lines = String(text ?? '').split(/\r?\n/)
	const totalLines = lines.length
	if (offset > totalLines)
		return {
			text: '', totalLines, startLine: offset, endLine: offset - 1,
			outOfRange: true, truncatedByLines: false, truncatedByChars: false, truncatedLineCount: 0,
		}

	const requestedEnd = Math.min(totalLines, offset + limit - 1)
	const selected = []
	let usedChars = 0
	let truncatedLineCount = 0
	let truncatedByChars = false
	for (let lineNumber = offset; lineNumber <= requestedEnd; lineNumber++) {
		const rawLine = lines[lineNumber - 1]
		let line = rawLine
		if (maxLineChars > 0 && line.length > maxLineChars) {
			line = line.slice(0, maxLineChars) + ` …[本行已截断，共 ${rawLine.length} 字符]`
			truncatedLineCount++
		}
		const addedChars = line.length + (selected.length ? 1 : 0)
		if (maxChars > 0 && selected.length && usedChars + addedChars > maxChars) {
			truncatedByChars = true
			break
		}
		selected.push(line)
		usedChars += addedChars
	}
	const endLine = selected.length ? offset + selected.length - 1 : offset - 1
	return {
		text: selected.join('\n'),
		totalLines,
		startLine: offset,
		endLine,
		outOfRange: false,
		truncatedByLines: requestedEnd < totalLines,
		truncatedByChars,
		truncatedLineCount,
	}
}

/**
 * 生成读取结果的区间/截断提示文案（中文，工具日志风格）。
 * @param {readWindowResult_t} result - windowText 结果。
 * @returns {string} 提示文案（无异常时为空串）。
 */
export function formatReadWindowNotice(result) {
	if (result.outOfRange)
		return `起始行 ${result.startLine} 超出文件总行数 ${result.totalLines}。`
	const notices = []
	if (result.startLine > 1 || result.endLine < result.totalLines)
		notices.push(`已显示第 ${result.startLine}-${result.endLine} 行，共 ${result.totalLines} 行`)
	if (result.truncatedLineCount)
		notices.push(`${result.truncatedLineCount} 行因超过单行字符上限被截断`)
	if (result.truncatedByChars)
		notices.push('已达总体字符上限，后续内容省略')
	if (!notices.length) return ''
	let notice = notices.join('；') + '。'
	if (result.truncatedByLines || result.truncatedByChars)
		notice += `可用 offset="${result.endLine + 1}" 继续读取，或改用 <replace-file> 编辑。`
	return notice
}

/**
 * 粗判 buffer 是否为文本（前 8KB 无 NUL 字节）。
 * @param {Buffer} buffer - 文件内容。
 * @returns {boolean} 是否文本。
 */
export function isProbablyTextBuffer(buffer) {
	return !buffer.subarray(0, 8192).includes(0)
}
