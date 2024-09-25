import { timeStamp_t } from "./basedefs";

class tokenizer_t<T> {
	free: () => void;
	encode: (prompt: string) => T[];
	decode: (tokens: T[]) => string;
	decode_single: (token: T) => string;
	get_token_count: (prompt: string) => number;
	get_token_count_of_tree: (obj: any) => number;
}

export class AIsource_t {
	avatar: string;
	sourceName: string;
	is_paid: boolean;
	extension: {};

	Init: () => {
		success: boolean;
		message: string;
	};
	Load: () => {
		success: boolean;
		message: string;
	};
	Unload: () => void;
	Uninstall: () => void;
	Call: (prompt: string) => string;
	StructCall: (prompt_struct: {
		user_prompt: {
			text: {
				common: string;
				important: string;
			};
			extension: {};
		}
		char_prompt: {
			text: {
				common: string;
				important: string;
			};
			extension: {};
		}
		world_prompt: {
			text: {
				common: string;
				important: string;
			};
			extension: {};
		}
		chat_log: {
			charName: string;
			timeStamp: timeStamp_t;
			role: string;
			content: string;
			extension: {};
		}[];
	}) => string;
	Tokenizer: tokenizer_t<any>;
}
