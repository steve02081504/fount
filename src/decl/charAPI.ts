import { Client as DiscordClient, GatewayIntentBits as DiscordGatewayIntentBits, Partials as DiscordPartials } from 'npm:discord.js'
import { Telegraf } from 'npm:telegraf'

import { chatReply_t, chatReplyRequest_t } from '../public/parts/shells/chat/decl/chatLog.ts'

import { info_t, locale_t, role_t, timeStamp_t } from './basedefs.ts'
import { chatLogEntry_t as chatLogEntry_full_t } from './chatLog.ts'
import { chatLogEntry_t, prompt_struct_t, single_part_prompt_t } from './prompt_struct.ts'
import { SocialCharInterface } from './socialAPI.ts'


/**
 * 角色状态信息
 * @class charState_t
 * 记录角色的状态信息。
 */
export class charState_t {
	/**
	 * 初始化次数。
	 */
	init_count: number
	/**
	 * 启动次数。
	 */
	start_count: number
	/**
	 * 上次启动的时间戳。
	 */
	last_start_time_stamp: timeStamp_t
}

/**
 * 角色初始化时传递的参数
 * @class charInit_t
 * 角色初始化时传递的参数。
 */
export class charInit_t {
	/**
	 * 角色的状态信息。
	 */
	state: charState_t
	/**
	 * 当前用户的用户名。
	 */
	username: string
	/**
	 * 当前角色的角色名。
	 */
	charname: string
}

/**
 * 角色API接口
 * @class CharAPI_t
 * 定义了角色插件的 API 结构。
 */
export class CharAPI_t {
	/**
	 * 角色的详细信息。
	 */
	info: info_t
	/**
	 * 在角色安装时调用，如果失败，将删除该角色文件夹下的所有文件。
	 * @param {charInit_t} stat - 角色初始化信息。
	 * @returns {Promise<void>}
	 */
	Init?: (stat: charInit_t) => Promise<void>
	/**
	 * 在每次启动角色时调用，如果失败，将弹出消息。
	 * @param {charInit_t} stat - 角色初始化信息。
	 * @returns {Promise<void>}
	 */
	Load?: (stat: charInit_t) => Promise<void>
	/**
	 * 在每次卸载角色时调用。
	 * @param {string} reason - 卸载原因。
	 * @returns {Promise<void>}
	 */
	Unload?: (reason: string) => Promise<void>
	/**
	 * 在卸载角色时调用。
	 * @param {string} reason - 卸载原因。
	 * @param {string} from - 卸载来源。
	 * @returns {Promise<void>}
	 */
	Uninstall?: (reason: string, from: string) => Promise<void>
	/**
	 * 角色级错误处理；返回 true 或 void 表示已处理，false 表示未处理（由 shell 落默认路径）。
	 */
	OnError?: (error: Error, context: {
		username: string
		source: 'OnMessage' | 'OnGroupEvent' | 'GetReply' | string
		groupId?: string
		channelId?: string
		charname?: string
		event?: object
	}) => Promise<boolean | void>

	/**
	 * 与外壳（如聊天 WebUI、Live2D 模型等）的接口。
	 */
	interfaces: {
		/**
		 * 信息接口，用于更新角色的信息。
		 */
		info?: {
			/**
			 * 更新角色的本地化信息。
			 * @param {locale_t[]} locales - 本地化信息数组。
			 * @returns {Promise<info_t>} - 更新后的角色信息。
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
			GetGreeting: (arg: chatReplyRequest_t, index: number) => Promise<chatReply_t | null>
			/**
			 * 获取群组问候语。
			 * @param {chatReplyRequest_t} arg - 聊天回复请求。
			 * @param {number} index - 索引。
			 * @returns {Promise<chatReply_t | null>} - 聊天回复或 null。
			 */
			GetGroupGreeting: (arg: chatReplyRequest_t, index: number) => Promise<chatReply_t | null>
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
			 * 为其他人获取提示。
			 * @param {chatReplyRequest_t} arg - 聊天回复请求。
			 * @returns {Promise<single_part_prompt_t>} - 单部分提示。
			 */
			GetPromptForOther: (arg: chatReplyRequest_t) => Promise<single_part_prompt_t>;
			/**
			 * 为其他人调整提示。
			 * @param {chatReplyRequest_t} arg - 聊天回复请求。
			 * @param {prompt_struct_t} prompt_struct - 提示结构。
			 * @param {single_part_prompt_t} my_prompt - 我的提示。
			 * @param {number} detail_level - 详细程度。
			 * @returns {Promise<void>} - 无返回值。
			 */
			TweakPromptForOther?: (arg: chatReplyRequest_t, prompt_struct: prompt_struct_t, my_prompt: single_part_prompt_t, detail_level: number) => Promise<void>
			/**
			 * 获取回复。
			 * @param {chatReplyRequest_t} arg - 聊天回复请求。
			 * @returns {Promise<chatReply_t | null>} - 聊天回复或 null。
			 */
			GetReply: (arg: chatReplyRequest_t) => Promise<chatReply_t | null>
			/**
			 * 新消息到达时触发，角色决定是否主动发言。
			 * 返回 true 表示发言，false 表示不发言。
			 * @param {object} event - 事件上下文（可序列化事实：message / mentions / group / channel）
			 * @returns {Promise<boolean>}
			 */
			OnMessage?: (event: {
				chatReplyRequest: chatReplyRequest_t
				message: chatLogEntry_t
				mentions: {
					entityHashes: string[]
					roleIds: string[]
					everyone: boolean
				}
				group: {
					groupId: string
					name: string
					kind: 'group' | 'dm'
					boundPeerEntityHash?: string
					/** settings.bridge 整对象投影（含 chatKind / botname 等） */
					bridge?: {
						platform: string
						platformChatId: string
						chatKind?: 'group' | 'dm'
						botname?: string
						[key: string]: unknown
					}
					memberCount: number
				}
				channel: {
					channelId: string
					name: string
					kind: 'text' | 'thread'
				}
			}) => Promise<boolean>
			/**
			 * 群生命周期事件（bot 启动 / 入群 / 成员离群等）。
			 */
			OnGroupEvent?: (event: {
				type: 'bot_started' | 'bot_joined_group' | 'member_left'
				group: {
					groupId: string
					name: string
					kind: 'group' | 'dm'
					boundPeerEntityHash?: string
					bridge?: {
						platform: string
						platformChatId: string
						chatKind?: 'group' | 'dm'
						botname?: string
						[key: string]: unknown
					}
					memberCount: number
				}
				channel: {
					channelId: string
					name: string
					kind: 'text' | 'thread'
				}
				member?: {
					entityHash: string
					platformUserId?: string
					displayName?: string
				}
			}) => Promise<void>
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
		},
		/**
		 * Telegram 机器人接口（壳层 bridge 模式：BotSetup 注册 ops 与 outbound）。
		 */
		telegram?: {
			/** Telegraf 启动时注册 bridge ops 与 outbound handler。 */
			BotSetup?: (bot: Telegraf, config: any) => Promise<void>;
			/** 返回默认 bot JSON 配置模板。 */
			GetBotConfigTemplate?: () => Promise<any>;
			/**
			 * 自定义出站格式化；返回 true 表示 char 已自行 send，壳层跳过默认实现。
			 */
			FormatOutboundReply?: (reply: chatLogEntry_full_t, ctx: {
				platform: string
				send: (payload: any) => Promise<{ platformMessageId?: string | number }>
				chatId: string | number
				threadId?: string | number
			}) => Promise<boolean>
			/** 入站 DTO 写入 bridge 前可选就地修饰。 */
			TweakInboundDto?: (dto: any) => Promise<void>
			/** 出站文件名 → Telegram 原生贴纸 file_id。 */
			stickers?: Record<string, { fileId: string }>
		},
		/**
		 * Discord 机器人接口（壳层 bridge 模式：OnceClientReady 注册 ops 与 outbound）。
		 */
		discord?: {
			/** Discord Gateway Intents。 */
			Intents?: DiscordGatewayIntentBits[]
			/** Discord Partials。 */
			Partials?: DiscordPartials[]
			/** Client ready 后注册 bridge ops 与事件监听。 */
			OnceClientReady?: (client: DiscordClient, config: any) => Promise<void>
			/** 返回默认 bot JSON 配置模板。 */
			GetBotConfigTemplate?: () => Promise<any>
			/**
			 * 自定义出站格式化；返回 true 表示 char 已自行 send，壳层跳过默认实现。
			 */
			FormatOutboundReply?: (reply: chatLogEntry_full_t, ctx: {
				platform: string
				send: (payload: any) => Promise<{ platformMessageId?: string | number }>
				chatId: string | number
				threadId?: string | number
			}) => Promise<boolean>
			/** 入站 DTO 写入 bridge 前可选就地修饰。 */
			TweakInboundDto?: (dto: any) => Promise<void>
			/** 出站文件名 → Discord application emoji 名。 */
			stickers?: Record<string, { emojiName: string }>
		},
		/**
		 * 微信机器人（iLink Bot HTTP 长轮询，壳层 bridge 模式）。
		 */
		wechat?: {
			/**
			 * 长轮询主循环：ctx 含 getUpdates、sendMessage、uploadMedia、signal 等。
			 */
			OnceClientReady?: (ctx: {
				getUpdates: (params: { get_updates_buf?: string, timeoutMs?: number }) => Promise<any>
				sendMessage: (body: object) => Promise<void>
				getConfig: (params: { ilinkUserId: string, contextToken?: string }) => Promise<any>
				sendTyping: (body: object) => Promise<void>
				uploadMedia: (params: {
					mediaType: number
					toUserId: string
					fileBuffer: Uint8Array | ArrayBuffer
					cdnBaseUrl?: string
				}) => Promise<{
					mediaType: number
					media: { encrypt_query_param: string, aes_key: string }
					rawMd5: string
					rawSize: number
					ciphertextSize: number
				}>
				signal: AbortSignal
			}, config: any) => Promise<void>
			/** 返回默认 bot JSON 配置模板。 */
			GetBotConfigTemplate?: () => Promise<any>
			/**
			 * 自定义出站格式化；返回 true 表示 char 已自行 send，壳层跳过默认实现。
			 */
			FormatOutboundReply?: (reply: chatLogEntry_full_t, ctx: {
				platform: string
				send: (payload: any) => Promise<{ platformMessageId?: string | number }>
				chatId: string | number
				threadId?: string | number
			}) => Promise<boolean>
			/** 入站 DTO 写入 bridge 前可选就地修饰。 */
			TweakInboundDto?: (dto: any) => Promise<void>
		},
		/**
		 * 浏览器集成接口。
		 */
		browserIntegration?: {
			/**
			 * 浏览器 JavaScript 回调。
			 * @param {object} arg - 参数对象。
			 * @returns {Promise<void>}
			 */
			BrowserJsCallback: (arg: { data: any, pageId: number, script: string }) => Promise<void>;
		},
		/**
		 * Shell 助手接口。
		 */
		shellassist?: {
			/**
			 * 辅助函数。
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
		 * Social 动态接口（fount Social shell）。
		 * 账号即 P2P entityHash，与 Chat 联邦身份 / agent 实体同一套，无需单独注册。
		 * 跨节点调用走 Trystero `social_rpc`（如 `social_post_notify`），不经 `char_rpc` / remoteProxy。
		 * 未实现 OnMessage 时，被 @ 的 agent 默认经 chat.GetReply 生成公开回复。
		 */
		social?: SocialCharInterface,
		/**
		 * 桌面宠物接口。
		 */
		deskpet?: {
			/**
			 * 获取宠物配置。
			 * @returns {Promise<object>} - 宠物配置。
			 */
			GetPetConfig: () => Promise<{
				/**
				 * 在 webview 中加载的 URL。
				 */
				url: string;

				/**
				 * webview 窗口的选项。
				 */
				windowOptions?: {
					width?: number;
					height?: number;
					frameless?: boolean;
					transparent?: boolean;
					/**
					 * 窗口大小调整提示。
					 */
					hint?: 'none' | 'fixed' | 'min' | 'max';
				};
			}>;
		}
	}
}
