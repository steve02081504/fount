import { Buffer } from 'node:buffer'

import { role_t, timeStamp_t } from './basedefs.ts'

/**
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
 * @class other_chars_prompt_t
 * @extends single_part_prompt_t
 * 定义了其他角色提示的结构。
 */
export class other_chars_prompt_t extends single_part_prompt_t {
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
 * @interface chatLogEntry_t
 * 定义了聊天记录条目的结构。
 */
export interface chatLogEntry_t {
	/**
	 * 名称。
	 */
	name: string
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
	other_chars_prompt: Record<string, other_chars_prompt_t>
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
	 * 扩展对象。
	 */
	extension?: object
}
