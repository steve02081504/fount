import { locale_t } from "./basedefs";
import { prompt_struct_t } from "./prompt_struct";

class tokenizer_t<InputType, TokenType> {
	free: () => void;
	encode: (prompt: InputType) => TokenType[];
	decode: (tokens: TokenType[]) => InputType;
	decode_single: (token: TokenType) => InputType;
	get_token_count: (prompt: InputType) => number;
}

export class AIsource_t<InputType, OutputType> {
	info: Record<locale_t, {
		avatar: string;
		name: string;
		description: string;
		description_markdown: string;
		version: string;
		author: string;
		homepage: string;
		issuepage: string;
		tags: string[];
	}>;
	is_paid: boolean;
	extension: {};

	Unload: () => void;
	Call: (prompt: InputType) => OutputType;
	Tokenizer: tokenizer_t<InputType, any>;
}
export class textAISource_t extends AIsource_t<string, string> {
	StructCall: (prompt_struct: prompt_struct_t) => string;
}
