/** @type {import('../../../../../../../../../decl/worldAPI.ts').WorldAPI_t} */
export default {
	info: {
		'zh-CN': { name: '测试世界', avatar: '🌍', description: 'live E2E fixture', version: '1.0.0', author: 'fount', tags: ['test'] },
		'en-US': { name: 'Test World', avatar: '🌍', description: 'live E2E fixture', version: '1.0.0', author: 'fount', tags: ['test'] },
	},
	interfaces: {
		chat: {
			/** @returns {import('../../../../../../../../../decl/prompt_struct.ts').prompt_struct_t} live 探针用最小 prompt */
			GetPrompt: () => ({ text: [{ content: 'test world fixture', important: 0 }] }),
		},
	},
}
