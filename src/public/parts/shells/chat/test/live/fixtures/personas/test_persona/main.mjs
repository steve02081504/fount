/** @type {import('../../../../../../../../../decl/charAPI.ts').CharAPI_t} */
export default {
	info: {
		'zh-CN': { name: '测试人格', avatar: '👤', description: 'live E2E fixture', version: '1.0.0', author: 'fount', tags: ['test'] },
		'en-US': { name: 'Test Persona', avatar: '👤', description: 'live E2E fixture', version: '1.0.0', author: 'fount', tags: ['test'] },
	},
	interfaces: {
		chat: {
			/**
			 *
			 */
			GetPrompt: async () => ({
				text: [{ content: 'test persona fixture', important: 0 }],
				additional_chat_log: [],
				extension: {},
			}),
		},
	},
}
