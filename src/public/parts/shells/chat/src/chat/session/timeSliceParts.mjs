/**
 * timeSlice 部件加载（hydrateTimeSlice 与 buildTimeSliceFromSession 共用）。
 */
import { getAllDefaultParts, getAnyDefaultPart, loadPart } from '../../../../../../../server/parts_loader.mjs'

import { BUILTIN_PERSONA, BUILTIN_WORLD } from './builtinParts.mjs'

/**
 * 部件路径缺失或模块未找到时忽略；其余错误继续抛出。
 * @param {unknown} error 捕获值
 */
export function ignoreMissingPartLoadError(error) {
	if (error?.code === 'ENOENT' || error?.code === 'ERR_MODULE_NOT_FOUND' || error?.code === 'MODULE_NOT_FOUND')
		return
	const cause = error?.cause
	if (cause && (cause.code === 'ENOENT' || cause.code === 'ERR_MODULE_NOT_FOUND' || cause.code === 'MODULE_NOT_FOUND'))
		return
	throw error
}

/**
 * @param {string} username 用户
 * @param {string[]} pluginNames 插件名列表
 * @returns {Promise<Record<string, unknown>>} 插件名到已加载 API 的映射
 */
export async function loadPluginMap(username, pluginNames) {
	/** @type {Record<string, unknown>} */
	const plugins = {}
	for (const pluginname of pluginNames) {
		const part = await loadPart(username, `plugins/${pluginname}`).catch(ignoreMissingPartLoadError)
		if (part) plugins[pluginname] = part
	}
	return plugins
}

/**
 * @param {string} username 用户
 * @param {string[]} charNames 角色名列表
 * @returns {Promise<Record<string, unknown>>} 角色名到已加载 API 的映射
 */
export async function loadCharMapFromNames(username, charNames) {
	/** @type {Record<string, unknown>} */
	const chars = {}
	for (const charname of charNames) {
		const part = await loadPart(username, `chars/${charname}`).catch(ignoreMissingPartLoadError)
		if (part) chars[charname] = part
	}
	return chars
}

/**
 * @param {string} username 用户
 * @param {string | undefined} personaname 人格名
 * @returns {Promise<{ player_id?: string, player: import('../../../../../../../decl/userAPI.ts').UserAPI_t }>} 人格字段（恒有 player）
 */
export async function loadPlayerFields(username, personaname) {
	if (!personaname) return { player: BUILTIN_PERSONA }
	const player = await loadPart(username, `personas/${personaname}`).catch(ignoreMissingPartLoadError)
	return player
		? { player_id: personaname, player }
		: { player: BUILTIN_PERSONA }
}

/**
 * @param {string} username 用户
 * @param {string | undefined} worldname 世界名
 * @returns {Promise<{ world_id?: string, world: import('../../../../../../../decl/worldAPI.ts').WorldAPI_t }>} 世界字段（恒有 world）
 */
export async function loadWorldFields(username, worldname) {
	if (!worldname) return { world: BUILTIN_WORLD }
	const world = await loadPart(username, `worlds/${worldname}`).catch(ignoreMissingPartLoadError)
	return world
		? { world_id: worldname, world }
		: { world: BUILTIN_WORLD }
}

/**
 * @param {string} replicaUsername replica 所有者
 * @param {Record<string, string[]> | undefined} pluginsByUser 物化 session.plugins
 * @returns {Promise<Record<string, unknown>>} replica 默认/绑定插件映射
 */
export async function loadPluginsForReplica(replicaUsername, pluginsByUser) {
	const pluginNames = pluginsByUser?.[replicaUsername] || getAllDefaultParts(replicaUsername, 'plugins')
	return loadPluginMap(replicaUsername, pluginNames)
}

/**
 * @param {string} replicaUsername replica 所有者
 * @param {Record<string, string> | undefined} personas 物化 session.personas
 * @returns {Promise<{ player_id?: string, player?: unknown }>} replica 人格字段
 */
export async function loadPlayerForReplica(replicaUsername, personas) {
	const personaname = personas?.[replicaUsername] || getAnyDefaultPart(replicaUsername, 'personas')
	return loadPlayerFields(replicaUsername, personaname)
}
