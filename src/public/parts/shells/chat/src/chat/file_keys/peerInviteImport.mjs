/**
 * 从 DAG `peer_invite.fileKeyWraps` 导入群文件主密钥历史代际。
 */
import { Buffer } from 'node:buffer'

import { publicKeyFromSeed } from 'npm:@steve02081504/fount-p2p/crypto'
import { normalizeHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'
import { resolveLocalEventSigner } from '../dag/localSigner.mjs'

import { applyFileKeyGrant } from './historicalGrant.mjs'

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {object} event 已落盘 DAG 事件
 * @returns {Promise<void>}
 */
export async function tryImportFileKeyGrantFromPeerInvite(username, groupId, event) {
	if (event?.type !== 'peer_invite') return
	const grant = event.content?.fileKeyWraps
	if (!grant || typeof grant !== 'object') return

	let signer
	try {
		signer = await resolveLocalEventSigner(username, groupId)
	}
	catch { return }

	const myEdPubHex = Buffer.from(publicKeyFromSeed(signer.secretKey)).toString('hex')
	const toHex = normalizeHex64(event.content?.to)
	if (!toHex || toHex !== normalizeHex64(myEdPubHex)) return

	await applyFileKeyGrant(username, groupId, grant)
}
