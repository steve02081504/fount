/**
 * 虚拟桥接唤醒调度：桥接会话生成槽位与唤醒键的唯一持有者。
 * 叶子模块，不 import request/trigger，避免循环依赖。
 */
import { createWakeScheduler } from '../../reply/wakeScheduler.mjs'

/**
 * @param {string} username replica
 * @param {string} groupId 虚拟群 ID
 * @param {string} channelId 频道 ID
 * @param {string} charname 角色名
 * @returns {string} 槽位键
 */
export function bridgeWakeKey(username, groupId, channelId, charname) {
	return `${username}\0${groupId}\0${channelId}\0${charname}`
}

/**
 *
 */
export const bridgeWakes = createWakeScheduler()
