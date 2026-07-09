/**
 * M7：local distribution 测试 world；钩子留 globalThis 可观测痕迹。
 * @type {import('../../../../../../../../../decl/worldAPI.ts').WorldAPI_t}
 */
const HOOK_KEY = '__fount_local_world_hook_state__'

/**
 * @returns {{ promptCalls: number, viewerCalls: number }} 调用计数
 */
function hookState() {
	if (!globalThis[HOOK_KEY])
		globalThis[HOOK_KEY] = { promptCalls: 0, viewerCalls: 0 }
	return globalThis[HOOK_KEY]
}

/**
 *
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
				hookState().promptCalls++
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
				hookState().viewerCalls++
				return arg.chat_log || []
			},
		},
	},
}
