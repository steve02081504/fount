/**
 * CI shell 验证入口：boot fount 并尝试加载所有 shell。
 */
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { bootInProcess } from 'fount/scripts/test/node/boot.mjs'

const dataPath = await mkdtemp(join(tmpdir(), 'fount_verify_'))
await bootInProcess({
	dataPath,
	username: 'CI-user',
	web: false,
	resetData: true,
})

const { getPartList, loadPart } = await import('fount/server/parts_loader.mjs')

const shells = getPartList('CI-user', 'shells')
console.log(`loading ${shells.length} shells…`)
const failed = []
for (const shell of shells) try {
	await loadPart('CI-user', `shells/${shell}`)
}
catch (error) {
	console.error(`failed to load shell: ${shell}`)
	console.error(error)
	failed.push(shell)
}
if (failed.length) {
	console.error(`${failed.length}/${shells.length} shells failed: ${failed.join(', ')}`)
	process.exit(1)
}
console.log(`all ${shells.length} shells OK`)
process.exit(0)
