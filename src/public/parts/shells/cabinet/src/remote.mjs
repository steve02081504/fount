import { Buffer } from 'node:buffer'

import { loadFileManifest, readManifestPlaintext, readPublicFile } from 'npm:@steve02081504/fount-p2p/files/evfs'

import { isSafeHtmlUrl } from '../../../../pages/scripts/lib/sanitizeHtml.mjs'
import { canViewByVisibility } from '../../social/src/lib/visibilitySpec.mjs'

/**
 * @param {unknown} raw 远端柜列表
 * @returns {object[]} 清洗后的柜
 */
export function sanitizeRemoteCabinets(raw) {
	const list = Array.isArray(raw?.cabinets) ? raw.cabinets : Array.isArray(raw) ? raw : []
	return list.map(row => ({
		cabinet_id: String(row?.cabinet_id || '').slice(0, 128),
		name: String(row?.name || '').slice(0, 256),
		type: 'personal',
		visibility: row?.visibility && typeof row.visibility === 'object'
			? row.visibility
			: { visibility: String(row?.visibility || 'public') },
		created_at: Number(row?.created_at) || 0,
	})).filter(row => row.cabinet_id)
}

/**
 * @param {unknown} raw 远端索引
 * @returns {{ version: number, entries: object[] }} 清洗索引
 */
export function sanitizeRemoteIndex(raw) {
	const entries = Array.isArray(raw?.entries) ? raw.entries : []
	return {
		version: Number(raw?.version) || 1,
		entries: entries.slice(0, 5000).map(entry => {
			const previewUrl = String(entry?.preview?.url || '').trim().slice(0, 1024)
			return {
				id: String(entry?.id || '').slice(0, 128),
				name: String(entry?.name || '').slice(0, 512),
				kind: ['file', 'folder', 'link'].includes(entry?.kind) ? entry.kind : 'file',
				parent_id: entry?.parent_id == null ? null : String(entry.parent_id).slice(0, 128),
				size: Number(entry?.size) || 0,
				mime_type: String(entry?.mime_type || 'application/octet-stream').slice(0, 256),
				description: String(entry?.description || '').slice(0, 4000),
				created: entry?.created || null,
				modified: entry?.modified || null,
				evfs_path: entry?.evfs_path ? String(entry.evfs_path).slice(0, 512) : null,
				attrs: {
					hidden: Boolean(entry?.attrs?.hidden),
					system: Boolean(entry?.attrs?.system),
				},
				preview: {
					url: isSafeHtmlUrl(previewUrl) ? previewUrl : '',
					delete_with_file: entry?.preview?.delete_with_file !== false,
				},
				encryption: entry?.encryption ? { locked: true } : null,
				link: entry?.link || null,
			}
		}).filter(entry => entry.id),
	}
}

/**
 * @param {string} username 本机用户
 * @param {string} ownerEntityHash 远端实体
 * @param {object} viewerContext 可见性上下文
 * @returns {Promise<object[]>} 可见柜列表
 */
export async function fetchRemoteCabinets(username, ownerEntityHash, viewerContext) {
	/** @type {object[]} */
	const cabinets = []
	try {
		const buf = await readPublicFile(username, ownerEntityHash, 'shells/cabinet/cabinets.public.json')
		cabinets.push(...sanitizeRemoteCabinets(JSON.parse(Buffer.from(buf).toString('utf8'))))
	}
	catch { /* 无公开列表 */ }

	try {
		const manifest = await loadFileManifest(ownerEntityHash, 'shells/cabinet/cabinets.followers.json')
		if (manifest) {
			const plain = await readManifestPlaintext(username, manifest)
			const rows = sanitizeRemoteCabinets(JSON.parse(Buffer.from(plain).toString('utf8')))
			for (const row of rows) {
				if (!canViewByVisibility(row.visibility, viewerContext, ownerEntityHash)) continue
				if (!cabinets.some(existing => existing.cabinet_id === row.cabinet_id))
					cabinets.push(row)
			}
		}
	}
	catch { /* 无 followers 列表或无钥 */ }

	return cabinets
}

/**
 * @param {string} username 本机用户
 * @param {string} ownerEntityHash 远端实体
 * @param {string} cabinetId 柜
 * @param {object} viewerContext 可见性上下文
 * @param {object} cabinetMeta 柜元数据（含 visibility）
 * @returns {Promise<object>} 索引
 */
export async function fetchRemoteCabinetIndex(username, ownerEntityHash, cabinetId, viewerContext, cabinetMeta) {
	if (cabinetMeta && !canViewByVisibility(cabinetMeta.visibility, viewerContext, ownerEntityHash))
		throw new Error('forbidden')
	try {
		const buf = await readPublicFile(username, ownerEntityHash, `shells/cabinet/${cabinetId}/index.json`)
		return sanitizeRemoteIndex(JSON.parse(Buffer.from(buf).toString('utf8')))
	}
	catch {
		const manifest = await loadFileManifest(ownerEntityHash, `shells/cabinet/${cabinetId}/index.json`)
		if (!manifest) throw new Error('index not found')
		const plain = await readManifestPlaintext(username, manifest)
		return sanitizeRemoteIndex(JSON.parse(Buffer.from(plain).toString('utf8')))
	}
}
