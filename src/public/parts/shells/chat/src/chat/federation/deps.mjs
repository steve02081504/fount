/**
 * 【文件】federation/deps.mjs
 * 【职责】联邦模块与 DAG 子系统的依赖注入点：在 chat 启动时由 dag/index 注入 nodeId、读盘、远端事件落盘与物化状态查询，避免 federation 与 dag 循环 import。
 * 【原理】initFederationDagDeps 写入进程级 dagDeps；requireDagDeps 在房间 join 或 gossip 前强制校验已注入。loadFederationMaterializedState 代理 getStateForFederation 供 ACL、频道历史、gossip 新鲜加入判断使用。
 * 【数据结构】FederationDagDeps：nodeId、readJsonl、appendValidatedRemoteEvent、ingestRemoteEvent、可选 getStateForFederation；物化 state 含 members、groupSettings、channels。
 * 【关联】dag/index.mjs、materialize.mjs、remoteIngest.mjs；被 room、gossip、index、volatile 等广泛引用。
 */
import { getNodeHash } from '../../../../../../../scripts/p2p/node_context.mjs'

/**
 * @typedef {{
 *   getNodeHash: (username: string) => string
 *   readJsonl: (path: string) => Promise<object[]>
 *   appendValidatedRemoteEvent: (username: string, groupId: string, signPayload: object, opts?: { logFailures?: boolean }) => Promise<'ok' | 'dup' | 'invalid' | 'quarantined'>
 *   ingestRemoteEvent: (username: string, groupId: string, payload: unknown) => Promise<void>
 *   getStateForFederation?: (username: string, groupId: string) => Promise<{ state: object }>
 * }} FederationDagDeps
 */

/** @type {FederationDagDeps | null} */
export let dagDeps = null

/**
 * @param {FederationDagDeps} deps DAG 依赖集合
 */
export function initFederationDagDeps(deps) {
	dagDeps = deps
}

/**
 * @returns {FederationDagDeps} 已注入的 DAG 依赖
 */
export function requireDagDeps() {
	if (!dagDeps) throw new Error('federation: initFederationDagDeps must run before federation features')
	return dagDeps
}

/**
 * @param {string} username replica 登录名
 * @returns {string} 64 hex nodeHash
 */
export function federationNodeHash(username) {
	return getNodeHash()
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @returns {Promise<object | null>} 物化群状态；未注入依赖时为 null
 */
export async function loadFederationMaterializedState(username, groupId) {
	if (!dagDeps?.getStateForFederation) return null
	const { state } = await dagDeps.getStateForFederation(username, groupId)
	return state
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @returns {Promise<object>} 群设置对象
 */
export async function loadFederationGroupSettings(username, groupId) {
	return (await loadFederationMaterializedState(username, groupId))?.groupSettings || {}
}
