/**
 * 【文件】resolvePart.mjs — 本机/远端角色、世界、人格、插件部件解析
 * 【职责】resolveChar/resolveWorld/resolvePersona 根据 session 绑定 homeNodeHash 决定 loadPart 或 createRemote*Proxy；resolveLocalPlugins 从节点本地 `local_plugins.json` 加载。
 * 【原理】isLocalNode 为真则同步 loadPart(owner, path)；否则 RPC 代理将 method/args 转发到 invokeGroupRpc(targetNodeId)；memberId 形如 owner:charname、owner:world:worldname、owner:persona:name。
 * 【数据结构】bind { ownerUsername, homeNodeHash }；代理闭包封装跨节点调用。
 * 【关联】dagSession、runtime、rpcInvoke、federation/remoteProxy、chatRequest、localPlugins。
 */
import { loadPart } from '../../../../../../../server/parts_loader.mjs'
import { getState } from '../dag/materialize.mjs'
import { createRemoteCharProxy, createRemotePersonaProxy } from '../federation/remoteProxy.mjs'
import { createRemoteWorldProxy } from '../federation/remoteWorldProxy.mjs'
import { getLocalNodeHash } from '../lib/replica.mjs'

import { BUILTIN_WORLD } from './builtinParts.mjs'
import { getMaterializedSession } from './dagSession.mjs'
import { getLocalPluginNames } from './localPlugins.mjs'
import { invokeGroupRpc } from './rpcInvoke.mjs'
import { getCharBind, isLocalNode } from './runtime.mjs'
import { ignoreMissingPartLoadError } from './timeSliceParts.mjs'
import { ensureWorldHostConnected } from './worldHost.mjs'

/**
 * 解析 persona 归属节点：本机 replica 用本地 node；远端优先 agent.ownerUsername / session.chars 绑定。
 * @param {object} session 物化 session
 * @param {object} state 物化群状态
 * @param {string} ownerUsername persona 槽位用户
 * @param {string} replicaUsername 当前 replica
 * @returns {string | null} homeNodeHash
 */
function resolvePersonaHomeNodeHash(session, state, ownerUsername, replicaUsername) {
	if (ownerUsername === replicaUsername) return getLocalNodeHash()
	for (const member of Object.values(state?.members || {})) {
		if (member?.status !== 'active') continue
		if (member.ownerUsername === ownerUsername && member.homeNodeHash)
			return member.homeNodeHash
	}
	for (const bind of Object.values(session?.chars || {})) 
		if (bind?.ownerUsername === ownerUsername && bind.homeNodeHash)
			return bind.homeNodeHash
	
	return null
}

/**
 * 本机加载 world part 后惰性接线 ChatHostConnected。
 * @param {string} groupId 群 ID
 * @param {string} replicaUsername replica 所有者
 * @param {string} worldname 世界名
 * @param {import('../../../../../../../decl/worldAPI.ts').WorldAPI_t | null | undefined} world 已加载 part；缺省回退 BUILTIN_WORLD
 * @returns {Promise<import('../../../../../../../decl/worldAPI.ts').WorldAPI_t>} 本机 world 或 BUILTIN_WORLD
 */
async function finalizeLocalWorld(groupId, replicaUsername, worldname, world) {
	const resolved = world || BUILTIN_WORLD
	if (world)
		await ensureWorldHostConnected(replicaUsername, groupId, worldname, world)
	return resolved
}

/**
 * @param {string} groupId 群 ID
 * @param {string} charname 角色名
 * @param {string} replicaUsername 当前 replica
 * @returns {Promise<import('../../../../../../../decl/charAPI.ts').CharAPI_t | null>} 本地或远端角色 API
 */
export async function resolveChar(groupId, charname, replicaUsername) {
	const session = await getMaterializedSession(replicaUsername, groupId)
	const bind = getCharBind(session, charname)
	if (!bind) return null

	const owner = bind.ownerUsername || replicaUsername
	if (isLocalNode(bind.homeNodeHash))
		return loadPart(owner, `chars/${charname}`)

	const memberId = `${owner}:${charname}`
	return createRemoteCharProxy(memberId, bind.homeNodeHash, {}, (method, args) =>
		invokeGroupRpc(groupId, replicaUsername, {
			memberId,
			method,
			args,
			targetNodeId: bind.homeNodeHash,
			partKind: 'char',
		}))
}

/**
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {string} replicaUsername 当前 replica
 * @returns {Promise<import('../../../../../../../decl/worldAPI.ts').WorldAPI_t>} 本地、远端或内置极小世界
 */
export async function resolveWorld(groupId, channelId, replicaUsername) {
	const session = await getMaterializedSession(replicaUsername, groupId)
	const bind = session.channelWorlds?.[channelId] || session.world
	if (!bind?.worldname) return BUILTIN_WORLD

	const distribution = bind.distribution || 'hosted'
	const owner = bind.ownerUsername || replicaUsername
	const worldname = bind.worldname

	if (distribution === 'local') {
		const world = await loadPart(replicaUsername, `worlds/${worldname}`).catch(ignoreMissingPartLoadError)
		return finalizeLocalWorld(groupId, replicaUsername, worldname, world)
	}

	if (distribution === 'replicated') {
		const world = await loadPart(replicaUsername, `worlds/${worldname}`).catch(ignoreMissingPartLoadError)
		if (world) return finalizeLocalWorld(groupId, replicaUsername, worldname, world)
		const memberId = `${owner}:world:${worldname}`
		return createRemoteWorldProxy(memberId, bind.homeNodeHash, {}, (method, args) =>
			invokeGroupRpc(groupId, replicaUsername, {
				memberId,
				method,
				args,
				targetNodeId: bind.homeNodeHash,
				partKind: 'world',
			}))
	}

	if (isLocalNode(bind.homeNodeHash)) {
		const world = await loadPart(owner, `worlds/${worldname}`).catch(ignoreMissingPartLoadError)
		return finalizeLocalWorld(groupId, replicaUsername, worldname, world)
	}

	const memberId = `${owner}:world:${worldname}`
	return createRemoteWorldProxy(memberId, bind.homeNodeHash, {}, (method, args) =>
		invokeGroupRpc(groupId, replicaUsername, {
			memberId,
			method,
			args,
			targetNodeId: bind.homeNodeHash,
			partKind: 'world',
		}))
}

/**
 * 解析群内某用户的 persona（本机 loadPart / 跨机 remote proxy）。
 * @param {string} groupId 群 ID
 * @param {string} ownerUsername persona 槽位用户（session.personas 键）
 * @param {string} replicaUsername 当前 replica
 * @returns {Promise<import('../../../../../../../decl/userAPI.ts').UserAPI_t | null>} 本地或远端人格 API
 */
export async function resolvePersona(groupId, ownerUsername, replicaUsername) {
	const session = await getMaterializedSession(replicaUsername, groupId)
	const personaname = session.personas?.[ownerUsername]
	if (!personaname) return null

	const { state } = await getState(replicaUsername, groupId)
	const homeNodeHash = resolvePersonaHomeNodeHash(session, state, ownerUsername, replicaUsername)
	if (!homeNodeHash) return null

	if (isLocalNode(homeNodeHash))
		return loadPart(ownerUsername, `personas/${personaname}`).catch(ignoreMissingPartLoadError)

	const memberId = `${ownerUsername}:persona:${personaname}`
	return createRemotePersonaProxy(memberId, homeNodeHash, {}, (method, args) =>
		invokeGroupRpc(groupId, replicaUsername, {
			memberId,
			method,
			args,
			targetNodeId: homeNodeHash,
			partKind: 'persona',
		}))
}

/**
 * 本机 replica 启用的插件（节点本地名单；仅作用于本机角色，不联邦）。
 * @param {string} groupId 群 ID
 * @param {string} replicaUsername replica 所有者
 * @returns {Promise<Record<string, import('../../../../../../../decl/pluginAPI.ts').PluginAPI_t>>} 插件名到 API 的映射
 */
export async function resolveLocalPlugins(groupId, replicaUsername) {
	const names = await getLocalPluginNames(replicaUsername, groupId)
	const out = {}
	for (const pluginname of names)
		out[pluginname] = await loadPart(replicaUsername, `plugins/${pluginname}`)
	return out
}
