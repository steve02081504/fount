import { localhostLocales } from '../../../../../../src/scripts/i18n.mjs'
import { getPartInfo } from '../../../../../scripts/locale.mjs'
import { getAnyPreferredDefaultPart, loadPart } from '../../../../../server/parts_loader.mjs'

import { recommend_command_plugin } from './recommend_command.mjs'
import { GetShellWorld } from './world.mjs'
/** @typedef {import('../../../../../../src/public/parts/shells:chat/decl/chatLog.ts').chatLogEntry_t} chatLogEntry_t */

/**
 * 获取默认的 ShellAssist 接口。
 * @param {import('../../../../../decl/charAPI.ts').CharAPI_t} char_API - 角色 API。
 * @param {string} username - 用户名。
 * @param {string} char_name - 角色名称。
 * @returns {object} - ShellAssist 接口。
 */
export function GetDefaultShellAssistInterface(char_API, username, char_name) {
	if (!char_API?.interfaces?.chat?.GetReply)
		throw new Error('charAPI.interfaces.chat.GetReply is required for ShellAssistInterface.')
	/**
	 * ShellAssist 主函数。
	 * @type {(data: {
	 * 	username: string
	 * 	UserCharname: string
	 * 	shelltype: string
	 * 	shellhistory: ({
	 * 		command: string
	 * 		output: string
	 * 		error: string
	 * 		time: timeStamp_t
	 * 	} | {
	 * 		role: role_t
	 * 		content: string
	 * 	})[]
	 *  pwd: string
	 *  screen: string
	 * 	command_now: string
	 * 	command_output: string
	 * 	command_error: string
	 * 	rejected_commands: string[]
	 * 	chat_scoped_char_memory: object
	 * }) => Promise<{
	 * 	name: string
	 * 	avatar: string
	 * 	recommend_command: string
	 * 	content: string
	 * 	chat_scoped_char_memory: object
	 * }>}
	 */
	async function shellAssistMain(args) {
		/** @type {chatLogEntry_t[]} */
		const chat_log = []
		for (const entry of args.shellhistory)
			if (entry.command)
				chat_log.push({
					role: 'system',
					name: args.shelltype || '终端',
					content: `\
用户执行了命令: \`${entry.command}\`

执行结果：
stdout: ${entry.output.includes('\n') ? '\n```\n' + entry.output + '\n```' : '`' + entry.output + '`'}
stderr: ${entry.error.includes('\n') ? '\n```\n' + entry.error + '\n```' : '`' + entry.error + '`'}
`,
					files: [],
					extension: entry.extension ??= {}
				})
			else
				chat_log.push({
					...entry,
					extension: entry.extension ??= {},
					files: [],
				})
		for (const entry of chat_log)
			if (entry.extension.recommend_command)
				entry.content = entry.content.trimEnd() + `\n<recommend_command>\n${entry.extension.recommend_command}\n</recommend_command>`

		let user_doing_now = ''
		if (args.screen) user_doing_now += `\
现在的屏幕内容：
\`\`\`
${args.screen}
\`\`\`
`
		user_doing_now += `\
用户现在执行的命令：\`${args.command_now}\`
所在路径：\`${args.pwd}\`
`
		if (args.command_output) user_doing_now += `\
输出内容：\`${args.command_output}\`
`
		if (args.command_error) user_doing_now += `\
错误信息：\`${args.command_error}\`
`
		if (args.rejected_commands.length) user_doing_now += `\
用户已拒绝的命令：\`${args.rejected_commands.join('`, `')}\`
`
		chat_log.push({
			role: 'system',
			name: args.shelltype || '终端',
			content: user_doing_now,
			files: [],
			extension: {}
		})
		const Charname = (await getPartInfo(char_API, localhostLocales)).name
		const AIsuggestion = await char_API.interfaces.chat.GetReply({
			supported_functions: {
				markdown: false,
				mathjax: false,
				html: false,
				unsafe_html: false,
				files: false,
				add_message: false,
			},
			chat_name: 'shell-assist-' + new Date().getTime(),
			char_id: char_name,
			Charname,
			UserCharname: args.UserCharname,
			locales: localhostLocales,
			time: new Date(),
			world: GetShellWorld(args.shelltype),
			user: await (async () => { const n = getAnyPreferredDefaultPart(username, 'personas'); if (n) return loadPart(username, 'personas/' + n); return null })(),
			char: char_API,
			other_chars: [],
			plugins: {
				recommend_command: recommend_command_plugin
			},
			chat_summary: '',
			chat_scoped_char_memory: args.chat_scoped_char_memory,
			chat_log
		})
		if (!AIsuggestion) return
		return {
			name: Charname,
			recommend_command: AIsuggestion.recommend_command,
			content: AIsuggestion.content,
			chat_scoped_char_memory: args.chat_scoped_char_memory,
			shellhistory: args.shellhistory,
			extension: AIsuggestion.extension,
		}
	}
	return {
		Assist: shellAssistMain,
	}
}
