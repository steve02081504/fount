/** @type {import('../../../../../../../../../decl/charAPI.ts').CharAPI_t} */
export default {
	info: {
		'zh-CN': {
			name: 'Social OnMessage probe',
			avatar: '🔬',
			description: 'social OnMessage probe',
			version: '1.0.0',
			author: 'fount',
			tags: ['test'],
		},
	},
	interfaces: {
		chat: {
			/** @returns {Promise<{ content: string }>} */
			GetReply: async () => ({ content: 'social-on-message-reply' }),
		},
		social: {
			/**
			 * @param {import('../../../../../../../../../decl/socialAPI.ts').SocialMessageEvent} event
			 * @returns {Promise<boolean>}
			 */
			OnMessage: async event => {
				const state = globalThis.__fountSocialOnMessageProbe ??= { events: [], returnValue: true }
				state.events.push({
					authorEntityHash: event.authorEntityHash,
					postText: event.postText,
					mentions: event.mentions,
					viewerEntityHash: event.viewerEntityHash,
					postId: event.post?.id,
				})
				return !!state.returnValue
			},
		},
	},
}
