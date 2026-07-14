import { Buffer } from 'node:buffer'

import {
	commitEntityKeyRevoke,
	commitEntityKeyRotate,
} from '../../public/parts/shells/social/src/timeline/entity_key_commit.mjs'
import { sign } from 'npm:@steve02081504/fount-p2p/crypto'
import { isHex64, normalizeHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'
import { entityKeyRevokeSignBytes } from 'npm:@steve02081504/fount-p2p/federation/entity_key_chain'

import {
	commitEntityKeyRotation as persistActiveRotation,
	generateNextActiveKeyPair,
	getFederationViewForUser,
	getEntityKeyGeneration,
	getOperatorEntityHash,
} from './entity_identity.mjs'

/**
 * 主动轮换活跃实体钥并广播时间线事件（默认 operator）。
 * @param {string} username replica
 * @param {string} [entityHash] 实体；缺省 operator
 * @returns {Promise<object>} federation 视图
 */
export async function rotateEntityActiveKey(username, entityHash) {
	const hash = entityHash || await getOperatorEntityHash(username)
	const rotation = await generateNextActiveKeyPair(username, hash)
	await commitEntityKeyRotate(username, hash, rotation)
	await persistActiveRotation(username, hash, rotation)
	return getFederationViewForUser(username)
}

/**
 * 使用离线 recovery 私钥吊销被盗活跃钥并安装新钥。
 * @param {string} username replica
 * @param {object} body 请求体
 * @returns {Promise<object>} federation 视图
 */
export async function revokeEntityActiveKey(username, body) {
	const recoverySecretKeyHex = normalizeHex64(body.recoverySecretKeyHex || '')
	if (!isHex64(recoverySecretKeyHex)) throw new Error('recoverySecretKeyHex required')

	const entityHash = body.entityHash
		? String(body.entityHash).toLowerCase()
		: await getOperatorEntityHash(username)
	const currentGen = await getEntityKeyGeneration(username, entityHash)
	const rotation = await generateNextActiveKeyPair(username, entityHash)
	const revokeBody = {
		entityHash,
		revokeGenerations: Array.isArray(body.revokeGenerations)
			? body.revokeGenerations.map(g => Number(g)).filter(Number.isFinite)
			: [currentGen],
		newGeneration: rotation.keyGeneration,
		activePubKeyHex: rotation.activePubKeyHex,
	}

	const recoverySecret = new Uint8Array(Buffer.from(recoverySecretKeyHex, 'hex'))
	const signBytes = entityKeyRevokeSignBytes(revokeBody)
	const signature = await sign(signBytes, recoverySecret)
	await commitEntityKeyRevoke(username, entityHash, {
		...revokeBody,
		recoverySignature: Buffer.from(signature).toString('hex'),
	}, recoverySecret)
	await persistActiveRotation(username, entityHash, rotation)
	return getFederationViewForUser(username)
}
