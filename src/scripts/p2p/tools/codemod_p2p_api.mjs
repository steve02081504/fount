import { readdir, readFile, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'

const patterns = [
	[/loadReputation\(\s*username\s*\)/g, 'loadReputation()'],
	[/loadReputation\(\s*replicaUsername\s*\)/g, 'loadReputation()'],
	[/loadDenylist\(\s*username\s*\)/g, 'loadDenylist()'],
	[/loadNetwork\(\s*username\s*\)/g, 'loadNetwork()'],
	[/saveNetwork\(\s*username\s*,/g, 'saveNetwork('],
	[/getNodeHash\(\s*username\s*\)/g, 'getNodeHash()'],
	[/getNodeHash\(\s*replicaUsername\s*\)/g, 'getNodeHash()'],
	[/countMailboxPending\(\s*username\s*\)/g, 'countMailboxPending()'],
	[/isSubjectBlocked\(\s*username\s*,/g, 'isSubjectBlocked('],
	[/isPeerKeyBlocked\(\s*username\s*,/g, 'isPeerKeyBlocked('],
	[/isWritableLocalEntity\(\s*replicaUsername\s*,/g, 'isWritableLocalEntity('],
	[/isWritableLocalEntity\(\s*username\s*,/g, 'isWritableLocalEntity('],
	[/addDenylistEntry\(\s*username\s*,/g, 'addDenylistEntry('],
	[/addDenylistFromBanContent\(\s*username\s*,/g, 'addDenylistFromBanContent('],
	[/setEntityBlocked\(\s*username\s*,/g, 'setEntityBlocked('],
	[/invalidateDenylistIndex\(\s*username\s*\)/g, 'invalidateDenylistIndex()'],
	[/resolveOperatorEntityHash\(\s*replicaUsername\s*\)/g, 'resolveOperatorEntityHash(replicaUsername)'],
]

/**
 * @param {string} dir 根目录
 * @returns {AsyncGenerator<{ path: string }>} 所有 .mjs 文件
 */
async function* walkMjs(dir) {
	for (const ent of await readdir(dir, { withFileTypes: true })) {
		const path = join(dir, ent.name)
		if (ent.isDirectory()) yield* walkMjs(path)
		else if (extname(ent.name) === '.mjs') yield { path }
	}
}

let count = 0
for await (const e of walkMjs('src')) {
	const text = await readFile(e.path, 'utf8')
	let next = text
	for (const [re, rep] of patterns) next = next.replace(re, rep)
	if (next !== text) {
		await writeFile(e.path, next)
		count++
	}
}
console.log('updated', count, 'files')
