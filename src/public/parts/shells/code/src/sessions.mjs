/**
 * code shell 会话存储：会话以 JSON 文件形式存放在目标机器的工作区 `.fount/code/sessions/` 下。
 * 以前端为唯一写入方（本地缓存策略：焦点移出且生成结束后才 flush），本模块只提供存取原语。
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
 * @property {object} memory chat_scoped_char_memory
 * @property {Array<{id: string, uid: string, role: string, name: string, content: string, time: string, extension?: object}>} entries 消息列表
 */

/**
 * 校验会话 id（防路径穿越）。
 * @param {string} id - 会话 id。
 * @returns {boolean} 是否合法。
 */
function isValidSessionId(id) {
	return typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id)
}

/**
 * 获取会话目录。
 * @param {{path?: string}} workdir - 目标工作区。
 * @returns {string} 会话目录。
 */
export function sessionsDir(workdir) {
	return joinWorkdir(workdir?.path, '.fount/code/sessions')
}

/**
 * 列出工作区内的会话（按 updated 降序）。
 * @param {string} username - 用户名。
 * @param {{machine?: string, path?: string}} workdir - 目标工作区。
 * @returns {Promise<Array<Pick<codeSession_t, 'id'|'title'|'charname'|'profile'|'ai_source'|'created'|'updated'>>>} 会话摘要列表。
 */
export async function listSessions(username, workdir) {
	if (!workdir?.path) return []
	const executor = createTargetExecutor(username, { machine: workdir.machine ?? '0', workdir: workdir.path })
	const entries = await executor.listDir(sessionsDir(workdir)).catch(() => [])
	const sessions = []
	for (const entry of entries.filter(e => e.isFile && e.name.endsWith('.json'))) {
		const session = await loadSession(username, workdir, entry.name.replace(/\.json$/, '')).catch(() => null)
		if (session) sessions.push({
			id: session.id,
			title: session.title,
			charname: session.charname,
			profile: session.profile,
			ai_source: session.ai_source,
			created: session.created,
			updated: session.updated,
		})
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
	const text = await executor.readTextFile(sessionsDir(workdir) + '/' + id + '.json').catch(() => null)
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
	await executor.writeTextFile(sessionsDir(workdir) + '/' + session.id + '.json', JSON.stringify(session, null, '\t'))
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
	// 执行器无 delete 原语：统一以脚本完成本机/远程删除
	await executor.execJs(`const fs = await import('node:fs/promises');\nconst path = await import('node:path');\nconst p = path.resolve(${JSON.stringify(workdir.path)}, '.fount/code/sessions/${id}.json');\nawait fs.rm(p, { force: true })`)
}
