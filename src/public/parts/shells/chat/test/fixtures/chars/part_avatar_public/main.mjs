/** @type {import('../../../../../../../../../decl/charAPI.ts').CharAPI_t} */
export default {
	info: {
		'zh-CN': {
			name: 'Public Avatar Char',
			// 与 Gentian 同构：/parts/... 映射到 part 的 public/
			avatar: '/parts/chars:part_avatar_public/imgs/anime.avif',
			description: 'avatar under public/',
			tags: ['avatar-sync'],
		},
	},
	interfaces: {
		chat: {
			/** @returns {Promise<{ content: string }>} 固定回复 */
			GetReply: async () => ({ content: 'ok' }),
		},
	},
}
