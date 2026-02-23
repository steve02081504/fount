import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

/**
 * 解析相对路径，支持 `~` (home) 和 MSYS 风格的路径。
 * @param {string} relativePath - 要解析的相对路径。
 * @returns {string} - 解析后的绝对路径。
 */
function resolvePath(relativePath) {
	if (relativePath.startsWith('~'))
		return path.resolve(path.join(os.homedir(), relativePath.slice(1)))
	const msys_path = process.env.MSYS_ROOT_PATH
	if (msys_path && relativePath.startsWith('/')) {
		if (relativePath.match(/^\/[A-Za-z]\//))
			return path.resolve(path.join(relativePath.slice(1, 2).toUpperCase() + ':\\', relativePath.slice(3)))
		return path.resolve(path.join(msys_path, relativePath))
	}
	return path.resolve(relativePath)
}

/**
 * 转义正则表达式特殊字符。
 * @param {string} str - 要转义的字符串。
 * @returns {string} - 转义后的字符串。
 */
function escapeRegExp(str) {
	return str.replace(/[$()*+.?[\\\]^{|}]/g, '\\$&')
}

/**
 * 从字符串解析正则表达式。
 * @param {string} regexString - 正则表达式字符串。
 * @returns {RegExp} - 解析后的正则表达式。
 */
function parseRegexFromString(regexString) {
	const match = regexString.match(/^\/(.+)\/([gimsuy]*)$/)
	if (match) {
		const [, pattern, flags] = match
		return new RegExp(pattern, flags)
	}
	return new RegExp(regexString, 'gu')
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
		const filePath = resolvePath(pathOrUrl)
		const buffer = fs.readFileSync(filePath)
		const name = path.basename(filePath)
		const mime_type = 'application/octet-stream' // 简化版本，不检测 MIME 类型
		return { name, buffer, mime_type }
	}
}
/** @typedef {import("../../../../decl/pluginAPI.ts").ReplyHandler_t} ReplyHandler_t */
/** @typedef {import("../../../../decl/public/shells/chat/decl/chatLog.ts").chatLogEntry_t} chatLogEntry_t */

/**
 * 处理来自 AI 的文件更改请求。
 * @type {ReplyHandler_t}
 */
export async function fileOperationsReplyHandler(result, { AddLongTimeLog }) {
	if (!AddLongTimeLog) return false

	const content = result?.content ?? ''
	let regen = false
	const tool_calling_log = {
		name: result.name ?? 'char',
		role: 'char',
		content: ''
	}

	const view_files_matches = [...content.matchAll(/<view-file>(?<paths>[^]*?)<\/view-file>/g)]
	if (view_files_matches.length) {
		const paths = view_files_matches.flatMap(match => match.groups.paths.split('\n').map(p => p.trim()).filter(path => path))
		if (paths.length) {
			const logContent = '<view-file>\n' + paths.join('\n') + '\n</view-file>\n'
			if (!tool_calling_log.content) {
				tool_calling_log.content += logContent
				AddLongTimeLog(tool_calling_log) // Add log only once if it wasn't added before
			}
			else tool_calling_log.content += logContent // Append if already added

			console.info('AI查看的文件：', paths)
			const files = []
			let file_content = ''
			for (const path of paths)
				try {
					const fileObj = await getFileObjFormPathOrUrl(path)
					if (fileObj.mime_type.startsWith('text/')) {
						const content = await fs.promises.readFile(resolvePath(path), 'utf-8')
						file_content += `文件：${path}\n\`\`\`\n${content}\n\`\`\`\n`
					}
					else {
						files.push(fileObj)
						file_content += `文件：${path}读取成功，放置于附件。\n`
					}
				}
				catch (err) {
					file_content += `读取文件失败：${path}\n\`\`\`\n${err.stack}\n\`\`\`\n`
				}

			AddLongTimeLog({
				name: 'file-operations',
				role: 'tool',
				content: file_content,
				files
			})
		}
		regen = true
	}

	const replace_file_matches = [...content.matchAll(/<replace-file>(?<content>[^]*?)<\/replace-file>/g)]
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
				content: `解析replace-file失败：\n\`\`\`\n${err}\n\`\`\`\n原始数据:\n<replace-file>${replace_file_content}</replace-file>`,
				files: []
			})
			continue // Continue to next match instead of stopping
		}

		console.info('AI替换的文件：', replace_files_data)

		for (const replace_file of replace_files_data) {
			const { path, replacements } = replace_file
			const failed_replaces = []
			let replace_count = 0
			let originalContent
			try {
				originalContent = await fs.promises.readFile(resolvePath(path), 'utf-8')
			}
			catch (err) {
				AddLongTimeLog({
					name: 'file-operations',
					role: 'tool',
					content: `读取文件失败：${path}\n\`\`\`\n${err.stack}\n\`\`\`\n`,
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
				system_content += '```json\n' + JSON.stringify(failed_replaces, null, '\t') + '\n```\n'
			}

			if (originalContent !== modifiedContent) {
				system_content += `\n最终文件内容：\n\`\`\`\n${modifiedContent}\n\`\`\`\n若和你的预期不一致，考虑重新替换或使用override-file覆写修正。`
				try {
					await fs.promises.writeFile(resolvePath(path), modifiedContent, 'utf-8')
				}
				catch (err) {
					system_content = `写入文件失败：${path}\n\`\`\`\n${err.stack}\n\`\`\`\n`
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

	const override_file_matches = [...content.matchAll(/<override-file\s+path="(?<path>[^"]+)">(?<content>[^]*?)<\/override-file>/g)]
	for (const override_match of override_file_matches) {
		const { path, content: overrideContent } = override_match.groups
		const logContent = `<override-file path="${path}">` + overrideContent + '</override-file>\n'
		if (!tool_calling_log.content) {
			tool_calling_log.content += logContent
			AddLongTimeLog(tool_calling_log)
		}
		else tool_calling_log.content += logContent

		console.info('AI写入的文件：', path, overrideContent)
		try {
			await fs.promises.writeFile(resolvePath(path), overrideContent.trim() + '\n', 'utf-8')
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
				content: `写入文件失败：${path}\n\`\`\`\n${err.stack}\n\`\`\`\n`,
				files: []
			})
		}
		regen = true
	}

	return regen
}
