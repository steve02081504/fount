import path from 'node:path'
import fs from 'node:fs'
import { getUserDictionary } from '../../../server/auth.mjs'
import { uninstallPartBase } from '../../../server/parts_loader.mjs'

export function resolvePath(username, type, name) {
	let userPath = getUserDictionary(username)
	let partPath = path.join(userPath, type, name)
	return partPath
}

export async function getAvailablePath(username, type, name) {
	let targetPath = resolvePath(username, type, name)
	if (fs.existsSync(targetPath))
		await uninstallPartBase(username, type, name)
	return targetPath
}
