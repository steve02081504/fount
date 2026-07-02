import { Buffer } from 'node:buffer'

import { sign } from '../../scripts/p2p/crypto.mjs'
import { isHex64, normalizeHex64 } from '../../scripts/p2p/hexIds.mjs'
import { operatorKeyRevokeSignBytes } from '../../scripts/p2p/operator_key_chain.mjs'
import {
	commitOperatorKeyRevoke,
	commitOperatorKeyRotate,
} from '../../scripts/p2p/timeline/operator_key_commit.mjs'

import {
	commitActiveKeyRotation as persistActiveRotation,
	generateNextActiveKeyPair,
	getFederationViewForUser,
	getOperatorEntityHash,
	getOperatorKeyGeneration,
} from './operator_identity.mjs'

/**
 * 主动轮换活跃 operator 钥并广播时间线事件。
 * @param {string} username replica
 * @returns {Promise<object>} federation 视图
 */
export async function rotateOperatorActiveKey(username) {
	const entityHash = await getOperatorEntityHash(username)
	const rotation = await generateNextActiveKeyPair(username)
	await commitOperatorKeyRotate(username, entityHash, rotation)
	await persistActiveRotation(username, rotation)
	return getFederationViewForUser(username)
}

/**
 * 使用离线 recovery 私钥吊销被盗活跃钥并安装新钥。
 * @param {string} username replica
 * @param {object} body 请求体
 * @returns {Promise<object>} federation 视图
 */
export async function revokeOperatorActiveKey(username, body) {
	const recoverySecretKeyHex = normalizeHex64(body.recoverySecretKeyHex || '')
	if (!isHex64(recoverySecretKeyHex)) throw new Error('recoverySecretKeyHex required')

	const entityHash = await getOperatorEntityHash(username)
	const currentGen = await getOperatorKeyGeneration(username)
	const rotation = await generateNextActiveKeyPair(username)
	const revokeBody = {
		entityHash,
		revokeGenerations: Array.isArray(body.revokeGenerations)
			? body.revokeGenerations.map(g => Number(g)).filter(Number.isFinite)
			: [currentGen],
		newGeneration: rotation.keyGeneration,
		activePubKeyHex: rotation.activePubKeyHex,
	}

	const recoverySecret = new Uint8Array(Buffer.from(recoverySecretKeyHex, 'hex'))
	const signBytes = operatorKeyRevokeSignBytes(revokeBody)
	const signature = await sign(signBytes, recoverySecret)
	await commitOperatorKeyRevoke(username, entityHash, {
		...revokeBody,
		recoverySignature: Buffer.from(signature).toString('hex'),
	}, recoverySecret)
	await persistActiveRotation(username, rotation)
	return getFederationViewForUser(username)
}
