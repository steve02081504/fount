import { agentEntityHash } from './entity.mjs'
import { getLocalNodeHash } from './replica.mjs'

/** @type {import('../../../../../../decl/pluginAPI.ts').PluginAPI_t} */
export const FOUNT_CHAT_CODE_CONTEXT_PLUGIN = {
	info: { name: 'fount_chat', version: '1.0.0' },
	interfaces: {
		code_execution: {
			/**
			 * @param {import('../../../../../../decl/chatLog.ts').chatReplyRequest_t} args 生成请求
			 * @returns {Promise<string>} 追加 prompt
			 */
			async GetJSCodePrompt(args) {
				const actorLabel = args.char_id ? `agent char "${args.char_id}"` : 'operator'
				return [
					'你可以使用 fount 原生 ChatClient 对象操作当前群（跨平台统一契约）：',
					'- `chat`: ChatClient（acting entity = 当前 ' + actorLabel + '）',
					'- `group`: 当前群 Group',
					'- `channel`: 当前频道 Channel',
					'- `message`: 触发本次生成的消息 Message（若可解析）',
					'写方法权限按 acting 成员角色裁决；agent 不能建群或独立持钥。',
				].join('\n')
			},
			/**
			 * @param {import('../../../../../../decl/chatLog.ts').chatReplyRequest_t} args 生成请求
			 * @returns {Promise<Record<string, unknown>>} JS 执行上下文
			 */
			async GetJSCodeContext(args) {
				const groupId = args.extension?.groupId
				const channelId = args.extension?.channelId
				if (!groupId || !channelId || !args.username) return {}

				const actingEntityHash = args.char_id
					? agentEntityHash(getLocalNodeHash(), `chars/${args.char_id}`)
					: args.extension?.memberId

				const { getChatClient } = await import('../../api/index.mjs')
				const { buildConversationContext } = await import('./conversationContext.mjs')
				const chat = await getChatClient(args.username, actingEntityHash)
				const group = await chat.group(groupId)
				const channel = await group.channel(channelId)

				const triggerEntry = [...args.chat_log || []]
					.reverse()
					.find(entry => entry.role !== 'char' && entry.extension?.dagEventId)
				let message
				if (triggerEntry) {
					const { group: groupProjection, channel: channelProjection } =
						await buildConversationContext(args.username, groupId, channelId)
					message = await chat.messageFrom({
						group: groupProjection,
						channel: channelProjection,
						message: {
							content: { content: triggerEntry.content, displayName: triggerEntry.name },
							eventId: triggerEntry.extension.dagEventId,
						},
					})
				}

				return { chat, group, channel, ...message ? { message } : {} }
			},
		},
	},
}

/**
 * 向 plugins 表注入 fount_chat 内建插件。
 * @param {Record<string, import('../../../../../../decl/pluginAPI.ts').PluginAPI_t>} plugins 已有插件表
 * @returns {Record<string, import('../../../../../../decl/pluginAPI.ts').PluginAPI_t>} 含 fount_chat 的插件表
 */
export function injectFountChatCodeContextPlugin(plugins) {
	return { ...plugins, fount_chat: FOUNT_CHAT_CODE_CONTEXT_PLUGIN }
}
