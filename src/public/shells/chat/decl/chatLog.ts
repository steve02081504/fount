import { Buffer } from 'node:buffer'

import { locale_t, role_t, timeStamp_t } from '../../../../decl/basedefs.ts'
import { CharAPI_t } from '../../../../decl/charAPI.ts'
import { PluginAPI_t } from '../../../../decl/pluginAPI.ts'
import { UserAPI_t } from '../../../../decl/userAPI.ts'
import { WorldAPI_t } from '../../../../decl/worldAPI.ts'

/**
 * @class chatReply_t
 * 聊天回复的数据结构。
 * @property {string} [name] - 回复者的名称。
 * @property {string} [avatar] - 回复者的头像 URL。
 * @property {string} content - 回复的内容。
 * @property {string} [content_for_show] - 用于显示的内容。
 * @property {string} [content_for_edit] - 用于编辑的内容。
 * @property {object[]} [files] - 附加文件。
 * @property {string} files[].name - 文件名。
 * @property {string} files[].mime_type - 文件的 MIME 类型。
 * @property {Buffer} files[].buffer - 文件的内容。
 * @property {string} files[].description - 文件的描述。
 * @property {chatLogEntry_t[]} [logContextBefore] - 在此回复之前的日志上下文。
 * @property {chatLogEntry_t[]} [logContextAfter] - 在此回复之后的日志上下文。
 * @property {string[]} [charVisibility] - 可见角色的 char_id 列表。
 * @property {any} [extension] - 扩展数据。
 */
export class chatReply_t {
	name?: string
	avatar?: string
	content: string
	content_for_show?: string
	content_for_edit?: string
	files?: {
		name: string;
		mime_type: string;
		buffer: Buffer;
		description: string;
	}[]
	logContextBefore?: chatLogEntry_t[]
	logContextAfter?: chatLogEntry_t[]
	charVisibility?: string[]
	extension?: any
}

/**
 * @class chatReplyRequest_t
 * 聊天回复请求的数据结构。
 * @property {object} supported_functions - 当前 shell 支持的功能。
 * @property {boolean} supported_functions.markdown - 是否支持 Markdown。
 * @property {boolean} supported_functions.mathjax - 是否支持 MathJax。
 * @property {boolean} supported_functions.html - 是否支持 HTML。
 * @property {boolean} supported_functions.unsafe_html - 是否支持不安全的 HTML。
 * @property {boolean} supported_functions.files - 是否支持文件。
 * @property {boolean} supported_functions.add_message - 是否支持添加消息。
 * @property {string} chat_name - 聊天名称。
 * @property {string} char_id - 角色 ID。
 * @property {string} username - 用户名。
 * @property {string} Charname - 角色名称。
 * @property {string} UserCharname - 用户角色名称。
 * @property {string} [ReplyToCharname] - 回复的角色名称。
 * @property {locale_t[]} locales - 区域设置。
 * @property {timeStamp_t} time - 时间戳。
 * @property {chatLogEntry_t[]} chat_log - 聊天日志。
 * @property {function(chatReply_t): Promise<chatLogEntry_t>} [AddChatLogEntry] - 添加聊天日志条目。
 * @property {function(): Promise<chatReplyRequest_t>} [Update] - 更新。
 * @property {WorldAPI_t} world - 世界 API。
 * @property {UserAPI_t} user - 用户 API。
 * @property {CharAPI_t} char - 角色 API。
 * @property {Record<string, CharAPI_t>} other_chars - 其他角色 API。
 * @property {Record<string, PluginAPI_t>} plugins - 插件 API。
 * @property {string} chat_summary - 聊天摘要。
 * @property {object} chat_scoped_char_memory - 聊天范围的角色内存。
 * @property {object} extension - 扩展数据。
 */
export class chatReplyRequest_t {
	// 一个传递当前shell所支持功能的结构
	supported_functions: {
		markdown: boolean;
		mathjax: boolean;
		html: boolean;
		unsafe_html: boolean;
		files: boolean;
		add_message: boolean;
	}
	chat_name: string
	char_id: string
	username: string
	Charname: string
	UserCharname: string
	ReplyToCharname?: string
	locales: locale_t[] // 常见用法：switch (args.locales[0].split('-')[0]) 来多语言info或开场白
	time: timeStamp_t
	chat_log: chatLogEntry_t[]
	AddChatLogEntry?: (entry: chatReply_t) => Promise<chatLogEntry_t> // 调用这个来主动或定时发信息
	Update?: () => Promise<chatReplyRequest_t> // 调用这个来在定时任务时获取最新args
	world: WorldAPI_t
	user: UserAPI_t
	char: CharAPI_t
	other_chars: Record<string, CharAPI_t>
	plugins: Record<string, PluginAPI_t>
	chat_summary: string
	chat_scoped_char_memory: object
	extension: object
}

/**
 * @class chatLogEntry_t
 * 聊天日志条目的数据结构。
 * @property {string} name - 名称。
 * @property {string} avatar - 头像 URL。
 * @property {timeStamp_t} time_stamp - 时间戳。
 * @property {role_t} role - 角色。
 * @property {string} content - 内容。
 * @property {string} [content_for_show] - 用于显示的内容。
 * @property {string} [content_for_edit] - 用于编辑的内容。
 * @property {object[]} files - 文件。
 * @property {string} files[].name - 文件名。
 * @property {string} files[].mime_type - 文件的 MIME 类型。
 * @property {Buffer} files[].buffer - 文件的内容。
 * @property {string} files[].description - 文件的描述。
 * @property {object} [files[].extension] - 文件的扩展数据。
 * @property {chatLogEntry_t[]} logContextBefore - 在此条目之前的日志上下文。
 * @property {chatLogEntry_t[]} logContextAfter - 在此条目之后的日志上下文。
 * @property {string[]} [charVisibility] - 可见角色的 char_id 列表。
 * @property {object} extension - 扩展数据。
 * @property {object} extension.timeSlice - 时间片。
 * @property {Map<string, CharAPI_t>} extension.timeSlice.chars - 角色。
 * @property {string} extension.timeSlice.summary - 摘要。
 * @property {WorldAPI_t} extension.timeSlice.world - 世界。
 * @property {UserAPI_t} extension.timeSlice.player - 玩家。
 */
export class chatLogEntry_t {
	name: string
	avatar: string
	time_stamp: timeStamp_t
	role: role_t
	content: string
	content_for_show?: string
	content_for_edit?: string
	files: {
		name: string;
		mime_type: string;
		buffer: Buffer;
		description: string;
		extension?: object;
	}[]
	logContextBefore: chatLogEntry_t[] // 内容会被展开到此信息前
	logContextAfter: chatLogEntry_t[] // 展开到其后
	charVisibility?: string[] // 可见的角色的char_id列表，若无则全可见
	extension: {
		timeSlice: {
			chars: Map<string, CharAPI_t>;
			summary: string;
			world: WorldAPI_t;
			player: UserAPI_t;
		}
	}
}
/**
 * @type {chatLogEntry_t[]}
 * 聊天日志。
 */
export type chatLog_t = chatLogEntry_t[];
