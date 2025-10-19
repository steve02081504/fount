/** @typedef {import('../../../decl/AIsource.ts').AIsource_t} AIsource_t */
/** @typedef {import('../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t */

import { getPartInfo } from '../../../scripts/locale.mjs'
import { getUserByUsername } from '../../../server/auth.mjs'
import { loadAIsourceFromNameOrConfigData } from '../../../server/managers/AIsource_manager.mjs'

export default {
	interfaces: {
		AIsource: {
			GetConfigTemplate: async () => configTemplate,
			GetSource,
		}
	}
}

const configTemplate = {
	name: 'compare array',
	provider: 'unknown',
	sources: [
		'source name1',
		'source name2',
		{
			generator: 'some generator',
			config: {
				model_name: 'lol',
				other_datas: 'lol'
			}
		}
	],
}

async function GetSource(config, { username, SaveConfig }) {
	const unnamedSources = []
	const sources = await Promise.all(config.sources.map(source => loadAIsourceFromNameOrConfigData(username, source, unnamedSources, {
		SaveConfig
	})))
	/** @type {AIsource_t} */
	const result = {
		type: 'text-chat',
		info: {
			'': {
				avatar: '',
				name: config.name,
				provider: config.provider || 'unknown',
				description: 'muti-compare',
				description_markdown: 'muti-compare',
				version: '0.0.0',
				author: 'steve02081504',
				home_page: '',
				tags: ['muti-compare'],
			}
		},
		is_paid: false,
		extension: {},

		Unload: () => Promise.all(unnamedSources.map(source => source.Unload())),
		Call: async prompt => {
			if (!sources.length) throw new Error('no source selected')
			const results = await Promise.all(sources.map(source => {
				const info = getPartInfo(source, getUserByUsername(username).locales)
				return source.Call(prompt).then(
					result => `\
**${info.name} from ${info.provider}:**
${result}
`,
					err => `\
**${info.name} from ${info.provider} error:**
\`\`\`
${err.stack || err}
\`\`\`
`
				)
			}))
			return results.join('\n')
		},
		StructCall: async (/** @type {prompt_struct_t} */ prompt_struct) => {
			if (!sources.length) throw new Error('no source selected')
			const files = []
			const results = await Promise.all(sources.map(source => {
				const info = getPartInfo(source, getUserByUsername(username).locales)
				return source.StructCall(prompt_struct).then(
					result => {
						let res = `\
**${info.name} from ${info.provider}:**
${result.content}
`
						if (result.files.length) {
							res += `\nfiles ${files.length} - ${files.length + result.files.length}\n`
							files.push(...result.files)
						}
						return res
					},
					err => `\
**${info.name} from ${info.provider} error:**
\`\`\`
${err.stack || err}
\`\`\`
`
				)
			}))
			return {
				content: results.join('\n'),
				files
			}
		},
		tokenizer: {
			free: () => 0,
			encode: prompt => prompt,
			decode: tokens => tokens,
			decode_single: token => token,
			get_token_count: prompt => prompt.length
		}
	}
	return result
}
