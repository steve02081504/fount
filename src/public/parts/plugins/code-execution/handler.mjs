import { Buffer } from 'node:buffer'
import os from 'node:os'
import path from 'node:path'
import util from 'node:util'

import { async_eval } from 'https://cdn.jsdelivr.net/gh/steve02081504/async-eval/deno.mjs'
import { available, shell_exec_map } from 'npm:@steve02081504/exec'

import { defineInlineToolUses } from '../../shells/chat/src/stream.mjs'

/**
 * 暂停执行指定的毫秒数。
 * @param {number} [ms=100] - 要暂停的毫秒数。
 * @returns {Promise<void>}
 */
async function sleep(ms = 100) {
	return new Promise(resolve => setTimeout(resolve, ms))
}

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
		const fs = await import('node:fs')
		const filePath = resolvePath(pathOrUrl)
		const buffer = fs.readFileSync(filePath)
		const name = path.basename(filePath)
		const mime_type = 'application/octet-stream' // 简化版本，不检测 MIME 类型
		return { name, buffer, mime_type }
	}
}

/**
 * 将输入规范化为一个完整的文件对象。
 * @param {string | {name: string, buffer: Buffer | ArrayBuffer, mime_type?: string}} pathOrFileObj - 输入。
 * @returns {Promise<{name: string, buffer: Buffer, mime_type: string}>} - 规范化后的文件对象。
 */
async function toFileObj(pathOrFileObj) {
	if (Object(pathOrFileObj) instanceof String)
		return getFileObjFormPathOrUrl(pathOrFileObj)

	if (pathOrFileObj instanceof Object && 'name' in pathOrFileObj && 'buffer' in pathOrFileObj) {
		const buffer = Buffer.isBuffer(pathOrFileObj.buffer) ? pathOrFileObj.buffer : Buffer.from(pathOrFileObj.buffer)
		const mime_type = pathOrFileObj.mime_type || 'application/octet-stream'
		return { name: pathOrFileObj.name, buffer, mime_type }
	}
	else
		throw new Error('无效的输入参数。期望为文件路径字符串、URL字符串或包含name和buffer属性的对象。')
}

/** @typedef {import("../../../../decl/pluginAPI.ts").ReplyHandler_t} ReplyHandler_t */
/** @typedef {import("../../../../decl/prompt_struct.ts").prompt_struct_t} prompt_struct_t */
/** @typedef {import("../../../../public/parts/shells/chat/decl/chatLog.ts").chatLogEntry_t} chatLogEntry_t */

/**
 * 处理被执行代码的回调。
 * @param {object} args - 来自原始回复处理程序的参数。
 * @param {string} reason - 回调的原因。
 * @param {string} code - 被执行的代码。
 * @param {any} result - 回调的结果。
 */
async function callback_handler(args, reason, code, result) {
	let logger = args.AddChatLogEntry
	const feedback = {
		role: 'tool',
		name: 'code-execution.callback',
		content: `\
你的js代码中的callback函数被调用了
原因是：${reason}
你此前执行的代码是：
\`\`\`js
${code}
\`\`\`
结果是：${util.inspect(result, { depth: 4 })}
请根据callback函数的内容进行回复。
`,
		charVisibility: [args.char_id],
	}
	try {
		const new_req = await args.Update()
		logger = new_req.AddChatLogEntry
		new_req.chat_log = [...new_req.chat_log, feedback]
		new_req.extension.from_callback = true
		if (new_req.char?.interfaces?.chat?.GetReply) {
			const reply = await new_req.char.interfaces.chat.GetReply(new_req)
			if (reply) {
				reply.logContextBefore ??= []
				reply.logContextBefore.push(feedback)
				await logger({ name: args.Charname ?? args.char_id ?? 'char', ...reply })
			}
		}
		else
			// 如果没有角色的 GetReply，只记录反馈
			logger(feedback)

	}
	catch (error) {
		console.error(`Error processing callback for "${reason}":`, error)
		feedback.content += `处理callback时出错：${error.stack}\n`
		logger(feedback)
	}
}

/**
 * 处理来自 AI 的代码执行请求。
 * @param {chatLogEntry_t} result - 包含AI回复内容和扩展信息的对象。
 * @param {object} args - 包含处理回复所需参数的对象。
 * @type {ReplyHandler_t}
 */
export async function codeExecutionReplyHandler(result, args) {
	const { AddLongTimeLog } = args
	if (!AddLongTimeLog) return false

	result.extension ??= {}
	result.extension.execed_codes ??= {}

	/**
	 * 获取 JS 代码执行的上下文。
	 * @param {string} code - 要执行的代码。
	 * @returns {Promise<object>} - 返回 JS 代码执行的上下文。
	 */
	async function get_js_eval_context(code) {
		if (!args.chat_scoped_char_memory) args.chat_scoped_char_memory = {}
		if (!args.chat_scoped_char_memory.coderunner_workspace) args.chat_scoped_char_memory.coderunner_workspace = {}
		const js_eval_context = {
			workspace: args.chat_scoped_char_memory.coderunner_workspace,
			chat_log: args.chat_log,
		}
		/**
		 * 清空工作区。
		 */
		function clear_workspace() {
			js_eval_context.workspace = args.chat_scoped_char_memory.coderunner_workspace = {}
			js_eval_context.workspace.clear = clear_workspace
		}
		js_eval_context.clear_workspace = clear_workspace
		if (args.supported_functions?.add_message)
			/**
			 * @param {string} reason - 回调原因。
			 * @param {Promise<any>} promise - 相关的 Promise 对象。
			 * @returns {void}
			 */
			js_eval_context.callback = (reason, promise) => {
				if (!js_eval_context.eval_result && !(promise instanceof Promise))
					throw new Error('callback函数的第二个参数必须是一个Promise对象')
				/**
				 *
				 * @param {any} _ - 占位符参数。
				 * @returns {void}
				 */
				const _ = _ => callback_handler(args, reason, code, _)
				Promise.resolve(promise).then(_, _)
				return 'callback已注册'
			}
		const view_files = []
		let view_files_flag = false
		/**
		 *
		 * @param {...any} pathOrFileObjs - 文件路径或文件对象。
		 * @returns {Promise<void>}
		 */
		js_eval_context.view_files = async (...pathOrFileObjs) => {
			const errors = []
			for (const pathOrFileObj of pathOrFileObjs) try {
				view_files.push(await toFileObj(pathOrFileObj))
			} catch (e) { errors.push(e) }
			if (!view_files_flag)
				AddLongTimeLog(view_files_flag = {
					role: 'tool',
					name: 'code-execution.view_files',
					content: '你需要查看的文件在此。',
					files: view_files
				})
			if (errors.length == 1) throw errors[0]
			if (errors.length) throw errors
			return '文件已查看'
		}
		let sent_files
		if (args.supported_functions?.files)
			/**
			 * 在eval时添加文件
			 * @param {...any} pathOrFileObjs - 文件路径或文件对象。
			 * @returns {Promise<void>}
			 */
			js_eval_context.add_files = async (...pathOrFileObjs) => {
				const errors = []
				for (const pathOrFileObj of pathOrFileObjs) try {
					if (!result.files) result.files = []
					result.files.push(await toFileObj(pathOrFileObj))
				} catch (e) { errors.push(e) }
				if (!sent_files)
					AddLongTimeLog(sent_files = {
						role: 'tool',
						name: 'code-execution.add_files',
						content: '文件已发送，内容见附件。',
						files: result.files
					})
				if (errors.length == 1) throw errors[0]
				if (errors.length) throw errors
				return '文件已发送'
			}

		// 从其他插件获取 JS 代码上下文
		const pluginContexts = (
			await Promise.all(
				Object.values(args.plugins || {}).map(plugin =>
					plugin.interfaces?.code_execution?.GetJSCodeContext?.(args)
				)
			)
		).filter(Boolean)
		return Object.assign(js_eval_context, ...pluginContexts)
	}

	/**
	 * 为 AI 运行 JS 代码。
	 * @param {string} code - 要运行的代码。
	 * @returns {Promise<any>} - 返回代码执行的结果。
	 */
	async function run_jscode_for_AI(code) {
		return async_eval(code, await get_js_eval_context(code))
	}

	const content = result?.content ?? ''
	// 将 run-* 作为步骤，按在 content 中的出现顺序排列
	const steps = []
	for (const m of content.matchAll(/<run-js>(?<code>[^]*?)<\/run-js>/g))
		steps.push({ index: m.index, type: 'run', runType: 'js', code: m.groups.code, fullText: m[0] })
	for (const shell_name in shell_exec_map) {
		if (!available[shell_name]) continue
		const re = new RegExp(`<run-${shell_name}>(?<code>[^]*?)<\\/run-${shell_name}>`, 'g')
		for (const m of content.matchAll(re))
			steps.push({ index: m.index, type: 'run', runType: shell_name, code: m.groups.code, fullText: m[0] })
	}
	steps.sort((a, b) => a.index - b.index)

	let processed = false
	if (steps.length > 0)
		AddLongTimeLog({
			name: args.Charname ?? args.char_id ?? 'char',
			role: 'char',
			content: steps.map(s => s.fullText).join('\n'),
			files: []
		})

	// 按步骤顺序执行代码
	for (const step of steps) {
		const toolEntry = {
			name: 'code-execution',
			role: 'tool',
			content: '',
			files: []
		}
		if (step.runType === 'js') {
			console.info('AI运行的JS代码：', step.code)
			const coderesult = await run_jscode_for_AI(step.code)
			console.info('coderesult', coderesult)
			toolEntry.content = '执行结果：\n' + util.inspect(coderesult, { depth: 4 })
			result.extension.execed_codes[step.code] = coderesult
		}
		else {
			const shell_name = step.runType
			console.info(`AI运行的${shell_name}代码：`, step.code)
			let shell_result
			try { shell_result = await shell_exec_map[shell_name](step.code, { no_ansi_terminal_sequences: true }) } catch (err) { shell_result = err }
			result.extension.execed_codes[step.code] = shell_result
			if (shell_result.stdall)
				for (const key of ['stdout', 'stderr'])
					delete shell_result[key]
			console.info(`${shell_name} result`, shell_result)
			toolEntry.content = '执行结果：\n' + util.inspect(shell_result)
		}
		AddLongTimeLog(toolEntry)
		processed = true
	}

	// inline js code
	// 这个和其他的不一样，我们需要执行js代码并将结果以string替换代码块
	if (content.match(/<inline-js>[^]*?<\/inline-js>/)) try {
		const original = result.content
		const cachedResults = args.extension?.streamInlineToolsResults?.['inline-js']

		let replacements
		if (cachedResults?.length)
			replacements = cachedResults.map(res => {
				if (res instanceof Error) throw res
				return res
			})
		else
			// 古法计算
			replacements = await Promise.all(
				Array.from(content.matchAll(/<inline-js>(?<code>[^]*?)<\/inline-js>/g))
					.map(async match => {
						const jsrunner = match.groups.code
						console.info('AI内联运行的JS代码：', jsrunner)
						const coderesult = await run_jscode_for_AI(jsrunner)
						console.info('coderesult', coderesult)
						if (coderesult.error) throw coderesult.error
						return coderesult.result + ''
					})
			)

		let i = 0
		result.logContextBefore ??= []
		result.logContextBefore.push({
			name: args.Charname ?? args.char_id ?? 'char',
			role: 'char',
			content: original,
			files: result.files,
			charVisibility: [args.char_id],
		}, {
			name: 'code-execution',
			role: 'tool',
			content: '内联js代码执行和替换完毕\n',
			files: [],
			charVisibility: [args.char_id],
		})
		result.content = result.content.replace(/<inline-js>(?<code>[^]*?)<\/inline-js>/g, () => replacements[i++])
	}
	catch (error) {
		console.error('内联js代码执行失败：', error)
		AddLongTimeLog({
			name: args.Charname ?? args.char_id ?? 'char',
			role: 'char',
			content: result.content,
			files: result.files,
		})
		AddLongTimeLog({
			name: 'code-execution',
			role: 'tool',
			content: '内联js代码执行失败：\n' + error.stack,
			files: []
		})
		processed = true
	}

	for (const shell_name in shell_exec_map) {
		if (!available[shell_name]) continue
		const runner_regex = new RegExp(`<inline-${shell_name}>[^]*?<\\/inline-${shell_name}>`)
		if (content.match(runner_regex)) try {
			const original = result.content
			const cachedResults = args.extension?.streamInlineToolsResults?.[`inline-${shell_name}`]

			let replacements
			if (cachedResults?.length)
				replacements = cachedResults.map(res => {
					if (res instanceof Error) throw res
					return res
				})
			else {
				// 古法计算
				const runner_regex_g = new RegExp(`<inline-${shell_name}>(?<code>[^]*?)<\\/inline-${shell_name}>`, 'g')
				replacements = await Promise.all(
					Array.from(content.matchAll(runner_regex_g))
						.map(async match => {
							const runner = match.groups.code
							console.info(`AI内联运行的${shell_name}代码：`, runner)
							let shell_result
							try {
								shell_result = await shell_exec_map[shell_name](runner, { no_ansi_terminal_sequences: true })
							} catch (err) {
								shell_result = err
							}

							if (shell_result instanceof Error) throw shell_result

							if (shell_result.code)
								throw new Error(`${shell_name} execution of code '${runner}' failed with exit code ${shell_result.exitCode}:\n${util.inspect(shell_result)}`)

							return shell_result.stdout.trim()
						})
				)
			}

			let i = 0
			result.logContextBefore ??= []
			result.logContextBefore.push({
				name: args.Charname ?? args.char_id ?? 'char',
				role: 'char',
				content: original,
				files: result.files,
				charVisibility: [args.char_id],
			}, {
				name: 'code-execution',
				role: 'tool',
				content: `内联${shell_name}代码执行和替换完毕\n`,
				files: [],
				charVisibility: [args.char_id],
			})
			const runner_regex_g = new RegExp(`<inline-${shell_name}>(?<code>[^]*?)<\\/inline-${shell_name}>`, 'g')
			result.content = result.content.replace(runner_regex_g, () => replacements[i++])
		}
		catch (error) {
			console.error(`内联${shell_name}代码执行失败：`, error)
			AddLongTimeLog({
				name: args.Charname ?? args.char_id ?? 'char',
				role: 'char',
				content: result.content,
				files: result.files,
			})
			AddLongTimeLog({
				name: 'code-execution',
				role: 'tool',
				content: `内联${shell_name}代码执行失败：\n` + error.stack,
				files: []
			})
			processed = true
		}
	}

	return processed
}

/**
 * 获取代码运行器的预览更新器。
 * @param {import("../../../../decl/public/shells/chat/decl/chatLog.ts").CharReplyPreviewUpdater_t} [next] - 上一个更新器。
 * @returns {import("../../../../decl/public/shells/chat/decl/chatLog.ts").CharReplyPreviewUpdater_t} - 新的更新器。
 */
export function GetCodeExecutionPreviewUpdater(next) {
	const toolDefs = [
		['inline-js', '<inline-js>', '</inline-js>', async (code) => {
			const jsrunner = code
			const coderesult = await async_eval(jsrunner, {})
			if (coderesult.error) throw coderesult.error
			return coderesult.result + ''
		}]
	]

	// 添加所有可用的 shell 内联工具
	for (const shell_name in shell_exec_map) {
		if (!available[shell_name]) continue
		toolDefs.push([
			`inline-${shell_name}`,
			`<inline-${shell_name}>`,
			`</inline-${shell_name}>`,
			async (code) => {
				const runner = code
				let shell_result
				try {
					shell_result = await shell_exec_map[shell_name](runner, { no_ansi_terminal_sequences: true })
				} catch (err) {
					shell_result = err
				}

				if (shell_result instanceof Error) throw shell_result

				if (shell_result.code)
					throw new Error(`${shell_name} execution of code '${runner}' failed with exit code ${shell_result.exitCode}`)

				return shell_result.stdout.trim()
			}
		])
	}

	return defineInlineToolUses(toolDefs)(next)
}
