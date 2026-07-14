import { Buffer } from 'node:buffer'

import { normalizeHex64, isHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'
import { publicKeyFromSeed } from 'npm:@steve02081504/fount-p2p/crypto'
import { unwrapKeyEcies } from 'npm:@steve02081504/fount-p2p/crypto/key'
import { isPlainObject } from 'npm:@steve02081504/fount-p2p/wire/ingress'

import { getOperatorSecretKey } from '../../../../../../server/p2p_server/entity_identity.mjs'

import { saveVaultMasterKey } from './vault.mjs'

/**
 * 从 follow_approve 事件导入 vault 主密钥（关注者侧解密）。
 * @param {string} username 本地用户
 * @param {string} entityHash 时间线 owner
 * @param {object} event 签名事件
 * @returns {Promise<boolean>} 是否成功导入
 */
export async function tryImportFollowApproveVault(username, entityHash, event) {
	if (event?.type !== 'follow_approve') return false
	const encrypted = event.content?.encrypted_H
	const targetPubKeyHex = normalizeHex64(event.content?.targetPubKeyHex)
	if (!isPlainObject(encrypted) || !targetPubKeyHex) return false

	const secretHex = await getOperatorSecretKey(username)
	if (!secretHex || secretHex.length !== 64) return false
	const secretKey = new Uint8Array(Buffer.from(secretHex, 'hex'))

	const myPubHex = normalizeHex64(Buffer.from(publicKeyFromSeed(secretKey)).toString('hex'))
	if (myPubHex !== targetPubKeyHex) return false

	const masterKeyHex = unwrapKeyEcies(encrypted, secretKey)
	if (!masterKeyHex || !isHex64(masterKeyHex)) return false

	const generation = Number(event.content?.generation)
	if (!Number.isFinite(generation) || generation < 0) return false

	await saveVaultMasterKey(username, entityHash, {
		masterKey: masterKeyHex,
		generation: Math.floor(generation),
	})
	return true
}

/**
 * 扫描时间线中全部 follow_approve 并尝试导入 vault。
 * @param {string} username 本地用户
 * @param {string} entityHash 时间线 owner
 * @param {object[]} [events] 可选事件列表
 * @returns {Promise<number>} 成功导入次数
 */
export async function reprocessFollowApproveVaults(username, entityHash, events) {
	const rows = events || await import('../timeline/append.mjs').then(m => m.readTimelineEvents(username, entityHash))
	let imported = 0
	for (const event of rows)
		if (await tryImportFollowApproveVault(username, entityHash, event))
			imported++
	return imported
}
