/**
 * 【文件】public/hub/entityResolve.mjs
 * 【职责】Hub 内实体身份解析：角色 agent entityHash、本地可写与当前 viewer 的 hash 判定。
 * 【原理】为资料卡、成员菜单与消息作者展示提供 `charAgentEntityHash` 等查询辅助。间接影响作者标签与 trusted 判定输入，不渲染消息 HTML。
 * 【数据结构】store 及模块内 Map/Set 字段；见 core/state 与各函数 JSDoc。
 * 【关联】../src/friendBinding、../src/lib/entityHash、core/state、core/domUtils
 */
import { isSelfOrOwnedAgentEntity } from '../src/trustedAuthors.mjs'

import { charEntityHashFromCache, warmCharEntityHashCache } from './core/domUtils.mjs'
import { store } from './core/state.mjs'

/**
 * @param {string} charname 角色 part 名
 * @returns {Promise<string | null>} 本地 agent entityHash（后端 identity，禁止路径派生）
 */
export async function charAgentEntityHash(charname) {
	const name = String(charname || '').trim()
	if (!name) return null
	const cached = charEntityHashFromCache(name)
	if (cached) return cached
	await warmCharEntityHashCache([name])
	return charEntityHashFromCache(name)
}

/**
 * @param {string | null | undefined} entityHash 128 位 entityHash
 * @returns {boolean} 是否为本节点可写实体（用户本人或本地角色 agent）
 */
export function isLocalWritableEntityHash(entityHash) {
	return isSelfOrOwnedAgentEntity(entityHash, {
		selfEntityHash: store.viewer?.viewerEntityHash,
		nodeHash: store.viewer?.nodeHash,
	})
}

/**
 * 是否可编辑资料：本机可写，或声明主人是当前 viewer。
 * @param {string | null | undefined} entityHash 目标
 * @param {{ ownerEntityHash?: string | null } | null | undefined} [profile] 资料（含 ownerEntityHash）
 * @returns {boolean} 是否显示编辑入口
 */
export function canEditEntityProfile(entityHash, profile) {
	if (isLocalWritableEntityHash(entityHash)) return true
	const viewer = String(store.viewer?.viewerEntityHash || '').trim().toLowerCase()
	const owner = String(profile?.ownerEntityHash || '').trim().toLowerCase()
	return !!(viewer && owner && viewer === owner)
}

/**
 * @param {string | null | undefined} entityHash 目标 entityHash
 * @returns {boolean} 是否为当前登录 viewer
 */
export function isViewerEntityHash(entityHash) {
	const viewer = String(store.viewer.viewerEntityHash || '').trim().toLowerCase()
	const eh = String(entityHash || '').trim().toLowerCase()
	return !!viewer && viewer === eh
}
