/**
 * 群文件主密钥历史代际批量授予（补拉 inner.fileKeyWraps / peer_invite）。
 */
import { Buffer } from 'node:buffer'

import { isHex64, normalizeHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'
import { unwrapKeyEcies, wrapKeyEcies } from 'npm:@steve02081504/fount-p2p/crypto/key'
import { resolveLocalEventSigner } from '../dag/localSigner.mjs'

import { flushPendingDecryptAfterFileKeyRotation } from './buffer.mjs'
import { appendFileMasterKey, loadFileMasterKeys } from './store.mjs'

/**
 * @param {string} username 本地用户
 * @param {string} groupId 群 ID
 * @param {string} recipientEdPubKeyHex 接收方 Ed25519 公钥 hex
 * @returns {Promise<{ generations: Array<{ gen: number, encryptedKey: object }> }>} grant bundle
 */
export async function buildFileKeyGrant(username, groupId, recipientEdPubKeyHex) {
	const recipient = normalizeHex64(recipientEdPubKeyHex)
	if (!recipient || Buffer.from(recipient, 'hex').length !== 32)
		throw new Error('invalid recipient Ed25519 pub key')
	const data = await loadFileMasterKeys(username, groupId)
	const generations = (data.generations || []).map(entry => ({
		gen: entry.gen,
		encryptedKey: wrapKeyEcies(entry.fileMasterKey, recipient),
	}))
	return { generations }
}

/**
 * @param {string} username 本地用户
 * @param {string} groupId 群 ID
 * @param {{ generations?: Array<{ gen?: number, encryptedKey?: object }> }} grant grant bundle
 * @returns {Promise<number>} 新导入的代数条数
 */
export async function applyFileKeyGrant(username, groupId, grant) {
	const rows = Array.isArray(grant?.generations) ? grant.generations : []
	if (!rows.length) return 0
	let signer
	try {
		signer = await resolveLocalEventSigner(username, groupId)
	}
	catch {
		return 0
	}
	let imported = 0
	let maxGen = -1
	for (const row of rows) {
		const gen = Number(row?.gen)
		const encrypted = row?.encryptedKey
		if (!Number.isFinite(gen) || gen < 0 || !encrypted) continue
		const keyHex = unwrapKeyEcies(encrypted, signer.secretKey)
		if (!keyHex || !isHex64(keyHex)) continue
		await appendFileMasterKey(username, groupId, Math.floor(gen), keyHex)
		imported++
		if (gen > maxGen) maxGen = Math.floor(gen)
	}
	if (maxGen >= 0)
		flushPendingDecryptAfterFileKeyRotation(username, groupId, maxGen)
	return imported
}
