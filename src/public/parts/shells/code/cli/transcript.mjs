import { Buffer } from 'node:buffer'
import { createReadStream } from 'node:fs'
import { mkdtemp, rm, appendFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

/**
 * 去掉 ANSI 转义序列与除换行、制表之外的 C0 控制字符，得到可安全排版到终端的内容。
 * @param {unknown} value - 任意值。
 * @returns {string} 清理后的文本。
 */
export const clean = value => String(value).replace(/\x1b(?:\[[\d;]*[A-Za-z]|\][^\x07]*(?:\x07|\x1b\\))?/g, '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')

/**
 * 取条目的展示文本（`content_for_show` 优先）。
 * @param {object} entry - 会话条目。
 * @returns {string} 展示文本；非字符串内容按 JSON 展开。
 */
export function entryText(entry) {
	const content = entry.content_for_show ?? entry.content ?? ''
	return clean(typeof content === 'string' ? content : JSON.stringify(content, null, 2))
}

/**
 * 取条目的展示名：工具条目带上调用摘要，否则用条目名或角色名。
 * @param {object} entry - 会话条目。
 * @returns {string} 展示名。
 */
export function entryName(entry) {
	const name = entry.name || ({ char: 'Assistant', tool: 'Tool', system: 'System' }[entry.role] || entry.role || 'Entry')
	const summary = entry.extension?.toolCall?.summary || entry.extension?.shellStream?.command || entry.extension?.asyncTask?.label
	return entry.role === 'tool' && summary ? `${name}: ${summary}` : name
}

/**
 * 把一条已提交条目格式化为 print 输出的 Markdown 段落。
 * @param {object} entry - 会话条目。
 * @param {object} [options] - 格式化选项。
 * @param {boolean} [options.includeUser] - 导出完整会话时包含用户条目。
 * @returns {string} 文本片段；默认跳过用户条目与生成中占位。
 */
export function formatEntry(entry, { includeUser = false } = {}) {
	if (entry.is_generating || entry.role === 'user' && !includeUser) return ''
	const body = entryText(entry).trim()
	return `## ${entryName(entry)}\n${body}${body ? '\n' : ''}`
}

/** 计量字段到英文回落标签的映射（本地化文案缺失时使用）。 */
const USAGE_FIELD_LABELS = { inputTokens: 'input', outputTokens: 'output', reasoningTokens: 'reasoning', cacheReadTokens: 'cache read', cacheWriteTokens: 'cache write' }

/**
 * 显示已知 token 用量；已计价调用的已知费用一并显示。
 * @param {object} usage - 条目或会话累计用量。
 * @param {(key: string, params: object) => string} [translate] - `code.usage.*` 文案查询；缺省用英文标签。
 * @returns {string} 用量摘要；缺少用量时为空。
 */
export function formatUsage(usage, translate) {
	if (!usage) return ''
	const total = usage.total ?? {}
	/**
	 * 取一条已本地化的计量标签；`translate` 直接收到完整键，缺失（返回键名 / 非字符串）时回落到英文原文。
	 * @param {string} key - 完整 `code.usage.*` 文案键。
	 * @param {object} params - 插值参数。
	 * @param {string} fallback - 英文原文。
	 * @returns {string} 展示标签。
	 */
	const label = (key, params, fallback) => {
		const value = translate?.(key, params)
		return typeof value === 'string' && value && value !== key ? value : fallback
	}
	const parts = Object.entries(USAGE_FIELD_LABELS)
		.filter(([field]) => total[field] != null)
		.map(([field, name]) => label(`code.usage.${field}`, { count: total[field] }, `${total[field]} ${name}`))
	for (const [currency, cost] of Object.entries(total.costs || {})) {
		const amount = Number(cost)
		if (!Number.isFinite(amount)) continue
		const value = Number(amount.toFixed(6))
		parts.push(label('code.usage.estimatedCost', { amount: value, currency }, `known cost ${currency} ${value}`))
	}
	return parts.join(' · ')
}

/**
 * 汇总会话里工具日志记录的编辑摘要（按路径累加增删行数），数据来自 `extension.pluginData['file-operations'].edit`。
 * @param {object[]} entries - 会话条目。
 * @returns {{path: string, added: number, removed: number, diffs: string[]}[]} 按首次出现顺序排列的文件汇总。
 */
export function collectFileEdits(entries = []) {
	const byPath = new Map()
	for (const entry of entries) {
		const edit = entry?.extension?.pluginData?.['file-operations']?.edit
		if (!edit?.path) continue
		const record = byPath.get(edit.path) ?? { path: edit.path, added: 0, removed: 0, diffs: [] }
		record.added += Number(edit.added) || 0
		record.removed += Number(edit.removed) || 0
		if (edit.diff) record.diffs.push(edit.diff)
		byPath.set(edit.path, record)
	}
	return [...byPath.values()]
}

/**
 * 把编辑汇总格式化为 CLI 文本；给出路径时输出该文件的只读 diff。
 * @param {object[]} entries - 会话条目。
 * @param {string} [path] - 目标文件路径（支持路径后缀匹配）。
 * @returns {string} 文本摘要。
 */
export function formatFileEdits(entries = [], path = '') {
	const edits = collectFileEdits(entries)
	const selected = path ? edits.filter(edit => edit.path === path || edit.path.endsWith(path)) : edits
	if (!selected.length) return path ? `no recorded edit for ${path}` : 'no recorded file edits in this session'
	return selected.map(edit => {
		const head = `${edit.path}  +${edit.added} -${edit.removed}`
		return path && edit.diffs.length ? `${head}\n\n${edit.diffs.join('\n')}` : head
	}).join('\n')
}

/**
 * 写一段文本到 stdout，必要时等待背压解除；管道提前关闭按 EPIPE 失败。
 * @param {NodeJS.WriteStream} stdout - 标准输出。
 * @param {string} text - 待写文本。
 * @returns {Promise<void>} 写出完成。
 */
async function writeOut(stdout, text) {
	if (stdout.destroyed) throw Object.assign(new Error('stdout closed'), { code: 'EPIPE' })
	if (stdout.write(text)) return
	await new Promise((resolve, reject) => {
		/** @returns {void} 结束背压等待。 */
		const drained = () => { cleanup(); resolve() }
		/** @param {Error} error - 流错误。 @returns {void} 以失败结束等待。 */
		const failed = error => { cleanup(); reject(error) }
		/** @returns {void} 管道在没有 drain 的情况下关闭时按 EPIPE 失败。 */
		const closed = () => failed(Object.assign(new Error('stdout closed'), { code: 'EPIPE' }))
		/** @returns {void} 定局后释放流监听。 */
		const cleanup = () => { stdout.off('drain', drained); stdout.off('error', failed); stdout.off('close', closed) }
		stdout.once('drain', drained)
		stdout.once('error', failed)
		stdout.once('close', closed)
	})
}

/**
 * print 模式的条目收集器：按 ID 去重，超过阈值改用临时文件暂存。
 */
export class PrintCollector {
	/**
	 * 创建收集器。
	 * @param {object} [root0] - 选项。
	 * @param {string} [root0.outputFormat] - 输出格式（ndjson 或 text）。
	 * @param {number} [root0.threshold] - 超过该字节数后改用临时文件暂存。
	 */
	constructor({ threshold = 5 * 1024 * 1024, outputFormat = 'text' } = {}) {
		this.outputFormat = outputFormat
		this.threshold = threshold
		this.entries = []
		this.seen = new Set()
		this.bytes = 0
		this.directory = null
		this.file = null
	}
	/**
	 * 收集一条权威条目（重复 ID 与生成中占位会被跳过）。NDJSON 不缓存，拿到即写 `stdout`。
	 * @param {object} entry - 会话条目。
	 * @param {NodeJS.WriteStream} [stdout] - NDJSON 模式下的目标输出流。
	 * @returns {Promise<void>} 收集完成。
	 */
	async add(entry, stdout) {
		if (!entry?.id || this.seen.has(String(entry.id)) || entry.is_generating) return
		this.seen.add(String(entry.id))
		const line = JSON.stringify(entry) + '\n'
		if (this.outputFormat === 'ndjson') {
			if (stdout) await writeOut(stdout, line)
			return
		}
		this.bytes += Buffer.byteLength(line)
		if (!this.file && this.bytes > this.threshold) {
			this.directory = await mkdtemp(join(tmpdir(), 'fount-code-print-'))
			this.file = join(this.directory, 'entries.ndjson')
			await appendFile(this.file, this.entries.map(item => JSON.stringify(item) + '\n').join(''))
			this.entries = []
		}
		if (this.file) await appendFile(this.file, line)
		else this.entries.push(entry)
	}
	/**
	 * 按收集顺序把全部已提交条目以文本形式写到 stdout（NDJSON 已在 `add` 写出）。
	 * @param {NodeJS.WriteStream} stdout - 标准输出。
	 * @returns {Promise<void>} 写出完成。
	 */
	async write(stdout) {
		if (this.outputFormat === 'ndjson') return
		const entries = this.file ? createInterface({ input: createReadStream(this.file), crlfDelay: Infinity }) : this.entries
		for await (const row of entries) {
			const text = formatEntry(this.file ? JSON.parse(row) : row)
			if (text) await writeOut(stdout, text + '\n')
		}
	}
	/**
	 * 删除暂存目录。
	 * @returns {Promise<void>} 清理完成。
	 */
	async cleanup() { if (this.directory) await rm(this.directory, { recursive: true, force: true }) }
}
