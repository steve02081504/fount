/**
 * code shell 后端端点：机器/工作区/会话/命令/AI 源 + AI 会话 WS。
 */
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'

import { httpError } from '../../../../../scripts/http_error.mjs'
import { authenticate, getUserByReq } from '../../../../../server/auth/index.mjs'
import { getAllDefaultParts, getPartList } from '../../../../../server/parts_loader.mjs'
import { loadShellData, saveShellData, assignShellData } from '../../../../../server/setting_loader.mjs'
import { createTargetExecutor, listMachines } from '../../../plugins/file-operations/src/target.mjs'

import {
	getCommand,
	listCommands,
	listProfiles,
	readFileWithContext,
	renderCommand,
	resolveCommandArgs,
	searchWorkspaceFiles,
} from './context.mjs'
import { triggerCodeReply } from './request.mjs'
import { availableShells, runShellCommand } from './runner.mjs'
import { deleteSession, listSessions, loadSession, saveSession } from './sessions.mjs'

/**
 * 从请求参数解析目标工作区（machine 字符串化，"0" = 本机）。
 * @param {{machine?: string|number, workdir?: string, workspace?: string}} source - 请求数据。
 * @returns {{machine: string, path: string}} 目标工作区。
 */
function parseWorkdir(source) {
	const machine = String(source?.machine ?? '0')
	const path = String(source?.workdir ?? source?.workspace ?? '')
	return { machine, path }
}

/**
 * 读取保存的工作区列表（shell data）。
 * @param {string} username - 用户名。
 * @returns {{list: Array<{id: string, name: string, machine: string, path: string}>}} 工作区列表。
 */
function getWorkspaces(username) {
	const data = loadShellData(username, 'code', 'workspaces') ?? {}
	data.list ??= []
	return data
}

/**
 * 读取 AI 源可见性配置（shell data）。
 * @param {string} username - 用户名。
 * @returns {{hidden: string[]}} 可见性配置。
 */
function getAiSourceVisibility(username) {
	const data = loadShellData(username, 'code', 'ai_source_visibility') ?? {}
	data.hidden ??= []
	return data
}

/**
 * 将 tool 日志条目规整为可持久化形状（buffer 转 base64 字符串）。
 * @param {object} entry - chatLogEntry_t 形状的条目。
 * @returns {object} 规整后的条目。
 */
function sanitizeEntry(entry) {
	return {
		id: entry.id || randomUUID(),
		uid: entry.uid || (entry.role === 'char' ? 'char' : entry.role === 'user' ? 'user' : 'system'),
		role: entry.role,
		name: entry.name || '',
		content: entry.content_for_show || entry.content || '',
		time: entry.time_stamp instanceof Date ? entry.time_stamp.toISOString() : String(entry.time_stamp ?? new Date().toISOString()),
		files: (entry.files || []).map(f => ({ name: f.name, mime_type: f.mime_type, buffer: Buffer.isBuffer(f.buffer) ? f.buffer.toString('base64') : String(f.buffer ?? ''), description: f.description || '' })),
		extension: {},
	}
}

/**
 * 设置 API 端点。
 * @param {object} router - Express 的路由实例。
 */
export function setEndpoints(router) {
	// 机器列表（含本机与已连接 subfount）
	router.get('/api/parts/shells\\:code/machines', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		res.json({ machines: await listMachines(username) })
	})

	// 机器可用 shell 列表
	router.get('/api/parts/shells\\:code/machines/:id/shells', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const machine = req.params.id
		res.json({ shells: await availableShells(username, machine) })
	})

	// 文件夹浏览（根 = 盘符 / `/`）
	router.get('/api/parts/shells\\:code/machines/:id/browse', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const machine = req.params.id
		const executor = createTargetExecutor(username, { machine })
		const path = String(req.query.path || '')
		if (!path) {
			const roots = await executor.listRoots()
			res.json({ path: '', roots, entries: roots.map(root => ({ name: root, path: root, isDirectory: true, isFile: false })) })
			return
		}
		const entries = await executor.listDir(path)
		res.json({
			path,
			roots: [],
			entries: entries.map(e => ({
				name: e.name,
				path: path.replace(/[\\/]+$/, '') + '/' + e.name,
				isDirectory: e.isDirectory,
				isFile: e.isFile,
			})),
		})
	})

	// 保存的工作区 CRUD
	router.get('/api/parts/shells\\:code/workspaces', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		res.json(getWorkspaces(username))
	})

	router.post('/api/parts/shells\\:code/workspaces', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const { name, machine = '0', path } = req.body || {}
		if (!path) throw httpError(400, 'path is required.')
		const data = getWorkspaces(username)
		const workspace = { id: randomUUID().slice(0, 8), name: name || path, machine: String(machine ?? '0'), path }
		if (data.list.some(w => w.path === path && w.machine === workspace.machine))
			throw httpError(400, 'workspace already exists.')
		data.list.push(workspace)
		saveShellData(username, 'code', 'workspaces', data)
		res.json(data)
	})

	router.put('/api/parts/shells\\:code/workspaces/:id', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const data = getWorkspaces(username)
		const workspace = data.list.find(w => w.id === req.params.id)
		if (!workspace) throw httpError(404, 'workspace not found.')
		if (req.body?.name != null) workspace.name = String(req.body.name)
		saveShellData(username, 'code', 'workspaces', data)
		res.json(data)
	})

	router.delete('/api/parts/shells\\:code/workspaces/:id', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const data = getWorkspaces(username)
		data.list = data.list.filter(w => w.id !== req.params.id)
		saveShellData(username, 'code', 'workspaces', data)
		res.json(data)
	})

	// `!` 模式 shell 执行
	router.post('/api/parts/shells\\:code/exec', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const { command, shell } = req.body || {}
		if (!command) throw httpError(400, 'command is required.')
		const { machine, path: workdir } = parseWorkdir(req.body || {})
		res.json(await runShellCommand({ username, machine, workdir, shell, command }))
	})

	// 文件搜索（@ 文件补全）
	router.get('/api/parts/shells\\:code/files/search', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const { machine, path } = parseWorkdir(req.query)
		const query = String(req.query.q || '')
		if (!query || !path) {
			res.json({ files: [] })
			return
		}
		res.json({ files: await searchWorkspaceFiles(username, { machine, path }, query) })
	})

	// 读文件（附带向上上下文）
	router.get('/api/parts/shells\\:code/file', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const { machine, path } = parseWorkdir(req.query)
		const filePath = String(req.query.path || '')
		if (!filePath) throw httpError(400, 'path is required.')
		res.json(await readFileWithContext(username, { machine, path }, filePath))
	})

	// profile / commands（合并列表）
	router.get('/api/parts/shells\\:code/profiles', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const { machine, path } = parseWorkdir(req.query)
		const workdir = path ? { machine, path } : undefined
		const profiles = (await listProfiles(username, workdir)).map(p => ({ name: p.name, source: p.source, description: p.description }))
		res.json({ profiles, commands: await listCommands(username, workdir) })
	})

	// 渲染命令模板（内联 shell/js 在目标机器执行）
	router.post('/api/parts/shells\\:code/commands/render', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const { name, argv } = req.body || {}
		const { machine, path } = parseWorkdir(req.body || {})
		if (!name) throw httpError(400, 'name is required.')
		const command = await getCommand(username, { machine, path }, name)
		if (!command) throw httpError(404, `command not found: ${name}`)
		const executor = createTargetExecutor(username, { machine, workdir: path })
		res.json({ content: await renderCommand(command, resolveCommandArgs(command, argv), executor) })
	})

	// AI 源列表与可见性
	router.get('/api/parts/shells\\:code/aisources', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		res.json({
			sources: getPartList(username, 'serviceSources/AI'),
			defaults: getAllDefaultParts(username, 'serviceSources/AI'),
			hidden: getAiSourceVisibility(username).hidden,
		})
	})

	router.put('/api/parts/shells\\:code/aisources/visibility', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const hidden = Array.isArray(req.body?.hidden) ? req.body.hidden.map(String) : []
		assignShellData(username, 'code', 'ai_source_visibility', { hidden })
		res.json({ hidden })
	})

	// 会话存取（前端为唯一写入方；存于工作区 .fount/code/sessions）
	router.get('/api/parts/shells\\:code/sessions', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const { machine, path } = parseWorkdir(req.query)
		res.json({ sessions: await listSessions(username, { machine, path }) })
	})

	router.post('/api/parts/shells\\:code/sessions', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const { machine, path } = parseWorkdir(req.body || {})
		await saveSession(username, { machine, path }, req.body?.session)
		res.json({})
	})

	router.get('/api/parts/shells\\:code/sessions/:id', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const { machine, path } = parseWorkdir(req.query)
		const session = await loadSession(username, { machine, path }, req.params.id)
		if (!session) throw httpError(404, 'session not found.')
		res.json(session)
	})

	router.put('/api/parts/shells\\:code/sessions/:id', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const { machine, path } = parseWorkdir(req.body || {})
		if (req.body?.session?.id !== req.params.id) throw httpError(400, 'session id mismatch.')
		await saveSession(username, { machine, path }, req.body.session)
		res.json({})
	})

	router.delete('/api/parts/shells\\:code/sessions/:id', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const { machine, path } = parseWorkdir(req.query)
		await deleteSession(username, { machine, path }, req.params.id)
		res.json({})
	})

	// AI 会话 WS：send / abort → preview / done / error
	router.ws('/ws/parts/shells\\:code/session', authenticate, async (ws, req) => {
		const { username } = getUserByReq(req)
		/** @type {AbortController|null} */
		let controller = null

		ws.on('close', () => {
			controller?.abort()
			controller = null
		})

		ws.on('message', async raw => {
			let msg
			try {
				msg = JSON.parse(String(raw))
			}
			catch {
				return
			}
			if (msg.type === 'abort') {
				controller?.abort()
				return
			}
			if (msg.type !== 'send') return

			const { session, machine = 0, workdir, ai_source, profile, content } = msg
			if (!session || !content) {
				ws.send(JSON.stringify({ type: 'error', error: 'session and content are required.' }))
				return
			}
			controller = new AbortController()
			const userEntry = sanitizeEntry({ role: 'user', name: username, content, uid: 'user', time_stamp: new Date() })
			try {
				const { reply, memory } = await triggerCodeReply({
					username,
					session: { ...session, entries: [...session.entries || [], { ...userEntry, time: userEntry.time }] },
					machine: String(machine ?? '0'),
					workdir: String(workdir || ''),
					ai_source: ai_source || undefined,
					profile,
					signal: controller.signal,
					/**
					 * 转发流式预览到 WS。
					 * @param {object} reply - 预览回复。
					 */
					onPreview: reply => {
						try { ws.send(JSON.stringify({ type: 'preview', content: reply.content || '' })) }
						catch { /* 连接已关闭 */ }
					},
				})
				const entries = [userEntry]
				for (const entry of reply?.logContextBefore || [])
					entries.push(sanitizeEntry(entry))
				if (reply)
					entries.push(sanitizeEntry({ ...reply, role: 'char', uid: 'char', name: reply.name || session.charname, time_stamp: new Date() }))
				ws.send(JSON.stringify({ type: 'done', entries, memory }))
			}
			catch (error) {
				if (controller.signal.aborted)
					ws.send(JSON.stringify({ type: 'aborted', entries: [userEntry] }))
				else
					ws.send(JSON.stringify({ type: 'error', entries: [userEntry], error: String(error?.stack || error) }))
			}
			finally {
				controller = null
			}
		})
	})
}
