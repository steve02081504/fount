/**
 * 联邦补拉 PullAttestation 签名与成员资格校验。
 */
import { Buffer } from 'node:buffer'

import { publicKeyFromSeed, sign, verify } from 'npm:@steve02081504/fount-p2p/crypto'
import { isHex64, normalizeHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'
import { resolveLocalEventSigner } from '../dag/localSigner.mjs'

/** @typedef {import('npm:@steve02081504/fount-p2p/schemas/federation_pull').PullAttestation} PullAttestation */

const ATTESTATION_MAX_SKEW_MS = 5 * 60 * 1000
const PULL_MEMBER_STATUSES = new Set(['active', 'left', 'kicked'])

/**
 * @param {PullAttestation} attestation 待签名体（无 signature）
 * @returns {Buffer} canonical 签名输入
 */
export function pullAttestationSignBytes(attestation) {
	const wantPart = Array.isArray(attestation.wantIds) && attestation.wantIds.length
		? [...attestation.wantIds].sort().join(',')
		: ''
	return Buffer.from(JSON.stringify({
		requesterPubKeyHash: normalizeHex64(attestation.requesterPubKeyHash),
		groupId: String(attestation.groupId || '').trim(),
		requestId: String(attestation.requestId || '').trim(),
		timestamp: Math.floor(Number(attestation.timestamp)),
		wantIds: wantPart,
	}), 'utf8')
}

/**
 * @param {string} username 本地用户
 * @param {string} groupId 群 ID
 * @param {{ requestId?: string, wantIds?: string[], timestamp?: number }} [fields] 附加字段
 * @returns {Promise<PullAttestation>} 含 signature 的 attestation
 */
export async function signPullAttestation(username, groupId, fields = {}) {
	const { sender, secretKey } = await resolveLocalEventSigner(username, groupId)
	const timestamp = Number.isFinite(Number(fields.timestamp)) ? Math.floor(Number(fields.timestamp)) : Date.now()
	/** @type {PullAttestation} */
	const body = {
		requesterPubKeyHash: sender,
		groupId,
		requestId: String(fields.requestId || '').trim(),
		timestamp,
		wantIds: fields.wantIds,
		signature: '',
	}
	const signature = await sign(pullAttestationSignBytes(body), secretKey)
	body.signature = Buffer.from(signature).toString('hex')
	return body
}

/**
 * @param {PullAttestation} attestation 待验签 attestation
 * @param {string} expectedGroupId 期望群 ID
 * @param {Uint8Array | Buffer} requesterEdPubKey 请求方 Ed25519 公钥（32 字节）
 * @returns {Promise<boolean>} 签名与时间窗是否有效
 */
export async function verifyPullAttestation(attestation, expectedGroupId, requesterEdPubKey) {
	if (!attestation?.signature) return false
	if (attestation.groupId !== expectedGroupId) return false
	const ts = Number(attestation.timestamp)
	if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > ATTESTATION_MAX_SKEW_MS) return false
	try {
		const sig = Buffer.from(attestation.signature, 'hex')
		if (sig.length !== 64) return false
		return await verify(sig, pullAttestationSignBytes(attestation), requesterEdPubKey)
	}
	catch {
		return false
	}
}

/**
 * @param {object | null | undefined} state 物化群状态
 * @param {string} requesterPubKeyHash 请求方 pubKeyHash
 * @returns {boolean} 是否允许拉取历史（能解策略）
 */
export function isHistoricalPullMember(state, requesterPubKeyHash) {
	const key = normalizeHex64(requesterPubKeyHash)
	if (!isHex64(key)) return false
	return PULL_MEMBER_STATUSES.has(state?.members?.[key]?.status)
}

/**
 * @param {object | null | undefined} state 物化群状态
 * @param {string} requesterPubKeyHash 请求方 pubKeyHash
 * @returns {string | null} 成员 Ed25519 公钥 hex
 */
export function resolveMemberEdPubKeyHex(state, requesterPubKeyHash) {
	const key = normalizeHex64(requesterPubKeyHash)
	if (!isHex64(key)) return null
	const hex = normalizeHex64(state?.members?.[key]?.pubKeyHex)
	if (!hex || Buffer.from(hex, 'hex').length !== 32) return null
	return hex
}

/**
 * @param {object | null | undefined} state 物化群状态
 * @param {string} groupId 群 ID
 * @param {import('npm:@steve02081504/fount-p2p/schemas/federation_pull').PullAttestation} attestation attestation
 * @returns {Promise<boolean>} 是否通过成员资格与签名校验
 */
export async function validatePullAttestationForGroup(state, groupId, attestation) {
	if (!isHistoricalPullMember(state, attestation.requesterPubKeyHash)) return false
	const edHex = resolveMemberEdPubKeyHex(state, attestation.requesterPubKeyHash)
	if (!edHex) return false
	return verifyPullAttestation(attestation, groupId, Buffer.from(edHex, 'hex'))
}

/**
 * 仅校验 attestation 签名（不要求 active）；被 ban 成员仍可证明身份以接收 fed_shun。
 * @param {object | null | undefined} state 物化群状态
 * @param {string} groupId 群 ID
 * @param {import('npm:@steve02081504/fount-p2p/schemas/federation_pull').PullAttestation} attestation attestation
 * @returns {Promise<boolean>} 签名是否有效
 */
export async function verifyPullAttestationSignatureForMember(state, groupId, attestation) {
	const edHex = resolveMemberEdPubKeyHex(state, attestation?.requesterPubKeyHash)
	if (!edHex) return false
	return verifyPullAttestation(attestation, groupId, Buffer.from(edHex, 'hex'))
}

/**
 * 仅 active 成员可拉取/提供冷归档明文（fed_archive_month）。
 * @param {object | null | undefined} state 物化群状态
 * @param {string} requesterPubKeyHash 请求方 pubKeyHash
 * @returns {boolean} 是否为 active 成员
 */
export function isActivePullMember(state, requesterPubKeyHash) {
	const key = normalizeHex64(requesterPubKeyHash)
	if (!isHex64(key)) return false
	return state?.members?.[key]?.status === 'active'
}

/**
 * @param {object | null | undefined} state 物化群状态
 * @param {string} groupId 群 ID
 * @param {import('npm:@steve02081504/fount-p2p/schemas/federation_pull').PullAttestation} attestation attestation
 * @returns {Promise<boolean>} active 成员 + 签名校验
 */
export async function validateActivePullAttestationForGroup(state, groupId, attestation) {
	if (!isActivePullMember(state, attestation?.requesterPubKeyHash)) return false
	const edHex = resolveMemberEdPubKeyHex(state, attestation.requesterPubKeyHash)
	if (!edHex) return false
	return verifyPullAttestation(attestation, groupId, Buffer.from(edHex, 'hex'))
}

/**
 * @param {string} username 本地用户
 * @param {string} groupId 群 ID
 * @returns {Promise<string | null>} 本机成员 Ed25519 公钥 hex
 */
export async function localMemberEdPubKeyHex(username, groupId) {
	try {
		const { secretKey } = await resolveLocalEventSigner(username, groupId)
		return Buffer.from(publicKeyFromSeed(secretKey)).toString('hex')
	}
	catch {
		return null
	}
}
