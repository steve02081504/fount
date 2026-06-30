import { handleTimerGroupFallback, makeTimerSystemEntry } from '../../shells/chat/src/timerTrigger.mjs'

import { timerReplyHandler, PLUGIN_PATH } from './handler.mjs'
import { getCharTimerPrompt } from './prompt.mjs'
import { getChannels, setPendingNotification } from './state.mjs'

const { info } = (await import('./locales.json', { with: { type: 'json' } })).default

/**
 * 通过活跃频道（level 1）触发角色回复。
 * @param {object} channel - 活跃的 chatReplyRequest_t。
 * @param {string} char_id 角色 ID
 * @param {string} reason 定时器到期原因
 * @param {string} chatLogSnip 聊天记录节选
 * @returns {Promise<boolean>} 是否成功触发
 */
async function replyViaChannel(channel, char_id, reason, chatLogSnip) {
	const updatedChannel = await channel.Update()
	const logEntry = makeTimerSystemEntry(reason, chatLogSnip, char_id)
	const result = await updatedChannel.char.interfaces.chat.GetReply({
		...updatedChannel,
		chat_log: [...updatedChannel.chat_log, logEntry],
	})
	if (!result) return false
	result.logContextBefore.push(logEntry)
	await updatedChannel.AddChatLogEntry({ name: updatedChannel.Charname, ...result })
	return true
}

/**
 * timer 插件主模块。
 * @returns {import('../../../../decl/pluginAPI.ts').PluginAPI_t}
 */
export default {
	info,
	/**
	 * 加载插件
	 */
	Load: async () => { },
	/**
	 * 卸载插件
	 */
	Unload: async () => { },
	interfaces: {
		chat: {
			GetPrompt: getCharTimerPrompt,
			ReplyHandler: timerReplyHandler,
		},
		timers: {
			/**
			 * 定时器到期时的回调，按以下优先级触发角色回复：
			 *  1. 进程内存中的活跃频道（支持所有平台：Telegram/Shell/fount 网页聊天）
			 *  2. 通过 groupId 在已有 chat 群上触发（重启后长定时器的回落）
			 *  3. 新建 chat 群（最终回落，并更新重复定时器的 groupId）
			 * @param {string} username 用户名
			 * @param {string} uid 定时器 ID
			 * @param {object} callbackdata 回调数据
			 */
			TimerCallback: async (username, uid, callbackdata) => {
				const { type, char_id, reason, chatLogSnip } = callbackdata
				if (type !== 'timer') {
					console.error(`timer: 未知的回调类型 "${type}"（uid=${uid}）`)
					return
				}

				// ── Level 1：进程内活跃频道 ─────────────────────────────────────
				for (const channel of getChannels(username, char_id)) try {
					if (await replyViaChannel(channel, char_id, reason, chatLogSnip)) {
						console.info(`timer: 定时器"${reason}"通过活跃频道触发成功`)
						return
					}
				}
				catch (e) { console.error('timer: 活跃频道触发失败，尝试下一个', e) }

				// ── Level 2/3：chat 模块处理 group 回落 ─────────────────────────
				const fallback = await handleTimerGroupFallback(username, uid, callbackdata, {
					pluginPath: PLUGIN_PATH,
					setPendingNotification,
				})
				if (fallback === 'group') {
					console.info(`timer: 定时器"${reason}"通过已有群回落触发成功`)
					return
				}
				if (fallback === 'new') {
					console.info(`timer: 定时器"${reason}"回落至新建群触发成功`)
					return
				}
				console.error(`timer: 定时器"${reason}"所有触发策略均失败`)
			},
		},
	},
}
