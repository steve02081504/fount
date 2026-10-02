import { isWritableLocalEntity } from 'npm:@steve02081504/fount-p2p/node/identity'

import { parts_set } from '../../../../../../server/parts_loader.mjs'

import { resolveAgentCharPartName } from './member.mjs'
import { computeEffectiveStatus } from './presenceStatus.mjs'

/**
 * 已加载本机角色不依赖浏览器心跳；可通过 chat.GetStatus 自行管理状态。
 * 只读取加载完成的实例，查询资料不会加载角色或等待正在执行的 Load。
 * @param {object} profile 实体资料
 * @param {string} replicaUsername 副本用户名
 * @param {string} [viewerEntityHash] 查看者实体
 * @param {{ isSelf?: boolean }} [options] 查看选项
 * @returns {Promise<string>} 对外可见状态
 */
export async function getEffectiveStatus(profile, replicaUsername, viewerEntityHash, options = {}) {
	let agentStatus
	if (replicaUsername && isWritableLocalEntity(profile.entityHash)) {
		const charPartName = resolveAgentCharPartName(replicaUsername, profile.entityHash)
		const part = charPartName && parts_set[replicaUsername]?.[`chars/${charPartName}`]
		if (part && !(part instanceof Promise))
			agentStatus = part.chat?.GetStatus
				? await part.chat.GetStatus({ username: replicaUsername, entityHash: profile.entityHash })
				: profile.status && profile.status !== 'offline' ? profile.status : 'online'
	}
	return computeEffectiveStatus(profile, viewerEntityHash, { ...options, agentStatus })
}
