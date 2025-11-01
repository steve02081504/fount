import { Buffer } from 'node:buffer'

import { info_t, locale_t } from './basedefs.ts'
import { prompt_struct_t } from './prompt_struct.ts'

/**
 * @class Tokenizer_t
 * @template InputType, TokenType
 * 定义了一个通用的分词器接口，用于处理输入数据的编码和解码。
 */
class Tokenizer_t<InputType, TokenType> {
	/**
	 * 释放分词器占用的资源。
	 * @returns {Promise<void>}
	 */
	free: () => Promise<void>
	/**
	 * 将输入数据编码为 token 序列。
	 * @param {InputType} prompt - 需要编码的输入数据。
	 * @returns {TokenType[]} - 编码后的 token 序列。
	 */
	encode: (prompt: InputType) => TokenType[]
	/**
	 * 将 token 序列解码为原始输入数据。
	 * @param {TokenType[]} tokens - 需要解码的 token 序列。
	 * @returns {InputType} - 解码后的原始输入数据。
	 */
	decode: (tokens: TokenType[]) => InputType
	/**
	 * 解码单个 token。
	 * @param {TokenType} token - 需要解码的单个 token。
	 * @returns {InputType} - 解码后的原始输入数据。
	 */
	decode_single: (token: TokenType) => InputType
	/**
	 * 获取输入数据编码后的 token 数量。
	 * @param {InputType} prompt - 输入数据。
	 * @returns {number} - token 数量。
	 */
	get_token_count: (prompt: InputType) => number
}

/**
 * @class AIsource_t
 * @template InputType, OutputType
 * 定义了 AI 数据源的基本结构，用于与不同类型的 AI 模型进行交互。
 */
export class AIsource_t<InputType, OutputType> {
	/**
	 * AI 数据源的文件名。
	 */
	filename: string
	/**
	 * AI 数据源的类型，例如 'text-chat'。
	 */
	type: 'text-chat' | string
	/**
	 * AI 数据源的详细信息。
	 */
	info: info_t
	/**
	 * 指示该 AI 数据源是否为付费服务。
	 */
	is_paid: boolean
	/**
	 * 用于存储扩展功能的对象。
	 */
	extension: object

	/**
	 * 卸载 AI 数据源并释放资源。
	 * @returns {Promise<void>}
	 */
	Unload?: () => Promise<void>
	/**
	 * 调用 AI 数据源进行处理。
	 * @param {InputType} prompt - 输入数据。
	 * @returns {OutputType} - 处理后的输出数据。
	 */
	Call: (prompt: InputType) => OutputType
	/**
	 * AI 数据源支持的接口。
	 */
	interfaces: {
		/**
		 * 信息接口，用于更新 AI 数据源的信息。
		 */
		info?: {
			/**
			 * 更新 AI 数据源的本地化信息。
			 * @param {locale_t[]} locales - 本地化信息数组。
			 * @returns {Promise<info_t>} - 更新后的 AI 数据源信息。
			 */
			UpdateInfo: (locales: locale_t[]) => Promise<info_t>,
		},
	}
	/**
	 * 与 AI 数据源关联的分词器。
	 */
	tokenizer: Tokenizer_t<InputType, any>
}

/**
 * @class textAISource_t
 * @augments AIsource_t<string, Promise<string>>
 * 专用于处理文本输入的 AI 数据源。
 */
export class textAISource_t extends AIsource_t<string, Promise<string>> {
	/**
	 * 使用结构化的 prompt 调用 AI 数据源。
	 * @param {prompt_struct_t} prompt_struct - 结构化的 prompt。
	 * @returns {Promise<{content: string, files: {name: string, mime_type: string, buffer: Buffer, description: string}[]}>} - 包含内容和文件的响应。
	 */
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
