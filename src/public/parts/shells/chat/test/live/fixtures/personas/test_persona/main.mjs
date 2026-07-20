/** @type {import('../../../../../../../../../decl/charAPI.ts').CharAPI_t} */
export default {
	info: {
		'zh-CN': { name: '测试人格', avatar: '👤', description: 'live E2E fixture', version: '1.0.0', author: 'fount', tags: ['test'] },
		'en-US': { name: 'Test Persona', avatar: '👤', description: 'live E2E fixture', version: '1.0.0', author: 'fount', tags: ['test'] },
	},
	interfaces: {
		chat: {
			/** @returns {Promise<import('../../../../../../../../../decl/prompt_struct.ts').prompt_struct_t>} live 探针用最小 prompt */
			GetPrompt: async () => ({
				text: [{ content: 'test persona fixture', important: 0 }],
				additional_chat_log: [],
				extension: {},
			}),
		},
	},
}
