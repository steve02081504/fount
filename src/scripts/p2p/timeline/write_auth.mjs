/**
 * Social 时间线写入授权（联邦入站 untrusted 边界）。
 */
import { resolveSocialEntity } from '../entity/hosting.mjs'
import { parseEntityHash } from '../entity_id.mjs'
import { isHex64, normalizeHex64 } from '../hexIds.mjs'
import { getOperatorEntityHashProvider } from '../social/follower_index_registry.mjs'

/**
 * sender 是否为本机某 agent 实体的合法 operator（agent 绑定链的本机可验证子集）。
 * @param {string} entityHash 128 位 agent entityHash
 * @param {string} sender 已验签的 sender pubKeyHash（64 hex）
 * @returns {Promise<boolean>} 是否为该 agent 托管节点的 operator
 */
async function isLocalAgentOperator(entityHash, sender) {
	const resolved = await resolveSocialEntity(entityHash)
	if (resolved?.kind !== 'agent' || !resolved.replicaUsername) return false
	const resolveOperator = getOperatorEntityHashProvider()
	if (!resolveOperator) return false
	const operator = await resolveOperator(resolved.replicaUsername)
	const operatorSubject = operator ? parseEntityHash(operator)?.subjectHash : null
	return !!operatorSubject && operatorSubject === sender
}

/**
 * 判定已验签的 sender 是否有权写入目标时间线（user / agent 统一入口）。
 * @param {string} entityHash 时间线 owner（128 hex）
 * @param {string} sender 事件 sender（已验签的 pubKeyHash，64 hex）
 * @returns {Promise<boolean>} 是否授权写入
 */
export async function isTimelineWriteAuthorized(entityHash, sender) {
	const parsed = parseEntityHash(entityHash)
	if (!parsed) return false
	const normalizedSender = normalizeHex64(sender)
	if (!isHex64(normalizedSender)) return false
	if (normalizedSender === parsed.subjectHash) return true
	return isLocalAgentOperator(parsed.entityHash, normalizedSender)
}
