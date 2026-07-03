/** @type {import('../../../../../../../../../decl/worldAPI.ts').WorldAPI_t} */
export default {
	info: {
		'zh-CN': { name: '测试世界', avatar: '🌍', description: 'live E2E fixture', version: '1.0.0', author: 'fount', tags: ['test'] },
		'en-US': { name: 'Test World', avatar: '🌍', description: 'live E2E fixture', version: '1.0.0', author: 'fount', tags: ['test'] },
	},
	interfaces: {
		chat: {
			/**
			 *
			 */
			GetPrompt: () => ({ text: [{ content: 'test world fixture', important: 0 }] }),
		},
	},
}
