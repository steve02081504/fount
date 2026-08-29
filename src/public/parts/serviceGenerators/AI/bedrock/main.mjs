import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { defaultConvertConfig } from '../proxy/src/convertConfig.mjs'
import { identityTokenizer } from '../proxy/src/identityTokenizer.mjs'
import { buildMessagesFromPromptStruct } from '../proxy/src/messageBuilder.mjs'
import { clearFormat } from '../proxy/src/responseFormat.mjs'

import { converseStreamDeltaText, messagesToConverse } from './src/converse.mjs'

const { info, product_info } = (await import('./locales.json', { with: { type: 'json' } })).default

/**
 * Bedrock 配置模板。
 */
const configTemplate = {
	name: 'Amazon Bedrock',
	model: 'anthropic.claude-sonnet-4-5-20250929-v1:0',
	region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || '',
	accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
	secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
	sessionToken: process.env.AWS_SESSION_TOKEN || '',
	profile: process.env.AWS_PROFILE || '',
	model_arguments: {},
	convert_config: defaultConvertConfig(),
	use_stream: true,
}

/**
 * Amazon Bedrock 生成器。
 */
export default {
	info,
	interfaces: {
		serviceGenerator: {
			/**
			 * 配置页：缺 region 时提示。
			 * @returns {Promise<{ js: string }>} 脚本。
			 */
			GetConfigDisplayContent: async () => ({
				js: fs.readFileSync(path.join(import.meta.dirname, 'display.mjs'), 'utf-8'),
			}),
			/**
			 * 默认配置。
			 * @returns {Promise<object>} 模板。
			 */
			GetConfigTemplate: async () => structuredClone(configTemplate),
			GetSource,
		},
	},
}

/**
 * 创建 Bedrock Runtime 客户端。
 * @param {object} config - 配置。
 * @returns {Promise<any>} 客户端。
 */
async function createBedrockClient(config) {
	const { BedrockRuntimeClient } = await import('npm:@aws-sdk/client-bedrock-runtime')
	const options = { region: config.region }
	if (config.accessKeyId)
		options.credentials = {
			accessKeyId: config.accessKeyId,
			secretAccessKey: config.secretAccessKey,
			sessionToken: config.sessionToken || undefined,
		}
	else if (config.profile) {
		const { fromIni } = await import('npm:@aws-sdk/credential-providers')
		options.credentials = fromIni({ profile: config.profile })
	}
	return new BedrockRuntimeClient(options)
}

/**
 * 创建 Bedrock AI 源。
 * @param {object} config - 配置。
 * @returns {Promise<import('../../../../../decl/AIsource.ts').AIsource_t>} AI 源。
 */
async function GetSource(config) {
	config.convert_config = { ...configTemplate.convert_config, ...config.convert_config }
	config.use_stream ??= true
	const client = await createBedrockClient(config)
	const { ConverseCommand, ConverseStreamCommand } = await import('npm:@aws-sdk/client-bedrock-runtime')

	/**
	 * 调用 Converse / ConverseStream。
	 * @param {Array<object>} messages - 消息。
	 * @param {object} [options] - 选项。
	 * @returns {Promise<object>} 回复。
	 */
	async function run(messages, options = {}) {
		const { system, messages: converseMessages } = messagesToConverse(messages)
		const input = {
			modelId: config.model,
			messages: converseMessages,
			...system.length ? { system } : {},
			...config.model_arguments ? { inferenceConfig: config.model_arguments } : {},
		}
		const result = options.result ?? { content: '', files: [] }
		if (config.use_stream) {
			const response = await client.send(new ConverseStreamCommand(input), { abortSignal: options.signal })
			for await (const event of response.stream) {
				if (options.signal?.aborted) {
					const err = new Error('Aborted by user')
					err.name = 'AbortError'
					throw err
				}
				const delta = converseStreamDeltaText(event)
				if (delta) {
					result.content += delta
					options.previewUpdater?.(result)
				}
			}
			return result
		}
		const response = await client.send(new ConverseCommand(input), { abortSignal: options.signal })
		result.content = (response.output?.message?.content ?? []).map(part => part.text ?? '').join('')
		options.previewUpdater?.(result)
		return result
	}

	return {
		type: 'text-chat',
		info: Object.fromEntries(Object.entries(structuredClone(product_info)).map(([locale, localeInfo]) => {
			localeInfo.name = config.name || config.model
			return [locale, localeInfo]
		})),
		is_paid: true,
		extension: {},
		/**
		 * 纯文本调用。
		 * @param {string} prompt - 提示。
		 * @returns {Promise<{content: string, files: any[]}>} 回复。
		 */
		Call: async prompt => run([{ role: 'user', content: prompt }]),
		/**
		 * 结构化调用。
		 * @param {import('../../../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct - 结构化提示。
		 * @param {import('../../../../../decl/AIsource.ts').GenerationOptions} [options] - 生成选项。
		 * @returns {Promise<{content: string, files: any[]}>} 回复。
		 */
		StructCall: async (prompt_struct, options = {}) => {
			const { base_result = {}, replyPreviewUpdater, signal } = options
			const messages = await buildMessagesFromPromptStruct(prompt_struct, config, configTemplate)
			const result = {
				content: '',
				files: [...base_result?.files || []],
				extension: { ...base_result?.extension },
			}
			await run(messages, {
				signal,
				result,
				/**
				 * 流式预览。
				 * @param {object} partialResult - 片段。
				 * @returns {void}
				 */
				previewUpdater: partialResult => replyPreviewUpdater?.(clearFormat({ ...partialResult }, prompt_struct)),
			})
			return Object.assign(base_result, clearFormat(result, prompt_struct))
		},
		tokenizer: identityTokenizer,
	}
}
