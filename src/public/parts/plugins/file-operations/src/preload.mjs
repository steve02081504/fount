/**
 * 对话提及文件的持久化预读：从最新用户消息提取路径候选与报错定位，经目标执行器读取后，
 * 以工具日志形式经 `AddLongTimeLog` 写入本轮结果——当前轮即通过 `prompt_struct.chat_log`
 * 可见，随后经 `result.logContextBefore` 随会话落盘，成为该角色聊天记录的一部分，
 * 跨轮/跨生成以稳定前缀参与提示缓存，而非每轮重算的临时追加上下文。
 * 由 `interfaces.chat.BeforeReply` 在每次生成开始时调用，须保持幂等。
 * @typedef {import('../../../../../decl/chatLog.ts').chatReplyRequest_t} chatReplyRequest_t
 * @typedef {import('../../../../../decl/prompt_struct.ts').chatLogEntry_t} chatLogEntry_t
 */

import { inferCodeLanguageFromPath, renderMarkdownCodeBlock } from '../../../shells/chat/src/streaming/index.mjs'
// chat shell 的 prompt_struct 合并器同时承担事实共享层：插件直接用其展开上下文与摘要边界属预期设计。

import { hashContent, mergePluginData, PLUGIN_DATA_KEY, resolveEffectiveLog } from './context_files.mjs'
import { collectMentionedFiles } from './mentioned_files.mjs'
import { createArgsExecutorResolver, resolveTarget } from './target.mjs'

/** 单次预读的文件数上限。 */
const PRELOAD_MAX_FILES = 5

/**
 * 把动态值包成安全的内联代码（围栏长度随内容中的反引号 run 选取，避免被提前闭合）。
 * @param {unknown} value 动态值。
 * @returns {string} Markdown 内联代码。
 */
function inlineCode(value) {
	const text = String(value ?? '')
	const fence = '`'.repeat(1 + Math.max(0, ...(text.match(/`+/g) || []).map(run => run.length)))
	const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : ''
	return `${fence}${pad}${text}${pad}${fence}`
}

/**
 * 取合并日志中最新的一条用户消息。
 * @param {chatLogEntry_t[]} log - 合并日志。
 * @returns {chatLogEntry_t | null} 最新用户消息（无则 null）。
 */
export function findLatestUserEntry(log) {
	for (let index = log.length - 1; index >= 0; index--)
		if (log[index]?.role === 'user') return log[index]
	return null
}

/**
 * 收集合并日志中已预读 / 已查看文件的 `resolved\0hash` 键（供跨轮去重：内容不变则跳过，内容变了则重读）。
 * @param {chatLogEntry_t[]} log - 合并日志。
 * @returns {Set<string>} 已知文件键集合。
 */
export function collectKnownFiles(log) {
	const known = new Set()
	for (const entry of log || []) {
		const data = entry?.extension?.pluginData?.[PLUGIN_DATA_KEY]
		for (const group of [data?.preload?.files, data?.view?.files])
			for (const item of group || [])
				if (item?.resolved && item?.hash) known.add(`${item.resolved}\0${item.hash}`)
	}
	return known
}

/**
 * 渲染单个文本文件的预读内容（整份 / 首尾截断 / 报错窗口）。
 * @param {object} file - 文本文件条目。
 * @returns {string} 渲染后的 Markdown 片段。
 */
function renderTextFile(file) {
	const lang = inferCodeLanguageFromPath(file.path)
	const blocks = []
	if (file.mode === 'errors') {
		blocks.push(`以下为报错位置附近内容（出错行：第 ${file.errorLines.join('、')} 行）：`)
		for (const window of file.windows)
			blocks.push(`第 ${window.start}-${window.end} 行：\n${renderMarkdownCodeBlock(window.text, { lang })}`)
	}
	else if (file.mode === 'truncated')
		blocks.push(
			`文件较大（共 ${file.totalLines} 行，超过 ${file.edge * 2} 行），仅预读首尾各 ${file.edge} 行，中间省略 ${file.omitted} 行：`,
			`前 ${file.edge} 行：\n${renderMarkdownCodeBlock(file.head, { lang })}`,
			`后 ${file.edge} 行：\n${renderMarkdownCodeBlock(file.tail, { lang })}`,
		)
	else
		blocks.push(renderMarkdownCodeBlock(file.content, { lang }))
	if (file.notice) blocks.push(`（${inlineCode(file.notice)}）`)
	return blocks.join('\n')
}

/**
 * 对最新用户消息中提及的文件做持久化预读，并以工具日志写入本轮结果。
 * 幂等：同一用户消息已预读过（本轮后续轮次 / 重生成 / 异步触发）则直接返回；远端离线等失败由调用方吞掉，不影响生成。
 * @param {chatReplyRequest_t & {AddLongTimeLog: (entry: chatLogEntry_t) => void}} args - 请求上下文（含 `prompt_struct` 时优先）。
 * @returns {Promise<void>}
 */
export async function preloadMentionedFiles(args) {
	const target = resolveTarget(args)
	if (!target.workdir) return
	const log = resolveEffectiveLog(args)
	const latest = findLatestUserEntry(log)
	if (!latest) return
	const text = String(latest.content ?? '')
	if (!text.trim()) return

	// 同一用户消息已预读过（本轮后续轮次、重生成）则跳过。
	const userKey = String(latest.id ?? hashContent(text))
	if (log.some(entry => entry?.extension?.pluginData?.[PLUGIN_DATA_KEY]?.preload?.forUser === userKey)) return

	const executor = createArgsExecutorResolver(args)()
	const { textFiles, binaryFiles, dirs } = await collectMentionedFiles(executor, text, {
		maxFiles: PRELOAD_MAX_FILES,
		knownFiles: collectKnownFiles(log),
	})
	if (!textFiles.length && !binaryFiles.length && !dirs.length) return

	const preloadFiles = [...textFiles, ...binaryFiles, ...dirs].map(item => ({ path: item.path, resolved: item.resolved, hash: item.hash }))
	/**
	 * 构造带插件私有预读元数据的工具日志条目。
	 * @param {object} entry 日志主体。
	 * @returns {object} 完整条目。
	 */
	const withPreload = entry => {
		const extension = {}
		mergePluginData(extension, PLUGIN_DATA_KEY, { preload: { forUser: userKey, files: preloadFiles } })
		return { name: 'file-operations.preload', role: 'tool', charVisibility: [args.char_id], ...entry, extension }
	}

	if (textFiles.length) {
		let content = '以下对话中提及的文件已按当前工作目录自动预读：\n'
		for (const file of textFiles)
			content += `文件：${inlineCode(file.path)}\n${renderTextFile(file)}\n`
		args.AddLongTimeLog(withPreload({ content, files: [] }))
	}
	if (binaryFiles.length)
		args.AddLongTimeLog(withPreload({
			content: `以下对话中提及的二进制文件已作为附件预读：\n${binaryFiles.map(file => `- ${inlineCode(file.name)}`).join('\n')}\n`,
			files: binaryFiles.map(file => ({ name: file.name, mime_type: file.mime_type, buffer: file.buffer, description: '' })),
		}))
	for (const dir of dirs)
		args.AddLongTimeLog(withPreload({
			content: `以下对话中提及的目录内容：\n目录：${inlineCode(dir.path)}\n${dir.entries.map(name => `- ${inlineCode(name)}`).join('\n')}\n`,
			files: [],
		}))
}
