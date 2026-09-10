import { Buffer } from 'node:buffer'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import util from 'node:util'

import { async_eval } from 'npm:@steve02081504/async-eval'
import { available, shell_exec_map } from 'npm:@steve02081504/exec'

import {
	createCollectingConsole,
	formatElapsed,
	formatTimeoutNotice,
	guardOutput,
	JS_DEFAULT_TIMEOUT_MS,
	parseRunLimits,
	runJsWithTimeout,
	SHELL_DEFAULT_TIMEOUT_MS,
	OUTPUT_GUARD_LIMIT,
} from '../../../../scripts/shell_guard.mjs'
import { getChatI18n, renderMarkdownCodeBlock, renderMarkdownInlineCode, defineInlineToolUses, defineToolUseBlocks } from '../../shells/chat/src/streaming/index.mjs'
import { createArgsExecutorResolver, parseTagAttrs, resolveTarget } from '../file-operations/src/target.mjs'

/**
 * 按预览参数缓存执行器解析器（GetCodeExecutionPreviewUpdater 流式内联执行用）。
 * @type {WeakMap<object, ReturnType<typeof createArgsExecutorResolver>>}
 */
const previewExecutorResolvers = new WeakMap()

/**
 * 构建内联工具执行卡（代码 + 结果，供人类 content_for_show）。
 * @param {Array<{code: string, result?: string}>} items - 执行项。
 * @param {string} lang - 语言标签。
 * @returns {string} Markdown 卡片文本。
 */
function buildInlineToolCard(items, lang) {
	return items.map(({ code, result }) =>
		renderMarkdownCodeBlock(code, { lang }) + '\n\n结果：\n\n' + renderMarkdownCodeBlock(result ?? '')
	).join('\n\n')
}

/**
 * 带语法高亮地将代码输出到控制台，失败时静默降级为普通输出。
 * @param {string} label - 日志前缀。
 * @param {string} code - 要输出的代码。
 * @param {string} [lang] - 语言标识，不传时自动检测。
 */
async function logCode(label, code, lang) {
	try {
		const { highlight } = await import('npm:cli-highlight')
		console.info(label + '\n' + highlight(code, { language: lang, ignoreIllegals: true }))
	}
	catch { console.info(label, code) }
}

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

	const buffer = Buffer.isBuffer(pathOrFileObj.buffer) ? pathOrFileObj.buffer : Buffer.from(pathOrFileObj.buffer)
	const mime_type = pathOrFileObj.mime_type || 'application/octet-stream'
	return { name: pathOrFileObj.name, buffer, mime_type }
}

/**
 * 回复处理器类型别名。
 * @typedef {import("../../../../decl/pluginAPI.ts").ReplyHandler_t} ReplyHandler_t
 */
/**
 * 结构化提示类型别名。
 * @typedef {import("../../../../decl/prompt_struct.ts").prompt_struct_t} prompt_struct_t
 */
/**
 * 聊天记录条目类型别名。
 * @typedef {import("../../../../public/parts/shells/chat/decl/chatLog.ts").chatLogEntry_t} chatLogEntry_t
 */

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
		uid: 'system',
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
		const reply = await new_req.char.interfaces.chat.GetReply(new_req)
		if (reply) {
			reply.logContextBefore ??= []
			reply.logContextBefore.push(feedback)
			await logger({ name: args.Charname, ...reply })
		}

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
	const executorFor = createArgsExecutorResolver(args)

	result.extension ??= {}
	result.extension.execed_codes ??= {}

	/**
	 * 获取 JS 代码执行的上下文。
	 * @param {string} code - 要执行的代码。
	 * @param {object} [evalConsole] - 收集型 console（超时后回读部分输出）。
	 * @returns {Promise<object>} - 返回 JS 代码执行的上下文。
	 */
	async function get_js_eval_context(code, evalConsole) {
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
			 * 注册回调函数。
			 * @param {string} reason - 回调原因。
			 * @param {Promise<any>} promise - 相关的 Promise 对象。
			 * @returns {void}
			 */
			js_eval_context.callback = (reason, promise) => {
				if (!(promise instanceof Promise))
					throw new Error('callback函数的第二个参数必须是一个Promise对象')
				/**
				 * 处理回调函数。
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
		 * 查看文件。
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
			 * 在eval时添加文件。
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
		Object.assign(js_eval_context, ...pluginContexts)
		if (evalConsole) js_eval_context.console = evalConsole
		return js_eval_context
	}

	/**
	 * 为 AI 运行 JS 代码。
	 * @param {string} code - 要运行的代码。
	 * @param {object} [evalConsole] - 收集型 console。
	 * @returns {Promise<any>} - 返回代码执行的结果。
	 */
	async function run_jscode_for_AI(code, evalConsole) {
		return async_eval(code, await get_js_eval_context(code, evalConsole))
	}

	// 在独立工作副本上解析并掩除已处理调用段，不改写原始生成
	/**
	 * 取当前解析用的工作副本。
	 * @returns {string} 优先 content_for_handle，缺失时回退原始生成。
	 */
	const getContent = () => result.content_for_handle
	// 将 run-* 作为步骤，按在 content 中的出现顺序排列
	const steps = []
	for (const m of getContent().matchAll(/<run-js(?<attrs>[^>]*)>(?<code>[^]*?)<\/run-js>/g))
		steps.push({ index: m.index, type: 'run', runType: 'js', code: m.groups.code, attrs: m.groups.attrs, fullText: m[0] })
	for (const shell_name in shell_exec_map) {
		if (!available[shell_name]) continue
		const re = new RegExp(`<run-${shell_name}(?<attrs>[^>]*)>(?<code>[^]*?)<\\/run-${shell_name}>`, 'g')
		for (const m of getContent().matchAll(re))
			steps.push({ index: m.index, type: 'run', runType: shell_name, code: m.groups.code, attrs: m.groups.attrs, fullText: m[0] })
	}
	steps.sort((a, b) => a.index - b.index)
	for (const step of steps) args.MaskHandledCall?.(step.fullText)

	let processed = false

	// 按步骤顺序执行代码
	for (const step of steps) {
		const toolEntry = {
			name: `code-execution.run-${step.runType}`,
			role: 'tool',
			content: '',
			files: []
		}
		const attrs = parseTagAttrs(step.attrs)
		const target = resolveTarget(args, attrs)
		const remote = Boolean(target.remote)
		if (step.runType === 'js') {
			await logCode(`${args.Charname} running JS code:`, step.code, 'js')
			const limits = parseRunLimits(attrs, JS_DEFAULT_TIMEOUT_MS)
			// 显式指定目标或请求级目标为远程机器时走执行器（无本地聊天上下文）；本地注入收集型 console 以回读超时前输出
			const collecting = createCollectingConsole()
			const { evalResult, timedOut, elapsedMs } = remote
				? await runJsWithTimeout(() => executorFor(attrs).execJsWithTimeout(step.code, limits.timeoutMs), limits.timeoutMs)
				: await runJsWithTimeout(() => run_jscode_for_AI(step.code, collecting.console), limits.timeoutMs)
			console.info(`${args.Charname} JS result:`, evalResult, timedOut ? '(timed out)' : '')
			result.extension.execed_codes[step.code] = evalResult ?? { timedOut: true }
			const elapsedText = formatElapsed(elapsedMs)
			let fullOutput
			if (timedOut) {
				fullOutput = `执行超时（耗时 ${elapsedText}）：JS 无法强制终止，代码可能仍在后台运行。`
				const partial = collecting.text()
				if (partial) fullOutput += `\n超时前捕获的输出：\n${partial}`
			}
			else if (evalResult?.error)
				fullOutput = '执行出错：\n' + (evalResult.error.stack || String(evalResult.error))
			else
				fullOutput = '执行结果：\n' + util.inspect(evalResult, { depth: 4 }) + (elapsedText ? `\n（耗时 ${elapsedText}）` : '')
			fullOutput += formatTimeoutNotice({ timedOut, elapsedMs, waitForever: limits.waitForever, expectMs: limits.expectMs, toleranceMs: limits.toleranceMs, kind: 'js' })
			const guarded = await guardOutput(fullOutput, { name: 'run-js', label: 'JS 结果' })
			toolEntry.content = '执行结果：\n' + guarded.text
			toolEntry.content_for_show = renderMarkdownCodeBlock(step.code, { lang: 'js' }) + '\n\n执行结果：\n' + fullOutput
		}
		else {
			const shell_name = step.runType
			await logCode(`${args.Charname} running ${shell_name} code:`, step.code, shell_name)
			const limits = parseRunLimits(attrs, SHELL_DEFAULT_TIMEOUT_MS)
			let shell_result
			try { shell_result = await executorFor(step.attrs).execShell(shell_name, step.code, { timeoutMs: limits.timeoutMs }) } catch (err) { shell_result = err }
			result.extension.execed_codes[step.code] = shell_result
			console.info(`${args.Charname} ${shell_name} result:`, shell_result)
			const elapsedText = shell_result?.elapsedMs ? formatElapsed(shell_result.elapsedMs) : ''
			const timedOut = Boolean(shell_result?.timedOut)
			let fullOutput
			if (shell_result instanceof Error)
				fullOutput = '执行出错：\n' + (shell_result.stack || String(shell_result))
			else {
				const output = shell_result?.stdall ?? [shell_result?.stdout, shell_result?.stderr].filter(Boolean).join('\n') ?? ''
				const header = `退出码 ${shell_result?.code ?? '(无)'}${shell_result?.signal ? `，信号 ${shell_result.signal}` : ''}${timedOut ? '（超时）' : ''}${elapsedText ? `，耗时 ${elapsedText}` : ''}：`
				fullOutput = header + '\n' + output
			}
			fullOutput += formatTimeoutNotice({
				timedOut, elapsedMs: shell_result?.elapsedMs ?? 0, waitForever: limits.waitForever,
				expectMs: limits.expectMs, toleranceMs: limits.toleranceMs, kind: 'shell',
				killed: shell_result?.killed, remote,
			})
			const guarded = await guardOutput(fullOutput, { name: `shell-${shell_name}`, label: 'shell 输出' })
			toolEntry.content = '执行结果：\n' + guarded.text
			toolEntry.content_for_show = renderMarkdownCodeBlock(step.code, { lang: shell_name }) + '\n\n执行结果：\n' + fullOutput
		}
		AddLongTimeLog(toolEntry)
		processed = true
	}

	// inline js code
	// 这个和其他的不一样，我们需要执行js代码并将结果写入人类展示层（不改写原始生成）
	const inline_js_regex = /<inline-js[^>]*>(?<code>[^]*?)<\/inline-js>/g
	if (getContent().match(/<inline-js[^>]*>[^]*?<\/inline-js>/)) {
		const inlineMatches = Array.from(getContent().matchAll(inline_js_regex))
		for (const inline_match of inlineMatches) args.MaskHandledCall?.(inline_match[0])
		try {
			const cachedResults = args.extension?.streamInlineToolsResults?.['inline-js']

			let replacements
			if (cachedResults?.length)
				replacements = await Promise.all(cachedResults.map(res => {
					if (res instanceof Error) throw res
					return res
				}))
			else
				// 古法计算
				replacements = await Promise.all(
					inlineMatches.map(async match => {
						const jsrunner = match.groups.code
						await logCode(`${args.Charname} running inline JS code:`, jsrunner, 'js')
						const attrs = parseTagAttrs(match.groups.attrs)
						const target = resolveTarget(args, attrs)
						const limits = parseRunLimits(attrs, JS_DEFAULT_TIMEOUT_MS)
						const remote = Boolean(target.remote)
						const collecting = createCollectingConsole()
						const { evalResult, timedOut } = remote
							? await runJsWithTimeout(() => executorFor(attrs).execJsWithTimeout(jsrunner, limits.timeoutMs), limits.timeoutMs)
							: await runJsWithTimeout(() => run_jscode_for_AI(jsrunner, collecting.console), limits.timeoutMs)
						console.info(`${args.Charname} inline JS result:`, evalResult, timedOut ? '(timed out)' : '')
						if (timedOut) throw new Error('内联 JS 执行超时；JS 无法强制终止，代码可能仍在运行。' + (collecting.text() ? `\n超时前输出：\n${collecting.text()}` : ''))
						if (evalResult?.error) throw evalResult.error
						if (remote) return String(evalResult ?? '')
						return evalResult.result + ''
					})
				)

			// 人类展示层兜底：上游未设 content_for_show 时以原始生成为底再替换内联结果
			result.content_for_show ??= result.content
			let j = 0
			result.content_for_show = result.content_for_show.replace(inline_js_regex, () => replacements[j++])
			AddLongTimeLog({
				name: 'code-execution.inline-js',
				role: 'tool',
				content: '内联js代码执行和替换完毕\n',
				content_for_show: buildInlineToolCard(inlineMatches.map((m, index) => ({ code: m.groups.code, result: replacements[index] })), 'js'),
				files: [],
				charVisibility: [args.char_id],
			})
		}
		catch (error) {
			console.error('内联js代码执行失败：', error)
			AddLongTimeLog({
				name: 'code-execution.inline-js',
				role: 'tool',
				content: '内联js代码执行失败：\n' + error.stack,
				files: []
			})
			processed = true
		}
	}

	for (const shell_name in shell_exec_map) {
		if (!available[shell_name]) continue
		const runner_regex = new RegExp(`<inline-${shell_name}[^>]*>[^]*?<\\/inline-${shell_name}>`)
		if (getContent().match(runner_regex)) {
			const runner_regex_g = new RegExp(`<inline-${shell_name}(?<attrs>[^>]*)>(?<code>[^]*?)<\\/inline-${shell_name}>`, 'g')
			const inlineMatches = Array.from(getContent().matchAll(runner_regex_g))
			for (const inline_match of inlineMatches) args.MaskHandledCall?.(inline_match[0])
			try {
				const cachedResults = args.extension?.streamInlineToolsResults?.[`inline-${shell_name}`]

				let replacements
				if (cachedResults?.length)
					replacements = await Promise.all(cachedResults.map(res => {
						if (res instanceof Error) throw res
						return res
					}))
				else
					// 古法计算
					replacements = await Promise.all(
						inlineMatches.map(async match => {
							const runner = match.groups.code
							await logCode(`${args.Charname} running inline ${shell_name} code:`, runner, shell_name)
							const limits = parseRunLimits(parseTagAttrs(match.groups.attrs), SHELL_DEFAULT_TIMEOUT_MS)
							let shell_result
							try {
								shell_result = await executorFor(match.groups.attrs).execShell(shell_name, runner, { timeoutMs: limits.timeoutMs })
							} catch (err) {
								shell_result = err
							}

							if (shell_result instanceof Error) throw shell_result

							if (shell_result.timedOut)
								throw new Error(`${shell_name} inline execution timed out; the process tree was terminated. Use <run-${shell_name}> for long commands.`)

							if (shell_result.code)
								throw new Error(`${shell_name} execution of code '${runner}' failed with exit code ${shell_result.code}:\n${util.inspect(shell_result)}`)

							const stdout = String(shell_result.stdout ?? '')
							if (stdout.length > OUTPUT_GUARD_LIMIT)
								throw new Error(`内联 ${shell_name} 输出过大（${stdout.length} 字符）；内联结果会直接插入消息，请改用 <run-${shell_name}>，其大输出会自动落盘。`)

							return stdout.trim()
						})
					)

				// 人类展示层兜底：上游未设 content_for_show 时以原始生成为底再替换内联结果
				result.content_for_show ??= result.content
				let j = 0
				result.content_for_show = result.content_for_show.replace(runner_regex_g, () => replacements[j++])
				AddLongTimeLog({
					name: `code-execution.inline-${shell_name}`,
					role: 'tool',
					content: `内联${shell_name}代码执行和替换完毕\n`,
					content_for_show: buildInlineToolCard(inlineMatches.map((m, index) => ({ code: m.groups.code, result: replacements[index] })), shell_name),
					files: [],
					charVisibility: [args.char_id],
				})
			}
			catch (error) {
				console.error(`内联${shell_name}代码执行失败：`, error)
				AddLongTimeLog({
					name: `code-execution.inline-${shell_name}`,
					role: 'tool',
					content: `内联${shell_name}代码执行失败：\n` + error.stack,
					files: []
				})
				processed = true
			}
		}
	}

	return processed
}

/**
 * 获取代码运行器的预览更新器。
 * @param {import("../../../../../src/public/parts/shells/chat/decl/chatLog.ts").CharReplyPreviewUpdater_t} [next] - 上一个更新器。
 * @returns {import("../../../../../src/public/parts/shells/chat/decl/chatLog.ts").CharReplyPreviewUpdater_t} - 新的更新器。
 */
export function GetCodeExecutionPreviewUpdater(next) {
	/**
	 * 将代码渲染为“正在执行语言”的展开代码块。
	 * @param {string} code - 代码内容。
	 * @param {string} lang - 语言标签。
	 * @param {object} args - 预览更新参数。
	 * @returns {string} 渲染后的 Markdown 代码块。
	 */
	function renderRunningCodeBlock(code, lang, args) {
		return renderMarkdownCodeBlock(code, {
			lang,
			title: getChatI18n(args, 'chat.message.view.tool.runningLang', { lang })
		})
	}

	/**
	 * 渲染 inline-js 未闭合或待执行内容。
	 * @param {string} code - inline 代码。
	 * @param {object} args - 预览更新参数。
	 * @returns {string} 渲染后的 Markdown 内容。
	 */
	function renderInlineJsPending(code, args) {
		if (/[\n\r]/.test(code))
			return renderRunningCodeBlock(code, 'js', args)
		return renderMarkdownInlineCode(code, 'js')
	}

	const toolDefs = [
		['inline-js', /<inline-js(?<attrs>[^>]*)>/, '</inline-js>', async (code, previewArgs, meta) => {
			const attrs = parseTagAttrs(meta?.match?.groups?.attrs)
			const target = resolveTarget(previewArgs, attrs)
			const limits = parseRunLimits(attrs, JS_DEFAULT_TIMEOUT_MS)
			const remote = Boolean(target.remote)
			const collecting = createCollectingConsole()
			let outcome
			if (remote) {
				const resolver = previewExecutorResolvers.get(previewArgs) ?? previewExecutorResolvers.set(previewArgs, createArgsExecutorResolver(previewArgs)).get(previewArgs)
				outcome = await runJsWithTimeout(() => resolver(attrs).execJsWithTimeout(code, limits.timeoutMs), limits.timeoutMs)
			}
			else
				outcome = await runJsWithTimeout(() => async_eval(code, { console: collecting.console }), limits.timeoutMs)
			if (outcome.timedOut) throw new Error('内联 JS 执行超时；JS 无法强制终止，代码可能仍在运行。')
			const coderesult = outcome.evalResult
			if (coderesult?.error) throw coderesult.error
			if (remote) return String(coderesult ?? '')
			return coderesult.result + ''
		}, renderInlineJsPending]
	]
	const runBlocks = [
		{
			start: /<run-js[^>]*>/,
			end: '</run-js>',
			/**
			 * 渲染 `<run-js>` 未闭合或待执行内容。
			 * @param {string} code - 代码块内容。
			 * @param {object} args - 预览更新参数。
			 * @returns {string} 渲染后的 Markdown 内容。
			 */
			renderPending: (code, args) => renderRunningCodeBlock(code, 'js', args),
		}
	]

	// 添加所有可用的 shell 内联工具
	for (const shell_name in shell_exec_map) {
		if (!available[shell_name]) continue
		/**
		 * 渲染 inline-shell 未闭合或待执行内容。
		 * @param {string} code - inline 代码。
		 * @param {object} args - 预览更新参数。
		 * @returns {string} 渲染后的 Markdown 内容。
		 */
		const renderInlineShellPending = (code, args) => {
			if (/[\n\r]/.test(code))
				return renderRunningCodeBlock(code, shell_name, args)
			return renderMarkdownInlineCode(code, shell_name)
		}
		runBlocks.push({
			start: new RegExp(`<run-${shell_name}[^>]*>`),
			end: `</run-${shell_name}>`,
			/**
			 * 渲染 `<run-*>` shell 块未闭合或待执行内容。
			 * @param {string} code - 代码块内容。
			 * @param {object} args - 预览更新参数。
			 * @returns {string} 渲染后的 Markdown 内容。
			 */
			renderPending: (code, args) => renderRunningCodeBlock(code, shell_name, args),
		})
		toolDefs.push([
			`inline-${shell_name}`,
			new RegExp(`<inline-${shell_name}(?<attrs>[^>]*)>`),
			`</inline-${shell_name}>`,
			async (code, previewArgs, meta) => {
				const attrs = parseTagAttrs(meta?.match?.groups?.attrs)
				const limits = parseRunLimits(attrs, SHELL_DEFAULT_TIMEOUT_MS)
				const resolver = previewExecutorResolvers.get(previewArgs) ?? previewExecutorResolvers.set(previewArgs, createArgsExecutorResolver(previewArgs)).get(previewArgs)
				let shell_result
				try {
					shell_result = await resolver(attrs).execShell(shell_name, code, { timeoutMs: limits.timeoutMs })
				} catch (err) {
					shell_result = err
				}

				if (shell_result instanceof Error) throw shell_result

				if (shell_result.timedOut)
					throw new Error(`${shell_name} inline execution timed out; the process tree was terminated. Use <run-${shell_name}> for long commands.`)

				if (shell_result.code)
					throw new Error(`${shell_name} execution of code '${code}' failed with exit code ${shell_result.code}`)

				const stdout = String(shell_result.stdout ?? '')
				if (stdout.length > OUTPUT_GUARD_LIMIT)
					throw new Error(`内联 ${shell_name} 输出过大（${stdout.length} 字符）；内联结果会直接插入消息，请改用 <run-${shell_name}>，其大输出会自动落盘。`)

				return stdout.trim()
			},
			renderInlineShellPending
		])
	}

	return defineToolUseBlocks(runBlocks)(defineInlineToolUses(toolDefs)(next))
}
