import { findTriggerChatLogEntry } from './codeBridgeContext.mjs'
import { ensureLocalAgentEntityHash } from '../../entity/member.mjs'

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
				return `\
你可以在 JS 代码里用 \`fount\` 对象操作当前群：
- \`fount.chat\` — 当前聊天
- \`fount.group\` / \`fount.channel\` — 当前群与频道
- \`fount.message\` — 触发这次回复的那条消息
能改什么取决于你在群里的权限。
`
			},
			/**
			 * @param {import('../../../../../../decl/chatLog.ts').chatReplyRequest_t} args 生成请求
			 * @returns {Promise<Record<string, unknown>>} JS 执行上下文
			 */
			async GetJSCodeContext(args) {
				const groupId = args.extension?.groupId
				const channelId = args.extension?.channelId
				if (!groupId || !channelId || !args.username) return {}

				const entityHash = args.char_id
					? await ensureLocalAgentEntityHash(args.username, args.char_id)
					: args.extension?.memberId

				const { getChatClient } = await import('../../api/index.mjs')
				const { buildConversationContext } = await import('./conversationContext.mjs')
				const chat = await getChatClient(args.username, entityHash)
				const group = await chat.group(groupId)
				const channel = await group.channel(channelId)

				const triggerEntry = findTriggerChatLogEntry(args.chat_log)
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

				return {
					fount: {
						chat,
						group,
						channel,
						...message ? { message } : {},
					},
				}
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
