import path from 'node:path'
export const __dirname = path.resolve(import.meta.dirname + '/../../')

export let startTime = null
export function set_start() {
	startTime = new Date()
}
