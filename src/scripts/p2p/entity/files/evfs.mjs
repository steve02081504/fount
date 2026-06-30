import { Buffer } from 'node:buffer'
import { Readable } from 'node:stream'

import { FEDERATION_CHUNK_MAX_BYTES } from '../../constants.mjs'
import { buildFileManifestFromEnc } from '../../files/assemble.mjs'
import { encryptReadableToParts } from '../../files/assemble_stream.mjs'
import { fetchChunk } from '../../files/chunk_fetch.mjs'
import { getChunk, hasChunk, putChunk } from '../../files/chunk_store.mjs'
import { normalizeFileManifest, publicTransferKeyDescriptor } from '../../files/manifest.mjs'
import { assembleManifestPlaintext } from '../../files/transfer_key.mjs'
import { readDagManifestPlaintext, resolveTransferKeyDeps } from '../../files/transfer_key_registry.mjs'
import { getEntityStore } from '../../node/instance.mjs'

import { findReplicaHostingEntityFiles } from './acl.mjs'

/**
 * @param {string} ownerEntityHash owner
 * @param {string} logicalPath 路径
 * @returns {Promise<import('../../files/manifest.mjs').FileManifest | null>} 归一化 manifest
 */
export async function loadFileManifest(ownerEntityHash, logicalPath) {
	const manifest = await getEntityStore().readManifest(ownerEntityHash, logicalPath)
	return manifest ? normalizeFileManifest(manifest) : null
}

/**
 * @param {import('../../files/manifest.mjs').FileManifest} manifest manifest
 * @returns {Promise<void>}
 */
export async function saveFileManifest(manifest) {
	await getEntityStore().writeManifest(manifest.ownerEntityHash, manifest.logicalPath, manifest)
}

/**
 * @param {import('../../files/manifest.mjs').FileManifest} manifest manifest
 * @param {Array<Buffer | Uint8Array>} partBytes 密文块
 * @returns {Promise<void>}
 */
export async function storeManifestParts(manifest, partBytes) {
	for (let index = 0; index < manifest.parts.length; index++)
		await putChunk(manifest.parts[index].hash, partBytes[index])
}

/**
 * @param {string} replicaUsername replica
 * @param {import('../../files/manifest.mjs').FileManifest} manifest manifest
 * @param {{ username?: string, fetchChunk?: Function }} [opts] miss 拉取
 * @returns {Promise<Buffer | null>} 明文内容
 */
export async function readManifestPlaintext(replicaUsername, manifest, opts = {}) {
	const dagGroupId = manifest.meta?.groupId
	if (Array.isArray(manifest.meta?.dagParts) && dagGroupId) {
		const dagPlain = await readDagManifestPlaintext(replicaUsername, manifest)
		if (dagPlain) return dagPlain
	}

	const username = opts.username || replicaUsername
	/** @type {Buffer[]} */
	const partBytes = []
	for (const part of manifest.parts) {
		let ciphertextBytes = null
		if (await hasChunk(part.hash))
			ciphertextBytes = await getChunk(part.hash)
		else {
			const fetchedChunk = await (opts.fetchChunk || fetchChunk)({
				username,
				ciphertextHash: part.hash,
				ownerEntityHash: manifest.ownerEntityHash,
				groupId: manifest.transferKeyDescriptor.groupId,
			})
			if (fetchedChunk) {
				await putChunk(part.hash, fetchedChunk)
				ciphertextBytes = Buffer.from(fetchedChunk)
			}
		}
		if (!ciphertextBytes) return null
		partBytes.push(ciphertextBytes)
	}

	const rawDeps = resolveTransferKeyDeps(undefined, manifest)
	const deps = {
		getGroupFileMasterKey: rawDeps.getGroupFileMasterKey
			? (groupId, keyGeneration) => rawDeps.getGroupFileMasterKey(replicaUsername, groupId, keyGeneration)
			: undefined,
		getVaultMasterKey: rawDeps.getVaultMasterKey
			? entityHash => rawDeps.getVaultMasterKey(replicaUsername, entityHash)
			: undefined,
	}
	return assembleManifestPlaintext(manifest, partBytes, deps)
}

/**
 * @param {string} replicaUsername replica
 * @param {import('../../files/manifest.mjs').FileManifest} manifest manifest
 * @param {{ username?: string, fetchChunk?: Function }} [opts] miss 拉取
 * @returns {Promise<import('node:stream').Readable | null>} 明文流
 */
export async function readManifestPlaintextStream(replicaUsername, manifest, opts = {}) {
	const plain = await readManifestPlaintext(replicaUsername, manifest, opts)
	if (!plain) return null
	return Readable.from(plain)
}

/**
 * @param {object} params 参数
 * @param {string} params.ownerEntityHash owner
 * @param {string} params.logicalPath 路径
 * @param {Buffer | Uint8Array} params.plaintext 明文
 * @param {string} [params.name] 文件名
 * @param {string} [params.mimeType] MIME
 * @param {import('../../files/manifest.mjs').CeMode} [params.ceMode] 模式
 * @param {import('../../files/manifest.mjs').TransferKeyDescriptor} [params.transferKeyDescriptor] 传递密钥
 * @param {object} [params.meta] meta
 * @returns {Promise<import('../../files/manifest.mjs').FileManifest>} 写入后的 manifest
 */
export async function putFileManifest(params) {
	const { encryptPlaintextToParts, encryptPlaintextToMultiPartsAsync } = await import('../../files/assemble.mjs')
	const {
		ownerEntityHash,
		logicalPath,
		plaintext,
		name,
		mimeType,
		ceMode = 'convergent',
		transferKeyDescriptor,
		meta,
	} = params
	const plainBuf = Buffer.from(plaintext)
	const enc = plainBuf.length > FEDERATION_CHUNK_MAX_BYTES
		? await encryptPlaintextToMultiPartsAsync(plainBuf, ceMode)
		: encryptPlaintextToParts(plainBuf, ceMode)
	const manifest = buildFileManifestFromEnc({
		ownerEntityHash,
		logicalPath,
		plaintext: plainBuf,
		name,
		mimeType,
		ceMode,
		transferKeyDescriptor: transferKeyDescriptor || publicTransferKeyDescriptor(ceMode),
		meta,
	}, enc)
	await storeManifestParts(manifest, enc.parts.map(part => part.raw))
	await saveFileManifest(manifest)
	return manifest
}

/**
 * 流式写入文件（请求流 -> 加密分块 -> chunk store）。
 * @param {object} params 参数
 * @param {string} params.ownerEntityHash owner
 * @param {string} params.logicalPath 路径
 * @param {import('node:stream').Readable} params.readable 明文流
 * @param {number} params.plainSize 明文字节数
 * @param {string} [params.name] 文件名
 * @param {string} [params.mimeType] MIME
 * @param {import('../../files/manifest.mjs').CeMode} [params.ceMode] 模式
 * @param {import('../../files/manifest.mjs').TransferKeyDescriptor} [params.transferKeyDescriptor] 传递密钥
 * @param {object} [params.meta] meta
 * @returns {Promise<import('../../files/manifest.mjs').FileManifest>} 写入后的 manifest
 */
export async function putFileManifestFromStream(params) {
	const {
		ownerEntityHash,
		logicalPath,
		readable,
		plainSize,
		name,
		mimeType,
		ceMode = 'convergent',
		transferKeyDescriptor,
		meta,
	} = params
	const enc = await encryptReadableToParts(readable, ceMode, async part =>
		putChunk(part.hash, part.raw), plainSize)
	const manifest = normalizeFileManifest({
		ownerEntityHash: ownerEntityHash.toLowerCase(),
		logicalPath: logicalPath.replace(/^\/+/, ''),
		name: name || logicalPath.split('/').pop() || 'file',
		mimeType: mimeType || 'application/octet-stream',
		size: plainSize,
		contentHash: enc.contentHash,
		ceMode,
		parts: enc.parts,
		transferKeyDescriptor: transferKeyDescriptor || publicTransferKeyDescriptor(ceMode),
		meta,
	})
	if (!manifest) throw new Error('invalid manifest')
	await saveFileManifest(manifest)
	return manifest
}

/** 转出 ACL 侧的实体文件托管查询，便于按 evfs 入口统一引用。 */
export { findReplicaHostingEntityFiles }
