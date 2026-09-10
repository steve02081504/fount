import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import path from 'node:path'

import { inferCodeLanguageFromPath, renderMarkdownCodeBlock } from '../../shells/chat/src/streaming/index.mjs'

import { collectUpwardContext, formatUpwardContext } from './src/context_files.mjs'
import { applyEol, applyReplacement, detectTextStyle, renderLineDiff, restoreBom, similarityRatio, stripBom, toLf } from './src/edit_safety.mjs'
import { formatReadWindowNotice, isProbablyTextBuffer, parseReadWindow, windowText } from './src/read_window.mjs'
import { runRipgrep } from './src/search.mjs'
import { createArgsExecutorResolver, listMachines, parseTagAttrs, resolveLocalPath, resolveTarget } from './src/target.mjs'

/** glob 搜索返回的文件数上限。 */
const SEARCH_FILE_LIMIT = 100
/** grep 搜索返回的匹配行数上限。 */
const SEARCH_MATCH_LIMIT = 200

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
 * 回复处理器类型别名。
 * @typedef {import("../../../../../src/decl/pluginAPI.ts").ReplyHandler_t} ReplyHandler_t
 */
/**
 * 聊天日志条目类型别名。
 * @typedef {import("../../../../../src/public/parts/shells/chat/decl/chatLog.ts").chatLogEntry_t} chatLogEntry_t
 */

/**
 * 处理来自 AI 的文件更改请求。
 * @type {ReplyHandler_t}
 */
export async function fileOperationsReplyHandler(result, args) {
	const { AddLongTimeLog } = args
	const executorFor = createArgsExecutorResolver(args)

	// 在独立工作副本上解析并掩除已处理调用段，不改写原始生成
	/**
	 * 取当前解析用的工作副本。
	 * @returns {string} 优先 content_for_handle，缺失时回退原始生成。
	 */
	const getContent = () => result.content_for_handle
	let regen = false

	/**
	 * 追加文件工具结果日志：agent 层存执行结果，人类展示层存「调用卡片 + 结果」（与 code-execution 一致）。
	 * @param {string} call - 工具调用文本。
	 * @param {string} resultText - agent 层执行结果。
	 * @param {{name?: string, files?: object[]}} [options] - 工具名（供人类侧区分读写/搜索）与结果附件。
	 * @returns {void}
	 */
	function addFileToolLog(call, resultText, { name = 'file-operations', files = [] } = {}) {
		AddLongTimeLog({
			name,
			role: 'tool',
			content: resultText,
			content_for_show: renderMarkdownCodeBlock(call.trim()) + '\n\n' + resultText,
			files,
		})
	}

	// 设置默认工作目录：<set-workdir machine="..." path="..."></set-workdir>；指定 machine 会替换机器并清除已有 path，
	// 指定 path 会更新路径，两者都留空时回到本机。
	// 就地 mutate args.workdir（chat 经 triggerReply 持久化到 scoped state），并把结果写进 chat_scoped_char_memory
	// （code shell 的会话 memory 经 WS done 回传持久化，后续请求以其覆盖工作区默认）。
	const set_workdir_matches = [...getContent().matchAll(/<set-workdir(?<attrs>[^>]*?)(?:\/>|>\s*<\/set-workdir>)/g)]
	if (set_workdir_matches.length) {
		for (const set_match of set_workdir_matches) {
			args.MaskHandledCall?.(set_match[0])
			const attrs = parseTagAttrs(set_match.groups.attrs)
			const workdir = args.workdir ??= {}
			if (!attrs.machine && !attrs.path) attrs.machine = '0' // 回到本机
			if (attrs.machine) {
				workdir.machine = attrs.machine
				delete workdir.path
			}
			if (attrs.path) workdir.path = attrs.path
			args.chat_scoped_char_memory ??= {}
			args.chat_scoped_char_memory.workdir = { ...workdir }
			addFileToolLog(set_match[0], `默认工作目录已更新为机器 ${workdir.machine}${workdir.path ? ` 的 ${workdir.path}` : ''}。`, { name: 'file-operations.set-workdir' })
		}
		regen = true
	}

	const list_machines_matches = [...getContent().matchAll(/<list-machines(?<attrs>[^>]*)>(?<content>[^]*?)<\/list-machines>/g)]
	if (list_machines_matches.length) {
		for (const list_match of list_machines_matches) args.MaskHandledCall?.(list_match[0])
		const machines = await listMachines(args.username)
		const content = '可用机器列表：\n' + renderMarkdownCodeBlock(JSON.stringify(machines, null, 2), { lang: 'json' })
		addFileToolLog(list_machines_matches.map(match => match[0]).join('\n'), content, { name: 'file-operations.list-machines' })
		regen = true
	}

	const view_files_matches = [...getContent().matchAll(/<view-file(?<attrs>[^>]*)>(?<paths>[^]*?)<\/view-file>/g)]
	if (view_files_matches.length) {
		for (const view_match of view_files_matches) {
			const attrs = view_match.groups.attrs
			const paths = view_match.groups.paths.split('\n').map(p => p.trim()).filter(path => path)
			if (!paths.length) continue
			args.MaskHandledCall?.(view_match[0])

			console.info('AI查看的文件：', paths)
			const target = resolveTarget(args, parseTagAttrs(attrs))
			const executor = executorFor(attrs)
			const readWindow = parseReadWindow(parseTagAttrs(attrs))
			const files = []
			let file_content = ''
			for (const path of paths)
				try {
					if (path.startsWith('http://') || path.startsWith('https://')) {
						const fileObj = await getFileObjFormPathOrUrl(path)
						if (fileObj.mime_type.startsWith('text/'))
							file_content += renderReadResult(path, fileObj.buffer.toString('utf-8'), readWindow)
						else {
							files.push(fileObj)
							file_content += `文件：${path}读取成功，放置于附件。\n`
						}
						continue
					}
					const buffer = await executor.readFileBuffer(path)
					if (isProbablyTextBuffer(buffer)) {
						file_content += renderReadResult(path, buffer.toString('utf-8'), readWindow)
						// 仅首页读取时向上收集 AGENTS.md 与触发的 .agents/docs 文档，避免分页重复注入
						if (readWindow.offset === 1) {
							const context = await collectUpwardContext(executor, target.workdir, path)
							const contextText = formatUpwardContext(context)
							if (contextText) file_content += '随文件一并加载的上下文：\n' + contextText + '\n'
						}
					}
					else {
						files.push({ name: path.split(/[\\/]/).pop() || 'file', buffer, mime_type: 'application/octet-stream' })
						file_content += `文件：${path}读取成功，放置于附件。\n`
					}
				}
				catch (err) {
					file_content += `读取文件失败：${path}\n${renderMarkdownCodeBlock(err.stack || String(err))}\n`
				}

			addFileToolLog(view_match[0], file_content, { name: 'file-operations.view-file', files })
		}
		regen = true
	}

	const glob_matches = [...getContent().matchAll(/<glob(?<attrs>[^>]*)>(?<content>[^]*?)<\/glob>/g)]
	if (glob_matches.length) {
		for (const glob_match of glob_matches) {
			const attrs = glob_match.groups.attrs
			const attrsMap = parseTagAttrs(attrs)
			const patterns = (glob_match.groups.content ?? attrsMap.pattern ?? '').split('\n').map(p => p.trim()).filter(Boolean)
			args.MaskHandledCall?.(glob_match[0])

			const location = attrsMap.path || '.'
			let system_content = ''
			try {
				const executor = executorFor(attrs)
				const root = await executor.resolvePath(attrsMap.path || '')
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
			addFileToolLog(glob_match[0], system_content, { name: 'file-operations.glob' })
		}
		regen = true
	}

	const grep_matches = [...getContent().matchAll(/<grep(?<attrs>[^>]*)>(?<content>[^]*?)<\/grep>/g)]
	if (grep_matches.length) {
		for (const grep_match of grep_matches) {
			const attrs = grep_match.groups.attrs
			const attrsMap = parseTagAttrs(attrs)
			const pattern = (grep_match.groups.content ?? attrsMap.pattern ?? '').trim()
			const includes = (attrsMap.include || '').split(/\s+/).filter(Boolean)
			const filesOnly = attrsMap.mode === 'files'
			args.MaskHandledCall?.(grep_match[0])

			const location = attrsMap.path || '.'
			let system_content = ''
			try {
				if (!pattern) throw new Error('未提供搜索模式：请把正则表达式写在 <grep> 标签内部。')
				const executor = executorFor(attrs)
				const root = await executor.resolvePath(attrsMap.path || '')
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
			addFileToolLog(grep_match[0], system_content, { name: 'file-operations.grep' })
		}
		regen = true
	}

	const replace_file_matches = [...getContent().matchAll(/<replace-file(?<attrs>[^>]*)>(?<content>[^]*?)<\/replace-file>/g)]
	for (const replace_match of replace_file_matches) {
		const replace_file_content = replace_match.groups.content
		const logContent = '<replace-file>' + replace_file_content + '</replace-file>\n'
		args.MaskHandledCall?.(replace_match[0])

		const replace_files_data = [] // Structure to hold data compatible with old logic

		try {
			// Regex to find each <file> block
			const fileRegex = /<file\s+path="(?<path>[^"]+)">(?<replacements_str>[^]*?)<\/file>/g
			// Regex to find each <replacement> block within a <file> block
			const replacementRegex = /<replacement(?<attributes>[^>]*)>\s*<search>(?<search>[^]*?)<\/search>\s*<replace>(?<replace>[^]*?)<\/replace>\s*<\/replacement>/g

			for (const fileMatch of replace_file_content.matchAll(fileRegex)) {
				const { path, replacements_str } = fileMatch.groups
				if (!path) continue // Should not happen with this regex, but a good safeguard

				const fileData = {
					path,
					replacements: []
				}

				for (const repMatch of replacements_str.matchAll(replacementRegex)) {
					const { attributes, search, replace } = repMatch.groups

					if (search === undefined || replace === undefined) {
						console.warn('Skipping malformed <replacement> block for path:', path)
						continue
					}

					// Check for regex="true" / replaceAll="true" in attributes. A simple .includes() is robust enough.
					const isRegex = attributes?.includes('regex="true"') ?? false
					const isReplaceAll = attributes?.includes('replaceAll="true"') ?? false

					fileData.replacements.push({
					// Use trim() to be consistent with the previous XML parser's `trimValues: true` option
						search: search.trim(),
						replace, // Do not trim replace content, as whitespace might be significant
						regex: isRegex,
						replaceAll: isReplaceAll,
					})
				}

				if (fileData.replacements.length)
					replace_files_data.push(fileData)
			}

			if (!replace_files_data.length)
				throw new Error('解析<replace-file>标签后，未找到任何有效的<file>或<replacement>操作。')
		}
		catch (err) {
			console.error('Error parsing replace-file content with regex:', err)
			addFileToolLog(logContent, `解析replace-file失败：\n${renderMarkdownCodeBlock(err.stack || String(err))}\n原始数据:\n<replace-file>${replace_file_content}</replace-file>`, { name: 'file-operations.replace-file' })
			continue // Continue to next match instead of stopping
		}

		console.info('AI替换的文件：', replace_files_data)
		const executor = executorFor(replace_match.groups.attrs)

		for (const replace_file of replace_files_data) {
			const { path, replacements } = replace_file
			const failed_replaces = []
			const methods_used = new Set()
			let replace_count = 0
			let originalContent
			try {
				originalContent = await executor.readTextFile(path)
			}
			catch (err) {
				addFileToolLog(logContent, `读取文件失败：${path}\n${renderMarkdownCodeBlock(err.stack || String(err))}\n`, { name: 'file-operations.replace-file' })
				continue
			}

			// 保留原文件的 BOM 与行尾风格：匹配在 LF 空间进行，写回时还原，避免 CRLF 文件被静默写坏。
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
				console.warn(`Replacement skipped for path ${path}, search "${search}", regex: ${regex}:`, reason)
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
				system_content = `文件 ${path} 内容已修改，应用了 ${replacements.length} 项替换`
				if (replace_count > 0) system_content += `，其中 ${replace_count} 个替换成功`
				if (methods_used.size) system_content += `（匹配方式：${[...methods_used].join('、')}）`
				system_content += '。\n'
			}
			else system_content = `文件 ${path} 内容未发生变化（尝试了 ${replacements.length} 项替换规则）。\n`

			if (failed_replaces.length) {
				system_content += `以下 ${failed_replaces.length} 处替换操作失败：\n`
				system_content += renderMarkdownCodeBlock(JSON.stringify(failed_replaces, null, '\t'), { lang: 'json' }) + '\n'
			}

			if (changed) {
				const diff = renderLineDiff(lfOriginal, modifiedContent)
				system_content += `\n变更摘要（行级 diff）：\n${renderMarkdownCodeBlock(diff || '（无可见变更）', { lang: 'diff' })}\n若和你的预期不一致，考虑重新替换或使用override-file覆写修正。`
				try {
					await executor.writeTextFile(path, finalContent)
				}
				catch (err) {
					system_content = `写入文件失败：${path}\n${renderMarkdownCodeBlock(err.stack || String(err))}\n`
				}
			}
			// If content didn't change AND no errors, explicitly state that
			else if (!failed_replaces.length) system_content += '所有替换规则均未匹配到内容或未导致文件变化。'

			addFileToolLog(logContent, system_content, { name: 'file-operations.replace-file' })
		}
		regen = true
	}

	const override_file_matches = [...getContent().matchAll(/<override-file\s+(?<attrs>[^>]*)>(?<content>[^]*?)<\/override-file>/g)]
	for (const override_match of override_file_matches) {
		const overrideAttrs = parseTagAttrs(override_match.groups.attrs)
		const path = overrideAttrs.path
		const overrideContent = override_match.groups.content
		const force = overrideAttrs.force === 'true'
		const logContent = `<override-file path="${path}">` + overrideContent + '</override-file>\n'
		args.MaskHandledCall?.(override_match[0])

		console.info('AI写入的文件：', path, overrideContent)
		try {
			const executor = executorFor(override_match.groups.attrs)
			const newText = overrideContent.trim() + '\n'
			// 读取原文以做防呆：存在且新内容差异过大（或为空）时，需显式 force="true" 才允许整体覆写。
			const existing = await executor.readTextFile(path).catch(() => null)
			if (existing != null) {
				const style = detectTextStyle(existing)
				const similarity = similarityRatio(toLf(stripBom(existing)), toLf(newText))
				const isEmpty = !newText.trim()
				if (!force && (isEmpty || similarity < 0.3)) {
					addFileToolLog(logContent, `覆写 ${path} 被拒绝：新内容与原文相似度仅 ${(similarity * 100).toFixed(1)}%${isEmpty ? '，且新内容为空' : ''}。\n如确认要整体重写，请为 <override-file> 添加 force="true"；否则请改用 <replace-file> 做局部修改。`, { name: 'file-operations.override-file' })
					regen = true
					continue
				}
				await executor.writeTextFile(path, restoreBom(applyEol(toLf(newText), style.eol), style.bom))
			}
			else await executor.writeTextFile(path, newText)
			addFileToolLog(logContent, `文件 ${path} 已写入`, { name: 'file-operations.override-file' })
		}
		catch (err) {
			addFileToolLog(logContent, `写入文件失败：${path}\n${renderMarkdownCodeBlock(err.stack || String(err))}\n`, { name: 'file-operations.override-file' })
		}
		regen = true
	}

	return regen
}
