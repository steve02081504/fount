/**
 * 【文件】dm/linkValidate.mjs
 * 【职责】§16 DM Link 入站完整校验：签名、介绍方成员解析、本节点 nonce 是否仍有效。
 * 【原理】verifyDmLinkSignature → findMemberIdByPubKeyHex → dmIntroNonceMatches；联邦 identity 公钥兜底比对。通过后才允许 performMemberJoin / First Contact。
 * 【数据结构】validateDmIntroLinkProof 返回 { ok, error? }；state.members 按 pubKeyHex 索引。
 * 【关联】dm/linkVerify、dm/intro、lib/dmLinkSignature、dm/index；Trystero 房间 dm:{sessionTag}。
 */
import { HEX_ID_64 as PUB_KEY_HEX_64, normalizeHex64 as normalizePubKeyHex } from 'npm:@steve02081504/fount-p2p/core/hexIds'

import { dmIntroNonceMatches } from './intro.mjs'
import { verifyDmLinkSignature } from './linkVerify.mjs'

/**
 * 在物化成员表中按公钥 hex 查找成员 id（通常为 username）。
 * @param {object} state 群物化状态
 * @param {string} pubKeyHex 64 hex
 * @returns {string | null} 成员 id
 */
export function findMemberIdByPubKeyHex(state, pubKeyHex) {
	const want = normalizePubKeyHex(pubKeyHex)
	if (!PUB_KEY_HEX_64.test(want)) return null
	for (const [memberId, row] of Object.entries(state.members))
		if (normalizePubKeyHex(row?.pubKeyHex) === want) return memberId

	return null
}

/**
 * 校验 DM Link 证明（签名 + 介绍方节点当前 nonce）。
 * @param {string} nodeUsername 本节点操作用户（读 shellData）
 * @param {object} state 群物化状态（解析介绍方成员 id）
 * @param {string} introPubKeyHex 链接中的介绍者公钥 hex
 * @param {string} nonceBase64Url nonce
 * @param {string} introSignatureHex 签名 hex
 * @returns {Promise<{ ok: boolean, error?: string }>} 校验结果
 */
export async function validateDmIntroLinkProof(nodeUsername, state, introPubKeyHex, nonceBase64Url, introSignatureHex) {
	const introPk = normalizePubKeyHex(introPubKeyHex)
	const nonce = String(nonceBase64Url || '').trim()
	const signatureHex = String(introSignatureHex || '').trim().replace(/^0x/iu, '')
	if (!PUB_KEY_HEX_64.test(introPk))
		return { ok: false, error: 'invalid intro pubKeyHex' }
	if (nonce.length < 16)
		return { ok: false, error: 'invalid dmIntro nonce' }
	if (!/^[\da-f]{128}$/iu.test(signatureHex))
		return { ok: false, error: 'invalid dmIntro signature' }
	if (!await verifyDmLinkSignature(introPk, nonce, signatureHex))
		return { ok: false, error: 'invalid dm intro link signature' }

	const introMemberId = findMemberIdByPubKeyHex(state, introPk)
	if (introMemberId && !dmIntroNonceMatches(introMemberId, nonce))
		return { ok: false, error: 'dm intro link nonce expired or rotated' }

	const { getFederationViewForUser } = await import('../../../../../../../server/p2p_server/entity_identity.mjs')
	const fed = await getFederationViewForUser(nodeUsername)
	if (normalizePubKeyHex(fed.activePubKeyHex) === introPk && !dmIntroNonceMatches(nodeUsername, nonce))
		return { ok: false, error: 'dm intro link nonce expired or rotated' }

	return { ok: true }
}
