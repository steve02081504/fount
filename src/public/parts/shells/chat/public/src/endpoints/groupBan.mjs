/**
 * 【文件】public/src/endpoints/groupBan.mjs
 * 【职责】按范围封禁成员：服务端原子合并 member_ban + 声誉扣减。
 * 【原理】信任本机 Hub 传入的 targetPubKeyHash / banScope；一次 POST ban，服务端返回部分成功状态。
 * 【关联】groupClient.mjs；后端 group/routes/governance.mjs。
 */
import { groupFetch, groupPath } from './groupClient.mjs'

/**
 * 按范围封禁成员（群内 DAG + 声誉 + 服务端同步 blocklist/peers）。
 * @param {string} groupId 群 ID
 * @param {string} targetPubKeyHash 目标成员 pubKeyHash
 * @param {{ banScope: 'entity'|'node' }} options 封禁范围
 * @returns {Promise<{ banned: true, reputationSlash: { ok: boolean, error?: string, alreadyBanned?: boolean, banEventId?: string } }>} 封禁结果；声誉失败时 banned 仍为 true
 */
export async function banMemberWithScope(groupId, targetPubKeyHash, options) {
	return groupFetch(groupPath(groupId, 'members', targetPubKeyHash, 'ban'), {
		method: 'POST',
		json: { banScope: options.banScope },
	})
}
