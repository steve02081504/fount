/**
 * 【文件】governance/ownerSuccessionSign.mjs
 * 【职责】服务端用本机群签名种子为 owner_succession 选票联署（私钥不出进程）。
 * 【原理】resolveLocalEventSigner → ownerSuccessionBallotSignBytes → Ed25519 sign；校验 pubKey/signature hex 形态。
 * 【数据结构】ballot { proposedOwnerPubKeyHash, groupId, ballotId }；返回 { pubKeyHex, signature }。
 * 【关联】dag/localSigner、scripts/p2p/owner_succession_ballot；治理 DAG 事件验签链。
 */
import { Buffer } from 'node:buffer'

import { isHex64, isSignatureHex128 } from 'npm:@steve02081504/fount-p2p/core/hexIds'
import { publicKeyFromSeed, sign } from 'npm:@steve02081504/fount-p2p/crypto'
import { ownerSuccessionBallotSignBytes } from 'npm:@steve02081504/fount-p2p/governance/owner_succession_ballot'

import { resolveLocalEventSigner } from '../dag/localSigner.mjs'

/**
 * 用本机群签名种子为继任选票联署（服务端，私钥不出进程）。
 * @param {string} username 登录用户
 * @param {string} groupId 群 ID
 * @param {{ proposedOwnerPubKeyHash: string, groupId: string, ballotId: string }} ballot 选票正文
 * @returns {Promise<{ pubKeyHex: string, signature: string }>} 管理员签名条目
 */
export async function signOwnerSuccessionAsLocalAdmin(username, groupId, ballot) {
	const { secretKey } = await resolveLocalEventSigner(username, groupId)
	const pubKeyHex = Buffer.from(publicKeyFromSeed(secretKey)).toString('hex')
	const signatureBytes = await sign(ownerSuccessionBallotSignBytes(ballot), secretKey)
	const signature = Buffer.from(signatureBytes).toString('hex')
	if (!isHex64(pubKeyHex) || !isSignatureHex128(signature))
		throw new Error('local admin sign failed')
	return { pubKeyHex, signature }
}
