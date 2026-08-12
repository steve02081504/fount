/**
 * 【文件】public/src/api/groupDm.mjs
 * 【职责】用双方 Ed25519 公钥创建 DM 群（含可选 dmLink 引荐证明）。
 * 【原理】POST groups/ 建群端点，body 含 myPubKeyHex、peerPubKeyHex 与 dmIntro 签名字段。
 * 【数据结构】hex 公钥对、dmLinkProof { dmIntroNonce, dmIntroSignatureHex }。
 * 【关联】groupClient.mjs；deepLinkConsume、dmLink.mjs。
 */
import { groupFetch } from './groupClient.mjs'

/**
 * 用双方公钥创建 DM 群。
 * @param {string} myPubKeyHex 本端公钥（hex）
 * @param {string} peerPubKeyHex 对端公钥（hex）
 * @param {{ dmIntroNonce?: string, dmIntroSignatureHex?: string }} [dmLinkProof] 可选引荐签名
 * @returns {Promise<any>} 建群 API 响应
 */
export async function createDirectMessageByPubKeys(myPubKeyHex, peerPubKeyHex, dmLinkProof) {
	return groupFetch('', {
		method: 'POST',
		json: { template: 'dm', myPubKeyHex, peerPubKeyHex, ...dmLinkProof },
	})
}
