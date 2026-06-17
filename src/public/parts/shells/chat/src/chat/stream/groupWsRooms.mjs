/**
 * 【文件】stream/groupWsRooms.mjs
 * 【职责】群 WebSocket 房间注册表：roomKey 映射到连接集合，维护 replica 节点 hash 与 RPC clientNodeId 身份表。
 * 【原理】roomKey 为 ownerNodeHash:groupId，与 lib/replica 本机 nodeHash 对齐；replicaNodeByGroupId 供仅知 groupId 的广播解析房间。rpcClientIdentities 将 ws 映射到浏览器登记的 UUID v4 clientNodeId。
 * 【数据结构】groupSockets Map；replicaNodeByGroupId Map；rpcClientIdentities Map<ws, clientNodeId>。
 * 【关联】groupWsBroadcast.mjs、groupWsRpc.mjs、lib/replica.mjs、session/wsLifecycle.mjs。
 */
import { getLocalNodeHash } from '../lib/replica.mjs'

/** @type {Map<string, Set<import('npm:websocket-express').WebSocket>>} */
export const groupSockets = new Map()

/** groupId → replica 节点 nodeHash，供仅知 groupId 的广播路径解析房间键。 */
export const replicaNodeByGroupId = new Map()

/**
 * @param {string} ownerNodeHash replica 节点 hash（64 hex）
 * @param {string} groupId 群 ID
 * @returns {string} WS 房间键
 */
export function groupWsRoomKey(ownerNodeHash, groupId) {
	return `${ownerNodeHash}:${groupId}`
}

/**
 * @param {string} ownerNodeHash replica 节点 hash
 * @param {string} groupId 群 ID
 * @returns {void}
 */
export function registerGroupReplicaNode(ownerNodeHash, groupId) {
	if (ownerNodeHash && groupId) replicaNodeByGroupId.set(groupId, ownerNodeHash)
}

/**
 * @param {string} groupId 群 ID
 * @param {string} [fallbackNodeHash] 无登记时的 nodeHash
 * @returns {string} WS 房间键
 */
export function resolveGroupWsRoomKey(groupId, fallbackNodeHash) {
	const nodeHash = replicaNodeByGroupId.get(groupId) || fallbackNodeHash
	return nodeHash ? groupWsRoomKey(nodeHash, groupId) : groupId
}

/**
 * @param {string} groupId 群 ID
 * @returns {string} WS 房间键
 */
export function groupWsRoomKeyForReplica(groupId) {
	return groupWsRoomKey(getLocalNodeHash(), groupId)
}

/**
 * @param {string} groupId 群 ID
 * @returns {void}
 */
export function registerGroupReplicaForUser(groupId) {
	registerGroupReplicaNode(getLocalNodeHash(), groupId)
}

/**
 * @param {string} groupId 群 ID
 * @returns {void}
 */
export function dropGroupReplicaRegistration(groupId) {
	replicaNodeByGroupId.delete(groupId)
}

/** 群 WS 连接登记的 RPC 客户端身份（浏览器 `clientNodeId`），供定向转发。 */
/** @type {WeakMap<import('npm:websocket-express').WebSocket, string>} */
export const rpcClientIdentities = new WeakMap()
