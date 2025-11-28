import { LoadChar } from '../../../server/managers/char_manager.mjs'
import { unlockAchievement } from '../achievements/src/api.mjs'

import info from './info.json' with { type: 'json' }
import { setEndpoints } from './src/endpoints.mjs'

/** @typedef {import('../../../decl/basedefs.ts').info_t} info_t */

/**
 * Shell aassist 的入口点。
 */
export default {
	/**
	 * Shell 的信息。
	 * @type {info_t}
	 */
	info,
	/**
	 * 加载终端辅助Shell并设置API端点。
	 * @param {object} options - 选项。
	 * @param {object} options.router - Express的路由实例。
	 */
	Load: ({ router }) => {
		setEndpoints(router)
	},
	/**
	 * Shell的接口定义。
	 */
	interfaces: {
		/**
		 * 调用接口的定义。
		 */
		invokes: {
			/**
			 * 处理来自IPC的调用请求，以获取终端辅助。
			 * @param {string} username - 用户的名称。
			 * @param {object} data - 从IPC接收的数据。
			 * @returns {Promise<object>} - 辅助结果。
			 */
			IPCInvokeHandler: async (username, data) => {
				unlockAchievement(username, 'shells', 'shellassist', 'invoke_shell_assist')
				const char = await LoadChar(username, data.charname)
				if (!char.interfaces.shellassist) {
					const { GetDefaultShellAssistInterface } = await import('./src/default_interface/main.mjs')
					char.interfaces.shellassist = await GetDefaultShellAssistInterface(char, username, data.charname)
				}
				const result = await char.interfaces.shellassist.Assist({
					...data,
					username,
					UserCharname: data.UserCharname || username,
					chat_scoped_char_memory: data.chat_scoped_char_memorys[data.charname] || {},
					chat_scoped_char_memorys: undefined
				})
				return {
					...result,
					chat_scoped_char_memorys: {
						...data.chat_scoped_char_memorys,
						[data.charname]: result.chat_scoped_char_memory
					},
					chat_scoped_char_memory: undefined
				}
			}
		}
	}
}
