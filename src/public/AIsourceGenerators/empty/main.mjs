/** @typedef {import('../../../decl/AIsource.ts').AIsource_t} AIsource_t */

export default {
	interfaces: {
		AIsource: {
			GetConfigDisplayContent: async () => ({
				html: '<div class="text-warning" data-i18n="aisource_editor.common_config_interface.empty_generator"></div>'
			}),
			GetConfigTemplate: async () => ({
				'to de or not to de': 'this is an question'
			}),
			GetSource,
		}
	}
}

async function GetSource(config) {
	const error = new Error('This is an empty AI source, which is a placeholder for a previously used generator that error in loading or has been uninstalled or renamed. Please select a new generator.')
	/** @type {AIsource_t} */
	const result = {
		type: 'text-chat',
		info: {
			'': {
				avatar: '',
				name: config.name || 'Empty',
				provider: 'fount',
				description: 'Empty AI Source',
				description_markdown: 'A placeholder for a missing AI source generator.',
				version: '0.0.1',
				author: 'steve02081504',
				home_page: '',
				tags: ['empty', 'placeholder'],
			}
		},
		is_paid: false,
		extension: {},

		Unload: () => { },
		Call: async (prompt) => {
			throw error
		},
		StructCall: async (prompt_struct) => {
			throw error
		},
		tokenizer: {
			free: () => 0,
			encode: (prompt) => prompt,
			decode: (tokens) => tokens,
			decode_single: (token) => token,
			get_token_count: (prompt) => prompt.length
		}
	}
	return result
}
