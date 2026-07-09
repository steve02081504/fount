/**
 * M8：replicated distribution 测试 world；演示 ChatHostConnected + 折叠层权限过滤。
 * @type {import('../../../../../../../../../decl/worldAPI.ts').WorldAPI_t}
 */
const HOOK_KEY = '__fount_replicated_world_hook_state__'

/** 键格式 `protected/{senderPubKeyHash}/...`：仅该 sender 的写入参与折叠。 */
const PROTECTED_PREFIX = 'protected/'

/**
 * @returns {{
 *   hostConnected: number,
 *   promptCalls: number,
 *   host: import('../../../../../../../../../decl/worldAPI.ts').WorldChatHost_t | null,
 *   lastFoldIgnored: number,
 * }} 调用计数与 host 引用
 */
function hookState() {
	if (!globalThis[HOOK_KEY])
		globalThis[HOOK_KEY] = { hostConnected: 0, promptCalls: 0, host: null, lastFoldIgnored: 0 }
	return globalThis[HOOK_KEY]
}

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
				hookState().lastFoldIgnored++
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
				const state = hookState()
				state.hostConnected++
				state.host = host
			},
			/**
			 * @returns {Promise<object>} 带标记的 prompt
			 */
			GetPrompt: async () => {
				hookState().promptCalls++
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
