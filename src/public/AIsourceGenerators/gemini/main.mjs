import { exec } from 'child_process'

export default {
	Init: async () => {
		return await new Promise((resolve, reject) => {
			exec('npm install --no-save @google/generative-ai', (err) => {
				if (err) reject(err)
				resolve()
			})
		})
	},
	GetSource: async (config) => import('./build.mjs').then(({ default: build }) => build(config))
}
