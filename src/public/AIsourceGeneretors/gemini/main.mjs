import npm from 'npm'

export default {
	Init: async () => {
		return await new Promise((resolve, reject) => {
			npm.commands.install(['@google/generative-ai'], (err) => {
				if (err) reject(err)
				resolve({ success: true })
			})
		})
	},
	GetSource: async (config) => import('./build.mjs').then(({ default: build }) => build(config))
}

