import { Buffer } from 'node:buffer'
import { randomUUID, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'

import { isHex64, normalizeHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'
import {
	deriveSocialPostKey,
	generateFileMasterKey,
	wrapKeyEcies,
	unwrapKeyEcies,
} from 'npm:@steve02081504/fount-p2p/crypto/key'

import { vaultGroupId } from '../federation/namespace.mjs'
import {
	normalizeVisibilitySpec,
	visibilitySpecToContentFields,
} from '../lib/visibilitySpec.mjs'
import { vaultStatePath } from '../paths.mjs'

/** @type {'gsh'} followers 帖文 content 加密 scheme */
const GSH_SCHEME = 'gsh'
/** @type {'pkw'} 按接收者包裹帖钥 scheme */
const PKW_SCHEME = 'pkw'

/**
 * 读取或初始化 vault 主密钥状态。
 * @param {string} username 用户
 * @param {string} entityHash owner
 * @returns {Promise<{ masterKey: string, generation: number }>} vault 主密钥状态
 */
export async function loadVaultMasterKey(username, entityHash) {
	try {
		const raw = JSON.parse(await readFile(vaultStatePath(username, entityHash), 'utf8'))
		return {
			masterKey: String(raw.masterKey || ''),
			generation: Number(raw.generation) || 0,
		}
	}
	catch {
		const state = { masterKey: generateFileMasterKey(), generation: 0 }
		await saveVaultMasterKey(username, entityHash, state)
		return state
	}
}

/**
 * 持久化 vault 主密钥状态。
 * @param {string} username 用户
 * @param {string} entityHash owner
 * @param {{ masterKey: string, generation: number }} state vault 状态
 * @returns {Promise<void>}
 */
export async function saveVaultMasterKey(username, entityHash, state) {
	await mkdir(`${vaultStatePath(username, entityHash).replace(/[/\\][^/\\]+$/, '')}`, { recursive: true })
	await writeFile(vaultStatePath(username, entityHash), JSON.stringify({
		masterKey: state.masterKey,
		generation: state.generation,
	}, null, '\t'), 'utf8')
}

/**
 * 使用 AES-GCM 加密 UTF-8 明文。
 * @param {string} plaintext UTF-8 明文
 * @param {Buffer} key AES key
 * @returns {{ iv: string, ciphertext: string, authTag: string }} AES-GCM 密文信封
 */
function encryptAesGcm(plaintext, key) {
	const iv = randomBytes(12)
	const cipher = createCipheriv('aes-256-gcm', key, iv)
	const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
	return {
		iv: iv.toString('base64'),
		ciphertext: ciphertext.toString('base64'),
		authTag: cipher.getAuthTag().toString('base64'),
	}
}

/**
 * 使用 AES-GCM 解密密文信封。
 * @param {object} envelope 密文信封
 * @param {Buffer} key AES key
 * @returns {string} 明文
 */
function decryptAesGcm(envelope, key) {
	const iv = Buffer.from(envelope.iv, 'base64')
	const decipher = createDecipheriv('aes-256-gcm', key, iv)
	decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64'))
	return Buffer.concat([
		decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
		decipher.final(),
	]).toString('utf8')
}

/**
 * 解析实体活跃公钥（本地 identity → profile.json）。
 * @param {string} username replica
 * @param {string} entityHash 实体
 * @returns {Promise<string | null>} 64 hex pubKey
 */
async function resolveEntityPubKeyHex(username, entityHash) {
	const hash = String(entityHash).toLowerCase()
	try {
		const { getEntityActivePubKey } = await import('../../../chat/src/entity/identity.mjs')
		const pub = await getEntityActivePubKey(username, hash)
		if (isHex64(normalizeHex64(pub))) return normalizeHex64(pub)
	}
	catch { /* 非本机实体 */ }
	try {
		const { createFsEntityStore } = await import('npm:@steve02081504/fount-p2p/node/entity_store')
		const { entitiesRoot } = await import('../../../chat/src/entity/store.mjs')
		const profile = await createFsEntityStore(entitiesRoot(username)).readEntityJson(hash, 'profile.json')
		const pub = normalizeHex64(profile?.activePubKeyHex || '')
		if (isHex64(pub)) return pub
	}
	catch { /* 无缓存 profile */ }
	return null
}

/**
 * 对受限可见帖加密 content。
 * @param {string} username 用户
 * @param {string} entityHash owner
 * @param {string} postKeyId 帖子密钥 id（client 生成 UUID，独立于 event.id）
 * @param {object} content 明文 content
 * @param {object | string} visibilityOrSpec public|followers|… 或 spec
 * @returns {Promise<object>} 加密后的 content 或原文
 */
export async function maybeEncryptPostContent(username, entityHash, postKeyId, content, visibilityOrSpec) {
	const spec = normalizeVisibilitySpec(
		typeof visibilityOrSpec === 'string'
			? { ...visibilitySpecToContentFields(normalizeVisibilitySpec(visibilityOrSpec)), ...content }
			: { ...content, ...normalizeVisibilitySpec(visibilityOrSpec) },
	)
	const visibility = spec.visibility

	if (visibility === 'public' || visibility === 'unlisted')
		return { ...content, ...visibilitySpecToContentFields(spec) }

	const plainPayload = { ...content, ...visibilitySpecToContentFields(spec) }
	const outerMeta = {
		...visibilitySpecToContentFields(spec),
		...Array.isArray(content.mediaRefs) && content.mediaRefs.length ? { hasMedia: true } : {},
	}

	if (visibility === 'followers' || visibility === 'followers_since') {
		const { masterKey } = await loadVaultMasterKey(username, entityHash)
		const key = deriveSocialPostKey(masterKey, postKeyId)
		const encrypted = encryptAesGcm(JSON.stringify(plainPayload), key)
		return {
			scheme: GSH_SCHEME,
			postKeyId,
			generation: 0,
			...outerMeta,
			...encrypted,
		}
	}

	if (visibility === 'selected' || visibility === 'private') {
		const postKeyHex = generateFileMasterKey()
		const postKey = Buffer.from(postKeyHex, 'hex')
		const encrypted = encryptAesGcm(JSON.stringify(plainPayload), postKey)
		/** @type {Record<string, object>} */
		const wraps = {}
		const recipients = new Set(spec.allow || [])
		recipients.add(String(entityHash).toLowerCase())
		for (const recipient of recipients) {
			const pub = await resolveEntityPubKeyHex(username, recipient)
			if (!pub) {
				if (recipient === String(entityHash).toLowerCase())
					throw new Error(`cannot resolve author pubkey for pkw: ${recipient}`)
				continue
			}
			wraps[pub] = wrapKeyEcies(postKeyHex, pub)
		}
		if (!Object.keys(wraps).length)
			throw new Error('pkw encryption produced no wraps')
		return {
			scheme: PKW_SCHEME,
			...outerMeta,
			wraps,
			...encrypted,
		}
	}

	return plainPayload
}

/**
 * 尝试用本地实体私钥解 pkw wraps。
 * @param {string} username replica
 * @param {string} entityHash 尝试者
 * @param {Record<string, object>} wraps wraps
 * @returns {Promise<string | null>} postKeyHex
 */
async function tryUnwrapPkw(username, entityHash, wraps) {
	if (!entityHash || !wraps) return null
	try {
		const { getEntitySecretKey, getEntityActivePubKey } = await import('../../../chat/src/entity/identity.mjs')
		const pub = normalizeHex64(await getEntityActivePubKey(username, entityHash))
		const wrapped = wraps[pub]
		if (!wrapped) return null
		const secretHex = await getEntitySecretKey(username, entityHash)
		if (!secretHex || secretHex.length !== 64) return null
		const keyHex = unwrapKeyEcies(wrapped, new Uint8Array(Buffer.from(secretHex, 'hex')))
		return isHex64(normalizeHex64(keyHex || '')) ? normalizeHex64(keyHex) : null
	}
	catch {
		return null
	}
}

/**
 * 解密 vault 加密帖 content；失败返回 null。
 * @param {string} username 用户
 * @param {string} entityHash owner
 * @param {object} content 事件 content
 * @param {string | null} [viewerEntityHash] 观看者（pkw 解包用；缺省尝试 owner）
 * @returns {object | null} 解密后 content；无法解密返回 null
 */
export async function maybeDecryptPostContent(username, entityHash, content, viewerEntityHash = null) {
	if (!content) return null
	if (content.scheme !== GSH_SCHEME && content.scheme !== PKW_SCHEME) return content

	if (content.scheme === GSH_SCHEME) {
		const { masterKey } = await loadVaultMasterKey(username, entityHash)
		const key = deriveSocialPostKey(masterKey, content.postKeyId)
		try {
			return JSON.parse(decryptAesGcm(content, key))
		}
		catch {
			return null
		}
	}

	const candidates = [
		viewerEntityHash && String(viewerEntityHash).toLowerCase(),
		String(entityHash).toLowerCase(),
	].filter(Boolean)
	const seen = new Set()
	for (const candidate of candidates) {
		if (seen.has(candidate)) continue
		seen.add(candidate)
		const postKeyHex = await tryUnwrapPkw(username, candidate, content.wraps)
		if (!postKeyHex) continue
		try {
			return JSON.parse(decryptAesGcm(content, Buffer.from(postKeyHex, 'hex')))
		}
		catch { /* try next */ }
	}
	return null
}

/**
 * 构建 follow_approve 事件的 vault 载荷片段。
 * @param {string} username owner 用户
 * @param {string} entityHash owner
 * @param {string} followerPubKeyHex 关注者公钥
 * @returns {Promise<object>} follow_approve 载荷片段
 */
export async function buildFollowApprovePayload(username, entityHash, followerPubKeyHex) {
	const { masterKey } = await loadVaultMasterKey(username, entityHash)
	return {
		targetPubKeyHex: followerPubKeyHex,
		encrypted_H: wrapKeyEcies(masterKey, followerPubKeyHex),
		vaultGroupId: vaultGroupId(entityHash),
	}
}

/**
 * 生成新的 vault 文件 UUID。
 * @returns {string} 新 fileId
 */
export function newVaultFileId() {
	return randomUUID()
}
