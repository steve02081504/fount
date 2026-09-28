/**
 * 对话提及文件与工具输出的持久化预读：从最新用户消息提取路径候选与报错定位，从末尾工具输出只提取报错定位
 * （工具输出中的普通路径不触发预读）；经目标执行器读取后，以工具日志形式经 `AddLongTimeLog` 写入本轮结果——
 * 当前轮即通过 `prompt_struct.chat_log` 可见，随后经 `result.logContextBefore` 随会话落盘，成为该角色聊天
 * 记录的一部分，跨轮/跨生成以稳定前缀参与提示缓存，而非每轮重算的临时追加上下文。
 * 由 `interfaces.chat.BeforeReply` 在每次生成开始时调用，须保持幂等。
 * @typedef {import('../../../../../decl/chatLog.ts').chatReplyRequest_t} chatReplyRequest_t
 * @typedef {import('../../../../../decl/prompt_struct.ts').chatLogEntry_t} chatLogEntry_t
 */

import { inferCodeLanguageFromPath, renderMarkdownCodeBlock } from '../../../shells/chat/src/streaming/index.mjs'
// chat shell 的 prompt_struct 合并器同时承担事实共享层：插件直接用其展开上下文与摘要边界属预期设计。

import { hashContent, mergePluginData, PLUGIN_DATA_KEY, resolveEffectiveLog } from './context_files.mjs'
import { parseErrorLocations } from './error_windows.mjs'
import { collectMentionedFiles, fileIdentityKey } from './mentioned_files.mjs'
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
 * 收集合并日志中已预读 / 已查看文件的身份键（供跨轮去重：同一机器上的同一路径身份即视为已读，与内容无关——避免 agent 改过的文件被再次塞进上下文）。
 * @param {chatLogEntry_t[]} log - 合并日志。
 * @returns {Set<string>} 已知文件的 `fileIdentityKey` 集合。
 */
export function collectKnownFiles(log) {
	const known = new Set()
	for (const entry of log || []) {
		const data = entry?.extension?.pluginData?.[PLUGIN_DATA_KEY]
		for (const group of [data?.preload?.files, data?.view?.files])
			for (const item of group || [])
				if (item?.resolved) known.add(fileIdentityKey(item.machine, item.resolved))
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

/** 本插件自身工具日志的名称前缀（避免把预读输出当作工具来源再次扫描）。 */
const PLUGIN_LOG_NAME_PREFIX = 'file-operations.'

/**
 * 取合并日志末尾连续的 `role:'tool'` 条目，即最近一次生成产出的工具输出。
 * @param {chatLogEntry_t[]} log - 合并日志。
 * @returns {chatLogEntry_t[]} 末尾工具条目（保持原顺序）。
 */
export function trailingToolEntries(log) {
	const entries = []
	for (let index = (log || []).length - 1; index >= 0; index--) {
		const entry = log[index]
		if (entry?.role !== 'tool') break
		entries.unshift(entry)
	}
	return entries
}

/**
 * 汇总末尾工具输出中命中报错定位的文本（跳过本插件自身的日志），供「仅报错检测」预读。
 * @param {chatLogEntry_t[]} log - 合并日志。
 * @returns {string} 命中文本（无命中时为空串）。
 */
export function collectToolErrorText(log) {
	const blocks = []
	for (const entry of trailingToolEntries(log)) {
		if (String(entry.name ?? '').startsWith(PLUGIN_LOG_NAME_PREFIX)) continue
		const content = String(entry.content ?? '')
		if (!content.trim() || !parseErrorLocations(content).length) continue
		blocks.push(content)
	}
	return blocks.join('\n')
}

/**
 * 把预读结果以工具日志写入本轮结果（空结果不写）。
 * @param {chatReplyRequest_t & {AddLongTimeLog: (entry: chatLogEntry_t) => void}} args - 请求上下文。
 * @param {{textFiles: object[], binaryFiles: object[], dirs: object[]}} result - 预读结果。
 * @param {{machine: string, marker?: object, intro?: string}} [meta] - `machine` 为目标机器标识（跨轮去重的机器维度）；`marker` 写入 `preload` 的额外元数据；`intro` 为文本文件块引导语。
 * @returns {void}
 */
function emitPreload(args, result, meta = {}) {
	const { textFiles, binaryFiles, dirs } = result
	if (!textFiles.length && !binaryFiles.length && !dirs.length) return
	const preloadFiles = [...textFiles, ...binaryFiles, ...dirs].map(item => ({ path: item.path, resolved: item.resolved, machine: meta.machine }))
	/**
	 * 构造带插件私有预读元数据的工具日志条目。
	 * @param {object} entry 日志主体。
	 * @returns {object} 完整条目。
	 */
	const withPreload = entry => {
		const extension = {}
		mergePluginData(extension, PLUGIN_DATA_KEY, { preload: { ...meta.marker, files: preloadFiles } })
		return { name: 'file-operations.preload', role: 'tool', charVisibility: [args.char_id], ...entry, extension }
	}
	if (textFiles.length) {
		let content = `${meta.intro ?? '以下对话中提及的文件已按当前工作目录自动预读：'}\n`
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

/**
 * 对最新用户消息提及的文件（报错窗口 + 通用路径）与末尾工具输出中报错的文件（仅报错窗口）做持久化预读。
 * 用户消息按 id 幂等；工具输出按 realpath 去重，已读文件不再重复读取；远端离线等失败由调用方吞掉，不影响生成。
 * @param {chatReplyRequest_t & {AddLongTimeLog: (entry: chatLogEntry_t) => void}} args - 请求上下文（含 `prompt_struct` 时优先）。
 * @returns {Promise<void>}
 */
export async function preloadMentionedFiles(args) {
	const target = resolveTarget(args)
	if (!target.workdir) return
	const log = resolveEffectiveLog(args)
	const knownFiles = collectKnownFiles(log)
	const executor = createArgsExecutorResolver(args)()
	const machine = target.machine

	// 用户消息：报错窗口 + 通用路径候选。同一用户消息已预读过（本轮后续轮次 / 重生成 / 异步触发）则跳过。
	const latest = findLatestUserEntry(log)
	const userText = String(latest?.content ?? '')
	if (latest && userText.trim()) {
		const userKey = String(latest.id ?? hashContent(userText))
		const already = log.some(entry => entry?.extension?.pluginData?.[PLUGIN_DATA_KEY]?.preload?.forUser === userKey)
		if (!already) {
			const result = await collectMentionedFiles(executor, userText, { maxFiles: PRELOAD_MAX_FILES, knownFiles, machine })
			// 并入已知集合：本次工具输出预读不再重复读取同一文件。
			for (const item of [...result.textFiles, ...result.binaryFiles, ...result.dirs])
				if (item.resolved) knownFiles.add(fileIdentityKey(machine, item.resolved))
			emitPreload(args, result, { machine, marker: { forUser: userKey } })
		}
	}

	// 工具输出：只认报错定位，不做通用路径提取——命令/构建输出里的普通路径不应触发默认预读。
	const toolText = collectToolErrorText(log)
	if (toolText.trim()) {
		const result = await collectMentionedFiles(executor, toolText, { maxFiles: PRELOAD_MAX_FILES, knownFiles, machine, extractPaths: false })
		emitPreload(args, result, { machine, marker: {}, intro: '以下为工具输出中报错的文件，已预读其出错位置附近内容：' })
	}
}
