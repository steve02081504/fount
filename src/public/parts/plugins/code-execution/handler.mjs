import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import util from 'node:util'

import { async_eval } from 'npm:@steve02081504/async-eval'
import { available, removeTerminalSequences, shell_exec_map } from 'npm:@steve02081504/exec'
import { VirtualConsole } from 'npm:@steve02081504/virtual-console'

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
	truncateOutput,
} from '../../../../scripts/shell_guard.mjs'
import { defineReplyHandler } from '../../shells/chat/src/reply/defineReplyHandler.mjs'
import { defaultDisplay } from '../../shells/chat/src/reply/display.mjs'
import { getChatI18n, renderMarkdownCodeBlock, renderMarkdownInlineCode } from '../../shells/chat/src/streaming/index.mjs'
import { isAsyncToolingEnabled, ownerFromArgs, registerTask } from '../async-task/registry.mjs'
import { createArgsExecutorResolver, resolveLocalPath, resolveTarget } from '../file-operations/src/target.mjs'

/**
 * 按预览参数缓存执行器解析器（远程内联执行用）。
 * @type {WeakMap<object, ReturnType<typeof createArgsExecutorResolver>>}
 */
const previewExecutorResolvers = new WeakMap()

/**
 * 按回复对象缓存一次生成内的执行运行时（执行器与 JS 上下文）。
 * @type {WeakMap<object, object>}
 */
const runtimeCache = new WeakMap()

/**
 * 取请求的工具实时输出钩子（缺省返回 null，不流式）。
 * @param {object} args - 请求上下文。
 * @returns {((event: object) => void) | null} 发事件函数。
 */
function toolOutputEmitter(args) {
	const hook = args?.generation_options?.onToolOutput
	if (typeof hook !== 'function') return null
	return event => { try { hook(event) } catch { /* 前端转发失败不影响执行 */ } }
}

/**
 * 远程流式回显所需的主机侧回调 partpath（缺省空串 = 不回显远程输出）。
 * @param {object} args - 请求上下文。
 * @returns {string} partpath。
 */
function remoteToolCallbackPartpath(args) {
	return args?.generation_options?.remoteToolCallbackPartpath || ''
}

/**
 * 判断 `<run-*>` 是否请求异步后台执行。
 * @param {Record<string, string>} attrs - 标签属性表。
 * @returns {boolean} 是否异步。
 */
function isAsyncRequested(attrs) {
	const value = attrs?.async
	return value != null && value !== '' && value !== 'false' && value !== '0'
}

/**
 * 取任务首行预览（用于异步任务标签）。
 * @param {string} text - 文本。
 * @returns {string} 预览。
 */
function taskPreview(text) {
	const line = String(text ?? '').split(/\r?\n/).find(part => part.trim())?.trim() ?? ''
	return line.length > 80 ? `${line.slice(0, 80)}…` : line
}

/**
 * 写一条后台任务派发回执（含统一异步 id）。
 * @param {object} args - 请求上下文。
 * @param {object} task - async-task 任务。
 * @param {string} label - 类型标签（如 `JS` / `pwsh`）。
 * @returns {void}
 */
function writeAsyncDispatchLog(args, task, label) {
	args.AddLongTimeLog?.({
		name: 'code-execution.async',
		role: 'tool',
		content: `${label} 已在后台运行，id=${task.id}。可用 <await-async ids="${task.id}"/> 等待，或用 <list-async/> 查看；未被等待时完成后会以系统消息通知你。`,
		content_for_show: `${label} 已在后台运行（id：${task.id}）。`,
		files: [],
		extension: { asyncTask: { id: task.id, kind: task.kind, label: task.label } },
	})
}

/**
 * 写一条异步不可用的错误回执。
 * @param {object} args - 请求上下文。
 * @returns {object} handler 返回值。
 */
function rejectAsyncWithoutTooling(args) {
	args.AddLongTimeLog?.({
		name: 'code-execution.async',
		role: 'tool',
		content: 'async="true" 需要加载 async-task 插件才能管理异步任务；当前未启用，请改用同步执行。',
		content_for_show: '异步执行不可用（缺少 async-task 插件）。',
		files: [],
		extension: { error: true },
	})
	return { regen: true }
}

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
 * 用一次性虚拟控制台把任意值渲染为带颜色的 HTML（供人类展示层）。
 * 复用 `LogEntry.toHtml()`：内容已转义，样式随终端能力内联，可直接嵌入 markdown。
 * @param {unknown} value - 任意值。
 * @returns {string} HTML；渲染失败时为空串。
 */
function renderValueHtml(value) {
	try {
		const vc = new VirtualConsole({ realConsoleOutput: false })
		vc.log(value)
		const entry = vc.outputEntries.at(-1)
		return entry ? entry.toHtml() : ''
	}
	catch {
		return ''
	}
}

/**
 * 组装执行结果的展示层：命令代码块 + 已渲染的结果区。
 * @param {object} options - 选项。
 * @param {string} options.lang - 命令的语言标签。
 * @param {string} options.code - 命令源码。
 * @param {string} options.body - 结果区（含标题 / 彩色结果 / 纯文本兜底）。
 * @returns {string} 展示层 markdown。
 */
function buildResultShow({ lang, code, body }) {
	return renderMarkdownCodeBlock(code, { lang }) + '\n\n' + body
}

/**
 * 创建一个记录最近输出的滚动缓冲（供运行中异步任务检视「最后一段」输出）。
 * @param {number} [limit=4000] - 保留的最大字符数。
 * @returns {{push: (chunk: unknown) => void, read: () => string}} 缓冲区。
 */
function createTailBuffer(limit = 4000) {
	let text = ''
	return {
		/**
		 * 追加一段文本（只保留末尾 limit 字符）。
		 * @param {unknown} chunk - 文本片段。
		 * @returns {void}
		 */
		push(chunk) {
			text = (text + String(chunk ?? '')).slice(-limit)
		},
		/**
		 * 读取当前末尾文本。
		 * @returns {string} 末尾文本。
		 */
		read() {
			return text
		},
	}
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
 * 取（并缓存）一次生成内的执行运行时。
 * @param {object} result - 当前回复对象。
 * @param {object} args - 请求上下文。
 * @returns {{ executorFor: Function, runJscodeForAI: Function, execedCodes: object }} 运行时。
 */
function getRuntime(result, args) {
	if (!runtimeCache.has(result))
		runtimeCache.set(result, createRuntime(result, args))
	return runtimeCache.get(result)
}

/**
 * 构建一次生成内的执行运行时。
 * @param {object} result - 当前回复对象。
 * @param {object} args - 请求上下文。
 * @returns {{ executorFor: Function, runJscodeForAI: Function, execedCodes: object }} 运行时。
 */
function createRuntime(result, args) {
	result.extension ??= {}
	result.extension.execed_codes ??= {}
	const executorFor = createArgsExecutorResolver(args)

	/**
	 * 获取 JS 代码执行的上下文。
	 * @param {string} code - 要执行的代码。
	 * @param {object} [evalConsole] - 收集型 console（超时后回读部分输出）。
	 * @returns {Promise<object>} - 返回 JS 代码执行的上下文。
	 */
	async function getJsEvalContext(code, evalConsole) {
		if (!args.chat_scoped_char_memory) args.chat_scoped_char_memory = {}
		if (!args.chat_scoped_char_memory.coderunner_workspace) args.chat_scoped_char_memory.coderunner_workspace = {}
		const js_eval_context = {
			workspace: args.chat_scoped_char_memory.coderunner_workspace,
			chat_log: args.chat_log,
		}
		// JS 在 fount 进程内求值，process.cwd() 即进程自身 cwd，无法按请求切换（chdir 会影响整个进程）。
		// 暴露目标工作目录的绝对路径，供 AI 自行拼绝对路径，避免与 shell 侧 workdir 的基准不一致。
		const target = resolveTarget(args)
		if (!target.remote && target.workdir)
			js_eval_context.workdir = resolveLocalPath(target.workdir)
		/**
		 * 清空工作区。
		 */
		function clear_workspace() {
			js_eval_context.workspace = args.chat_scoped_char_memory.coderunner_workspace = {}
			js_eval_context.workspace.clear = clear_workspace
		}
		// 初始工作区即挂上 clear，保证文档示例 `workspace.clear()` 在首次执行时可用
		js_eval_context.workspace.clear = clear_workspace
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
				 * @param {any} callbackResult - 回调结果。
				 * @returns {void}
				 */
				const handler = callbackResult => callback_handler(args, reason, code, callbackResult)
				Promise.resolve(promise).then(handler, handler)
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
				args.AddLongTimeLog(view_files_flag = {
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
					args.AddLongTimeLog(sent_files = {
						role: 'tool',
						name: 'code-execution.add_files',
						content: '文件已发送，内容见附件。',
						files: result.files
					})
				if (errors.length == 1) throw errors[0]
				if (errors.length) throw errors
				return '文件已发送'
			}

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
	async function runJscodeForAI(code, evalConsole) {
		return async_eval(code, await getJsEvalContext(code, evalConsole))
	}

	return { executorFor, runJscodeForAI, execedCodes: result.extension.execed_codes }
}

/**
 * 生成「流式期渲染、终态折叠」的 display。
 * @param {(call: object, args: object) => string} render - 流式渲染函数。
 * @returns {Function} display
 */
function streamingOnly(render) {
	return (call, state, args) => state.stage === 'streaming'
		? render(call, args)
		: defaultDisplay(call, state, args)
}

/**
 * 生成 run-* 的流式渲染。
 * @param {string} lang - 语言标签。
 * @returns {Function} render(call, args)
 */
function renderRunningCodeBlock(lang) {
	return (call, args) => renderMarkdownCodeBlock(call.inner, {
		lang,
		title: getChatI18n(args, 'chat.message.view.tool.runningLang', { lang }),
	})
}

/**
 * 渲染 inline-* 未闭合或待执行内容。
 * @param {string} code - inline 代码。
 * @param {string} lang - 语言标签。
 * @param {object} args - 请求上下文。
 * @returns {string} 渲染结果。
 */
function renderInlinePending(code, lang, args) {
	if (/[\n\r]/.test(code))
		return renderMarkdownCodeBlock(code, {
			lang,
			title: getChatI18n(args, 'chat.message.view.tool.runningLang', { lang }),
		})
	return renderMarkdownInlineCode(code, lang)
}

/**
 * 生成 inline-* 的 display：已求值就地显示结果、出错显示错误、未完成显示占位。
 * @param {string} lang - 语言标签。
 * @returns {Function} display
 */
function inlineDisplay(lang) {
	return (call, state, args) => {
		if (state.error) return `[Error: ${state.error.message ?? state.error}]`
		if (state.value !== undefined && state.value !== null) return String(state.value)
		return renderInlinePending(call.inner, lang, args)
	}
}

/**
 * `inline-js` 的求值：本地 async_eval（无上下文，与旧预览一致）或远程执行器。
 * @param {object} call - 调用对象。
 * @param {object} args - 请求上下文。
 * @returns {Promise<string>} 内联结果文本。
 */
async function evaluateInlineJs(call, args) {
	const attrs = call.params
	const target = resolveTarget(args, attrs)
	const limits = parseRunLimits(attrs, JS_DEFAULT_TIMEOUT_MS)
	const remote = Boolean(target.remote)
	const emit = toolOutputEmitter(args)
	const callId = randomUUID()
	const name = 'code-execution.inline-js'
	/**
	 * 转发一个输出分片。
	 * @param {'stdout'|'stderr'} channel - 输出通道。
	 * @param {string} data - 分片文本。
	 * @returns {void}
	 */
	const stream = (channel, data) => emit?.({ callId, phase: 'chunk', name, stream: channel, data })
	const collecting = createCollectingConsole(stream)
	emit?.({ callId, phase: 'start', name, lang: 'js', code: call.inner })
	let outcome
	if (remote) {
		const resolver = previewExecutorResolvers.get(args) ?? previewExecutorResolvers.set(args, createArgsExecutorResolver(args)).get(args)
		outcome = await runJsWithTimeout(() => resolver(attrs).execJsWithTimeout(call.inner, limits.timeoutMs, { onOutput: stream, callbackPartpath: remoteToolCallbackPartpath(args) }), limits.timeoutMs)
	}
	else {
		const target = resolveTarget(args)
		const context = { console: collecting.console }
		if (!target.remote && target.workdir)
			context.workdir = resolveLocalPath(target.workdir)
		outcome = await runJsWithTimeout(() => async_eval(call.inner, context), limits.timeoutMs)
	}
	emit?.({ callId, phase: 'end', name })
	if (outcome.timedOut) throw new Error('内联 JS 执行超时；JS 无法强制终止，代码可能仍在运行。')
	const coderesult = outcome.evalResult
	if (coderesult?.error) throw coderesult.error
	if (remote) return String(coderesult ?? '')
	return coderesult.result + ''
}

/**
 * 生成 inline-<shell> 的求值。
 * @param {string} shell_name - shell 名。
 * @returns {(call: object, args: object) => Promise<string>} 求值函数
 */
function createInlineShellEvaluate(shell_name) {
	return async (call, args) => {
		const attrs = call.params
		const limits = parseRunLimits(attrs, SHELL_DEFAULT_TIMEOUT_MS)
		const resolver = previewExecutorResolvers.get(args) ?? previewExecutorResolvers.set(args, createArgsExecutorResolver(args)).get(args)
		const emit = toolOutputEmitter(args)
		const callId = randomUUID()
		const name = `code-execution.inline-${shell_name}`
		/**
		 * 转发一个输出分片。
		 * @param {'stdout'|'stderr'} channel - 输出通道。
		 * @param {string} data - 分片文本。
		 * @returns {void}
		 */
		const stream = (channel, data) => emit?.({ callId, phase: 'chunk', name, stream: channel, data })
		emit?.({ callId, phase: 'start', name, lang: shell_name, code: call.inner })
		let shell_result
		try {
			shell_result = await resolver(attrs).execShell(shell_name, call.inner, {
				timeoutMs: limits.timeoutMs,
				onOutput: stream,
				callbackPartpath: remoteToolCallbackPartpath(args),
			})
		} catch (err) {
			shell_result = err
		}
		emit?.({ callId, phase: 'end', name })
		if (shell_result instanceof Error) throw shell_result
		if (shell_result.timedOut)
			throw new Error(`${shell_name} inline execution timed out; the process tree was terminated. Use <run-${shell_name}> for long commands.`)
		if (shell_result.code)
			throw new Error(`${shell_name} execution of code '${call.inner}' failed with exit code ${shell_result.code}`)
		const stdout = String(shell_result.stdout ?? '')
		if (stdout.length > OUTPUT_GUARD_LIMIT)
			throw new Error(`内联 ${shell_name} 输出过大（${stdout.length} 字符）；内联结果会直接插入消息，请改用 <run-${shell_name}>，其大输出会自动落盘。`)
		return stdout.trim()
	}
}

/**
 * 生成 inline-* 的处理器：记录工具卡或失败日志。
 * @param {string} lang - 语言标签。
 * @returns {(reply: object, args: object, call: object) => Promise<object>} handle
 */
function createInlineHandle(lang) {
	return async (reply, args, call) => {
		if (call.error) {
			console.error(`内联${lang}代码执行失败：`, call.error)
			args.AddLongTimeLog({
				name: `code-execution.inline-${lang}`,
				role: 'tool',
				content: `内联${lang}代码执行失败：\n` + (call.error.stack || String(call.error)),
				files: []
			})
			return { regen: true }
		}
		const { text, truncated, omitted } = truncateOutput(String(call.value ?? ''), { limit: 4000, head: 2000, tail: 2000 })
		args.AddLongTimeLog({
			name: `code-execution.inline-${lang}`,
			role: 'tool',
			content: `内联${lang}结果：${text}${truncated ? `\n（中间省略 ${omitted} 字符）` : ''}`,
			content_for_show: buildInlineToolCard([{ code: call.inner, result: call.value }], lang),
			files: [],
			charVisibility: [args.char_id],
		})
		call.inlineResultLogged = true
		return {}
	}
}

/**
 * 执行一次 `<run-js>` 并构造完整结果文本（同步执行与后台异步执行共用）。
 * @param {object} options - 执行参数。
 * @param {object} options.runtime - code-execution 运行时。
 * @param {object} options.args - 请求上下文。
 * @param {object} options.call - 调用对象。
 * @param {object} options.limits - 运行限制。
 * @param {boolean} options.remote - 是否远程执行。
 * @param {Function|null} options.stream - 流式输出回调（后台执行传 null）。
 * @returns {Promise<{fullOutput: string, html: string, suffix: string}>} 完整结果文本、结果值的彩色 HTML（成功时）与耗时后缀。
 */
async function executeRunJs({ runtime, args, call, limits, remote, stream }) {
	const collecting = createCollectingConsole(stream ?? undefined)
	const remoteOutput = []
	/**
	 * 收集远程控制台文本并转发实时输出。
	 * @param {'stdout'|'stderr'} channel - 输出通道。
	 * @param {string} data - 输出分片。
	 * @returns {void} 无返回值。
	 */
	const onRemoteOutput = (channel, data) => { remoteOutput.push(String(data ?? '')); stream?.(channel, data) }
	const { evalResult, timedOut, elapsedMs } = remote
		? await runJsWithTimeout(() => runtime.executorFor(call.params).execJsWithTimeout(call.inner, limits.timeoutMs, { onOutput: onRemoteOutput, callbackPartpath: remoteToolCallbackPartpath(args) }), limits.timeoutMs)
		: await runJsWithTimeout(() => runtime.runJscodeForAI(call.inner, collecting.console), limits.timeoutMs)
	runtime.execedCodes[call.inner] = evalResult ?? { timedOut: true }
	const elapsedText = formatElapsed(elapsedMs)
	const parts = []
	let html = ''
	const output = remote ? remoteOutput.join('') : collecting.text()
	if (timedOut) {
		parts.push(`执行超时（耗时 ${elapsedText}）：JS 无法强制终止，代码可能仍在后台运行。`)
		if (output) parts.push('超时前捕获的输出：', output)
	}
	else if (evalResult?.error)
		parts.push('执行出错：', util.inspect({ output, error: evalResult.error }, { depth: 4 }))
	else {
		const summary = { output, result: remote ? evalResult : evalResult?.result }
		parts.push('执行结果：', util.inspect(summary, { depth: 4 }))
		if (elapsedText) parts.push(`（耗时 ${elapsedText}）`)
		html = renderValueHtml(summary)
	}
	const notice = formatTimeoutNotice({ timedOut, elapsedMs, waitForever: limits.waitForever, expectMs: limits.expectMs, toleranceMs: limits.toleranceMs, kind: 'js' })
	if (notice) parts.push(notice.trim())
	const suffix = !timedOut && !evalResult?.error && elapsedText ? `（耗时 ${elapsedText}）` : ''
	return { fullOutput: parts.join('\n'), html, suffix }
}

/**
 * `<run-js>`：执行 JS 代码（`async="true"` 时后台运行并登记统一异步任务）。
 * @type {ReplyHandler_t}
 */
export const runJsReplyHandler = defineReplyHandler({
	tag: 'run-js',
	display: streamingOnly(renderRunningCodeBlock('js')),
	/**
	 * 执行 JS 代码。
	 * @param {object} reply 回复对象
	 * @param {object} args 请求上下文
	 * @param {object} call 调用
	 * @returns {Promise<object>} 结果
	 */
	handle: async (reply, args, call) => {
		const { AddLongTimeLog } = args
		const runtime = getRuntime(reply, args)
		const attrs = call.params
		const remote = Boolean(resolveTarget(args, attrs).remote)
		const emit = toolOutputEmitter(args)
		const callId = randomUUID()
		const name = 'code-execution.run-js'
		/**
		 * 转发一个输出分片。
		 * @param {'stdout'|'stderr'} channel - 输出通道。
		 * @param {string} data - 分片文本。
		 * @returns {void}
		 */
		const stream = (channel, data) => emit?.({ callId, phase: 'chunk', name, stream: channel, data })
		const limits = parseRunLimits(attrs, JS_DEFAULT_TIMEOUT_MS)

		if (isAsyncRequested(attrs)) {
			if (!isAsyncToolingEnabled()) return rejectAsyncWithoutTooling(args)
			const inspectBuffer = createTailBuffer()
			/**
			 * 记录控制台输出末尾片段，供运行中检视。
			 * @param {'stdout'|'stderr'} channel - 输出通道。
			 * @param {string} data - 分片文本。
			 * @returns {void}
			 */
			const inspectStream = (channel, data) => inspectBuffer.push(data)
			const task = registerTask({
				kind: 'js',
				label: taskPreview(call.inner),
				owner: ownerFromArgs(args),
				/**
				 * 后台执行 JS 并返回供完成通知使用的文本。
				 * @returns {Promise<string>} 结果文本
				 */
				run: async () => {
					const { fullOutput } = await executeRunJs({ runtime, args, call, limits, remote, stream: inspectStream })
					return (await guardOutput(fullOutput, { name: 'run-js', label: 'JS 结果' })).text
				},
				/**
				 * 运行中检视：返回控制台输出的最后一段。
				 * @returns {string} 末尾控制台输出。
				 */
				inspect: () => inspectBuffer.read().trim() || '（暂无控制台输出）',
				meta: { code: call.inner, remote },
			})
			writeAsyncDispatchLog(args, task, 'JS')
			return { regen: true }
		}

		await logCode(`${args.Charname} running JS code:`, call.inner, 'js')
		emit?.({ callId, phase: 'start', name, lang: 'js', code: call.inner })
		const { fullOutput, html, suffix } = await executeRunJs({ runtime, args, call, limits, remote, stream })
		emit?.({ callId, phase: 'end', name })
		const guarded = await guardOutput(fullOutput, { name: 'run-js', label: 'JS 结果' })
		const body = html && !guarded.truncated
			? `执行结果：\n\n${html}${suffix ? `\n\n${suffix}` : ''}`
			: guarded.text
		AddLongTimeLog({
			name: 'code-execution.run-js',
			role: 'tool',
			content: guarded.text,
			content_for_show: buildResultShow({ lang: 'js', code: call.inner, body }),
			files: [],
		})
		return { regen: true }
	},
})

/**
 * `<inline-js>`：执行 JS 并把结果就地插入展示层。
 * @type {ReplyHandler_t}
 */
export const inlineJsReplyHandler = defineReplyHandler({
	tag: 'inline-js',
	evaluate: evaluateInlineJs,
	display: inlineDisplay('js'),
	handle: createInlineHandle('js'),
})

/**
 * 执行一次 `<run-<shell>>` 并构造完整结果文本（同步执行与后台异步执行共用）。
 * @param {object} options - 执行参数。
 * @param {object} options.runtime - code-execution 运行时。
 * @param {object} options.args - 请求上下文。
 * @param {object} options.call - 调用对象。
 * @param {object} options.limits - 运行限制。
 * @param {string} options.shellName - shell 名。
 * @param {Function|null} options.stream - 流式输出回调（后台执行传 null）。
 * @returns {Promise<{fullOutput: string, rawOutput: string, showBody: string}>}
 *   完整结果文本（已去终端控制序列）、保留 ANSI 的原始输出、人类展示层结果区（ansi 代码块）。
 */
async function executeRunShell({ runtime, args, call, limits, shellName, stream }) {
	const chunks = []
	let shell_result
	try {
		shell_result = await runtime.executorFor(call.params).execShell(shellName, call.inner, {
			timeoutMs: limits.timeoutMs,
			/**
			 * 记录原始输出分片并转发给流式回调。
			 * @param {'stdout'|'stderr'} channel - 输出通道。
			 * @param {string} data - 分片文本。
			 * @returns {void}
			 */
			onOutput: (channel, data) => { chunks.push(String(data ?? '')); stream?.(channel, data) },
			callbackPartpath: remoteToolCallbackPartpath(args),
		})
	} catch (err) { shell_result = err }
	runtime.execedCodes[call.inner] = shell_result
	const elapsedText = shell_result?.elapsedMs ? formatElapsed(shell_result.elapsedMs) : ''
	const timedOut = Boolean(shell_result?.timedOut)
	const rawOutput = chunks.join('')
	const notice = formatTimeoutNotice({
		timedOut, elapsedMs: shell_result?.elapsedMs ?? 0, waitForever: limits.waitForever,
		expectMs: limits.expectMs, toleranceMs: limits.toleranceMs, kind: 'shell',
		killed: shell_result?.killed, remote: false,
	})
	let fullOutput
	let showBody
	if (shell_result instanceof Error) {
		fullOutput = '执行出错：\n' + (shell_result.stack || String(shell_result)) + notice
		showBody = fullOutput
	}
	else {
		// agent 层不含终端控制序列；优先用流式累积的原始输出（去掉序列）以覆盖远程未清理的情形
		const buffered = shell_result?.stdall ?? [shell_result?.stdout, shell_result?.stderr].filter(Boolean).join('\n') ?? ''
		const output = removeTerminalSequences(rawOutput || buffered)
		const header = `退出码 ${shell_result?.code ?? '(无)'}${shell_result?.signal ? `，信号 ${shell_result.signal}` : ''}${timedOut ? '（超时）' : ''}${elapsedText ? `，耗时 ${elapsedText}` : ''}：`
		fullOutput = header + '\n' + output + notice
		// 展示层保留原始 ANSI：用 ansi 代码块呈色
		showBody = header + '\n\n' + renderMarkdownCodeBlock(rawOutput || output, { lang: 'ansi' }) + (notice ? '\n' + notice.trim() : '')
	}
	return { fullOutput, rawOutput, showBody }
}

/**
 * 生成 `<run-<shell>>` 处理器（`async="true"` 时后台运行并登记统一异步任务）。
 * @param {string} shell_name - shell 名。
 * @returns {ReplyHandler_t} ReplyHandler
 */
function createRunShellReplyHandler(shell_name) {
	return defineReplyHandler({
		tag: `run-${shell_name}`,
		display: streamingOnly(renderRunningCodeBlock(shell_name)),
		/**
		 * 执行 shell 代码。
		 * @param {object} reply 回复对象
		 * @param {object} args 请求上下文
		 * @param {object} call 调用
		 * @returns {Promise<object>} 结果
		 */
		handle: async (reply, args, call) => {
			const { AddLongTimeLog } = args
			const runtime = getRuntime(reply, args)
			const attrs = call.params
			const emit = toolOutputEmitter(args)
			const callId = randomUUID()
			const name = `code-execution.run-${shell_name}`
			/**
			 * 转发一个输出分片。
			 * @param {'stdout'|'stderr'} channel - 输出通道。
			 * @param {string} data - 分片文本。
			 * @returns {void}
			 */
			const stream = (channel, data) => emit?.({ callId, phase: 'chunk', name, stream: channel, data })
			const limits = parseRunLimits(attrs, SHELL_DEFAULT_TIMEOUT_MS)

			if (isAsyncRequested(attrs)) {
				if (!isAsyncToolingEnabled()) return rejectAsyncWithoutTooling(args)
				const inspectBuffer = createTailBuffer()
				/**
				 * 记录原始输出末尾片段，供运行中检视（去掉终端控制序列）。
				 * @param {'stdout'|'stderr'} channel - 输出通道。
				 * @param {string} data - 分片文本。
				 * @returns {void}
				 */
				const inspectStream = (channel, data) => inspectBuffer.push(data)
				const task = registerTask({
					kind: shell_name,
					label: taskPreview(call.inner),
					owner: ownerFromArgs(args),
					/**
					 * 后台执行 shell 并返回供完成通知使用的文本。
					 * @returns {Promise<string>} 结果文本
					 */
					run: async () => {
						const { fullOutput } = await executeRunShell({ runtime, args, call, limits, shellName: shell_name, stream: inspectStream })
						return (await guardOutput(fullOutput, { name: `shell-${shell_name}`, label: 'shell 输出' })).text
					},
					/**
					 * 运行中检视：返回 stdall 的最后一段（去终端控制序列）。
					 * @returns {string} 末尾输出。
					 */
					inspect: () => removeTerminalSequences(inspectBuffer.read()).trim() || '（暂无输出）',
					meta: { code: call.inner },
				})
				writeAsyncDispatchLog(args, task, shell_name)
				return { regen: true }
			}

			await logCode(`${args.Charname} running ${shell_name} code:`, call.inner, shell_name)
			emit?.({ callId, phase: 'start', name, lang: shell_name, code: call.inner })
			const { fullOutput, showBody } = await executeRunShell({ runtime, args, call, limits, shellName: shell_name, stream })
			emit?.({ callId, phase: 'end', name })
			console.info(`${args.Charname} ${shell_name} result:`, runtime.execedCodes[call.inner])
			const guarded = await guardOutput(fullOutput, { name: `shell-${shell_name}`, label: 'shell 输出' })
			AddLongTimeLog({
				name: `code-execution.run-${shell_name}`,
				role: 'tool',
				content: guarded.text,
				content_for_show: buildResultShow({ lang: shell_name, code: call.inner, body: guarded.truncated ? guarded.text : showBody }),
				files: [],
			})
			return { regen: true }
		},
	})
}

/**
 * 生成 `<inline-<shell>>` 处理器。
 * @param {string} shell_name - shell 名。
 * @returns {ReplyHandler_t} ReplyHandler
 */
function createInlineShellReplyHandler(shell_name) {
	return defineReplyHandler({
		tag: `inline-${shell_name}`,
		evaluate: createInlineShellEvaluate(shell_name),
		display: inlineDisplay(shell_name),
		handle: createInlineHandle(shell_name),
	})
}

/**
 * 按当前可用 shell 生成代码执行插件的全部 ReplyHandler。
 * @returns {ReplyHandler_t[]} ReplyHandler 列表
 */
export function getCodeExecutionReplyHandlers() {
	const handlers = [runJsReplyHandler, inlineJsReplyHandler]
	for (const shell_name in shell_exec_map) {
		if (!available[shell_name]) continue
		handlers.push(createRunShellReplyHandler(shell_name), createInlineShellReplyHandler(shell_name))
	}
	return handlers
}
