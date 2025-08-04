import { Buffer } from 'node:buffer'

import { role_t, timeStamp_t } from './basedefs.ts'

export class single_part_prompt_t {
	text: {
		content: string;
		description: string;
		important: number;
	}[]
	additional_chat_log: chatLogEntry_t[]
	extension: object
}
export class other_chars_prompt_t extends single_part_prompt_t {
	name: string
	is_active: boolean
	last_active: timeStamp_t
}
export interface chatLogEntry_t {
	name: string
	time_stamp: timeStamp_t
	role: role_t
	content: string
	files: {
		name: string
		mime_type: string
		buffer: Buffer
		description: string
		extension?: object
	}[]
	extension: object
}
export interface prompt_struct_t {
	char_id: string
	Charname: string
	alternative_charnames: (string | RegExp)[]
	UserCharname: string
	user_prompt: single_part_prompt_t
	char_prompt: single_part_prompt_t
	other_chars_prompt: Record<string, other_chars_prompt_t>
	world_prompt: single_part_prompt_t
	plugin_prompts: Record<string, single_part_prompt_t>
	chat_log: chatLogEntry_t[]
	extension?: object
}
