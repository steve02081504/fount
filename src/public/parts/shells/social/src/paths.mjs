import { timelineGroupId } from '../../../../../scripts/p2p/social_namespace.mjs'
import { getUserDictionary } from '../../../../../server/auth/index.mjs'

/**
 * 返回指定 entity 时间线目录路径。
 * @param {string} username 用户
 * @param {string} entityHash 128 hex
 * @returns {string} 时间线目录
 */
export function timelineDir(username, entityHash) {
	return `${getUserDictionary(username)}/shells/social/timelines/${entityHash.toLowerCase()}`
}

/**
 * 返回 events.jsonl 文件路径。
 * @param {string} username 用户
 * @param {string} entityHash 128 hex
 * @returns {string} events.jsonl 路径
 */
export function timelineEventsPath(username, entityHash) {
	return `${timelineDir(username, entityHash)}/events.jsonl`
}

/**
 * 返回物化快照 JSON 文件路径。
 * @param {string} username 用户
 * @param {string} entityHash 128 hex
 * @returns {string} 物化快照路径
 */
export function timelineSnapshotPath(username, entityHash) {
	return `${timelineDir(username, entityHash)}/snapshot.json`
}

/**
 * 返回 GSH vault 状态文件路径。
 * @param {string} username 用户
 * @param {string} entityHash 128 hex
 * @returns {string} GSH vault 状态
 */
export function vaultStatePath(username, entityHash) {
	return `${timelineDir(username, entityHash)}/vault_master_key.json`
}

/**
 * 返回 savedPosts.json 文件路径。
 * @param {string} username 用户
 * @returns {string} savedPosts.json
 */
export function savedPostsPath(username) {
	return `${getUserDictionary(username)}/shells/social/savedPosts.json`
}

/**
 * Social 全文搜索与辅助索引根目录。
 * @param {string} username replica
 * @returns {string} search 目录
 */
export function socialSearchIndexPath(username) {
	return `${getUserDictionary(username)}/shells/social/search`
}

/**
 * 回复反向索引文件。
 * @param {string} username replica
 * @returns {string} replies.json 路径
 */
export function socialReplyIndexPath(username) {
	return `${socialSearchIndexPath(username)}/replies.json`
}

/**
 * 话题计数物化文件。
 * @param {string} username replica
 * @returns {string} trending.json 路径
 */
export function socialTrendingIndexPath(username) {
	return `${socialSearchIndexPath(username)}/trending.json`
}

/**
 * 返回时间线对应的 DAG groupId。
 * @param {string} entityHash 128 hex
 * @returns {string} DAG groupId
 */
export function groupIdForTimeline(entityHash) {
	return timelineGroupId(entityHash)
}
