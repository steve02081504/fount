/**
 * 【文件】public/src/api/groupBan.mjs
 * 【职责】按范围封禁成员：DAG 声誉 + 服务端 blocklist/peers 同步。
 * 【原理】校验 targetPubKeyHash 为 hex64 后调用 ban 端点，可选 postReputationSlash。
 * 【数据结构】groupId、targetPubKeyHash、scope 选项。
 * 【关联】groupClient.mjs、groupGovernance.mjs、pubKeyHex.mjs。
 */
import { isHex64 } from '../lib/pubKeyHex.mjs'

import { groupFetch, groupPath } from './groupClient.mjs'
import { postReputationSlash } from './groupGovernance.mjs'

/**
 * 按范围封禁成员（群内 DAG + 声誉 + 服务端同步 blocklist/peers）。
 * @param {string} groupId 群 ID
 * @param {string} targetPubKeyHash 目标成员 pubKeyHash
 * @param {{ banScope: 'entity'|'node' }} opts 封禁范围
 * @returns {Promise<void>}
 */
export async function banMemberWithScope(groupId, targetPubKeyHash, opts) {
	const target = String(targetPubKeyHash || '').trim().toLowerCase()
	if (!isHex64(target)) throw new Error('invalid target')
	const banScope = String(opts?.banScope || '').trim().toLowerCase()
	await groupFetch(groupPath(groupId, 'members', target, 'ban'), {
		method: 'POST',
		json: { banScope },
	})
	await postReputationSlash(groupId, { targetPubKeyHash: target, claim: 1, verified: false })
}
