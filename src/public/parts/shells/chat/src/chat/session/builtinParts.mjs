/**
 * 【文件】builtinParts.mjs — chat shell 内置极小 world / persona（null-object）
 * 【职责】未绑定/未安装时由 resolveWorld / loadPlayerFields 回退到本文件单例，使交互拓扑无例外。
 * 【原理】钩子全透传或空贡献；不实现 GetSpeakingOrder / GetCharReply / GetGreeting / MessageEdit(Delete) 等语义可选钩子（调用方仍用 if (fn)）。
 * 【数据结构】BUILTIN_WORLD（distribution: 'local'）、BUILTIN_PERSONA；非磁盘 part，不进 bind/安装。
 * 【关联】resolvePart、timeSliceParts、runtime、viewerLog、materializeViewerLog。
 */

/**
 * @returns {{ text: unknown[], additional_chat_log: unknown[], extension: object }} 空贡献
 */
function emptyPrompt() {
	return {
		text: [],
		additional_chat_log: [],
		extension: {},
	}
}

/**
 * shell 内置极小 world：无规则、本机执行。
 * @type {import('../../../../../../../decl/worldAPI.ts').WorldAPI_t}
 */
export const BUILTIN_WORLD = {
	distribution: 'local',
	info: {
		'zh-CN': {
			name: '（无世界）',
			description: 'chat shell 内置空世界',
			avatar: '',
			version: '0',
			author: 'fount',
			tags: ['builtin'],
		},
		'en-US': {
			name: '(no world)',
			description: 'chat shell builtin empty world',
			avatar: '',
			version: '0',
			author: 'fount',
			tags: ['builtin'],
		},
	},
	interfaces: {
		chat: {
			/**
			 * @param {object} arg chatReplyRequest
			 * @returns {Promise<object[]>} 原 chat_log
			 */
			GetChatLogForViewer: async arg => arg.chat_log,
			/**
			 * @returns {Promise<object>} 空贡献
			 */
			GetPrompt: async () => emptyPrompt(),
			/**
			 * @returns {Promise<{ public?: string, perMember?: object }>} 空
			 */
			GetGroupPrompt: async () => ({}),
			/**
			 * @returns {Promise<void>}
			 */
			TweakPrompt: async () => { },
		},
	},
}

/**
 * shell 内置极小 persona：human 席位永远经过一个 persona。
 * @type {import('../../../../../../../decl/userAPI.ts').UserAPI_t}
 */
export const BUILTIN_PERSONA = {
	info: {
		'zh-CN': {
			name: '（无人格）',
			description: 'chat shell 内置空人格',
			avatar: '',
			version: '0',
			author: 'fount',
			tags: ['builtin'],
		},
		'en-US': {
			name: '(no persona)',
			description: 'chat shell builtin empty persona',
			avatar: '',
			version: '0',
			author: 'fount',
			tags: ['builtin'],
		},
	},
	interfaces: {
		chat: {
			/**
			 * @returns {Promise<object>} 空贡献
			 */
			GetPrompt: async () => emptyPrompt(),
			/**
			 * @returns {Promise<void>}
			 */
			TweakPrompt: async () => { },
			/**
			 * @param {object} arg chatReplyRequest
			 * @returns {Promise<object[]>} 原 chat_log
			 */
			GetChatLogForViewer: async arg => arg.chat_log,
			/**
			 * @returns {Promise<undefined>} 透传
			 */
			BeforeUserSend: async () => undefined,
		},
	},
}
