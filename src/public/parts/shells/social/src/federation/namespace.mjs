/**
 * Social 时间线 / vault 命名空间（复用 DAG groupId 字段）。
 */
const ENTITY_HASH_RE = /^[\da-f]{128}$/u

/**
 * @param {string} entityHash 128 hex
 * @returns {string} 规范化 entityHash
 */
function normalizeEntityHash(entityHash) {
	const normalized = String(entityHash).trim().toLowerCase()
	if (!ENTITY_HASH_RE.test(normalized)) throw new Error('invalid entityHash')
	return normalized
}

/**
 * @param {string} entityHash 128 hex
 * @param {string} prefix 命名空间前缀
 * @returns {string} DAG groupId
 */
function socialGroupId(entityHash, prefix) {
	return `${prefix}:${normalizeEntityHash(entityHash)}`
}

/**
 * @param {string} entityHash 128 hex
 * @returns {string} DAG groupId
 */
export function timelineGroupId(entityHash) {
	return socialGroupId(entityHash, 'social-timeline')
}

/**
 * @param {string} entityHash 128 hex
 * @returns {string} vault 逻辑库 groupId
 */
export function vaultGroupId(entityHash) {
	return socialGroupId(entityHash, 'social-vault')
}

/** @type {Set<string>} */
export const SOCIAL_TIMELINE_EVENT_TYPES = new Set([
	'social_meta',
	'post',
	'post_edit',
	'post_delete',
	'poll_vote',
	'repost',
	'like',
	'unlike',
	'dislike',
	'undislike',
	'follow',
	'unfollow',
	'block',
	'unblock',
	'file_share',
	'follow_approve',
	'entity_key_rotate',
	'entity_key_revoke',
	'state_summary',
])

/** @type {Set<string>} */
export const SOCIAL_RPC_REQUEST_TYPES = new Set([
	'social_discover_request',
	'social_post_discover_request',
	'social_follow_graph_request',
	'social_post_notify',
	'social_timeline_pull_request',
	'social_reaction_pull_request',
	'social_tag_merge_claim',
	'social_tag_name_claim',
	'social_report',
])

/** @type {Set<string>} */
export const SOCIAL_RPC_RESPONSE_TYPES = new Set([
	'social_discover_response',
	'social_post_discover_response',
	'social_follow_graph_response',
	'social_post_notify_response',
	'social_timeline_pull_response',
	'social_reaction_pull_response',
	'social_tag_merge_claim_response',
	'social_tag_name_claim_response',
	'social_report_response',
])

/** @type {Set<string>} */
export const SOCIAL_RPC_TYPES = new Set([
	...SOCIAL_RPC_REQUEST_TYPES,
	...SOCIAL_RPC_RESPONSE_TYPES,
])
