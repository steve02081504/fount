/**
 * `!` shell 模式执行：在发起时快照会话 / 标签页 / 目标，所有输出与更新都回写到该快照；
 * 运行期间标记所在标签页忙碌，结束后清理逐帧更新句柄。
 */
import * as api from './endpoints.mjs'
import { setRuntimeStatus } from './generation.mjs'
import { appendLocalHistory } from './history.mjs'
import { appendEntryBubble, updateEntryBubble, updateShellStreamBubble } from './messages.mjs'
import { refreshAllSessions } from './session.mjs'
import { markSessionDirty } from './sessionPersistence.mjs'
import { activeTab, getActiveRuntime, getRuntime, store, tabKeyOf, target } from './store.mjs'
import { compactToolSummary } from '/parts/shells:chat/shared/toolSummary.mjs'

/**
 * 执行 `!` shell 命令并流式回显。
 * @param {string} command - 命令。
 * @returns {Promise<void>} 完成。
 */
export async function execShellMode(command) {
	const tab = activeTab()
	const tabKey = tab ? tabKeyOf(tab) : store.activeTabKey
	const runtime = getRuntime(tabKey, { create: true })
	if (!runtime || runtime.status !== 'idle') return
	const session = runtime.session || store.session
	if (!session) return
	appendLocalHistory('shell', command)
	// 快照执行目标：用户可能在命令结束前切换页面目标
	const execTarget = target()
	const shell = store.shell || ''
	const isActive = runtime === getActiveRuntime()
	setRuntimeStatus(runtime, 'submitting')
	const userEntry = {
		id: crypto.randomUUID().slice(0, 8),
		uid: 'user',
		role: 'user',
		name: store.username,
		content: '```' + shell + '\n' + command + '\n```',
		time: new Date().toISOString(),
	}
	session.entries.push(userEntry)
	if (isActive) appendEntryBubble(userEntry)
	const toolEntry = {
		id: crypto.randomUUID().slice(0, 8),
		uid: 'system',
		role: 'tool',
		name: 'shell',
		content: '',
		time: new Date().toISOString(),
		extension: {
			toolCall: { summary: compactToolSummary(command), state: 'pending' },
			shellStream: { command, shell, output: '' },
			executionTarget: { machine: execTarget.machine, workdir: execTarget.workdir || null },
		},
	}
	session.entries.push(toolEntry)
	if (isActive) appendEntryBubble(toolEntry)
	let frameHandle = 0
	/** 逐帧合并输出更新，避免每个数据块都触碰 DOM。 */
	const scheduleUpdate = () => {
		if (frameHandle) return
		frameHandle = requestAnimationFrame(() => {
			frameHandle = 0
			if (isActive) updateShellStreamBubble(toolEntry)
		})
	}
	const codeBlock = '```' + shell + '\n' + command + '\n```\n```\n'
	try {
		const result = await api.streamExec({ ...execTarget, shell: shell || undefined, command }, {
			/**
			 * 累积流式输出。
			 * @param {'stdout'|'stderr'} stream - 输出通道（当前统一按文本累积）。
			 * @param {string} data - 分片文本。
			 * @returns {void}
			 */
			onOutput: (stream, data) => {
				toolEntry.extension.shellStream.output += data
				scheduleUpdate()
			},
		})
		const exitCode = result.code ?? result.exitCode
		toolEntry.extension.toolCall.state = exitCode != null && Number(exitCode) !== 0 ? 'failed' : 'succeeded'
		// 未指定工作区时服务端回退到目标机器家目录：用实际目录补全执行目标快照
		if (result?.resolvedWorkdir && !toolEntry.extension.executionTarget.workdir)
			toolEntry.extension.executionTarget.workdir = String(result.resolvedWorkdir)
		toolEntry.content = codeBlock + (result.stdall ?? [result.stdout, result.stderr].filter(Boolean).join('\n'))
			+ '\n```' + (Number(result.elapsedMs) > 0 ? `（耗时 ${(result.elapsedMs / 1000).toFixed(2)}s）` : '')
	}
	catch (error) {
		toolEntry.extension.toolCall.state = 'failed'
		toolEntry.content = codeBlock + String(error?.message || error) + '\n```'
	}
	finally {
		if (frameHandle) cancelAnimationFrame(frameHandle)
		frameHandle = 0
	}
	delete toolEntry.extension.shellStream
	if (isActive) updateEntryBubble(toolEntry)
	session.updated = new Date().toISOString()
	setRuntimeStatus(runtime, 'idle')
	await markSessionDirty(session)
	void refreshAllSessions()
}
