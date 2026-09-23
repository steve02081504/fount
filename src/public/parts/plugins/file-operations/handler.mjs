import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import path from 'node:path'

import { mergeStructPromptChatLog } from '../../shells/chat/src/prompt_struct/index.mjs'
import { defineReplyHandler } from '../../shells/chat/src/reply/defineReplyHandler.mjs'
import { defaultDisplay } from '../../shells/chat/src/reply/display.mjs'
import { getChatI18n, inferCodeLanguageFromPath, renderMarkdownCodeBlock } from '../../shells/chat/src/streaming/index.mjs'

import { collectLoadedHashes, collectUpwardContext, formatUpwardContext, hashContent } from './src/context_files.mjs'
import { applyEol, applyReplacement, detectTextStyle, renderLineDiff, restoreBom, similarityRatio, stripBom, toLf } from './src/edit_safety.mjs'
import { formatReadWindowNotice, isProbablyTextBuffer, parseReadWindow, windowText } from './src/read_window.mjs'
import { runRipgrep } from './src/search.mjs'
import { createArgsExecutorResolver, listMachines, resolveLocalPath, resolveTarget } from './src/target.mjs'

/** glob 搜索返回的文件数上限。 */
const SEARCH_FILE_LIMIT = 100
/** grep 搜索返回的匹配行数上限。 */
const SEARCH_MATCH_LIMIT = 200

/**
 * 回复处理器类型别名。
 * @typedef {import("../../../../../src/decl/pluginAPI.ts").ReplyHandler_t} ReplyHandler_t
 */
/**
 * 聊天日志条目类型别名。
 * @typedef {import("../../../../../src/public/parts/shells/chat/decl/chatLog.ts").chatLogEntry_t} chatLogEntry_t
 */

/**
 * 同一请求内已注入上下文哈希的 in-flight 集合。
 * 跨轮去重靠工具日志 `extension.loadedContextHashes`；此集合额外兜底同轮并发（parallel）读取：
 * 相邻多个 `<view-file>` 的日志要等批次结束才回放，期间彼此不可见。以请求 `prompt_struct`（稳定引用）
 * 为键，并在摘要边界变化（summary 会裁掉更早历史）时重置。
 * @type {WeakMap<object, {summaryKey: string, hashes: Set<string>}>}
 */
const inFlightContextHashes = new WeakMap()

/**
 * 取「对当前角色生效」的合并日志：优先 `prompt_struct`（自带摘要边界与可见性过滤），缺失时回退 `args.chat_log`。
 * @param {object} args - 请求上下文。
 * @returns {object[]} 合并后的日志条目数组。
 */
function resolveEffectiveLog(args) {
	if (Array.isArray(args?.prompt_struct?.chat_log))
		try {
			return mergeStructPromptChatLog(args.prompt_struct)
		}
		catch { /* prompt_struct 结构不完整时回退 */ }
	return Array.isArray(args?.chat_log) ? args.chat_log : []
}

/**
 * 取生效窗口内已注入的上下文哈希集合（同一请求内共享引用）。
 * 摘要边界变化（出现新的可见 summary）时重置：更早历史已被裁掉，其中注入过的上下文需重新注入。
 * @param {object} args - 请求上下文。
 * @returns {Set<string>} 已注入内容哈希集合。
 */
function resolveKnownContextHashes(args) {
	const key = args?.prompt_struct ?? args
	const merged = resolveEffectiveLog(args)
	const summaryKey = merged.find(entry => entry?.type === 'summary')?.id ?? ''
	let record = inFlightContextHashes.get(key)
	if (!record || record.summaryKey !== summaryKey)
		record = { summaryKey, hashes: new Set() }
	for (const hash of collectLoadedHashes(merged)) record.hashes.add(hash)
	// code world 已把工作区根 AGENTS.md 放在 system prompt；不再由 view-file 复制一次。
	for (const text of args?.prompt_struct?.world_prompt?.text ?? [])
		if (text?.description?.startsWith('AGENTS.md (') && typeof text.content === 'string')
			record.hashes.add(hashContent(text.content))
	inFlightContextHashes.set(key, record)
	return record.hashes
}

/**
 * 渲染读取窗口结果：区间头 + 代码块 + 截断提示。
 * @param {string} filepath - 文件路径。
 * @param {string} text - 原始文本内容。
 * @param {import('./src/read_window.mjs').readWindow_t} readWindow - 读取窗口。
 * @returns {string} 渲染后的工具日志片段。
 */
function renderReadResult(filepath, text, readWindow) {
	const result = windowText(text, readWindow)
	if (result.outOfRange)
		return `文件：${filepath}\n读取失败：${formatReadWindowNotice(result)}\n`
	const rangeNote = readWindow.offset > 1 || result.endLine < result.totalLines
		? `（第 ${result.startLine}-${result.endLine} 行 / 共 ${result.totalLines} 行）`
		: ''
	let output = `文件：${filepath}${rangeNote}\n${renderMarkdownCodeBlock(result.text, { lang: inferCodeLanguageFromPath(filepath) })}\n`
	const notice = formatReadWindowNotice(result)
	if (notice) output += notice + '\n'
	return output
}

/**
 * 从本地文件路径或 URL 创建一个文件对象。
 * @param {string} pathOrUrl - 文件的本地路径或 URL。
 * @returns {Promise<{name: string, buffer: Buffer, mime_type: string}>} - 包含文件信息的文件对象。
 */
async function getFileObjFormPathOrUrl(pathOrUrl) {
	if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) {
		const response = await fetch(pathOrUrl)
		if (!response.ok) throw new Error('fetch failed.')
		const buffer = Buffer.from(await response.arrayBuffer())
		const mime_type = response.headers.get('content-type') || 'application/octet-stream'
		const urlPath = new URL(pathOrUrl).pathname
		const name = path.basename(urlPath) || 'downloaded.bin'
		return { name, buffer, mime_type }
	}
	else {
		const filePath = resolveLocalPath(pathOrUrl)
		const buffer = fs.readFileSync(filePath)
		const name = path.basename(filePath)
		const mime_type = 'application/octet-stream' // 简化版本，不检测 MIME 类型
		return { name, buffer, mime_type }
	}
}

/**
 * 渲染“按目标文件高亮 + 标题”的代码块。
 * @param {object} args - 预览更新参数。
 * @param {string} filepath - 文件路径。
 * @param {string} content - 要展示的内容。
 * @param {'chat.message.view.tool.readingFilepath'|'chat.message.view.tool.replacingFilepath'|'chat.message.view.tool.overridingFilepath'} titleKey - 标题 i18n 键。
 * @returns {string} 渲染后的 Markdown 代码块。
 */
function renderFileOperationCodeBlock(args, filepath, content, titleKey) {
	const lang = inferCodeLanguageFromPath(filepath)
	const title = getChatI18n(args, titleKey, { filepath })
	return renderMarkdownCodeBlock(content, { lang, title })
}

/**
 * 将 <view-file> 中的路径列表渲染为单个代码块（正文为路径列表，不再逐行拆块）。
 * @param {object} call - 调用对象。
 * @param {object} args - 预览更新参数。
 * @returns {string} 渲染结果。
 */
function renderViewFileBlock(call, args) {
	const paths = call.inner.split('\n').map(x => x.trim()).filter(Boolean)
	if (!paths.length) return call.inner
	if (paths.length === 1)
		return renderFileOperationCodeBlock(args, paths[0], paths[0], 'chat.message.view.tool.readingFilepath')
	return renderMarkdownCodeBlock(paths.join('\n'), {
		title: getChatI18n(args, 'chat.message.view.tool.readingFiles', { count: paths.length }),
	})
}

/**
 * 渲染 <replace-file> 内容，按每个目标文件分段展示。
 * @param {object} call - 调用对象。
 * @param {object} args - 预览更新参数。
 * @returns {string} 渲染结果。
 */
function renderReplaceFileBlock(call, args) {
	const content = call.inner
	const fileBlocks = [...content.matchAll(/<file\s+path="(?<filepath>[^"]+)">(?<filecontent>[\S\s]*?)<\/file>/g)]
	if (!fileBlocks.length) {
		const filepath = content.match(/<file\s+path="([^"]+)"/)?.[1] || 'unknown'
		return renderFileOperationCodeBlock(args, filepath, content, 'chat.message.view.tool.replacingFilepath')
	}
	return fileBlocks.map(match => {
		const { filepath, filecontent } = match.groups
		return renderFileOperationCodeBlock(args, filepath, filecontent, 'chat.message.view.tool.replacingFilepath')
	}).join('\n\n')
}

/**
 * 渲染 <override-file> 内容。
 * @param {object} call - 调用对象。
 * @param {object} args - 预览更新参数。
 * @returns {string} 渲染结果。
 */
function renderOverrideFileBlock(call, args) {
	const filepath = call.params.path || 'unknown'
	return renderFileOperationCodeBlock(args, filepath, call.inner, 'chat.message.view.tool.overridingFilepath')
}

/**
 * 渲染 <glob> / <grep> 待执行占位：标题为本地化“正在搜索…”，正文为标签内容。
 * @param {object} call - 调用对象。
 * @param {object} args - 预览更新参数。
 * @returns {string} 渲染结果。
 */
function renderSearchBlock(call, args) {
	const keyword = (call.inner || call.params.pattern || '').trim()
	return renderMarkdownCodeBlock(keyword, {
		title: getChatI18n(args, 'chat.message.view.tool.searchingContent', { content: keyword }),
	})
}

/**
 * `<list-machines>` 的流式占位。
 * @returns {string} 占位文本。
 */
function renderListMachinesPlaceholder() {
	return '`list-machines`'
}

/**
 * 生成「流式期渲染、终态折叠」的 display。
 * @param {(call: object, args: object) => string} render - 流式渲染函数。
 * @returns {Function} display
 */
function pendingDisplay(render) {
	return (call, state, args) => state.stage === 'streaming'
		? render(call, args)
		: defaultDisplay(call, state, args)
}

/**
 * 追加文件工具结果日志：agent 层存执行结果，人类展示层存「调用卡片 + 结果」（与 code-execution 一致）。
 * @param {object} args - 请求上下文。
 * @param {string} call - 工具调用文本。
 * @param {string} resultText - agent 层执行结果。
 * @param {{name?: string, files?: object[], loadedContextHashes?: string[]}} [options] - 工具名（供人类侧区分读写/搜索）、结果附件与本次注入的上下文哈希。
 * @returns {void}
 */
function addFileToolLog(args, call, resultText, { name = 'file-operations', files = [], loadedContextHashes } = {}) {
	args.AddLongTimeLog({
		name,
		role: 'tool',
		content: resultText,
		content_for_show: renderMarkdownCodeBlock(call.trim()) + '\n\n' + resultText,
		files,
		...Array.isArray(loadedContextHashes) && loadedContextHashes.length ? { extension: { loadedContextHashes } } : {},
	})
}

/**
 * `<set-workdir machine="..." path="...">`：更新默认工作目录（就地 mutate args.workdir 与 scoped memory）。
 * @type {ReplyHandler_t}
 */
export const setWorkdirReplyHandler = defineReplyHandler({
	tag: 'set-workdir',
	params: { machine: 'string', path: 'string' },
	/**
	 * 更新默认工作目录。
	 * @param {object} reply 回复对象
	 * @param {object} args 请求上下文
	 * @param {object} call 调用
	 * @returns {Promise<object>} 结果
	 */
	handle: async (reply, args, call) => {
		const machine = call.params.machine || (!call.params.path ? '0' : '')
		const workdir = args.workdir ??= {}
		if (machine) {
			workdir.machine = machine
			delete workdir.path
		}
		if (call.params.path) workdir.path = call.params.path
		args.chat_scoped_char_memory ??= {}
		args.chat_scoped_char_memory.workdir = { ...workdir }
		addFileToolLog(args, call.raw, `默认工作目录已更新为机器 ${workdir.machine}${workdir.path ? ` 的 ${workdir.path}` : ''}。`, { name: 'file-operations.set-workdir' })
		return { regen: true }
	},
})

/**
 * `<list-machines>`：列出可用机器。
 * @type {ReplyHandler_t}
 */
export const listMachinesReplyHandler = defineReplyHandler({
	tag: 'list-machines',
	display: pendingDisplay(renderListMachinesPlaceholder),
	parallel: true,
	/**
	 * 列出可用机器。
	 * @param {object} reply 回复对象
	 * @param {object} args 请求上下文
	 * @param {object} call 调用
	 * @returns {Promise<object>} 结果
	 */
	handle: async (reply, args, call) => {
		const machines = await listMachines(args.username)
		const content = '可用机器列表：\n' + renderMarkdownCodeBlock(JSON.stringify(machines, null, 2), { lang: 'json' })
		addFileToolLog(args, call.raw, content, { name: 'file-operations.list-machines' })
		return { regen: true }
	},
})

/**
 * `<view-file>`：读取文件（正文为路径列表）。
 * @type {ReplyHandler_t}
 */
export const viewFileReplyHandler = defineReplyHandler({
	tag: 'view-file',
	display: pendingDisplay(renderViewFileBlock),
	parallel: true,
	/**
	 * 读取文件。
	 * @param {object} reply 回复对象
	 * @param {object} args 请求上下文
	 * @param {object} call 调用
	 * @returns {Promise<object>} 结果
	 */
	handle: async (reply, args, call) => {
		const executorFor = createArgsExecutorResolver(args)
		const paths = call.inner.split('\n').map(p => p.trim()).filter(Boolean)
		if (!paths.length) return {}
		console.info('AI查看的文件：', paths)
		const target = resolveTarget(args, call.params)
		const executor = executorFor(call.params)
		const readWindow = parseReadWindow(call.params)
		const files = []
		let file_content = ''
		const loadedContextHashes = []
		const knownContextHashes = resolveKnownContextHashes(args)
		for (const filepath of paths)
			try {
				if (filepath.startsWith('http://') || filepath.startsWith('https://')) {
					const fileObj = await getFileObjFormPathOrUrl(filepath)
					if (fileObj.mime_type.startsWith('text/'))
						file_content += renderReadResult(filepath, fileObj.buffer.toString('utf-8'), readWindow)
					else {
						files.push(fileObj)
						file_content += `文件：${filepath}读取成功，放置于附件。\n`
					}
					continue
				}
				const buffer = await executor.readFileBuffer(filepath)
				if (isProbablyTextBuffer(buffer)) {
					const text = buffer.toString('utf-8')
					file_content += renderReadResult(filepath, text, readWindow)
					const shown = windowText(text, readWindow)
					if (shown.startLine === 1 && shown.endLine === shown.totalLines && !shown.truncatedLineCount)
						knownContextHashes.add(hashContent(text))
					// 向上收集 AGENTS.md 与触发的 .agents/docs 文档，按内容 hash 去重：生效窗口内已注入过的跳过
					const context = await collectUpwardContext(executor, target.workdir, filepath)
					const freshAgents = context.agents.filter(item => !knownContextHashes.has(item.hash))
					const freshDocs = context.docs.filter(item => !knownContextHashes.has(item.hash))
					for (const item of [...freshAgents, ...freshDocs]) {
						knownContextHashes.add(item.hash)
						loadedContextHashes.push(item.hash)
					}
					const contextText = formatUpwardContext({ agents: freshAgents, docs: freshDocs })
					if (contextText) file_content += '随文件一并加载的上下文：\n' + contextText + '\n'
				}
				else {
					files.push({ name: filepath.split(/[\\/]/).pop() || 'file', buffer, mime_type: 'application/octet-stream' })
					file_content += `文件：${filepath}读取成功，放置于附件。\n`
				}
			}
			catch (err) {
				file_content += `读取文件失败：${filepath}\n${renderMarkdownCodeBlock(err.stack || String(err))}\n`
			}

		addFileToolLog(args, call.raw, file_content, { name: 'file-operations.view-file', files, loadedContextHashes })
		return { regen: true }
	},
})

/**
 * `<glob>`：文件搜索。
 * @type {ReplyHandler_t}
 */
export const globReplyHandler = defineReplyHandler({
	tag: 'glob',
	display: pendingDisplay(renderSearchBlock),
	parallel: true,
	/**
	 * 文件搜索。
	 * @param {object} reply 回复对象
	 * @param {object} args 请求上下文
	 * @param {object} call 调用
	 * @returns {Promise<object>} 结果
	 */
	handle: async (reply, args, call) => {
		const executorFor = createArgsExecutorResolver(args)
		const patterns = (call.inner || call.params.pattern || '').split('\n').map(p => p.trim()).filter(Boolean)
		const location = call.params.path || '.'
		let system_content = ''
		try {
			const executor = executorFor(call.params)
			const root = await executor.resolvePath(call.params.path || '')
			const result = await executor.execJs(runRipgrep, { mode: 'glob', root, patterns, limit: SEARCH_FILE_LIMIT })
			if (!result.ok)
				system_content = `文件搜索失败：${result.error}\n`
			else {
				system_content = `在 ${location} 下搜索文件，命中 ${result.total} 个${result.truncated ? `（仅显示前 ${SEARCH_FILE_LIMIT} 个）` : ''}：\n`
				system_content += result.files.length
					? renderMarkdownCodeBlock(result.files.join('\n'), { lang: 'text' }) + '\n'
					: '（无匹配）\n'
				if (result.truncated)
					system_content += '结果过多，请使用更精确的 glob 模式或更小的 path。\n'
			}
		}
		catch (err) {
			system_content = `文件搜索失败：\n${renderMarkdownCodeBlock(err.stack || String(err))}\n`
		}
		addFileToolLog(args, call.raw, system_content, { name: 'file-operations.glob' })
		return { regen: true }
	},
})

/**
 * `<grep>`：内容搜索。
 * @type {ReplyHandler_t}
 */
export const grepReplyHandler = defineReplyHandler({
	tag: 'grep',
	display: pendingDisplay(renderSearchBlock),
	parallel: true,
	/**
	 * 内容搜索。
	 * @param {object} reply 回复对象
	 * @param {object} args 请求上下文
	 * @param {object} call 调用
	 * @returns {Promise<object>} 结果
	 */
	handle: async (reply, args, call) => {
		const executorFor = createArgsExecutorResolver(args)
		const pattern = (call.inner || call.params.pattern || '').trim()
		const includes = (call.params.include || '').split(/\s+/).filter(Boolean)
		const filesOnly = call.params.mode === 'files'
		const location = call.params.path || '.'
		let system_content = ''
		try {
			if (!pattern) throw new Error('未提供搜索模式：请把正则表达式写在 <grep> 标签内部。')
			const executor = executorFor(call.params)
			const root = await executor.resolvePath(call.params.path || '')
			const result = await executor.execJs(runRipgrep, { mode: 'grep', root, pattern, includes, filesOnly, limit: SEARCH_MATCH_LIMIT })
			if (!result.ok)
				system_content = `内容搜索失败：${result.error}\n`
			else if (filesOnly) {
				system_content = `在 ${location} 下搜索 ${pattern}，命中 ${result.total} 个文件${result.truncated ? `（仅显示前 ${SEARCH_MATCH_LIMIT} 个）` : ''}：\n`
				system_content += result.files.length
					? renderMarkdownCodeBlock(result.files.join('\n'), { lang: 'text' }) + '\n'
					: '（无匹配）\n'
			}
			else {
				system_content = `在 ${location} 下搜索 ${pattern}，命中 ${result.total} 处${result.truncated ? `（仅显示前 ${SEARCH_MATCH_LIMIT} 处）` : ''}：\n`
				const grouped = new Map()
				for (const match of result.matches)
					grouped.set(match.path, [...grouped.get(match.path) || [], match])
				const lines = []
				for (const [filepath, fileMatches] of grouped) {
					lines.push(filepath + ':')
					for (const match of fileMatches) lines.push(`  ${match.line}: ${match.text}`)
				}
				system_content += lines.length
					? renderMarkdownCodeBlock(lines.join('\n'), { lang: 'text' }) + '\n'
					: '（无匹配）\n'
				if (result.truncated)
					system_content += '结果过多，请使用更精确的模式、include 过滤器或更小的 path。\n'
			}
		}
		catch (err) {
			system_content = `内容搜索失败：\n${renderMarkdownCodeBlock(err.stack || String(err))}\n`
		}
		addFileToolLog(args, call.raw, system_content, { name: 'file-operations.grep' })
		return { regen: true }
	},
})

/**
 * `<replace-file>`：局部替换文件内容。
 * @type {ReplyHandler_t}
 */
export const replaceFileReplyHandler = defineReplyHandler({
	tag: 'replace-file',
	display: pendingDisplay(renderReplaceFileBlock),
	/**
	 * 局部替换文件内容。
	 * @param {object} reply 回复对象
	 * @param {object} args 请求上下文
	 * @param {object} call 调用
	 * @returns {Promise<object>} 结果
	 */
	handle: async (reply, args, call) => {
		const executorFor = createArgsExecutorResolver(args)
		const replace_file_content = call.inner
		const logContent = '<replace-file>' + replace_file_content + '</replace-file>\n'
		const replace_files_data = []

		try {
			const fileRegex = /<file\s+path="(?<path>[^"]+)">(?<replacements_str>[^]*?)<\/file>/g
			const replacementRegex = /<replacement(?<attributes>[^>]*)>\s*<search>(?<search>[^]*?)<\/search>\s*<replace>(?<replace>[^]*?)<\/replace>\s*<\/replacement>/g

			for (const fileMatch of replace_file_content.matchAll(fileRegex)) {
				const { path: filepath, replacements_str } = fileMatch.groups
				if (!filepath) continue
				const fileData = { path: filepath, replacements: [] }
				for (const repMatch of replacements_str.matchAll(replacementRegex)) {
					const { attributes, search, replace } = repMatch.groups
					if (search === undefined || replace === undefined) {
						console.warn('Skipping malformed <replacement> block for path:', filepath)
						continue
					}
					const isRegex = attributes?.includes('regex="true"') ?? false
					const isReplaceAll = attributes?.includes('replaceAll="true"') ?? false
					fileData.replacements.push({ search: search.trim(), replace, regex: isRegex, replaceAll: isReplaceAll })
				}
				if (fileData.replacements.length)
					replace_files_data.push(fileData)
			}

			if (!replace_files_data.length)
				throw new Error('解析<replace-file>标签后，未找到任何有效的<file>或<replacement>操作。')
		}
		catch (err) {
			console.error('Error parsing replace-file content with regex:', err)
			addFileToolLog(args, logContent, `解析replace-file失败：\n${renderMarkdownCodeBlock(err.stack || String(err))}\n原始数据:\n<replace-file>${replace_file_content}</replace-file>`, { name: 'file-operations.replace-file' })
			return { regen: true }
		}

		console.info('AI替换的文件：', replace_files_data)
		const executor = executorFor(call.params)

		for (const replace_file of replace_files_data) {
			const { path: filepath, replacements } = replace_file
			const failed_replaces = []
			const methods_used = new Set()
			let replace_count = 0
			let originalContent
			try {
				originalContent = await executor.readTextFile(filepath)
			}
			catch (err) {
				addFileToolLog(args, logContent, `读取文件失败：${filepath}\n${renderMarkdownCodeBlock(err.stack || String(err))}\n`, { name: 'file-operations.replace-file' })
				continue
			}

			const style = detectTextStyle(originalContent)
			const lfOriginal = toLf(stripBom(originalContent))
			let modifiedContent = lfOriginal

			for (const rep of replacements) {
				const { search, replace, regex, replaceAll } = rep
				const result = applyReplacement(modifiedContent, { search, replace, regex, replaceAll })
				if (result.status === 'applied') {
					modifiedContent = result.content
					replace_count++
					if (result.method) methods_used.add(result.method)
					continue
				}
				const reason = {
					empty: '搜索内容为空，已跳过（请提供非空 search）。',
					multi: `命中 ${result.matchCount} 处，为避免误改已跳过；请补充上下文使匹配唯一，或为该 <replacement> 添加 replaceAll="true" 显式全替换。`,
					'no-match': '未在任何匹配级别命中该内容，请核对原文（注意缩进与空行），必要时先用 <view-file> 查看。',
					disproportionate: '模糊匹配跨度异常，已拒绝以避免误改；请提供更精确的 search。',
					invalid: `搜索表达式无效：${result.error}`,
				}[result.status] || '替换失败。'
				console.warn(`Replacement skipped for path ${filepath}, search "${search}", regex: ${regex}:`, reason)
				failed_replaces.push({
					search: search.slice(0, 200),
					regex,
					replaceAll,
					reason,
					...result.matches ? { matches: result.matches } : {},
				})
			}

			const finalContent = restoreBom(applyEol(modifiedContent, style.eol), style.bom)
			const changed = originalContent !== finalContent
			let system_content = ''
			if (changed) {
				system_content = `文件 ${filepath} 内容已修改，应用了 ${replacements.length} 项替换`
				if (replace_count > 0) system_content += `，其中 ${replace_count} 个替换成功`
				if (methods_used.size) system_content += `（匹配方式：${[...methods_used].join('、')}）`
				system_content += '。\n'
			}
			else system_content = `文件 ${filepath} 内容未发生变化（尝试了 ${replacements.length} 项替换规则）。\n`

			if (failed_replaces.length) {
				system_content += `以下 ${failed_replaces.length} 处替换操作失败：\n`
				system_content += renderMarkdownCodeBlock(JSON.stringify(failed_replaces, null, '\t'), { lang: 'json' }) + '\n'
			}

			if (changed) {
				const diff = renderLineDiff(lfOriginal, modifiedContent)
				system_content += `\n变更摘要（行级 diff）：\n${renderMarkdownCodeBlock(diff || '（无可见变更）', { lang: 'diff' })}\n若和你的预期不一致，考虑重新替换或使用override-file覆写修正。`
				try {
					await executor.writeTextFile(filepath, finalContent)
				}
				catch (err) {
					system_content = `写入文件失败：${filepath}\n${renderMarkdownCodeBlock(err.stack || String(err))}\n`
				}
			}
			else if (!failed_replaces.length) system_content += '所有替换规则均未匹配到内容或未导致文件变化。'

			addFileToolLog(args, logContent, system_content, { name: 'file-operations.replace-file' })
		}
		return { regen: true }
	},
})

/**
 * `<override-file path="..." force="true">`：整体覆写文件。
 * @type {ReplyHandler_t}
 */
export const overrideFileReplyHandler = defineReplyHandler({
	tag: 'override-file',
	params: { path: 'string', force: 'boolean' },
	display: pendingDisplay(renderOverrideFileBlock),
	/**
	 * 整体覆写文件。
	 * @param {object} reply 回复对象
	 * @param {object} args 请求上下文
	 * @param {object} call 调用
	 * @returns {Promise<object>} 结果
	 */
	handle: async (reply, args, call) => {
		const executorFor = createArgsExecutorResolver(args)
		const filepath = call.params.path
		const force = call.params.force === true
		const logContent = `<override-file path="${filepath}">` + call.inner + '</override-file>\n'
		console.info('AI写入的文件：', filepath, call.inner)
		try {
			const executor = executorFor(call.params)
			const newText = call.inner.trim() + '\n'
			// 读取原文以做防呆：存在且新内容差异过大（或为空）时，需显式 force="true" 才允许整体覆写。
			const existing = await executor.readTextFile(filepath).catch(() => null)
			if (existing != null) {
				const style = detectTextStyle(existing)
				const similarity = similarityRatio(toLf(stripBom(existing)), toLf(newText))
				const isEmpty = !newText.trim()
				if (!force && (isEmpty || similarity < 0.3)) {
					addFileToolLog(args, logContent, `覆写 ${filepath} 被拒绝：新内容与原文相似度仅 ${(similarity * 100).toFixed(1)}%${isEmpty ? '，且新内容为空' : ''}。\n如确认要整体重写，请为 <override-file> 添加 force="true"；否则请改用 <replace-file> 做局部修改。`, { name: 'file-operations.override-file' })
					return { regen: true }
				}
				await executor.writeTextFile(filepath, restoreBom(applyEol(toLf(newText), style.eol), style.bom))
			}
			else await executor.writeTextFile(filepath, newText)
			addFileToolLog(args, logContent, `文件 ${filepath} 已写入`, { name: 'file-operations.override-file' })
		}
		catch (err) {
			addFileToolLog(args, logContent, `写入文件失败：${filepath}\n${renderMarkdownCodeBlock(err.stack || String(err))}\n`, { name: 'file-operations.override-file' })
		}
		return { regen: true }
	},
})

/**
 * file-operations 插件的全部 ReplyHandler（顺序即同 level 内的兜底声明顺序）。
 * @type {ReplyHandler_t[]}
 */
export const fileOperationsReplyHandlers = [
	setWorkdirReplyHandler,
	listMachinesReplyHandler,
	viewFileReplyHandler,
	globReplyHandler,
	grepReplyHandler,
	replaceFileReplyHandler,
	overrideFileReplyHandler,
]
