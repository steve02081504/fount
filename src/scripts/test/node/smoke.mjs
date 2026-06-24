/**
 * loadPart 冒烟：子进程内 boot 后加载全部 shell（供 runner 调用）。
 */
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { bootInProcess } from './boot.mjs'

const dataPath = await mkdtemp(join(tmpdir(), 'fount_smoke_'))
await bootInProcess({
	dataPath,
	username: 'CI-user',
	web: false,
	resetData: true,
})

const { getPartList, loadPart } = await import('../../../server/parts_loader.mjs')

const shells = getPartList('CI-user', 'shells')
console.log(`smoke: loading ${shells.length} shells…`)
const failed = []
for (const shell of shells) try {
	await loadPart('CI-user', `shells/${shell}`)
}
catch (error) {
	console.error(`smoke: failed to load shell: ${shell}`)
	console.error(error)
	failed.push(shell)
}
if (failed.length) {
	console.error(`smoke: ${failed.length}/${shells.length} shells failed: ${failed.join(', ')}`)
	process.exit(1)
}
console.log(`smoke: all ${shells.length} shells OK`)
process.exit(0)
