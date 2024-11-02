import { exec } from '../../../server/exec.mjs'

export default {
	Init: async () => await exec('npm install --save-optional cohere-ai'),
	GetSource: async (config) => import('./build.mjs').then(({ default: build }) => build(config))
}
