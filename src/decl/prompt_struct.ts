import { timeStamp_t } from "./basedefs";

export type single_part_prompt_t = {
	text: {
		content: string;
		description: string;
		important: number;
	}[];
	extension: {};
}
export type prompt_struct_t = {
	user_prompt: single_part_prompt_t
	char_prompt: single_part_prompt_t
	other_chars_prompt: {
		text: {
			content: string;
			description: string;
			important: number;
		}[];
		charname: string;
		isActive: boolean;
		LastActive: timeStamp_t;
		extension: {};
	}[]
	world_prompt: single_part_prompt_t
	chat_log: {
		charName: string;
		timeStamp: timeStamp_t;
		role: string;
		content: string;
		extension: {};
	}[];
}
