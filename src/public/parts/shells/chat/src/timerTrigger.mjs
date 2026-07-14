import { getTimers, removeTimer, setTimer } from '../../../../../server/timers.mjs'

import { getDefaultChannelId } from './chat/dag/queries.mjs'
import { newGroup } from './chat/session/groupLifecycle.mjs'
import { addchar } from './chat/session/partConfig.mjs'
import { getActiveGroupRuntime } from './chat/session/persistence.mjs'
import { triggerCharReply } from './chat/session/triggerReply.mjs'

/**
 * 构造定时器到期时注入聊天上下文的系统条目。
 * @param {string} reason 定时器到期原因
 * @param {string} chatLogSnip 聊天记录节选
 * @param {string} char_id 角色 ID
 * @returns {object} chatLogEntry_t 形状
 */
export function makeTimerSystemEntry(reason, chatLogSnip, char_id) {
	return {
		name: 'system',
		role: 'system',
		content: `\
定时器"${reason}"到期。
设置定时器时的聊天记录节选：
<chat_log_snip>
${chatLogSnip}
</chat_log_snip>
请根据定时器的内容进行回复。
`,
		files: [],
		charVisibility: [char_id],
		time_stamp: new Date(),
	}
}

/**
 * 在已有 groupId 上触发定时器回复（Level 2）。
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @param {string} char_id 角色 ID
 * @param {string} reason 定时器原因
 * @param {string} chatLogSnip 聊天记录节选
 * @param {(groupId: string, char_id: string, entry: object) => void} setPendingNotification 待注入通知
 * @returns {Promise<boolean>} 是否成功
 */
async function triggerViaGroupId(username, groupId, char_id, reason, chatLogSnip, setPendingNotification) {
	const chatMetadata = await getActiveGroupRuntime(groupId)
	if (!chatMetadata?.LastTimeSlice.chars[char_id]) return false
	setPendingNotification(groupId, char_id, makeTimerSystemEntry(reason, chatLogSnip, char_id))
	const channelId = await getDefaultChannelId(username, groupId)
	await triggerCharReply(groupId, channelId, char_id)
	return true
}

/**
 * 新建群并触发定时器回复（Level 3），必要时更新重复定时器的 groupId。
 * @param {string} username 用户名
 * @param {string} uid 定时器 ID
 * @param {object} callbackdata 回调数据
 * @param {object} dependencies 来自 timer 插件的依赖
 * @param {string} dependencies.pluginPath timer 插件路径
 * @param {(groupId: string, char_id: string, entry: object) => void} dependencies.setPendingNotification 写入待注入通知
 * @returns {Promise<void>}
 */
async function triggerViaNewGroup(username, uid, callbackdata, dependencies) {
	const { char_id, reason, chatLogSnip } = callbackdata
	const { pluginPath, setPendingNotification } = dependencies
	const groupId = await newGroup(username)
	await addchar(groupId, char_id, username)
	setPendingNotification(groupId, char_id, makeTimerSystemEntry(reason, chatLogSnip, char_id))
	const channelId = await getDefaultChannelId(username, groupId)
	await triggerCharReply(groupId, channelId, char_id)

	try {
		const timerRecord = getTimers(username, pluginPath)[uid]
		removeTimer(username, pluginPath, uid)
		setTimer(username, pluginPath, uid, {
			trigger: timerRecord.trigger,
			callbackdata: { ...callbackdata, groupId },
			repeat: true,
		})
	}
	catch (e) { console.error('timer: 更新重复定时器 groupId 失败', e) }
}

/**
 * 处理 timer 插件 Level 2/3 回落：通过 groupId 或新建群触发 chat 回复。
 * 调用方须已校验 callbackdata.type === 'timer'。
 * @param {string} username 用户名
 * @param {string} uid 定时器 ID
 * @param {object} callbackdata 回调数据
 * @param {object} dependencies 来自 timer 插件的依赖
 * @param {string} dependencies.pluginPath timer 插件路径
 * @param {(groupId: string, char_id: string, entry: object) => void} dependencies.setPendingNotification 写入待注入通知
 * @returns {Promise<'group' | 'new' | false>} 回落方式，或失败
 */
export async function handleTimerGroupFallback(username, uid, callbackdata, dependencies) {
	const { char_id, groupId, reason, chatLogSnip } = callbackdata

	if (groupId) try {
		if (await triggerViaGroupId(username, groupId, char_id, reason, chatLogSnip, dependencies.setPendingNotification))
			return 'group'
	}
	catch (e) { console.error('timer: 通过 groupId 触发失败，尝试新建群', e) }

	try {
		await triggerViaNewGroup(username, uid, callbackdata, dependencies)
		return 'new'
	}
	catch (e) {
		console.error(`timer: 定时器"${reason}"群回落触发失败`, e)
		return false
	}
}
