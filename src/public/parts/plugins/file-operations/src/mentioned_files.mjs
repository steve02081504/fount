/**
 * 聊天提及文件预读取：从文本中提取路径候选与常见诊断输出的报错定位，经目标执行器按当前工作目录解析并读取。
 * 路径提取思路源自龙胆 `prompt/functions/file-change.mjs`，改为异步执行器以兼容远程机器。
 * 报错命中时只读取出错行及前后 2 行；整份读取遇超大文本（默认 >600 行）只取首尾各 300 行。
 */
import { mimetypeFromBufferAndName } from '../../../../../scripts/mimetype.mjs'

import { mergeLineWindows, parseErrorLocations } from './error_windows.mjs'
import { DEFAULT_READ_MAX_CHARS, DEFAULT_READ_MAX_LINE_CHARS, formatLargeTextForContext, isProbablyTextBuffer, truncateLongLines } from './read_window.mjs'

/** 单个候选块允许切分的最大片段数（防 O(n²) 爆炸）。 */
const MAX_SPLIT_PARTS = 40
/** 目录预读最多列出的条目数。 */
export const MAX_DIR_ENTRIES = 64
/** 单个预读文件的大小上限（字节）；超过则不读取，只记一条提示。 */
export const PRELOAD_MAX_FILE_BYTES = 8 * 1024 * 1024
/** 报错窗口每侧扩展行数。 */
export const ERROR_WINDOW_RADIUS = 2

/**
 * 跨轮去重的文件身份键：目标机器 + 目标机器上的规范绝对路径。
 * realpath 只在目标机器内唯一，不同机器上相同的绝对路径是各自独立的文件——必须带机器维度，
 * 否则在 A 机读过的 `/root/x` 会让 B 机的同名路径被误判为已读而跳过。
 * @param {string} machine - 目标机器标识。
 * @param {string} resolved - 目标机器上的规范绝对路径。
 * @returns {string} 去重键。
 */
export function fileIdentityKey(machine, resolved) {
	return `${machine}\u0000${resolved}`
}

// 路径尾部止于换行/冒号/反引号/双引号：引用里的路径（`"…\a.txt"`）不会把后续散文吞进候选，避免生成一串无效的带后缀候选。
const PATH_LIKE_REGEX = /(`|[A-Za-z]:\\|(\.|\.\.|~)[/\\]|[/\\])[^\n"`:]+/gu
const ABSOLUTE_OR_RELATIVE_REGEX = /^([A-Za-z]:\\|(\.|\.\.|~)[/\\]|[/\\])[^\n:`]+/u
/** 绝对路径候选（盘符 / 根 / UNC），供「目标无工作目录时只认绝对路径」筛选。 */
const ABSOLUTE_PATH_REGEX = /^(?:[A-Za-z]:[\\/]|[\\/])/u

/**
 * 从文本中提取疑似路径的候选串及其在原文中的区间（去重、模糊）。
 * 区间供 `collectMentionedFiles` 做覆盖剪枝：同一路径的较短前缀（祖先目录）与内部片段落在已命中候选的区间内时不再探测，
 * 既避免把 `…\Downloads\` 这类前缀目录当成提及项列出，也避免每字符触发一次 stat。
 * @param {string} text - 聊天文本。
 * @returns {{path: string, start: number, end: number}[]} 候选路径与 `[start, end)` 原文区间。
 */
export function extractPathCandidates(text) {
	const source = String(text ?? '')
	/** @type {{raw: string, start: number}[]} */
	const blocks = []
	let match
	PATH_LIKE_REGEX.lastIndex = 0
	while ((match = PATH_LIKE_REGEX.exec(source)) !== null) {
		blocks.push({ raw: match[0], start: match.index })
		PATH_LIKE_REGEX.lastIndex = match.index + 1
	}
	/** @type {{path: string, start: number, end: number}[]} */
	const candidates = []
	const seen = new Set()
	for (const { raw, start } of blocks) {
		const block = raw.replace(/^`/, '').trim()
		const blockStart = start + raw.indexOf(block)
		const splits = block.split(/(?=[^\w/\\-])/).slice(0, MAX_SPLIT_PARTS)
		let offset = 0
		for (let i = 0; i < splits.length; i++) {
			for (let j = i + 1; j <= splits.length; j++) {
				const candidate = splits.slice(i, j).join('')
				if (candidate !== block && !ABSOLUTE_OR_RELATIVE_REGEX.test(candidate)) continue
				const candidateStart = blockStart + offset
				const key = `${candidate}\u0000${candidateStart}`
				if (seen.has(key)) continue
				seen.add(key)
				candidates.push({ path: candidate, start: candidateStart, end: candidateStart + candidate.length })
			}
			offset += splits[i].length
		}
	}
	return candidates
}

/**
 * 预读文本文件的呈现模式。
 * @typedef {'full' | 'truncated' | 'errors'} textFileMode_t
 */

/**
 * 预读取结果。
 * @typedef {object} mentionedFiles_t
 * @property {{path: string, resolved: string, mode: textFileMode_t, content?: string, head?: string, tail?: string, edge?: number, omitted?: number, windows?: {start: number, end: number, text: string}[], errorLines?: number[], totalLines?: number, notice?: string}[]} textFiles - 文本文件。
 * @property {{path: string, resolved: string, name: string, buffer: Buffer, mime_type: string}[]} binaryFiles - 二进制文件（附件）。
 * @property {{path: string, resolved: string, entries: string[], total: number}[]} dirs - 目录及其条目（`entries` 为截断后的列表，`total` 为实际条目数）。
 * @property {{path: string, resolved: string, size: number}[]} oversized - 超过大小上限、未读取的文件。
 */

/**
 * 按出错行读取窗口（每处向两侧扩展 `radius` 行，窗口相邻则合并）。
 * @param {string} text - 文件文本。
 * @param {Iterable<number>} lines - 出错行号集合。
 * @param {number} radius - 前后扩展行数。
 * @returns {{start: number, end: number, text: string}[]} 窗口内容。
 */
function readErrorWindows(text, lines, radius) {
	const fileLines = String(text ?? '').split(/\r?\n/)
	return mergeLineWindows([...lines], radius).map(({ start, end }) => {
		const clampedStart = Math.min(start, fileLines.length)
		const clampedEnd = Math.min(end, fileLines.length)
		return {
			start: clampedStart,
			end: clampedEnd,
			text: fileLines.slice(clampedStart - 1, clampedEnd).join('\n'),
		}
	}).filter(window => window.text !== '')
}

/**
 * 把报错窗口收进剩余字符预算：整窗优先，末窗按剩余切片，超出部分省略。
 * @param {{start: number, end: number, text: string}[]} windows - 原始窗口。
 * @param {number} remaining - 剩余字符预算（`Infinity` 表示不限）。
 * @returns {{windows: {start: number, end: number, text: string}[], notice: string}} 收窄后的窗口与提示。
 */
function clampWindows(windows, remaining) {
	if (!Number.isFinite(remaining)) return { windows, notice: '' }
	const total = windows.reduce((sum, window) => sum + window.text.length, 0)
	if (total <= remaining) return { windows, notice: '' }
	const kept = []
	let left = remaining
	for (const window of windows) {
		if (left <= 0) break
		if (window.text.length <= left) {
			kept.push(window)
			left -= window.text.length
			continue
		}
		kept.push({ ...window, text: window.text.slice(0, left) })
		left = 0
		break
	}
	return { windows: kept, notice: '已达总体字符上限，报错窗口部分省略。' }
}

/**
 * 把整份/首尾截断的文本收进剩余字符预算。
 * @param {string} path - 候选路径（原样）。
 * @param {string} resolved - 解析后的绝对路径。
 * @param {{mode: 'full', content: string, totalLines: number} | {mode: 'truncated', head: string, tail: string, edge: number, omitted: number, totalLines: number}} formatted - `formatLargeTextForContext` 结果。
 * @param {number} remaining - 剩余字符预算（`Infinity` 表示不限）。
 * @returns {{file: object, renderedChars: number}} 收窄后的文本文件与占用字符数。
 */
function formatWithBudget(path, resolved, formatted, remaining) {
	const base = { path, resolved, totalLines: formatted.totalLines }
	if (formatted.mode === 'full') {
		if (!Number.isFinite(remaining) || formatted.content.length <= remaining) return { file: { ...base, mode: 'full', content: formatted.content }, renderedChars: formatted.content.length }
		const content = formatted.content.slice(0, Math.max(0, Math.floor(remaining)))
		const notice = `已达总体字符上限，省略 ${formatted.content.length - content.length} 字符。`
		return { file: { ...base, mode: 'full', content, notice }, renderedChars: content.length + notice.length }
	}
	if (!Number.isFinite(remaining) || formatted.head.length + formatted.tail.length <= remaining) return {
		file: { ...base, mode: 'truncated', head: formatted.head, tail: formatted.tail, edge: formatted.edge, omitted: formatted.omitted },
		renderedChars: formatted.head.length + formatted.tail.length,
	}
	const headBudget = Math.max(0, Math.floor(remaining / 2))
	const tailBudget = Math.max(0, Math.floor(remaining) - headBudget)
	const head = formatted.head.slice(0, headBudget)
	const tail = tailBudget >= formatted.tail.length ? formatted.tail : formatted.tail.slice(formatted.tail.length - tailBudget)
	const notice = '已达总体字符上限，首尾截断已进一步收窄。'
	return {
		file: { ...base, mode: 'truncated', head, tail, edge: formatted.edge, omitted: formatted.omitted, notice },
		renderedChars: head.length + tail.length + notice.length,
	}
}

/**
 * 从文本中提取候选路径与报错定位并尝试预读。
 * 报错文件优先（只读出错行窗口）；整份读取遇超大文本只取首尾各若干行；渲染后统一收进字符预算。
 * @param {import('./target.mjs').targetExecutor_t} executor - 目标执行器。
 * @param {string} text - 聊天文本。
 * @param {{maxFiles?: number, maxChars?: number, maxLineChars?: number, knownFiles?: Set<string>, machine?: string, extractPaths?: boolean, absoluteOnly?: boolean}} [options] - 上限（maxFiles 同时限制目录数）、已读文件的身份键集合（`fileIdentityKey`，按路径身份去重，与内容无关）、目标机器标识、是否提取普通路径候选（`false` 时只认报错定位，供工具输出使用），以及是否只接受绝对路径候选（目标工作目录未知时避免按错误目录解析相对路径）。
 * @returns {Promise<mentionedFiles_t & {usedChars: number}>} 预读结果与占用字符数。
 */
export async function collectMentionedFiles(executor, text, options = {}) {
	const {
		maxFiles = 5,
		maxChars = DEFAULT_READ_MAX_CHARS,
		maxLineChars = DEFAULT_READ_MAX_LINE_CHARS,
		knownFiles = new Set(),
		machine = '0',
		extractPaths = true,
		absoluteOnly = false,
	} = options
	const sourceText = String(text ?? '')
	const textFiles = []
	const binaryFiles = []
	const dirs = []
	const oversized = []
	// within-call 去重：不同候选串可能解析到同一路径。
	const seen = new Set()
	// 已命中候选覆盖的原文区间；落于其中的候选（前缀/片段）直接跳过，不再探测。
	/** @type {{start: number, end: number}[]} */
	const coveredSpans = []
	let usedChars = 0

	// 每个候选只查一次 stat / realpath：报错定位与主循环共用缓存。
	const statCache = new Map()
	const resolvedCache = new Map()
	/**
	 * 缓存 statEntry 结果：同一候选只查一次执行器。
	 * @param {string} candidate - 候选路径。
	 * @returns {Promise<object|null>} 统计结果（不存在时为 null）。
	 */
	const statEntry = async candidate => {
		if (!statCache.has(candidate)) statCache.set(candidate, await executor.statEntry(candidate).catch(() => null))
		return statCache.get(candidate)
	}
	/**
	 * 缓存 canonical 路径（realpath，失败回退绝对路径）：同一候选只查一次执行器。
	 * realpath 跨符号链接并归一化大小写，同一文件的不同写法归并为同一身份，作为跨轮去重的键。
	 * @param {string} candidate - 候选路径。
	 * @returns {Promise<string>} 真实绝对路径（失败时回退绝对路径，再回退原值）。
	 */
	const canonicalPath = async candidate => {
		if (resolvedCache.has(candidate)) return resolvedCache.get(candidate)
		let resolved = await executor.realpath?.(candidate).catch(() => null) ?? null
		if (resolved == null) resolved = await executor.resolvePath(candidate).catch(() => candidate)
		resolvedCache.set(candidate, resolved)
		return resolved
	}

	// 报错定位：解析出走错文件与行号，按 realpath 归并；命中时按窗口读取，而非整份读取。
	// 目标工作目录未知（absoluteOnly）时，相对诊断路径无法可靠解析，直接丢弃，避免按进程 cwd 误读。
	const errorLocations = parseErrorLocations(sourceText)
		.filter(location => !absoluteOnly || ABSOLUTE_PATH_REGEX.test(location.path))
	/** @type {Map<string, Set<number>>} */
	const errorFilesByResolved = new Map()
	for (const location of errorLocations) {
		const stat = await statEntry(location.path)
		if (!stat?.isFile) continue
		const resolved = await canonicalPath(location.path)
		const lines = errorFilesByResolved.get(resolved) ?? new Set()
		errorFilesByResolved.set(resolved, lines)
		for (const line of location.lines) lines.add(line)
	}

	// 报错文件优先，避免被前面的普通候选挤掉额度；文本候选按区间起点升序、同起点长者优先，
	// 保证完整路径先于其前缀（祖先目录）被探测并覆盖。
	const errorCandidates = errorLocations.map(location => {
		const at = sourceText.indexOf(location.path)
		return { path: location.path, start: at < 0 ? null : at, end: at < 0 ? null : at + location.path.length }
	})
	const textCandidates = (extractPaths ? extractPathCandidates(sourceText) : [])
		.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start))
	const candidates = [...errorCandidates, ...textCandidates]
		.filter(candidate => !absoluteOnly || ABSOLUTE_PATH_REGEX.test(candidate.path))

	for (const candidate of candidates) {
		if (textFiles.length + binaryFiles.length >= maxFiles) break
		// 候选区间起点落在已命中候选的区间内（前缀/内部片段）则跳过，不再探测。
		if (candidate.start != null && coveredSpans.some(span => candidate.start >= span.start && candidate.start < span.end)) continue
		const stat = await statEntry(candidate.path)
		if (!stat) continue
		// 命中即在 `seen` / `knownFiles` 之前登记覆盖：已读文件的祖先目录也不应因该文件被跳过而冒出来。
		if (candidate.start != null) coveredSpans.push({ start: candidate.start, end: candidate.end })
		const canonical = await canonicalPath(candidate.path)
		if (seen.has(canonical)) continue
		seen.add(canonical)
		if (knownFiles.has(fileIdentityKey(machine, canonical))) continue

		if (stat.isDirectory) {
			if (dirs.length >= maxFiles) continue
			const entries = await executor.listDir(candidate.path).catch(() => [])
			const all = entries.map(e => e.name + (e.isDirectory ? '/' : ''))
			dirs.push({ path: candidate.path, resolved: canonical, entries: all.slice(0, MAX_DIR_ENTRIES), total: all.length })
			continue
		}
		if (!stat.isFile) continue

		if (stat.size > PRELOAD_MAX_FILE_BYTES) {
			oversized.push({ path: candidate.path, resolved: canonical, size: stat.size })
			continue
		}

		const buffer = await executor.readFileBuffer(candidate.path).catch(() => null)
		if (!buffer) continue
		if (!isProbablyTextBuffer(buffer)) {
			const name = candidate.path.split(/[\\/]/).pop() || 'file'
			binaryFiles.push({
				path: candidate.path,
				resolved: canonical,
				name,
				buffer,
				mime_type: await mimetypeFromBufferAndName(buffer, name),
			})
			continue
		}
		if (maxChars > 0 && usedChars >= maxChars) break

		const remaining = maxChars > 0 ? maxChars - usedChars : Number.POSITIVE_INFINITY
		const rawText = truncateLongLines(buffer.toString('utf-8'), maxLineChars)
		const errorLines = errorFilesByResolved.get(canonical)
		if (errorLines?.size) {
			const allWindows = readErrorWindows(rawText, errorLines, ERROR_WINDOW_RADIUS)
			const { windows, notice } = clampWindows(allWindows, remaining)
			if (!windows.length) continue
			const file = {
				path: candidate.path,
				resolved: canonical,
				mode: /** @type {textFileMode_t} */ 'errors',
				windows,
				errorLines: [...errorLines].sort((a, b) => a - b),
				totalLines: rawText.split(/\r?\n/).length,
				...notice ? { notice } : {},
			}
			usedChars += windows.reduce((sum, window) => sum + window.text.length, 0) + (notice ? notice.length : 0)
			textFiles.push(file)
			if (maxChars > 0 && usedChars >= maxChars) break
			continue
		}

		const formatted = formatLargeTextForContext(rawText)
		const { file, renderedChars } = formatWithBudget(candidate.path, canonical, formatted, remaining)
		usedChars += renderedChars
		textFiles.push(file)
		if (maxChars > 0 && usedChars >= maxChars) break
	}
	return { textFiles, binaryFiles, dirs, oversized, usedChars }
}
