/**
 * code shell 工作区钩子：读取 `.agents/fount/code.json` 的 `hooks`，在生成生命周期事件上运行 shell 命令。
 * 只支持 shell；事件数据经 `FOUNT_CODE_*` 环境变量传入；退出码非 0 视为失败，
 * 对「顶层 code 生成完毕」把 stdout+stderr 回灌给会话并触发重生成（带最大次数上限）。
 * 复杂工作流由工作区脚本自行用 shell 实现（见 `.agents/fount/hooks/`）。
 * @typedef {import('../../../../../decl/chatLog.ts').chatLogEntry_t} chatLogEntry_t
 */
import process from 'node:process'

import { launchDetachedProgram } from '../../../../../scripts/launch_external.mjs'
import { events } from '../../../../../server/events.mjs'
import { loadShellData } from '../../../../../server/setting_loader.mjs'

import { MAX_REGEN_ATTEMPTS, buildEnv, normalizeHooks } from './hooks_config.mjs'
import { runShellCommand } from './runner.mjs'
import { loadSession, saveSession } from './sessions.mjs'
import { readWorkspaceConfig } from './workspace_config.mjs'

/** 子代理运行终态。 */
const SUBAGENT_TERMINAL_STATES = new Set(['done', 'failed', 'terminated'])

/** 注入的运行回调（由 `setEndpoints` 提供，避免与 endpoints.mjs 循环依赖）。 */
let runtime = { regen: null }
/** @type {Map<string, number>} 工作区键 → 进行中的 agent 数（顶层 + 子代理）。 */
const activeByWork = new Map()
/** @type {Map<string, {machine: string, path: string}>} 工作区键 → 工作区信息。 */
const workInfo = new Map()
/** @type {Map<string, string>} `username\0sessionId` → 工作区键。 */
const sessionWork = new Map()
/** @type {Set<string>} 已开始计数的子代理运行 id。 */
const seenSubRuns = new Set()
/** @type {Set<string>} 已在运行的常驻（detached）命令键。 */
const runningSingletons = new Set()
/** 子代理事件监听是否已注册。 */
let subEventsRegistered = false

/**
 * 注入运行回调（由端点模块调用一次）。
 * @param {{regen: (username: string, ctx: object, content: string) => Promise<void>}} hooks - 回调集合。
 * @returns {void}
 */
export function setHookRuntime(hooks) {
	runtime = { ...runtime, ...hooks }
	ensureSubEvents()
}

/**
 * 组合键：`username\0sessionId`。
 * @param {string} username - 用户名。
 * @param {string} sessionId - 会话 id。
 * @returns {string} 键。
 */
function sessionKey(username, sessionId) {
	return username + '\u0000' + sessionId
}

/**
 * 组合键：`machine\0path`。
 * @param {string} machine - 机器标识。
 * @param {string} path - 工作区路径。
 * @returns {string} 键。
 */
function workKey(machine, path) {
	return String(machine ?? '0') + '\u0000' + String(path ?? '')
}

/**
 * 查工作区 id（供脚本回退 `fount run code --workspace` 使用）。
 * @param {string} username - 用户名。
 * @param {string} machine - 机器标识。
 * @param {string} path - 工作区路径。
 * @returns {string} 工作区 id（未登记时为空）。
 */
function findWorkspaceId(username, machine, path) {
	try {
		const list = loadShellData(username, 'code', 'workspaces')?.list ?? []
		const found = list.find(w => String(w.machine) === String(machine) && w.path === path)
		return found?.id || ''
	}
	catch { return '' }
}

/**
 * 在目标工作区运行一条 detached 命令（仅本机支持；经 `launch_external` 脱离进程树）。
 * @param {string} command - 命令。
 * @param {string} cwd - 工作目录。
 * @param {Record<string, string>} env - 环境变量。
 * @returns {Promise<void>}
 */
async function spawnDetached(command, cwd, env) {
	if (process.platform === 'win32') {
		const comspec = process.env.ComSpec || 'cmd.exe'
		await launchDetachedProgram({ command: comspec, args: ['/d', '/c', command], cwd, env, windowsHide: true })
	}
	else
		await launchDetachedProgram({ command: '/bin/sh', args: ['-c', command], cwd, env })
}

/**
 * 运行单条钩子条目。
 * @param {string} username - 用户名。
 * @param {{machine: string, path: string}} work - 工作区。
 * @param {object} entry - 钩子条目。
 * @param {object} envCtx - 事件上下文。
 * @returns {Promise<{code: number, output: string}|null>} 非 detached 的执行结果（detached/跳过时为 null）。
 */
async function runEntry(username, work, entry, envCtx) {
	const env = buildEnv(envCtx)
	if (entry.detached) {
		// detached 仅本机可脱离进程树；远程回退为非 detached 执行
		if (String(work.machine ?? '0') !== '0')
			return await runForeground(username, work, entry, env)
		const key = workKey(work.machine, work.path) + '\u0000' + entry.command
		if (entry.singleton && runningSingletons.has(key)) return null
		runningSingletons.add(key)
		try {
			await spawnDetached(entry.command, work.path, env)
		}
		catch (error) {
			runningSingletons.delete(key)
			console.warn('shells/code: detached 钩子启动失败', error)
		}
		return null
	}
	return await runForeground(username, work, entry, env)
}

/**
 * 前台运行单条钩子条目并归一结果。
 * @param {string} username - 用户名。
 * @param {{machine: string, path: string}} work - 工作区。
 * @param {object} entry - 钩子条目。
 * @param {Record<string, string>} env - 环境变量。
 * @returns {Promise<{code: number, output: string}>} 退出码与合并输出。
 */
async function runForeground(username, work, entry, env) {
	const result = await runShellCommand({
		username,
		machine: work.machine,
		workdir: work.path,
		shell: entry.shell,
		command: entry.command,
		env,
		timeoutMs: entry.timeoutMs ?? null,
	})
	const code = Number(result?.code ?? result?.exitCode ?? -1)
	const output = [result?.stdout, result?.stderr].filter(Boolean).join('\n') || String(result?.stdall ?? '')
	return { code, output }
}

/**
 * 读取并运行某事件的钩子列表；遇到首个失败即停止。
 * @param {string} username - 用户名。
 * @param {{machine: string, path: string}} work - 工作区。
 * @param {'agentStart'|'agentFinish'|'agentsIdle'} phase - 事件名。
 * @param {object} envCtx - 事件上下文。
 * @returns {Promise<{code: number, output: string}|null>} 首个失败结果（无失败时 null）。
 */
async function runHooks(username, work, phase, envCtx) {
	let config
	try {
		config = normalizeHooks(await readWorkspaceConfig(username, work))
	}
	catch (error) {
		console.warn('shells/code: 工作区钩子配置读取失败', error)
		return null
	}
	for (const entry of config[phase]) {
		const result = await runEntry(username, work, entry, envCtx)
		if (result && result.code !== 0) return result
	}
	return null
}

/**
 * 增加某工作区的活跃 agent 计数。
 * @param {string} key - 工作区键。
 * @returns {void}
 */
function incrementWork(key) {
	activeByWork.set(key, (activeByWork.get(key) || 0) + 1)
}

/**
 * 减少某工作区活跃计数；归零时运行 `agentsIdle` 钩子。
 * @param {string} username - 用户名。
 * @param {string} key - 工作区键。
 * @returns {Promise<void>}
 */
async function decrementWork(username, key) {
	const remaining = (activeByWork.get(key) || 0) - 1
	if (remaining > 0) {
		activeByWork.set(key, remaining)
		return
	}
	activeByWork.delete(key)
	const info = workInfo.get(key)
	if (!info) return
	await runHooks(username, info, 'agentsIdle', {
		event: 'agents-idle', kind: 'code', username,
		sessionId: '', conversationId: '', workspaceId: findWorkspaceId(username, info.machine, info.path),
		path: info.path, machine: info.machine, char: '', generationId: '', runId: '',
		success: '', error: '', attempt: 0,
	})
}

/**
 * 运行 `agentStart` 钩子（fire-and-forget）。
 * @param {string} username - 用户名。
 * @param {{machine: string, path: string}} work - 工作区。
 * @param {object} envCtx - 事件上下文。
 * @returns {void}
 */
function fireStartHooks(username, work, envCtx) {
	void runHooks(username, work, 'agentStart', envCtx).catch(error => console.warn('shells/code: agentStart 钩子失败', error))
}

/**
 * 顶层 code 生成开始：登记工作区、计数并触发 `agentStart`。
 * @param {string} username - 用户名。
 * @param {object} ctx - 上下文（machine/path/sessionId/char/generationId/runId）。
 * @returns {void}
 */
export function dispatchAgentStart(username, ctx) {
	const key = workKey(ctx.machine, ctx.path)
	const skey = sessionKey(username, ctx.sessionId)
	sessionWork.set(skey, key)
	workInfo.set(key, { machine: String(ctx.machine ?? '0'), path: String(ctx.path ?? '') })
	incrementWork(key)
	fireStartHooks(username, { machine: ctx.machine, path: ctx.path }, {
		event: 'agent-start', kind: 'code', username,
		sessionId: ctx.sessionId, conversationId: 'code-' + ctx.sessionId,
		workspaceId: findWorkspaceId(username, ctx.machine, ctx.path),
		path: ctx.path, machine: ctx.machine, char: ctx.char ?? '',
		generationId: ctx.generationId ?? '', runId: ctx.runId ?? '',
		success: '', error: '', attempt: 0,
	})
}

/**
 * 顶层 code 生成结束：运行 `agentFinish` 钩子；失败则回灌并触发重生成（带上限）；随后计数与 `agentsIdle`。
 * @param {string} username - 用户名。
 * @param {object} ctx - 上下文（machine/path/sessionId/char/generationId/runId/success/error/ai_source/profile）。
 * @returns {Promise<void>}
 */
export async function dispatchAgentFinish(username, ctx) {
	const key = workKey(ctx.machine, ctx.path)
	const work = { machine: String(ctx.machine ?? '0'), path: String(ctx.path ?? '') }
	const envCtx = {
		event: 'agent-finish', kind: 'code', username,
		sessionId: ctx.sessionId, conversationId: 'code-' + ctx.sessionId,
		workspaceId: findWorkspaceId(username, ctx.machine, ctx.path),
		path: ctx.path, machine: ctx.machine, char: ctx.char ?? '',
		generationId: ctx.generationId ?? '', runId: ctx.runId ?? '',
		success: ctx.success ? '1' : '0', error: ctx.error ? String(ctx.error) : '', attempt: 0,
	}
	const failure = await runHooks(username, work, 'agentFinish', envCtx)
	// 自动重生成次数随会话落盘（跨进程重启仍生效）；用户发消息时由 endpoints 清零。
	const session = work.path ? await loadSession(username, work, ctx.sessionId).catch(() => null) : null
	const attempt = Number(session?.regenAttempts) || 0
	if (failure) {
		if (attempt >= MAX_REGEN_ATTEMPTS) {
			console.warn(`shells/code: 工作区自动钩子连续失败 ${attempt} 次，停止回灌（会话 ${ctx.sessionId}）`)
			if (session) {
				delete session.regenAttempts
				await saveSession(username, work, session).catch(error => console.warn('shells/code: 重置自动回灌计数失败', error))
			}
		}
		else if (typeof runtime.regen === 'function') 
			try {
				// 计数由 regenCodeSession 写入会话文件，这里只把新值随上下文传过去。
				await runtime.regen(username, { ...ctx, attempt: attempt + 1 }, failure.output.slice(0, 20000))
			}
			catch (error) { console.warn('shells/code: 自动重生成触发失败', error) }
		
	}
	else if (session?.regenAttempts) {
		delete session.regenAttempts
		await saveSession(username, work, session).catch(error => console.warn('shells/code: 重置自动回灌计数失败', error))
	}
	await decrementWork(username, key)
}

/**
 * 注册子代理运行事件监听（经用户事件通道的 `subagent-run`，仅 code 会话）。
 * @returns {void}
 */
function ensureSubEvents() {
	if (subEventsRegistered) return
	subEventsRegistered = true
	events.on('send-event-to-user', ({ username, type, data }) => {
		if (type !== 'subagent-run' || typeof data?.chat_name !== 'string' || !data.chat_name.startsWith('code-'))
			return
		const sessionId = data.chat_name.slice('code-'.length)
		const key = sessionWork.get(sessionKey(username, sessionId))
		if (!key) return
		const info = workInfo.get(key)
		if (!info) return
		const runId = String(data.runId ?? '')
		if (!runId) return
		const state = String(data.state ?? '')
		if (!seenSubRuns.has(runId) && (state === 'running' || state === 'summarizing')) {
			seenSubRuns.add(runId)
			incrementWork(key)
			fireStartHooks(username, info, {
				event: 'agent-start', kind: 'subagent', username,
				sessionId, conversationId: data.chat_name,
				workspaceId: findWorkspaceId(username, info.machine, info.path),
				path: info.path, machine: info.machine, char: data.charId ?? '',
				generationId: runId, runId, success: '', error: '', attempt: 0,
			})
			return
		}
		if (seenSubRuns.has(runId) && SUBAGENT_TERMINAL_STATES.has(state)) {
			seenSubRuns.delete(runId)
			void (async () => {
				await runHooks(username, info, 'agentFinish', {
					event: 'agent-finish', kind: 'subagent', username,
					sessionId, conversationId: data.chat_name,
					workspaceId: findWorkspaceId(username, info.machine, info.path),
					path: info.path, machine: info.machine, char: data.charId ?? '',
					generationId: runId, runId, success: state === 'done' ? '1' : '0',
					error: data.error ? String(data.error) : '', attempt: 0,
				}).catch(error => console.warn('shells/code: 子代理 agentFinish 钩子失败', error))
				await decrementWork(username, key)
			})()
		}
	})
}
