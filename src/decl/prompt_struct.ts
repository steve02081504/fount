import { Buffer } from "node:buffer";
import { role_t, timeStamp_t } from "./basedefs";

export class single_part_prompt_t {
	text: {
		content: string;
		description: string;
		important: number;
	}[];
	additional_chat_log: chatLogEntry_t[];
	extension: {};
}
export class other_chars_prompt_t extends single_part_prompt_t {
	name: string;
	isActive: boolean;
	LastActive: timeStamp_t;
}
export type chatLogEntry_t = {
	name: string;
	timeStamp: timeStamp_t;
	role: role_t;
	content: string;
	files: {
		name: string;
		mimeType: string;
		buffer: Buffer;
		description: string;
	}[];
	extension: {};
}
export type prompt_struct_t = {
	char_id: string
	Charname: string
	alternative_charnames: (string|RegExp)[]
	UserCharname: string
	user_prompt: single_part_prompt_t
	char_prompt: single_part_prompt_t
	other_chars_prompt: Record<string, other_chars_prompt_t>
	world_prompt: single_part_prompt_t
	plugin_prompts: Record<string, single_part_prompt_t>
	chat_log: chatLogEntry_t[];
}
