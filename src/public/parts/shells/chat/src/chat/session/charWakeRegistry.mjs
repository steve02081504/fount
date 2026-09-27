/**
 * 【文件】charWakeRegistry.mjs — 频道×角色唤醒调度的叶子注册表（仅内存）
 * 【职责】导出槽位键编码与全 shell 共享的唤醒调度器单例，供 triggerReply 与 chatRequest 共用而不产生循环依赖。
 * 【原理】键为 `groupId\0channelId\0charname`（`channelId` 为空时记 `'default'`）；调度器实现见 reply/wakeScheduler.mjs。
 * 【数据结构】chatReplyWakes（单例，见 wakeScheduler）。
 * 【关联】session/triggerReply.mjs、session/chatRequest.mjs、reply/wakeScheduler.mjs。
 */

import { createWakeScheduler } from '../../reply/wakeScheduler.mjs'

/**
 * 组合角色槽位键。
 * @param {string} groupId 群 ID
 * @param {string | null | undefined} channelId 频道 ID
 * @param {string} charname 角色名
 * @returns {string} 槽位键
 */
export function charReplyFlightKey(groupId, channelId, charname) {
	return `${groupId}\0${channelId || 'default'}\0${charname}`
}

/** 全 shell 共享的频道×角色唤醒调度器。 */
export const chatReplyWakes = createWakeScheduler()
