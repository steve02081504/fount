/**
 * 【文件】public/src/endpoints/groupDm.mjs
 * 【职责】用双方 Ed25519 公钥创建 DM 群（含可选 dmLink 引荐证明）。
 * 【原理】POST groups/ 建群端点，body 含 myPubKeyHex、peerPubKeyHex 与 dmIntro 签名字段；
 *   `friendBinding` / `peerNodeHash` 让服务端顺手把 DM 邀请投递给对端节点（否则对端永远不知道这个会话）。
 * 【数据结构】hex 公钥对、dmLinkProof { dmIntroNonce, dmIntroSignatureHex }、friendBinding、peerNodeHash。
 * 【关联】groupClient.mjs；deepLinkConsume、dmLink.mjs。
 */
import { groupFetch } from './groupClient.mjs'

/**
 * 用双方公钥创建 DM 群。
 * @param {string} myPubKeyHex 本端公钥（hex）
 * @param {string} peerPubKeyHex 对端公钥（hex）
 * @param {{ dmLinkProof?: { dmIntroNonce?: string, dmIntroSignatureHex?: string }, friendBinding?: { entityHash?: string, charname?: string, displayName?: string }, peerNodeHash?: string }} [options] 签名证明、对端好友绑定与对端节点身份（后两者让服务端把 DM 邀请投递给对端）
 * @returns {Promise<any>} 建群 API 响应
 */
export async function createDirectMessageByPubKeys(myPubKeyHex, peerPubKeyHex, options = {}) {
	return groupFetch('', {
		method: 'POST',
		json: {
			template: 'dm',
			myPubKeyHex,
			peerPubKeyHex,
			...options.dmLinkProof || {},
			...options.friendBinding ? { friendBinding: options.friendBinding } : {},
			...options.peerNodeHash ? { peerNodeHash: options.peerNodeHash } : {},
		},
	})
}
