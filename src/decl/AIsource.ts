import { Buffer } from 'node:buffer'
import { info_t, locale_t } from './basedefs'
import { prompt_struct_t } from './prompt_struct.ts'

class Tokenizer_t<InputType, TokenType> {
	free: () => Promise<void>
	encode: (prompt: InputType) => TokenType[]
	decode: (tokens: TokenType[]) => InputType
	decode_single: (token: TokenType) => InputType
	get_token_count: (prompt: InputType) => number
}

export class AIsource_t<InputType, OutputType> {
	filename: string
	type: 'text-chat' | string
	info: info_t
	is_paid: boolean
	extension: object

	Unload: () => Promise<void>
	Call: (prompt: InputType) => OutputType
	interfaces: {
		info?: {
			UpdateInfo: (locales: locale_t[]) => Promise<info_t>,
		},
	}
	tokenizer: Tokenizer_t<InputType, any>
}
export class textAISource_t extends AIsource_t<string, Promise<string>> {
	StructCall: (prompt_struct: prompt_struct_t) => Promise<{
		content: string,
		files: {
			name: string
			mime_type: string
			buffer: Buffer,
			description: string
		}[],
	}>
}
