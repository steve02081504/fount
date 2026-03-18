import { getTimers, removeTimer, setTimer } from '../../../../server/timers.mjs'
import { timerReplyHandler, PLUGIN_PATH } from './handler.mjs'
import { getCharTimerPrompt } from './prompt.mjs'
import { getChannels, setPendingNotification } from './state.mjs'

const { info } = (await import('./locales.json', { with: { type: 'json' } })).default

/**
 * 构造定时器到期时注入聊天上下文的系统条目（符合 chatLogEntry_t 接口的纯对象）。
 * @param {string} reason
 * @param {string} chat_log_snip
 * @param {string} char_id
 * @returns {object}
 */
function makeTimerSystemEntry(reason, chat_log_snip, char_id) {
	return {
		name: 'system',
		role: 'system',
		content: `\
定时器"${reason}"到期。
设置定时器时的聊天记录节选：
<chat_log_snip>
${chat_log_snip}
</chat_log_snip>
请根据定时器的内容进行回复。
`,
		files: [],
		charVisibility: [char_id],
		time_stamp: new Date(),
	}
}

/**
 * 通过活跃频道（level 1）触发角色回复。
 * @param {object} channel - 活跃的 chatReplyRequest_t。
 * @param {string} char_id
 * @param {string} reason
 * @param {string} chat_log_snip
 * @returns {Promise<boolean>} 是否成功触发。
 */
async function replyViaChannel(channel, char_id, reason, chat_log_snip) {
	const updatedChannel = await channel.Update()
	const logEntry = makeTimerSystemEntry(reason, chat_log_snip, char_id)
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
	Load: async () => { },
	Unload: async () => { },
	interfaces: {
		chat: {
			GetPrompt: getCharTimerPrompt,
			ReplyHandler: timerReplyHandler,
		},
		timers: {
			/**
			 * 定时器到期时的回调，按以下优先级触发角色回复：
			 *  1. 进程内存中的活跃频道（支持所有平台：Discord/Telegram/Shell/fount 网页聊天）
			 *  2. 通过 chatid 加载 fount 网页聊天（重启后长定时器的回落）
			 *  3. 新建 fount 网页聊天（最终回落，并更新重复定时器的 chatid）
			 * @param {string} username
			 * @param {string} uid
			 * @param {object} callbackdata
			 */
			TimerCallback: async (username, uid, callbackdata) => {
				const { type, char_id, chatid, reason, chat_log_snip } = callbackdata
				if (type !== 'timer') {
					console.error(`timer: 未知的回调类型 "${type}"（uid=${uid}）`)
					return
				}

				// ── Level 1：进程内活跃频道 ─────────────────────────────────────
				for (const channel of getChannels(username, char_id)) {
					try {
						if (await replyViaChannel(channel, char_id, reason, chat_log_snip)) {
							console.info(`timer: 定时器"${reason}"通过活跃频道触发成功`)
							return
						}
					}
					catch (e) { console.error('timer: 活跃频道触发失败，尝试下一个', e) }
				}

				// ── Level 2：通过 chatid 加载 fount 网页聊天 ────────────────────
				const { loadChat, triggerCharReply, newChat, addchar } =
					await import('../shells/chat/src/chat.mjs')

				if (chatid) {
					try {
						const chatMetadata = await loadChat(chatid)
						if (chatMetadata?.LastTimeSlice.chars[char_id]) {
							setPendingNotification(chatid, char_id, makeTimerSystemEntry(reason, chat_log_snip, char_id))
							await triggerCharReply(chatid, char_id)
							console.info(`timer: 定时器"${reason}"通过 chatid 触发成功`)
							return
						}
					}
					catch (e) { console.error('timer: 通过 chatid 触发失败，尝试新建对话', e) }
				}

				// ── Level 3：新建 fount 网页聊天（最终回落） ────────────────────
				console.warn(`timer: 定时器"${reason}"回落至新建对话`)
				try {
					const newChatid = await newChat(username)
					await addchar(newChatid, char_id)
					setPendingNotification(newChatid, char_id, makeTimerSystemEntry(reason, chat_log_snip, char_id))
					await triggerCharReply(newChatid, char_id)
					console.info(`timer: 定时器"${reason}"在新对话"${newChatid}"中触发`)

					// 若为重复定时器，更新 callbackdata 中的 chatid 以便后续直接复用
					const timerRecord = getTimers(username, PLUGIN_PATH)[uid]
					if (timerRecord)
						try {
							removeTimer(username, PLUGIN_PATH, uid)
							setTimer(username, PLUGIN_PATH, uid, {
								trigger: timerRecord.trigger,
								callbackdata: { ...callbackdata, chatid: newChatid },
								repeat: true,
							})
						}
						catch (e) { console.error('timer: 更新重复定时器 chatid 失败', e) }
				}
				catch (e) { console.error(`timer: 定时器"${reason}"所有触发策略均失败`, e) }
			},
		},
	},
}
