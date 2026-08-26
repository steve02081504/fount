import { Buffer } from 'node:buffer'

import { loadFileManifest, readManifestPlaintext, readPublicFile } from 'npm:@steve02081504/fount-p2p/files/evfs'

/**
 * @param {string} username 本机用户
 * @param {string} ownerEntityHash 远端实体
 * @param {object} viewerContext 可见性上下文
 * @returns {Promise<object[]>} 可见柜列表
 */
export async function fetchRemoteCabinets(username, ownerEntityHash, viewerContext) {
	const { canViewByVisibility } = await import('../../social/src/lib/visibilitySpec.mjs')
	/** @type {object[]} */
	const cabinets = []
	try {
		const buf = await readPublicFile(username, ownerEntityHash, 'shells/cabinet/cabinets.public.json')
		cabinets.push(...JSON.parse(Buffer.from(buf).toString('utf8')))
	}
	catch { /* 无公开列表 */ }

	try {
		const manifest = await loadFileManifest(ownerEntityHash, 'shells/cabinet/cabinets.followers.json')
		if (manifest) {
			const plain = await readManifestPlaintext(username, manifest)
			const rows = JSON.parse(Buffer.from(plain).toString('utf8'))
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
	const { canViewByVisibility } = await import('../../social/src/lib/visibilitySpec.mjs')
	if (cabinetMeta && !canViewByVisibility(cabinetMeta.visibility, viewerContext, ownerEntityHash))
		throw new Error('forbidden')
	try {
		const buf = await readPublicFile(username, ownerEntityHash, `shells/cabinet/${cabinetId}/index.json`)
		return JSON.parse(Buffer.from(buf).toString('utf8'))
	}
	catch {
		const manifest = await loadFileManifest(ownerEntityHash, `shells/cabinet/${cabinetId}/index.json`)
		if (!manifest) throw new Error('index not found')
		const plain = await readManifestPlaintext(username, manifest)
		return JSON.parse(Buffer.from(plain).toString('utf8'))
	}
}
