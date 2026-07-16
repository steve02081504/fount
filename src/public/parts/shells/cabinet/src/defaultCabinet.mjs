import { randomUUID } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'

import { createCabinet, getCabinet, loadPersonalIndex, savePersonalIndex } from './cabinets.mjs'
import { normalizeEntry } from './entryModel.mjs'
import { evfsBlobPath } from './paths.mjs'
import { putCabinetEvfsFile } from './publish.mjs'

const TEMPLATE_ROOT = path.resolve(import.meta.dirname, '../../../../../../default/templates/cabinet')

/**
 * 确保默认柜存在并自模板初始化（overwrite:false）。
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @returns {Promise<object>} 默认柜
 */
export async function ensureDefaultCabinet(username, entityHash) {
	let cabinet = await getCabinet(username, entityHash, 'default')
	if (!cabinet) 
		cabinet = await createCabinet(username, entityHash, {
			cabinet_id: 'default',
			name: 'Default',
			type: 'personal',
			visibility: { visibility: 'private' },
		})
	
	await importTemplate(username, entityHash, cabinet)
	return cabinet
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {object} cabinet 柜
 * @returns {Promise<void>}
 */
async function importTemplate(username, entityHash, cabinet) {
	const index = await loadPersonalIndex(username, entityHash, cabinet.cabinet_id)
	const existing = new Set(index.entries.map(entry => `${entry.parent_id || ''}::${entry.name}`))
	/** @type {Map<string, string>} rel_path -> folder id */
	const folderIds = new Map()
	let changed = false

	/**
	 * @param {string} dir 目录
	 * @param {string | null} parentRel 父相对路径
	 * @param {string | null} parentId 父条目 id
	 * @returns {Promise<void>}
	 */
	async function walk(dir, parentRel, parentId) {
		let names
		try {
			names = await readdir(dir)
		}
		catch {
			return
		}
		for (const name of names) {
			if (name === 'README.md' && !parentRel) continue
			const full = path.join(dir, name)
			const info = await stat(full)
			const rel = parentRel ? `${parentRel}/${name}` : name
			const key = `${parentId || ''}::${name}`
			if (info.isDirectory()) {
				let folderId = folderIds.get(rel)
				if (!existing.has(key)) {
					const folder = normalizeEntry({
						id: randomUUID(),
						kind: 'folder',
						name,
						parent_id: parentId,
						attrs: { hidden: false, system: true },
					}, entityHash)
					folderId = folder.id
					index.entries.push(folder)
					existing.add(key)
					changed = true
				}
				else {
					const found = index.entries.find(entry =>
						entry.kind === 'folder' && entry.name === name && (entry.parent_id || null) === (parentId || null))
					folderId = found?.id
				}
				if (folderId) folderIds.set(rel, folderId)
				await walk(full, rel, folderId || null)
				continue
			}
			if (existing.has(key)) continue
			const plaintext = await readFile(full)
			const blobId = randomUUID()
			const logicalPath = evfsBlobPath(cabinet.cabinet_id, blobId)
			await putCabinetEvfsFile(username, entityHash, {
				logical_path: logicalPath,
				plaintext,
				name,
				mime_type: guessMime(name),
				visibility: cabinet.visibility,
			})
			index.entries.push(normalizeEntry({
				kind: 'file',
				name,
				parent_id: parentId,
				mime_type: guessMime(name),
				size: plaintext.length,
				evfs_path: logicalPath,
				attrs: { hidden: false, system: true },
			}, entityHash))
			existing.add(key)
			changed = true
		}
	}

	await walk(TEMPLATE_ROOT, null, null)
	if (changed)
		await savePersonalIndex(username, entityHash, cabinet.cabinet_id, index)
}

/**
 * @param {string} name 文件名
 * @returns {string} MIME
 */
function guessMime(name) {
	const lower = name.toLowerCase()
	if (lower.endsWith('.md')) return 'text/markdown'
	if (lower.endsWith('.txt')) return 'text/plain'
	if (lower.endsWith('.json')) return 'application/json'
	if (lower.endsWith('.png')) return 'image/png'
	if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
	return 'application/octet-stream'
}
