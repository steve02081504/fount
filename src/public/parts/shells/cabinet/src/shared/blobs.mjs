import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'

import { wrapContentKey } from 'npm:@steve02081504/fount-p2p/crypto/key'
import { buildFileManifestFromEnc, encryptPlaintextToParts } from 'npm:@steve02081504/fount-p2p/files/assemble'
import { getChunk, hasChunk, putChunk } from 'npm:@steve02081504/fount-p2p/files/chunk_store'
import { loadFileManifest, readManifestPlaintext, saveFileManifest, storeManifestParts } from 'npm:@steve02081504/fount-p2p/files/evfs'

import { evfsSharedBlobPath } from '../paths.mjs'

import { sharedCabinetEntityHash } from './entity.mjs'
import { loadSharedKeys, readKeyForGen } from './keys.mjs'

/**
 * 写入共享柜密文块并用读密钥 wrap contentKey。
 * 使用 file-master-key-wrap 形状（groupId=cabinetId），由 cabinet transfer owner 解析。
 * @param {string} username 用户
 * @param {string} cabinetId 柜
 * @param {{ plaintext: Buffer | Uint8Array, name?: string, mime_type?: string, entry_id?: string }} options 选项
 * @returns {Promise<{ evfs_path: string, size: number, contentHash: string, parts: object[], key_generation: number, wrappedKey: object }>} 结果
 */
export async function putSharedCabinetBlob(username, cabinetId, options) {
	void username
	const keys = await loadSharedKeys(username, cabinetId)
	if (!keys) throw new Error('shared cabinet keys missing')
	const readKey = readKeyForGen(keys)
	if (!readKey) throw new Error('read key missing')
	const plaintext = Buffer.from(options.plaintext)
	const entryId = String(options.entry_id || randomUUID())
	const logicalPath = evfsSharedBlobPath(cabinetId, entryId)
	const ownerEntityHash = sharedCabinetEntityHash(cabinetId)
	const enc = encryptPlaintextToParts(plaintext, 'random')
	const wrappedKey = wrapContentKey(enc.contentKey, Buffer.from(readKey, 'hex'), entryId)
	const manifest = buildFileManifestFromEnc({
		ownerEntityHash,
		logicalPath,
		plaintext,
		name: options.name || entryId,
		mimeType: options.mime_type || 'application/octet-stream',
		ceMode: 'random',
		transferKeyDescriptor: {
			type: 'file-master-key-wrap',
			groupId: cabinetId,
			fileId: entryId,
			keyGeneration: keys.current_gen,
			wrappedKey,
		},
		meta: {
			cabinetId,
			fileId: entryId,
			sharedCabinet: true,
		},
	}, enc)
	await storeManifestParts(manifest, enc.parts.map(part => part.raw))
	await saveFileManifest(manifest)
	return {
		evfs_path: logicalPath,
		size: plaintext.length,
		contentHash: manifest.contentHash,
		parts: manifest.parts,
		key_generation: keys.current_gen,
		wrappedKey,
	}
}

/**
 * @param {string} username 用户
 * @param {string} cabinetId 柜
 * @param {string} logicalPath EVFS 路径
 * @returns {Promise<Buffer>} 明文
 */
export async function getSharedCabinetBlob(username, cabinetId, logicalPath) {
	const manifest = await loadFileManifest(sharedCabinetEntityHash(cabinetId), logicalPath)
	if (!manifest) throw new Error('blob missing')
	const plain = await readManifestPlaintext(username, manifest)
	if (!plain) throw new Error('decrypt failed')
	return Buffer.from(plain)
}

/**
 * 尽力删除共享柜 blob 的 manifest（chunk_store 无 refcount，块可残留）。
 * @param {string} cabinetId 柜
 * @param {string} logicalPath 路径
 * @returns {Promise<void>}
 */
export async function tryDeleteSharedBlob(cabinetId, logicalPath) {
	try {
		const { deleteEvfsManifest } = await import('../blobGc.mjs')
		await deleteEvfsManifest(sharedCabinetEntityHash(cabinetId), logicalPath)
	}
	catch { /* ignore */ }
}

/**
 * 确保 chunk 在本地（拉取失败则抛）。
 * @param {string} hash 密文 hash
 * @returns {Promise<Buffer>} 块
 */
export async function ensureChunk(hash) {
	if (await hasChunk(hash)) return getChunk(hash)
	const { fetchChunk } = await import('npm:@steve02081504/fount-p2p/files/chunk_fetch')
	const bytes = await fetchChunk(hash)
	await putChunk(hash, bytes)
	return bytes
}
