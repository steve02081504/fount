/**
 * Social 时间线写入授权（联邦入站 untrusted 边界）。
 *
 * 统一抽象：「证明 sender 有权写入该时间线 entityHash」。人类用户与 agent 不做本质特殊
 * 对待，走同一判定入口，内部按 entity 类型解析出谁有权写：
 *
 * - **user 型 entity**：`subjectHash` 即 owner 的签名身份 pubKeyHash（见 entity_id.mjs：
 *   `userEntityHashFromPubKeyHex` → subjectHash = pubKeyHash(identityPubKey)）。故合法写入者
 *   的 `sender` 必须等于 `subjectHash`，可纯哈希校验、强绑定，无需任何外部状态。
 * - **agent 型 entity**：`subjectHash = agentSubjectHash(charPath)`，agent 没有独立私钥，
 *   合法写入者是托管该 agent 的节点 operator（其 federation identity 代签）。要远端验证
 *   「sender 是 nodeHash 的合法 operator」需 `nodeHash → operator pubKeyHash` 的绑定/公告链。
 *   当前架构仅在**本机**可解析该绑定（无跨节点身份公告，见 README 架构问题），故 agent 仅在
 *   本机托管时可放行；远端 agent 时间线事件无法被授权（保守拒绝，安全优先）。
 */
import { resolveOperatorEntityHash } from './lib/operatorEntity.mjs'
import { parseEntityHash } from '../../../../../../scripts/p2p/entity_id.mjs'
import { isHex64, normalizeHex64 } from '../../../../../../scripts/p2p/hexIds.mjs'
import { resolveSocialEntity } from '../lib/entityResolve.mjs'

/**
 * sender 是否为本机某 agent 实体的合法 operator（agent 绑定链的本机可验证子集）。
 * @param {string} entityHash 128 位 agent entityHash
 * @param {string} sender 已验签的 sender pubKeyHash（64 hex）
 * @returns {boolean} 是否为该 agent 托管节点的 operator
 */
function isLocalAgentOperator(entityHash, sender) {
	const resolved = resolveSocialEntity(entityHash)
	if (resolved?.kind !== 'agent' || !resolved.replicaUsername) return false
	const operator = await resolveOperatorEntityHash(resolved.replicaUsername)
	const operatorSubject = operator ? parseEntityHash(operator)?.subjectHash : null
	return !!operatorSubject && operatorSubject === sender
}

/**
 * 判定已验签的 sender 是否有权写入目标时间线（user / agent 统一入口）。
 * 调用前必须已通过 `verifyTimelineRemoteSignature`：此处 sender 被信任为 senderPubKey 的持有者。
 * @param {string} entityHash 时间线 owner（128 hex）
 * @param {string} sender 事件 sender（已验签的 pubKeyHash，64 hex）
 * @returns {boolean} 是否授权写入
 */
export function isTimelineWriteAuthorized(entityHash, sender) {
	const parsed = parseEntityHash(entityHash)
	if (!parsed) return false
	const normalizedSender = normalizeHex64(sender)
	if (!isHex64(normalizedSender)) return false
	// user 型：subjectHash 即 owner 签名身份；sender 必须就是 owner 本人。
	if (normalizedSender === parsed.subjectHash) return true
	// agent 型：靠托管节点 operator 身份绑定证明（当前仅本机可解析）。
	return isLocalAgentOperator(parsed.entityHash, normalizedSender)
}
