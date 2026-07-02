import { isEntityHash128 } from '../entity_id.mjs'
import { isHex64 } from '../hexIds.mjs'

/** @typedef {'plain' | 'convergent' | 'random'} CeMode */

/** @typedef {{ hash: string, size: number }} ManifestPart */

/**
 * @typedef {{
 *   type: 'public' | 'file-master-key-wrap' | 'vault-wrap' | 'identity-wrap',
 *   wrappedKey?: { iv: string, ciphertext: string, authTag: string },
 *   groupId?: string,
 *   fileId?: string,
 *   entityHash?: string,
 *   keyGeneration?: number,
 * }} TransferKeyDescriptor
 */

/**
 * @typedef {{
 *   ownerEntityHash: string,
 *   logicalPath: string,
 *   name: string,
 *   mimeType: string,
 *   size: number,
 *   contentHash: string,
 *   ceMode: CeMode,
 *   parts: ManifestPart[],
 *   transferKeyDescriptor: TransferKeyDescriptor,
 *   meta?: object,
 * }} FileManifest
 */

const CE_MODES = new Set(['plain', 'convergent', 'random'])
const TRANSFER_TYPES = new Set(['public', 'file-master-key-wrap', 'vault-wrap', 'identity-wrap'])

/**
 * @param {unknown} input 原始对象
 * @returns {FileManifest | null} 校验后的 manifest
 */
export function normalizeFileManifest(input) {
	if (!input || typeof input !== 'object') return null
	const ownerEntityHash = String(input.ownerEntityHash || '').trim().toLowerCase()
	if (!isEntityHash128(ownerEntityHash)) return null
	const logicalPath = String(input.logicalPath || '').trim().replace(/^\/+/, '').replace(/\\/g, '/')
	if (!logicalPath) return null
	const ceMode = String(input.ceMode || 'convergent')
	if (!CE_MODES.has(ceMode)) return null
	const parts = Array.isArray(input.parts)
		? input.parts
			.map(part => ({ hash: String(part?.hash || '').trim().toLowerCase(), size: Number(part?.size) || 0 }))
			.filter(part => isHex64(part.hash))
		: []
	if (!parts.length) return null
	const transferKeyDescriptor = normalizeTransferKeyDescriptor(input.transferKeyDescriptor)
	if (!transferKeyDescriptor) return null
	return {
		ownerEntityHash,
		logicalPath,
		name: String(input.name || logicalPath.split('/').pop() || 'file'),
		mimeType: String(input.mimeType || 'application/octet-stream'),
		size: Number(input.size) || 0,
		contentHash: String(input.contentHash || '').trim().toLowerCase(),
		ceMode: /** @type {CeMode} */ ceMode,
		parts,
		transferKeyDescriptor,
		meta: input.meta?.constructor === Object ? { ...input.meta } : undefined,
	}
}

/**
 * @param {unknown} input 描述符
 * @returns {TransferKeyDescriptor | null} 校验后的传输密钥描述符
 */
export function normalizeTransferKeyDescriptor(input) {
	if (!input || typeof input !== 'object') return null
	const type = String(input.type || '').trim()
	if (!TRANSFER_TYPES.has(type)) return null
	/** @type {TransferKeyDescriptor} */
	const out = { type: /** @type {TransferKeyDescriptor['type']} */ type }
	if (input.wrappedKey?.constructor === Object)
		out.wrappedKey = {
			iv: String(input.wrappedKey.iv || ''),
			ciphertext: String(input.wrappedKey.ciphertext || ''),
			authTag: String(input.wrappedKey.authTag || ''),
		}
	if (input.groupId) out.groupId = String(input.groupId).trim()
	if (input.fileId) out.fileId = String(input.fileId).trim()
	if (input.entityHash) out.entityHash = String(input.entityHash).trim().toLowerCase()
	if (input.keyGeneration != null) out.keyGeneration = Number(input.keyGeneration) || 0
	return out
}

/**
 * @returns {TransferKeyDescriptor} public 描述符
 */
export function publicTransferKeyDescriptor() {
	return { type: 'public' }
}
