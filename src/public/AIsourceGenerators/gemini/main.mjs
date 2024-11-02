import { exec } from '../../../server/exec.mjs'

export default {
	Init: async () => await exec('npm install --save-optional @google/generative-ai'),
	GetSource: async (config) => import('./build.mjs').then(({ default: build }) => build(config))
}
