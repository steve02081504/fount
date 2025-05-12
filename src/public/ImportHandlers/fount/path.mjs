import path from 'node:path'
import fs from 'node:fs'
import { getUserDictionary } from '../../../server/auth.mjs'
import { unloadPart } from '../../../server/managers/index.mjs'

export function resolvePath(username, type, name) {
	const userPath = getUserDictionary(username)
	const partPath = path.join(userPath, type, name)
	return partPath
}

export async function getAvailablePath(username, type, name) {
	const targetPath = resolvePath(username, type, name)
	if (fs.existsSync(targetPath))
		await unloadPart(username, type, name)
	return targetPath
}
