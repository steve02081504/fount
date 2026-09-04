/**
 * code shell 内联 world：将所选 profile 正文与工作区根 AGENTS.md 注入 system 上下文最前（world prompt 段顶部）。
 * @typedef {import('../../../../../decl/chatLog.ts').chatReplyRequest_t} chatReplyRequest_t
 */
import { getProfile, loadWorkspaceAgentsMd } from './context.mjs'

/**
 * code world 实例（无状态，按请求 args 读取 profile/工作区）。
 * @type {import('../../../../../decl/worldAPI.ts').WorldAPI_t}
 */
export const codeWorld = {
	info: {
		'zh-CN': {
			name: 'code世界',
			description: 'code shell 环境说明：注入所选 profile 与工作区 AGENTS.md 上下文。',
		},
		'en-UK': {
			name: 'code world',
			description: 'code shell environment: injects the selected profile and workspace AGENTS.md context.',
		},
	},
	interfaces: {
		chat: {
			/**
			 * 获取提示：profile 正文 + 工作区根 AGENTS.md（important 0，位于 world prompt 段最前）。
			 * @param {chatReplyRequest_t} args - 聊天回复请求。
			 * @returns {Promise<import('../../../../../decl/prompt_struct.ts').single_part_prompt_t>} prompt 贡献。
			 */
			async GetPrompt(args) {
				const texts = []
				const profileName = args.extension?.code?.profile
				if (profileName) {
					const profile = await getProfile(args.username, args.workdir, profileName).catch(() => null)
					if (profile?.content)
						texts.push({ content: profile.content, description: `Profile: ${profile.name}`, important: 0 })
				}
				const agentsMd = await loadWorkspaceAgentsMd(args.username, args.workdir).catch(() => null)
				if (agentsMd)
					texts.push({ content: agentsMd.content, description: `AGENTS.md (${agentsMd.path})`, important: 0 })
				return {
					text: texts,
					additional_chat_log: [],
					extension: {},
				}
			},
		},
	},
}
