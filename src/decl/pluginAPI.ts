import { chatReplyRequest_t } from '../public/shells/chat/decl/chatLog.ts'

import { locale_t, info_t } from './basedefs.ts'
import { chatLogEntry_t, prompt_struct_t, single_part_prompt_t } from './prompt_struct.ts'

/**
 * @description 定义了回复处理程序的类型。
 * @param {chatLogEntry_t} reply - 聊天回复条目。
 * @param {chatReplyRequest_t & {
 * 	prompt_struct: prompt_struct_t
 * 	AddLongTimeLog?: (entry: chatLogEntry_t) => void
 * }} args - 参数对象。
 * @returns {Promise<boolean>} - 如果处理成功则返回 true，否则返回 false。
 */
export type ReplyHandler_t = (reply: chatLogEntry_t, args: chatReplyRequest_t & {
	prompt_struct: prompt_struct_t
	AddLongTimeLog?: (entry: chatLogEntry_t) => void
}) => Promise<boolean>

/**
 * @class pluginAPI_t
 * @description 定义了插件的 API 结构。
 */
export class pluginAPI_t {
	/**
	 * @description 插件的详细信息。
	 */
	info: info_t
	/**
	 * @description 初始化插件。
	 * @returns {Promise<void>}
	 */
	Init?: () => Promise<void>
	/**
	 * @description 加载插件。
	 * @returns {Promise<void>}
	 */
	Load?: () => Promise<void>
	/**
	 * @description 卸载插件。
	 * @param {string} reason - 卸载原因。
	 * @returns {Promise<void>}
	 */
	Unload?: (reason: string) => Promise<void>
	/**
	 * @description 卸载插件。
	 * @param {string} reason - 卸载原因。
	 * @param {string} from - 卸载来源。
	 * @returns {Promise<void>}
	 */
	Uninstall?: (reason: string, from: string) => Promise<void>

	/**
	 * @description 插件支持的接口。
	 */
	interfaces: {
		/**
		 * @description 信息接口，用于更新插件的信息。
		 */
		info?: {
			/**
			 * @description 更新插件的本地化信息。
			 * @param {locale_t[]} locales - 本地化信息数组。
			 * @returns {Promise<info_t>} - 更新后的插件信息。
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
			 * @description 在聊天中为角色扩充提示。
			 * @param {chatReplyRequest_t} arg - 聊天回复请求。
			 * @param {prompt_struct_t} prompt_struct - 提示结构。
			 * @param {number} detail_level - 详细程度。
			 * @returns {Promise<single_part_prompt_t>} - 单部分提示。
			 */
			GetPrompt?: (arg: chatReplyRequest_t, prompt_struct: prompt_struct_t, detail_level: number) => Promise<single_part_prompt_t>;
			/**
			 * @description 处理角色的回复，返回 true 表示成功（需要重新生成），false 表示无命中。
			 */
			ReplyHandler?: ReplyHandler_t

			/**
			 * @description 此函数在合适时机扩充至角色的有关代码运行的提示中，为角色更好掌握代码运行的上下文提供基础。
			 * @param {chatReplyRequest_t} arg - 聊天回复请求。
			 * @param {prompt_struct_t} prompt_struct - 提示结构。
			 * @param {number} detail_level - 详细程度。
			 * @returns {Promise<string | undefined>} - JavaScript 代码提示或 undefined。
			 */
			GetJSCodePrompt?: (arg: chatReplyRequest_t, prompt_struct: prompt_struct_t, detail_level: number) => Promise<string | undefined>;
			/**
			 * @description 此函数为角色的代码运行提供特殊变量或函数，允许其在代码中使用。
			 * @param {chatReplyRequest_t} arg - 聊天回复请求。
			 * @param {prompt_struct_t} prompt_struct - 提示结构。
			 * @returns {Promise<Record<string, any>>} - 包含特殊变量或函数的对象。
			 */
			GetJSCodeContext?: (arg: chatReplyRequest_t, prompt_struct: prompt_struct_t) => Promise<Record<string, any>>;
		}
	}
}
