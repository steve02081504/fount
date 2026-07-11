import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

import { saveFileManifest, storeManifestParts } from '../../../../../scripts/p2p/entity/files/evfs.mjs'
import { buildFileManifestFromEnc, encryptPlaintextToParts, vaultWrapDescriptor } from '../../../../../scripts/p2p/files/assemble.mjs'
import { vaultGroupId } from './federation/namespace.mjs'
import { getUserDictionary } from '../../../../../server/auth/index.mjs'

import { loadVaultMasterKey } from './vault_crypto/vault.mjs'

/**
 * 返回 vault 文件索引路径。
 * @param {string} username 用户
 * @param {string} entityHash owner
 * @returns {string} file index 路径
 */
function vaultIndexPath(username, entityHash) {
	return `${getUserDictionary(username)}/shells/social/timelines/${entityHash}/vault_index.json`
}

/**
 * 读取 vault 文件索引。
 * @param {string} username 用户
 * @param {string} entityHash owner
 * @returns {Promise<Record<string, object>>} vault 文件索引
 */
export async function loadVaultIndex(username, entityHash) {
	try {
		return JSON.parse(await readFile(vaultIndexPath(username, entityHash), 'utf8'))
	}
	catch {
		return {}
	}
}

/**
 * 写入 vault 文件索引。
 * @param {string} username 用户
 * @param {string} entityHash owner
 * @param {Record<string, object>} index 索引
 * @returns {Promise<void>}
 */
async function saveVaultIndex(username, entityHash, index) {
	await mkdir(`${vaultIndexPath(username, entityHash).replace(/[/\\][^/\\]+$/, '')}`, { recursive: true })
	await writeFile(vaultIndexPath(username, entityHash), JSON.stringify(index, null, '\t'), 'utf8')
}

/**
 * 写入 vault EVFS manifest（random + vault-wrap）。
 * @param {string} username replica
 * @param {string} entityHash owner
 * @param {{ fileId?: string, plaintext: Buffer | Uint8Array, name?: string, mimeType?: string, visibility?: string }} opts 参数
 * @returns {Promise<{ fileId: string, logicalPath: string, manifest: object }>} 写入结果
 */
export async function putVaultFileManifest(username, entityHash, opts) {
	const fileId = opts.fileId || randomUUID()
	const logicalPath = `shells/social/vault/${fileId}`
	const { masterKey } = await loadVaultMasterKey(username, entityHash)
	const enc = encryptPlaintextToParts(opts.plaintext, 'random')
	const descriptor = vaultWrapDescriptor(entityHash, fileId, enc.contentKey, masterKey)
	const manifest = buildFileManifestFromEnc({
		ownerEntityHash: entityHash,
		logicalPath,
		plaintext: opts.plaintext,
		name: opts.name || fileId,
		mimeType: opts.mimeType || 'application/octet-stream',
		ceMode: 'random',
		transferKeyDescriptor: descriptor,
		meta: { fileId, visibility: opts.visibility || 'followers', vaultGroupId: vaultGroupId(entityHash) },
	}, enc)
	await storeManifestParts(manifest, enc.parts.map(part => part.raw))
	await saveFileManifest(manifest)
	return { fileId, logicalPath, manifest }
}

/**
 * 注册 vault 文件并写入索引。
 * @param {string} username 用户
 * @param {string} entityHash owner
 * @param {object} manifest 文件元数据
 * @returns {Promise<object>} 索引项
 */
export async function registerVaultFile(username, entityHash, manifest) {
	if (!manifest.logicalPath) throw new Error('logicalPath required')
	const fileId = manifest.fileId || randomUUID()
	const entry = {
		fileId,
		name: manifest.name || fileId,
		mimeType: manifest.mimeType || 'application/octet-stream',
		size: Number(manifest.size) || 0,
		evfsPath: manifest.logicalPath,
		contentHash: manifest.contentHash || '',
		visibility: manifest.visibility || 'followers',
		shareId: manifest.shareId || randomUUID(),
		vaultGroupId: vaultGroupId(entityHash),
		createdAt: Date.now(),
	}
	const index = await loadVaultIndex(username, entityHash)
	index[fileId] = entry
	await saveVaultIndex(username, entityHash, index)
	return entry
}

/**
 * 按 shareId 查找 vault 文件索引项。
 * @param {string} username 用户
 * @param {string} entityHash owner
 * @param {string} shareId 分享 id
 * @returns {Promise<object | null>} 索引项或 null
 */
export async function getVaultFileByShareId(username, entityHash, shareId) {
	const index = await loadVaultIndex(username, entityHash)
	return Object.values(index).find(entry => entry.shareId === shareId) || null
}
