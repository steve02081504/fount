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

let exitCode = 0
for (const shell of getPartList('CI-user', 'shells')) try {
	await loadPart('CI-user', `shells/${shell}`)
	console.log('loaded shell:', shell)
}
catch (error) {
	console.error(`failed to load shell: ${shell}`)
	console.error(error)
	exitCode = 1
}
process.exit(exitCode)
