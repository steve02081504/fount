import { httpError } from '../../../../../../scripts/http_error.mjs'
import { resolveOperatorEntityHashForUser as resolveOperatorEntityHash } from '../../../../../../server/p2p_server/operator_identity.mjs'
import { resolveSocialEntity } from '../federation/hosting.mjs'

/**
 * 解析写操作 acting 实体（operator 或本地 agent）；无法解析时 throw httpError。
 * @param {string} username replica 登录名
 * @param {string | undefined | null} requestedActor 请求体/查询中的 actingEntityHash
 * @param {{ requireEntity?: boolean, invalidMessage?: string, missingMessage?: string }} [options] 校验选项
 * @returns {Promise<string | null>} acting entityHash；requireEntity 为 false 且无身份时为 null
 */
export async function resolveActingEntity(username, requestedActor, options = {}) {
	const operator = await resolveOperatorEntityHash(username)
	let actingEntity = operator
	const requested = String(requestedActor || '').trim().toLowerCase()
	if (requested) {
		const resolved = await resolveSocialEntity(requested, username)
		if (!resolved?.local || resolved.replicaUsername !== username)
			throw httpError(403, options.invalidMessage || 'invalid actingEntityHash')
		actingEntity = resolved.entityHash
	}
	if (!actingEntity && options.requireEntity !== false)
		throw httpError(403, options.missingMessage || 'configure federation identity first')
	return actingEntity
}
