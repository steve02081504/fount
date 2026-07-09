import { channelMessageContent_t, chatReplyRequest_t, type chatViewer_t, file_t } from '../public/parts/shells/chat/decl/chatLog.ts'

import { locale_t, info_t } from './basedefs.ts'
import { chatLogEntry_t, prompt_struct_t, single_part_prompt_t } from './prompt_struct.ts'

/**
 * 用户API接口
 * @class UserAPI_t
 * 定义了用户 API 的结构。
 */
export class UserAPI_t {
	/**
	 * 用户 API 的详细信息。
	 */
	info: info_t
	/**
	 * 仅在安装时调用，如果失败，将删除此角色文件夹下的所有文件。
	 * @returns {Promise<void>}
	 */
	Init?: () => Promise<void>
	/**
	 * 在每次启动时调用，如果失败，将弹出消息。
	 * @returns {Promise<void>}
	 */
	Load?: () => Promise<void>
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
	 * 用户 API 支持的接口。
	 */
	interfaces?: {
		/**
		 * 信息接口，用于更新用户 API 的信息。
		 */
		info?: {
			/**
			 * 更新用户 API 的本地化信息。
			 * @param {locale_t[]} locales - 本地化信息数组。
			 * @returns {Promise<info_t>} - 更新后的用户 API 信息。
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
			 * 获取提示。
			 * @param {chatReplyRequest_t} arg - 聊天回复请求。
			 * @returns {Promise<single_part_prompt_t>} - 单部分提示。
			 */
			GetPrompt: (arg: chatReplyRequest_t) => Promise<single_part_prompt_t>;
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
			 * 真人发送前拦截：可改写 input/files，或通过 reject 拒绝（服务端语义）。
			 * @param {object} ctx - 发送上下文。
			 * @returns {Promise<{ input?: channelMessageContent_t, files?: file_t[], reject?: string } | undefined>} - 改写/拒绝；undefined 透传。
			 */
			BeforeUserSend?: (ctx: {
				groupId: string
				channelId: string
				username: string
				personaname?: string
				memberId: string
				input: channelMessageContent_t
				files?: file_t[]
			}) => Promise<{
				input?: channelMessageContent_t
				files?: file_t[]
				reject?: string
			} | undefined>
			/**
			 * 按观察者返回人格主观滤镜下的聊天记录（正式主接口；不篡改 DAG 真相）。
			 * @param {chatReplyRequest_t} arg - 聊天回复请求。
			 * @param {chatViewer_t} viewer - 统一观察者身份。
			 * @returns {Promise<chatLogEntry_t[]>} - 聊天记录条目数组。
			 */
			GetChatLogForViewer?: (arg: chatReplyRequest_t, viewer: chatViewer_t) => Promise<chatLogEntry_t[]>
			/**
			 * 真人编辑前拦截：可改写 edited，或通过 reject 拒绝（服务端语义）。
			 */
			BeforeUserEdit?: (ctx: {
				groupId: string
				channelId: string
				username: string
				personaname?: string
				memberId: string
				eventId: string
				original: object
				edited: channelMessageContent_t
			}) => Promise<{
				edited?: channelMessageContent_t
				reject?: string
			} | undefined>
			/**
			 * 真人删除前拦截：reject 拒绝删除。
			 */
			BeforeUserDelete?: (ctx: {
				groupId: string
				channelId: string
				username: string
				personaname?: string
				memberId: string
				eventId: string
				original: object
			}) => Promise<{ reject?: string } | undefined>
		}
	}
}
