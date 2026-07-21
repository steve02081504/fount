import { Buffer } from 'node:buffer'

import { zipSync, strToU8 } from 'npm:fflate'

import { loadCabinetIndex, resolveCabinet } from './cabinets.mjs'
import { normalizeParentId } from './entryModel.mjs'
import { loadEncryptedFolderIndex } from './passwordFolder.mjs'
import { resolveUnlockToken } from './unlockTokens.mjs'

/**
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {string} cabinetId 柜
 * @param {{ folder_id?: string | null, unlock_token?: string, readFile?: (evfsPath: string) => Promise<Uint8Array> }} options 选项
 * @returns {Promise<{ filename: string, bytes: Uint8Array }>} zip
 */
export async function zipCabinetFolder(username, entityHash, cabinetId, options = {}) {
	const cabinet = await resolveCabinet(username, entityHash, cabinetId)
	if (!cabinet) throw new Error('cabinet not found')
	const index = await loadCabinetIndex(username, entityHash, cabinetId, cabinet)
	const folderId = normalizeParentId(options.folder_id)
	/** @type {Record<string, Uint8Array>} */
	const files = {}

	/**
	 * @param {object[]} entries 条目
	 * @param {string} prefix 路径前缀
	 * @returns {Promise<void>}
	 */
	async function addTree(entries, prefix) {
		for (const entry of entries) {
			const name = `${prefix}${entry.name}`
			if (entry.kind === 'folder') {
				if (entry.encryption) {
					const folderKey = resolveUnlockToken(options.unlock_token, {
						cabinet_id: cabinetId,
						folder_id: entry.id,
						entity_hash: entityHash,
					})
					if (!folderKey) {
						files[`${name}/.locked`] = strToU8('locked')
						continue
					}
					const enc = await loadEncryptedFolderIndex(username, entityHash, cabinetId, entry.id, folderKey)
					await addTree(enc.entries, `${name}/`)
					continue
				}
				await addTree(index.entries.filter(row => (row.parent_id || null) === entry.id), `${name}/`)
				continue
			}
			if (entry.kind === 'link') {
				files[`${name}.link.json`] = strToU8(JSON.stringify(entry.link || {}, null, '\t'))
				continue
			}
			if (!entry.evfs_path || !options.readFile) {
				files[`${name}.missing`] = strToU8('')
				continue
			}
			try {
				files[name] = await options.readFile(entry.evfs_path, entry)
			}
			catch {
				files[`${name}.missing`] = strToU8('')
			}
		}
	}

	if (folderId) {
		const folder = index.entries.find(row => row.id === folderId)
		if (folder?.encryption) {
			const folderKey = resolveUnlockToken(options.unlock_token, {
				cabinet_id: cabinetId,
				folder_id: folderId,
				entity_hash: entityHash,
			})
			if (!folderKey) throw new Error('folder locked')
			const enc = await loadEncryptedFolderIndex(username, entityHash, cabinetId, folderId, folderKey)
			await addTree(enc.entries, '')
		}
		else
			await addTree(index.entries.filter(row => (row.parent_id || null) === folderId), '')
	}
	else
		await addTree(index.entries.filter(row => (row.parent_id || null) === null), '')

	const bytes = zipSync(files, { level: 1 })
	return {
		filename: `${cabinet.name || cabinetId}.zip`,
		bytes: bytes instanceof Uint8Array ? bytes : new Uint8Array(Buffer.from(bytes)),
	}
}
