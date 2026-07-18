/** DAG 事件 type 分类（供治理选支、联邦 ACL、频道 GC 等复用）。 */

import {
	registerEventTypeDefs,
	unregisterEventTypeDefs,
} from 'npm:@steve02081504/fount-p2p/registries/event_type'

const OWNER_ID = 'chat'

/**
 * @typedef {object} EventTypeFlags
 * @property {boolean} [aclGated] 联邦入站/中继前须物化 ACL 门控
 * @property {boolean} [gcExclude] §6.2 频道 GC 不刷新活跃时间
 * @property {boolean} [governance] §8 治理分叉选支计入信誉加权
 * @property {boolean} [permissionAnchor] §7.1 裁剪时不得早于的权限锚点
 */

/** @type {Record<string, EventTypeFlags>} */
export const CHAT_EVENT_TYPE_DEFS = {
	member_join: { aclGated: true, gcExclude: true, governance: true, permissionAnchor: true },
	member_leave: { aclGated: true, gcExclude: true, governance: true, permissionAnchor: true },
	member_kick: { aclGated: true, gcExclude: true, governance: true, permissionAnchor: true },
	member_ban: { aclGated: true, gcExclude: true, governance: true, permissionAnchor: true },
	member_unban: { aclGated: true, gcExclude: true, governance: true, permissionAnchor: true },
	member_owner_update: { aclGated: true, gcExclude: true, governance: true, permissionAnchor: true },
	role_create: { aclGated: true, gcExclude: true, governance: true, permissionAnchor: true },
	role_update: { aclGated: true, gcExclude: true, governance: true, permissionAnchor: true },
	role_delete: { aclGated: true, gcExclude: true, governance: true, permissionAnchor: true },
	role_assign: { aclGated: true, gcExclude: true, governance: true, permissionAnchor: true },
	role_revoke: { aclGated: true, gcExclude: true, governance: true, permissionAnchor: true },
	channel_create: { aclGated: true, governance: true },
	channel_update: { aclGated: true, governance: true },
	channel_delete: { aclGated: true, governance: true },
	channel_permissions_update: { aclGated: true, gcExclude: true, governance: true, permissionAnchor: true },
	channel_key_rotate: { aclGated: true, gcExclude: true, governance: true, permissionAnchor: true },
	channel_key_rotate_batch: { aclGated: true, gcExclude: true, governance: true, permissionAnchor: true },
	state_summary: { aclGated: true, gcExclude: true, governance: true, permissionAnchor: true },
	group_meta_update: { aclGated: true, gcExclude: true, governance: true, permissionAnchor: true },
	group_settings_update: { aclGated: true, gcExclude: true, governance: true, permissionAnchor: true },
	reputation_slash: { aclGated: true, gcExclude: true, governance: true, permissionAnchor: true },
	reputation_reset: { aclGated: true, gcExclude: true, governance: true, permissionAnchor: true },
	file_master_key_rotate: { aclGated: true, gcExclude: true, governance: true, permissionAnchor: true },
	peer_invite: { aclGated: true, gcExclude: true, governance: true, permissionAnchor: true },
	dag_tip_merge: { aclGated: true, governance: true, permissionAnchor: true },
	list_item_update: { aclGated: true },
	file_upload: { aclGated: true },
	file_delete: { aclGated: true },
	cabinet_bind: { aclGated: true, gcExclude: true, governance: true, permissionAnchor: true },
	cabinet_key_update: { aclGated: true, gcExclude: true, governance: true, permissionAnchor: true },
	cabinet_unbind: { aclGated: true, gcExclude: true, governance: true, permissionAnchor: true },
	pin_message: { aclGated: true },
	unpin_message: { aclGated: true },
	reaction_add: { aclGated: true },
	reaction_remove: { aclGated: true },
	message: { aclGated: true },
	message_edit: { aclGated: true },
	message_delete: { aclGated: true },
	message_feedback: { aclGated: true },
	vote_cast: { aclGated: true },
	agent_reply_frequency_set: {},
	session_world_bind: {},
	session_world_bind_channel: {},
	session_world_clear: {},
	session_persona_set: {},
	// 遗留：插件名单已迁节点本地存储；保留 type 定义以便旧 DAG 重放/入站不炸
	session_plugin_add: {},
	session_plugin_remove: {},
	world_state: { aclGated: true },
}

/**
 * @param {keyof EventTypeFlags} flag 标志位名
 * @returns {Set<string>} 含该标志的事件 type 集合
 */
function typesWithFlag(flag) {
	return new Set(Object.entries(CHAT_EVENT_TYPE_DEFS).filter(([, f]) => f[flag]).map(([k]) => k))
}

/**
 * 成员生命周期相关 DAG 事件 type 集合（加入、离开、踢出、封禁、解封）。
 * @type {Set<string>}
 */
export const MEMBER_LIFECYCLE_EVENT_TYPES = new Set([
	'member_join',
	'member_leave',
	'member_kick',
	'member_ban',
	'member_unban',
])

/**
 * 角色治理相关 DAG 事件 type 集合（创建、更新、删除、分配、撤销）。
 * @type {Set<string>}
 */
export const ROLE_EVENT_TYPES = new Set([
	'role_create',
	'role_update',
	'role_delete',
	'role_assign',
	'role_revoke',
])

/**
 * 频道管理相关 DAG 事件 type 集合（创建、更新、删除、权限覆写）。
 * @type {Set<string>}
 */
export const CHANNEL_ADMIN_EVENT_TYPES = new Set([
	'channel_create',
	'channel_update',
	'channel_delete',
	'channel_permissions_update',
])

/**
 * 群元数据与设置相关 DAG 事件 type 集合。
 * @type {Set<string>}
 */
export const GROUP_META_EVENT_TYPES = new Set([
	'group_meta_update',
	'group_settings_update',
])

/**
 * 信誉治理相关 DAG 事件 type 集合（slash、reset）。
 * @type {Set<string>}
 */
export const REPUTATION_EVENT_TYPES = new Set([
	'reputation_slash',
	'reputation_reset',
])

/** §8 治理分叉选支：祖先闭包内计入信誉加权的类型。 */
export const GOVERNANCE_AUTHZ_TYPES = typesWithFlag('governance')

/** 联邦入站/中继前须物化 ACL 门控的类型（§2.1、§8）。 */
export const FEDERATION_ACL_GATED_EVENT_TYPES = typesWithFlag('aclGated')

/** §6.2 频道 GC 沉寂计时排除的类型（即使带 channelId 也不刷新活跃时间）。 */
export const CHANNEL_GC_EXCLUDED_EVENT_TYPES = typesWithFlag('gcExclude')

/** 裁剪时不得早于最早一条权限锚点事件（§7.1）。 */
export const PERMISSION_ANCHOR_TYPES = typesWithFlag('permissionAnchor')

/** 纯本地会话/元数据事件（不经联邦 HLC 硬拒，联邦入站仍拒）。 */
export const SESSION_EVENT_TYPES = new Set(
	Object.keys(CHAT_EVENT_TYPE_DEFS).filter(type => type.startsWith('session_')),
)
SESSION_EVENT_TYPES.add('agent_reply_frequency_set')

/** @returns {void} */
export function registerChatEventTypeDefs() {
	registerEventTypeDefs(OWNER_ID, CHAT_EVENT_TYPE_DEFS)
}

/** @returns {void} */
export function unregisterChatEventTypeDefs() {
	unregisterEventTypeDefs(OWNER_ID)
}
