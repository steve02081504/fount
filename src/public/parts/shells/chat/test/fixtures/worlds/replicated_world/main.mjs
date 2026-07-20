import { replicatedWorldHookState } from 'fount/public/parts/shells/chat/test/fixtures/probes/replicatedWorldHookState.mjs'

/**
 * replicated distribution 测试 world；演示 ChatHostConnected + 折叠层权限过滤。
 * @type {import('../../../../../../../../../decl/worldAPI.ts').WorldAPI_t}
 */

/** 键格式 `protected/{senderPubKeyHash}/...`：仅该 sender 的写入参与折叠。 */
const PROTECTED_PREFIX = 'protected/'

/**
 * 按成员身份折叠 world_state log（演示 replicated 权限语义）。
 * @param {import('../../../../../../../../../decl/worldAPI.ts').WorldChatHost_t} host WorldChatHost
 * @param {string} key 状态键
 * @returns {Promise<unknown>} 折叠后的值
 */
export async function foldAuthorizedValue(host, key) {
	const writes = await host.state.log()
	let value
	for (const write of writes) {
		if (write.content.key !== key) continue
		if (key.startsWith(PROTECTED_PREFIX)) {
			const allowedSender = key.slice(PROTECTED_PREFIX.length).split('/')[0]?.toLowerCase()
			if (allowedSender && write.sender?.toLowerCase() !== allowedSender) {
				replicatedWorldHookState.lastFoldIgnored++
				continue
			}
		}
		if (write.content.action === 'delete') value = undefined
		else if (write.content.action === 'set') value = write.content.value
	}
	return value
}

/**
 *
 */
export default {
	distribution: 'replicated',
	info: {
		'zh-CN': {
			name: 'Replicated 分布测试世界',
			avatar: '🌐',
			description: 'distribution: replicated fixture',
			version: '1.0.0',
			author: 'fount',
			tags: ['test'],
		},
		'en-US': {
			name: 'Replicated distribution test world',
			avatar: '🌐',
			description: 'distribution: replicated fixture',
			version: '1.0.0',
			author: 'fount',
			tags: ['test'],
		},
	},
	interfaces: {
		chat: {
			/**
			 * @param {import('../../../../../../../../../decl/worldAPI.ts').WorldChatHost_t} host WorldChatHost
			 * @returns {Promise<void>}
			 */
			ChatHostConnected: async host => {
				replicatedWorldHookState.hostConnected++
				replicatedWorldHookState.host = host
			},
			/**
			 * @returns {Promise<object>} 带标记的 prompt
			 */
			GetPrompt: async () => {
				replicatedWorldHookState.promptCalls++
				return {
					text: [{ content: 'replicated-world-prompt-marker', important: 0 }],
					additional_chat_log: [],
					extension: {},
				}
			},
			/**
			 * @param {object} arg chatReplyRequest
			 * @returns {Promise<object[]>} 原 chat_log
			 */
			GetChatLogForViewer: async arg => arg.chat_log || [],
		},
	},
}
