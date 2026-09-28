/**
 * code shell 会话保留策略：按「最后活动时间」清理长期未使用的会话。
 *
 * 最后活动时间取会话文件的最后修改时间（fs mtime）：生成/编辑写文件会更新它，
 * 打开会话时 `touchSession` 只触达 mtime、不改内容（见 `sessions.mjs`），
 * 因此最近打开过的会话会被重算。带未发送草稿的会话永不清理，生成中的会话同样跳过。
 * 清理在工作区选择时惰性触发（按用户+工作区节流），也可手动触发。
 */
import { ms } from '../../../../../scripts/ms.mjs'
import { loadShellData, saveShellData } from '../../../../../server/setting_loader.mjs'

import { deleteSession, listSessions } from './sessions.mjs'

/** 默认保留天数。 */
export const DEFAULT_RETENTION_DAYS = 30

/** 一天的毫秒数。 */
const DAY_MS = ms('1d')

/**
 * 读取保留天数（shell data `retention.days`；缺省/非法回退默认值，`0` 表示禁用清理）。
 * @param {string} username - 用户名。
 * @returns {number} 保留天数。
 */
export function getRetentionDays(username) {
	const data = loadShellData(username, 'code', 'retention') ?? {}
	const days = Number(data.days)
	return Number.isFinite(days) && days >= 0 ? days : DEFAULT_RETENTION_DAYS
}

/**
 * 写入保留天数。
 * @param {string} username - 用户名。
 * @param {number} days - 保留天数（非负数；`0` 表示禁用清理）。
 * @returns {number} 写入后的保留天数。
 * @throws {TypeError} 天数非法时抛出。
 */
export function setRetentionDays(username, days) {
	const value = Number(days)
	if (!Number.isFinite(value) || value < 0) throw new TypeError('retention days must be a non-negative number.')
	const data = loadShellData(username, 'code', 'retention') ?? {}
	data.days = value
	saveShellData(username, 'code', 'retention')
	return value
}

/**
 * 会话键：同一会话 id 可存在于多个工作区，需带目标机器与路径区分。
 * @param {string} machine - 目标机器 id。
 * @param {string} path - 工作区路径。
 * @param {string} id - 会话 id。
 * @returns {string} 会话键。
 */
function sessionKey(machine, path, id) {
	return `${machine}\0${path}\0${id}`
}

/**
 * 清理超过保留期未活动的会话。
 *
 * 每个工作区分别列出会话；最后活动时间取文件 mtime，早于截止点者删除。
 * 带未发送草稿（`tabs` 中同为 session 类型且 `draft` 非空）或 `isGenerating` 为真的会话跳过。
 * @param {string} username - 用户名。
 * @param {object} [options] - 选项。
 * @param {Array<{id: string, machine?: string, path: string}>} [options.workspaces] - 工作区列表。
 * @param {Array<{type: string, id: string, workspaceId: string, draft?: string}>} [options.tabs] - 打开的标签页（含未发送草稿）。
 * @param {(id: string) => boolean} [options.isGenerating] - 判断会话是否正在生成。
 * @param {number} [options.now] - 当前时间戳（毫秒，测试可注入）。
 * @returns {Promise<{days: number, removed: Array<{id: string, workspaceId: string}>}>} 清理结果（禁用时 removed 为空）。
 */
export async function pruneInactiveSessions(username, { workspaces = [], tabs = [], isGenerating = () => false, now = Date.now() } = {}) {
	const days = getRetentionDays(username)
	if (!(days > 0)) return { days, removed: [] }
	const cutoff = now - days * DAY_MS
	const draftKeys = new Set()
	for (const tab of tabs) {
		if (tab?.type !== 'session' || !String(tab.draft || '').trim()) continue
		const workspace = workspaces.find(w => w.id === tab.workspaceId)
		if (workspace?.path) draftKeys.add(sessionKey(String(workspace.machine ?? '0'), workspace.path, tab.id))
	}
	const removed = []
	for (const workspace of workspaces) {
		if (!workspace?.path) continue
		const machine = String(workspace.machine ?? '0')
		const workdir = { machine, path: workspace.path }
		const sessions = await listSessions(username, workdir).catch(() => [])
		for (const session of sessions) {
			if (draftKeys.has(sessionKey(machine, workspace.path, session.id)) || isGenerating(session.id)) continue
			if ((Number(session.mtimeMs) || 0) >= cutoff) continue
			try { await deleteSession(username, workdir, session.id) }
			catch { continue }
			removed.push({ id: session.id, workspaceId: workspace.id })
		}
	}
	return { days, removed }
}
