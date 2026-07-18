import { localWorldHookState } from 'fount/public/parts/shells/chat/test/fixtures/probes/localWorldHookState.mjs'

/**
 * local distribution 测试 world。
 * @type {import('../../../../../../../../../decl/worldAPI.ts').WorldAPI_t}
 */
export default {
	distribution: 'local',
	info: {
		'zh-CN': {
			name: 'Local 分布测试世界',
			avatar: '🌍',
			description: 'distribution: local fixture',
			version: '1.0.0',
			author: 'fount',
			tags: ['test'],
		},
		'en-US': {
			name: 'Local distribution test world',
			avatar: '🌍',
			description: 'distribution: local fixture',
			version: '1.0.0',
			author: 'fount',
			tags: ['test'],
		},
	},
	interfaces: {
		chat: {
			/**
			 * @returns {Promise<object>} 带标记的 prompt
			 */
			GetPrompt: async () => {
				localWorldHookState.promptCalls++
				return {
					text: [{ content: 'local-world-prompt-marker', important: 0 }],
					additional_chat_log: [],
					extension: {},
				}
			},
			/**
			 * @param {object} arg chatReplyRequest
			 * @returns {Promise<object[]>} 原 chat_log
			 */
			GetChatLogForViewer: async arg => {
				localWorldHookState.viewerCalls++
				return arg.chat_log || []
			},
			/**
			 * @returns {Record<string, object>} 测试用活对象插件
			 */
			GetChatPlugins: () => {
				localWorldHookState.chatPluginsCalls++
				return {
					'world-injected': {
						info: { name: 'world-injected' },
						interfaces: {},
					},
				}
			},
		},
	},
}
