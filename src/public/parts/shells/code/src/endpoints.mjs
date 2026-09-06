/**
 * code shell 后端端点：机器/工作区/会话/命令/AI 源 + AI 会话 WS。
 */
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'

import { httpError } from '../../../../../scripts/http_error.mjs'
import { authenticate, getUserByReq } from '../../../../../server/auth/index.mjs'
import { getAllDefaultParts, getPartList } from '../../../../../server/parts_loader.mjs'
import { loadShellData, saveShellData, assignShellData } from '../../../../../server/setting_loader.mjs'
import { createTargetExecutor, listMachines, parseVolumeLabels } from '../../../plugins/file-operations/src/target.mjs'

import {
	getCommand,
	listCommands,
	listProfiles,
	readFileWithContext,
	renderCommand,
	resolveCommandArgs,
	searchWorkspaceFiles,
} from './context.mjs'
import { collectEditorSources } from './editor_sources.mjs'
import { appendOwnHistory, getHistory } from './history.mjs'
import { triggerCodeReply } from './request.mjs'
import { availableShells, machineDefaultShell, runShellCommand } from './runner.mjs'
import { deleteSession, listSessions, loadSession, saveSession } from './sessions.mjs'
import { readWorkspaceConfig } from './workspace_config.mjs'

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
 * 递归扫描工作区下含 `.git` 的子目录（自包含 lambda 在目标机器执行，深度≤4、条目≤100）。
 * @param {string} username - 用户名。
 * @param {string} machine - 目标机器标识。
 * @param {string} root - 工作区路径。
 * @returns {Promise<Array<{name: string, path: string}>>} 含 `.git` 的子目录。
 */
async function findGitDirs(username, machine, root) {
	const executor = createTargetExecutor(username, { machine })
	return await executor.execJs(async (root, maxDepth, maxCount) => {
		const fs = await import('node:fs/promises')
		const path = await import('node:path')
		/** @type {string[]} 收集到的 git 目录。 */
		const out = []
		/** @type {Set<string>} 已访问目录（防环）。 */
		const seen = new Set()
		/**
		 * 递归收集含 .git 的目录。
		 * @param {string} dir - 当前目录。
		 * @param {number} depth - 当前深度。
		 * @returns {Promise<void>}
		 */
		async function walk(dir, depth) {
			if (out.length >= maxCount || depth > maxDepth || seen.has(dir)) return
			seen.add(dir)
			let entries
			try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return }
			for (const e of entries) {
				if (out.length >= maxCount) return
				if (!e.isDirectory() || e.name === '.git' || e.name === 'node_modules' || e.name === '.venv') continue
				const full = path.join(dir, e.name)
				try {
					await fs.access(path.join(full, '.git'))
					out.push(full)
					if (out.length >= maxCount) return
				}
				catch { /* 无 .git 则继续下探 */ }
				await walk(full, depth + 1)
			}
		}
		await walk(root, 0)
		return out.map(p => ({ name: path.basename(p), path: p }))
	}, root, 4, 100)
}

/**
 * 查询目标机器（Windows）各盘符卷标，供根视图展示盘的名字。
 * @param {string} username - 用户名。
 * @param {string} machine - 目标机器标识。
 * @returns {Promise<Record<string, string>>} 盘符根 → 卷标（失败/非 Windows/无 pwsh 时为空对象）。
 */
async function getVolumeLabels(username, machine) {
	try {
		const platform = listMachines(username).find(m => m.id === String(machine))?.deviceInfo?.os?.platform
		if (platform !== 'win32') return {}
		const shells = await availableShells(username, machine)
		const shell = shells.includes('pwsh') ? 'pwsh' : shells.includes('powershell') ? 'powershell' : null
		if (!shell) return {}
		const executor = createTargetExecutor(username, { machine })
		const result = await executor.execShell(shell, '@(Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID, VolumeName) | ConvertTo-Json -Compress')
		return parseVolumeLabels(result?.stdout ?? result?.stdall ?? '')
	}
	catch { return {} }
}

/**
 * 为盘符根视图构建快速访问列表（工作区兄弟目录 + 工作区下含 `.git` 的子目录 + 编辑器常用项目）。
 * 编辑器常用项目不依赖活动工作区，无工作区时也作为「最近项目」推荐。
 * @param {string} username - 用户名。
 * @param {string} machine - 目标机器标识。
 * @param {string} workspacePath - 当前工作区路径（可为空）。
 * @returns {Promise<Array<{name: string, path: string, isDirectory: boolean}>>} 快速访问条目（按 path 去重）。
 */
async function buildQuickAccess(username, machine, workspacePath) {
	const executor = createTargetExecutor(username, { machine })
	/** @type {Array<{name: string, path: string}>} 候选条目（保持来源顺序）。 */
	const candidates = []
	/** @type {Set<string>} 已收录字符串路径（源内粗去重，防同源重复）。 */
	const rawSeen = new Set()
	/**
	 * 收集候选（源内按字符串路径粗去重）。
	 * @param {{name: string, path: string}} entry - 候选条目。
	 * @returns {void}
	 */
	const collect = entry => {
		if (!entry?.path || rawSeen.has(entry.path)) return
		rawSeen.add(entry.path)
		candidates.push(entry)
	}
	const cleaned = workspacePath ? String(workspacePath).replace(/[\\/]+$/, '') : ''
	if (cleaned) {
		// 兄弟目录：工作区父目录下其他文件夹（排除工作区自身；目标机器本地路径拼接）
		try {
			const siblings = await executor.execJs(async (workspacePath) => {
				const fs = await import('node:fs/promises')
				const path = await import('node:path')
				/** @type {Array<{name: string, path: string}>} 兄弟目录。 */
				const out = []
				let entries
				try { entries = await fs.readdir(path.dirname(workspacePath), { withFileTypes: true }) } catch { return out }
				for (const e of entries)
					if (e.isDirectory() && e.name !== path.basename(workspacePath))
						out.push({ name: e.name, path: path.join(path.dirname(workspacePath), e.name) })
				return out
			}, cleaned)
			for (const item of siblings) collect(item)
		}
		catch { /* 父目录不可读则跳过兄弟目录 */ }
		// 工作区下含 .git 的子目录（有限深度）
		try {
			for (const item of await findGitDirs(username, machine, cleaned)) collect(item)
		}
		catch { /* git 扫描失败则跳过 */ }
	}
	// 编辑器常用项目（VS Code / Notepad++ / JetBrains；已按最后活跃排序；无活动工作区也作为推荐）
	try {
		for (const item of await collectEditorSources(username, machine)) collect(item)
	}
	catch { /* 编辑器源失败则跳过 */ }
	if (!candidates.length) return []
	// 目标机器上已有的工作区路径（当前 machine）也参与去重，避免重复添加
	const existingWorkspaces = getWorkspaces(username).list
		.filter(w => String(w.machine) === String(machine))
		.map(w => w.path)
	try {
		// 统一 realpath 去重：排除已有工作区，同一真实目录保留更短路径名，保持来源顺序
		return await executor.execJs(async (items, excludes) => {
			const fs = await import('node:fs/promises')
			/** @type {Map<string, {name: string, path: string}>} realpath → 条目。 */
			const seen = new Map()
			/**
			 * 解析真实路径（规范化分隔符）。
			 * @param {string} p - 原始路径。
			 * @returns {Promise<string|null>} realpath（失败时 null）。
			 */
			const realOf = async p => {
				try { return (await fs.realpath(p)).replace(/\\/g, '/').replace(/\/+$/, '') }
				catch { return null }
			}
			for (const p of excludes) {
				const real = await realOf(p)
				if (real) seen.set(real, { name: '', path: p }) // 占位：已存在工作区
			}
			/** @type {Array<{name: string, path: string}>} 去重后条目（保持输入顺序）。 */
			const out = []
			for (const item of items) {
				const real = await realOf(item.path)
				if (!real) continue
				const existing = seen.get(real)
				if (existing) {
					if (item.path.length < existing.path.length) {
						seen.set(real, item)
						const idx = out.indexOf(existing)
						if (idx !== -1) out[idx] = item
					}
					continue
				}
				seen.set(real, item)
				out.push(item)
			}
			return out
		}, candidates, existingWorkspaces).then(list => list.map(item => ({ ...item, isDirectory: true })))
	}
	catch { /* 去重失败则退回字符串去重结果 */ }
	return candidates.map(item => ({ ...item, isDirectory: true }))
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
 * 读取打开的标签页列表与活动标签（shell data；含草稿与未发送草稿内容）。
 * @param {string} username - 用户名。
 * @returns {{tabs: Array<{type: string, id: string, workspaceId: string, draft?: string}>, activeTab: string}} 标签页数据。
 */
function getTabs(username) {
	const data = loadShellData(username, 'code', 'tabs') ?? {}
	data.tabs ??= []
	data.activeTab ??= ''
	return data
}

/**
 * 规整标签页对象（仅保留已知字段，校验 id/type）。
 * @param {object} tab - 待规整的标签页。
 * @returns {object|null} 规整后的标签页（非法时 null）。
 */
function sanitizeTab(tab) {
	if (!tab || typeof tab !== 'object') return null
	if (!['draft', 'session'].includes(tab.type)) return null
	if (typeof tab.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(tab.id)) return null
	return {
		type: tab.type,
		id: tab.id,
		workspaceId: String(tab.workspaceId || ''),
		...typeof tab.draft === 'string' ? { draft: tab.draft } : {},
	}
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

	// 机器可用 shell 列表与默认 shell
	router.get('/api/parts/shells\\:code/machines/:id/shells', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const machine = req.params.id
		res.json({ shells: await availableShells(username, machine), default: await machineDefaultShell(username, machine) })
	})

	// 文件夹浏览（根 = 盘符 / `/`；根视图附带当前工作区快速访问）
	router.get('/api/parts/shells\\:code/machines/:id/browse', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const machine = req.params.id
		const executor = createTargetExecutor(username, { machine })
		const path = String(req.query.path || '')
		if (!path) {
			const roots = await executor.listRoots()
			const [quickAccess, labels] = await Promise.all([
				buildQuickAccess(username, machine, String(req.query.workspace || '')).catch(() => []),
				getVolumeLabels(username, machine),
			])
			// 根条目名附卷标（如 `C:\ Windows`；无卷标保持 `C:\`）
			res.json({
				path: '',
				roots,
				entries: roots.map(root => {
					const label = labels[String(root).toUpperCase()]
					return { name: label ? `${root} ${label}` : root, path: root, isDirectory: true, isFile: false }
				}),
				quickAccess,
			})
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

	// 打开的标签页列表与活动标签（含草稿与未发送草稿内容，跨页面共享）
	router.get('/api/parts/shells\\:code/tabs', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		res.json(getTabs(username))
	})

	router.put('/api/parts/shells\\:code/tabs', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const tabs = Array.isArray(req.body?.tabs) ? req.body.tabs : []
		const data = {
			tabs: tabs.map(sanitizeTab).filter(Boolean),
			activeTab: String(req.body?.activeTab || ''),
		}
		assignShellData(username, 'code', 'tabs', data)
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

	// 输入历史（自有 + 原生 shell 历史）
	router.get('/api/parts/shells\\:code/history', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const { machine, path: workdir } = parseWorkdir(req.query)
		const kind = String(req.query.kind || '')
		const shell = String(req.query.shell || '')
		if (!['shell', 'message'].includes(kind)) throw httpError(400, 'kind must be shell or message.')
		res.json(await getHistory(username, workdir ? { machine, path: workdir } : undefined, kind, shell))
	})

	router.post('/api/parts/shells\\:code/history', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const { machine, path: workdir } = parseWorkdir(req.body || {})
		const { kind, command } = req.body || {}
		if (!['shell', 'message'].includes(kind)) throw httpError(400, 'kind must be shell or message.')
		if (!command?.trim()) throw httpError(400, 'command is required.')
		res.json({ own: await appendOwnHistory(username, workdir ? { machine, path: workdir } : undefined, kind, command) })
	})

	// 工作区配置（.agents/fount/code.json）
	router.get('/api/parts/shells\\:code/workspace-config', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const { machine, path: workdir } = parseWorkdir(req.query)
		res.json(await readWorkspaceConfig(username, workdir ? { machine, path: workdir } : undefined))
	})

	// 跨工作区会话聚合（顶部对话选择器 / 右侧工作区一览）
	router.get('/api/parts/shells\\:code/sessions/all', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const workspaces = getWorkspaces(username).list || []
		/** @type {Array<object>} */
		const sessions = []
		for (const workspace of workspaces) {
			const list = await listSessions(username, { machine: workspace.machine, path: workspace.path }).catch(() => [])
			for (const session of list)
				sessions.push({ ...session, workspaceId: workspace.id, workspaceName: workspace.name || workspace.path })
		}
		sessions.sort((a, b) => String(b.updated).localeCompare(String(a.updated)))
		res.json({ sessions })
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

	// AI 会话 WS：send（追加用户消息）/ regen（重新生成最后一条角色回复）/ abort → preview / done / error
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
			if (msg.type !== 'send' && msg.type !== 'regen') return

			const { session, machine = 0, workdir, ai_source, profile, content } = msg
			if (!session || (msg.type === 'send' && !content)) {
				ws.send(JSON.stringify({ type: 'error', error: 'session and content are required.' }))
				return
			}
			controller = new AbortController()
			/** 已确定条目（send = 用户消息；regen 开始为空，失败/中断时原样返回）。 */
			const entries = []
			const requestSession = { ...session, entries: [...session.entries || []] }
			if (msg.type === 'send') {
				const userEntry = sanitizeEntry({ role: 'user', name: username, content, uid: 'user', time_stamp: new Date(), files: Array.isArray(msg.files) ? msg.files : [] })
				entries.push(userEntry)
				requestSession.entries.push({ ...userEntry, time: userEntry.time })
			}
			try {
				const { reply, memory } = await triggerCodeReply({
					username,
					session: requestSession,
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
				for (const entry of reply?.logContextBefore || [])
					entries.push(sanitizeEntry(entry))
				if (reply)
					entries.push(sanitizeEntry({ ...reply, role: 'char', uid: 'char', name: reply.name || session.charname, time_stamp: new Date() }))
				ws.send(JSON.stringify({ type: 'done', entries, memory }))
			}
			catch (error) {
				if (controller.signal.aborted)
					ws.send(JSON.stringify({ type: 'aborted', entries }))
				else
					ws.send(JSON.stringify({ type: 'error', entries, error: String(error?.stack || error) }))
			}
			finally {
				controller = null
			}
		})
	})
}
