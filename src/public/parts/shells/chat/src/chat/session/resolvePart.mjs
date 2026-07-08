/**
 * 【文件】resolvePart.mjs — 本机/远端角色、世界、插件部件解析
 * 【职责】resolveChar/resolveWorld 根据 session 绑定 homeNodeHash 决定 loadPart 或 createRemote*Proxy；resolveLocalPlugins 仅加载本 replica 启用的插件列表。
 * 【原理】isLocalNode 为真则同步 loadPart(owner, path)；否则 RPC 代理将 method/args 转发到 invokeGroupRpc(targetNodeId)；memberId 形如 owner:charname 或 owner:world:worldname。
 * 【数据结构】bind { ownerUsername, homeNodeHash }；代理闭包封装跨节点调用。
 * 【关联】dagSession、runtime、rpcInvoke、federation/remoteProxy、chatRequest。
 */
import { loadPart } from '../../../../../../../server/parts_loader.mjs'
import { createRemoteCharProxy } from '../federation/remoteProxy.mjs'
import { createRemoteWorldProxy } from '../federation/remoteWorldProxy.mjs'

import { BUILTIN_WORLD } from './builtinParts.mjs'
import { getMaterializedSession } from './dagSession.mjs'
import { invokeGroupRpc } from './rpcInvoke.mjs'
import { getCharBind, isLocalNode } from './runtime.mjs'
import { ignoreMissingPartLoadError } from './timeSliceParts.mjs'

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
	if (isLocalNode(bind.homeNodeHash, replicaUsername))
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

	const owner = bind.ownerUsername || replicaUsername
	if (isLocalNode(bind.homeNodeHash, replicaUsername)) {
		const world = await loadPart(owner, `worlds/${bind.worldname}`).catch(ignoreMissingPartLoadError)
		return world || BUILTIN_WORLD
	}

	const memberId = `${owner}:world:${bind.worldname}`
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
 * 本机 replica 启用的插件（仅作用于本机角色）。
 * @param {string} groupId 群 ID
 * @param {string} replicaUsername replica 所有者
 * @returns {Promise<Record<string, import('../../../../../../../decl/pluginAPI.ts').PluginAPI_t>>} 插件名到 API 的映射
 */
export async function resolveLocalPlugins(groupId, replicaUsername) {
	const session = await getMaterializedSession(replicaUsername, groupId)
	const names = session.plugins?.[replicaUsername] || []
	const out = {}
	for (const pluginname of names)
		out[pluginname] = await loadPart(replicaUsername, `plugins/${pluginname}`)
	return out
}
