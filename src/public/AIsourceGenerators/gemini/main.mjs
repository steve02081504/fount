import { exec } from '../../../server/exec.mjs'

export default {
	Load: async () => exec('npm install --no-save @google/generative-ai'),
	GetSource: async (config) => import('./build.mjs').then(({ default: build }) => build(config))
}
