import { Buffer } from 'node:buffer'
import fsp from 'node:fs/promises'
import path from 'node:path'

import { parseEntityHash } from './entity_id.mjs'
import { assertSafeEvfsLogicalPath } from './evfs_logical_path.mjs'
import { readJsonFile, writeJsonFile } from './utils/json_io.mjs'

/**
 * @typedef {object} EntityStore
 * @property {(entityHash: string) => Promise<string[]>} listEntityFiles 列出逻辑路径
 * @property {(entityHash: string, logicalPath: string) => Promise<Buffer | null>} readEntityFile
 * @property {(entityHash: string, logicalPath: string, data: Buffer | Uint8Array) => Promise<void>} writeEntityFile
 * @property {(entityHash: string, logicalPath: string) => Promise<boolean>} statEntityFile
 * @property {(entityHash: string, name: string) => Promise<object | null>} readEntityJson
 * @property {(entityHash: string, name: string, data: object) => Promise<void>} writeEntityJson
 * @property {(entityHash: string, logicalPath: string) => Promise<object | null>} readManifest
 * @property {(entityHash: string, logicalPath: string, data: object) => Promise<void>} writeManifest
 * @property {(entityHash: string, logicalPath: string) => Promise<boolean>} statManifest
 * @property {() => Promise<string[]>} listEntityHashes
 */

/**
 * @param {string} entityHash 128 hex
 * @returns {string} 规范化 entityHash
 */
function normalizeEntityHash(entityHash) {
	const hash = String(entityHash || '').trim().toLowerCase()
	if (!parseEntityHash(hash)) throw new Error('invalid entityHash')
	return hash
}

/**
 * @param {string} baseDir entities 根目录
 * @returns {EntityStore} 默认文件系统 EntityStore
 */
export function createFsEntityStore(baseDir) {
	const root = path.resolve(baseDir)

	/**
	 * @param {string} entityHash 128 hex
	 * @returns {string} 实体目录绝对路径
	 */
	function entityRoot(entityHash) {
		return path.join(root, normalizeEntityHash(entityHash))
	}

	/**
	 * @param {string} entityHash 128 hex
	 * @param {string} name 相对文件名（如 profile.json）
	 * @returns {string} JSON 文件绝对路径
	 */
	function entityJsonPath(entityHash, name) {
		const safe = String(name || '').trim().replace(/\\/g, '/')
		if (!safe || safe.includes('..') || safe.startsWith('/')) throw new Error('invalid entity json name')
		return path.join(entityRoot(entityHash), safe)
	}

	/**
	 * @param {string} entityHash 128 hex
	 * @param {string} logicalPath EVFS 逻辑路径
	 * @returns {string} manifest 绝对路径
	 */
	function manifestPath(entityHash, logicalPath) {
		const filesRoot = path.join(entityRoot(entityHash), 'files')
		const safe = assertSafeEvfsLogicalPath(logicalPath)
		const resolved = path.resolve(filesRoot, `${safe}.manifest.json`)
		const rootResolved = path.resolve(filesRoot)
		if (resolved !== rootResolved && !resolved.startsWith(rootResolved + path.sep))
			throw new Error('invalid EVFS path traversal')
		return resolved
	}

	return {
		/**
		 * @returns {Promise<string[]>} 本 store 下全部 entityHash
		 */
		async listEntityHashes() {
			try {
				const entries = await fsp.readdir(root, { withFileTypes: true })
				return entries.filter(e => e.isDirectory()).map(e => e.name.toLowerCase()).filter(h => parseEntityHash(h))
			}
			catch (err) {
				if (/** @type {NodeJS.ErrnoException} */ err.code === 'ENOENT') return []
				throw err
			}
		},

		/**
		 * @param {string} entityHash 128 hex
		 * @param {string} name 相对 JSON 名
		 * @returns {Promise<object | null>} 解析后的 JSON 或 null
		 */
		async readEntityJson(entityHash, name) {
			return readJsonFile(entityJsonPath(entityHash, name))
		},

		/**
		 * @param {string} entityHash 128 hex
		 * @param {string} name 相对 JSON 名
		 * @param {object} data 写入对象
		 * @returns {Promise<void>}
		 */
		async writeEntityJson(entityHash, name, data) {
			await writeJsonFile(entityJsonPath(entityHash, name), data)
		},

		/**
		 * @param {string} entityHash 128 hex
		 * @param {string} logicalPath EVFS 逻辑路径
		 * @returns {Promise<Buffer | null>} 明文文件或 null
		 */
		async readEntityFile(entityHash, logicalPath) {
			const filePath = manifestPath(entityHash, logicalPath).replace(/\.manifest\.json$/u, '')
			try {
				return await fsp.readFile(filePath)
			}
			catch (err) {
				if (/** @type {NodeJS.ErrnoException} */ err.code === 'ENOENT') return null
				throw err
			}
		},

		/**
		 * @param {string} entityHash 128 hex
		 * @param {string} logicalPath EVFS 逻辑路径
		 * @param {Buffer | Uint8Array} data 明文内容
		 * @returns {Promise<void>}
		 */
		async writeEntityFile(entityHash, logicalPath, data) {
			const filePath = manifestPath(entityHash, logicalPath).replace(/\.manifest\.json$/u, '')
			await fsp.mkdir(path.dirname(filePath), { recursive: true })
			await fsp.writeFile(filePath, Buffer.from(data))
		},

		/**
		 * @param {string} entityHash 128 hex
		 * @param {string} logicalPath EVFS 逻辑路径
		 * @returns {Promise<boolean>} 明文文件是否存在
		 */
		async statEntityFile(entityHash, logicalPath) {
			const filePath = manifestPath(entityHash, logicalPath).replace(/\.manifest\.json$/u, '')
			try {
				await fsp.access(filePath)
				return true
			}
			catch {
				return false
			}
		},

		/**
		 * @param {string} entityHash 128 hex
		 * @returns {Promise<string[]>} 逻辑路径列表
		 */
		async listEntityFiles(entityHash) {
			const filesRoot = path.join(entityRoot(entityHash), 'files')
			/** @type {string[]} */
			const out = []
			/**
			 * @param {string} dir 当前目录
			 * @param {string} prefix 相对前缀
			 * @returns {Promise<void>}
			 */
			async function walk(dir, prefix) {
				let entries
				try { entries = await fsp.readdir(dir, { withFileTypes: true }) }
				catch { return }
				for (const entry of entries) {
					const rel = prefix ? `${prefix}/${entry.name}` : entry.name
					if (entry.isDirectory()) await walk(path.join(dir, entry.name), rel)
					else if (entry.name.endsWith('.manifest.json'))
						out.push(rel.replace(/\.manifest\.json$/u, ''))
				}
			}
			await walk(filesRoot, '')
			return out
		},

		/**
		 * @param {string} entityHash 128 hex
		 * @param {string} logicalPath EVFS 逻辑路径
		 * @returns {Promise<object | null>} manifest 或 null
		 */
		async readManifest(entityHash, logicalPath) {
			return readJsonFile(manifestPath(entityHash, logicalPath))
		},

		/**
		 * @param {string} entityHash 128 hex
		 * @param {string} logicalPath EVFS 逻辑路径
		 * @param {object} data manifest 对象
		 * @returns {Promise<void>}
		 */
		async writeManifest(entityHash, logicalPath, data) {
			await writeJsonFile(manifestPath(entityHash, logicalPath), data)
		},

		/**
		 * @param {string} entityHash 128 hex
		 * @param {string} logicalPath EVFS 逻辑路径
		 * @returns {Promise<boolean>} manifest 是否存在
		 */
		async statManifest(entityHash, logicalPath) {
			try {
				await fsp.access(manifestPath(entityHash, logicalPath))
				return true
			}
			catch {
				return false
			}
		},
	}
}
