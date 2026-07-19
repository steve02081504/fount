import { Buffer } from 'node:buffer'

import { role_t, timeStamp_t } from './basedefs.ts'
import { ReplyPreviewUpdater_t } from './chatLog.ts'


/**
 * 单部分提示
 * @class single_part_prompt_t
 * 定义了单部分提示的结构。
 */
export class single_part_prompt_t {
	/**
	 * 文本内容数组。
	 */
	text: {
		/**
		 * 文本内容。
		 */
		content: string;
		/**
		 * 描述。
		 */
		description: string;
		/**
		 * 重要性。
		 */
		important: number;
	}[]
	/**
	 * 附加的聊天记录条目数组。
	 */
	additional_chat_log: chatLogEntry_t[]
	/**
	 * 扩展对象。
	 */
	extension: object
}
/**
 * 其他角色提示
 * @class other_chars_prompts_t
 * @augments single_part_prompt_t
 * 定义了其他角色提示的结构。
 */
export class other_chars_prompts_t extends single_part_prompt_t {
	/**
	 * 名称。
	 */
	name: string
	/**
	 * 是否活动。
	 */
	is_active: boolean
	/**
	 * 上次活动的时间戳。
	 */
	last_active: timeStamp_t
}
/**
 * 聊天记录条目
 * @interface chatLogEntry_t
 * 定义了聊天记录条目的结构。
 */
export interface chatLogEntry_t {
	/**
	 * 名称。
	 */
	name: string
	/**
	 * 说话人身份（宿主自定义；与消息 id 无关）。
	 */
	uid: string
	/**
	 * 时间戳。
	 */
	time_stamp: timeStamp_t
	/**
	 * 角色。
	 */
	role: role_t
	/**
	 * 内容。
	 */
	content: string
	/**
	 * 文件数组。
	 */
	files: {
		/**
		 * 文件名。
		 */
		name: string
		/**
		 * MIME 类型。
		 */
		mime_type: string
		/**
		 * 文件内容。
		 */
		buffer: Buffer
		/**
		 * 描述。
		 */
		description: string
		/**
		 * 扩展对象。
		 */
		extension?: object
	}[]
	/**
	 * 扩展对象。
	 */
	extension: object
}
/**
 * 提示结构
 * @interface prompt_struct_t
 * 定义了提示结构的结构。
 */
export interface prompt_struct_t {
	/**
	 * 角色 ID。
	 */
	char_id: string
	/**
	 * 角色名称。
	 */
	Charname: string
	/**
	 * 备用角色名称。
	 */
	alternative_charnames: (string | RegExp)[]
	/**
	 * 用户角色名称。
	 */
	UserCharname: string
	/**
	 * 回复对象显示名。
	 */
	ReplyToCharname?: string
	/**
	 * 本机用户说话人身份。
	 */
	UserUid: string
	/**
	 * 当前角色说话人身份。
	 */
	CharUid: string
	/**
	 * 回复对象说话人身份。
	 */
	ReplyToUid?: string
	/**
	 * 用户提示。
	 */
	user_prompt: single_part_prompt_t
	/**
	 * 角色提示。
	 */
	char_prompt: single_part_prompt_t
	/**
	 * 其他角色提示。
	 */
	other_chars_prompts: Record<string, other_chars_prompts_t>
	/**
	 * 其他人格提示（群聊他者贡献；不含本机 user_prompt 槽）。
	 */
	other_personas_prompts: Record<string, other_chars_prompts_t>
	/**
	 * 世界提示。
	 */
	world_prompt: single_part_prompt_t
	/**
	 * 插件提示。
	 */
	plugin_prompts: Record<string, single_part_prompt_t>
	/**
	 * 聊天记录。
	 */
	chat_log: chatLogEntry_t[]
	/**
	 * 当前消息的平行时间线条目。
	 */
	timelines: chatLogEntry_t[]
	/**
	 * 用户首选语言列表，用于服务端渲染时的文案本地化。
	 */
	locales?: string[]
	/**
	 * 扩展对象。
	 */
	extension?: object
	/**
	 * 回复预览更新器。
	 */
	ReplyPreviewUpdater?: ReplyPreviewUpdater_t
}
