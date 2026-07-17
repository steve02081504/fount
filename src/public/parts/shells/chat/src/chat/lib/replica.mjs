/**
 * 【文件】src/chat/lib/replica.mjs
 * 【职责】replica 上下文与群成员 entityHash；用户 operator 见 server/p2p_server。
 *
 * 群成员 `pubKeyHash`（DAG sender）来自 per-group 临时 signer，与 entity 身份解耦。
 * `getGroupMemberEntityHash` 必须返回 operator entityHash，禁止用 signer 公钥拼假 entity
 * （否则 Hub 用户栏会指向无资料的 phantom，与消息/成员表上的真头像分叉）。
 */
import { getNodeHash, isWritableLocalEntity } from 'npm:@steve02081504/fount-p2p/node/identity'

import { getReplicaFromReq, isWritableLocalEntityForUser } from '../../entity/http.mjs'
import {
	getOperatorEntityHash,
	resolveOperatorEntityHashForUser,
} from '../../entity/identity.mjs'

/**
 * @returns {string} 本节点 nodeHash（节点级单例）
 */
export function getLocalNodeHash() {
	return getNodeHash()
}

/**
 * @param {string} replicaUsername replica 所有者
 * @returns {Promise<string | null>} operator entityHash
 */
export function resolveOperatorEntityHash(replicaUsername) {
	return resolveOperatorEntityHashForUser(replicaUsername)
}

/**
 *
 */
export {
	getOperatorEntityHash,
	getReplicaFromReq,
	isWritableLocalEntity,
	isWritableLocalEntityForUser,
}

/**
 * 本机 HTTP/Hub 在群上下文中的实体身份（恒为 operator）。
 * 群临时 signer 的 pubKeyHash 不是 entityHash。
 * @param {string} replicaUsername replica 所有者
 * @param {string} [_groupId] 群 ID（保留签名；身份不随群变）
 * @returns {Promise<string | null>} operator entityHash
 */
export async function getGroupMemberEntityHash(replicaUsername, _groupId) {
	return resolveOperatorEntityHashForUser(replicaUsername)
}
