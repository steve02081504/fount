import { chatReply_t, chatReplyRequest_t } from '../public/shells/chat/decl/chatLog.ts'

import { locale_t, info_t } from './basedefs.ts'
import { chatLogEntry_t, prompt_struct_t, single_part_prompt_t } from './prompt_struct.ts'

/**
 * @class WorldAPI_t
 * 定义了世界 API 的结构。
 */
export class WorldAPI_t {
	/**
	 * 世界 API 的详细信息。
	 */
	info: info_t
	/**
	 * 仅在安装时调用，如果失败，将删除此世界文件夹下的所有文件。
	 * @param {object} stat - 状态对象。
	 * @param {string} stat.username - 用户名。
	 * @param {string} stat.worldname - 世界名称。
	 * @returns {Promise<void>}
	 */
	Init?: (stat: {
		username: string,
		worldname: string,
	}) => Promise<void>
	/**
	 * 在每次启动时调用，如果失败，将弹出消息。
	 * @param {object} stat - 状态对象。
	 * @param {string} stat.username - 用户名。
	 * @param {string} stat.worldname - 世界名称。
	 * @returns {Promise<void>}
	 */
	Load?: (stat: {
		username: string,
		worldname: string,
	}) => Promise<void>
	/**
	 * 在每次卸载时调用。
	 * @param {string} reason - 卸载原因。
	 * @returns {Promise<void>}
	 */
	Unload?: (reason: string) => Promise<void>
	/**
	 * 在卸载时调用。
	 * @param {string} reason - 卸载原因。
	 * @param {string} from - 卸载来源。
	 * @returns {Promise<void>}
	 */
	Uninstall?: (reason: string, from: string) => Promise<void>

	/**
	 * 世界 API 支持的接口。
	 */
	interfaces?: {
		/**
		 * 信息接口，用于更新世界 API 的信息。
		 */
		info?: {
			/**
			 * 更新世界 API 的本地化信息。
			 * @param {locale_t[]} locales - 本地化信息数组。
			 * @returns {Promise<info_t>} - 更新后的世界 API 信息。
			 */
			UpdateInfo: (locales: locale_t[]) => Promise<info_t>,
		},
		/**
		 * 配置接口，用于获取和设置配置数据。
		 */
		config?: {
			/**
			 * 获取配置数据。
			 * @returns {Promise<any>} - 配置数据。
			 */
			GetData: () => Promise<any>
			/**
			 * 设置配置数据。
			 * @param {any} data - 要设置的配置数据。
			 * @returns {Promise<void>}
			 */
			SetData: (data: any) => Promise<void>
		},
		/**
		 * 聊天接口，用于处理聊天相关的功能。
		 */
		chat?: {
			/**
			 * 获取问候语。
			 * @param {chatReplyRequest_t} arg - 聊天回复请求。
			 * @param {number} index - 索引。
			 * @returns {Promise<chatReply_t | null>} - 聊天回复或 null。
			 */
			GetGreeting?: (arg: chatReplyRequest_t, index: number) => Promise<chatReply_t | null>
			/**
			 * 获取群组问候语。
			 * @param {chatReplyRequest_t} arg - 聊天回复请求。
			 * @param {number} index - 索引。
			 * @returns {Promise<chatReply_t | null>} - 聊天回复或 null。
			 */
			GetGroupGreeting?: (arg: chatReplyRequest_t, index: number) => Promise<chatReply_t | null>
			/**
			 * 获取提示。
			 * @param {chatReplyRequest_t} arg - 聊天回复请求。
			 * @returns {Promise<single_part_prompt_t>} - 单部分提示。
			 */
			GetPrompt?: (arg: chatReplyRequest_t) => Promise<single_part_prompt_t>;
			/**
			 * 调整提示。
			 * @param {chatReplyRequest_t} arg - 聊天回复请求。
			 * @param {prompt_struct_t} prompt_struct - 提示结构。
			 * @param {single_part_prompt_t} my_prompt - 我的提示。
			 * @param {number} detail_level - 详细程度。
			 * @returns {Promise<void>} - 无返回值。
			 */
			TweakPrompt?: (arg: chatReplyRequest_t, prompt_struct: prompt_struct_t, my_prompt: single_part_prompt_t, detail_level: number) => Promise<void>
			/**
			 * 获取指定角色名称的聊天记录。
			 * @param {chatReplyRequest_t} arg - 聊天回复请求。
			 * @param {string} charname - 角色名称。
			 * @returns {Promise<chatLogEntry_t[]>} - 聊天记录条目数组。
			 */
			GetChatLogForCharname?: (arg: chatReplyRequest_t, charname: string) => Promise<chatLogEntry_t[]>
			/**
			 * 添加聊天记录条目。
			 * @param {chatReplyRequest_t} arg - 聊天回复请求。
			 * @param {chatLogEntry_t} entry - 聊天记录条目。
			 * @returns {Promise<void>}
			 */
			AddChatLogEntry?: (arg: chatReplyRequest_t, entry: chatLogEntry_t) => Promise<void>
			/**
			 * 添加聊天记录条目后调用。
			 * @param {chatReplyRequest_t} arg - 聊天回复请求。
			 * @param {object[]} freq_data - 频率数据。
			 * @returns {Promise<void>}
			 */
			AfterAddChatLogEntry?: (arg: chatReplyRequest_t, freq_data: {
				charname: null;
				frequency: number;
			}[]) => Promise<void>
			/**
			 * 获取角色回复。
			 * @param {chatReplyRequest_t} arg - 聊天回复请求。
			 * @param {string} charname - 角色名称。
			 * @returns {Promise<chatReply_t | null>} - 聊天回复或 null。
			 */
			GetCharReply?: (arg: chatReplyRequest_t, charname: string) => Promise<chatReply_t | null>
			/**
			 * 编辑消息。
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
			 * 正在编辑消息。
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
			 * 删除消息。
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
