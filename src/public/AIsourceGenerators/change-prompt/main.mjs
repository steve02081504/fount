/** @typedef {import('../../../decl/AIsource.ts').AIsource_t} AIsource_t */
/** @typedef {import('../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t */

import { formatStr } from '../../../scripts/format.mjs'
import { parseRegexFromString } from '../../../scripts/regex.mjs'
import { loadAIsourceFromNameOrConfigData } from '../../../server/managers/AIsource_manager.mjs'

/**
 * 获取单一部分的提示对象。
 * @returns {{text: any[], additional_chat_log: any[], extension: {}}} 单一部分的提示对象。
 */
function getSinglePartPrompt() {
	return {
		text: [],
		additional_chat_log: [],
		extension: {},
	}
}

/**
 * @type {import('../../../decl/AIsource.ts').AIsource_interfaces_and_AIsource_t_getter}
 */
export default {
	info: {
		'en-UK': {
			name: 'Change Prompt',
			avatar: 'https://api.iconify.design/fluent/text-change-case-24-filled.svg',
			description: 'Change Prompt',
			description_markdown: 'A source that allows you to modify the prompt before sending it to another source.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['prompt', 'modifier', 'utility'],
			home_page: ''
		},
		'zh-CN': {
			name: '更改提示',
			avatar: 'https://api.iconify.design/fluent/text-change-case-24-filled.svg',
			description: '更改提示',
			description_markdown: '一个允许您在将提示发送到另一个源之前修改提示的源。',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['提示', '修改器', '实用工具'],
			home_page: ''
		},
		'ar-SA': {
			name: 'تغيير المطالبة',
			avatar: 'https://api.iconify.design/fluent/text-change-case-24-filled.svg',
			description: 'تغيير المطالبة',
			description_markdown: 'مصدر يسمح لك بتعديل المطالبة قبل إرسالها إلى مصدر آخر.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['موجه', 'معدل', 'أداة'],
			home_page: ''
		},
		'de-DE': {
			name: 'Eingabeaufforderung ändern',
			avatar: 'https://api.iconify.design/fluent/text-change-case-24-filled.svg',
			description: 'Eingabeaufforderung ändern',
			description_markdown: 'Eine Quelle, mit der Sie die Eingabeaufforderung ändern können, bevor Sie sie an eine andere Quelle senden.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['Eingabeaufforderung', 'Modifikator', 'Dienstprogramm'],
			home_page: ''
		},
		emoji: {
			name: '🔄📝',
			avatar: 'https://api.iconify.design/fluent/text-change-case-24-filled.svg',
			description: 'Change Prompt',
			description_markdown: 'A source that allows you to modify the prompt before sending it to another source.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['prompt', 'modifier', 'utility'],
			home_page: ''
		},
		'es-ES': {
			name: 'Cambiar aviso',
			avatar: 'https://api.iconify.design/fluent/text-change-case-24-filled.svg',
			description: 'Cambiar aviso',
			description_markdown: 'Una fuente que le permite modificar el aviso antes de enviarlo a otra fuente.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['aviso', 'modificador', 'utilidad'],
			home_page: ''
		},
		'fr-FR': {
			name: 'Changer l\'invite',
			avatar: 'https://api.iconify.design/fluent/text-change-case-24-filled.svg',
			description: 'Changer l\'invite',
			description_markdown: 'Une source qui vous permet de modifier l\'invite avant de l\'envoyer à une autre source.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['invite', 'modificateur', 'utilitaire'],
			home_page: ''
		},
		'hi-IN': {
			name: 'प्रॉम्प्ट बदलें',
			avatar: 'https://api.iconify.design/fluent/text-change-case-24-filled.svg',
			description: 'प्रॉम्प्ट बदलें',
			description_markdown: 'एक स्रोत जो आपको दूसरे स्रोत पर भेजने से पहले प्रॉम्प्ट को संशोधित करने की अनुमति देता है।',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['प्रॉम्प्ट', 'संशोधक', 'उपयोगिता'],
			home_page: ''
		},
		'is-IS': {
			name: 'Breyta hvetningu',
			avatar: 'https://api.iconify.design/fluent/text-change-case-24-filled.svg',
			description: 'Breyta hvetningu',
			description_markdown: 'Heimild sem gerir þér kleift að breyta hvetningunni áður en þú sendir hana til annarrar heimildar.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['hvetja', 'breytir', 'gagnsemi'],
			home_page: ''
		},
		'it-IT': {
			name: 'Cambia prompt',
			avatar: 'https://api.iconify.design/fluent/text-change-case-24-filled.svg',
			description: 'Cambia prompt',
			description_markdown: 'Una fonte che consente di modificare il prompt prima di inviarlo a un\'altra fonte.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['prompt', 'modificatore', 'utilità'],
			home_page: ''
		},
		'ja-JP': {
			name: 'プロンプトの変更',
			avatar: 'https://api.iconify.design/fluent/text-change-case-24-filled.svg',
			description: 'プロンプトの変更',
			description_markdown: '別のソースに送信する前にプロンプトを変更できるソース。',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['プロンプト', '修飾子', 'ユーティリティ'],
			home_page: ''
		},
		'ko-KR': {
			name: '프롬프트 변경',
			avatar: 'https://api.iconify.design/fluent/text-change-case-24-filled.svg',
			description: '프롬프트 변경',
			description_markdown: '다른 소스로 보내기 전에 프롬프트를 수정할 수 있는 소스입니다.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['프롬프트', '수정자', '유틸리티'],
			home_page: ''
		},
		lzh: {
			name: '易提示',
			avatar: 'https://api.iconify.design/fluent/text-change-case-24-filled.svg',
			description: '易提示',
			description_markdown: '一源，可於送至他源前，易其提示。',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['提示', '易', '用'],
			home_page: ''
		},
		'nl-NL': {
			name: 'Prompt wijzigen',
			avatar: 'https://api.iconify.design/fluent/text-change-case-24-filled.svg',
			description: 'Prompt wijzigen',
			description_markdown: 'Een bron waarmee u de prompt kunt wijzigen voordat u deze naar een andere bron verzendt.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['prompt', 'wijziger', 'hulpprogramma'],
			home_page: ''
		},
		'pt-PT': {
			name: 'Alterar prompt',
			avatar: 'https://api.iconify.design/fluent/text-change-case-24-filled.svg',
			description: 'Alterar prompt',
			description_markdown: 'Uma fonte que permite modificar o prompt antes de enviá-lo para outra fonte.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['prompt', 'modificador', 'utilitário'],
			home_page: ''
		},
		'ru-RU': {
			name: 'Изменить подсказку',
			avatar: 'https://api.iconify.design/fluent/text-change-case-24-filled.svg',
			description: 'Изменить подсказку',
			description_markdown: 'Источник, который позволяет изменять подсказку перед отправкой в другой источник.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['подсказка', 'модификатор', 'утилита'],
			home_page: ''
		},
		'uk-UA': {
			name: 'Змінити підказку',
			avatar: 'https://api.iconify.design/fluent/text-change-case-24-filled.svg',
			description: 'Змінити підказку',
			description_markdown: 'Джерело, яке дозволяє змінювати підказку перед надсиланням до іншого джерела.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['підказка', 'модифікатор', 'утиліта'],
			home_page: ''
		},
		'vi-VN': {
			name: 'Thay đổi lời nhắc',
			avatar: 'https://api.iconify.design/fluent/text-change-case-24-filled.svg',
			description: 'Thay đổi lời nhắc',
			description_markdown: 'Một nguồn cho phép bạn sửa đổi lời nhắc trước khi gửi nó đến một nguồn khác.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['lời nhắc', 'bộ sửa đổi', 'tiện ích'],
			home_page: ''
		},
		'zh-TW': {
			name: '變更提示',
			avatar: 'https://api.iconify.design/fluent/text-change-case-24-filled.svg',
			description: '變更提示',
			description_markdown: '一個允許您在將提示發送到另一個來源之前修改提示的來源。',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['提示', '修改器', '實用程式'],
			home_page: ''
		}
	},
	interfaces: {
		AIsource: {
			/**
			 * 获取此 AI 源的配置模板。
			 * @returns {Promise<object>} 配置模板。
			 */
			GetConfigTemplate: async () => configTemplate,
			GetSource,
		}
	}
}

const configTemplate = {
	name: 'custom prompt',
	provider: 'unknown',
	base_source: 'source name',
	build_prompt: true,
	changes: [
		{
			name: 'base defs',
			insert_depth: 7,
			content: {
				role: 'system',
				name: 'system',
				content: `\
你需要扮演的角色\${Charname}的设定如下：
\${char_prompt}
用户\${UserCharname}的设定如下：
\${user_prompt}
当前环境的设定如下：
\${world_prompt}
其他角色的设定如下：
\${other_chars_prompt}
你可以使用以下插件，方法如下：
\${plugin_prompts}
`
			}
		}
	],
	replaces: [
		{
			name: 'example',
			seek: '/<delete-me>/ig',
			replace: '',
		}
	]
}

/**
 * 获取 AI 源。
 * @param {object} config - 配置对象。
 * @param {object} root0 - 根对象。
 * @param {string} root0.username - 用户名。
 * @param {Function} root0.SaveConfig - 保存配置的函数。
 * @returns {Promise<AIsource_t>} AI 源。
 */
async function GetSource(config, { username, SaveConfig }) {
	const unnamedSources = []
	const base_source = await loadAIsourceFromNameOrConfigData(username, config.base_source, unnamedSources, {
		SaveConfig
	})
	/** @type {AIsource_t} */
	const result = {
		type: 'text-chat',
		info: {
			'en-UK': {
				name: config.name,
				avatar: 'https://api.iconify.design/fluent/text-change-case-24-filled.svg',
				description: 'Change Prompt',
				description_markdown: 'A source that allows you to modify the prompt before sending it to another source.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['prompt', 'modifier', 'utility'],
				provider: config.provider || 'unknown',
				home_page: ''
			},
			'zh-CN': {
				name: config.name,
				avatar: 'https://api.iconify.design/fluent/text-change-case-24-filled.svg',
				description: '更改提示',
				description_markdown: '一个允许您在将提示发送到另一个源之前修改提示的源。',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['提示', '修改器', '实用工具'],
				provider: config.provider || 'unknown',
				home_page: ''
			},
			'ar-SA': {
				name: config.name,
				avatar: 'https://api.iconify.design/fluent/text-change-case-24-filled.svg',
				description: 'تغيير المطالبة',
				description_markdown: 'مصدر يسمح لك بتعديل المطالبة قبل إرسالها إلى مصدر آخر.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['موجه', 'معدل', 'أداة'],
				provider: config.provider || 'unknown',
				home_page: ''
			},
			'de-DE': {
				name: config.name,
				avatar: 'https://api.iconify.design/fluent/text-change-case-24-filled.svg',
				description: 'Eingabeaufforderung ändern',
				description_markdown: 'Eine Quelle, mit der Sie die Eingabeaufforderung ändern können, bevor Sie sie an eine andere Quelle senden.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['Eingabeaufforderung', 'Modifikator', 'Dienstprogramm'],
				provider: config.provider || 'unknown',
				home_page: ''
			},
			emoji: {
				name: '🔄📝',
				avatar: 'https://api.iconify.design/fluent/text-change-case-24-filled.svg',
				description: 'Change Prompt',
				description_markdown: 'A source that allows you to modify the prompt before sending it to another source.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['prompt', 'modifier', 'utility'],
				provider: config.provider || 'unknown',
				home_page: ''
			},
			'es-ES': {
				name: config.name,
				avatar: 'https://api.iconify.design/fluent/text-change-case-24-filled.svg',
				description: 'Cambiar aviso',
				description_markdown: 'Una fuente que le permite modificar el aviso antes de enviarlo a otra fuente.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['aviso', 'modificador', 'utilidad'],
				provider: config.provider || 'unknown',
				home_page: ''
			},
			'fr-FR': {
				name: config.name,
				avatar: 'https://api.iconify.design/fluent/text-change-case-24-filled.svg',
				description: 'Changer l\'invite',
				description_markdown: 'Une source qui vous permet de modifier l\'invite avant de l\'envoyer à une autre source.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['invite', 'modificateur', 'utilitaire'],
				provider: config.provider || 'unknown',
				home_page: ''
			},
			'hi-IN': {
				name: config.name,
				avatar: 'https://api.iconify.design/fluent/text-change-case-24-filled.svg',
				description: 'प्रॉम्प्ट बदलें',
				description_markdown: 'एक स्रोत जो आपको दूसरे स्रोत पर भेजने से पहले प्रॉम्प्ट को संशोधित करने की अनुमति देता है।',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['प्रॉम्प्ट', 'संशोधक', 'उपयोगिता'],
				provider: config.provider || 'unknown',
				home_page: ''
			},
			'is-IS': {
				name: config.name,
				avatar: 'https://api.iconify.design/fluent/text-change-case-24-filled.svg',
				description: 'Breyta hvetningu',
				description_markdown: 'Heimild sem gerir þér kleift að breyta hvetningunni áður en þú sendir hana til annarrar heimildar.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['hvetja', 'breytir', 'gagnsemi'],
				provider: config.provider || 'unknown',
				home_page: ''
			},
			'it-IT': {
				name: config.name,
				avatar: 'https://api.iconify.design/fluent/text-change-case-24-filled.svg',
				description: 'Cambia prompt',
				description_markdown: 'Una fonte che consente di modificare il prompt prima di inviarlo a un\'altra fonte.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['prompt', 'modificatore', 'utilità'],
				provider: config.provider || 'unknown',
				home_page: ''
			},
			'ja-JP': {
				name: config.name,
				avatar: 'https://api.iconify.design/fluent/text-change-case-24-filled.svg',
				description: 'プロンプトの変更',
				description_markdown: '別のソースに送信する前にプロンプトを変更できるソース。',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['プロンプト', '修飾子', 'ユーティリティ'],
				provider: config.provider || 'unknown',
				home_page: ''
			},
			'ko-KR': {
				name: config.name,
				avatar: 'https://api.iconify.design/fluent/text-change-case-24-filled.svg',
				description: '프롬프트 변경',
				description_markdown: '다른 소스로 보내기 전에 프롬프트를 수정할 수 있는 소스입니다.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['프롬프트', '수정자', '유틸리티'],
				provider: config.provider || 'unknown',
				home_page: ''
			},
			lzh: {
				name: config.name,
				avatar: 'https://api.iconify.design/fluent/text-change-case-24-filled.svg',
				description: '易提示',
				description_markdown: '一源，可於送至他源前，易其提示。',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['提示', '易', '用'],
				provider: config.provider || 'unknown',
				home_page: ''
			},
			'nl-NL': {
				name: config.name,
				avatar: 'https://api.iconify.design/fluent/text-change-case-24-filled.svg',
				description: 'Prompt wijzigen',
				description_markdown: 'Een bron waarmee u de prompt kunt wijzigen voordat u deze naar een andere bron verzendt.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['prompt', 'wijziger', 'hulpprogramma'],
				provider: config.provider || 'unknown',
				home_page: ''
			},
			'pt-PT': {
				name: config.name,
				avatar: 'https://api.iconify.design/fluent/text-change-case-24-filled.svg',
				description: 'Alterar prompt',
				description_markdown: 'Uma fonte que permite modificar o prompt antes de enviá-lo para outra fonte.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['prompt', 'modificador', 'utilitário'],
				provider: config.provider || 'unknown',
				home_page: ''
			},
			'ru-RU': {
				name: config.name,
				avatar: 'https://api.iconify.design/fluent/text-change-case-24-filled.svg',
				description: 'Изменить подсказку',
				description_markdown: 'Источник, который позволяет изменять подсказку перед отправкой в другой источник.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['подсказка', 'модификатор', 'утилита'],
				provider: config.provider || 'unknown',
				home_page: ''
			},
			'uk-UA': {
				name: config.name,
				avatar: 'https://api.iconify.design/fluent/text-change-case-24-filled.svg',
				description: 'Змінити підказку',
				description_markdown: 'Джерело, яке дозволяє змінювати підказку перед надсиланням до іншого джерела.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['підказка', 'модифікатор', 'утиліта'],
				provider: config.provider || 'unknown',
				home_page: ''
			},
			'vi-VN': {
				name: config.name,
				avatar: 'https://api.iconify.design/fluent/text-change-case-24-filled.svg',
				description: 'Thay đổi lời nhắc',
				description_markdown: 'Một nguồn cho phép bạn sửa đổi lời nhắc trước khi gửi nó đến một nguồn khác.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['lời nhắc', 'bộ sửa đổi', 'tiện ích'],
				provider: config.provider || 'unknown',
				home_page: ''
			},
			'zh-TW': {
				name: config.name,
				avatar: 'https://api.iconify.design/fluent/text-change-case-24-filled.svg',
				description: '變更提示',
				description_markdown: '一個允許您在將提示發送到另一個來源之前修改提示的來源。',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['提示', '修改器', '實用程式'],
				provider: config.provider || 'unknown',
				home_page: ''
			}
		},
		is_paid: false,
		extension: {},

		/**
		 * 卸载 AI 源。
		 * @returns {Promise<void>}
		 */
		Unload: () => Promise.all(unnamedSources.map(source => source.Unload())),
		/**
		 * 调用 AI 源。
		 * @param {string} prompt - 要发送给 AI 的提示。
		 * @returns {Promise<{content: string}>} AI 的返回结果。
		 */
		Call: async prompt => base_source.Call(prompt),
		/**
		 * 使用结构化提示调用 AI 源。
		 * @param {prompt_struct_t} prompt_struct - 要发送给 AI 的结构化提示。
		 * @returns {Promise<{content: string}>} AI 的返回结果。
		 */
		StructCall: async (/** @type {prompt_struct_t} */ prompt_struct) => {
			const new_prompt_struct = {
				char_id: prompt_struct.char_id,
				UserCharname: prompt_struct.UserCharname,
				ReplyToCharname: prompt_struct.ReplyToCharname,
				Charname: prompt_struct.Charname,
				char_prompt: getSinglePartPrompt(),
				user_prompt: getSinglePartPrompt(),
				other_chars_prompt: {},
				world_prompt: getSinglePartPrompt(),
				plugin_prompts: {},
				chat_log: prompt_struct.chat_log,
			}
			let eval_strings = {
				char_prompt: '',
				user_prompt: '',
				world_prompt: '',
				other_chars_prompt: '',
				plugin_prompts: '',
			}
			if (config.build_prompt) {
				{
					const sorted = prompt_struct.char_prompt.text.sort((a, b) => a.important - b.important).map(text => text.content).filter(Boolean)
					eval_strings.char_prompt = sorted.join('\n')
				}

				{
					const sorted = prompt_struct.user_prompt.text.sort((a, b) => a.important - b.important).map(text => text.content).filter(Boolean)
					eval_strings.user_prompt = sorted.join('\n')
				}

				{
					const sorted = prompt_struct.world_prompt.text.sort((a, b) => a.important - b.important).map(text => text.content).filter(Boolean)
					eval_strings.world_prompt = sorted.join('\n')
				}

				{
					const sorted = Object.values(prompt_struct.other_chars_prompt).map(char => char.text).filter(Boolean).map(
						char => char.sort((a, b) => a.important - b.important).map(text => text.content).filter(Boolean)
					).flat().filter(Boolean)
					eval_strings.other_chars_prompt = sorted.join('\n')
				}

				{
					const sorted = Object.values(prompt_struct.plugin_prompts).map(plugin => plugin?.text).filter(Boolean).map(
						plugin => plugin.sort((a, b) => a.important - b.important).map(text => text.content).filter(Boolean)
					).flat().filter(Boolean)
					eval_strings.plugin_prompts = sorted.join('\n')
				}
			}
			else {
				new_prompt_struct.char_prompt = prompt_struct.char_prompt
				new_prompt_struct.user_prompt = prompt_struct.user_prompt
				new_prompt_struct.world_prompt = prompt_struct.world_prompt
				new_prompt_struct.other_chars_prompt = prompt_struct.other_chars_prompt
				new_prompt_struct.plugin_prompts = prompt_struct.plugin_prompts
				eval_strings = {}
			}
			for (const change of config.changes) {
				const value = {
					name: 'system',
					role: 'system',
					files: [],
					extension: {},
					...change.content,
					content: await formatStr(change.content.content, {
						...eval_strings,
						...prompt_struct,
					})
				}
				const { chat_log } = new_prompt_struct
				if (change.insert_depth > 0)
					// 正数表示在后插入
					if (chat_log.length > change.insert_depth)
						chat_log.splice(chat_log.length - change.insert_depth, 0, value)
					else
						chat_log.unshift(value)
				else
					// 负数表示在前插入
					if (chat_log.length > -change.insert_depth)
						chat_log.splice(-change.insert_depth, 0, value)
					else
						chat_log.push(value)
			}
			const result = await base_source.StructCall(new_prompt_struct)
			for (const replace of config.replaces) {
				const reg = parseRegexFromString(replace.seek)
				result.content = result.content.replace(reg, replace.replace)
			}
			return result
		},
		tokenizer: {
			/**
			 * 释放分词器。
			 * @returns {number} 0
			 */
			free: () => 0,
			/**
			 * 编码提示。
			 * @param {string} prompt - 要编码的提示。
			 * @returns {any} 编码后的提示。
			 */
			encode: prompt => base_source.tokenizer.encode(prompt),
			/**
			 * 解码令牌。
			 * @param {any} tokens - 要解码的令牌。
			 * @returns {string} 解码后的令牌。
			 */
			decode: tokens => base_source.tokenizer.decode(tokens),
			/**
			 * 解码单个令牌。
			 * @param {any} token - 要解码的令牌。
			 * @returns {string} 解码后的令牌。
			 */
			decode_single: token => base_source.tokenizer.decode_single(token),
			/**
			 * 获取令牌计数。
			 * @param {string} prompt - 要计算令牌数的提示。
			 * @returns {Promise<number>} 令牌数。
			 */
			get_token_count: prompt => base_source.tokenizer.get_token_count(prompt),
		}
	}
	return result
}
