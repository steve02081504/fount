import { chatReplyRequest_t, chatReply_t } from '../public/shells/chat/decl/chatLog.ts'

import { locale_t, info_t } from './basedefs'
import { chatLogEntry_t, prompt_struct_t, single_part_prompt_t } from './prompt_struct.ts'

/**
 * @class UserAPI_t
 * @description 定义了用户 API 的结构。
 */
export class UserAPI_t {
	/**
	 * @description 用户 API 的详细信息。
	 */
	info: info_t
	/**
	 * @description 仅在安装时调用，如果失败，将删除此角色文件夹下的所有文件。
	 * @returns {Promise<void>}
	 */
	Init?: () => Promise<void>
	/**
	 * @description 在每次启动时调用，如果失败，将弹出消息。
	 * @returns {Promise<void>}
	 */
	Load?: () => Promise<void>
	/**
	 * @description 在每次卸载时调用。
	 * @param {string} reason - 卸载原因。
	 * @returns {Promise<void>}
	 */
	Unload?: (reason: string) => Promise<void>
	/**
	 * @description 在卸载时调用。
	 * @param {string} reason - 卸载原因。
	 * @param {string} from - 卸载来源。
	 * @returns {Promise<void>}
	 */
	Uninstall?: (reason: string, from: string) => Promise<void>

	/**
	 * @description 用户 API 支持的接口。
	 */
	interfaces?: {
		/**
		 * @description 信息接口，用于更新用户 API 的信息。
		 */
		info?: {
			/**
			 * @description 更新用户 API 的本地化信息。
			 * @param {locale_t[]} locales - 本地化信息数组。
			 * @returns {Promise<info_t>} - 更新后的用户 API 信息。
			 */
			UpdateInfo: (locales: locale_t[]) => Promise<info_t>,
		},
		/**
		 * @description 配置接口，用于获取和设置配置数据。
		 */
		config?: {
			/**
			 * @description 获取配置数据。
			 * @returns {Promise<any>} - 配置数据。
			 */
			GetData: () => Promise<any>
			/**
			 * @description 设置配置数据。
			 * @param {any} data - 要设置的配置数据。
			 * @returns {Promise<void>}
			 */
			SetData: (data: any) => Promise<void>
		},
		/**
		 * @description 聊天接口，用于处理聊天相关的功能。
		 */
		chat?: {
			/**
			 * @description 获取提示。
			 * @param {chatReplyRequest_t} arg - 聊天回复请求。
			 * @param {prompt_struct_t} prompt_struct - 提示结构。
			 * @param {number} detail_level - 详细程度。
			 * @returns {Promise<single_part_prompt_t>} - 单部分提示。
			 */
			GetPrompt: (arg: chatReplyRequest_t, prompt_struct: prompt_struct_t, detail_level: number) => Promise<single_part_prompt_t>;
			/**
			 * @description 获取聊天记录。
			 * @param {chatReplyRequest_t} arg - 聊天回复请求。
			 * @returns {Promise<chatLogEntry_t[]>} - 聊天记录条目数组。
			 */
			GetChatLog?: (arg: chatReplyRequest_t) => Promise<chatLogEntry_t[]>
			/**
			 * @description 编辑消息。
			 * @param {object} arg - 参数对象。
			 * @returns {Promise<chatReply_t>} - 编辑后的聊天回复。
			 */
			MessageEdit?: (arg: {
				index: number
				original: chatLogEntry_t
				edited: chatReply_t
				chat_log: chatLogEntry_t[]
				extension?: any
			}) => Promise<chatReply_t>
			/**
			 * @description 正在编辑消息。
			 * @param {object} arg - 参数对象。
			 * @returns {Promise<void>}
			 */
			MessageEditing?: (arg: {
				index: number
				original: chatLogEntry_t
				edited: chatReply_t
				chat_log: chatLogEntry_t[]
				extension?: any
			}) => Promise<void>
			/**
			 * @description 删除消息。
			 * @param {object} arg - 参数对象。
			 * @returns {Promise<void>}
			 */
			MessageDelete?: (arg: {
				index: number
				chat_log: chatLogEntry_t[]
				chat_entry: chatLogEntry_t
				extension?: any
			}) => Promise<void>
		}
	}
}
