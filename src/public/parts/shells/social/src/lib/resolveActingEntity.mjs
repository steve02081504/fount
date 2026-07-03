import { resolveOperatorEntityHashForUser as resolveOperatorEntityHash } from '../../../../../../server/p2p_server/operator_identity.mjs'

import { resolveSocialEntity } from './entityResolve.mjs'

/**
 * 解析写操作 acting 实体（operator 或本地 agent）。
 * @param {string} username replica 登录名
 * @param {string | undefined | null} requestedActor 请求体/查询中的 actingEntityHash
 * @param {{ requireEntity?: boolean, invalidMessage?: string, missingMessage?: string }} [options] 校验选项
 * @returns {Promise<{ actingEntity?: string, operator?: string | null, error?: string, status?: number }>} 解析结果或错误
 */
export async function resolveActingEntity(username, requestedActor, options = {}) {
	const operator = await resolveOperatorEntityHash(username)
	let actingEntity = operator
	const requested = String(requestedActor || '').trim().toLowerCase()
	if (requested) {
		const resolved = await resolveSocialEntity(requested, username)
		if (!resolved?.local || resolved.replicaUsername !== username)
			return {
				error: options.invalidMessage || 'invalid actingEntityHash',
				status: 403,
			}
		actingEntity = resolved.entityHash
	}
	if (!actingEntity && options.requireEntity !== false)
		return {
			error: options.missingMessage || 'configure federation identity first',
			status: 403,
		}
	return { actingEntity, operator }
}
