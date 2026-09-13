import { defineReplyHandler } from '../../../chat/src/reply/defineReplyHandler.mjs'
import { defineReplyPreviews } from '../../../chat/src/streaming/index.mjs'

/**
 * `<recommend_command>`：提取推荐命令到 extension 并从正文移除标签。
 * @type {import('../../../../../../../src/decl/pluginAPI.ts').ReplyHandler_t}
 */
export const recommendCommandReplyHandler = defineReplyHandler({
	tag: 'recommend_command',
	/**
	 * 提取推荐命令。
	 * @param {object} reply 回复对象
	 * @param {object} args 请求上下文
	 * @param {object} call 调用
	 * @returns {Promise<object>} 结果
	 */
	handle: async (reply, args, call) => {
		const command = call.body.trim()
		if (!command) return {}
		reply.extension.recommend_command = command
		return { content: reply.content.replace(call.raw, '\n').trim() }
	},
})

/**
 * shell推荐命令插件
 * @type {import('../../../../../../../src/decl/pluginAPI.ts').PluginAPI_t}
 */
export const recommend_command_plugin = {
	info: {
		'zh-CN': {
			name: 'shell推荐命令插件',
			description: '推荐命令插件，让AI能够在shell环境中推荐命令',
			author: 'steve02081504',
		},
		'en-US': {
			name: 'shell recommend command plugin',
			description: 'recommend command plugin, let AI recommend commands in shell environment',
			author: 'steve02081504',
		},
	},
	interfaces: {
		chat: {
			/**
			 * 获取提示。
			 * @param {any} args - 参数。
			 * @returns {Promise<any>} - 提示。
			 */
			GetPrompt: async (args) => {
				return {
					additional_chat_log: [
						{
							role: 'system',
							name: 'system',
							content: `\
你可以通过回复以下格式来推荐命令让${args.UserCharname}选择是否执行：

<recommend_command>
command_body
</recommend_command>
`,
						}
					]
				}
			},
			ReplyHandler: recommendCommandReplyHandler,
			GetReplyPreviewUpdater: defineReplyPreviews([recommendCommandReplyHandler]),
		}
	}
}
