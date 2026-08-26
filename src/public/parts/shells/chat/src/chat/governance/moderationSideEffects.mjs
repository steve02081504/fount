/**
 * 【文件】governance/moderationSideEffects.mjs
 * 【职责】治理副作用完成状态本地持久化：记录已轮换 roomSecret 的 moderation 事件 id。
 * 【原理】roomSecret 轮换每次都会追加新的 `group_settings_update`（非幂等）；重复治理请求（重试/恢复）会反复轮换。
 * 		这里以 moderation 事件 id 为键记录已完成轮换，恢复流程仅补齐未完成的副作用，已完成事件不再轮换。
 * 【数据结构】JSON 对象：`{ [moderationEventId]: true }`。
 * 【关联】group/routes/governance.mjs、lib/paths.mjs；node 私有，不入 DAG。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { moderationSideEffectsPath } from '../lib/paths.mjs'

/**
 * @param {unknown} raw 磁盘读取的原始 JSON 对象（未经校验）
 * @returns {Record<string, true>} 规范化后的完成状态映射
 */
function normalizeModerationSideEffects(raw) {
	const out = {}
	if (raw && typeof raw === 'object')
		for (const key of Object.keys(raw))
			if (raw[key] === true) out[key] = true
	return out
}

/**
 * 读取治理副作用完成状态。
 * @param {string} username 本地账户名
 * @param {string} groupId 群 ID
 * @returns {Promise<Record<string, true>>} 已完成的 moderation 事件 id 映射；不存在时为空对象
 */
export async function loadModerationSideEffects(username, groupId) {
	try {
		const text = await readFile(moderationSideEffectsPath(username, groupId), 'utf8')
		return normalizeModerationSideEffects(JSON.parse(text))
	}
	catch (error) {
		if (error?.code !== 'ENOENT') console.error(error)
		return {}
	}
}

/**
 * 指定 moderation 事件是否已完成 roomSecret 轮换。
 * @param {string} username 本地账户名
 * @param {string} groupId 群 ID
 * @param {string} moderationEventId 治理事件 id（member_ban / member_kick）
 * @returns {Promise<boolean>} 已完成返回 true
 */
export async function hasRoomRotatedForEvent(username, groupId, moderationEventId) {
	if (!moderationEventId) return false
	const data = await loadModerationSideEffects(username, groupId)
	return data[moderationEventId] === true
}

/**
 * 记录指定 moderation 事件的 roomSecret 轮换已完成。
 * @param {string} username 本地账户名
 * @param {string} groupId 群 ID
 * @param {string} moderationEventId 治理事件 id（member_ban / member_kick）
 * @returns {Promise<void>}
 */
export async function markRoomRotatedForEvent(username, groupId, moderationEventId) {
	if (!moderationEventId) return
	const data = await loadModerationSideEffects(username, groupId)
	data[moderationEventId] = true
	const p = moderationSideEffectsPath(username, groupId)
	await mkdir(dirname(p), { recursive: true })
	await writeFile(p, JSON.stringify(data, null, '\t'), 'utf8')
}
