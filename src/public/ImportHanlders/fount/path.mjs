import path from 'node:path'
import fs from 'node:fs'
import { getUserDictionary } from '../../../server/auth.mjs'

export function resolvePath(username, type, name) {
	let userPath = getUserDictionary(username)
	let partPath = path.join(userPath, type, name)
	return partPath
}

export function getAvailablePath(username, type, name) {
	let targetPath = resolvePath(username, type, name)
	if (fs.existsSync(targetPath))
		fs.rmSync(targetPath, { recursive: true, force: true })
	return targetPath
}
