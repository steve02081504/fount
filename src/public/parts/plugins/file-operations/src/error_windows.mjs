/**
 * 常见诊断输出（eslint / gcc / clang / rustc / tsc / python）的报错位置解析与窗口合并（纯函数，无 I/O）。
 * 命中时只预读文件出错行及前后若干行，避免整份大文件灌入上下文。
 */

/** eslint stylish 格式的独立文件头行（整行只有一条路径）。 */
const ESLINT_FILE_HEADER = /^\s*(?<path>(?:[A-Za-z]:[\\/]|\/|\.{1,2}[\\/]|[^\s:]+[\\/])[^\n]*?\.\w+)\s*$/
/** eslint stylish 格式的条目行（缩进的 `行:列 级别 信息 规则`）。 */
const ESLINT_ITEM = /^\s*(?<line>\d+):(?<col>\d+)\s+(?:fatal\s+)?(?:error|warning|info)\b/i

/**
 * 内联 `文件:行[:列]` 的诊断格式表。
 * @type {{name: string, regex: RegExp}[]}
 */
const INLINE_ERROR_FORMATS = [
	{
		name: 'gcc', // gcc / clang 及常见 `file:line:col: error|warning|note`
		regex: /^(?<path>(?:[A-Za-z]:[\\/]|\/)?[^\n:]+?):(?<line>\d+):(?<col>\d+):\s*(?:fatal error|error|warning|note)\b/i,
	},
	{
		name: 'tsc', // `file(line,col): error TSxxxx`
		regex: /^(?<path>[^\n(]+?)\((?<line>\d+),(?<col>\d+)\):\s*error\b/i,
	},
	{
		name: 'rustc', // `--> file:line:col`
		regex: /^\s*-->\s*(?<path>(?:[A-Za-z]:[\\/])?[^\n:]+?):(?<line>\d+):(?<col>\d+)/,
	},
	{
		name: 'python', // `File "file", line N`
		regex: /^\s*File "(?<path>[^"]+)", line (?<line>\d+)/,
	},
]

/**
 * 从文本中解析报错位置，按文件聚合出错行（保留首次出现顺序）。
 * @param {string} text - 用户文本（可含 shell / 构建工具输出）。
 * @returns {{path: string, lines: number[]}[]} 每个报错文件及其出错行（升序去重）。
 */
export function parseErrorLocations(text) {
	/** @type {Map<string, Set<number>>} */
	const grouped = new Map()
	/** @type {string[]} */
	const order = []
	/**
	 * 记录一处报错定位。
	 * @param {string} path - 文件路径。
	 * @param {number} line - 行号。
	 * @returns {void}
	 */
	const add = (path, line) => {
		const key = String(path ?? '').trim().replace(/^['"]|['"]$/g, '')
		if (!key || !Number.isFinite(line) || line < 1) return
		let set = grouped.get(key)
		if (!set) { set = new Set(); grouped.set(key, set); order.push(key) }
		set.add(line)
	}

	let currentFile = null
	for (const rawLine of String(text ?? '').split(/\r?\n/)) {
		if (!rawLine.trim()) continue
		let matched = false
		for (const format of INLINE_ERROR_FORMATS) {
			const match = format.regex.exec(rawLine)
			if (match?.groups?.path && match.groups.line) {
				add(match.groups.path, Number(match.groups.line))
				currentFile = match.groups.path.trim()
				matched = true
				break
			}
		}
		if (matched) continue
		const item = ESLINT_ITEM.exec(rawLine)
		if (item && currentFile) { add(currentFile, Number(item.groups.line)); continue }
		const header = ESLINT_FILE_HEADER.exec(rawLine)
		if (header) currentFile = header.groups.path.trim()
	}

	return order.map(path => ({ path, lines: [...grouped.get(path)].sort((a, b) => a - b) }))
}

/**
 * 把行号集合合并为连续窗口（相邻/重叠的窗口合并），每行向两侧扩展 `radius` 行。
 * @param {number[]} lines - 出错行号（可为乱序/重复）。
 * @param {number} [radius] - 前后扩展行数。
 * @returns {{start: number, end: number}[]} 升序、互不相邻的窗口。
 */
export function mergeLineWindows(lines, radius = 2) {
	const sorted = [...new Set((lines || []).filter(line => Number.isFinite(line) && line >= 1))].sort((a, b) => a - b)
	/** @type {{start: number, end: number}[]} */
	const windows = []
	for (const line of sorted) {
		const start = Math.max(1, line - radius)
		const end = line + radius
		const last = windows.at(-1)
		if (last && start <= last.end + 1) last.end = Math.max(last.end, end)
		else windows.push({ start, end })
	}
	return windows
}
