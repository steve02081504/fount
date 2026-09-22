/**
 * 【文件】pendingCharTriggers.mjs — 频道×角色「待触发」槽位（仅内存）
 * 【职责】记录生成中收到、待补触发一次生成的角色槽位；由 triggerReply 在生成结束时 drain，由轮次刷新（`ClearPendingMessages`）清除。
 * 【原理】键为 `groupId\0channelId\0charname`（与 `charReplyInFlight` 同格式）；独立成叶子模块，避免 chatRequest ↔ triggerReply 循环依赖。
 * 【数据结构】`Set<string>`。
 * 【关联】session/triggerReply.mjs（requestCharReply / drain）、session/chatRequest.mjs（ClearPendingMessages）。
 */

/** @type {Set<string>} */
const pendingCharTriggers = new Set()

/**
 * 组合角色槽位键（与 `charReplyInFlight` 口径一致）。
 * @param {string} groupId 群 ID
 * @param {string | null | undefined} channelId 频道 ID
 * @param {string} charname 角色名
 * @returns {string} 槽位键
 */
export function charReplyFlightKey(groupId, channelId, charname) {
	return `${groupId}\0${channelId || 'default'}\0${charname}`
}

/**
 * 标记某槽位待补触发。
 * @param {string} key 槽位键
 * @returns {void}
 */
export function markPendingCharTrigger(key) {
	pendingCharTriggers.add(key)
}

/**
 * 取出（并移除）某槽位的待触发标记。
 * @param {string} key 槽位键
 * @returns {boolean} 是否曾被标记
 */
export function takePendingCharTrigger(key) {
	return pendingCharTriggers.delete(key)
}

/**
 * 清除某槽位的待触发标记。
 * @param {string} key 槽位键
 * @returns {void}
 */
export function clearPendingCharTrigger(key) {
	pendingCharTriggers.delete(key)
}
