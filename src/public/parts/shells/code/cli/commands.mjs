import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'

import { API_PREFIX } from './client.mjs'
import { formatEntry, formatFileEdits } from './transcript.mjs'
/** 内建命令名，`/help` 与终端补全共用；参数写法只在这里维护一次。 */
export const CLI_COMMANDS = [
	'/help', '/new', '/sessions', '/session', '/rename', '/delete', '/chars', '/char', '/models', '/model',
	'/profile', '/commands', '/command', '/workspaces', '/workspace', '/workspace-add', '/workspace-rename',
	'/workspace-delete', '/machines', '/browse', '/search', '/file', '/shell', '/attach-file', '/attachments',
	'/remove-attachment', '/send', '/tasks', '/subagents', '/stop', '/attach', '/retry', '/regen', '/message',
	'/edit', '/feedback', '/copy', '/gist', '/export [--html]', '/diff [path]', '/retention', '/cleanup', '/power', '/exit',
]

/**
 * 按引号与空白切分一行命令。
 * @param {string} line - 输入行。
 * @returns {string[]} 参数数组（引号内保留空白，引号本身被去掉）。
 */
const words = line => [...line.matchAll(/"([^"]*)"|'([^']*)'|([^\s]+)/g)].map(match => match[1] ?? match[2] ?? match[3])
/**
 * 把值包装成文本结果。
 * @param {unknown} value - 待展示值。
 * @returns {{text: string}} 文本结果。
 */
const text = value => ({ text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) })
/** 附件队列总大小上限，与网页端一致（单文件 10 MiB，整体随 WS JSON 内嵌 base64）。 */
const ATTACHMENT_MAX_TOTAL_BYTES = 30 * 1024 * 1024
/**
 * base64 解码后的字节数（含 padding 取整）。
 * @param {string} buffer - base64 文本。
 * @returns {number} 字节数。
 */
const base64ByteLength = buffer => {
	const padding = buffer.endsWith('==') ? 2 : buffer.endsWith('=') ? 1 : 0
	return Math.floor(buffer.length * 3 / 4) - padding
}
/**
 * 附件队列当前总字节数。
 * @param {object[]} attachments - 附件队列。
 * @returns {number} 总字节数。
 */
const attachmentBytes = attachments => attachments.reduce((sum, item) => sum + base64ByteLength(item.buffer), 0)

/**
 * 执行一条 CLI 输入：`!` 前缀走 shell，`/` 前缀走内建或模板命令，其余作为普通消息发送。
 * @param {string} line - 原始输入行。
 * @param {object} [root0] - 运行上下文。
 * @param {object} [root0.client] - code CLI 客户端。
 * @param {(event: object) => void} [root0.onEvent] - 事件回调。
 * @param {AbortSignal} [root0.signal] - 中断信号。
 * @returns {Promise<object|undefined>} 命令结果（文本 / 列表 / 运行结果 / 退出标记）。
 */
export async function executeCommand(line, { client, onEvent = () => { }, signal } = {}) {
	const { state, transport, target } = client
	if (line.startsWith('!')) return shellCommand(line.slice(1).trim(), { client, onEvent, signal })
	if (!line.startsWith('/')) return client.run({ input: line, signal, onEvent })
	const [rawCommand, ...args] = words(line)
	const command = rawCommand.slice(1)
	const value = args.join(' ')
	switch (command) {
		case 'help': return text(CLI_COMMANDS.join(' '))
		case 'exit': case 'quit': return { exit: true }
		case 'new': await client.openSession(args[0] || randomUUID().slice(0, 8)); return text(`sessionId=${state.sessionId} workspaceId=${state.workspaceId}`)
		case 'sessions': return { items: await client.list(args[0] === 'all' ? 'all-sessions' : 'sessions', { query: args[0] === 'all' ? args.slice(1).join(' ') : value }) }
		case 'session':
			if (!args[0]) return text(`sessionId=${state.sessionId} workspaceId=${state.workspaceId}`)
			if (args[1]) await client.selectWorkspace(args[1])
			await client.openSession(args[0]); return text(`sessionId=${state.sessionId} workspaceId=${state.workspaceId}`)
		case 'rename': return mutateSession(client, session => { session.title = value }, 'renamed')
		case 'delete': {
			const id = args[0] || state.sessionId
			if (!id) throw new Error('session ID required')
			await transport.delete(`${API_PREFIX}/sessions/${encodeURIComponent(id)}?${new URLSearchParams(target())}`)
			if (id === state.sessionId) { state.sessionId = null; state.session = null }
			return text(`deleted session ${id}`)
		}
		case 'chars': return { items: await client.list('chars', { query: value }) }
		case 'char': {
			if (!value) return text(state.char || '')
			if (!(await client.list('chars')).includes(value)) throw new Error(`character not found: ${value}`)
			state.char = value; return text(value)
		}
		case 'models': return { items: await client.list('models', { query: value }) }
		case 'model': {
			if (!value) return text(state.model || 'char')
			if (value !== 'char' && !(await client.list('models')).includes(value)) throw new Error(`AI source not found: ${value}`)
			state.model = value === 'char' ? '' : value; return text(value)
		}
		case 'profile': {
			if (!value) return { items: await client.list('profiles') }
			if (!(await client.list('profiles')).some(item => item.name === value)) throw new Error(`profile not found: ${value}`)
			state.profile = value; return text(value)
		}
		case 'commands': return { items: await client.list('commands', { query: value }) }
		case 'command': return runTemplate(args, { client, onEvent, signal })
		case 'workspaces': return { items: await client.list('workspaces', { query: value }) }
		case 'workspace': {
			if (!value) return text(state.workspace)
			await client.selectWorkspace(args[0]); await client.openSession()
			return text(state.workspace)
		}
		case 'workspace-add': {
			if (!args[0]) throw new Error('path required')
			return text(await transport.post(`${API_PREFIX}/workspaces`, { path: args[0], machine: args[1] || '0', name: args[2] || args[0] }))
		}
		case 'workspace-rename': return text(await transport.put(`${API_PREFIX}/workspaces/${encodeURIComponent(args[0])}`, { name: args.slice(1).join(' ') }))
		case 'workspace-delete': return text(await transport.delete(`${API_PREFIX}/workspaces/${encodeURIComponent(args[0])}`))
		case 'machines': return { items: await client.list('machines', { query: value }) }
		case 'browse': return text(await transport.get(`${API_PREFIX}/machines/${encodeURIComponent(args[0] || state.workspace.machine)}/browse?${new URLSearchParams({ path: args[1] || '', workspace: state.workspace.path })}`))
		case 'search': return text(await transport.get(`${API_PREFIX}/files/search?${new URLSearchParams({ ...target(), q: value })}`))
		case 'file': return text(await transport.get(`${API_PREFIX}/file?${new URLSearchParams({ ...target(), path: value })}`))
		case 'shell': return args.length ? shellCommand(value, { client, onEvent, signal }) : text(await transport.get(`${API_PREFIX}/machines/${state.workspace.machine}/shells`))
		case 'attach-file': {
			if (!value) throw new Error('file path required')
			const file = await transport.get(`${API_PREFIX}/workspace/attachment?${new URLSearchParams({ ...target(), path: value })}`)
			if (attachmentBytes(state.attachments) + base64ByteLength(file.buffer) > ATTACHMENT_MAX_TOTAL_BYTES)
				throw new Error('attachments exceed the 30 MiB total limit')
			state.attachments.push(file)
			return text(`attached ${file.name}`)
		}
		case 'attachments': return { items: state.attachments }
		case 'remove-attachment': state.attachments = state.attachments.filter(item => item.name !== value); return text('removed')
		case 'send': {
			const result = await client.run({ input: value, files: state.attachments, onEvent, signal })
			if (result.status === 'done') state.attachments = []
			return result
		}
		case 'tasks': return { items: await client.list('tasks') }
		case 'subagents': return text(await transport.get(`/api/parts/shells:agent_studio/subagents?chatId=code-${state.sessionId}`))
		case 'stop': return text(await client.abort() ? 'stopping' : 'no active run')
		case 'attach': return client.attach({ signal, onEvent })
		case 'regen': return client.run({ type: 'regen', onEvent, signal })
		case 'retry': {
			const index = state.session?.entries?.findIndex(entry => entry.role === 'system' && entry.name === 'error') ?? -1
			if (index < 0) throw new Error('no failed message to retry')
			return client.run({ type: 'trigger', truncateAt: index, onEvent, signal })
		}
		case 'message': return text(findEntry(state.session, args[0]))
		case 'edit': return mutateSession(client, session => {
			const entry = findEntry(session, args[0])
			entry.content = args.slice(1).join(' ')
			delete entry.content_for_show
			delete entry.content_for_edit
		}, 'edited')
		case 'feedback': return mutateSession(client, session => {
			if (!['up', 'down'].includes(args[1])) throw new Error('feedback must be up or down')
			const entry = findEntry(session, args[0]); entry.extension ??= {}
			if (entry.extension.feedback?.type === args[1] && args.length === 2) delete entry.extension.feedback
			else entry.extension.feedback = { type: args[1], content: args.slice(2).join(' '), time: new Date().toISOString() }
		}, 'feedback saved')
		case 'copy': {
			const entry = findEntry(state.session, args[0])
			const content = entry.content_for_show ?? entry.content
			return { text: content, copy: content }
		}
		case 'gist': return saveGist(args[0], { client })
		case 'export': {
			const entries = state.session?.entries || []
			const content = args.includes('--html')
				? (await import('./export_html.mjs')).transcriptHtml(entries, {
					title: state.session?.title || `code session ${state.sessionId}`,
					locale: client.locale,
				})
				: entries.map(entry => formatEntry(entry, { includeUser: true })).filter(Boolean).join('\n')
			const path = args.find(argument => argument !== '--html')
			if (path) { await writeFile(path, content); return text(path) }
			return text(content)
		}
		case 'diff': return text(formatFileEdits(state.session?.entries || [], value))
		case 'retention': return args[0] == null ? text(await transport.get(`${API_PREFIX}/retention`)) : text(await transport.put(`${API_PREFIX}/retention`, { days: Number(args[0]) }))
		case 'cleanup': return text(await transport.post(`${API_PREFIX}/sessions/cleanup`, {}))
		case 'power': return text(args.length ? await transport.put(`${API_PREFIX}/shutdown`, { machine: args[0], action: args[1] || null }) : await transport.get(`${API_PREFIX}/shutdown`))
		default: {
			if ((await client.list('commands')).some(item => item.name === command)) return runTemplate([command, ...args], { client, onEvent, signal })
			throw new Error(`unknown command: ${command}`)
		}
	}
}

/**
 * 按 ID 或下标定位会话条目。
 * @param {object} session - 会话对象。
 * @param {string|number} id - 条目 ID 或下标。
 * @returns {object} 命中的条目。
 */
function findEntry(session, id) {
	const entry = session?.entries?.find(item => String(item.id) === id) || session?.entries?.[Number(id)]
	if (!entry) throw new Error(`message not found: ${id}`)
	return entry
}

/**
 * 读取最新会话、就地修改并带版本号写回，冲突由服务端拒绝。
 * @param {object} client - code CLI 客户端。
 * @param {(session: object) => void} mutate - 就地修改会话的回调。
 * @param {string} result - 成功后的提示文案。
 * @returns {Promise<{text: string}>} 文本结果。
 */
async function mutateSession(client, mutate, result) {
	const { transport, target } = client
	const session = await client.refreshSession()
	mutate(session)
	session.updated = new Date().toISOString()
	const saved = await transport.put(`${API_PREFIX}/sessions/${encodeURIComponent(session.id)}`, { ...target(), session, expectedVersion: session.version ?? 0 })
	session.version = saved.version
	return text(result)
}

/**
 * 渲染并运行一个自定义斜杠命令模板。
 * @param {string[]} argv - 命令名与参数。
 * @param {object} root0 - 运行上下文。
 * @param {object} root0.client - code CLI 客户端。
 * @param {(event: object) => void} [root0.onEvent] - 事件回调。
 * @param {AbortSignal} [root0.signal] - 中断信号。
 * @returns {Promise<object>} 运行结果。
 */
async function runTemplate(argv, { client, onEvent, signal }) {
	const [name, ...args] = argv
	if (!name) throw new Error('command name required')
	const rendered = await client.transport.post(`${API_PREFIX}/commands/render`, { ...client.target(), name, argv: args })
	return client.run({ input: rendered.content, onEvent, signal })
}

/**
 * 通过 exec WS 执行用户 shell 命令，并把结果按既有语义写入会话。
 * @param {string} command - 待执行命令。
 * @param {object} root0 - 运行上下文。
 * @param {object} root0.client - code CLI 客户端。
 * @param {(event: object) => void} [root0.onEvent] - 事件回调。
 * @param {AbortSignal} [root0.signal] - 中断信号。
 * @returns {Promise<{text: string}>} 文本结果。
 */
async function shellCommand(command, { client, onEvent, signal }) {
	if (!command) throw new Error('shell command required')
	const id = randomUUID()
	let output = ''
	/**
	 * 累积流式输出并转发临时工具事件。
	 * @param {object} frame - exec WS 帧。
	 * @returns {void} 无返回值。
	 */
	const onFrame = frame => { if (frame.type === 'output') { output += frame.data; onEvent({ type: 'tool-output', ...frame }) } }
	const result = await client.transport.stream('/ws/parts/shells:code/exec', { id, command, ...client.target() }, { signal, onFrame })
	if (result.type === 'error') throw new Error(result.error)
	await mutateSession(client, session => {
		session.entries.push({ id: randomUUID(), role: 'user', uid: 'user', name: client.state.username, content: `\`\`\`\n${command}\n\`\`\``, time: new Date().toISOString() })
		session.entries.push({
			id, role: 'tool', uid: 'system', name: 'shell', content: output,
			time: new Date().toISOString(), extension: { toolCall: { summary: command, state: Number(result.code ?? result.exitCode) ? 'failed' : 'succeeded' }, executionTarget: client.target() }
		})
	}, 'shell result saved')
	return text(result)
}

/**
 * 把一条消息保存为 gist。
 * @param {string|number} id - 条目 ID 或下标。
 * @param {object} root0 - 运行上下文。
 * @param {object} root0.client - code CLI 客户端。
 * @returns {Promise<{text: string}>} 文本结果。
 */
async function saveGist(id, { client }) {
	const entry = findEntry(client.state.session, id)
	const markdown = entry.content_for_show ?? entry.content
	const body = {
		title: markdown.split(/\r?\n/).find(line => line.trim())?.slice(0, 60) || 'code message', markdown,
		securityLevel: 'trusted', source: { type: 'code', ref: { sessionId: client.state.sessionId, entryId: entry.id, role: entry.role }, exportedAt: Date.now() }
	}
	return text(await client.transport.post('/api/parts/shells:gist/gists', body))
}
