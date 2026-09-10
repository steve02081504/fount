/**
 * 聊天提及文件预读取：从文本中提取路径候选，经目标执行器按当前工作目录解析并读取。
 * 路径提取思路源自龙胆 `prompt/functions/file-change.mjs`，改为异步执行器以兼容远程机器。
 */
import { DEFAULT_READ_MAX_CHARS, DEFAULT_READ_MAX_LINE_CHARS, isProbablyTextBuffer, windowText } from './read_window.mjs'

/** 单个候选块允许切分的最大片段数（防 O(n²) 爆炸）。 */
const MAX_SPLIT_PARTS = 40
/** 目录预读最多列出的条目数。 */
const MAX_DIR_ENTRIES = 64

const PATH_LIKE_REGEX = /(`|[A-Za-z]:\\|(\.|\.\.|~)[/\\]|[/\\])[^\n`:]+/gu
const ABSOLUTE_OR_RELATIVE_REGEX = /^([A-Za-z]:\\|(\.|\.\.|~)[/\\]|[/\\])[^\n:`]+/u

/**
 * 从文本中提取疑似路径的候选串（去重、模糊）。
 * @param {string} text - 聊天文本。
 * @returns {string[]} 候选路径。
 */
export function extractPathCandidates(text) {
	const blocks = []
	let rest = String(text ?? '')
	let match
	PATH_LIKE_REGEX.lastIndex = 0
	while ((match = PATH_LIKE_REGEX.exec(rest)) !== null) {
		blocks.push(match[0])
		rest = rest.slice(match.index + 1)
		PATH_LIKE_REGEX.lastIndex = 0
	}
	const candidates = new Set()
	for (const raw of blocks) {
		const block = raw.replace(/^`|`$/g, '').trim()
		const splits = block.split(/(?=[^\w/\\-])/).slice(0, MAX_SPLIT_PARTS)
		for (let i = 0; i < splits.length; i++)
			for (let j = i + 1; j <= splits.length; j++) {
				const candidate = splits.slice(i, j).join('')
				if (candidate === block || ABSOLUTE_OR_RELATIVE_REGEX.test(candidate))
					candidates.add(candidate)
			}
	}
	return [...candidates]
}

/**
 * 预读取结果。
 * @typedef {object} mentionedFiles_t
 * @property {{path: string, content: string, window: import('./read_window.mjs').readWindowResult_t}[]} textFiles - 文本文件。
 * @property {{name: string, buffer: Buffer, mime_type: string}[]} binaryFiles - 二进制文件（附件）。
 * @property {{path: string, entries: string[]}[]} dirs - 目录及其条目。
 */

/**
 * 从文本中提取候选路径并尝试预读。
 * @param {import('./target.mjs').targetExecutor_t} executor - 目标执行器。
 * @param {string} text - 聊天文本。
 * @param {{maxFiles?: number, maxChars?: number, maxLineChars?: number}} [options] - 上限（maxFiles 同时限制目录数）。
 * @returns {Promise<mentionedFiles_t>} 预读结果。
 */
export async function collectMentionedFiles(executor, text, options = {}) {
	const {
		maxFiles = 5,
		maxChars = DEFAULT_READ_MAX_CHARS,
		maxLineChars = DEFAULT_READ_MAX_LINE_CHARS,
	} = options
	const textFiles = []
	const binaryFiles = []
	const dirs = []
	const seen = new Set()
	let usedChars = 0

	for (const candidate of extractPathCandidates(text)) {
		if (textFiles.length + binaryFiles.length >= maxFiles) break
		if (seen.has(candidate)) continue
		seen.add(candidate)

		const stat = await executor.statEntry(candidate).catch(() => null)
		if (!stat) continue

		if (stat.isDirectory) {
			if (dirs.length >= maxFiles) continue
			const entries = await executor.listDir(candidate).catch(() => [])
			dirs.push({
				path: candidate,
				entries: entries.map(e => e.name + (e.isDirectory ? '/' : '')).slice(0, MAX_DIR_ENTRIES),
			})
			continue
		}
		if (!stat.isFile) continue

		const buffer = await executor.readFileBuffer(candidate).catch(() => null)
		if (!buffer) continue
		if (!isProbablyTextBuffer(buffer)) {
			binaryFiles.push({
				name: candidate.split(/[\\/]/).pop() || 'file',
				buffer,
				mime_type: 'application/octet-stream',
			})
			continue
		}
		if (maxChars > 0 && usedChars >= maxChars) break
		const remaining = maxChars > 0 ? maxChars - usedChars : 0
		const result = windowText(buffer.toString('utf-8'), { maxLineChars, maxChars: remaining })
		usedChars += result.text.length
		textFiles.push({ path: candidate, content: result.text, window: result })
	}
	return { textFiles, binaryFiles, dirs }
}
