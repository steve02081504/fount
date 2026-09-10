import fs from 'node:fs'
import path from 'node:path'

/**
 * 目录条目，符号链接/junction 已跟随解析为真实类型。
 * @typedef {Object} ResolvedDirEntry
 * @property {string} name - 条目名。
 * @property {string} fullPath - 条目完整路径。
 * @property {boolean} isDirectory - 是否（指向）目录。
 * @property {boolean} isFile - 是否（指向）普通文件。
 */

/**
 * 读取目录条目，跟随符号链接/junction 解析真实类型；断链/不可读目录返回空或忽略该项。
 * @param {string} dir - 目录路径。
 * @returns {ResolvedDirEntry[]} 解析后的条目列表。
 */
export function readDirEntries(dir) {
	const entries = []
	let dirents
	try {
		dirents = fs.readdirSync(dir, { withFileTypes: true })
	}
	catch { return entries }

	for (const dirent of dirents) {
		const fullPath = path.join(dir, dirent.name)
		let isDirectory = dirent.isDirectory()
		let isFile = dirent.isFile()
		if (dirent.isSymbolicLink())
			try {
				const stat = fs.statSync(fullPath, { throwIfNoEntry: false })
				isDirectory = stat?.isDirectory() ?? false
				isFile = stat?.isFile() ?? false
			}
			catch {
				isDirectory = false
				isFile = false
			}
		entries.push({ name: dirent.name, fullPath, isDirectory, isFile })
	}
	return entries
}

/**
 * 解析路径的真实路径（折叠符号链接/junction），失败返回 null。
 * @param {string} targetPath - 目标路径。
 * @returns {string | null} 真实路径或 null。
 */
export function canonicalPath(targetPath) {
	try {
		return fs.realpathSync.native?.(targetPath) ?? fs.realpathSync(targetPath)
	}
	catch { return null }
}
