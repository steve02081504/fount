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
	Tokenizer: tokenizer_t<any>;
}
