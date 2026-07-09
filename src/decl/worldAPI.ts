import { channelMessageContent_t, chatReply_t, chatReplyRequest_t, type chatViewer_t } from '../public/parts/shells/chat/decl/chatLog.ts'

import { locale_t, info_t } from './basedefs.ts'
import type { GroupPrompt_t, MemberTurn_t, SpeakingOrderContext_t } from './memberProfile.ts'
import { chatLogEntry_t, prompt_struct_t, single_part_prompt_t } from './prompt_struct.ts'

/** world_op 事件 content 形状（DAG 权威共享状态）。 */
export type worldOpEvent_t = {
	eventId: string
	hlc: { wall: number, logical: number }
	sender: string
	channelId?: string
	content: {
		worldname: string
		op: 'set' | 'del'
		key: string
		value?: unknown
	}
}

/**
 *
 */
export type memberSummary_t = {
	memberKey: string
	memberKind?: string
	charname?: string
	ownerUsername?: string
	homeNodeHash?: string
	roles?: string[]
}

/**
 *
 */
export type channelSummary_t = {
	channelId: string
	name?: string
	type?: string
}

/** world 对 chat 存储 / p2p 层的正式调用面。 */
export type WorldChatHost_t = {
	groupId: string
	replicaUsername: string
	worldname: string
	state: {
		get(key: string): Promise<unknown>
		entries(): Promise<Record<string, unknown>>
		set(key: string, value: unknown): Promise<void>
		del(key: string): Promise<void>
		log(sinceEventId?: string): Promise<worldOpEvent_t[]>
	}
	localData: {
		get(key: string): Promise<unknown>
		set(key: string, value: unknown): Promise<void>
	}
	triggerCharReply(channelId: string, charname: string): Promise<void>
	postSystemMessage(channelId: string, content: channelMessageContent_t): Promise<void>
	listMembers(): Promise<memberSummary_t[]>
	listChannels(): Promise<channelSummary_t[]>
}

/**
 * 世界API接口
 * @class WorldAPI_t
 * 定义了世界 API 的结构。
 */
export class WorldAPI_t {
	/**
	 * 世界 API 的详细信息。
	 */
	info: info_t
	/**
	 * 分布形态；缺省 'hosted'（兼容现状）。由 world part 自行声明。
	 */
	distribution?: 'local' | 'replicated' | 'hosted'
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
			 * 多人场景：返回公用 prompt + 按 memberId 的专属 prompt（可选；与 GetPrompt 并存时由 shell 合并）。
			 * @param {chatReplyRequest_t} arg - 聊天回复请求。
			 * @returns {Promise<GroupPrompt_t | null>} - 无则 null
			 */
			GetGroupPrompt?: (arg: chatReplyRequest_t) => Promise<GroupPrompt_t | null>
			/**
			 * 可选：由世界决定发言顺序（yield char 则触发该成员回复；yield user 则提示用户回合）。
			 * @param {SpeakingOrderContext_t & { chatReplyRequest?: chatReplyRequest_t }} ctx - 群/频道与可选完整请求
			 * @returns {AsyncIterable<MemberTurn_t>} - 异步迭代器
			 */
			GetSpeakingOrder?: (ctx: SpeakingOrderContext_t & { chatReplyRequest?: chatReplyRequest_t }) => AsyncIterable<MemberTurn_t>
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
			 * 按观察者返回世界视图下的聊天记录（正式主接口）。
			 * @param {chatReplyRequest_t} arg - 聊天回复请求。
			 * @param {chatViewer_t} viewer - 统一观察者身份。
			 * @returns {Promise<chatLogEntry_t[]>} - 聊天记录条目数组。
			 */
			GetChatLogForViewer?: (arg: chatReplyRequest_t, viewer: chatViewer_t) => Promise<chatLogEntry_t[]>
			/**
			 * Legacy sugar：仅按本地 charname 改写 chat_log。新 world 应实现 GetChatLogForViewer。
			 * @param {chatReplyRequest_t} arg - 聊天回复请求。
			 * @param {string} charname - 角色名称。
			 * @returns {Promise<chatLogEntry_t[]>} - 聊天记录条目数组。
			 */
			GetChatLogForCharname?: (arg: chatReplyRequest_t, charname: string) => Promise<chatLogEntry_t[]>
			/**
			 * 消息落 DAG 前：可改写 entry 内容，或抛错/返回含 reject 语义拒绝（与 BeforeUserSend 对称的 world 侧）。
			 * @param {chatReplyRequest_t} arg - 聊天回复请求。
			 * @param {chatLogEntry_t} entry - 拟落盘的聊天记录条目（可就地/返回改写）。
			 * @returns {Promise<chatLogEntry_t | void>} - 改写后的条目；void 表示使用入参 entry。
			 */
			AddChatLogEntry?: (arg: chatReplyRequest_t, entry: chatLogEntry_t) => Promise<chatLogEntry_t | void>
			/**
			 * 消息落 DAG 并 persist 之后调用（唯一触发点在 broadcastAndPersist）。
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
			 * 频道消息编辑前：可改写 edited 或 reject（DAG 写路径唯一语义）。
			 */
			MessageEdit?: (ctx: {
				groupId: string
				channelId: string
				username: string
				eventId: string
				original: object
				edited: channelMessageContent_t
				memberId?: string
			}) => Promise<{
				edited?: channelMessageContent_t
				reject?: string
			} | channelMessageContent_t | undefined>
			/**
			 * 频道消息删除前：reject 拒绝删除。
			 */
			MessageDelete?: (ctx: {
				groupId: string
				channelId: string
				username: string
				eventId: string
				original: object
				memberId?: string
			}) => Promise<{ reject?: string } | undefined>
			/**
			 * 绑定/加载时调用一次；world 自行持有 host 引用（计时器、任意钩子内可用）。
			 * @param {WorldChatHost_t} host chat 存储与 p2p 正式调用面
			 * @returns {Promise<void>}
			 */
			ChatHostConnected?: (host: WorldChatHost_t) => Promise<void>
		}
	}
}
