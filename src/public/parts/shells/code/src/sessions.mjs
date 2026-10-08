/**
 * code shell 会话存储：会话以 JSON 文件形式存放在目标机器的工作区 `.fount/code/sessions/` 下。
 * 写入方：非生成期的编辑/`!` 结果由前端 flush 写；生成运行由 WS 处理方写权威会话（起始占位、收尾替换）。
 * 本模块只提供存取原语。
 * @typedef {import('../../../../../decl/chatLog.ts').chatLogEntry_t} chatLogEntry_t
 */
import { createTargetExecutor, joinWorkdir } from '../../../plugins/file-operations/src/target.mjs'

/**
 * 会话对象（磁盘形状）。
 * @typedef {object} codeSession_t
 * @property {string} id 会话 id
 * @property {string} title 标题
 * @property {string} charname 角色名
 * @property {string} profile 所选 profile（mode）名
 * @property {string} [ai_source] 所选 AI 源（空 = 角色自带）
 * @property {string} created 创建时间（ISO）
 * @property {string} updated 更新时间（ISO）
 * @property {object} [usage] 全部已发生模型调用的累计用量（删除/重生成条目不减回）
 * @property {object} memory chat_scoped_char_memory；JS 运行时工作区 `coderunner_workspace` 是运行期 scratch，序列化时忽略、不落盘
 * @property {number} [regenAttempts] 工作区自动检查失败后的连续回灌次数（用户发消息时清零）
 * @property {Array<import('../../../../../decl/chatLog.ts').chatLogEntry_t & {time: string}>} entries 消息列表（content=agent 层，content_for_show=人类展示层；同时保留 content_for_edit / charVisibility / files）
 */

/**
 * 校验会话 id（防路径穿越）。
 * @param {string} id - 会话 id。
 * @returns {boolean} 是否合法。
 */
function isValidSessionId(id) {
	return typeof id === 'string' && /^[\w-]{1,64}$/.test(id)
}

/**
 * 获取会话目录。
 * @param {{path?: string}} workdir - 目标工作区。
 * @returns {string} 会话目录。
 */
function sessionsDir(workdir) {
	return joinWorkdir(workdir?.path, '.fount/code/sessions')
}

/**
 * 获取会话文件路径。
 * @param {{path?: string}} workdir - 目标工作区。
 * @param {string} id - 会话 id。
 * @returns {string} 会话文件路径。
 */
function sessionPath(workdir, id) {
	return sessionsDir(workdir) + '/' + id + '.json'
}

/**
 * 列出工作区内的会话（按 updated 降序）；摘要附文件最后修改时间 `mtimeMs`（最后活动时间，供保留期清理）。
 * @param {string} username - 用户名。
 * @param {{machine?: string, path?: string}} workdir - 目标工作区。
 * @returns {Promise<Array<Pick<codeSession_t, 'id'|'title'|'charname'|'profile'|'ai_source'|'created'|'updated'> & {mtimeMs: number}>>>} 会话摘要列表。
 */
export async function listSessions(username, workdir) {
	if (!workdir?.path) return []
	const executor = createTargetExecutor(username, { machine: workdir.machine ?? '0', workdir: workdir.path })
	const entries = await executor.listDir(sessionsDir(workdir)).catch(() => [])
	const sessions = []
	for (const entry of entries.filter(e => e.isFile && e.name.endsWith('.json'))) {
		const id = entry.name.slice(0, -'.json'.length)
		if (!isValidSessionId(id)) continue
		try {
			const { text, mtimeMs } = await executor.readTextFileWithMtime(sessionPath(workdir, id))
			const session = JSON.parse(text)
			sessions.push({
				id: session.id || id,
				title: session.title,
				charname: session.charname,
				profile: session.profile,
				ai_source: session.ai_source,
				created: session.created,
				updated: session.updated,
				mtimeMs,
			})
		}
		catch { continue }
	}
	return sessions.sort((a, b) => String(b.updated).localeCompare(String(a.updated)))
}

/**
 * 读取会话。
 * @param {string} username - 用户名。
 * @param {{machine?: string, path?: string}} workdir - 目标工作区。
 * @param {string} id - 会话 id。
 * @returns {Promise<codeSession_t|null>} 会话（不存在时 null）。
 */
export async function loadSession(username, workdir, id) {
	if (!isValidSessionId(id) || !workdir?.path) return null
	const executor = createTargetExecutor(username, { machine: workdir.machine ?? '0', workdir: workdir.path })
	const text = await executor.readTextFile(sessionPath(workdir, id)).catch(error => {
		if (error?.code === 'ENOENT' || /\bENOENT\b|no such file/i.test(String(error?.message))) return null
		throw error
	})
	if (text == null) return null
	return JSON.parse(text)
}

/**
 * 保存会话。
 * @param {string} username - 用户名。
 * @param {{machine?: string, path?: string}} workdir - 目标工作区。
 * @param {codeSession_t} session - 会话对象。
 * @returns {Promise<void>}
 */
export async function saveSession(username, workdir, session) {
	if (!isValidSessionId(session?.id) || !workdir?.path)
		throw Object.assign(new Error('invalid session id'), { statusCode: 400 })
	const executor = createTargetExecutor(username, { machine: workdir.machine ?? '0', workdir: workdir.path })
	// `coderunner_workspace` 是 `<run-js>` 的运行期 scratch：内存里跨调用保留，但不落盘（刷新/恢复后即为空）。
	const text = JSON.stringify(session, (key, value) => key === 'coderunner_workspace' ? undefined : value, '\t')
	await executor.writeTextFile(sessionPath(workdir, session.id), text)
}

/**
 * 删除会话。
 * @param {string} username - 用户名。
 * @param {{machine?: string, path?: string}} workdir - 目标工作区。
 * @param {string} id - 会话 id。
 * @returns {Promise<void>}
 */
export async function deleteSession(username, workdir, id) {
	if (!isValidSessionId(id) || !workdir?.path) return
	const executor = createTargetExecutor(username, { machine: workdir.machine ?? '0', workdir: workdir.path })
	// 执行器无 delete 原语：统一以 lambda 完成本机/远程删除
	await executor.execJs(async (root, sessionId) => {
		const fs = await import('node:fs/promises')
		const path = await import('node:path')
		const p = path.resolve(root, `.fount/code/sessions/${sessionId}.json`)
		await fs.rm(p, { force: true })
	}, workdir.path, id)
}

/**
 * 触达会话文件：仅更新文件最后修改时间、不改内容（视为一次「打开」，用于保留期重算）。
 * @param {string} username - 用户名。
 * @param {{machine?: string, path?: string}} workdir - 目标工作区。
 * @param {string} id - 会话 id。
 * @returns {Promise<void>}
 */
export async function touchSession(username, workdir, id) {
	if (!isValidSessionId(id) || !workdir?.path) return
	const executor = createTargetExecutor(username, { machine: workdir.machine ?? '0', workdir: workdir.path })
	await executor.execJs(async (root, sessionId) => {
		const fs = await import('node:fs/promises')
		const path = await import('node:path')
		const now = new Date()
		await fs.utimes(path.resolve(root, `.fount/code/sessions/${sessionId}.json`), now, now)
	}, workdir.path, id)
}
