import { Buffer } from 'node:buffer'

import { role_t, timeStamp_t } from './basedefs.ts'

/**
 * @class single_part_prompt_t
 * @description 定义了单部分提示的结构。
 */
export class single_part_prompt_t {
	/**
	 * @description 文本内容数组。
	 */
	text: {
		/**
		 * @description 文本内容。
		 */
		content: string;
		/**
		 * @description 描述。
		 */
		description: string;
		/**
		 * @description 重要性。
		 */
		important: number;
	}[]
	/**
	 * @description 附加的聊天记录条目数组。
	 */
	additional_chat_log: chatLogEntry_t[]
	/**
	 * @description 扩展对象。
	 */
	extension: object
}
/**
 * @class other_chars_prompt_t
 * @extends single_part_prompt_t
 * @description 定义了其他角色提示的结构。
 */
export class other_chars_prompt_t extends single_part_prompt_t {
	/**
	 * @description 名称。
	 */
	name: string
	/**
	 * @description 是否活动。
	 */
	is_active: boolean
	/**
	 * @description 上次活动的时间戳。
	 */
	last_active: timeStamp_t
}
/**
 * @interface chatLogEntry_t
 * @description 定义了聊天记录条目的结构。
 */
export interface chatLogEntry_t {
	/**
	 * @description 名称。
	 */
	name: string
	/**
	 * @description 时间戳。
	 */
	time_stamp: timeStamp_t
	/**
	 * @description 角色。
	 */
	role: role_t
	/**
	 * @description 内容。
	 */
	content: string
	/**
	 * @description 文件数组。
	 */
	files: {
		/**
		 * @description 文件名。
		 */
		name: string
		/**
		 * @description MIME 类型。
		 */
		mime_type: string
		/**
		 * @description 文件内容。
		 */
		buffer: Buffer
		/**
		 * @description 描述。
		 */
		description: string
		/**
		 * @description 扩展对象。
		 */
		extension?: object
	}[]
	/**
	 * @description 扩展对象。
	 */
	extension: object
}
/**
 * @interface prompt_struct_t
 * @description 定义了提示结构的结构。
 */
export interface prompt_struct_t {
	/**
	 * @description 角色 ID。
	 */
	char_id: string
	/**
	 * @description 角色名称。
	 */
	Charname: string
	/**
	 * @description 备用角色名称。
	 */
	alternative_charnames: (string | RegExp)[]
	/**
	 * @description 用户角色名称。
	 */
	UserCharname: string
	/**
	 * @description 用户提示。
	 */
	user_prompt: single_part_prompt_t
	/**
	 * @description 角色提示。
	 */
	char_prompt: single_part_prompt_t
	/**
	 * @description 其他角色提示。
	 */
	other_chars_prompt: Record<string, other_chars_prompt_t>
	/**
	 * @description 世界提示。
	 */
	world_prompt: single_part_prompt_t
	/**
	 * @description 插件提示。
	 */
	plugin_prompts: Record<string, single_part_prompt_t>
	/**
	 * @description 聊天记录。
	 */
	chat_log: chatLogEntry_t[]
	/**
	 * @description 扩展对象。
	 */
	extension?: object
}
