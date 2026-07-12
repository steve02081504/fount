/**
 * 【文件】dagSession.mjs — DAG 物化 session 读取与 session_* / 成员 agent 事件追加
 */
import { agentEntityHash } from '../lib/entity.mjs'
import { loadPart } from '../../../../../../../server/parts_loader.mjs'
import { resolveActiveAgentMemberKeyByCharname } from '../../group/access.mjs'
import { appendSignedLocalEvent } from '../dag/append.mjs'
import { getState } from '../dag/materialize.mjs'
import { getLocalNodeHash } from '../lib/replica.mjs'

import { ignoreMissingPartLoadError } from './timeSliceParts.mjs'

/**
 * @param {string} replicaUsername 本地 replica 所有者
 * @param {string} groupId 群 ID
 * @returns {Promise<object>} 物化 state
 */
export async function getMaterializedSession(replicaUsername, groupId) {
	const { state } = await getState(replicaUsername, groupId)
	return state.session || {
		chars: {},
		world: null,
		channelWorlds: {},
		personas: {},
		plugins: {},
		charFrequencies: {},
	}
}

/**
 * @param {string} replicaUsername replica 所有者
 * @returns {{ ownerUsername: string, homeNodeHash: string }} 本机 replica 的部件归属绑定
 */
export function sessionOwnerBinding(replicaUsername) {
	return {
		ownerUsername: replicaUsername,
		homeNodeHash: getLocalNodeHash(),
	}
}

/**
 * 从本机已安装的 world part 读出 distribution（缺省 hosted）。
 * @param {string} replicaUsername replica 所有者
 * @param {string} worldname 世界名
 * @returns {Promise<'local' | 'replicated' | 'hosted'>} 分布形态
 */
async function readWorldDistribution(replicaUsername, worldname) {
	const world = await loadPart(replicaUsername, `worlds/${worldname}`).catch(ignoreMissingPartLoadError)
	return world?.distribution || 'hosted'
}

/**
 * @param {string} replicaUsername replica 所有者
 * @param {string} groupId 群 ID
 * @param {string} charname 角色名
 * @param {{ roles?: string[] }} [appendOpts] 追加选项
 * @returns {Promise<void>}
 */
export async function appendAgentMemberJoin(replicaUsername, groupId, charname, appendOpts = {}) {
	const bind = sessionOwnerBinding(replicaUsername)
	const entityHash = agentEntityHash(bind.homeNodeHash, `chars/${charname}`)
	const content = {
		memberKind: 'agent',
		charname,
		agentEntityHash: entityHash,
		homeNodeHash: bind.homeNodeHash,
		ownerUsername: bind.ownerUsername,
	}
	if (Array.isArray(appendOpts.roles) && appendOpts.roles.length)
		content.roles = appendOpts.roles
	await appendSignedLocalEvent(replicaUsername, groupId, {
		type: 'member_join',
		timestamp: Date.now(),
		content,
	}, appendOpts)
}

/**
 * @param {string} replicaUsername replica 所有者
 * @param {string} groupId 群 ID
 * @param {string} charname 角色名
 * @returns {Promise<void>}
 */
export async function appendAgentMemberKick(replicaUsername, groupId, charname) {
	const { state } = await getState(replicaUsername, groupId)
	const targetMemberKey = resolveActiveAgentMemberKeyByCharname(state, charname)
	if (!targetMemberKey) throw new Error(`agent member not found: ${charname}`)
	await appendSignedLocalEvent(replicaUsername, groupId, {
		type: 'member_kick',
		timestamp: Date.now(),
		content: { targetMemberKey },
	})
}

/**
 * @param {string} replicaUsername replica 所有者
 * @param {string} groupId 群 ID
 * @param {string} charname 角色名
 * @param {number} frequency 发言频率
 * @returns {Promise<void>}
 */
export async function appendAgentReplyFrequencySet(replicaUsername, groupId, charname, frequency) {
	const { state } = await getState(replicaUsername, groupId)
	const targetMemberKey = resolveActiveAgentMemberKeyByCharname(state, charname)
	if (!targetMemberKey) throw new Error(`agent member not found: ${charname}`)
	await appendSignedLocalEvent(replicaUsername, groupId, {
		type: 'agent_reply_frequency_set',
		sender: replicaUsername,
		timestamp: Date.now(),
		content: { targetMemberKey, frequency },
	})
}

/**
 * @param {string} replicaUsername replica 所有者
 * @param {string} groupId 群 ID
 * @param {string | null} worldname 世界名；null 清除群级世界
 * @param {object} [appendOpts] appendSignedLocalEvent 选项
 * @returns {Promise<void>}
 */
export async function appendSessionWorldBind(replicaUsername, groupId, worldname, appendOpts = {}) {
	if (!worldname) {
		await appendSignedLocalEvent(replicaUsername, groupId, {
			type: 'session_world_clear',
			sender: replicaUsername,
			timestamp: Date.now(),
			content: {},
		}, appendOpts)
		return
	}
	const bind = sessionOwnerBinding(replicaUsername)
	const distribution = await readWorldDistribution(replicaUsername, worldname)
	await appendSignedLocalEvent(replicaUsername, groupId, {
		type: 'session_world_bind',
		sender: replicaUsername,
		timestamp: Date.now(),
		content: { worldname, scope: 'group', distribution, ...bind },
	}, appendOpts)
}

/**
 * @param {string} replicaUsername replica 所有者
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {string | null} worldname 世界名；null 清除该频道世界
 * @returns {Promise<void>}
 */
export async function appendSessionChannelWorldBind(replicaUsername, groupId, channelId, worldname) {
	if (!worldname) {
		await appendSignedLocalEvent(replicaUsername, groupId, {
			type: 'session_world_clear',
			sender: replicaUsername,
			timestamp: Date.now(),
			content: { channelId },
		})
		return
	}
	const bind = sessionOwnerBinding(replicaUsername)
	const distribution = await readWorldDistribution(replicaUsername, worldname)
	await appendSignedLocalEvent(replicaUsername, groupId, {
		type: 'session_world_bind_channel',
		sender: replicaUsername,
		timestamp: Date.now(),
		content: { channelId, worldname, distribution, ...bind },
	})
}

/**
 * @param {string} replicaUsername replica 所有者
 * @param {string} groupId 群 ID
 * @param {string | null} personaname 人格名
 * @param {object} [appendOpts] appendSignedLocalEvent 选项
 * @returns {Promise<void>}
 */
export async function appendSessionPersonaSet(replicaUsername, groupId, personaname, appendOpts = {}) {
	await appendSignedLocalEvent(replicaUsername, groupId, {
		type: 'session_persona_set',
		sender: replicaUsername,
		timestamp: Date.now(),
		content: { ownerUsername: replicaUsername, personaname: personaname || null },
	}, appendOpts)
}

/**
 * @param {string} replicaUsername replica 所有者
 * @param {string} groupId 群 ID
 * @param {string} pluginname 插件名
 * @param {object} [appendOpts] appendSignedLocalEvent 选项
 * @returns {Promise<void>}
 */
export async function appendSessionPluginAdd(replicaUsername, groupId, pluginname, appendOpts = {}) {
	await appendSignedLocalEvent(replicaUsername, groupId, {
		type: 'session_plugin_add',
		sender: replicaUsername,
		timestamp: Date.now(),
		content: { ownerUsername: replicaUsername, pluginname },
	}, appendOpts)
}

/**
 * @param {string} replicaUsername replica 所有者
 * @param {string} groupId 群 ID
 * @param {string} pluginname 插件名
 * @returns {Promise<void>}
 */
export async function appendSessionPluginRemove(replicaUsername, groupId, pluginname) {
	await appendSignedLocalEvent(replicaUsername, groupId, {
		type: 'session_plugin_remove',
		sender: replicaUsername,
		timestamp: Date.now(),
		content: { ownerUsername: replicaUsername, pluginname },
	})
}

/**
 * @param {object} session 物化 session
 * @param {string} charname 角色名
 * @returns {boolean} 物化 session 是否已绑定该角色
 */
export function sessionHasChar(session, charname) {
	return !!session?.chars?.[charname]
}
