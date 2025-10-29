import { Client as DiscordClient, GatewayIntentBits as DiscordGatewayIntentBits, Partials as DiscordPartials } from 'npm:discord.js'
import { Telegraf } from 'npm:telegraf'

import { chatReply_t, chatReplyRequest_t } from '../public/shells/chat/decl/chatLog.ts'

import { info_t, locale_t, role_t, timeStamp_t } from './basedefs.ts'
import { chatLogEntry_t, prompt_struct_t, single_part_prompt_t } from './prompt_struct.ts'


/**
 * @class charState_t
 * @description 记录角色的状态信息。
 */
export class charState_t {
	/**
	 * @description 初始化次数。
	 */
	init_count: number
	/**
	 * @description 启动次数。
	 */
	start_count: number
	/**
	 * @description 上次启动的时间戳。
	 */
	last_start_time_stamp: timeStamp_t
}

/**
 * @class charInit_t
 * @description 角色初始化时传递的参数。
 */
export class charInit_t {
	/**
	 * @description 角色的状态信息。
	 */
	state: charState_t
	/**
	 * @description 当前用户的用户名。
	 */
	username: string
	/**
	 * @description 当前角色的角色名。
	 */
	charname: string
}

/**
 * @class CharAPI_t
 * @description 定义了角色插件的 API 结构。
 */
export class CharAPI_t {
	/**
	 * @description 角色的详细信息。
	 */
	info: info_t
	/**
	 * @description 在角色安装时调用，如果失败，将删除该角色文件夹下的所有文件。
	 * @param {charInit_t} stat - 角色初始化信息。
	 * @returns {Promise<void>}
	 */
	Init?: (stat: charInit_t) => Promise<void>
	/**
	 * @description 在每次启动角色时调用，如果失败，将弹出消息。
	 * @param {charInit_t} stat - 角色初始化信息。
	 * @returns {Promise<void>}
	 */
	Load?: (stat: charInit_t) => Promise<void>
	/**
	 * @description 在每次卸载角色时调用。
	 * @param {string} reason - 卸载原因。
	 * @returns {Promise<void>}
	 */
	Unload?: (reason: string) => Promise<void>
	/**
	 * @description 在卸载角色时调用。
	 * @param {string} reason - 卸载原因。
	 * @param {string} from - 卸载来源。
	 * @returns {Promise<void>}
	 */
	Uninstall?: (reason: string, from: string) => Promise<void>

	/**
	 * @description 与外壳（如聊天 WebUI、Live2D 模型等）的接口。
	 */
	interfaces: {
		/**
		 * @description 信息接口，用于更新角色的信息。
		 */
		info?: {
			/**
			 * @description 更新角色的本地化信息。
			 * @param {locale_t[]} locales - 本地化信息数组。
			 * @returns {Promise<info_t>} - 更新后的角色信息。
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
			 * @description 获取问候语。
			 * @param {chatReplyRequest_t} arg - 聊天回复请求。
			 * @param {number} index - 索引。
			 * @returns {Promise<chatReply_t | null>} - 聊天回复或 null。
			 */
			GetGreeting: (arg: chatReplyRequest_t, index: number) => Promise<chatReply_t | null>
			/**
			 * @description 获取群组问候语。
			 * @param {chatReplyRequest_t} arg - 聊天回复请求。
			 * @param {number} index - 索引。
			 * @returns {Promise<chatReply_t | null>} - 聊天回复或 null。
			 */
			GetGroupGreeting: (arg: chatReplyRequest_t, index: number) => Promise<chatReply_t | null>
			/**
			 * @description 获取提示。
			 * @param {chatReplyRequest_t} arg - 聊天回复请求。
			 * @param {prompt_struct_t} prompt_struct - 提示结构。
			 * @param {number} detail_level - 详细程度。
			 * @returns {Promise<single_part_prompt_t>} - 单部分提示。
			 */
			GetPrompt: (arg: chatReplyRequest_t, prompt_struct: prompt_struct_t, detail_level: number) => Promise<single_part_prompt_t>;
			/**
			 * @description 为其他人获取提示。
			 * @param {chatReplyRequest_t} arg - 聊天回复请求。
			 * @param {prompt_struct_t} prompt_struct - 提示结构。
			 * @param {number} detail_level - 详细程度。
			 * @returns {Promise<single_part_prompt_t>} - 单部分提示。
			 */
			GetPromptForOther: (arg: chatReplyRequest_t, prompt_struct: prompt_struct_t, detail_level: number) => Promise<single_part_prompt_t>;
			/**
			 * @description 获取回复。
			 * @param {chatReplyRequest_t} arg - 聊天回复请求。
			 * @returns {Promise<chatReply_t | null>} - 聊天回复或 null。
			 */
			GetReply: (arg: chatReplyRequest_t) => Promise<chatReply_t | null>
			/**
			 * @description 获取回复频率。
			 * @param {chatReplyRequest_t} arg - 聊天回复请求。
			 * @returns {Promise<number>} - 回复频率。
			 */
			GetReplyFrequency?: (arg: chatReplyRequest_t) => Promise<number>
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
		},
		/**
		 * @description Discord 机器人接口。
		 */
		discord?: {
			/**
			 * @description Discord Gateway Intents。
			 */
			Intents?: DiscordGatewayIntentBits[]
			/**
			 * @description Discord Partials。
			 */
			Partials?: DiscordPartials[]
			/**
			 * @description 在 Discord 客户端准备好后调用一次。
			 * @param {DiscordClient} client - Discord 客户端。
			 * @param {any} config - 配置。
			 * @returns {Promise<void>}
			 */
			OnceClientReady: (client: DiscordClient, config: any) => Promise<void>
			/**
			 * @description 获取机器人配置模板。
			 * @returns {Promise<any>} - 配置模板。
			 */
			GetBotConfigTemplate: () => Promise<any>
		},
		/**
		 * @description Telegram 机器人接口。
		 */
		telegram?: {
			/**
			 * @description 设置 Telegram 机器人。
			 * @param {Telegraf} bot - Telegraf 机器人实例。
			 * @param {any} config - 配置。
			 * @returns {Promise<void>}
			 */
			BotSetup?: (bot: Telegraf, config: any) => Promise<void>;
			/**
			 * @description 获取机器人配置模板。
			 * @returns {Promise<any>} - 配置模板。
			 */
			GetBotConfigTemplate?: () => Promise<any>;
		},
		/**
		 * @description 浏览器集成接口。
		 */
		browserIntegration?: {
			/**
			 * @description 浏览器 JavaScript 回调。
			 * @param {object} arg - 参数对象。
			 * @returns {Promise<void>}
			 */
			BrowserJsCallback: (arg: { data: any, pageId: number, script: string }) => Promise<void>;
		},
		/**
		 * @description Shell 助手接口。
		 */
		shellassist?: {
			/**
			 * @description 辅助函数。
			 * @param {object} data - 数据对象。
			 * @returns {Promise<object>} - 辅助结果。
			 */
			Assist: (data: {
				username: string
				UserCharname: string
				shelltype: string
				shellhistory: ({
					command: string
					output: string
					error: string
					time: timeStamp_t
				} | {
					role: role_t
					content: string
				})[]
				pwd: string
				command_now: string
				command_output: string
				command_error: string
				rejected_commands: string[]
				chat_scoped_char_memory: object
			}) => Promise<{
				name: string
				avatar: string
				recommend_command: string
				content: string
				chat_scoped_char_memory: object
			}>
		},
		/**
		 * @description 桌面宠物接口。
		 */
		deskpet?: {
			/**
			 * @description 获取宠物配置。
			 * @returns {Promise<object>} - 宠物配置。
			 */
			GetPetConfig: () => Promise<{
				/**
				 * @description 在 webview 中加载的 URL。
				 */
				url: string;

				/**
				 * @description webview 窗口的选项。
				 */
				windowOptions?: {
					width?: number;
					height?: number;
					frameless?: boolean;
					transparent?: boolean;
					/**
					 * @description 窗口大小调整提示。
					 */
					hint?: 'none' | 'fixed' | 'min' | 'max';
				};
			}>;
		}
	}
}
