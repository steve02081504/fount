import { exec } from '../../../server/exec.mjs'

export default {
	Load: async () => exec('npm install --no-save cohere-ai'),
	GetSource: async (config) => import('./build.mjs').then(({ default: build }) => build(config))
}