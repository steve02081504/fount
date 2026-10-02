import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import process from 'node:process'
import util from 'node:util'

import { async_eval } from 'npm:@steve02081504/async-eval'
import { removeTerminalSequences } from 'npm:@steve02081504/exec'

import { toFileObj as normalizeFileObj } from '../../../../scripts/file_object.mjs'
import { redactSecrets } from '../../../../scripts/secret_filter.mjs'
import {
	createCollectingConsole,
	createLineDedupe,
	dedupeConsecutiveLines,
	formatElapsed,
	formatTimeoutNotice,
	guardOutput,
	JS_DEFAULT_TIMEOUT_MS,
	killProcessTree,
	parseRunLimits,
	runJsWithTimeout,
	SHELL_DEFAULT_TIMEOUT_MS,
	OUTPUT_GUARD_LIMIT,
	truncateOutput,
} from '../../../../scripts/shell_guard.mjs'
import { awakeNow, setAwakeTimeout } from '../../../../scripts/sleep_watch.mjs'
import { appendAndWake } from '../../shells/chat/src/lib/charWake.mjs'
import { defineReplyHandler, flattenReplyHandlers } from '../../shells/chat/src/reply/defineReplyHandler.mjs'
import { defaultDisplay } from '../../shells/chat/src/reply/display.mjs'
import { getChatI18n, renderMarkdownCodeBlock, renderMarkdownInlineCode } from '../../shells/chat/src/streaming/index.mjs'
import { asyncTaskReplyHandlers } from '../async-task/handler.mjs'
import { isAsyncToolingEnabled, ownerFromArgs, registerTask } from '../async-task/registry.mjs'
import { createArgsExecutorResolver, executionTargetOf, resolveLocalPath, resolveTarget } from '../file-operations/src/target.mjs'

import { isShellUsable, registeredShellNames, resolveAvailableShells } from './availability.mjs'
import { captureMonitor, captureMonitorSource } from './screen.mjs'

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
 * JS 的执行目标快照：本地 JS 在 fount 进程内求值，相对 `fs` 路径基于进程 cwd；远端执行器不按 `workdir` 切换 JS cwd。
 * 因此本机记 `0` + 进程 cwd（诊断相对路径可据此读取），远端只确定机器、不假定目录（仅绝对路径诊断可读）。
 * @param {object} args - 请求上下文。
 * @param {object} attrs - 标签属性。
 * @returns {{machine: string, workdir: string|null}} 执行目标。
 */
function jsExecutionTarget(args, attrs) {
	const target = resolveTarget(args, attrs)
	if (target.remote) return { machine: target.machine, workdir: null }
	return { machine: '0', workdir: process.cwd() }
}

/**
 * 生成工具日志的执行目标 `extension` 片段（无目标时不加字段）。
 * @param {{machine: string, workdir: string|null}|null|undefined} executionTarget - 执行目标。
 * @returns {object} 可展开的扩展片段。
 */
function targetExtension(executionTarget) {
	return executionTarget ? { extension: { executionTarget } } : {}
}

/**
 * inline 工具（`inline-js` / `inline-<shell>`）的执行目标快照。
 * evaluate 阶段与 handle 阶段的 call 不是同一对象（回复管线只回填 value/error），故在 handle 内重算。
 * @param {string} lang - 语言标签（`js` 或 shell 名）。
 * @param {object} args - 请求上下文。
 * @param {object} attrs - 标签属性。
 * @returns {{machine: string, workdir: string|null}} 执行目标。
 */
function inlineExecutionTarget(lang, args, attrs) {
	if (lang === 'js') return jsExecutionTarget(args, attrs)
	return executionTargetOf(resolveTarget(args, attrs))
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
 * @param {string} reason - 派发原因（已在后台运行 / 等待超时转后台）。
 * @param {string} stopHint - 可用的停止方式说明（空串表示该任务不可停止）。
 * @returns {void}
 */
function writeAsyncDispatchLog(args, task, label, reason, stopHint = '') {
	const controls = `id=${task.id}。可用 <inspect-async id="${task.id}"/> 查看进展，<await-async ids="${task.id}"/> 等待结果，或 <list-async/> 查看任务列表；未被等待时完成后会以系统消息通知你。${stopHint}`
	args.AddLongTimeLog?.({
		name: 'code-execution.async',
		role: 'tool',
		content: `${reason}（${label}），${controls}`,
		content_for_show: `${reason}（${label}）。\n\n${renderMarkdownCodeBlock(controls)}`,
		files: [],
		extension: { asyncTask: { id: task.id, kind: task.kind, label: task.label } },
	})
}

/**
 * 在时限内等待执行结果；超时返回 null，但**不**打断执行（调用方把它转为后台任务，继续等同一 Promise）。
 * @param {Promise<{value?: unknown, error?: unknown}>} settled - 已捕获异常的完成 Promise。
 * @param {number|null} timeoutMs - 等待上限（null = 一直等）。
 * @returns {Promise<{value?: unknown, error?: unknown}|null>} 完成结果，或超时 null。
 */
async function settleWithin(settled, timeoutMs) {
	if (timeoutMs === null) return await settled
	let cancelTimer
	try {
		return await Promise.race([
			settled,
			new Promise(resolve => { cancelTimer = setAwakeTimeout(() => resolve(null), timeoutMs) }),
		])
	} finally { cancelTimer?.() }
}

/**
 * 前台等待一段时间后，把同一次执行转为统一异步任务。
 * @param {object} options - 执行与任务上下文。
 * @param {object} options.args - 请求上下文。
 * @param {object} options.call - 解析后的调用。
 * @param {string} options.kind - 任务类型（`js` 或 shell 名）。
 * @param {{machine: string, workdir: string|null}} options.executionTarget - 执行目标快照。
 * @param {object} options.limits - 前台等待限制。
 * @param {(output: Function) => Promise<object>} options.execute - 执行一次，输出经给定回调回传。
 * @param {Function} options.stream - 前台输出回调。
 * @param {Function} [options.stop] - 可选的取消回调（仅 shell 任务有）。
 * @param {string} [options.stopHint] - 回执里的停止方式说明。
 * @returns {Promise<object|null>} 前台结果；已转后台时为 null。
 */
async function runWithBackgroundFallback({ args, call, kind, executionTarget, limits, execute, stream, stop, stopHint }) {
	const output = createTailBuffer()
	let foreground = !isAsyncRequested(call.params)
	const started = awakeNow()
	const settle = Promise.resolve().then(() => execute((channel, data) => {
		output.push(data)
		if (foreground) stream(channel, data)
	})).then(value => ({ value }), error => ({ error }))
	if (foreground) {
		const outcome = await settleWithin(settle, limits.timeoutMs)
		if (outcome) {
			if ('error' in outcome) throw outcome.error
			return outcome.value
		}
	}
	const waitedMs = foreground ? awakeNow() - started : null
	foreground = false
	const task = registerTask({
		kind, label: taskPreview(call.inner), owner: ownerFromArgs(args), eventContext: args, stop,
		/**
		 * 等这次执行结束后返回其结果文本。
		 * @returns {Promise<string>} 过护栏的结果。
		 */
		run: async () => {
			const result = await settle
			if (result.error) throw result.error
			const { content, fullOutput, failed } = result.value
			const text = content ?? (await guardOutput(fullOutput, { name: `shell-${kind}`, label: 'shell 输出' })).text
			if (failed) throw new Error(text)
			return text
		},
		/**
		 * 运行中检视：返回最近一段输出。
		 * @returns {string} 最近输出。
		 */
		inspect: () => redactSecrets(removeTerminalSequences(output.read()).trim()) || '（暂无输出）',
		meta: { code: call.inner, executionTarget, pluginName: 'code-execution', tool: `code-execution.run-${kind}` },
	})
	writeAsyncDispatchLog(args, task, kind === 'js' ? 'JS' : kind,
		waitedMs === null ? '已在后台运行'
			: `已等待 ${formatElapsed(waitedMs)} 达到等待时限（超时），执行未被打断、继续在后台运行`,
		stopHint ?? 'JS 在进程内运行，无法强制终止。')
	return null
}

/**
 * 生成「目标机器缺少该 shell」的统一提示文本。
 * @param {string} shellName - 请求的 shell 名。
 * @param {string[]} shells - 目标机器可用的 shell 名列表。
 * @returns {string} 提示文本。
 */
function shellUnavailableMessage(shellName, shells) {
	return `目标机器上没有可用的 shell「${shellName}」（可用：${shells?.length ? shells.join('、') : '无'}）。`
}

/**
 * 写一条目标机器缺少该 shell 的失败回执，并列出可用 shell 引导模型改用。
 * @param {object} args - 请求上下文。
 * @param {string} shellName - 请求的 shell 名。
 * @param {string[]} shells - 目标机器可用的 shell 名列表。
 * @returns {object} handler 返回值。
 */
function rejectUnavailableShell(args, shellName, shells) {
	const message = shellUnavailableMessage(shellName, shells)
	args.AddLongTimeLog?.({
		name: `code-execution.run-${shellName}`,
		role: 'tool',
		content: `${message}无法执行，请改用可用的 shell 后重试。`,
		content_for_show: `无法执行：${message}`,
		files: [],
		extension: { error: true },
	})
	return { regen: true, failed: true }
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
 * 把任意值渲染为带颜色的 ANSI 文本（供人类展示层）。
 * 结果一律放进 ansi 代码块（见 renderAnsiBlock），由前端 rehypeAnsiBlock 转 ansi2html 转义着 color：
 * 工具输出是模型可经命令 / 文件间接引入的不可信文本，绝不能作为内联 HTML / markdown 直接进页面。
 * @param {unknown} value - 任意值。
 * @returns {string} ANSI 文本。
 */
function renderAnsiText(value) {
	try {
		return util.inspect(value, { depth: 4, colors: true })
	}
	catch {
		return util.inspect({ error: String(value) }, { depth: 4, colors: true })
	}
}

/**
 * 把不可信的终端 / 控制台文本包进 ansi 代码块（前端转义着 color，且不再按 markdown 解析）。
 * @param {string} text - 原始文本。
 * @returns {string} Markdown 代码块。
 */
function renderAnsiBlock(text) {
	return renderMarkdownCodeBlock(text ?? '', { lang: 'ansi' })
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
 * 构建一个独立护栏的 JS 运行输出片段：纯文本单独做长度判断与超限落盘，再各自渲染为代码块。
 * 展示层未截断时用带色文本，截断时回退为护栏后的纯文本（不按 markdown 解析）。
 * @param {object} options - 选项。
 * @param {string} options.name - 落盘文件名提示。
 * @param {string} options.label - 护栏提示中的名称。
 * @param {string} options.plain - 纯文本（长度判断与落盘基于此）。
 * @param {string} options.ansi - 带色文本（展示层未截断时使用）。
 * @returns {Promise<{agent: string, show: string, truncated: boolean}>} agent 层代码块、展示层代码块、是否截断。
 */
async function guardRunPart({ name, label, plain, ansi }) {
	const guarded = await guardOutput(plain, { name, label })
	return {
		agent: renderMarkdownCodeBlock(guarded.text, { lang: 'ansi' }),
		show: renderMarkdownCodeBlock(guarded.truncated ? guarded.text : ansi, { lang: 'ansi' }),
		truncated: guarded.truncated,
	}
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
 * @returns {Promise<void>} 输出完成。
 */
async function logCode(label, code, lang) {
	try {
		const { highlight } = await import('npm:cli-highlight')
		console.info(label + '\n' + highlight(code, { language: lang === 'pwsh' ? 'powershell' : lang, ignoreIllegals: true }))
	}
	catch { console.info(label, code) }
}

/**
 * 用共享的 MIME 与文件名解析器规范化附件。
 * @param {string|object} input Attachment source.
 * @returns {Promise<object>} Normalized attachment.
 */
const toFileObj = input => normalizeFileObj(input, { resolvePath: resolveLocalPath })

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
 * @param {boolean} succeeded Whether the background promise fulfilled.
 * @returns {Promise<void>} 写入完成。
 */
async function callback_handler(args, reason, code, result, succeeded = true) {
	const feedback = {
		role: 'tool',
		name: 'code-execution.callback',
		extension: { pluginEvent: { id: randomUUID(), pluginName: 'code-execution', type: 'background', status: succeeded ? 'succeeded' : 'failed', tool: 'code-execution.callback', data: { reason } } },
		uid: 'system',
		content: redactSecrets(`\
你的js代码中的callback函数被调用了
原因是：${reason}
你此前执行的代码是：
\`\`\`js
${code}
\`\`\`
结果是：
${renderAnsiBlock(renderAnsiText(result))}
请根据callback函数的内容进行回复。
`),
		charVisibility: [args.char_id],
	}
	try {
		// 只负责写入，由 shell 决定是否/何时安排生成；无 RequestCharReply 的 shell 即为 append-only
		await appendAndWake(args, feedback)
	}
	catch (error) {
		console.error(`Error processing callback for "${reason}":`, error)
		feedback.extension.pluginEvent.status = 'failed'
		feedback.content += `处理callback时出错：${error.stack}\n`
		await args.AppendChatLogEntry?.(feedback)
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
				Promise.resolve(promise).then(handler, error => callback_handler(args, reason, code, error, false))
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
		const runtime = getRuntime(args, args)
		outcome = await runJsWithTimeout(() => runtime.runJscodeForAI(call.inner, collecting.console), limits.timeoutMs)
	}
	emit?.({ callId, phase: 'end', name })
	if (outcome.timedOut) throw new Error('内联 JS 执行超时；JS 无法强制终止，代码可能仍在运行。')
	const coderesult = outcome.evalResult
	if (coderesult?.error) throw coderesult.error
	return redactSecrets(remote ? String(coderesult ?? '') : coderesult.result + '')
}

/**
 * 生成 inline-<shell> 的求值。
 * @param {string} shell_name - shell 名。
 * @param {(args: object, attrs: object) => Promise<string[]>} resolveShells - 解析目标机器可用 shell 的函数。
 * @returns {(call: object, args: object) => Promise<string>} 求值函数
 */
function createInlineShellEvaluate(shell_name, resolveShells) {
	return async (call, args) => {
		const attrs = call.params
		const shells = await resolveShells(args, attrs)
		if (!isShellUsable(shell_name, shells))
			throw new Error(shellUnavailableMessage(shell_name, shells))
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
		return redactSecrets(stdout.trim())
	}
}

/**
 * 生成 inline-* 的处理器：记录工具卡或失败日志。
 * @param {string} lang - 语言标签。
 * @returns {(reply: object, args: object, call: object) => Promise<object>} handle
 */
function createInlineHandle(lang) {
	return async (reply, args, call) => {
		const executionTarget = inlineExecutionTarget(lang, args, call.params)
		if (call.error) {
			console.error(`内联${lang}代码执行失败：`, call.error)
			const errorText = String(call.error?.stack || call.error)
			args.AddLongTimeLog({
				name: `code-execution.inline-${lang}`,
				role: 'tool',
				// agent 层经过密钥擦除；人类展示层把不可信错误文本包进代码块，避免被当 markdown / HTML 渲染
				content: `内联${lang}代码执行失败：\n` + redactSecrets(errorText),
				content_for_show: renderMarkdownCodeBlock(`内联${lang}代码执行失败：\n${errorText}`, { lang: 'ansi' }),
				files: [],
				extension: { error: true, executionTarget },
			})
			return { regen: true, failed: true }
		}
		const { text, truncated, omitted } = truncateOutput(String(call.value ?? ''), { limit: 4000, head: 2000, tail: 2000 })
		args.AddLongTimeLog({
			name: `code-execution.inline-${lang}`,
			role: 'tool',
			content: `内联${lang}结果：${text}${truncated ? `\n（中间省略 ${omitted} 字符）` : ''}`,
			content_for_show: buildInlineToolCard([{ code: call.inner, result: call.value }], lang),
			files: [],
			charVisibility: [args.char_id],
			...targetExtension(executionTarget),
		})
		call.inlineResultLogged = true
		return {}
	}
}

/**
 * 执行一次 `<run-js>` 并构造结果文本（同步执行与后台异步执行共用）。
 * 输出与结果/错误各自独立护栏（长度判断 + 超限落盘）并各自渲染为代码块，不再拼成一个转义对象。
 * @param {object} options - 执行参数。
 * @param {object} options.runtime - code-execution 运行时。
 * @param {object} options.args - 请求上下文。
 * @param {object} options.call - 调用对象。
 * @param {object} options.limits - 运行限制。
 * @param {boolean} options.remote - 是否远程执行。
 * @param {Function|null} options.stream - 流式输出回调（后台执行传 null）。
 * @returns {Promise<{content: string, showParts: string[], evalResult: object}>} agent 层完整文本、展示层结果区各片段，以及原始求值结果（用于展示层标题判断 error）。
 */
async function executeRunJs({ runtime, args, call, limits, remote, stream }) {
	const collecting = createCollectingConsole(stream ?? undefined)
	// 远程控制台文本同样在进入时流式压缩连续重复行。
	const remoteDeduper = createLineDedupe()
	/**
	 * 收集远程控制台文本（流式压缩）并转发实时输出。
	 * @param {'stdout'|'stderr'} channel - 输出通道。
	 * @param {string} data - 输出分片。
	 * @returns {void} 无返回值。
	 */
	const onRemoteOutput = (channel, data) => {
		remoteDeduper.push(String(data ?? ''))
		stream?.(channel, data)
	}
	const { evalResult, timedOut, elapsedMs } = remote
		? await runJsWithTimeout(() => runtime.executorFor(call.params).execJsWithTimeout(call.inner, limits.timeoutMs, { onOutput: onRemoteOutput, callbackPartpath: remoteToolCallbackPartpath(args) }), limits.timeoutMs)
		: await runJsWithTimeout(() => runtime.runJscodeForAI(call.inner, collecting.console), limits.timeoutMs)
	runtime.execedCodes[call.inner] = evalResult ?? { timedOut: true }
	const elapsedText = formatElapsed(elapsedMs)
	const output = remote ? remoteDeduper.finish().text : collecting.text()
	const contentParts = []
	const showParts = []

	const outputPart = await guardRunPart({ name: 'run-js-output', label: 'JS 输出', plain: output, ansi: output })
	contentParts.push(`输出：\n\n${outputPart.agent}`)
	showParts.push(`输出：\n\n${outputPart.show}`)

	if (timedOut) {
		const timeoutBlock = renderMarkdownCodeBlock(`执行超时（耗时 ${elapsedText}）：JS 无法强制终止，代码可能仍在后台运行。`, { lang: 'ansi' })
		contentParts.push(`错误：\n\n${timeoutBlock}`)
		showParts.push(`错误：\n\n${timeoutBlock}`)
	}
	else if (evalResult?.error) {
		const errorPart = await guardRunPart({ name: 'run-js-error', label: 'JS 错误', plain: util.inspect(evalResult.error, { depth: 4 }), ansi: renderAnsiText(evalResult.error) })
		contentParts.push(`错误：\n\n${errorPart.agent}`)
		showParts.push(`错误：\n\n${errorPart.show}`)
	}
	else {
		const value = remote ? evalResult : evalResult?.result
		const resultPart = await guardRunPart({ name: 'run-js-result', label: 'JS 结果', plain: util.inspect(value, { depth: 4 }), ansi: renderAnsiText(value) })
		contentParts.push(`结果：\n\n${resultPart.agent}`)
		showParts.push(`结果：\n\n${resultPart.show}`)
		if (elapsedText) {
			contentParts.push(`（耗时 ${elapsedText}）`)
			showParts.push(`（耗时 ${elapsedText}）`)
		}
	}
	const notice = formatTimeoutNotice({ timedOut, elapsedMs, waitForever: limits.waitForever, expectMs: limits.expectMs, toleranceMs: limits.toleranceMs, kind: 'js' })
	if (notice) {
		contentParts.push(notice.trim())
		showParts.push(notice.trim())
	}
	const failed = Boolean(timedOut || evalResult?.error)
	return { content: redactSecrets(contentParts.join('\n\n')), showParts, evalResult, failed }
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
		const executionTarget = jsExecutionTarget(args, attrs)
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

		await logCode(`${args.Charname} running JS code:`, call.inner, 'js')
		emit?.({ callId, phase: 'start', name, lang: 'js', code: call.inner })
		const outcome = await runWithBackgroundFallback({
			args, call, kind: 'js', executionTarget, limits, stream,
			execute: output => executeRunJs({ runtime, args, call, limits: { ...limits, timeoutMs: null }, remote, stream: output }),
		})
		emit?.({ callId, phase: 'end', name })
		if (!outcome) return { regen: true, pending: true }
		const { content, showParts, failed } = outcome
		AddLongTimeLog({
			name: 'code-execution.run-js',
			role: 'tool',
			content,
			content_for_show: buildResultShow({ lang: 'js', code: call.inner, body: showParts.join('\n\n') }),
			files: [],
			...targetExtension(executionTarget),
		})
		return { regen: true, ...failed ? { failed: true } : {} }
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
 * @param {Function} [options.onSpawn] 接收本机进程（供取消）。
 * @param {Function} [options.onStop] 接收远程取消回调。
 * @param {Function|null} options.stream - 流式输出回调（后台执行传 null）。
 * @returns {Promise<{fullOutput: string, rawOutput: string, showBody: string}>}
 *   完整结果文本（已去终端控制序列）、保留 ANSI 的原始输出、人类展示层结果区（ansi 代码块）。
 */
async function executeRunShell({ runtime, args, call, limits, shellName, stream, onSpawn, onStop }) {
	const chunks = []
	let shell_result
	try {
		shell_result = await runtime.executorFor(call.params).execShell(shellName, call.inner, {
			timeoutMs: limits.timeoutMs,
			onSpawn,
			onStop,
			/**
			 * 记录原始输出分片并转发给流式回调。
			 * @param {'stdout'|'stderr'} channel - 输出通道。
			 * @param {string} data - 分片文本。
			 * @returns {void}
			 */
			onOutput: (channel, data) => {
				chunks.push(String(data ?? ''))
				stream?.(channel, data)
			},
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
	const failed = Boolean(shell_result instanceof Error || timedOut || shell_result?.code || shell_result?.signal)
	if (shell_result instanceof Error) {
		fullOutput = '执行出错：\n' + (shell_result.stack || String(shell_result)) + notice
		showBody = fullOutput
	}
	else {
		// agent 层不含终端控制序列：优先用流式累积的原始输出以覆盖远程未清理的情形，再去序列、压缩连续重复行
		const buffered = shell_result?.stdall ?? [shell_result?.stdout, shell_result?.stderr].filter(Boolean).join('\n') ?? ''
		const output = dedupeConsecutiveLines(removeTerminalSequences(rawOutput || buffered)).text
		const header = `退出码 ${shell_result?.code ?? '(无)'}${shell_result?.signal ? `，信号 ${shell_result.signal}` : ''}${timedOut ? '（超时）' : ''}${elapsedText ? `，耗时 ${elapsedText}` : ''}：`
		fullOutput = header + '\n' + output + notice
		// 展示层保留原始 ANSI：用 ansi 代码块呈色
		showBody = header + '\n\n' + renderMarkdownCodeBlock(rawOutput || output, { lang: 'ansi' }) + (notice ? '\n' + notice.trim() : '')
	}
	return { fullOutput: redactSecrets(fullOutput), rawOutput, showBody, failed }
}

/**
 * 生成 `<run-<shell>>` 处理器（`async="true"` 时后台运行并登记统一异步任务）。
 * @param {string} shell_name - shell 名。
 * @param {(args: object, attrs: object) => Promise<string[]>} resolveShells - 解析目标机器可用 shell 的函数。
 * @returns {ReplyHandler_t} ReplyHandler
 */
function createRunShellReplyHandler(shell_name, resolveShells) {
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
			const shells = await resolveShells(args, call.params)
			if (!isShellUsable(shell_name, shells)) return rejectUnavailableShell(args, shell_name, shells)
			const runtime = getRuntime(reply, args)
			const attrs = call.params
			const executionTarget = executionTargetOf(resolveTarget(args, attrs))
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

			await logCode(`${args.Charname} running ${shell_name} code:`, call.inner, shell_name)
			emit?.({ callId, phase: 'start', name, lang: shell_name, code: call.inner })
			let child
			let remoteStop
			const local = !resolveTarget(args, attrs).remote
			const outcome = await runWithBackgroundFallback({
				args, call, kind: shell_name, executionTarget, limits, stream,
				stopHint: '需要时可 <stop-async id="任务id"/> 终止它的进程树。',
				/**
				 * 在任务自己的目标机器上终止进程树。
				 * @returns {Promise<void>} 终止请求完成。
				 */
				stop: async () => {
					if (!local) {
						if (!remoteStop) throw new Error('远程执行尚未就绪，请稍后重试。')
						return await remoteStop()
					}
					if (!child) throw new Error('进程尚未启动，请稍后重试。')
					if (child.exitCode !== null || child.signalCode !== null) return
					await killProcessTree(child)
				},
				/**
				 * 无生命周期限制地执行一次。
				 * @param {Function} output 输出回调。
				 * @returns {Promise<object>} 完成后的执行结果。
				 */
				execute: output => executeRunShell({
					runtime, args, call, limits: { ...limits, timeoutMs: null }, shellName: shell_name, stream: output,
					/** 记下本机进程，供停止使用。 @param {object} spawned 已 spawn 的进程。 @returns {void} 无返回值。 */
					onSpawn: spawned => { child = spawned },
					/** 记下远程取消回调，供停止使用。 @param {Function} stop 远程取消回调。 @returns {void} 无返回值。 */
					onStop: stop => { remoteStop = stop },
				}),
			})
			emit?.({ callId, phase: 'end', name })
			if (!outcome) return { regen: true, pending: true }
			const { fullOutput, showBody, failed } = outcome
			console.info(`${args.Charname} ${shell_name} result:`, runtime.execedCodes[call.inner])
			const guarded = await guardOutput(fullOutput, { name: `shell-${shell_name}`, label: 'shell 输出' })
			AddLongTimeLog({
				name: `code-execution.run-${shell_name}`,
				role: 'tool',
				content: guarded.text,
				content_for_show: buildResultShow({ lang: shell_name, code: call.inner, body: guarded.truncated ? renderAnsiBlock(guarded.text) : showBody }),
				files: [],
				...targetExtension(executionTarget),
			})
			return { regen: true, ...failed ? { failed: true } : {} }
		},
	})
}

/**
 * 生成 `<inline-<shell>>` 处理器。
 * @param {string} shell_name - shell 名。
 * @param {(args: object, attrs: object) => Promise<string[]>} resolveShells - 解析目标机器可用 shell 的函数。
 * @returns {ReplyHandler_t} ReplyHandler
 */
function createInlineShellReplyHandler(shell_name, resolveShells) {
	return defineReplyHandler({
		tag: `inline-${shell_name}`,
		evaluate: createInlineShellEvaluate(shell_name, resolveShells),
		display: inlineDisplay(shell_name),
		handle: createInlineHandle(shell_name),
	})
}

/**
 * 生成代码执行插件的全部 ReplyHandler。
 *
 * 为所有已注册执行器的 shell 都注册处理器（不在注册时按可用性过滤）：
 * 目标机器可能在运行时变化，启动早期 `available` 也尚未决议；可用性改在每次执行的 handle 内解析，
 * 不可用时回写失败日志引导模型改用其他 shell，而非让标签原样穿透到消息里。
 * @param {object} [options] - 选项。
 * @param {(args: object, attrs: object) => Promise<string[]>} [options.resolveShells] - 覆盖可用 shell 解析函数（测试注入）。
 * @param {Function} options.capture Monitor capture implementation (test injection).
 * @returns {ReplyHandler_t[]} ReplyHandler 列表
 */
export function getCodeExecutionReplyHandlers({ resolveShells = resolveAvailableShells, capture = captureMonitor } = {}) {
	const handlers = [runJsReplyHandler, inlineJsReplyHandler, createWaitScreenHandler(capture)]
	if (!isAsyncToolingEnabled()) handlers.push(...flattenReplyHandlers(asyncTaskReplyHandlers))
	for (const shell_name of registeredShellNames())
		handlers.push(
			createRunShellReplyHandler(shell_name, resolveShells),
			createInlineShellReplyHandler(shell_name, resolveShells),
		)
	return handlers
}

/**
 * 等待后截取目标机器与显示器的画面，写入角色时间线。
 * @param {Function} capture Monitor capture implementation.
 * @returns {ReplyHandler_t} 回复处理器。
 */
function createWaitScreenHandler(capture) {
	return defineReplyHandler({
		tag: 'wait-screen',
		/**
		 * 等待后截屏。
		 * @param {object} reply Current reply.
		 * @param {object} args Request context.
		 * @param {object} call Parsed tool call.
		 * @returns {Promise<object>} Handler outcome.
		 */
		handle: async (reply, args, call) => {
			const seconds = Number(call.params?.seconds ?? String(call.inner ?? '').trim())
			const monitor = Number(call.params?.monitor ?? 0)
			try {
				if (!Number.isFinite(seconds) || seconds < 0 || seconds > 3600)
					throw new Error('wait-screen seconds must be between 0 and 3600.')
				if (!Number.isInteger(monitor) || monitor < 0)
					throw new Error('wait-screen monitor must be a nonnegative integer.')
				if (seconds) await new Promise(resolve => setTimeout(resolve, seconds * 1000))
				const target = resolveTarget(args, call.params)
				const base64 = target.remote
					? await createArgsExecutorResolver(args)(call.params).execJs(`${captureMonitorSource}(${monitor})`)
					: await capture(monitor)
				args.AddLongTimeLog({ name: 'code-execution.wait-screen', role: 'tool', content: '已等待并截屏，内容见附件。', content_for_show: '已等待并截屏。',
					files: [{ name: 'screen.png', mime_type: 'image/png', buffer: Buffer.from(base64, 'base64') }],
					...targetExtension(executionTargetOf(target)),
				})
				return { regen: true }
			} catch (error) {
				const message = String(error?.message || error)
				args.AddLongTimeLog({ name: 'code-execution.wait-screen', role: 'tool', content: redactSecrets(message), content_for_show: renderMarkdownCodeBlock(message), files: [], extension: { error: true } })
				return { regen: true, failed: true }
			}
		},
	})
}
