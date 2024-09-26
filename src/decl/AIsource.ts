import { timeStamp_t } from "./basedefs";
import { prompt_struct_t } from "./prompt_struct";

class tokenizer_t<T> {
	free: () => void;
	encode: (prompt: string) => T[];
	decode: (tokens: T[]) => string;
	decode_single: (token: T) => string;
	get_token_count: (prompt: string) => number;
	get_token_count_of_struct: (obj: any) => number;
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
	StructCall: (prompt_struct: prompt_struct_t) => string;
	Tokenizer: tokenizer_t<any>;
}
