/**
 * 【文件】public/hub/entityResolve.mjs
 * 【职责】Hub 内实体身份解析：角色 agent entityHash、本地可写与当前 viewer 的 hash 判定。
 * 【原理】为资料卡、成员菜单与消息作者展示提供 `charAgentEntityHash` 等查询辅助。间接影响作者标签与 trusted 判定输入，不渲染消息 HTML。
 * 【数据结构】hubStore 及模块内 Map/Set 字段；见 core/state 与各函数 JSDoc。
 * 【关联】../src/friendBinding、../src/lib/entityHash、core/state
 */
import { isEntityHash128 } from '../shared/entityHash.mjs'
import { buildCharFriendBinding } from '../shared/friendBinding.mjs'

import { hubStore } from './core/state.mjs'

/**
 * @param {string} charname 角色 part 名
 * @returns {string | null} 本地 agent entityHash
 */
export async function charAgentEntityHash(charname) {
	const { nodeHash } = hubStore
	const name = String(charname || '').trim()
	if (!nodeHash || !name) return null
	return (await buildCharFriendBinding(nodeHash, name)).entityHash
}

/**
 * @param {string | null | undefined} entityHash 128 位 entityHash
 * @returns {boolean} 是否为本节点可写实体（用户本人或本地角色 agent）
 */
export function isLocalWritableEntityHash(entityHash) {
	const eh = String(entityHash || '').trim().toLowerCase()
	const nodeHash = String(hubStore.viewer.nodeHash || '').trim().toLowerCase()
	if (!isEntityHash128(eh) || !nodeHash) return false
	return eh.slice(0, 64) === nodeHash
}

/**
 * @param {string | null | undefined} entityHash 目标 entityHash
 * @returns {boolean} 是否为当前登录 viewer
 */
export function isViewerEntityHash(entityHash) {
	const viewer = String(hubStore.viewer.viewerEntityHash || '').trim().toLowerCase()
	const eh = String(entityHash || '').trim().toLowerCase()
	return !!viewer && viewer === eh
}
