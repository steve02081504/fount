import { chatReply_t, chatReplyRequest_t, CharReplyPreviewUpdater_t } from '../public/parts/shells/chat/decl/chatLog.ts'

import { locale_t, info_t } from './basedefs.ts'
import { chatLogEntry_t, prompt_struct_t, single_part_prompt_t } from './prompt_struct.ts'

/**
 * 定义了回复处理程序的类型。
 *
 * 处理时解析 `reply.content_for_handle`（由回复管线从原始生成派生的独立工作副本），
 * 命中调用段后用 `args.MaskHandledCall` 掩除，避免工具 A 的参数触发工具 B 的调用；
 * 不要改写原始 `reply.content`。
 * @param {chatReply_t} reply - 当前这轮 AI 回复（原始生成保留于 `content`）。
 * @param {chatReplyRequest_t & {
 * 	prompt_struct: prompt_struct_t
 * 	AddLongTimeLog?: (entry: chatLogEntry_t) => void
 * 	MaskHandledCall?: (segment: string, replacement?: string) => void
 * }} args - 参数对象。
 * @returns {Promise<boolean>} - 返回 true 表示建议发起下一轮生成；false 表示不发起（本轮生成即可作为最终结果）。
 */
export type ReplyHandler_t = (reply: chatReply_t, args: chatReplyRequest_t & {
	prompt_struct: prompt_struct_t
	AddLongTimeLog?: (entry: chatLogEntry_t) => void
	MaskHandledCall?: (segment: string, replacement?: string) => void
}) => Promise<boolean>

/**
 * 插件API接口
 * @class PluginAPI_t
 * 定义了插件的 API 结构。
 */
export class PluginAPI_t {
	/**
	 * 插件的详细信息。
	 */
	info: info_t
	/**
	 * 初始化插件。
	 * @returns {Promise<void>}
	 */
	Init?: () => Promise<void>
	/**
	 * 加载插件。
	 * @returns {Promise<void>}
	 */
	Load?: () => Promise<void>
	/**
	 * 卸载插件。
	 * @param {string} reason - 卸载原因。
	 * @returns {Promise<void>}
	 */
	Unload?: (reason: string) => Promise<void>
	/**
	 * 卸载插件。
	 * @param {string} reason - 卸载原因。
	 * @param {string} from - 卸载来源。
	 * @returns {Promise<void>}
	 */
	Uninstall?: (reason: string, from: string) => Promise<void>

	/**
	 * 插件支持的接口。
	 */
	interfaces: {
		/**
		 * 信息接口，用于更新插件的信息。
		 */
		info?: {
			/**
			 * 更新插件的本地化信息。
			 * @param {locale_t[]} locales - 本地化信息数组。
			 * @returns {Promise<info_t>} - 更新后的插件信息。
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
			 * 在聊天中为角色扩充提示。
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
			 * 处理角色的回复，返回 true 表示成功（需要重新生成），false 表示无命中。
			 */
			ReplyHandler?: ReplyHandler_t

			/**
			 * 获取回复预览更新器。
			 * @param {CharReplyPreviewUpdater_t} [updater] - 上一个更新器。
			 * @returns {CharReplyPreviewUpdater_t} - 新的更新器。
			 */
			GetReplyPreviewUpdater?: (updater?: CharReplyPreviewUpdater_t) => CharReplyPreviewUpdater_t
		},
		/**
		 * 代码执行接口，用于处理代码执行相关的功能。
		 */
		code_execution?: {
			/**
			 * 此函数在合适时机扩充至角色的有关代码运行的提示中，为角色更好掌握代码运行的上下文提供基础。
			 * @param {chatReplyRequest_t} arg - 聊天回复请求。
			 * @returns {Promise<string | undefined>} - JavaScript 代码提示或 undefined。
			 */
			GetJSCodePrompt?: (arg: chatReplyRequest_t) => Promise<string | undefined>;
			/**
			 * 此函数为角色的代码运行提供特殊变量或函数，允许其在代码中使用。
			 * @param {chatReplyRequest_t} arg - 聊天回复请求。
			 * @returns {Promise<Record<string, any>>} - 包含特殊变量或函数的对象。
			 */
			GetJSCodeContext?: (arg: chatReplyRequest_t) => Promise<Record<string, any>>;
		}
	}
}
