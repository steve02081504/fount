import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import path from 'node:path'

import { escapeRegExp, parseRegexFromString } from '../../../../scripts/regex.mjs'
import { inferCodeLanguageFromPath, renderMarkdownCodeBlock } from '../../shells/chat/src/streaming/index.mjs'

import { collectUpwardContext, formatUpwardContext } from './src/context_files.mjs'
import { createArgsExecutorResolver, listMachines, parseTagAttrs, resolveLocalPath, resolveTarget } from './src/target.mjs'

/**
 * 判定 buffer 是否大致为文本（前 8KB 无 NUL 字节）。
 * @param {Buffer} buffer - 文件内容。
 * @returns {boolean} 是否文本。
 */
function looksLikeText(buffer) {
	const sample = buffer.subarray(0, 8192)
	return !sample.includes(0)
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
	const { AddLongTimeLog, Charname } = args
	const executorFor = createArgsExecutorResolver(args)

	const { content } = result
	let regen = false
	const tool_calling_log = {
		name: Charname,
		role: 'char',
		content: '',
		files: [],
	}

	// 设置默认工作目录：<set-workdir machine="..." path="..."></set-workdir>；指定 machine 会替换机器并清除已有 path，
	// 指定 path 会更新路径，两者都留空时回到本机。
	// 就地 mutate args.workdir（chat 经 triggerReply 持久化到 scoped state），并把结果写进 chat_scoped_char_memory
	// （code shell 的会话 memory 经 WS done 回传持久化，后续请求以其覆盖工作区默认）。
	const set_workdir_matches = [...content.matchAll(/<set-workdir(?<attrs>[^>]*?)(?:\/>|>\s*<\/set-workdir>)/g)]
	if (set_workdir_matches.length) {
		for (const set_match of set_workdir_matches) {
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
			AddLongTimeLog({
				name: 'file-operations',
				role: 'tool',
				content: `默认工作目录已更新为机器 ${workdir.machine}${workdir.path ? ` 的 ${workdir.path}` : ''}。`,
				files: [],
			})
		}
		regen = true
	}

	const list_machines_matches = [...content.matchAll(/<list-machines(?<attrs>[^>]*)>(?<content>[^]*?)<\/list-machines>/g)]
	if (list_machines_matches.length) {
		const machines = await listMachines(args.username)
		const content = '可用机器列表：\n' + renderMarkdownCodeBlock(JSON.stringify(machines, null, 2), { lang: 'json' })
		AddLongTimeLog({ name: 'file-operations', role: 'tool', content, files: [] })
		regen = true
	}

	const view_files_matches = [...content.matchAll(/<view-file(?<attrs>[^>]*)>(?<paths>[^]*?)<\/view-file>/g)]
	if (view_files_matches.length) {
		for (const view_match of view_files_matches) {
			const attrs = view_match.groups.attrs
			const paths = view_match.groups.paths.split('\n').map(p => p.trim()).filter(path => path)
			if (!paths.length) continue
			const logContent = '<view-file' + (attrs || '') + '>\n' + paths.join('\n') + '\n</view-file>\n'
			if (!tool_calling_log.content) {
				tool_calling_log.content += logContent
				AddLongTimeLog(tool_calling_log)
			}
			else tool_calling_log.content += logContent

			console.info('AI查看的文件：', paths)
			const target = resolveTarget(args, parseTagAttrs(attrs))
			const executor = executorFor(attrs)
			const files = []
			let file_content = ''
			for (const path of paths)
				try {
					if (path.startsWith('http://') || path.startsWith('https://')) {
						const fileObj = await getFileObjFormPathOrUrl(path)
						if (fileObj.mime_type.startsWith('text/')) {
							const text = fileObj.buffer.toString('utf-8')
							file_content += `文件：${path}\n${renderMarkdownCodeBlock(text, { lang: inferCodeLanguageFromPath(path) })}\n`
						}
						else {
							files.push(fileObj)
							file_content += `文件：${path}读取成功，放置于附件。\n`
						}
						continue
					}
					const buffer = await executor.readFileBuffer(path)
					if (looksLikeText(buffer)) {
						file_content += `文件：${path}\n${renderMarkdownCodeBlock(buffer.toString('utf-8'), { lang: inferCodeLanguageFromPath(path) })}\n`
						// 读取文件时一并向上收集 AGENTS.md 与触发的 .agents/docs 文档
						const context = await collectUpwardContext(executor, target.workdir, path)
						const contextText = formatUpwardContext(context)
						if (contextText) file_content += '随文件一并加载的上下文：\n' + contextText + '\n'
					}
					else {
						files.push({ name: path.split(/[\\/]/).pop() || 'file', buffer, mime_type: 'application/octet-stream' })
						file_content += `文件：${path}读取成功，放置于附件。\n`
					}
				}
				catch (err) {
					file_content += `读取文件失败：${path}\n${renderMarkdownCodeBlock(err.stack || String(err))}\n`
				}

			AddLongTimeLog({ name: 'file-operations', role: 'tool', content: file_content, files })
		}
		regen = true
	}

	const replace_file_matches = [...content.matchAll(/<replace-file(?<attrs>[^>]*)>(?<content>[^]*?)<\/replace-file>/g)]
	for (const replace_match of replace_file_matches) {
		const replace_file_content = replace_match.groups.content
		const logContent = '<replace-file>' + replace_file_content + '</replace-file>\n'
		if (!tool_calling_log.content) {
			tool_calling_log.content += logContent
			AddLongTimeLog(tool_calling_log)
		}
		else tool_calling_log.content += logContent

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

					// Check for regex="true" in attributes. A simple .includes() is robust enough.
					const isRegex = attributes?.includes('regex="true"') ?? false

					fileData.replacements.push({
						// Use trim() to be consistent with the previous XML parser's `trimValues: true` option
						search: search.trim(),
						replace, // Do not trim replace content, as whitespace might be significant
						regex: isRegex
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
			AddLongTimeLog({
				name: 'file-operations',
				role: 'tool',
				content: `解析replace-file失败：\n${renderMarkdownCodeBlock(err.stack || String(err))}\n原始数据:\n<replace-file>${replace_file_content}</replace-file>`,
				files: []
			})
			continue // Continue to next match instead of stopping
		}

		console.info('AI替换的文件：', replace_files_data)
		const executor = executorFor(replace_match.groups.attrs)

		for (const replace_file of replace_files_data) {
			const { path, replacements } = replace_file
			const failed_replaces = []
			let replace_count = 0
			let originalContent
			try {
				originalContent = await executor.readTextFile(path)
			}
			catch (err) {
				AddLongTimeLog({
					name: 'file-operations',
					role: 'tool',
					content: `读取文件失败：${path}\n${renderMarkdownCodeBlock(err.stack || String(err))}\n`,
					files: []
				})
				continue
			}

			let modifiedContent = originalContent

			for (const rep of replacements) {
				const { search, replace, regex } = rep
				try {
					const replaceRegex = regex ? parseRegexFromString(search) : new RegExp(escapeRegExp(search), 'gu')
					const before = modifiedContent
					modifiedContent = modifiedContent.replace(replaceRegex, replace)
					if (before != modifiedContent) replace_count++
				}
				catch (err) {
					console.error(`Replacement failed for path ${path}, search "${search}", regex: ${regex}:`, err)
					failed_replaces.push({ ...rep, error: err.message || String(err) })
				}
			}

			let system_content = ''
			if (originalContent !== modifiedContent) {
				system_content = `文件 ${path} 内容已修改，应用了 ${replacements.length} 项替换`
				if (replace_count > 0) system_content += `，其中 ${replace_count} 个替换成功。\n`
				else system_content += '，但内容未发生实际变化。\n'
			}
			else system_content = `文件 ${path} 内容未发生变化（尝试了 ${replacements.length} 项替换规则）。\n`

			if (failed_replaces.length) {
				system_content += `以下 ${failed_replaces.length} 处替换操作失败：\n`
				system_content += renderMarkdownCodeBlock(JSON.stringify(failed_replaces, null, '\t'), { lang: 'json' }) + '\n'
			}

			if (originalContent !== modifiedContent) {
				system_content += `\n最终文件内容：\n${renderMarkdownCodeBlock(modifiedContent, { lang: inferCodeLanguageFromPath(path) })}\n若和你的预期不一致，考虑重新替换或使用override-file覆写修正。`
				try {
					await executor.writeTextFile(path, modifiedContent)
				}
				catch (err) {
					system_content = `写入文件失败：${path}\n${renderMarkdownCodeBlock(err.stack || String(err))}\n`
				}
			}
			// If content didn't change AND no errors, explicitly state that
			else if (!failed_replaces.length) system_content += '所有替换规则均未匹配到内容或未导致文件变化。'

			AddLongTimeLog({
				name: 'file-operations',
				role: 'tool',
				content: system_content,
				files: []
			})
		}
		regen = true
	}

	const override_file_matches = [...content.matchAll(/<override-file\s+(?<attrs>[^>]*)>(?<content>[^]*?)<\/override-file>/g)]
	for (const override_match of override_file_matches) {
		const overrideAttrs = parseTagAttrs(override_match.groups.attrs)
		const path = overrideAttrs.path
		const overrideContent = override_match.groups.content
		const logContent = `<override-file path="${path}">` + overrideContent + '</override-file>\n'
		if (!tool_calling_log.content) {
			tool_calling_log.content += logContent
			AddLongTimeLog(tool_calling_log)
		}
		else tool_calling_log.content += logContent

		console.info('AI写入的文件：', path, overrideContent)
		try {
			const executor = executorFor(override_match.groups.attrs)
			await executor.writeTextFile(path, overrideContent.trim() + '\n')
			AddLongTimeLog({
				name: 'file-operations',
				role: 'tool',
				content: `文件 ${path} 已写入`,
				files: []
			})
		}
		catch (err) {
			AddLongTimeLog({
				name: 'file-operations',
				role: 'tool',
				content: `写入文件失败：${path}\n${renderMarkdownCodeBlock(err.stack || String(err))}\n`,
				files: []
			})
		}
		regen = true
	}

	return regen
}
