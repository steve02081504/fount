/**
 * 将 ACP 客户端的全部能力封装为 fount 插件，供角色在回复中通过 XML 标签调用。
 *
 * 支持的能力（取决于 clientCapabilities）：
 * - fs.readTextFile  → <acp-read-file path="..." />
 * - fs.writeTextFile → <acp-write-file path="...">内容</acp-write-file>
 * - terminal         → <acp-terminal command="..." args="..." cwd="..." />
 *
 * 协议级功能（始终可用，通过 extension.acp 使用）：
 * - plan             → <acp-plan> 发送执行计划到 IDE
 * - thought          → <thinking>...</thinking> 发送思考内容到 IDE
 * - tool_call        → 每次工具调用报告 tool_call / tool_call_update 到 IDE
 * - permission       → 写文件/终端前请求用户授权
 */
import { defineToolUseBlocks } from '../../../../shells/chat/src/stream.mjs'

let toolCallCounter = 0

/**
 * 从 args.extension.acp 获取 ACP 上下文（connection + sessionId），可选。
 * @param {object} args - ReplyHandler 的 args。
 * @returns {{ connection: object, sessionId: string }|null} ACP 上下文或 null。
 */
function getACPContext(args) {
	return args?.extension?.acp ?? null
}

/**
 * 发送 ACP tool_call 通知（创建）。
 * @param {{ connection: object, sessionId: string }} acp - ACP 上下文。
 * @param {string} toolCallId - 工具调用 ID。
 * @param {string} title - 工具调用标题。
 * @param {string} kind - 工具类型（read|edit|execute|other）。
 */
function reportToolCallStart(acp, toolCallId, title, kind) {
	acp.connection.sessionUpdate({
		sessionId: acp.sessionId,
		update: { sessionUpdate: 'tool_call', toolCallId, title, kind, status: 'in_progress' },
	})
}

/**
 * 发送 ACP tool_call_update 通知（完成/失败）。
 * @param {{ connection: object, sessionId: string }} acp - ACP 上下文。
 * @param {string} toolCallId - 工具调用 ID。
 * @param {'completed'|'failed'} status - 状态。
 * @param {string} [text] - 结果文本。
 * @param {Array} [locations] - 关联的文件位置。
 */
function reportToolCallEnd(acp, toolCallId, status, text, locations) {
	const update = { sessionUpdate: 'tool_call_update', toolCallId, status }
	if (text) update.content = [{ type: 'content', content: { type: 'text', text } }]
	if (locations?.length) update.locations = locations
	acp.connection.sessionUpdate({ sessionId: acp.sessionId, update })
}

/**
 * 请求用户授权（写文件/终端等破坏性操作前）。
 * @param {{ connection: object, sessionId: string }} acp - ACP 上下文。
 * @param {string} toolCallId - 工具调用 ID。
 * @param {string} title - 请求标题。
 * @param {string} description - 请求描述。
 * @returns {Promise<boolean>} 是否获得允许。
 */
async function requestPermission(acp, toolCallId, title, description) {
	try {
		const result = await acp.connection.requestPermission({
			sessionId: acp.sessionId,
			toolCall: {
				toolCallId,
				title,
				kind: 'edit',
				status: 'pending',
				content: [{ type: 'content', content: { type: 'text', text: description } }],
			},
			options: [
				{ optionId: 'allow', name: 'Allow', kind: 'allow_once' },
				{ optionId: 'reject', name: 'Reject', kind: 'reject_once' },
			],
		})
		return result?.outcome?.outcome === 'selected' && result.outcome.optionId === 'allow'
	} catch (error) {
		console.error('requestPermission failed, defaulting to allow:', error)
		return true
	}
}

/**
 * 构建 ACP 客户端工具插件。
 * @param {import('npm:@agentclientprotocol/sdk').AgentSideConnection} connection - ACP 连接对象。
 * @param {string} sessionId - 当前会话 ID。
 * @param {object} [clientCapabilities] - 客户端在 initialize 时声明的能力。
 * @returns {object|null} 插件对象（无可用能力时返回 null）。
 */
export function buildACPClientToolsPlugin(connection, sessionId, clientCapabilities = {}) {
	const canRead = clientCapabilities.fs?.readTextFile === true
	const canWrite = clientCapabilities.fs?.writeTextFile === true
	const canTerminal = clientCapabilities.terminal === true

	if (!canRead && !canWrite && !canTerminal) return null

	// ── Prompt 描述 ──────────────────────────────────────────────────
	const promptLines = ['# ACP 客户端工具']
	if (canRead)
		promptLines.push(
			'', '## 读取文件',
			'从 IDE 读取文本文件（包括未保存的更改）。',
			'用法：`<acp-read-file path="/absolute/path" />`',
			'指定行范围：`<acp-read-file path="/absolute/path" line="10" limit="50" />`',
		)

	if (canWrite)
		promptLines.push(
			'', '## 写入文件',
			'在 IDE 中创建或覆盖文本文件。需要用户批准。',
			'用法：`<acp-write-file path="/absolute/path">文件内容</acp-write-file>`',
		)

	if (canTerminal)
		promptLines.push(
			'', '## 运行终端命令',
			'在 IDE 的终端中执行 shell 命令。需要用户批准。',
			'用法：`<acp-terminal command="npm" args="test --coverage" cwd="/project" />`',
			'- `command`（必需）：要运行的程序。',
			'- `args`（可选）：空格分隔的参数。',
			'- `cwd`（可选）：工作目录（绝对路径）。',
			'- `env`（可选）：逗号分隔的 KEY=VALUE 对。',
		)

	promptLines.push(
		'', '## 计划',
		'向 IDE 报告执行计划。每个条目包含内容、优先级（high/medium/low）和状态（pending/in_progress/completed）。',
		'用法：',
		'```',
		'<acp-plan>',
		'- [high] pending: 分析代码库',
		'- [medium] in_progress: 实现功能 X',
		'- [low] completed: 编写测试',
		'</acp-plan>',
		'```',
		'', '## 思考',
		'将推理/分析包装在 `<thinking>...</thinking>` 中，以在 IDE 中显示为思考气泡（不属于主要回复的一部分）。',
	)
	const promptText = promptLines.join('\n')

	// ── Preview Updater 块 ────────────────────────────────────────────
	const toolBlocks = [
		{ start: /<thinking>/, end: '</thinking>' },
		{ start: /<acp-plan>/, end: '</acp-plan>' },
	]
	if (canRead) toolBlocks.push({ start: /<acp-read-file[^>]*/, end: /\/>/ })
	if (canWrite) toolBlocks.push({ start: /<acp-write-file[^>]*>/, end: '</acp-write-file>' })
	if (canTerminal) toolBlocks.push({ start: /<acp-terminal[^>]*/, end: /\/>/ })

	// ── ReplyHandler ──────────────────────────────────────────────────
	/**
	 * 处理 AI 回复中的 ACP 工具调用。
	 * @param {object} reply - 回复对象。
	 * @param {object} args - ReplyHandler 参数。
	 * @returns {Promise<boolean>} 是否处理了工具调用。
	 */
	async function replyHandler(reply, args) {
		const text = reply.content || ''
		const acp = getACPContext(args)

		// ── <thinking> → thought_message_chunk ──
		const thinkingMatches = [...text.matchAll(/<thinking>([\S\s]*?)<\/thinking>/g)]
		for (const match of thinkingMatches)
			if (acp && match[1].trim())
				acp.connection.sessionUpdate({
					sessionId: acp.sessionId,
					update: { sessionUpdate: 'thought_message_chunk', content: { type: 'text', text: match[1].trim() } },
				})

		// ── <acp-plan> → plan notification ──
		const planMatches = [...text.matchAll(/<acp-plan>([\S\s]*?)<\/acp-plan>/g)]
		for (const match of planMatches)
			if (acp) {
				const entries = []
				for (const line of match[1].split('\n')) {
					const entryMatch = line.match(/^[*-]\s*\[(\w+)]\s*(\w+):\s*(.+)$/)
					if (entryMatch)
						entries.push({
							content: entryMatch[3].trim(),
							priority: entryMatch[1],
							status: entryMatch[2],
						})
				}
				if (entries.length)
					acp.connection.sessionUpdate({
						sessionId: acp.sessionId,
						update: { sessionUpdate: 'plan', entries },
					})
			}

		// ── 工具标签匹配 ──
		const readMatches = canRead
			? [...text.matchAll(/<acp-read-file\s+path="([^"]+)"(?:\s+line="(\d+)")?(?:\s+limit="(\d+)")?\s*\/>/g)]
			: []
		const writeMatches = canWrite
			? [...text.matchAll(/<acp-write-file\s+path="([^"]+)">([\S\s]*?)<\/acp-write-file>/g)]
			: []
		const terminalMatches = canTerminal
			? [...text.matchAll(/<acp-terminal\s+command="([^"]+)"(?:\s+args="([^"]*)")?(?:\s+cwd="([^"]*)")?(?:\s+env="([^"]*)")?\s*\/>/g)]
			: []

		const hasThinking = thinkingMatches.length > 0
		const hasPlan = planMatches.length > 0
		const hasTools = readMatches.length || writeMatches.length || terminalMatches.length

		if (!hasThinking && !hasPlan && !hasTools) return false

		// 仅有 thinking/plan 无需 re-generation
		if (!hasTools) return false

		const toolCallingLog = { name: reply.name, role: 'char', content: '', files: [] }
		let logAdded = false

		/**
		 * 添加工具调用日志。
		 * @param {string} fullMatch - 匹配的完整文本。
		 */
		function addCallLog(fullMatch) {
			toolCallingLog.content += fullMatch + '\n'
			if (!logAdded) {
				args.AddLongTimeLog(toolCallingLog)
				logAdded = true
			}
		}

		// ── fs read ──
		for (const match of readMatches) {
			addCallLog(match[0])
			const filePath = match[1]
			const line = match[2] ? parseInt(match[2], 10) : undefined
			const limit = match[3] ? parseInt(match[3], 10) : undefined
			const callId = `acp_read_${++toolCallCounter}`

			if (acp) reportToolCallStart(acp, callId, `Read ${filePath}`, 'read')
			try {
				const params = { sessionId, path: filePath }
				if (line != null) params.line = line
				if (limit != null) params.limit = limit
				const result = await connection.readTextFile(params)
				const content = result?.content ?? ''
				const locations = [{ path: filePath }]
				if (line != null) locations[0].line = line
				if (acp) reportToolCallEnd(acp, callId, 'completed', content, locations)
				args.AddLongTimeLog({
					role: 'tool', name: 'acp-read-file',
					content: `read_text_file ${filePath}:\n\`\`\`\n${content}\n\`\`\``,
					files: [],
				})
			} catch (error) {
				if (acp) reportToolCallEnd(acp, callId, 'failed', error.message)
				args.AddLongTimeLog({
					role: 'system', name: 'acp-read-file',
					content: `Error readTextFile "${filePath}": ${error.message}`,
					files: [],
				})
			}
		}

		// ── fs write (with permission) ──
		for (const match of writeMatches) {
			addCallLog(match[0])
			const filePath = match[1]
			const body = match[2]
			const callId = `acp_write_${++toolCallCounter}`

			if (acp) {
				const allowed = await requestPermission(acp, callId, `Write ${filePath}`, `Write ${body.length} chars to ${filePath}`)
				if (!allowed) {
					reportToolCallEnd(acp, callId, 'failed', 'User rejected')
					args.AddLongTimeLog({
						role: 'system', name: 'acp-write-file',
						content: `writeTextFile "${filePath}": rejected by user`,
						files: [],
					})
					continue
				}
				reportToolCallStart(acp, callId, `Write ${filePath}`, 'edit')
			}
			try {
				await connection.writeTextFile({ sessionId, path: filePath, content: body })
				if (acp) reportToolCallEnd(acp, callId, 'completed', `Wrote ${body.length} chars`, [{ path: filePath }])
				args.AddLongTimeLog({
					role: 'tool', name: 'acp-write-file',
					content: `write_text_file ${filePath}: ok (${body.length} chars)`,
					files: [],
				})
			} catch (error) {
				if (acp) reportToolCallEnd(acp, callId, 'failed', error.message)
				args.AddLongTimeLog({
					role: 'system', name: 'acp-write-file',
					content: `Error writeTextFile "${filePath}": ${error.message}`,
					files: [],
				})
			}
		}

		// ── terminal (with permission) ──
		for (const match of terminalMatches) {
			addCallLog(match[0])
			const command = match[1]
			const argsStr = match[2] || ''
			const cwd = match[3] || undefined
			const envStr = match[4] || ''
			const callId = `acp_term_${++toolCallCounter}`

			const termArgs = argsStr.split(/\s+/).filter(Boolean)
			const envVars = envStr.split(',')
				.map(pair => {
					const idx = pair.indexOf('=')
					return idx > 0 ? { name: pair.slice(0, idx).trim(), value: pair.slice(idx + 1).trim() } : null
				})
				.filter(Boolean)

			if (acp) {
				const allowed = await requestPermission(acp, callId, `Run: ${command} ${argsStr}`, `Execute "${command} ${argsStr}" in terminal`)
				if (!allowed) {
					reportToolCallEnd(acp, callId, 'failed', 'User rejected')
					args.AddLongTimeLog({
						role: 'system', name: 'acp-terminal',
						content: `terminal "${command} ${argsStr}": rejected by user`,
						files: [],
					})
					continue
				}
			}

			if (acp) reportToolCallStart(acp, callId, `$ ${command} ${argsStr}`, 'execute')
			try {
				const termParams = { sessionId, command, args: termArgs }
				if (cwd) termParams.cwd = cwd
				if (envVars.length) termParams.env = envVars
				const terminal = await connection.createTerminal(termParams)

				// 将终端嵌入 tool_call 内容以获得实时输出
				if (acp)
					acp.connection.sessionUpdate({
						sessionId: acp.sessionId,
						update: {
							sessionUpdate: 'tool_call_update', toolCallId: callId,
							content: [{ type: 'terminal', terminalId: terminal.id ?? callId }],
						},
					})

				const exitStatus = await terminal.waitForExit()
				const outputResult = await terminal.currentOutput()
				await terminal.release()

				const exitCode = exitStatus?.exitCode ?? exitStatus?.signal ?? 'unknown'
				const output = outputResult?.output ?? ''
				const truncated = outputResult?.truncated ? ' (truncated)' : ''

				if (acp) reportToolCallEnd(acp, callId, exitCode === 0 ? 'completed' : 'failed', `exit ${exitCode}${truncated}`)
				args.AddLongTimeLog({
					role: 'tool', name: 'acp-terminal',
					content: `$ ${command} ${argsStr}\nexit code: ${exitCode}${truncated}\n\`\`\`\n${output}\n\`\`\``,
					files: [],
				})
			} catch (error) {
				if (acp) reportToolCallEnd(acp, callId, 'failed', error.message)
				args.AddLongTimeLog({
					role: 'system', name: 'acp-terminal',
					content: `Error running "${command} ${argsStr}": ${error.message}`,
					files: [],
				})
			}
		}

		return true
	}

	/**
	 * GetPrompt 实现。
	 * @returns {Promise<object>} Prompt 数据。
	 */
	async function GetPrompt() {
		return {
			text: [{ content: promptText, important: 0 }],
			additional_chat_log: [],
			extension: {},
		}
	}

	return {
		info: {
			'': {
				name: 'acp_client_tools',
				avatar: '',
				description: 'ACP client tools: file system, terminal, plan, thinking',
				version: '0.0.0',
				tags: ['acp', 'fs', 'terminal', 'plan'],
			},
		},
		interfaces: {
			chat: {
				GetPrompt,
				GetReplyPreviewUpdater: defineToolUseBlocks(toolBlocks),
				ReplyHandler: replyHandler,
			},
		},
	}
}
